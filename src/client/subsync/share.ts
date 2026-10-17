import { SharedTimingSchema, SUBSYNC_MAX_LINES, SUBSYNC_MAX_MOVE, type SharedPlacement, type SharedTiming } from "../../shared";
import { ASSET_VERSION } from "./assets";
import type { Cue } from "./cues";
import type { Range } from "./signals";
import { VERSION } from "./vendor/subtitle-sync.js";

/**
 * What screens leave each other (see `shared/subsync.ts` for what is kept): the timing one screen made of a subtitle file against the sound
 * of a film, found by the next screen that plays the same file on the same cut. It is never believed on the server's word: a screen
 * uses it only once its own work, on the sound it hears, agrees with it (`Borrowed`), and leaves only what it has found right itself.
 */

/* ------------------------------------ the name of a file ------------------------------------ */

/** A 128-bit hash of a text, as 32 hex digits. Not secret and not for safety: it only has to give the same name to the same text on every screen. */
export function hash128(text: string): string {
  let a = 0x243f6a88;
  let b = 0x85a308d3;
  let c = 0x13198a2e;
  let d = 0x03707344;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    a = Math.imul(a ^ k, 0x9e3779b1);
    a ^= a >>> 15;
    b = Math.imul(b ^ k ^ a, 0x85ebca77);
    b ^= b >>> 13;
    c = Math.imul(c ^ k ^ b, 0xc2b2ae3d);
    c ^= c >>> 16;
    d = Math.imul(d ^ k ^ c, 0x27d4eb2f);
    d ^= d >>> 15;
  }
  const mix = (h: number): number => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  a ^= text.length;
  const lanes = [mix(a ^ d), mix(b ^ a), mix(c ^ b), mix(d ^ c)];
  lanes[1] = mix(lanes[1]! ^ lanes[0]!);
  lanes[2] = mix(lanes[2]! ^ lanes[1]!);
  lanes[3] = mix(lanes[3]! ^ lanes[2]!);
  lanes[0] = mix(lanes[0]! ^ lanes[3]!);
  return lanes.map((lane) => lane.toString(16).padStart(8, "0")).join("");
}

/**
 * The length of film (seconds) that cuts are told apart by. A source whose film starts a few seconds later (a logo) is a film that is a few
 * seconds longer, and needs its own timing; and a timing that is a few seconds off is what a screen cannot tell from a right one (see
 * `AGREE_WITHIN`). So the bucket is small: a timing is shared by screens whose film is the same length to about a second.
 */
const CUT_BUCKET = 1;

/**
 * The names a file's timing may be kept under: the file's lines (their times, and their words without markup), the film's length in buckets of a
 * second, the language of the sound that is played, and which aligner made it (a better one gives timings that are not mixed with the old). A
 * length can fall either side of the edge of a bucket, so the nearest other bucket is a name too (asked for when the first has nothing).
 * Nothing when the length is not known or the file is no film's subtitles.
 */
export function timingKeys(input: { duration: number; audio: string | undefined; cues: readonly Cue[] }): string[] | undefined {
  const { duration, cues } = input;
  if (!Number.isFinite(duration) || duration <= 0 || cues.length === 0 || cues.length > SUBSYNC_MAX_LINES) return undefined;
  const lines = cues.map((cue) => `${Math.round(cue.start * 100)}\t${Math.round(cue.end * 100)}\t${cue.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()}`).join("\n");
  const same = `${VERSION}|${ASSET_VERSION}|${input.audio ?? "und"}|${hash128(lines)}`;
  const position = duration / CUT_BUCKET;
  const bucket = Math.round(position);
  const near = position >= bucket ? bucket + 1 : bucket - 1;
  return [bucket, near].filter((each) => each >= 0).map((each) => hash128(`${same}|${each}`));
}

/* ------------------------------------ taking a timing ------------------------------------ */

