// Putting a limb where it is wanted. A chain of bones (a leg from the hip to the paw, a tail from its root to its tip) is turned, a few steps of least squares, so that places on it (the
// middle of a paw's sole, a joint) are at the places they are told to be, as near as they can to the turns the chain had (so that which way a knee bends is the pose it started from:
// the same solver that finishes a donor's legs in feet.mts, for a chain and a set of places given by the caller). Nothing here knows an animal: it is geometry.
import { Pose, globals, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import { matOf, mul3, quatOfMatrix } from "./retarget.mts";

export type Vec3 = [number, number, number];

/** A place on a chain's bone (`local`, in the bone's own axes) and where it is to be (`aim`, in the cat's space). */
export interface Marker {
  /** Which bone of the chain (its number in the skeleton). */
  bone: number;
  local: Vec3;
  aim: Vec3;
  /** How much it matters against the others (1 is the usual). */
  weight?: number;
  /** The place is a floor: `aim`'s height is the lowest the point may be at, and where it is across and along does not count (a point that is above it costs nothing). */
  floor?: boolean;
  /** The place is a wall: `aim`'s x (along) is the furthest forward the point may be at, and where it is up and across does not count (a point that is behind it costs nothing). */
  wall?: boolean;
  /** How much each way (along, up, across) counts, against `weight` (a place that is only wanted to be about there along the floor gives along and across a little: 1 is the usual). */
  axes?: Vec3;
}

/** How far a joint of the chain may close or open: the angle (radians) at the head of `bone` between the lines to the bone before it and to the one after it (a straight limb is pi). */
export interface Limit {
  bone: number;
  min?: number;
  max?: number;
  weight?: number;
}

/**
 * How far a bone may be turned from its rest (radians: the angle between its turn against its parent and the one it has at rest), past which a turn costs. A bone that is turned half way
 * round from its rest is where the skin goes wrong (a vertex that two bones carry, and the two a half turn apart, is blended through nothing), and a limb that has two bones turned a half
 * turn each, one way and the other, is a limb that has wound itself up and got nowhere: the cap is what makes the solver find the way that does not.
 */
export interface Cap {
  bone: number;
  max: number;
  weight?: number;
}

/**
 * How far a bone may be turned about its own long axis (`axis`, in the bone's own frame: towards its child) from its rest, which the solver is made to pay for. A limb has more turns than a
 * place for its paw needs: the turn of each bone about its own length moves no joint of the limb, and a solver that is only told where the paw is lets it drift (a forearm that has turned
 * a half turn, a shoulder that is wound up) from frame to frame, with the paw where it is wanted and the skin round the bone shearing itself flat. The swing of a bone is what puts the
 * paw at a place and is left free; its twist is what is paid for.
 */
export interface Twist {
  bone: number;
  axis: Vec3;
  /** The twist (radians) that is free, past which it is paid for (none: all of it is). */
  max?: number;
  weight?: number;
}

export interface Reached {
  /** How far each marker ended from its aim (body lengths), by marker. */
  miss: number[];
  /** The turn the chain's bones were given, on average (degrees). */
  turn: number;
}

const rodrigues = (x: number, y: number, z: number): number[] => {
  const th = Math.hypot(x, y, z);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ax = x / th;
  const ay = y / th;
  const az = z / th;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const k = 1 - c;
  return [c + ax * ax * k, ax * ay * k - az * s, ax * az * k + ay * s, ay * ax * k + az * s, c + ay * ay * k, ay * az * k - ax * s, az * ax * k - ay * s, az * ay * k + ax * s, c + az * az * k];
};

/** x such that (a) x = b, for a small square system (Gaussian elimination with the largest number of the column as the pivot). */
function solveSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]! || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const k = m[r]![c]! / d;
      if (k === 0) continue;
      for (let j = c; j <= n; j++) m[r]![j]! -= k * m[c]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let j = r + 1; j < n; j++) s -= m[r]![j]! * x[j]!;
    x[r] = s / (m[r]![r]! || 1e-12);
  }
  return x;
}

const R = new Float64Array(48 * 9);
const T = new Float64Array(48 * 3);

/**
 * The bones of `chain` (each one hangs from the one before; the first from a bone that is not in it) turned in `pose` so that the markers are at their aims. `hold` is what a radian
 * of turn away from the pose's own costs against a body length of a marker out of place, squared (a small number: the larger, the more the chain keeps the shape it had).
 */
