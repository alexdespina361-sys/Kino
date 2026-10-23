import { TAU, clamp } from "../../math";
import { Pose, Skeleton, globals } from "./pose";

/**
 * What a living body does beyond what its clip says, laid over the clip's pose picture by picture: the tail and the back follow what the body did a moment ago (a spring
 * on each bone's own turn: the tip of the tail lags the root, and rings a little when the body stops), the tail is pushed by the body's own acceleration (starting, stopping,
 * landing), a tail at rest sways in a slow wave that runs from the root to the tip, and the chest rises and falls with the breath. None of it is a pose: a clip that is
 * played with no secondary motion is a cat made of one piece, and this is what makes the pieces follow one another.
 */

type Quat = [number, number, number, number];
type Vec3 = [number, number, number];

/** One bone that follows its clip: the spring's frequency (Hz) and damping (1 is critical, below that it rings), and what the body's acceleration does to it. */
interface Follow {
  bone: string;
  hz: number;
  zeta: number;
  /** How much of the push the tail takes at this bone (0 for a bone that is not pushed). */
  push: number;
  /** The slow wave of a tail at rest: how far this bone sways (radians, in the plane of the cat's side and in the plane of its back), and the pitch of the chest's breath. */
  wave: number;
  sway: number;
  breath: number;
}

const FOLLOWERS: readonly Follow[] = [
  { bone: "spine1", hz: 8.5, zeta: 0.8, push: 0, wave: 0, sway: 0, breath: 0.008 },
  { bone: "spine2", hz: 8, zeta: 0.75, push: 0, wave: 0, sway: 0, breath: 0.014 },
  { bone: "chest", hz: 7.5, zeta: 0.7, push: 0, wave: 0, sway: 0, breath: 0.02 },
  // (a walk turns the tail over about once a second and a run about twice: the springs are slow enough for the tip to be seen to trail the root, and each is slower than the one before)
  { bone: "tail", hz: 5, zeta: 0.7, push: 0.4, wave: 0.03, sway: 0.02, breath: 0 },
  { bone: "tailstart", hz: 4, zeta: 0.6, push: 0.7, wave: 0.06, sway: 0.05, breath: 0 },
  { bone: "tail1", hz: 3.2, zeta: 0.5, push: 1, wave: 0.1, sway: 0.09, breath: 0 },
  { bone: "tail2", hz: 2.6, zeta: 0.45, push: 1, wave: 0.14, sway: 0.13, breath: 0 },
  { bone: "tail3", hz: 2.1, zeta: 0.4, push: 0.9, wave: 0.18, sway: 0.17, breath: 0 },
];

/** How far the body's acceleration bends the tail (radians for each body length a second, every second) and the most it may. */
const PUSH_GAIN = 0.012;
const PUSH_MOST = 0.4;
/** The wave of a tail at rest: how far it runs behind from one bone to the next (radians) and how fast it goes (Hz at rest, and more for a lively cat). */
const WAVE_LAG = 0.9;
const WAVE_HZ = 0.45;
const WAVE_LIVELY = 0.6;

/** What the body is doing, as far as the followers care. */
export interface Gust {
  /** How fast the body is going just now, along its own length (forward) and up, in body lengths a second squared; the wave and the breath need none. */
  forward: number;
  up: number;
  /** 0..1: how much the tail sways at rest in this posture (a sitting cat sways it, a running one does not need to, a sleeping one hardly). */
  sway: number;
  /** 0..1: how lively the cat is (a faster, wider wave). */
  energy: number;
  /** -1..1: the breath (in is up). */
  breath: number;
}

interface Follower {
  bone: number;
  spec: Follow;
  /** The turn that follows, and how fast it is turning (about its own axes). */
  q: Quat;
  w: Vec3;
  /** Which way the bone's own axes point when the cat is at rest: the one along the cat's side (the turn that raises and lowers the tail) and the one up its back (the sway). */
  pitch: Vec3;
  yaw: Vec3;
  /** Which way the bone points from its joint (x and y of the cat's side), for the push. */
  dx: number;
  dy: number;
}

