// A clip kept at fewer frames a second where the player's own interpolation gives the same motion: a cat that holds a paw out for six seconds does not need thirty pictures of each of
// them. The player (pose.ts: sampleFrame) turns each bone along the short way between two frames and moves places in a straight line, so this keeps every k-th frame (k as large as
// the clip allows) and tells the player to go k times as slowly through them, and a clip is only thinned as far as the poses that the player makes from what is kept are within the
// tolerance of the poses it was made with, for every bone at every one of the original frames.
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";

export interface Tolerance {
  /** The most a bone's turn may differ from what it was (radians). */
  turn: number;
  /** The most a bone's place may differ from what it was (body lengths). */
  place: number;
}

/** Half a degree is below what can be seen on a bone of a cat that is a few hundred pixels long; a place is a thousandth of the body. */
export const TOLERANCE: Tolerance = { turn: (0.5 * Math.PI) / 180, place: 0.001 };

/** The most frames that are left out between two that are kept (a clip below five frames a second would be played as a slide show). */
const MOST = 10;

const quat = (r: ArrayLike<number>, f: number): [number, number, number, number] => [r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!];

/** How far apart two turns are, as the angle between them (radians). */
function between(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0]!, a[1]!, a[2]!, a[3]!) || 1;
  const lb = Math.hypot(b[0]!, b[1]!, b[2]!, b[3]!) || 1;
  const d = Math.abs((a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!) / (la * lb));
  return 2 * Math.acos(Math.min(1, d));
}

/** The turn that the player makes of the frames `a` and `b` of a bone, `u` of the way from the first (pose.ts: sampleFrame). */
function turned(a: readonly number[], b: readonly number[], u: number): number[] {
  const s = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]! < 0 ? -1 : 1;
  const out = a.map((v, k) => v + (s * b[k]! - v) * u);
  const l = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!) || 1;
  return out.map((v) => v / l);
}

/** The frames that are kept when every `k`-th is: the clip's own (a clip that is played once keeps its last, and a loop is gone round without it: its first follows it). */
function kept(frames: number, loop: boolean, k: number): number[] | null {
  if (loop ? frames % k !== 0 : (frames - 1) % k !== 0) return null;
  const n = loop ? frames / k : (frames - 1) / k + 1;
  return Array.from({ length: n }, (_, i) => i * k);
}

/** The worst a bone is from what it was, in turn and in place, when `source` is played from the frames that `keep` names. */
function worst(source: ClipSource, keep: readonly number[], k: number): { turn: number; place: number } {
  const n = keep.length;
  let turn = 0;
  let place = 0;
  for (let f = 0; f < source.frames; f++) {
    const p = f / k;
    let i0 = Math.floor(p);
    const u = p - i0;
    let i1 = i0 + 1;
    if (source.loop) i1 %= n;
    else {
      i0 = Math.min(i0, n - 1);
      i1 = Math.min(i1, n - 1);
    }
    for (const r of source.r) {
      if (!r) continue;
      const a = quat(r, keep[i0]!);
      const b = quat(r, keep[i1]!);
      turn = Math.max(turn, between(turned(a, b, u), quat(r, f)));
    }
    for (const t of source.t) {
      if (!t) continue;
      for (let c = 0; c < 3; c++) {
        const a = t[keep[i0]! * 3 + c]!;
        const b = t[keep[i1]! * 3 + c]!;
        place = Math.max(place, Math.abs(a + (b - a) * u - t[f * 3 + c]!));
      }
    }
  }
  return { turn, place };
}

/** `source` at the fewest frames that keep it within `tolerance` (the same clip if it cannot be thinned). `by` is how many frames of the original each kept one stands for. */
export function thin(source: ClipSource, tolerance: Tolerance = TOLERANCE): { source: ClipSource; by: number } {
  for (let k = MOST; k >= 2; k--) {
    const keep = kept(source.frames, source.loop, k);
    if (!keep || keep.length < 3) continue;
    const w = worst(source, keep, k);
    if (w.turn > tolerance.turn || w.place > tolerance.place) continue;
    const pick = <T extends ArrayLike<number>>(a: T | null, size: number): number[] | null => (a ? keep.flatMap((f) => Array.from({ length: size }, (_, c) => a[f * size + c]!)) : null);
    return {
      source: { ...source, fps: source.fps / k, frames: keep.length, r: source.r.map((r) => pick(r, 4)), t: source.t.map((t) => pick(t, 3)) },
      by: k,
    };
  }
  return { source, by: 1 };
}
