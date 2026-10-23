import { createRng, type Rng } from "../../rng";
import { TAU, clamp } from "../../math";
import { Pose, Skeleton, globals, turnOfRows } from "./pose";

/**
 * What a living body does beyond what its clip says, laid over the clip's pose picture by picture. The back follows what the body did a moment ago (a spring on each bone's own turn,
 * and the chest rises and falls with the breath). The tail is a chain: each of its bones is a spring after the bone before it, in the cat's own frame, and the bone before it is itself
 * still on its way, so a turn of the root, a push of the body, a flick, runs on from bone to bone and arrives at the tip late, and rings there. A tail at rest sways in a slow wave
 * (two, one under the other, so that it does not keep time like a clock), and now and then flicks. None of it is a pose: a clip that is played with no secondary motion is a cat made of
 * one piece, and this is what makes the pieces follow one another.
 */

type Quat = [number, number, number, number];
type Vec3 = [number, number, number];

/** One bone that follows its clip: the spring's frequency (Hz) and damping (1 is critical, below that it rings), and what the body's acceleration does to it. */
interface Follow {
  bone: string;
  hz: number;
  zeta: number;
  /** Whether the bone is one of the tail's chain, which follows the bone before it (its spring is in the cat's frame), and not the clip's turn in its parent's frame. */
  chain?: boolean;
  /** How much of the push the tail takes at this bone (0 for a bone that is not pushed). */
  push: number;
  /** The slow wave of a tail at rest: how far this bone sways (radians, in the plane of the cat's side and in the plane of its back), and the pitch of the chest's breath. */
  wave: number;
  sway: number;
  breath: number;
  /** How much of a flick this bone takes (the flick is a quick lift of the root of the tail; the bones after it are carried by the chain). */
  flick?: number;
}

const FOLLOWERS: readonly Follow[] = [
  { bone: "spine1", hz: 8.5, zeta: 0.8, push: 0, wave: 0, sway: 0, breath: 0.008 },
  { bone: "spine2", hz: 8, zeta: 0.75, push: 0, wave: 0, sway: 0, breath: 0.014 },
  { bone: "chest", hz: 7.5, zeta: 0.7, push: 0, wave: 0, sway: 0, breath: 0.02 },
  // (a walk turns the tail over about once a second and a run about twice: each bone is slower than the one it follows, so the tip is seen to trail the root, and rings by more)
  { bone: "tail", hz: 5, zeta: 0.7, chain: true, push: 0.4, wave: 0.02, sway: 0.02, breath: 0, flick: 1 },
  { bone: "tailstart", hz: 4.2, zeta: 0.6, chain: true, push: 0.6, wave: 0.04, sway: 0.035, breath: 0, flick: 0.55 },
  { bone: "tail1", hz: 3.6, zeta: 0.5, chain: true, push: 0.8, wave: 0.055, sway: 0.05, breath: 0 },
  { bone: "tail2", hz: 3, zeta: 0.45, chain: true, push: 1, wave: 0.065, sway: 0.06, breath: 0 },
  { bone: "tail3", hz: 2.6, zeta: 0.4, chain: true, push: 0.9, wave: 0.065, sway: 0.06, breath: 0 },
];

/** How far the body's acceleration bends the tail (radians for each body length a second, every second) and the most it may. */
const PUSH_GAIN = 0.012;
const PUSH_MOST = 0.4;
/** The wave of a tail at rest: how far it runs behind from one bone to the next (radians) and how fast it goes (Hz at rest, and more for a lively cat). */
const WAVE_LAG = 0.7;
const WAVE_HZ = 0.45;
const WAVE_LIVELY = 0.6;
/** The slower wave under it: its pace (Hz), how wide it is against the first, and how far it runs behind from one bone to the next. */
const SWELL_HZ = 0.17;
const SWELL_SHARE = 0.7;
const SWELL_LAG = 0.35;
/** A flick: how long it takes (s), how far it lifts the root of the tail at most and at least (radians), how soon the next one is (s, at rest and for a lively cat). */
const FLICK_LENGTH = 0.38;
const FLICK_SIZE: readonly [number, number] = [0.14, 0.32];
const FLICK_EVERY: readonly [number, number] = [2.5, 7];

/**
 * How high the end of each bone of the tail's chain (root first) has to be above the floor for the tail to lie on it and not in it, body lengths: the tail is a thick brush (the
 * mesh is 0.1 to 0.25 round the bones of it), and its end, past the last joint, is the plume. The numbers are what the tail of the clips that lie down by themselves keep to.
 */
