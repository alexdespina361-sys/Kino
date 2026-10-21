// Which bones carry each point of the free cat model, and how much: made from the rest skeleton (meshy-rest.mts) and the places of the points alone, because the file's own
// weights are no use (its tail has five bones and the last one carries the whole tip, and the hips' and the tail's weights run into the flanks).
//
// The body is skinned along its length (a point is carried by the two stations it lies between), the head by an ellipsoid round the head with the ears and the jaw cut out
// of it, the tail by where along its curve a point is, the legs by how near a point is to their pieces (with the top of a leg faded out into the body).
import { BONE, BONE_COUNT, TAIL_BONES } from "../../../src/client/cat/render/gl/skeleton";
import { MOUTH, jawShare } from "../../../src/client/cat/render/gl/mouth";
import type { MeshyRest, Pt } from "./meshy-rest.mts";

/** smoothstep that also takes its edges the wrong way round. */
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TUNING = {
  /** The head: the ellipsoid that is all head (its radii), and how far out it fades to nothing, in those radii. */
  head: { centre: [0.325, 0.625, 0] as const, radii: [0.145, 0.15, 0.2] as const, full: 0.95, none: 1.4 },
  /** The ears: their radius at the base and at the tip. */
  ear: { baseR: 0.05, tipR: 0.012 },
  /** The tail: its radius, and how far along it (in body lengths) a point becomes the tail's. */
  tail: { radius: 0.12, from: 0.03, to: 0.15 },
  /** The legs: how thick each piece is, how far out a point is still the leg's (in those radii), and where along the top piece the leg fades into the body. */
  leg: { front: [0.1, 0.075, 0.065] as const, hind: [0.07, 0.075, 0.07] as const, full: 1.0, none: 1.3, from: 0.1, to: 0.9, sigma: 0.04 },
  /** A leg's reach into the body widens at the top of a hind leg (the haunch is carried by the thigh, not left behind it: a leg swung far back would tear its edge off the rump), and a point on the other side of the middle is not its leg's. */
  haunch: { full: 0.9, none: 1.7, side: [-0.02, 0.05] as const },
  neck: { from: 0.05, to: 0.9, reach: 0.22 },
};

/** The bones whose weights are smoothed further (the body's stations and the legs) and by how much: rounds of drawing each point's weights toward the mean of its neighbours'. */
const SOFT = { rounds: 24, pull: 0.5 };
const SOFT_BONES = [BONE.f0, BONE.f0 + 1, BONE.f0 + 2, BONE.f0 + 3, BONE.f0 + 4, BONE.fnU, BONE.fnU + 1, BONE.fnU + 2, BONE.ffU, BONE.ffU + 1, BONE.ffU + 2, BONE.hnU, BONE.hnU + 1, BONE.hnU + 2, BONE.hfU, BONE.hfU + 1, BONE.hfU + 2];

function nearestOnSegment(p: readonly [number, number, number], a: readonly [number, number, number], b: readonly [number, number, number]): { t: number; d: number } {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2));
  return { t, d: Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t), p[2] - (a[2] + abz * t)) };
}

