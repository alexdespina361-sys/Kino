// Planting a pose on the floor by its contacts. A retargeted pose of a cat that stands or sits puts its paws where the donor's were, scaled, and a cat with short legs and a deep
// chest does not reach the floor where the donor's paws rested: a front paw hovers over it (a sitting cat's forepaws, in the first sheets, were a hand's breadth up). The whole cat is
// turned about its hips and lifted, frame by frame, by the turn and the lift that bring every contact (the paws that are down, and the part of the body that sits on the floor)
// to the floor together, in the least-squares way `groundGait` does for the paws of a walk, and then kept on the floor as the policy of the clip says.
import { after, turnAbout, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { heights } from "./floor.mts";
import { analyseGait, restPads, soleVertices, PAWS } from "./gait.mts";
import { played } from "./ground.mts";

export interface Planted {
  source: ClipSource;
  /** The most any contact was off the floor, before and after (body lengths). */
  before: number;
  after: number;
}

/** Where the part of the body that sits on the floor is, ahead of the hips (body lengths; the haunch of a sitting cat is behind them). */
const SEAT_AHEAD = -0.17;

/**
 * `source` with its hips turned and lifted, frame by frame, so that the paws named (their names in `gait.mts`'s `PAWS`) and, if `seat` is true, the lowest part of the body are
 * on the floor together. `blend` is how far to go (1: all the way).
 */
export function plantPaws(mesh: CatMesh, skeleton: Skeleton, source: ClipSource, which: readonly string[], seat: boolean, blend = 1): Planted {
  const data = mesh.skeleton;
  const soles = soleVertices(mesh, skeleton);
  const floors = restPads(mesh, skeleton, soles).map((p) => p[3]);
  const pawIdx = which.map((n) => PAWS.findIndex((p) => p.name === n));
  if (pawIdx.some((i) => i < 0)) throw new Error(`no paw in ${which.join(", ")} (they are ${PAWS.map((p) => p.name).join(", ")})`);
  const hips = skeleton.bone("Hips");
  const frames = source.frames;
  const r = new Float64Array(frames * 4);
  const t = new Float64Array(frames * 3);
  const rSrc = source.r[hips];
  const tSrc = source.t[hips];
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 4; k++) r[f * 4 + k] = rSrc ? rSrc[f * 4 + k]! : skeleton.restR[hips * 4 + k]!;
    for (let k = 0; k < 3; k++) t[f * 3 + k] = tSrc ? tSrc[f * 3 + k]! : skeleton.restT[hips * 3 + k]!;
  }
  const current = (): ClipSource => {
    const rr = source.r.slice();
    const tt = source.t.slice();
    rr[hips] = r;
    tt[hips] = t;
    return { ...source, r: rr, t: tt };
  };
  const off = (): number => {
    const gait = analyseGait(mesh, skeleton, played(data, skeleton, current()), soles);
    let worst = 0;
    for (const k of pawIdx) for (let f = 0; f < frames; f++) worst = Math.max(worst, Math.abs(gait.paws[k]!.low[f]! - floors[k]!));
    return worst;
  };
  const before = off();
  for (let pass = 0; pass < 3; pass++) {
    const now = current();
    const gait = analyseGait(mesh, skeleton, played(data, skeleton, now), soles);
    const raise = seat ? heights(mesh, skeleton, now) : [];
    const lift = new Float64Array(frames);
    const turn = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      // the contacts of this frame: how far each is above the floor, and how far ahead of the hips (e + c + x a = 0 for a lift c and a turn a)
      const e: number[] = [];
      const x: number[] = [];
      for (const k of pawIdx) {
        e.push(gait.paws[k]!.low[f]! - floors[k]!);
        x.push(gait.paws[k]!.x[f]!);
      }
      if (seat) {
        e.push(-raise[f]!);
        x.push(SEAT_AHEAD);
      }
      const n = e.length;
      let sx = 0, sxx = 0, sy = 0, sxy = 0;
      for (let i = 0; i < n; i++) {
        sx += x[i]!;
        sxx += x[i]! * x[i]!;
        sy += e[i]!;
        sxy += e[i]! * x[i]!;
      }
      const det = n * sxx - sx * sx;
      if (n < 2 || Math.abs(det) < 1e-6) {
        lift[f] = -sy / Math.max(1, n);
        continue;
      }
      lift[f] = -(sxx * sy - sx * sxy) / det;
      turn[f] = -(n * sxy - sx * sy) / det;
    }
    // (a turn is smoothed over three frames, so that a paw that is lifted a moment does not make the hips shiver)
    const smooth = (a: Float64Array): Float64Array => {
      const o = new Float64Array(frames);
      for (let f = 0; f < frames; f++) {
        const p = source.loop ? (f + frames - 1) % frames : Math.max(0, f - 1);
        const q = source.loop ? (f + 1) % frames : Math.min(frames - 1, f + 1);
        o[f] = 0.25 * a[p]! + 0.5 * a[f]! + 0.25 * a[q]!;
      }
      return o;
    };
    const dl = smooth(lift);
    const dt = smooth(turn);
    for (let f = 0; f < frames; f++) {
      const q = after([r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!], turnAbout(0, 0, 1, dt[f]! * blend));
      for (let k = 0; k < 4; k++) r[f * 4 + k] = q[k]!;
      t[f * 3 + 1] = t[f * 3 + 1]! + dl[f]! * blend;
    }
  }
  const out = current();
  return { source: out, before, after: off() };
}