const TAIL_CLEARANCE: readonly number[] = [0.2, 0.2, 0.2, 0.22, 0.24];
/** How far past its last joint the tail goes (body lengths). */
const TAIL_PLUME = 0.2;
/** The most a bone of the tail may be turned up to get its end off the floor, as the sine of how far above level it is to point (a tail whose root is already on the floor is not stood on end). */
const TAIL_LIFT_MOST = 0.5;

/** A bone of the tail's chain, for keeping it off the floor: the bone and where its end is (the bone after it, or the plume past its own end). */
interface Link {
  bone: number;
  parent: number;
  /** The bone after it in the chain, or -1 for the last (whose end is `plume`, in its own frame). */
  next: number;
  plume: Vec3;
  clearance: number;
}

/** What the body is doing, as far as the followers care. */
export interface Gust {
  /** How fast the body is going just now, along its own length (forward) and up, in body lengths a second squared; the wave and the breath need none. */
  forward: number;
  up: number;
  /** 0..1: how much the tail sways at rest in this posture (a sitting cat sways it, a running one does not need to, a sleeping one hardly). */
  sway: number;
  /** 0..1: how lively the cat is (a faster, wider wave, and more flicks). */
  energy: number;
  /** -1..1: the breath (in is up). */
  breath: number;
}

interface Follower {
  bone: number;
  spec: Follow;
  /** The turn that follows, and how fast it is turning (about its own axes). For a bone of the tail's chain it is the bone's turn in the cat's frame, after the bones above it. */
  q: Quat;
  w: Vec3;
  /** Which way the bone's own axes point when the cat is at rest: the one along the cat's side (the turn that raises and lowers the tail) and the one up its back (the sway). */
  pitch: Vec3;
  yaw: Vec3;
  /** Which way the bone points from its joint (x and y of the cat's side), for the push. */
  dx: number;
  dy: number;
  /** For a bone of the chain: the follower (in the list) of the bone it hangs from, or -1 when that is not one, and then the bones from the root of the skeleton down to it. */
  before: number;
  above: number[];
  /** The sign of a turn about `pitch` that lifts the tip of the tail. */
  lift: number;
}

/** An angle taken round to between minus and plus a half turn. */
const wrapAngle = (a: number): number => a - TAU * Math.round(a / TAU);

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