const normalise = (q: Quat): void => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l;
  q[1] /= l;
  q[2] /= l;
  q[3] /= l;
};

/** `out` = the turn `a` and then, about its own axes, `b`. (`out` may be either.) */
const times = (a: ArrayLike<number>, b: ArrayLike<number>, out: Quat): void => {
  const ax = a[0]!, ay = a[1]!, az = a[2]!, aw = a[3]!;
  const bx = b[0]!, by = b[1]!, bz = b[2]!, bw = b[3]!;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
};

/** The turn about a vector, by the length of the vector. */
const expOf = (x: number, y: number, z: number, out: Quat): void => {
  const l = Math.hypot(x, y, z);
  if (l < 1e-9) {
    out[0] = x / 2;
    out[1] = y / 2;
    out[2] = z / 2;
    out[3] = 1;
    normalise(out);
    return;
  }
  const s = Math.sin(l / 2) / l;
  out[0] = x * s;
  out[1] = y * s;
  out[2] = z * s;
  out[3] = Math.cos(l / 2);
};

const scratch: Quat = [0, 0, 0, 1];
const scratch2: Quat = [0, 0, 0, 1];

/** The turn that takes `from` to `to`, about `from`'s own axes, as a vector (the shortest way round). */
const turnBetween = (from: Quat, to: ArrayLike<number>, out: Vec3): void => {
  // conj(from) * to
  const fx = -from[0], fy = -from[1], fz = -from[2], fw = from[3];
  const tx = to[0]!, ty = to[1]!, tz = to[2]!, tw = to[3]!;
  let x = fw * tx + fx * tw + fy * tz - fz * ty;
  let y = fw * ty - fx * tz + fy * tw + fz * tx;
  let z = fw * tz + fx * ty - fy * tx + fz * tw;
  let w = fw * tw - fx * tx - fy * ty - fz * tz;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  // (2 atan2(s, w) / s: the angle for each unit of the vector; 2 / w for a turn too small to tell)
  const k = s < 1e-6 ? 2 / (w || 1) : (2 * Math.atan2(s, w)) / s;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
};

/**
 * The followers of one skeleton. `apply` is called once for every picture, after the clip (and whatever it was faded from) has set the pose: it replaces the turn of the bones that
 * follow with the turn they have got to, and puts on top what is not a spring (the wave, the breath). A skeleton that lacks a bone just goes without it.
 */
export class Secondary {
  private readonly followers: Follower[] = [];
  private ready = false;
  private time = 0;
  private readonly turn: Vec3 = [0, 0, 0];

  constructor(skeleton: Skeleton) {
    const R = new Float64Array(skeleton.count * 9);
    const T = new Float64Array(skeleton.count * 3);
    globals(skeleton, new Pose(skeleton), undefined, R, T);
    for (const spec of FOLLOWERS) {
      if (!skeleton.has(spec.bone)) continue;
      const bone = skeleton.bone(spec.bone);
      // (a bone's own axes against the cat's: the cat's z (toward the viewer) is the axis that raises and lowers a tail seen from the side, and its y the one that sways it)
      const m = bone * 9;
      // which way the bone points: towards its first child, when it has one, and else as its parent does
      let child = -1;
      for (let j = bone + 1; j < skeleton.count; j++) if (skeleton.parent[j] === bone) {
        child = j;
        break;
      }
      let dx = -1;
      let dy = 0;
      if (child >= 0) {
        dx = T[child * 3]! - T[bone * 3]!;
        dy = T[child * 3 + 1]! - T[bone * 3 + 1]!;
      } else if (skeleton.parent[bone]! >= 0) {
        const p = skeleton.parent[bone]!;
        dx = T[bone * 3]! - T[p * 3]!;
        dy = T[bone * 3 + 1]! - T[p * 3 + 1]!;
      }
      const l = Math.hypot(dx, dy) || 1;
      this.followers.push({
        bone,
        spec,
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        pitch: [R[m + 6]!, R[m + 7]!, R[m + 8]!],
        yaw: [R[m + 3]!, R[m + 4]!, R[m + 5]!],
        dx: dx / l,
        dy: dy / l,
      });
    }
  }

