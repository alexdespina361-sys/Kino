// Moving the cat's bones the way another model's bones move (a donor: donor.mts), by what each does in the world, not by the numbers in its joints.
//
// For a donor bone, the turn it makes from its rest to a moment is D = W(t) W(rest)^-1: the turn of the bone in the donor's world. A bone of the cat that follows it does the same
// turn in the cat's world (the donor's axes taken to the cat's by `A`, so that the nose is forward and up is up) after the cat's own rest: W'(t) = A D A^-1 W'(rest). The turn
// of every bone against its parent is then found from those (a bone that follows nothing goes with its parent as it was at rest), so that what a leg or a head is seen to do is
// what the donor's did, whichever way the two skeletons are built inside. The hips' place is the donor's, scaled by how much lower to the ground the cat's hips are.
import { matrixOf, Pose, globals, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { Donor } from "./donor.mts";

export type Quat = [number, number, number, number];

export const mul3 = (a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0): number[] => {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c]! += a[ao + r * 3 + k]! * b[bo + k * 3 + c]!;
  return o;
};
export const tr3 = (a: ArrayLike<number>, ao = 0): number[] => [a[ao]!, a[ao + 3]!, a[ao + 6]!, a[ao + 1]!, a[ao + 4]!, a[ao + 7]!, a[ao + 2]!, a[ao + 5]!, a[ao + 8]!];

/** The turn (x y z w) of a rotation matrix (row after row). */
export function quatOfMatrix(m: ArrayLike<number>, o = 0): Quat {
  const m00 = m[o]!, m01 = m[o + 1]!, m02 = m[o + 2]!, m10 = m[o + 3]!, m11 = m[o + 4]!, m12 = m[o + 5]!, m20 = m[o + 6]!, m21 = m[o + 7]!, m22 = m[o + 8]!;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export const matOf = (q: Quat): number[] => {
  const out = new Array<number>(9);
  matrixOf(out, q[0], q[1], q[2], q[3]);
  return out;
};

/** A turn made `u` of the way from `a` to `b` (the short way round; a `u` past 1 goes on beyond `b`). */
export function slerp(a: Quat, b: Quat, u: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sg = d < 0 ? -1 : 1;
  d *= sg;
  if (d > 0.9995) {
    const o = [0, 1, 2, 3].map((i) => a[i]! + (sg * b[i]! - a[i]!) * u);
    const l = Math.hypot(...o);
    return [o[0]! / l, o[1]! / l, o[2]! / l, o[3]! / l];
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th);
  const sb = (Math.sin(u * th) / Math.sin(th)) * sg;
  return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb, a[3] * sa + b[3] * sb];
}

/** A bone of the cat and what it follows: a donor bone, or a point between two of them along the chain they make (0 is the first, 1 the second). */
export interface Link {
  bone: string;
  follows: string | { from: string; to: string; at: number };
}

export interface RetargetOptions {
  name: string;
  /** The clip's frames a second, and the frames in it (a loop is `frames` frames, the one after the last being the first). */
  fps: number;
  frames: number;
  loop: boolean;
  /** The seconds of the donor's animation the first frame is at, and the seconds between frames (default 1 / fps). */
  from?: number;
  step?: number;
  /** The cat's hips, and the donor's, and how far the donor's hips travel is scaled for the cat (the cat's hip height over the donor's, as a rule). */
  hips: { bone: string; follows: string };
  hipsScale: number;
  /** Two donor bones, the one at the back and the one at the front of the animal, to tell which way it faces. */
  facing: { back: string; front: string };
  /** The animation of the donor to take. */
  animation: number;
}

/** The number of a donor's bone by its name. */
export function donorBoneOf(donor: Donor, name: string): number {
  const i = donor.names.indexOf(name);
  if (i < 0) throw new Error(`the donor has no bone ${name} (it has ${donor.names.join(", ")})`);
  return i;
}

/** The turn `A` (a matrix, row after row) about the vertical that makes the donor's nose point along +x, the cat's way, taking the donor's axes to the cat's. */
export function alignment(donor: Donor, facing: { back: string; front: string }): number[] {
  const rest = donor.at(null, 0);
  const back = donorBoneOf(donor, facing.back);
  const front = donorBoneOf(donor, facing.front);
  const fx = rest.P[front * 3]! - rest.P[back * 3]!;
  const fz = rest.P[front * 3 + 2]! - rest.P[back * 3 + 2]!;
  let heading = Math.atan2(fz, fx); // (the angle of the nose's line from +x, turning toward +z)
  // (a model is made along an axis; the little way its head is off the line of its back is not a turn of the whole animal)
  const quarter = Math.round(heading / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(heading - quarter) < (3 * Math.PI) / 180) heading = quarter;
  // a turn about +y by `heading` takes +x to (cos h, 0, -sin h); the donor's nose at angle h toward +z is brought to +x by turning about +y by h
  const cs = Math.cos(heading);
  const sn = Math.sin(heading);
  return [cs, 0, sn, 0, 1, 0, -sn, 0, cs];
}