/** `out` = the turn that undoes `a`, and then `b`: what `b` is, seen from the bone that `a` is the turn of. (`out` may be `b`.) */
const unTimes = (a: ArrayLike<number>, b: ArrayLike<number>, out: Quat): void => {
  const ax = -a[0]!, ay = -a[1]!, az = -a[2]!, aw = a[3]!;
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
/** The turn that carries the bone being followed (see `parentTurn`). */
const carry: Quat = [0, 0, 0, 1];

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
 * follow with the turn they have got to, and puts on top what is not a spring (the breath). A skeleton that lacks a bone just goes without it.
 */
export class Secondary {
  private readonly followers: Follower[] = [];
  /** The tail's chain, for `settle`, and the matrices and places of the skeleton it works from. */
  private readonly links: Link[] = [];
  private readonly R: Float64Array;
  private readonly T: Float64Array;
  private readonly spare: number[] = [0, 0, 0, 1];
  private readonly reach: Vec3 = [0, 0, 0];
  private ready = false;
  private time = 0;
  private readonly turn: Vec3 = [0, 0, 0];
  private readonly rng: Rng;
  /** The flick: seconds until the next, how far into the one that is going (`FLICK_LENGTH` and over: none), and how big it is. */
  private untilFlick: number;
  private flickAge = Number.POSITIVE_INFINITY;
  private flickSize = 0;
  /** Where the two waves are in their own rounds (they are not the clock: their pace changes with how lively the cat is). */
  private waveAt = 0;
  private swellAt: number;

  constructor(
    private readonly skeleton: Skeleton,
    seed = 0x7a11,
  ) {
    this.rng = createRng(seed);
    this.untilFlick = this.rng.range(...FLICK_EVERY);
    this.swellAt = this.rng.range(0, TAU);
    const R = new Float64Array(skeleton.count * 9);
    const T = new Float64Array(skeleton.count * 3);
    this.R = new Float64Array(skeleton.count * 9);
    this.T = new Float64Array(skeleton.count * 3);
    globals(skeleton, new Pose(skeleton), undefined, R, T);
    // the bone at the end of the chain: which way a turn of the others lifts it is measured against it
    const tip = skeleton.has("tail3") ? skeleton.bone("tail3") : -1;
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
      const pitch: Vec3 = [R[m + 6]!, R[m + 7]!, R[m + 8]!];
      // (the bones from the root down to this one's parent, for the first of a chain: its turn in the cat's frame is the parent's turn and then its own)
      const parent = skeleton.parent[bone]!;
      const before = this.followers.findIndex((o) => o.bone === parent && o.spec.chain === true);
      const chain: number[] = [];
      if (spec.chain && before < 0) for (let j = parent; j >= 0; j = skeleton.parent[j]!) chain.unshift(j);
      this.followers.push({
        bone,
        spec,
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        pitch,
        yaw: [R[m + 3]!, R[m + 4]!, R[m + 5]!],
        dx: dx / l,
        dy: dy / l,
        before,
        above: chain,
        lift: tip >= 0 ? liftOf(skeleton, bone, pitch, tip) : 1,
      });
    }
    // --- the tail's chain, for keeping it off the floor: each bone with where its end is
    const chain = this.followers.filter((f) => f.spec.chain).map((f) => f.bone);
    chain.forEach((bone, i) => {
      // (the plume: on past the last joint the way the bone before it points, told in the bone's own frame)
      const before = skeleton.parent[bone]!;
      const ux = T[bone * 3]! - T[before * 3]!;
      const uy = T[bone * 3 + 1]! - T[before * 3 + 1]!;
      const uz = T[bone * 3 + 2]! - T[before * 3 + 2]!;
      const l = Math.hypot(ux, uy, uz) || 1;
      const m = bone * 9;
      const plume: Vec3 = [0, 1, 2].map((k) => ((R[m + k]! * ux + R[m + 3 + k]! * uy + R[m + 6 + k]! * uz) / l) * TAIL_PLUME) as Vec3;
      this.links.push({ bone, parent: before, next: chain[i + 1] ?? -1, plume, clearance: TAIL_CLEARANCE[Math.min(i, TAIL_CLEARANCE.length - 1)]! });
    });
  }

  /** The bones that follow (their names, for a test and for the lab). */
  get bones(): readonly string[] {
    return this.followers.map((f) => f.spec.bone);
  }

  /** How many flicks the tail has made (for a test and for the lab). */
  flicks = 0;

  /** Forgets where the bones were: the next picture is the pose as it is, with nothing trailing behind it. */
  reset(): void {
    this.ready = false;
    this.flickAge = Number.POSITIVE_INFINITY;
  }

  apply(pose: Pose, dt: number, gust: Gust): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const step = Math.min(dt, 0.25);
    const energy = clamp(gust.energy, 0, 1);
    const sway = clamp(gust.sway, 0, 1);
    if (!this.ready) {
      for (const f of this.followers) {
        const o = f.bone * 4;
        f.q = [pose.r[o]!, pose.r[o + 1]!, pose.r[o + 2]!, pose.r[o + 3]!];
        if (f.spec.chain) {
          this.parentTurn(f, pose, carry);
          times(carry, f.q, f.q);
        }
        f.w = [0, 0, 0];
      }
      this.ready = true;
    }
    this.time += step;
    // --- the waves and the flicks go on in their own time
    this.waveAt += TAU * (WAVE_HZ + WAVE_LIVELY * energy) * step;
    this.swellAt += TAU * SWELL_HZ * (0.6 + 0.8 * energy) * step;
    this.flickAge += step;
    this.untilFlick -= step * (0.5 + 1.5 * energy) * sway;
    if (this.untilFlick <= 0) {
      this.flickAge = 0;
      this.flickSize = this.rng.range(...FLICK_SIZE) * (0.6 + 0.8 * energy);
      this.untilFlick = this.rng.range(...FLICK_EVERY);
      this.flicks++;
    }
    const flick = this.flickAge < FLICK_LENGTH ? Math.sin((Math.PI * this.flickAge) / FLICK_LENGTH) ** 2 : 0;
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
      // --- what a chain is asked besides: the waves run on from the root to the tip, and the root is flicked
      let pitch = 0;
      let around = 0;
      if (s.wave > 0 && sway > 0) {
        const wide = 0.7 + 0.6 * energy;
        const first = Math.sin(this.waveAt - WAVE_LAG * order);
        const second = Math.sin(this.swellAt - SWELL_LAG * order) * SWELL_SHARE;
        pitch += s.wave * wide * sway * (first + second);
        around += s.sway * wide * sway * (Math.sin(this.waveAt - WAVE_LAG * order + Math.PI / 2) + Math.cos(this.swellAt * 1.3 - SWELL_LAG * order) * SWELL_SHARE);
      }
      if (s.flick && flick > 0) pitch += f.lift * s.flick * flick * this.flickSize * sway;
      if (s.wave > 0) order++;
      if (s.chain) {
        if (pitch !== 0 || around !== 0) {
          expOf(f.pitch[0] * pitch + f.yaw[0] * around, f.pitch[1] * pitch + f.yaw[1] * around, f.pitch[2] * pitch + f.yaw[2] * around, scratch2);
          const waved: Quat = [0, 0, 0, 1];
          times(target, scratch2, waved);
          target = waved;
        }
        // (the turn the bone is to have in the cat's frame: where the bone before it has got to, and then its own)
        this.parentTurn(f, pose, carry);
        const aim: Quat = [0, 0, 0, 1];
        times(carry, target, aim);
        this.spring(f, aim, step);
        // (and what it has to turn in its parent to be there)
        unTimes(carry, f.q, scratch);
        pose.r[o] = scratch[0];
        pose.r[o + 1] = scratch[1];
        pose.r[o + 2] = scratch[2];
        pose.r[o + 3] = scratch[3];
        continue;
      }
      this.spring(f, target, step);
      // --- what is on top of the spring: the breath lifts the chest
      if (s.breath > 0) {
        expOf(f.pitch[0] * s.breath * clamp(gust.breath, -1, 1), f.pitch[1] * s.breath * clamp(gust.breath, -1, 1), f.pitch[2] * s.breath * clamp(gust.breath, -1, 1), scratch2);
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

  /**
   * Keeps the tail off the floor (y = 0 in the cat's own space), as the pose has it, by `share` (1: all the way; 0: not at all, for a cat in a hand, in the air or hauling itself over a
   * ledge, which has no floor under its tail). The springs are not touched: it is the picture that is held up, not the tail that is moved in them, so a tail that a wave has let down onto
   * the floor comes up with the wave and is not kept down by what it was doing below it. A bone whose end would be lower than its clearance is turned up about its joint, about the cat's
   * z, by the least that lifts its end to it, and the bones after it go with it and are looked at in their turn.
   */
  settle(pose: Pose, share: number): void {
    const { links, R, T, skeleton, spare, reach } = this;
    if (!(share > 0) || links.length === 0) return;
    globals(skeleton, pose, undefined, R, T);
    if (!links.some((link) => this.end(link, reach)[1]! < link.clearance)) return;
    for (const link of links) {
      globals(skeleton, pose, undefined, R, T);
      this.end(link, reach);
      if (reach[1]! >= link.clearance) continue;
      const j = link.bone * 3;
      const vx = reach[0]! - T[j]!;
      const vy = reach[1]! - T[j + 1]!;
      const rho = Math.hypot(vx, vy);
      if (rho < 1e-4) continue;
      // (it has to point at least this far above level, and the way to that which is the shorter turn: the bone is on the near side of straight down, or the far)
      const low = Math.asin(clamp((link.clearance - T[j + 1]!) / rho, -1, TAIL_LIFT_MOST));
      const at = Math.atan2(vy, vx);
      const toLow = wrapAngle(low - at);
      const toHigh = wrapAngle(Math.PI - low - at);
      const turn = (Math.abs(toLow) < Math.abs(toHigh) ? toLow : toHigh) * clamp(share, 0, 1);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      // (the bone's matrix turned about the cat's z, and then what it has to be against the bone it hangs from)
      const m = link.bone * 9;
      const p = link.parent * 9;
      const rows = [
        [c * R[m]! - s * R[m + 3]!, c * R[m + 1]! - s * R[m + 4]!, c * R[m + 2]! - s * R[m + 5]!],
        [s * R[m]! + c * R[m + 3]!, s * R[m + 1]! + c * R[m + 4]!, s * R[m + 2]! + c * R[m + 5]!],
        [R[m + 6]!, R[m + 7]!, R[m + 8]!],
      ];
      const local = (r: number, k: number): number => R[p + r]! * rows[0]![k]! + R[p + 3 + r]! * rows[1]![k]! + R[p + 6 + r]! * rows[2]![k]!;
      turnOfRows(local(0, 0), local(0, 1), local(0, 2), local(1, 0), local(1, 1), local(1, 2), local(2, 0), local(2, 1), local(2, 2), spare);
      pose.r[link.bone * 4] = spare[0]!;
      pose.r[link.bone * 4 + 1] = spare[1]!;
      pose.r[link.bone * 4 + 2] = spare[2]!;
      pose.r[link.bone * 4 + 3] = spare[3]!;
    }
  }

  /** Where the end of a bone of the tail's chain is, in the cat's space, as `R` and `T` have the pose (written to `out`, which is also given back). */
  private end(link: Link, out: Vec3): Vec3 {
    const { R, T } = this;
    if (link.next >= 0) {
      out[0] = T[link.next * 3]!;
      out[1] = T[link.next * 3 + 1]!;
      out[2] = T[link.next * 3 + 2]!;
      return out;
    }
    const m = link.bone * 9;
    const [x, y, z] = link.plume;
    out[0] = T[link.bone * 3]! + R[m]! * x + R[m + 1]! * y + R[m + 2]! * z;
    out[1] = T[link.bone * 3 + 1]! + R[m + 3]! * x + R[m + 4]! * y + R[m + 5]! * z;
    out[2] = T[link.bone * 3 + 2]! + R[m + 6]! * x + R[m + 7]! * y + R[m + 8]! * z;
    return out;
  }

  /** The turn that carries a bone of the chain: that of the bone it hangs from as that bone has got to, or, for the root of the chain, of the bones above it as the pose has them. */
  private parentTurn(f: Follower, pose: Pose, out: Quat): void {
    if (f.before >= 0) {
      const p = this.followers[f.before]!.q;
      out[0] = p[0];
      out[1] = p[1];
      out[2] = p[2];
      out[3] = p[3];
      return;
    }
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    for (const j of f.above) {
      const o = j * 4;
      const ax = out[0], ay = out[1], az = out[2], aw = out[3];
      const bx = pose.r[o]!, by = pose.r[o + 1]!, bz = pose.r[o + 2]!, bw = pose.r[o + 3]!;
      out[0] = aw * bx + ax * bw + ay * bz - az * by;
      out[1] = aw * by - ax * bz + ay * bw + az * bx;
      out[2] = aw * bz + ax * by - ay * bx + az * bw;
      out[3] = aw * bw - ax * bx - ay * by - az * bz;
    }
  }

  /** The spring of one follower, in pieces small enough to be stable at any step (the same as `bounce` for a number): its turn goes after `target`. */
  private spring(f: Follower, target: Quat, step: number): void {
    const w0 = TAU * f.spec.hz;
    const pieces = Math.max(1, Math.ceil((step * w0) / 0.5));
    const h = step / pieces;
    for (let i = 0; i < pieces; i++) {
      turnBetween(f.q, target, this.turn);
      for (let k = 0; k < 3; k++) f.w[k] = f.w[k]! + (w0 * w0 * this.turn[k]! - 2 * f.spec.zeta * w0 * f.w[k]!) * h;
      expOf(f.w[0]! * h, f.w[1]! * h, f.w[2]! * h, scratch);
      times(f.q, scratch, f.q);
      normalise(f.q);
    }
  }
}

/** The sign of a turn about the bone's own `pitch` axis that lifts the end of the tail (+1 or -1): measured on the skeleton at rest. */
function liftOf(skeleton: Skeleton, bone: number, pitch: Vec3, tip: number): number {
  const probe = new Pose(skeleton);
  const R = new Float64Array(skeleton.count * 9);
  const T = new Float64Array(skeleton.count * 3);
  const height = (angle: number): number => {
    probe.reset();
    const q: Quat = [0, 0, 0, 1];
    expOf(pitch[0] * angle, pitch[1] * angle, pitch[2] * angle, q);
    const o = bone * 4;
    const turned: Quat = [0, 0, 0, 1];
    times([probe.r[o]!, probe.r[o + 1]!, probe.r[o + 2]!, probe.r[o + 3]!], q, turned);
    probe.r.set(turned, o);
    globals(skeleton, probe, undefined, R, T);
    return T[tip * 3 + 1]!;
  };
  const d = height(0.2) - height(-0.2);
  return d >= 0 ? 1 : -1;
}
