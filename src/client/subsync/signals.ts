import { SILERO_STEP, type Silero } from "./silero";

/** A word the speech recogniser heard, in the video's time. */
export interface Word {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export const SAMPLE_RATE = 16000;
const STEP_SECONDS = SILERO_STEP / SAMPLE_RATE; // 32 ms
/** Audio that starts this close to where the stretch ended carries on that stretch; a pause bigger than this (or going back) starts a new one. */
const JOIN_TOLERANCE = 0.06;

/** A run of audio without a break, and the voice detector's answer for it. */
interface Stretch {
  /** Video time of its first sample. */
  from: number;
  /** Samples taken in, whole steps and the leftover. */
  samples: number;
  /** The probability of speech for each 32 ms step. */
  steps: number[];
  /** Samples that did not make a whole step yet. */
  carry: Float32Array;
  /** The detector's memory, kept while another stretch is being worked on. */
  memory: Float32Array;
}

export interface Range {
  from: number;
  to: number;
}

/**
 * Everything learned about the sound so far: where speech is (from the voice detector, every audio piece as it arrives) and which
 * words were heard (from the recogniser, on the windows it was given). Times are the video's. Audio comes in pieces, in order while a
 * film plays and from somewhere else after a jump; a piece that continues a stretch is added to it, one that repeats what is known is
 * ignored, anything else starts a new stretch.
 */
export class Signals {
  private readonly stretches: Stretch[] = [];
  private words: Word[] = [];
  private heard: Range[] = [];
  private active: Stretch | undefined;

  constructor(private readonly vad: Pick<Silero, "step" | "reset" | "save" | "restore">) {}

  /** Add a piece of 16 kHz audio that starts at `time`. False when it was known already. */
  addAudio(time: number, pcm: Float32Array): boolean {
    const end = time + pcm.length / SAMPLE_RATE;
    let stretch = this.stretches.find((s) => Math.abs(time - this.endOf(s)) <= JOIN_TOLERANCE);
    if (!stretch) {
      if (this.stretches.some((s) => time >= s.from - JOIN_TOLERANCE && end <= this.endOf(s) + JOIN_TOLERANCE)) return false;
      const overlapped = this.stretches.find((s) => time > s.from && time < this.endOf(s) - JOIN_TOLERANCE);
      if (overlapped) {
        // Partly known: take the new part only.
        const skip = Math.round((this.endOf(overlapped) - time) * SAMPLE_RATE);
        if (skip >= pcm.length) return false;
        return this.addAudio(this.endOf(overlapped), pcm.subarray(skip));
      }
      stretch = { from: time, samples: 0, steps: [], carry: new Float32Array(0), memory: new Float32Array(0) };
      this.stretches.push(stretch);
      this.stretches.sort((a, b) => a.from - b.from);
    }
    // Keep the stretch's clock on the video's: a hair too early drops the repeated samples, a hair too late is filled with silence.
    const gap = Math.round((time - this.endOf(stretch)) * SAMPLE_RATE);
    let audio = pcm;
    if (gap > 0) {
      audio = new Float32Array(gap + pcm.length);
      audio.set(pcm, gap);
    } else if (gap < 0) audio = pcm.subarray(Math.min(pcm.length, -gap));
    this.run(stretch, audio);
    return true;
  }

  private endOf(stretch: Stretch): number {
    return stretch.from + stretch.samples / SAMPLE_RATE;
  }

  private run(stretch: Stretch, pcm: Float32Array): void {
    if (this.active !== stretch) {
      if (this.active) this.active.memory = this.vad.save();
      if (stretch.memory.length > 0) this.vad.restore(stretch.memory);
      else this.vad.reset();
      this.active = stretch;
    }
    let audio = pcm;
    if (stretch.carry.length > 0) {
      audio = new Float32Array(stretch.carry.length + pcm.length);
      audio.set(stretch.carry, 0);
      audio.set(pcm, stretch.carry.length);
    }
    const whole = Math.floor(audio.length / SILERO_STEP);
    for (let k = 0; k < whole; k++) stretch.steps.push(this.vad.step(audio, k * SILERO_STEP));
    stretch.carry = audio.slice(whole * SILERO_STEP);
    stretch.samples += pcm.length;
  }

  /** Words the recogniser heard in audio from `from` to `to`; they replace any it gave for that stretch of time before. */
  addWords(words: readonly Word[], from: number, to: number): void {
    this.words = this.words.filter((w) => w.start < from || w.start >= to);
    this.words.push(...words.filter((w) => w.start >= from && w.start < to));
    this.words.sort((a, b) => a.start - b.start);
    this.heard = mergeRanges([...this.heard, { from, to }]);
  }

  /** Forget everything (another audio track, another film). */
  clear(): void {
    this.stretches.length = 0;
    this.words = [];
    this.heard = [];
    this.active = undefined;
    this.vad.reset();
  }

  /** The stretch that has `time` in it (or ends within a second before it); none when the sound there is not known. */
  stretchAt(time: number): Range | undefined {
    const spans = this.stretches.map((s) => ({ from: s.from, to: this.endOf(s) }));
    return spans.find((s) => time >= s.from - 1 && time <= s.to + 1);
  }

  /** Speech probability every 10 ms from `from` for `count` values, the way the aligner wants it. Zero where no audio is known. */
  probability(from: number, count: number): Float32Array {
    const out = new Float32Array(count);
    const stretch = this.stretches.find((s) => from >= s.from - 1e-6 && from < this.endOf(s) + 1e-6) ?? this.stretches.find((s) => s.from > from && s.from < from + count * 0.01);
    if (!stretch || stretch.steps.length === 0) return out;
    const last = stretch.steps.length - 1;
    const first = Math.round((from - stretch.from) / 0.01); // the stretch's 10 ms grid index of the window's first value
    for (let i = 0; i < count; i++) {
      const x = ((first + i) * 0.01) / STEP_SECONDS - 0.5;
      if (x < -1 || x > last + 1) continue;
      const a = Math.max(0, Math.min(last, Math.floor(x)));
      const z = Math.min(last, a + 1);
      const f = Math.max(0, x - a);
      out[i] = (stretch.steps[a] as number) * (1 - f) + (stretch.steps[z] as number) * f;
    }
    return out;
  }

  /** The words heard from `from` to `to`, and how much of that time the recogniser actually listened to. */
  wordsIn(from: number, to: number): { words: Word[]; heardSeconds: number; ranges: Range[] } {
    const ranges: Range[] = [];
    let heardSeconds = 0;
    for (const range of this.heard) {
      const a = Math.max(from, range.from);
      const b = Math.min(to, range.to);
      if (b > a) {
        ranges.push({ from: a, to: b });
        heardSeconds += b - a;
      }
    }
    return { words: this.words.filter((w) => w.start >= from && w.start < to), heardSeconds, ranges };
  }

  get wordCount(): number {
    return this.words.length;
  }
}

/** Overlapping or touching ranges joined, in order. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to + 0.001) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}
