import { SharedTimingSchema, SUBSYNC_MAX_LINES, SUBSYNC_MAX_MOVE, type SharedPlacement, type SharedTiming } from "../../shared";
import { ASSET_VERSION } from "./assets";
import type { Cue } from "./cues";
import type { Range } from "./signals";
import { VERSION } from "./vendor/subtitle-sync.js";

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

const CUT_BUCKET = 1;

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

export const AGREE_WITHIN = 4;
export const AGREE_SHARE = 0.6;
export const MIN_COMMON = 8;
export const GOOD_STRETCHES = 2;
export const BAD_STRETCHES = 3;
const STRETCH_GAP = 30;
const COMPLETE_SHARE = 0.9;

export interface Placed {
  start: number;
  end: number;
  words: boolean;
}

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

  complete(): boolean {
    return this.lines.size >= COMPLETE_SHARE * this.cues.length;
  }

  ranges(): Range[] {
    const out: Range[] = [];
    for (const line of [...this.lines.values()].sort((a, b) => a.start - b.start)) {
      const last = out[out.length - 1];
      if (last && line.start - last.to <= STRETCH_GAP) last.to = Math.max(last.to, line.end);
      else out.push({ from: line.start, to: line.end });
    }
    return out;
  }

  shift(): number {
    const moves = [...this.lines].map(([index, line]) => line.start - (this.cues[index]?.start ?? line.start)).sort((a, b) => a - b);
    return moves[moves.length >> 1] ?? 0;
  }

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

export class Lent {
  private readonly noted = new Map<number, SharedPlacement>();
  private readonly told = new Map<number, string>();

  note(index: number, cue: Cue, start: number, end: number, words: boolean): void {
    const startMoved = Math.round((start - cue.start) * 100);
    const endMoved = Math.round((end - cue.end) * 100);
    const limit = SUBSYNC_MAX_MOVE * 100;
    if (Math.abs(startMoved) > limit || Math.abs(endMoved) > limit || index < 0 || index >= SUBSYNC_MAX_LINES) {
      this.noted.delete(index);
      return;
    }
    const before = this.noted.get(index);
    if (before && before[3] === 1 && !words) return;
    this.noted.set(index, [index, startMoved, endMoved, words ? 1 : 0]);
  }

  drop(index: number): void {
    this.noted.delete(index);
  }

  pending(): number {
    let count = 0;
    for (const placement of this.noted.values()) if (this.told.get(placement[0]) !== key(placement)) count++;
    return count;
  }

  take(lines: number, limit = SUBSYNC_MAX_LINES): SharedTiming | undefined {
    const placed = [...this.noted.values()].filter((placement) => placement[0] < lines && this.told.get(placement[0]) !== key(placement)).sort((a, b) => a[0] - b[0]);
    return placed.length > 0 ? { v: 1, lines, placed: placed.slice(0, limit) } : undefined;
  }

  confirm(timing: SharedTiming): void {
    for (const placement of timing.placed) this.told.set(placement[0], key(placement));
  }
}

const key = (placement: SharedPlacement): string => placement.join(",");

export type Sent = "taken" | "refused" | "failed";

export interface Shared {
  get(key: string): Promise<SharedTiming | undefined>;
  put(key: string, timing: SharedTiming, keepalive?: boolean): Promise<Sent>;
}

const ASK_MS = 4000;

export function httpShared(base = ""): Shared {
  return {
    async get(name) {
      const control = new AbortController();
      const timer = setTimeout(() => control.abort(), ASK_MS);
      try {
        const response = await fetch(`${base}/api/subsync/${name}`, { signal: control.signal });
        if (response.status !== 200) return undefined;
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
        return response.status === 400 || response.status === 409 || response.status === 413 ? "refused" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}
