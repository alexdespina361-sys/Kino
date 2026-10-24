import { clamp } from "../../math";
import { Pose, Skeleton, globals, turnAbout, type Adjust } from "./pose";

/**
 * What the limbs and the tail do when nothing holds them up: hanging from a hand by the scruff, falling free, thrashing in either. A clip is a cat that stands on the floor; a cat that
 * hangs is one whose legs answer to the world (gravity pulls them straight down, whichever way its body is tipped, and they swing when the hand does), which no clip of one body can
 * say. So here each segment of a leg and of the tail is a spring-damped angle, measured in the world (from straight down), that is pulled to where that segment hangs, follows
 * what the segment above it does, is pushed by how the body is speeding up, and is turned into the extra turn about the joint that puts the segment there (the same way a bone is
 * turned by the head's look or the breath: `Adjust`). Nothing here is keyed: the poses are where a limp limb comes to rest, and the motion is what a pendulum does.
 */

/** What the body is doing, that the limbs answer to. */
export interface Hold {
  /** 0..1: how far the cat hangs from a hand. */
  held: number;
  /** 0..1: how far it falls free. */
  falling: number;
  /** 0..1: how hard it thrashes. */
  struggle: number;
  /** 0..1: how far the rear (the hind legs and the tail) hangs, the front legs being held up by something else: a cat that hangs by its forepaws from a lip. */
  rear: number;
  /** 0..1: how hard the hind legs pedal (against the face of a ledge, with the forepaws on its lip), the front legs and the tail being let be. */
  scramble: number;
  /** How far the renderer has tipped the whole body, nose up positive (radians). */
  pitch: number;
  /** How the body speeds up along the way it faces, and upward (body lengths a second squared), smoothed. */
  forward: number;
  up: number;
  /** Seconds, for the rhythm of a struggle. */
  time: number;
}

interface Spec {
  /** The bones from the root out: each but the last has a direction (towards the next) that is steered; the last rides along with the one before it. */
  names: readonly string[];
  /** Where each segment points when it hangs, and when it falls: radians from straight down, towards the way the cat faces (the world's, not the body's). */
  hang: readonly number[];
  fall: readonly number[];
  /** The spring of each segment (Hz). */
  hz: readonly number[];
  zeta: number;
  /** How much each segment goes with the swing of the one above it (0..1). */
  follow: number;
  /** How hard a push on the body turns a segment (radians a second squared for a body length a second squared). */
  push: number;
  /** For a struggle: how far each segment swings (radians), how far behind the one above it it is (radians of the rhythm), and the limb's own place in the rhythm. */
  swing: readonly number[];
  lag: number;
  phase: number;
  /** Whether this is a limb of the rear (the hind legs and the tail), which can hang while the front legs hold on to something. */
  rear: boolean;
}

const FRONT: Omit<Spec, "names" | "phase"> = { hang: [0.28, 0.05, 0.1], fall: [1.1, 0.8, 0.6], hz: [1.5, 1.9, 2.4], zeta: 0.4, follow: 0.55, push: 1.7, swing: [0.9, 0.7, 0.4], lag: 0.9, rear: false };
const HIND: Omit<Spec, "names" | "phase"> = { hang: [0.4, -0.06, 0.06], fall: [-0.8, -0.4, 0.1], hz: [1.3, 1.7, 2.2], zeta: 0.4, follow: 0.6, push: 1.5, swing: [0.8, 0.8, 0.5], lag: 0.8, rear: true };
const TAIL: Omit<Spec, "names" | "phase"> = { hang: [0.02, 0, -0.03, 0.04], fall: [2.9, 3.0, 3.1, 3.2], hz: [1.1, 1.3, 1.6, 1.9], zeta: 0.3, follow: 0.7, push: 2.2, swing: [0.35, 0.5, 0.65, 0.8], lag: 0.7, rear: true };

// (a cat that hangs limp is not the same on both sides: a leg a little further forward than the other, and the hind legs bent at the knee and the hock, the thigh forward and the shin back,
// where a leg that hangs straight from the hip is a pole)
const SPECS: readonly Spec[] = [
  { ...FRONT, hang: [0.08, 0.02, 0.1], names: ["frontleg", "frontleg0", "frontleg1", "frontleg2"], phase: 0 },
  { ...FRONT, hang: [0.3, 0.18, 0.12], names: ["R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"], phase: Math.PI * 0.8 },
  { ...HIND, hang: [0.3, -0.25, 0.05], names: ["backleg", "backleg0", "backleg1", "backleg2"], phase: Math.PI },
  { ...HIND, hang: [0.55, -0.4, 0.0], names: ["R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"], phase: Math.PI * 1.8 },
  { ...TAIL, names: ["tail", "tailstart", "tail1", "tail2", "tail3"], phase: Math.PI * 0.4 },
];

/** The most a push can turn a segment (radians) and how fast a struggle goes round (Hz). */
const PUSH_MOST = 1;
const STRUGGLE_HZ = 3.4;
const STEP = 1 / 120;

interface Limb {
  spec: Spec;
  /** The bone numbers, and the number of the one each segment points at. */
  bones: number[];
  /** The world angle of each steered segment now, and how fast it is turning. */
  beta: Float64Array;
  speed: Float64Array;
  /** Its direction as the pose has it (without these turns), about the cat's own axes. */
  base: Float64Array;
  /** The turn it is given, about the cat's z. */
  turn: Array<[number, number, number, number]>;
  /** A struggle's own rhythm: it goes round at its own, slightly changing, pace. */
  rhythm: number;
}

const wrap = (a: number): number => {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
};