export function reachChain(skeleton: Skeleton, pose: Pose, chain: readonly number[], markers: readonly Marker[], hold = 0.01, iterations = 30, limits: readonly Limit[] = [], caps: readonly Cap[] = [], twists: readonly Twist[] = []): Reached {
  const K = chain.length;
  const first = chain[0]!;
  const carrier = skeleton.parent[first]!;
  globals(skeleton, pose, undefined, R, T);
  const Rc = carrier >= 0 ? Array.from(R.subarray(carrier * 9, carrier * 9 + 9)) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const Tc = carrier >= 0 ? [T[carrier * 3]!, T[carrier * 3 + 1]!, T[carrier * 3 + 2]!] : [0, 0, 0];
  const local = chain.map((j) => matOf([pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!]));
  const place = chain.map((j) => [pose.t[j * 3]!, pose.t[j * 3 + 1]!, pose.t[j * 3 + 2]!]);
  const at = new Map<number, number>(chain.map((j, k) => [j, k]));
  const M = markers.length;
  for (const m of markers) if (!at.has(m.bone)) throw new Error("a marker on a bone that is not in the chain");
  const sq = Math.sqrt(hold);
  const mk = new Float64Array(M * 3);
  const joint = new Float64Array(K * 3);
  const L = limits.length;
  for (const l of limits) {
    const k = at.get(l.bone);
    if (k === undefined || k < 1 || k > K - 2) throw new Error("a limit on a bone that is not inside the chain");
  }
  const C = caps.length;
  const restLocal = caps.map((c) => {
    if (!at.has(c.bone)) throw new Error("a cap on a bone that is not in the chain");
    return matOf([skeleton.restR[c.bone * 4]!, skeleton.restR[c.bone * 4 + 1]!, skeleton.restR[c.bone * 4 + 2]!, skeleton.restR[c.bone * 4 + 3]!]);
  });
  const markersOf = (d: ArrayLike<number>, into: Float64Array): void => {
    let Rp = Rc;
    let Tp = Tc;
    for (let k = 0; k < K; k++) {
      const lk = mul3(rodrigues(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!), local[k]!);
      const t = place[k]!;
      const Tk = [Tp[0]! + Rp[0]! * t[0]! + Rp[1]! * t[1]! + Rp[2]! * t[2]!, Tp[1]! + Rp[3]! * t[0]! + Rp[4]! * t[1]! + Rp[5]! * t[2]!, Tp[2]! + Rp[6]! * t[0]! + Rp[7]! * t[1]! + Rp[8]! * t[2]!];
      joint[k * 3] = Tk[0]!;
      joint[k * 3 + 1] = Tk[1]!;
      joint[k * 3 + 2] = Tk[2]!;
      const Rk = mul3(Rp, lk);
      for (let i = 0; i < M; i++) {
        if (at.get(markers[i]!.bone) !== k) continue;
        const l = markers[i]!.local;
        into[i * 3] = Tk[0]! + Rk[0]! * l[0] + Rk[1]! * l[1] + Rk[2]! * l[2];
        into[i * 3 + 1] = Tk[1]! + Rk[3]! * l[0] + Rk[4]! * l[1] + Rk[5]! * l[2];
        into[i * 3 + 2] = Tk[2]! + Rk[6]! * l[0] + Rk[7]! * l[1] + Rk[8]! * l[2];
      }
      Rp = Rk;
      Tp = Tk;
    }
  };
  const W = twists.length;
  const restTwist = twists.map((t) => {
    if (!at.has(t.bone)) throw new Error("a twist on a bone that is not in the chain");
    return matOf([skeleton.restR[t.bone * 4]!, skeleton.restR[t.bone * 4 + 1]!, skeleton.restR[t.bone * 4 + 2]!, skeleton.restR[t.bone * 4 + 3]!]);
  });
  const m = K * 3;
  const rows = M * 3 + L + C + W + m;
  /** The angle at the head of the chain's k-th bone, between the lines to the bones on either side. */
  const angleAt = (k: number): number => {
    const ux = joint[(k - 1) * 3]! - joint[k * 3]!;
    const uy = joint[(k - 1) * 3 + 1]! - joint[k * 3 + 1]!;
    const uz = joint[(k - 1) * 3 + 2]! - joint[k * 3 + 2]!;
    const vx = joint[(k + 1) * 3]! - joint[k * 3]!;
    const vy = joint[(k + 1) * 3 + 1]! - joint[k * 3 + 1]!;
    const vz = joint[(k + 1) * 3 + 2]! - joint[k * 3 + 2]!;
    const c = (ux * vx + uy * vy + uz * vz) / ((Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c)));
  };
  const residual = (d: Float64Array, r: Float64Array): void => {
    markersOf(d, mk);
    for (let i = 0; i < M; i++) {
      const w = Math.sqrt(markers[i]!.weight ?? 1);
      if (markers[i]!.floor) {
        r[i * 3] = 0;
        r[i * 3 + 1] = w * Math.max(0, markers[i]!.aim[1]! - mk[i * 3 + 1]!);
        r[i * 3 + 2] = 0;
        continue;
      }
      if (markers[i]!.wall) {
        r[i * 3] = w * Math.max(0, mk[i * 3]! - markers[i]!.aim[0]!);
        r[i * 3 + 1] = 0;
        r[i * 3 + 2] = 0;
        continue;
      }
      const axes = markers[i]!.axes;
      for (let c = 0; c < 3; c++) r[i * 3 + c] = w * (axes ? axes[c]! : 1) * (mk[i * 3 + c]! - markers[i]!.aim[c]!);
    }
    for (let i = 0; i < L; i++) {
      const lim = limits[i]!;
      const a = angleAt(at.get(lim.bone)!);
      const w = Math.sqrt(lim.weight ?? 1);
      r[M * 3 + i] = w * (Math.max(0, (lim.min ?? 0) - a) + Math.max(0, a - (lim.max ?? Math.PI)));
    }
    for (let i = 0; i < C; i++) {
      const cap = caps[i]!;
      const k = at.get(cap.bone)!;
      // (the angle of the turn between the bone's rest and where it is: the trace of the one's transpose times the other)
      const now = mul3(rodrigues(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!), local[k]!);
      const rest = restLocal[i]!;
      let trace = 0;
      for (let c = 0; c < 9; c++) trace += rest[c]! * now[c]!;
      const angle = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
      r[M * 3 + L + i] = Math.sqrt(cap.weight ?? 1) * Math.max(0, angle - cap.max);
    }
    for (let i = 0; i < W; i++) {
      const tw = twists[i]!;
      const k = at.get(tw.bone)!;
      // (the turn beyond the rest's, in the bone's own frame: the rest's transpose times where it is; as a quaternion, the part of it about the bone's length is the twist)
      const now = mul3(rodrigues(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!), local[k]!);
      const rest = restTwist[i]!;
      const rel = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) rel[a * 3 + b] = rest[a]! * now[b]! + rest[3 + a]! * now[3 + b]! + rest[6 + a]! * now[6 + b]!;
      const q = quatOfMatrix(rel);
      const sign = q[3] < 0 ? -1 : 1;
      const along = sign * (q[0] * tw.axis[0] + q[1] * tw.axis[1] + q[2] * tw.axis[2]);
      r[M * 3 + L + C + i] = Math.sqrt(tw.weight ?? 1) * Math.max(0, 2 * Math.atan2(Math.abs(along), sign * q[3]) - (tw.max ?? 0));
    }
    for (let i = 0; i < m; i++) r[M * 3 + L + C + W + i] = sq * d[i]!;
  };
  let d = new Float64Array(m);
  let r = new Float64Array(rows);
  residual(d, r);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let mu = 1e-3;
  const probe = new Float64Array(m);
  const r2 = new Float64Array(rows);
  for (let it = 0; it < iterations; it++) {
    const J: number[][] = Array.from({ length: rows }, () => new Array<number>(m).fill(0));
    for (let c = 0; c < m; c++) {
      probe.set(d);
      probe[c]! += 1e-5;
      residual(probe, r2);
      for (let i = 0; i < rows; i++) J[i]![c] = (r2[i]! - r[i]!) / 1e-5;
    }
    const H: number[][] = Array.from({ length: m }, (_, p) => Array.from({ length: m }, (_, q) => J.reduce((s, row) => s + row[p]! * row[q]!, 0)));
    const g = Array.from({ length: m }, (_, p) => J.reduce((s, row, i) => s + row[p]! * r[i]!, 0));
    let moved = false;
    for (let tries = 0; tries < 8; tries++) {
      const Hm = H.map((row, i) => row.map((v, j) => (i === j ? v + mu : v)));
      const step = solveSystem(Hm, g.map((v) => -v));
      const next = Float64Array.from(d, (v, i) => v + step[i]!);
      residual(next, r2);
      const c2 = r2.reduce((s, v) => s + v * v, 0);
      if (c2 < cost) {
        const size = Math.hypot(...step);
        d = next;
        r = Float64Array.from(r2);
        cost = c2;
        mu = Math.max(mu / 3, 1e-9);
        moved = size > 1e-7;
        break;
      }
      mu *= 4;
    }
    if (!moved) break;
  }
  // the bones' new turns, on the side of the old ones
  let turned = 0;
  for (let k = 0; k < K; k++) {
    const j = chain[k]!;
    const old = [pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!];
    const q = quatOfMatrix(mul3(rodrigues(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!), local[k]!));
    if (old[0]! * q[0] + old[1]! * q[1] + old[2]! * q[2] + old[3]! * q[3] < 0) for (let c = 0; c < 4; c++) q[c] = -q[c]!;
    for (let c = 0; c < 4; c++) pose.r[j * 4 + c] = q[c]!;
    turned += Math.hypot(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!) / K;
  }
  markersOf(d, mk);
  const miss = markers.map((mm, i) => (mm.floor ? Math.max(0, mm.aim[1] - mk[i * 3 + 1]!) : mm.wall ? Math.max(0, mk[i * 3]! - mm.aim[0]) : Math.hypot(mk[i * 3]! - mm.aim[0], mk[i * 3 + 1]! - mm.aim[1], mk[i * 3 + 2]! - mm.aim[2])));
  return { miss, turn: (turned * 180) / Math.PI };
}