/** Weights over all the bones, for one point. */
export function weightsAt(p: readonly [number, number, number], rest: MeshyRest, out: Float64Array): void {
  out.fill(0);
  const [x, y, z] = p;
  const T = TUNING;
  const centreX = (s: { top: Pt; bottom: Pt }): number => (s.top[0] + s.bottom[0]) / 2;

  // ---- the head: an ellipsoid, and the ears and the jaw cut out of it
  const hd = Math.hypot((x - T.head.centre[0]) / T.head.radii[0], (y - T.head.centre[1]) / T.head.radii[1], (z - T.head.centre[2]) / T.head.radii[2]);
  const H = sstep(T.head.none, T.head.full, hd);
  const ear = [0, 0];
  for (let i = 0; i < 2; i++) {
    const e = rest.ears[i]!;
    const a = [e.tip[0] - e.base[0], e.tip[1] - e.base[1], e.tip[2] - e.base[2]] as const;
    const l2 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    const t = ((x - e.base[0]) * a[0] + (y - e.base[1]) * a[1] + (z - e.base[2]) * a[2]) / l2;
    const tc = Math.min(1, Math.max(0, t));
    const d = Math.hypot(x - (e.base[0] + a[0] * tc), y - (e.base[1] + a[1] * tc), z - (e.base[2] + a[2] * tc));
    const r = T.ear.baseR + (T.ear.tipR - T.ear.baseR) * tc;
    ear[i] = sstep(-0.1, 0.35, t) * sstep(1.55 * r, 1.05 * r, d) * sstep(1.25, 1.05, t);
  }
  const headPart = Math.max(H, ear[0]!, ear[1]!);
  // the jaw: below the lip line, in front of the hinge (head space: the origin is the head's centre)
  const hx = x - rest.head[0];
  const hy = y - rest.head[1];
  const jaw = jawShare(hx, hy, z) * headPart;

  // ---- the tail: how far along its curve, and how far from it
  let tailInfluence = 0;
  let tailAt = 0;
  {
    let best = 1e9;
    let bs = 0;
    let acc = 0;
    for (let i = 0; i < rest.tail.length - 1; i++) {
      const a = rest.tail[i]!;
      const b = rest.tail[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = nearestOnSegment(p, [a[0], a[1], 0], [b[0], b[1], 0]);
      if (n.d < best) {
        best = n.d;
        bs = acc + n.t * len;
      }
      acc += len;
    }
    tailAt = bs;
    // (a point behind the tail's root, or hugging the rump, is the body's)
    tailInfluence = sstep(T.tail.radius * 1.9, T.tail.radius * 1.2, best) * sstep(T.tail.from, T.tail.to, bs);
  }

  // ---- the legs
  const legShare: Record<string, number> = { fn: 0, ff: 0, hn: 0, hf: 0 };
  const legParts: Record<string, [number, number, number]> = {};
  const legAt = (key: "fn" | "ff" | "hn" | "hf"): void => {
    const L = rest.legs[key];
    const radius = key[0] === "f" ? T.leg.front : T.leg.hind;
    const chain: Array<readonly [number, number, number]> = [
      [L.root[0], L.root[1], L.z],
      [L.mid[0], L.mid[1], L.z],
      [L.hock[0], L.hock[1], L.z],
      [L.toe[0], L.toe[1], L.z],
    ];
    const ds: number[] = [];
    let bestJ = 0;
    let bestT = 0;
    let best = 1e9;
    for (let j = 0; j < 3; j++) {
      const n = nearestOnSegment(p, chain[j]!, chain[j + 1]!);
      ds.push(n.d);
      if (n.d / radius[j]! < best) {
        best = n.d / radius[j]!;
        bestJ = j;
        bestT = n.t;
      }
    }
    // how far down the leg (0 at the root, 1 at the elbow or knee) the nearest point is: the top of the leg fades out into the body
    const down = bestJ === 0 ? bestT : 1;
    // (the hind leg's reach is wider near the hip, where the haunch is, and fades out down the leg)
    const hind = key[0] === "h";
    const wide = hind ? 1 - sstep(0.35, 0.95, bestJ === 0 ? bestT : 1) : 0;
    const full = T.leg.full + (T.haunch.full - T.leg.full) * wide;
    const none = T.leg.none + (T.haunch.none - T.leg.none) * wide;
    // (and only the leg's own side of the middle)
    const side = sstep(T.haunch.side[0], T.haunch.side[1], z * Math.sign(L.z || 1));
    const share = sstep(none, full, best) * sstep(T.leg.from, T.leg.to, down) * side;
    legShare[key] = share;
    // which of the three pieces: the nearest, with a soft edge
    const k = ds.map((d) => Math.exp(-((d / T.leg.sigma) ** 2) * 0.5));
    const sum = k[0]! + k[1]! + k[2]! || 1;
    legParts[key] = [k[0]! / sum, k[1]! / sum, k[2]! / sum];
  };
  legAt("fn");
  legAt("ff");
  legAt("hn");
  legAt("hf");

  // ---- share the point out: the head first, then the tail, then the legs; what is left is the body's
  let left = 1;
  const take = (want: number): number => {
    const got = Math.min(left, want);
    left -= got;
    return got;
  };
  const headGot = take(headPart);
  const tailGot = take(tailInfluence);
  const legGot: Record<string, number> = {};
  for (const key of ["fn", "ff", "hn", "hf"] as const) legGot[key] = take(legShare[key]!);

  // the head's share: the ears and the jaw out of it
  const earL = Math.min(ear[0]!, headGot);
  const earR = Math.min(ear[1]!, headGot);
  const jawGot = Math.min(jaw, Math.max(0, headGot - earL - earR));
  out[BONE.earL] = earL;
  out[BONE.earR] = earR;
  out[BONE.jaw] = jawGot;
  out[BONE.head] = Math.max(0, headGot - earL - earR - jawGot);

  // the tail's share: along its ten pieces (each is carried by the two nearest the point, as the pieces' middles are)
  if (tailGot > 0) {
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i < TAIL_BONES; i++) {
      const a = rest.tail[i]!;
      const b = rest.tail[i + 1]!;
      lens.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
      total += lens[i]!;
    }
    let acc = 0;
    const mids: number[] = [];
    for (let i = 0; i < TAIL_BONES; i++) {
      mids.push(acc + lens[i]! / 2);
      acc += lens[i]!;
    }
    if (tailAt <= mids[0]!) out[BONE.tail0] += tailGot;
    else if (tailAt >= mids[TAIL_BONES - 1]!) out[BONE.tail0 + TAIL_BONES - 1]! += tailGot;
    else {
      let i = 0;
      while (i < TAIL_BONES - 2 && tailAt > mids[i + 1]!) i++;
      const f = (tailAt - mids[i]!) / (mids[i + 1]! - mids[i]!);
      const s = f * f * (3 - 2 * f);
      out[BONE.tail0 + i]! += tailGot * (1 - s);
      out[BONE.tail0 + i + 1]! += tailGot * s;
    }
    void total;
  }

  // the legs' shares
  const first: Record<string, number> = { fn: BONE.fnU, ff: BONE.ffU, hn: BONE.hnU, hf: BONE.hfU };
  for (const key of ["fn", "ff", "hn", "hf"] as const) {
    const g = legGot[key]!;
    if (g <= 0) continue;
    const parts = legParts[key]!;
    for (let j = 0; j < 3; j++) out[first[key]! + j]! += g * parts[j]!;
  }

  // what is left: the body, between its two nearest stations; the neck takes some of it in front
  if (left > 0) {
    const cx = rest.stations.map(centreX);
    const hats = [0, 0, 0, 0, 0];
    if (x <= cx[0]!) hats[0] = 1;
    else if (x >= cx[4]!) hats[4] = 1;
    else {
      let i = 0;
      while (i < 3 && x > cx[i + 1]!) i++;
      const f = (x - cx[i]!) / (cx[i + 1]! - cx[i]!);
      const s = f * f * (3 - 2 * f);
      hats[i] = 1 - s;
      hats[i + 1] = s;
    }
    // the neck: along the line from the middle of the last station to the head's centre
    const base: Pt = [(rest.stations[4]!.top[0] + rest.stations[4]!.bottom[0]) / 2, (rest.stations[4]!.top[1] + rest.stations[4]!.bottom[1]) / 2];
    const ax = rest.head[0] - base[0];
    const ay = rest.head[1] - base[1];
    const u = ((x - base[0]) * ax + (y - base[1]) * ay) / (ax * ax + ay * ay);
    const lateral = Math.abs((x - base[0]) * ay - (y - base[1]) * ax) / Math.hypot(ax, ay);
    const neck = sstep(T.neck.from, T.neck.to, u) * sstep(T.neck.reach * 1.5, T.neck.reach, lateral) * left;
    out[BONE.neck] = neck;
    for (let i = 0; i < 5; i++) out[BONE.f0 + i]! += (left - neck) * hats[i]!;
  }
}