export class Dangle {
  /** The turns to add to the pose, to be given to the solver with the others (the quaternions are changed in place by `update`). */
  readonly adjust: Adjust[] = [];
  private readonly limbs: Limb[] = [];
  private readonly R = new Float64Array(48 * 9);
  private readonly T = new Float64Array(48 * 3);
  private clock = 0;

  constructor(private readonly skeleton: Skeleton) {
    for (const spec of SPECS) {
      if (!spec.names.every((n) => skeleton.has(n))) continue;
      const bones = spec.names.map((n) => skeleton.bone(n));
      const steered = bones.length - 1;
      const turn: Limb["turn"] = [];
      for (let i = 0; i < steered; i++) {
        const q: [number, number, number, number] = [0, 0, 0, 1];
        turn.push(q);
        this.adjust.push({ bone: bones[i]!, q });
      }
      this.limbs.push({ spec, bones, beta: new Float64Array(steered), speed: new Float64Array(steered), base: new Float64Array(steered), turn, rhythm: spec.phase });
    }
  }

  /** The bones that are steered, for the tests. */
  get steered(): readonly (readonly number[])[] {
    return this.limbs.map((l) => l.bones.slice(0, -1));
  }

  reset(): void {
    this.clock = 0;
    for (const l of this.limbs) {
      l.speed.fill(0);
      for (const q of l.turn) {
        q[0] = 0;
        q[1] = 0;
        q[2] = 0;
        q[3] = 1;
      }
    }
  }

  /** The world angle of each steered segment of the pose (from straight down, towards the way the cat faces), before these turns, for a body tipped by `pitch`. */
  private measure(pose: Pose, pitch: number): void {
    globals(this.skeleton, pose, undefined, this.R, this.T);
    const T = this.T;
    for (const l of this.limbs) {
      for (let i = 0; i < l.base.length; i++) {
        const a = l.bones[i]!;
        const b = l.bones[i + 1]!;
        l.base[i] = Math.atan2(T[b * 3]! - T[a * 3]!, -(T[b * 3 + 1]! - T[a * 3 + 1]!)) + pitch;
      }
    }
  }

  /**
   * Steers the limbs for one picture: `pose` is what the clip and what follows it have made (the segments start from, and go back to, where it has them), `dt` the seconds
   * since the last. With nothing held, falling or thrashing the turns are none.
   */
  update(pose: Pose, dt: number, hold: Hold): void {
    this.measure(pose, hold.pitch);
    const lone = Math.max(hold.held, hold.falling);
    const steps = Math.max(1, Math.min(24, Math.ceil(dt / STEP)));
    const h = dt / steps;
    for (const l of this.limbs) {
      const n = l.base.length;
      // (a limb of the rear answers to the world when the rear hangs by itself, and thrashes when it scrambles: the front legs and the tail hold, or are let be, as the clip has them)
      const w = clamp(l.spec.rear ? Math.max(lone, hold.rear) : lone, 0, 1);
      const rate = clamp(l.spec.rear ? Math.max(hold.held, hold.rear) : hold.held, 0, 1);
      const fight = l.spec.rear && l.spec.names[0] !== "tail" ? Math.max(hold.struggle, hold.scramble) : hold.struggle;
      if (w < 0.001 && fight < 0.001) {
        // (at rest the segments are where the pose has them, so that taking hold of the cat starts from there)
        for (let i = 0; i < n; i++) {
          l.beta[i] = l.base[i]!;
          l.speed[i] = 0;
        }
      } else {
        l.rhythm += dt * (STRUGGLE_HZ * 2 * Math.PI) * (0.8 + 0.4 * Math.sin(this.clock * 1.7 + l.spec.phase));
        for (let s = 0; s < steps; s++) {
          for (let i = 0; i < n; i++) {
            const hz = l.spec.hz[Math.min(i, l.spec.hz.length - 1)]!;
            const k = (2 * Math.PI * hz) ** 2;
            const c = 2 * l.spec.zeta * 2 * Math.PI * hz;
            const rest = l.spec.hang[Math.min(i, l.spec.hang.length - 1)]! * (1 - hold.falling) + l.spec.fall[Math.min(i, l.spec.fall.length - 1)]! * hold.falling;
            let aim = rest;
            if (i > 0) {
              const above = l.spec.hang[Math.min(i - 1, l.spec.hang.length - 1)]! * (1 - hold.falling) + l.spec.fall[Math.min(i - 1, l.spec.fall.length - 1)]! * hold.falling;
              aim += l.spec.follow * (l.beta[i - 1]! - above);
            }
            aim += fight * l.spec.swing[Math.min(i, l.spec.swing.length - 1)]! * Math.sin(l.rhythm - i * l.spec.lag);
            const push = -clamp(hold.forward * l.spec.push, -PUSH_MOST * 60, PUSH_MOST * 60) * Math.cos(l.beta[i]!);
            const acc = -k * (l.beta[i]! - aim) - c * l.speed[i]! + push * (0.4 + 0.6 * rate);
            l.speed[i] = l.speed[i]! + acc * h;
            l.beta[i] = l.beta[i]! + l.speed[i]! * h;
          }
        }
      }
      // --- the turns that put each segment where it is: its own against what the ones above it have done
      let above = 0;
      for (let i = 0; i < n; i++) {
        const base = l.base[i]!;
        const drive = Math.max(w, fight);
        const want = base + drive * wrap(l.beta[i]! - base);
        const turn = wrap(want - base - above);
        above += turn;
        const q = l.turn[i]!;
        const s = turnAbout(0, 0, 1, turn);
        q[0] = s[0];
        q[1] = s[1];
        q[2] = s[2];
        q[3] = s[3];
      }
    }
    this.clock += dt;
  }
}