/**
 * A line is as the timing says if this screen's own work puts it within this many seconds. What the work can say at this stage is the voice
 * detector's alone (the words come later, and are what the timing is being spared), and on real sound - music, effects - that is a second or
 * three off where the words put a line, all through a stretch (measured: a timing that was right to 0.2 s showed 1 to 4.5 s from the first
 * solves of a screen that took it; on another film a stretch of lines was 1.4 to 3.7 s early, the middle of them 2.4). What is to be caught is a
 * timing for another cut or another file, which is off by more than that, so the bar is not set tighter. A timing that is off by less than
 * this cannot be told from a right one by the voice detector, which is why a timing is shared only by screens whose film is the same length
 * (`CUT_BUCKET`).
 */
export const AGREE_WITHIN = 4;
/** A stretch of work agrees with a timing if this share of the lines it has in common do. */
export const AGREE_SHARE = 0.6;
/** Fewest lines in common that say anything. */
export const MIN_COMMON = 8;
/** How many stretches that agree make a timing believed, and how many that do not make it given up. */
export const GOOD_STRETCHES = 2;
export const BAD_STRETCHES = 3;
/** Lines closer than this (seconds) are one stretch of the picture that a timing covers. */
const STRETCH_GAP = 30;
/** A timing with this share of the file's lines placed needs no other work on the file. */
const COMPLETE_SHARE = 0.9;

export interface Placed {
  start: number;
  end: number;
  /** Placed by the recogniser's words (or timed from an English track that was), rather than by the voice detector alone. */
  words: boolean;
}

/**
 * A timing that another screen left, while this one finds out whether it is right: each solve it makes itself is compared with it
 * (`check`), and after two that agree the timing is believed, after three that do not it is let go. Until then it changes nothing.
 */
export class Borrowed {
  state: "checking" | "trusted" | "rejected" = "checking";
  private good = 0;
  private bad = 0;
  private readonly lines = new Map<number, Placed>();

  constructor(
    timing: SharedTiming,
    private readonly cues: readonly Cue[],
  ) {
    for (const [index, startMoved, endMoved, words] of timing.placed) {
      const cue = cues[index];
      if (!cue) continue;
      const start = Math.max(0, cue.start + startMoved / 100);
      this.lines.set(index, { start, end: Math.max(start + 0.05, cue.end + endMoved / 100), words: words === 1 });
    }
  }

  get size(): number {
    return this.lines.size;
  }

  at(index: number): Placed | undefined {
    return this.lines.get(index);
  }

  placed(): IterableIterator<[number, Placed]> {
    return this.lines.entries();
  }

  /** Whether the timing places so much of the file that nothing else has to be done on it. */
  complete(): boolean {
    return this.lines.size >= COMPLETE_SHARE * this.cues.length;
  }

  /** The stretches of the picture it has lines in. */
  ranges(): Range[] {
    const out: Range[] = [];
    for (const line of [...this.lines.values()].sort((a, b) => a.start - b.start)) {
      const last = out[out.length - 1];
      if (last && line.start - last.to <= STRETCH_GAP) last.to = Math.max(last.to, line.end);
      else out.push({ from: line.start, to: line.end });
    }
    return out;
  }

  /** How far the lines have moved from the file's times, typically (video time minus the file's time). */
  shift(): number {
    const moves = [...this.lines].map(([index, line]) => line.start - (this.cues[index]?.start ?? line.start)).sort((a, b) => a - b);
    return moves[moves.length >> 1] ?? 0;
  }

  /**
   * What a solve's lines (this screen's own work, at this stage the voice detector's) say about the timing: whether most of those the timing
   * has are where it has them, or `undefined` when there are too few in common to say anything. It is judged by the stretch, not a line at a
   * time: on real sound the voice detector is a second or three off the words all through a stretch, and a line or two of it are four or five
   * (measured against a timing that was right to 0.2 s: the lines of a stretch 1.4 to 3.7 s early, one of them 4.9), while the stretch of
   * another cut is far off all through.
   */
  agrees(updates: ReadonlyArray<{ index: number; start: number }>): boolean | undefined {
    let common = 0;
    let agree = 0;
    for (const update of updates) {
      const theirs = this.lines.get(update.index);
      if (!theirs) continue;
      common++;
      if (Math.abs(theirs.start - update.start) <= AGREE_WITHIN) agree++;
    }
    if (common < MIN_COMMON) return undefined;
    return agree >= AGREE_SHARE * common;
  }

