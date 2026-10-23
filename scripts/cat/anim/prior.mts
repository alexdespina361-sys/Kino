// How an animal's joints turn, learned from animals that move. A leg's bone is a hinge (the elbow, the wrist) or nearly one (the shoulder swings far in one plane and hardly out of it):
// over all the frames of the donors' clips its turn from rest lies along one axis and hardly off it. A solver that is told only where a paw is to be finds, among the many ways a
// leg can reach there, some that no leg does (a shoulder swung half a turn about the vertical, a forearm twisted): the paw is where it was told and the skin between the two
// shoulders is torn. This is what the donors say of each bone, as a cost for the solver (ik.mts, `Prior`): free along the axis it turns about, dear for the others.
import { Pose, sampleFrame, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { Prior, Vec3 } from "./ik.mts";

type Quat = [number, number, number, number];
const mul = (a: Quat, b: Quat): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const conj = (a: Quat): Quat => [-a[0], -a[1], -a[2], a[3]];

/** The turn of a bone from its rest (in its parent's frame) as a rotation vector: exp(tau) times the rest turn is the bone's turn. */
export function turnFromRest(skeleton: Skeleton, pose: Pose, j: number): Vec3 {
  const local: Quat = [pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!];
  const rest: Quat = [skeleton.restR[j * 4]!, skeleton.restR[j * 4 + 1]!, skeleton.restR[j * 4 + 2]!, skeleton.restR[j * 4 + 3]!];
  let d = mul(local, conj(rest));
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9) return [0, 0, 0];
  const a = (2 * Math.atan2(s, d[3])) / s;
  return [d[0] * a, d[1] * a, d[2] * a];
}

/** Eigenvalues and (unit) eigenvectors of a symmetric 3 by 3 matrix (Jacobi's turns), the largest first. */
export function eigen(m: number[][]): { values: number[]; vectors: Vec3[] } {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      off += Math.abs(a[p]![q]!);
      if (Math.abs(a[p]![q]!) < 1e-15) continue;
      const th = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!;
        const akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!;
        const aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!;
        const vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
    if (off < 1e-14) break;
  }
  const order = [0, 1, 2].sort((x, y) => a[y]![y]! - a[x]![x]!);
  return { values: order.map((i) => a[i]![i]!), vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!] as Vec3) };
}

const rad = (d: number): number => (d * Math.PI) / 180;

/**
 * The prior of each of the named bones, from every frame of the clips. How far a turn may be from the mean, along each of the three principal axes, before it costs as much as a
 * marker out of place: along the main axis `3 sigma` (and not under 60 degrees: the donors walk and run, and the acts bow and lie, which go further than a trot does), along the
 * other two `1.5 sigma` (and not under 12 and 8 degrees: a bone that never twisted in the donors is not told it cannot twist at all).
 */
export function learnPriors(skeleton: Skeleton, clips: Iterable<Clip>, bones: readonly string[]): Map<number, Prior> {
  const out = new Map<number, Prior>();
  const pose = new Pose(skeleton);
  const all = [...clips];
  for (const name of bones) {
    const j = skeleton.bone(name);
    const samples: Vec3[] = [];
    for (const c of all) {
      for (let f = 0; f < c.frames; f++) {
        sampleFrame(c, f, pose);
        samples.push(turnFromRest(skeleton, pose, j));
      }
    }
    if (samples.length < 8) continue;
    const n = samples.length;
    const mean: Vec3 = [0, 1, 2].map((k) => samples.reduce((s, x) => s + x[k]!, 0) / n) as Vec3;
    const C = [0, 1, 2].map((p) => [0, 1, 2].map((q) => samples.reduce((s, x) => s + (x[p]! - mean[p]!) * (x[q]! - mean[q]!), 0) / n));
    const e = eigen(C);
    const sigma = e.values.map((v) => Math.sqrt(Math.max(0, v)));
    out.set(j, {
      bone: j,
      mean,
      axes: [e.vectors[0]!, e.vectors[1]!, e.vectors[2]!],
      spread: [Math.max(3 * sigma[0]!, rad(60)), Math.max(1.5 * sigma[1]!, rad(12)), Math.max(1.5 * sigma[2]!, rad(8))],
    });
  }
  return out;
}
