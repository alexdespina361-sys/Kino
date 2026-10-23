// The jitter of a bone that was solved one frame at a time, taken out. A leg that is reached to a place for each frame of a clip separately (posegen.mts) finds its joints a little differently
// each time where the paw is free (nothing holds the paw's bones but the joints' limits and the floor), and the paw is seen to flick: a bone's turn that leaves the line between the
// frames next to it by thirty degrees for one picture. Here each frame of a bone that leaves that line by more than the bone may is brought half way back to it, over and over, until none
// does; the frames that are on their line are not touched, so what a clip does on purpose (a strike, a push) is kept as far as `limit` says it may be sudden.
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";

/** The bones that are smoothed (a leg and what hangs from it). */
export const LEG = /leg/;

const quat = (a: Float64Array, f: number): [number, number, number, number] => [a[f * 4]!, a[f * 4 + 1]!, a[f * 4 + 2]!, a[f * 4 + 3]!];

/** The turns of a bone, unit length, neighbouring ones facing the same way (and a loop's last with its first). */
function aligned(src: ArrayLike<number>, frames: number): Float64Array {
  const out = new Float64Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    const l = Math.hypot(src[f * 4]!, src[f * 4 + 1]!, src[f * 4 + 2]!, src[f * 4 + 3]!) || 1;
    for (let k = 0; k < 4; k++) out[f * 4 + k] = src[f * 4 + k]! / l;
    if (f > 0 && out[f * 4]! * out[(f - 1) * 4]! + out[f * 4 + 1]! * out[(f - 1) * 4 + 1]! + out[f * 4 + 2]! * out[(f - 1) * 4 + 2]! + out[f * 4 + 3]! * out[(f - 1) * 4 + 3]! < 0) {
      for (let k = 0; k < 4; k++) out[f * 4 + k] = -out[f * 4 + k]!;
    }
  }
  return out;
}

/** The turn half way between `a` and `b` (the short way round). */
function middle(a: readonly number[], b: readonly number[]): number[] {
  const s = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]! < 0 ? -1 : 1;
  const m = a.map((v, k) => v + s * b[k]!);
  const l = Math.hypot(m[0]!, m[1]!, m[2]!, m[3]!) || 1;
  return m.map((v) => v / l);
}

/** The angle between two unit turns (radians). */
function apart(a: readonly number[], b: readonly number[]): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!)));
}

/** How far a bone's turn is from the line between the frames next to it, at the worst frame (radians), and the frame. */
export function pop(track: Float64Array, frames: number, loop: boolean): { angle: number; at: number } {
  let angle = 0;
  let at = 0;
  for (let f = loop ? 0 : 1; f < (loop ? frames : frames - 1); f++) {
    const a = quat(track, (f + frames - 1) % frames);
    const b = quat(track, (f + 1) % frames);
    const d = apart(quat(track, f), middle(a, b));
    if (d > angle) {
      angle = d;
      at = f;
    }
  }
  return { angle, at };
}

/**
 * `source` with the turns of the bones that `which` names (by index) kept within `limit` (radians) of the line between their neighbours: every frame that is further is brought half
 * way to it, all at once, until none is (or `rounds` are gone through). A clip played once keeps its first and last frames.
 */
export function smoothed(source: ClipSource, which: (bone: number) => boolean, limit: number, rounds = 200): ClipSource {
  const n = source.frames;
  const r = source.r.map((src, j) => {
    if (!src || !which(j) || n < 3) return src;
    const track = aligned(src, n);
    for (let round = 0; round < rounds; round++) {
      const next = Float64Array.from(track);
      let moved = false;
      for (let f = source.loop ? 0 : 1; f < (source.loop ? n : n - 1); f++) {
        const q = quat(track, f);
        const m = middle(quat(track, (f + n - 1) % n), quat(track, (f + 1) % n));
        if (apart(q, m) <= limit) continue;
        const h = middle(q, m);
        for (let k = 0; k < 4; k++) next[f * 4 + k] = h[k]!;
        moved = true;
      }
      track.set(next);
      if (!moved) break;
    }
    return Array.from(track);
  });
  return { ...source, r };
}