/**
 * The weights of every point over all the bones, then smoothed along the surface: a tuft of fur is a spike whose tip lies out of the reach of the bone its base is
 * carried by, and a tip and a base that are carried by different bones are torn apart as soon as the bones move. Each point's weights are drawn toward the mean of those
 * of the points next to it (points at the same place, which the mesh splits to give them their own way of facing, share theirs).
 */
export function weightField(pos: ArrayLike<number>, tri: ArrayLike<number>, rest: MeshyRest, rounds = 6, pull = 0.5): Float64Array {
  const n = pos.length / 3;
  const dense = new Float64Array(n * BONE_COUNT);
  const w = new Float64Array(BONE_COUNT);
  for (let v = 0; v < n; v++) {
    weightsAt([pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!], rest, w);
    dense.set(w, v * BONE_COUNT);
  }
  // the places: the points that are one place are one node
  const placeOf = new Int32Array(n);
  const places = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let id = places.get(key);
    if (id === undefined) {
      id = places.size;
      places.set(key, id);
    }
    placeOf[v] = id;
  }
  const nodes = places.size;
  const next: Set<number>[] = Array.from({ length: nodes }, () => new Set<number>());
  for (let t = 0; t < tri.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = placeOf[tri[t + k]!]!;
      const b = placeOf[tri[t + (k + 1) % 3]!]!;
      if (a !== b) {
        next[a]!.add(b);
        next[b]!.add(a);
      }
    }
  }
  let at = new Float64Array(nodes * BONE_COUNT);
  for (let v = 0; v < n; v++) at.set(dense.subarray(v * BONE_COUNT, (v + 1) * BONE_COUNT), placeOf[v]! * BONE_COUNT);
  let to = new Float64Array(nodes * BONE_COUNT);
  for (let r = 0; r < rounds; r++) {
    for (let p = 0; p < nodes; p++) {
      const around = next[p]!;
      for (let b = 0; b < BONE_COUNT; b++) {
        let sum = 0;
        for (const q of around) sum += at[q * BONE_COUNT + b]!;
        const mean = around.size ? sum / around.size : at[p * BONE_COUNT + b]!;
        to[p * BONE_COUNT + b] = at[p * BONE_COUNT + b]! * (1 - pull) + mean * pull;
      }
    }
    [at, to] = [to, at];
  }
  // the body and the legs go on being smoothed, wider: a haunch that is carried by a thigh swung far back must stretch over the whole of its width, not tear at the edge of a narrow
  // seam (the head, the jaw, the ears and the tail are left as they are: they have to keep their edges)
  const soft = new Uint8Array(BONE_COUNT);
  for (const b of SOFT_BONES) soft[b] = 1;
  for (let r = 0; r < SOFT.rounds; r++) {
    for (let p = 0; p < nodes; p++) {
      const around = next[p]!;
      for (let b = 0; b < BONE_COUNT; b++) {
        if (!soft[b]) {
          to[p * BONE_COUNT + b] = at[p * BONE_COUNT + b]!;
          continue;
        }
        let sum = 0;
        for (const q of around) sum += at[q * BONE_COUNT + b]!;
        const mean = around.size ? sum / around.size : at[p * BONE_COUNT + b]!;
        to[p * BONE_COUNT + b] = at[p * BONE_COUNT + b]! * (1 - SOFT.pull) + mean * SOFT.pull;
      }
    }
    [at, to] = [to, at];
  }
  for (let p = 0; p < nodes; p++) {
    // (what the soft bones carry is what the others leave: the sum stays one)
    let fixed = 0;
    let loose = 0;
    for (let b = 0; b < BONE_COUNT; b++) (soft[b] ? (loose += at[p * BONE_COUNT + b]!) : (fixed += at[p * BONE_COUNT + b]!));
    const scale = loose > 1e-9 ? Math.max(0, 1 - fixed) / loose : 0;
    for (let b = 0; b < BONE_COUNT; b++) if (soft[b]) at[p * BONE_COUNT + b]! *= scale;
  }
  for (let v = 0; v < n; v++) dense.set(at.subarray(placeOf[v]! * BONE_COUNT, (placeOf[v]! + 1) * BONE_COUNT), v * BONE_COUNT);
  return dense;
}

