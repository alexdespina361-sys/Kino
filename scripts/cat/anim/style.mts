// What makes a donor's motion a cat's, beyond which bone follows which (retarget.mts). A fox's back, neck and tail move by what a fox's do, and the cat the donor is put on has much
// shorter legs and a body that is all fur: what the fox does with its back and its hips is lost under it. So the clip is given more of what carries a body along (the hips' rise and
// fall, the turns of the back, the neck and the head, the swing of the tail), by one factor for each of them, the same for every clip a donor gave, and a carriage (where the head
// and the tail are held) where the animal's own is not the cat's. Nothing here is keyed: a clip is what the donor did, by the factors in a table.
import { Pose, globals, turnAbout, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import { quatOfMatrix, slerp, type Quat } from "./retarget.mts";

export interface Style {
  /** How far each bone's turn goes from its mean over the clip (the bone's name, and a factor: 1 is as the donor had it). */
  amplify?: Readonly<Record<string, number>>;
  /** How far the hips' place goes from its mean along each axis (x forward, y up, z across): 1 is as the donor had it. */
  hips?: readonly [number, number, number];
  /** A turn added to a bone for the whole clip, about the cat's own axes, in radians (pitch about z: nose up positive; yaw about y; roll about x). */
  carry?: Readonly<Record<string, { pitch?: number; yaw?: number; roll?: number }>>;
  /** How much of the donor's crouch the cat keeps: the hips' mean height above the cat's own standing height is scaled by this (1 is as the donor had it, 0.5 half as low). */
  lower?: number;
}

const dot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** The mean of a clip's turns of a bone (the turns taken to one side of each other, summed and made a turn again). */
function meanTurn(r: ArrayLike<number>, frames: number): Quat {
  const first: Quat = [r[0]!, r[1]!, r[2]!, r[3]!];
  const sum = [0, 0, 0, 0];
  for (let f = 0; f < frames; f++) {
    const q: Quat = [r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!];
    const s = dot(q, first) < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) sum[k]! += s * q[k]!;
  }
  const l = Math.hypot(sum[0]!, sum[1]!, sum[2]!, sum[3]!) || 1;
  return [sum[0]! / l, sum[1]! / l, sum[2]! / l, sum[3]! / l];
}

/** The clip with the style laid on it: `source` as it is returned by the retargeting, `skeleton` the cat's. */
export function styled(skeleton: Skeleton, source: ClipSource, style: Style): ClipSource {
  const frames = source.frames;
  const r = source.r.slice();
  const t = source.t.slice();
  for (const [name, factor] of Object.entries(style.amplify ?? {})) {
    if (!skeleton.has(name) || factor === 1) continue;
    const j = skeleton.bone(name);
    const own = r[j];
    if (!own) continue;
    const mean = meanTurn(own, frames);
    const out = new Float64Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      let q: Quat = [own[f * 4]!, own[f * 4 + 1]!, own[f * 4 + 2]!, own[f * 4 + 3]!];
      if (dot(q, mean) < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      const a = slerp(mean, q, factor);
      out.set(a, f * 4);
    }
    r[j] = out;
  }
  if (style.hips) {
    const hips = skeleton.bone("Hips");
    const own = t[hips];
    if (own) {
      const out = new Float64Array(frames * 3);
      for (let k = 0; k < 3; k++) {
        let mean = 0;
        for (let f = 0; f < frames; f++) mean += own[f * 3 + k]!;
        mean /= frames;
        for (let f = 0; f < frames; f++) out[f * 3 + k] = mean + style.hips[k]! * (own[f * 3 + k]! - mean);
      }
      t[hips] = out;
    }
  }
  if (style.lower !== undefined && style.lower !== 1) {
    const hips = skeleton.bone("Hips");
    const own = t[hips];
    if (own) {
      let mean = 0;
      for (let f = 0; f < frames; f++) mean += own[f * 3 + 1]!;
      mean /= frames;
      const stand = skeleton.restT[hips * 3 + 1]!;
      const shift = stand + style.lower * (mean - stand) - mean;
      const out = Float64Array.from(own);
      for (let f = 0; f < frames; f++) out[f * 3 + 1] = own[f * 3 + 1]! + shift;
      t[hips] = out;
    }
  }
  if (style.carry) {
    // (a turn about the cat's axes, put on a bone against its parent: in the parent's own axes at rest, d = P^T A P)
    const R = new Float64Array(48 * 9);
    const T = new Float64Array(48 * 3);
    globals(skeleton, new Pose(skeleton), undefined, R, T);
    for (const [name, c] of Object.entries(style.carry)) {
      if (!skeleton.has(name)) continue;
      const j = skeleton.bone(name);
      const parent = skeleton.parent[j]!;
      const own = r[j];
      const out = new Float64Array(frames * 4);
      for (let f = 0; f < frames; f++) {
        const q: Quat = own ? [own[f * 4]!, own[f * 4 + 1]!, own[f * 4 + 2]!, own[f * 4 + 3]!] : [skeleton.restR[j * 4]!, skeleton.restR[j * 4 + 1]!, skeleton.restR[j * 4 + 2]!, skeleton.restR[j * 4 + 3]!];
        // the world turn, the way the Adjust of the renderer makes one: roll about x, then yaw about y, then pitch about z, all of them after the bone's own
        let w: Quat = [0, 0, 0, 1];
        if (c.roll) w = mulQ(turnAbout(1, 0, 0, c.roll), w);
        if (c.yaw) w = mulQ(turnAbout(0, 1, 0, c.yaw), w);
        if (c.pitch) w = mulQ(turnAbout(0, 0, 1, c.pitch), w);
        const P = parent >= 0 ? quatOfMatrix(R, parent * 9) : ([0, 0, 0, 1] as Quat);
        const d = mulQ(mulQ(conj(P), w), P);
        out.set(mulQ(d, q), f * 4);
      }
      r[j] = out;
    }
  }
  return { ...source, r, t };
}

const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The turn `b` after the turn `a` (b x a). */
function mulQ(b: Quat, a: Quat): Quat {
  return [
    b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1],
    b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0],
    b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3],
    b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2],
  ];
}
