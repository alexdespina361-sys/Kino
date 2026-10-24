// The cat's paws where a donor's paws are. Moving the cat's bones the way the donor's bones move (retarget.mts) is right for a head or a tail, but a leg is judged by its paw: two
// legs built differently (one that rests nearly straight, one that rests folded) turn by the same angles and put their paws in different places, and the cat's walk then has its
// paws through the floor or off it, or sliding. So the legs are finished here, by where the paws go: for each paw, where the donor's paw is against the body at each moment, less
// where it was at rest, scaled for the cat's size, is added to where the cat's paw is at rest against its own body, and the turns of the leg's bones are found that bring the paw's
// joint and the middle of its sole there (a few steps of least squares), as near as they can to the turns the plain transfer gave (so that which way a knee bends is the donor's).
// For a gait the paws that are down are first made to stay where they land (lock.mts), at one speed for all four.
import { Pose, globals, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import type { Donor } from "./donor.mts";
import { restPads } from "./gait.mts";
import { plant, stanceOf, sweepSpeed, type Stance } from "./lock.mts";
import { alignment, donorBoneOf, matOf, mul3, quatOfMatrix, tr3 } from "./retarget.mts";

export interface Leg {
  /** The cat's bones from the hip down to the paw: the turns of these are what is found. */
  chain: readonly string[];
  /** The cat's bone the leg hangs from, and the donor's bone that does what it does: the paw's place is told against these. */
  carrier: { cat: string; donor: string };
  /** The donor's bone whose joint is where the paw's joint goes, and the donor's bones whose middle is where the middle of the sole goes. */
  foot: string;
  toes: readonly string[];
  /** Which of the pads of gait.mts (`PAWS`) is this leg's. */
  pad: number;
}

export interface FeetOptions {
  animation: number;
  from?: number;
  step: number;
  facing: { back: string; front: string };
  /** The cat's size over the donor's (the hips' height over the hips' height, as a rule). */
  scale: number;
  /** What a radian of turn away from the plain transfer costs against a body length of paw out of place, squared (a small number). */
  hold?: number;
  /** The lowest the paw's joint and the sole may be told to go (the cat's floor), as the rest has them, less this much. */
  slack?: number;
  /**
   * For a gait: make the paws stay where they land while they are down (lock.mts). `speed` is the one the cat is to be carried at, in body lengths a second (when it is left out,
   * the average of what the donor's four paws do), `share` how low against its own range a paw is to be for it to count as down.
   */
  lock?: boolean | { speed?: number; share?: number };
}

export interface FeetReport {
  leg: string;
  /** How far the paw's joint and the middle of its sole are from where they were told to be, over the frames: the worst and the mean (body lengths). */
  worst: number;
  mean: number;
  /** How far the leg's bones turn away from the plain transfer, on average (degrees). */
  turn: number;
  /** The frames the paw was found down in, and how fast the donor had it go back while down (body lengths a second), when the paws were planted. */
  stance?: Stance | null;
  donorSpeed?: number;
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

/** A leg with its targets: where its paw's joint and the middle of its sole are to be at each frame. */
interface Aimed {
  leg: Leg;
  ids: number[];
  carrier: number;
  padLocal: number[];
  tl: number[][];
  aimPaw: Float64Array;
  aimPad: Float64Array;
}

export function placeFeet(donor: Donor, cat: Skeleton, mesh: CatMesh, source: ClipSource, legs: readonly Leg[], o: FeetOptions): { source: ClipSource; report: FeetReport[] } {
  const n = cat.count;
  const frames = source.frames;
  const A = alignment(donor, o.facing);
  const hold = o.hold ?? 0.01;
  const slack = o.slack ?? 0.004;
  const from = o.from ?? 0;
  // the cat at rest, and the donor
  const R0 = new Float64Array(n * 9);
  const T0 = new Float64Array(n * 3);
  globals(cat, new Pose(cat), undefined, R0, T0);
  const dRest = donor.at(null, 0);
  const pads = restPads(mesh, cat);
  // the plain transfer, frame by frame, as the cat's own world
  const prior = new Pose(cat);
  const R = new Float64Array(n * 9);
  const T = new Float64Array(n * 3);
  const poseAt = (f: number): void => {
    for (let j = 0; j < n; j++) {
      const rs = source.r[j];
      for (let k = 0; k < 4; k++) prior.r[j * 4 + k] = rs ? rs[f * 4 + k]! : cat.restR[j * 4 + k]!;
      const ts = source.t[j];
      for (let k = 0; k < 3; k++) prior.t[j * 3 + k] = ts ? ts[f * 3 + k]! : cat.restT[j * 3 + k]!;
    }
  };
  const out = source.r.slice();

  // 1. where each paw is to be, frame by frame
  const aimed: Aimed[] = legs.map((leg) => {
    const ids = leg.chain.filter((b) => cat.has(b)).map((b) => cat.bone(b));
    const K = ids.length;
    const carrier = cat.bone(leg.carrier.cat);
    const carrierDonor = donorBoneOf(donor, leg.carrier.donor);
    const foot = donorBoneOf(donor, leg.foot);
    const toes = leg.toes.map((b) => donorBoneOf(donor, b));
    const paw = ids[K - 1]!;
    // where the sole is against the paw's bone (rigid with it), and where the pad was at rest
    const pad0 = pads[leg.pad]!;
    const padLocal = [0, 0, 0].map((_, c) => (R0[paw * 9 + c]! * (pad0[0] - T0[paw * 3]!) + R0[paw * 9 + 3 + c]! * (pad0[1] - T0[paw * 3 + 1]!) + R0[paw * 9 + 6 + c]! * (pad0[2] - T0[paw * 3 + 2]!)));
    const tl = ids.map((j) => [cat.restT[j * 3]!, cat.restT[j * 3 + 1]!, cat.restT[j * 3 + 2]!]);
    // the donor's paw against its carrier at rest (in the axes of the world as the donor rests in them)
    const rel = (now: { R: ArrayLike<number>; P: ArrayLike<number> }, bones: readonly number[], deltaOf: number[]): number[] => {
      // the middle of the bones' joints, against the carrier's joint, in the carrier's own turned-from-rest axes
      let x = 0;
      let y = 0;
      let z = 0;
      for (const b of bones) {
        x += now.P[b * 3]!;
        y += now.P[b * 3 + 1]!;
        z += now.P[b * 3 + 2]!;
      }
      x = x / bones.length - now.P[carrierDonor * 3]!;
      y = y / bones.length - now.P[carrierDonor * 3 + 1]!;
      z = z / bones.length - now.P[carrierDonor * 3 + 2]!;
      // (the transpose of the carrier's turn from rest: the world vector taken back to the rest axes)
      return [deltaOf[0]! * x + deltaOf[3]! * y + deltaOf[6]! * z, deltaOf[1]! * x + deltaOf[4]! * y + deltaOf[7]! * z, deltaOf[2]! * x + deltaOf[5]! * y + deltaOf[8]! * z];
    };
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const footRest = rel(dRest, [foot], identity);
    const toesRest = rel(dRest, toes, identity);
    const carrierRestR = Array.from(R0.subarray(carrier * 9, carrier * 9 + 9));
    const carrierRestT = [T0[carrier * 3]!, T0[carrier * 3 + 1]!, T0[carrier * 3 + 2]!];
    const pawRest = [T0[paw * 3]!, T0[paw * 3 + 1]!, T0[paw * 3 + 2]!];
    const pawLocal = [pawRest[0]! - carrierRestT[0]!, pawRest[1]! - carrierRestT[1]!, pawRest[2]! - carrierRestT[2]!];
    const padLocalRest = [pad0[0] - carrierRestT[0]!, pad0[1] - carrierRestT[1]!, pad0[2] - carrierRestT[2]!];
    const aimPaw = new Float64Array(frames * 3);
    const aimPad = new Float64Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      poseAt(f);
      globals(cat, prior, undefined, R, T);
      const now = donor.at(o.animation, from + f * o.step);
      // the carrier's turn from rest in the donor's world, and the cat's
      const dd = mul3(now.R, tr3(dRest.R, carrierDonor * 9), carrierDonor * 9, 0);
      const dc = mul3(R, tr3(carrierRestR), carrier * 9, 0);
      const aim = (restLocal: number[], bones: readonly number[], donorRest: number[]): number[] => {
        const v = rel(now, bones, dd);
        // (how far the donor's paw has gone from where it was against its carrier, in the cat's axes and size)
        const ex = v[0]! - donorRest[0]!;
        const ey = v[1]! - donorRest[1]!;
        const ez = v[2]! - donorRest[2]!;
        const sx = o.scale * (A[0]! * ex + A[1]! * ey + A[2]! * ez);
        const sy = o.scale * (A[3]! * ex + A[4]! * ey + A[5]! * ez);
        const sz = o.scale * (A[6]! * ex + A[7]! * ey + A[8]! * ez);
        const lx = restLocal[0]! + sx;
        const ly = restLocal[1]! + sy;
        const lz = restLocal[2]! + sz;
        return [dc[0]! * lx + dc[1]! * ly + dc[2]! * lz + T[carrier * 3]!, dc[3]! * lx + dc[4]! * ly + dc[5]! * lz + T[carrier * 3 + 1]!, dc[6]! * lx + dc[7]! * ly + dc[8]! * lz + T[carrier * 3 + 2]!];
      };
      const p = aim(pawLocal, [foot], footRest);
      const d = aim(padLocalRest, toes, toesRest);
      // (the cat's floor: the paw does not go below where it stood)
      p[1] = Math.max(p[1]!, pawRest[1]! - slack);
      d[1] = Math.max(d[1]!, pad0[1] - slack);
      aimPaw.set(p, f * 3);
      aimPad.set(d, f * 3);
    }
    return { leg, ids, carrier, padLocal, tl, aimPaw, aimPad };
  });

  // 2. a gait's paws that are down stay where they land, all at one speed
  const stances: Array<{ stance: Stance | null; speed: number }> = aimed.map(() => ({ stance: null, speed: 0 }));
  if (o.lock) {
    const opts = o.lock === true ? {} : o.lock;
    const columns = (a: Float64Array, c: number): number[] => Array.from({ length: frames }, (_, f) => a[f * 3 + c]!);
    aimed.forEach((a, i) => {
      const stance = stanceOf(columns(a.aimPad, 1), opts.share);
      stances[i] = { stance, speed: stance ? sweepSpeed(columns(a.aimPad, 0), stance, source.fps) : 0 };
    });
    const usable = stances.filter((s) => s.stance && s.stance.length >= 3 && s.speed > 0);
    const total = usable.reduce((s, u) => s + u.stance!.length, 0);
    const speed = opts.speed ?? (total > 0 ? usable.reduce((s, u) => s + u.speed * u.stance!.length, 0) / total : 0);
    if (speed > 0) {
      aimed.forEach((a, i) => {
        const s = stances[i]!;
        if (!s.stance || s.stance.length < 3 || s.speed <= 0) return;
        const d = plant(columns(a.aimPad, 0), columns(a.aimPad, 2), s.stance, speed, source.fps);
        for (let f = 0; f < frames; f++)
          for (const c of [0, 2]) {
            a.aimPad[f * 3 + c]! += d[f * 3 + c]!;
            a.aimPaw[f * 3 + c]! += d[f * 3 + c]!;
          }
      });
    }
  }

  // 3. the turns of each leg's bones that bring the paw there
  const report: FeetReport[] = [];
  aimed.forEach((a, legIndex) => {
    const { leg, ids, carrier, padLocal, tl, aimPaw, aimPad } = a;
    const K = ids.length;
    const solved = new Float64Array(frames * K * 3);
    let worst = 0;
    let sum = 0;
    let count = 0;
    let turned = 0;
    const passes = source.loop ? 2 : 1;
    let delta = new Float64Array(K * 3);
    const carrierRestR = Array.from(R0.subarray(carrier * 9, carrier * 9 + 9));
    void carrierRestR;
    for (let pass = 0; pass < passes; pass++) {
      for (let f = 0; f < frames; f++) {
        poseAt(f);
        globals(cat, prior, undefined, R, T);
        const pawAim = [aimPaw[f * 3]!, aimPaw[f * 3 + 1]!, aimPaw[f * 3 + 2]!];
        const padAim = [aimPad[f * 3]!, aimPad[f * 3 + 1]!, aimPad[f * 3 + 2]!];
        // the bones' turns as the plain transfer has them, as matrices
        const local = ids.map((j) => matOf([prior.r[j * 4]!, prior.r[j * 4 + 1]!, prior.r[j * 4 + 2]!, prior.r[j * 4 + 3]!]));
        const Rc = Array.from(R.subarray(carrier * 9, carrier * 9 + 9));
        const Tc = [T[carrier * 3]!, T[carrier * 3 + 1]!, T[carrier * 3 + 2]!];
        const markers = (d: ArrayLike<number>, into: Float64Array): void => {
          let Rp = Rc;
          let Tp = Tc;
          let Rk = Rc;
          for (let k = 0; k < K; k++) {
            const lk = mul3(rodrigues(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!), local[k]!);
            const t = tl[k]!;
            const Tk = [Tp[0]! + Rp[0]! * t[0]! + Rp[1]! * t[1]! + Rp[2]! * t[2]!, Tp[1]! + Rp[3]! * t[0]! + Rp[4]! * t[1]! + Rp[5]! * t[2]!, Tp[2]! + Rp[6]! * t[0]! + Rp[7]! * t[1]! + Rp[8]! * t[2]!];
            Rk = mul3(Rp, lk);
            Rp = Rk;
            Tp = Tk;
          }
          into[0] = Tp[0]!;
          into[1] = Tp[1]!;
          into[2] = Tp[2]!;
          into[3] = Tp[0]! + Rk[0]! * padLocal[0]! + Rk[1]! * padLocal[1]! + Rk[2]! * padLocal[2]!;
          into[4] = Tp[1]! + Rk[3]! * padLocal[0]! + Rk[4]! * padLocal[1]! + Rk[5]! * padLocal[2]!;
          into[5] = Tp[2]! + Rk[6]! * padLocal[0]! + Rk[7]! * padLocal[1]! + Rk[8]! * padLocal[2]!;
        };
        const m = K * 3;
        const sq = Math.sqrt(hold);
        const residual = (d: Float64Array, r: Float64Array): void => {
          markers(d, mk);
          for (let c = 0; c < 3; c++) {
            r[c] = mk[c]! - pawAim[c]!;
            r[3 + c] = mk[3 + c]! - padAim[c]!;
          }
          for (let i = 0; i < m; i++) r[6 + i] = sq * d[i]!;
        };
        const mk = new Float64Array(6);
        const rows = 6 + m;
        let r = new Float64Array(rows);
        let d = Float64Array.from(delta);
        residual(d, r);
        let cost = r.reduce((s, v) => s + v * v, 0);
        let mu = 1e-3;
        const probe = new Float64Array(m);
        const r2 = new Float64Array(rows);
        for (let it = 0; it < 24; it++) {
          // the slopes (forward differences)
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
              moved = size > 1e-6;
              break;
            }
            mu *= 4;
          }
          if (!moved) break;
        }
        delta = d;
        if (pass === passes - 1) {
          solved.set(d, f * m);
          const e = Math.max(Math.hypot(r[0]!, r[1]!, r[2]!), Math.hypot(r[3]!, r[4]!, r[5]!));
          worst = Math.max(worst, e);
          sum += (Math.hypot(r[0]!, r[1]!, r[2]!) + Math.hypot(r[3]!, r[4]!, r[5]!)) / 2;
          count++;
          for (let k = 0; k < K; k++) turned += Math.hypot(d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!) / K;
        }
      }
    }
    // the turns, as the cat's bones' own: the plain transfer's, then the leg's found turn after it
    for (let k = 0; k < K; k++) {
      const j = ids[k]!;
      const q = new Float64Array(frames * 4);
      let last: number[] | null = null;
      for (let f = 0; f < frames; f++) {
        poseAt(f);
        const base = matOf([prior.r[j * 4]!, prior.r[j * 4 + 1]!, prior.r[j * 4 + 2]!, prior.r[j * 4 + 3]!]);
        const b = f * K * 3 + k * 3;
        const next = quatOfMatrix(mul3(rodrigues(solved[b]!, solved[b + 1]!, solved[b + 2]!), base));
        // (the same sign as the frame before: a turn and its negative are one turn, and the file's blending goes the short way)
        if (last && last[0]! * next[0] + last[1]! * next[1] + last[2]! * next[2] + last[3]! * next[3] < 0) for (let c = 0; c < 4; c++) next[c] = -next[c]!;
        last = next;
        q.set(next, f * 4);
      }
      out[j] = q;
    }
    const s = stances[legIndex]!;
    report.push({ leg: leg.chain[0]!, worst, mean: sum / Math.max(1, count), turn: ((turned / Math.max(1, count)) * 180) / Math.PI, ...(o.lock ? { stance: s.stance, donorSpeed: s.speed } : {}) });
  });
  return { source: { ...source, r: out }, report };
}