/** The four strongest bones of each point, and their weights as bytes that add up to 255. */
export function skinPoints(pos: ArrayLike<number>, tri: ArrayLike<number>, rest: MeshyRest): { skin: Uint8Array; weight: Uint8Array; dominant: Uint8Array } {
  const n = pos.length / 3;
  const skin = new Uint8Array(n * 4);
  const weight = new Uint8Array(n * 4);
  const dominant = new Uint8Array(n);
  const dense = weightField(pos, tri, rest);
  for (let v = 0; v < n; v++) {
    const w = dense.subarray(v * BONE_COUNT, (v + 1) * BONE_COUNT);
    const order = Array.from(w.keys()).sort((a, b) => w[b]! - w[a]!).slice(0, 4);
    const sum = order.reduce((s, b) => s + w[b]!, 0) || 1;
    let used = 0;
    order.forEach((b, k) => {
      const q = k === 3 ? 255 - used : Math.round((w[b]! / sum) * 255);
      skin[v * 4 + k] = b;
      weight[v * 4 + k] = Math.max(0, Math.min(255 - used, q));
      used += weight[v * 4 + k]!;
    });
    if (used < 255) weight[v * 4] = weight[v * 4]! + (255 - used);
    dominant[v] = order[0]!;
  }
  return { skin, weight, dominant };
}

export { MOUTH };
