import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SyncCore, type Vad } from "../../../client/subsync/core";
import { Silero, SILERO_WEIGHT_FLOATS } from "../../../client/subsync/silero";
import { SAMPLE_RATE } from "../../../client/subsync/signals";
import type { Method } from "../../../client/subsync/solve";
import type { VttCue } from "../vtt";

/**
 * Timing a file to a film's sound with the screens' own aligner (`src/client/subsync`: the voice detector and the solver, the vendored kit
 * unchanged), for a film on this computer. A screen hears the film as it plays; here the whole sound is read first, in the same 10 s pieces,
 * and solved every 15 s of it, as a screen does. Voice only: the recogniser (Whistle) runs in a browser's worker, so a line is placed where
 * speech starts near it, which on real sound is within a second or three (see docs/subtitle-sync.md). Never run on the website's server:
 * it has no film's sound, and fetching films to get one is not done.
 */

const PIECE_SECONDS = 10;
const SOLVE_EVERY = 15;

export interface Timed {
  cues: VttCue[];
  /** Lines a solve placed (the others took the shift learned). */
  placed: number;
  /** Video time minus the file's time, as the solver learned it (seconds), or null when it learned none. */
  shift: number | null;
  methods: Partial<Record<Method, number>>;
  /** Seconds of sound heard. */
  heard: number;
}

/** The weights the screens use, from the site's own folder (`public/subtitle-sync/1/`). */
const WEIGHTS = fileURLToPath(new URL("../../../../public/subtitle-sync/1/silero-vad-16k.bin", import.meta.url));

export async function sileroVad(weightsFile = WEIGHTS): Promise<Vad> {
  const bytes = await readFile(weightsFile);
  const weights = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (weights.length !== SILERO_WEIGHT_FLOATS) throw new Error(`${weightsFile}: not the voice detector's weights`);
  return new Silero(new Float32Array(weights));
}

/** A film's sound as 16 kHz mono pieces, through ffmpeg (`FFMPEG` from the environment, else `ffmpeg` on the PATH). */
export async function* soundOf(file: string, ffmpeg = process.env.FFMPEG ?? "ffmpeg"): AsyncGenerator<Float32Array> {
  const child = spawn(ffmpeg, ["-v", "error", "-nostdin", "-i", file, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], { windowsHide: true });
  let failed = "";
  child.stderr.on("data", (chunk: Buffer) => (failed = (failed + chunk.toString()).slice(-2000)));
  const size = PIECE_SECONDS * SAMPLE_RATE * 4;
  let pending = Buffer.alloc(0);
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) {
      yield floats(pending.subarray(0, size));
      pending = pending.subarray(size);
    }
  }
  const code: number = await new Promise((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.on("close", (c) => resolve(c ?? 1))));
  if (code !== 0) throw new Error(`ffmpeg could not read ${path.basename(file)}: ${failed.trim().split("\n").pop() ?? code}`);
  const whole = pending.length - (pending.length % 4);
  if (whole > 0) yield floats(pending.subarray(0, whole));
}

function floats(bytes: Buffer): Float32Array {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

/** The lines where the sound says them. `sound` gives the film's sound from its start, piece after piece. */
export async function timeToSound(cues: readonly VttCue[], sound: AsyncIterable<Float32Array> | Iterable<Float32Array>, vad: Vad): Promise<Timed> {
  const core = new SyncCore(vad);
  core.setTrack("file", cues as VttCue[], false);
  const placed = new Map<number, { start: number; end: number }>();
  const methods: Partial<Record<Method, number>> = {};
  let shift: number | null = null;
  let at = 0;
  let solvedTo = 0;
  const solve = (end: number) => {
    const outcome = core.solve("file", end);
    if (!outcome) return;
    if (outcome.method !== "none") methods[outcome.method] = (methods[outcome.method] ?? 0) + 1;
    for (const update of outcome.updates) placed.set(update.index, { start: update.start, end: update.end });
    if (outcome.shift !== null) shift = outcome.shift;
  };
  for await (const pcm of sound) {
    core.addAudio(at, pcm);
    at += pcm.length / SAMPLE_RATE;
    if (at - solvedTo >= SOLVE_EVERY) {
      solve(at);
      solvedTo = at;
    }
  }
  if (at > solvedTo) solve(at);
  const learned: number | null = shift;
  const out = cues.map((cue, index) => {
    const moved = placed.get(index);
    if (moved) return { start: moved.start, end: moved.end, text: cue.text };
    if (learned === null) return { ...cue };
    const start = Math.max(0, cue.start + learned);
    return { start, end: Math.max(start + 0.05, cue.end + learned), text: cue.text };
  });
  return { cues: out, placed: placed.size, shift: learned, methods, heard: at };
}