export function retarget(donor: Donor, cat: Skeleton, links: readonly Link[], o: RetargetOptions): ClipSource {
  const n = cat.count;
  const donorBone = (name: string): number => donorBoneOf(donor, name);
  // the donor's rest, and the turn `A` about the vertical that makes its nose point along +x (the cat's way)
  const rest = donor.at(null, 0);
  const A = alignment(donor, o.facing);
  const At = tr3(A);
  // the cat's rest
  const restPose = new Pose(cat);
  const WR0 = new Float64Array(n * 9);
  const WT0 = new Float64Array(n * 3);
  globals(cat, restPose, undefined, WR0, WT0);
  const linkOf = new Map<number, Link>();
  for (const l of links) linkOf.set(cat.bone(l.bone), l);
  const hipsBone = cat.bone(o.hips.bone);
  const hipsDonor = donorBone(o.hips.follows);
  const sources = (l: Link): { a: number; b: number; at: number } => (typeof l.follows === "string" ? { a: donorBone(l.follows), b: donorBone(l.follows), at: 0 } : { a: donorBone(l.follows.from), b: donorBone(l.follows.to), at: l.follows.at });

  const r: Float64Array[] = Array.from({ length: n }, () => new Float64Array(o.frames * 4));
  const hipsPlace = new Float64Array(o.frames * 3);
  const step = o.step ?? 1 / o.fps;
  const from = o.from ?? 0;
  const D = new Array<number[]>(donor.names.length);
  const Wd = new Array<number[]>(n);
  for (let f = 0; f < o.frames; f++) {
    const now = donor.at(o.animation, from + f * step);
    // (the turn of each donor bone in the cat's axes: D = A (W(t) W(rest)^T) A^T)
    for (let i = 0; i < donor.names.length; i++) {
      const t = mul3(now.R, tr3(rest.R, i * 9), i * 9, 0);
      D[i] = mul3(mul3(A, t), At);
    }
    for (let j = 0; j < n; j++) {
      const link = linkOf.get(j);
      const parent = cat.parent[j]!;
      let W: number[];
      if (link) {
        const s = sources(link);
        let delta: number[];
        if (s.a === s.b || s.at <= 0) delta = D[s.a]!;
        else delta = matOf(slerp(quatOfMatrix(D[s.a]!), quatOfMatrix(D[s.b]!), s.at));
        W = mul3(delta, WR0, 0, j * 9);
      } else if (parent >= 0) {
        // (it goes with its parent as it was at rest)
        W = mul3(Wd[parent]!, mul3(tr3(WR0, parent * 9), WR0, 0, j * 9));
      } else W = Array.from(WR0.subarray(j * 9, j * 9 + 9));
      Wd[j] = W;
      const local = parent >= 0 ? mul3(tr3(Wd[parent]!), W) : W;
      r[j]!.set(quatOfMatrix(local), f * 4);
    }
    // the hips' place: where the donor's hips have gone from where they were, scaled, in the cat's axes, on the cat's own
    const dx = now.P[hipsDonor * 3]! - rest.P[hipsDonor * 3]!;
    const dy = now.P[hipsDonor * 3 + 1]! - rest.P[hipsDonor * 3 + 1]!;
    const dz = now.P[hipsDonor * 3 + 2]! - rest.P[hipsDonor * 3 + 2]!;
    hipsPlace[f * 3] = cat.restT[hipsBone * 3]! + o.hipsScale * (A[0]! * dx + A[1]! * dy + A[2]! * dz);
    hipsPlace[f * 3 + 1] = cat.restT[hipsBone * 3 + 1]! + o.hipsScale * (A[3]! * dx + A[4]! * dy + A[5]! * dz);
    hipsPlace[f * 3 + 2] = cat.restT[hipsBone * 3 + 2]! + o.hipsScale * (A[6]! * dx + A[7]! * dy + A[8]! * dz);
  }
  // (a bone that follows nothing keeps its rest against its parent: no numbers for it)
  const clipR: ClipSource["r"] = r.map((a, j) => (linkOf.has(j) || cat.parent[j]! < 0 ? a : null));
  const clipT: ClipSource["t"] = Array.from({ length: n }, (_, j) => (j === hipsBone ? hipsPlace : null));
  return { name: o.name, fps: o.fps, frames: o.frames, loop: o.loop, r: clipR, t: clipT };
}