  /** The bones that follow (their names, for a test and for the lab). */
  get bones(): readonly string[] {
    return this.followers.map((f) => f.spec.bone);
  }

  /** Forgets where the bones were: the next picture is the pose as it is, with nothing trailing behind it. */
  reset(): void {
    this.ready = false;
  }

  apply(pose: Pose, dt: number, gust: Gust): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const step = Math.min(dt, 0.25);
    if (!this.ready) {
      for (const f of this.followers) {
        const o = f.bone * 4;
        f.q = [pose.r[o]!, pose.r[o + 1]!, pose.r[o + 2]!, pose.r[o + 3]!];
        f.w = [0, 0, 0];
      }
      this.ready = true;
    }
    this.time += step;
    const hz = WAVE_HZ + WAVE_LIVELY * clamp(gust.energy, 0, 1);
    const sway = clamp(gust.sway, 0, 1);
    let order = 0;
    for (const f of this.followers) {
      const o = f.bone * 4;
      const s = f.spec;
      // --- the target: the clip's turn, and a push from the body's acceleration (the tail lags the body: which way is the pseudo-force that is the other way from the acceleration)
      let target: Quat = [pose.r[o]!, pose.r[o + 1]!, pose.r[o + 2]!, pose.r[o + 3]!];
      if (s.push > 0) {
        // (the torque of the push about the bone's joint, in the plane of the cat's side: the pointing of the bone crossed with the push)
        const torque = f.dx * -gust.up - f.dy * -gust.forward;
        const bend = clamp(torque * PUSH_GAIN * s.push, -PUSH_MOST, PUSH_MOST);
        expOf(f.pitch[0] * bend, f.pitch[1] * bend, f.pitch[2] * bend, scratch);
        const pushed: Quat = [0, 0, 0, 1];
        times(target, scratch, pushed);
        target = pushed;
      }
      // --- the spring, in pieces small enough to be stable at any step (the same as `bounce` for a number)
      const w0 = TAU * s.hz;
      const pieces = Math.max(1, Math.ceil((step * w0) / 0.5));
      const h = step / pieces;
      for (let i = 0; i < pieces; i++) {
        turnBetween(f.q, target, this.turn);
        for (let k = 0; k < 3; k++) f.w[k] = f.w[k]! + (w0 * w0 * this.turn[k]! - 2 * s.zeta * w0 * f.w[k]!) * h;
        expOf(f.w[0]! * h, f.w[1]! * h, f.w[2]! * h, scratch);
        times(f.q, scratch, f.q);
        normalise(f.q);
      }
      // --- what is on top of the spring: the wave runs on from the root of the tail to the tip, and the breath lifts the chest
      let pitch = 0;
      let around = 0;
      if (s.wave > 0 && sway > 0) {
        const phase = TAU * hz * this.time - WAVE_LAG * order;
        pitch += s.wave * sway * Math.sin(phase);
        around += s.sway * sway * Math.sin(phase + Math.PI / 2);
      }
      if (s.breath > 0) pitch += s.breath * clamp(gust.breath, -1, 1);
      if (s.wave > 0) order++;
      if (pitch !== 0 || around !== 0) {
        expOf(f.pitch[0] * pitch + f.yaw[0] * around, f.pitch[1] * pitch + f.yaw[1] * around, f.pitch[2] * pitch + f.yaw[2] * around, scratch2);
        times(f.q, scratch2, scratch);
        pose.r[o] = scratch[0];
        pose.r[o + 1] = scratch[1];
        pose.r[o + 2] = scratch[2];
        pose.r[o + 3] = scratch[3];
      } else {
        pose.r[o] = f.q[0];
        pose.r[o + 1] = f.q[1];
        pose.r[o + 2] = f.q[2];
        pose.r[o + 3] = f.q[3];
      }
    }
  }
}