  /** What this screen has just placed (a solve's lines) against what the timing says; a stretch with too few lines in common says nothing. */
  check(updates: ReadonlyArray<{ index: number; start: number }>): void {
    if (this.state !== "checking") return;
    const agrees = this.agrees(updates);
    if (agrees === undefined) return;
    if (agrees) this.good++;
    else this.bad++;
    if (this.good >= GOOD_STRETCHES) this.state = "trusted";
    else if (this.bad >= BAD_STRETCHES) this.state = "rejected";
  }
}

/* ------------------------------------ leaving a timing ------------------------------------ */

/** What this screen has placed itself, and how much of it the others have been told. */
export class Lent {
  private readonly noted = new Map<number, SharedPlacement>();
  private readonly told = new Map<number, string>();

  /** A line this screen placed, from the sound (not one it took from a timing). A line that moved further than a timing can say is not left. */
  note(index: number, cue: Cue, start: number, end: number, words: boolean): void {
    const startMoved = Math.round((start - cue.start) * 100);
    const endMoved = Math.round((end - cue.end) * 100);
    const limit = SUBSYNC_MAX_MOVE * 100;
    if (Math.abs(startMoved) > limit || Math.abs(endMoved) > limit || index < 0 || index >= SUBSYNC_MAX_LINES) {
      this.noted.delete(index);
      return;
    }
    const before = this.noted.get(index);
    // (A line placed with words stays as that: the voice detector alone would only make it worse.)
    if (before && before[3] === 1 && !words) return;
    this.noted.set(index, [index, startMoved, endMoved, words ? 1 : 0]);
  }

  /** A line that was taken from a timing after all: it is not this screen's own work, and is not left as such. */
  drop(index: number): void {
    this.noted.delete(index);
  }

  /** How many placements have not been told (or have changed since). */
  pending(): number {
    let count = 0;
    for (const placement of this.noted.values()) if (this.told.get(placement[0]) !== key(placement)) count++;
    return count;
  }

  /** The placements that have not been told, for a file of `lines` lines; at most `limit` of them (the first ones). */
  take(lines: number, limit = SUBSYNC_MAX_LINES): SharedTiming | undefined {
    const placed = [...this.noted.values()].filter((placement) => placement[0] < lines && this.told.get(placement[0]) !== key(placement)).sort((a, b) => a[0] - b[0]);
    return placed.length > 0 ? { v: 1, lines, placed: placed.slice(0, limit) } : undefined;
  }

  /** The server took these. */
  confirm(timing: SharedTiming): void {
    for (const placement of timing.placed) this.told.set(placement[0], key(placement));
  }
}

const key = (placement: SharedPlacement): string => placement.join(",");

/* ------------------------------------ the server ------------------------------------ */

/** What became of a timing that was sent: the server took it, will never take it (it is for another file than the one kept under that name, or not a timing at all), or could not for now. */
export type Sent = "taken" | "refused" | "failed";

/** The server's shared timings, as the session asks for them. Neither call throws: a timing that cannot be had or left is no matter. */
export interface Shared {
  get(key: string): Promise<SharedTiming | undefined>;
  /** `keepalive` for a page that is closing. */
  put(key: string, timing: SharedTiming, keepalive?: boolean): Promise<Sent>;
}

/** How long a timing is waited for: a screen does not hold its work for a server that is slow (a free host that is waking up takes a while). */
const ASK_MS = 4000;

export function httpShared(base = ""): Shared {
  return {
    async get(name) {
      const control = new AbortController();
      const timer = setTimeout(() => control.abort(), ASK_MS);
      try {
        const response = await fetch(`${base}/api/subsync/${name}`, { signal: control.signal });
        if (!response.ok) return undefined;
        const parsed = SharedTimingSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
    async put(name, timing, keepalive = false) {
      try {
        const response = await fetch(`${base}/api/subsync/${name}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(timing),
          keepalive,
        });
        if (response.status === 204) return "taken";
        // (Sending it again would be refused again; a server that is busy or down, or a limit, is another matter.)
        return response.status === 400 || response.status === 409 || response.status === 413 ? "refused" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}
