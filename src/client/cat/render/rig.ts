import { angleDelta, bounce, clamp, clamp01, dyn, easeInOut, fract, lerp, smooth, smoothstep, twoBone, TAU, type Dyn } from "../math";
import { createRng, type Rng } from "../rng";
import { HANG_AHEAD, HANG_DOWN, JUMP_LANDING, JUMP_TAKEOFF, SWAT_HIT, type CatFrame, type Clip, type Emote } from "../types";
import { climbPaws, climbPose } from "./climb";
import { FLAT, makePose, PART, SHAPE_HEIGHT, SHAPE_LENGTH, SHAPE_NAMES, unflatten, type Pose, type ShapeName } from "./shapes";
import { swatPose } from "./swat";

/**
 * The cat's body, worked out each frame from what the engine says it is doing (a CatFrame): which posture, how far along, where it looks, how
 * sleepy it is. No drawing here, only numbers (the painter is draw.ts), so it can run, and be tested, without a screen.
 *
 * What makes it look alive is not the postures but what runs under them: a posture is never switched to, it is a weight a spring moves; a
 * foot that is on the ground stays where it is while the body walks past it; the eyes look first, then the head, then the body; the tail
 * trails behind every start and stop; and the breathing, blinking and ear flicks go on by themselves, at times of their own.
 */

export interface Joint {
  x: number;
  y: number;
}

/** A leg as the painter needs it: root, middle joint (elbow or knee), then (for a hind leg) the hock, and the toe. */
export interface Leg {
  root: Joint;
  mid: Joint;
  hock: Joint;
  toe: Joint;
  /** 1: a front leg (has no hock); 0: a hind leg. */
  front: boolean;
  /** How far the paw is off the ground (the walk lifts it): the painter tilts the paw. */
  lift: number;
}

export interface Solved {
  pose: Pose;
  legs: { fn: Leg; ff: Leg; hn: Leg; hf: Leg };
  head: {
    x: number;
    y: number;
    /** The tilt of the whole head, radians. */
    rot: number;
    /** -1..1: how far the face is turned to the side the cat faces (0: it looks out of the screen). */
    yaw: number;
    eyeX: number;
    eyeY: number;
    /** 0..1, for each eye. */
    openL: number;
    openR: number;
    /** 0..1: the width of the pupil. */
    pupil: number;
    earL: number;
    earR: number;
    jaw: number;
    /** 0..1: eyes closed in contentment (a smile turned up) and in sleep (a smile turned down). */
    happy: number;
    asleep: number;
  };
  tail: Joint[];
  /** The x scale of the whole cat: 1 facing right, -1 facing left, and through 0 while it turns (never drawn thinner than the painter allows). */
  flip: number;
  /** Scale that squashes the body: 1 is none. */
  sx: number;
  sy: number;
  /** 0..1: how far above the ground it is (the shadow shrinks). */
  air: number;
  appear: number;
  /** Rotation of the whole body, radians (leaping up or down; hanging by the scruff). */
  pitch: number;
  breath: number;
  /** 1: the cat's shadow is on the ground under it; 0: none (it hangs in a hand, or from a lip, over no ground of its own). */
  shadow: number;
  /**
   * Where the whole drawn cat is from the point of the frame (its feet), on the screen, in body lengths (x to the right, y down): zero for every clip but the climb, which is held at the
   * point the cat ends up standing at while the picture hangs below it. The painter moves the cat (not its shadow) by it. (The solid cat's brush does not use it: see the director's `climb`.)
   */
  shift: Joint;
}

/** Hanging by the scruff: how far the body is tipped (radians; a negative angle lifts the nose). */
const CARRY_PITCH = -1.2;
/**
 * Where the hand is, from the feet, in the picture of a cat that faces right and is not turned about its middle (see `HANG_DOWN`), and the middle of the body that the picture is turned about
 * (see `drawCat`): a cat that hangs swings about the hand, so the picture is moved by as much as the turn would move the hand, and the hand stays where it is.
 */
const GRIP = { x: -HANG_AHEAD, y: -HANG_DOWN };
const MIDDLE = { x: 0, y: -0.4 };
/** The middle of the waist, which the rear of a hanging cat bends about, and the points of the rear (the hind legs and the tail hang from them). */
const WAIST = { x: -0.04, y: -0.43 };
const REAR_POINTS = ["rumpBack", "rumpTop", "groin", "rumpBottom", "hip", "tailRoot"] as const;
/** How far the rear of a cat that hangs calm is curled in towards its belly (radians), with its hind legs hanging from it. */
const HANG_CURL = 0.14;

const TAIL_SEGMENTS = 10;
const TAIL_LENGTH = 0.64;
/** The height of the ground for the tail (the tail's own thickness above the ground line, so that it lies on it and does not sink in). */
const TAIL_FLOOR = -0.045;
/** How steeply down a piece of tail may point, as the cosine of its angle from the ground, before it lies flat along the ground: pointing more steeply than this, it buckles up. */
const TAIL_BUCKLE = 0.5;

/** Legs: the front is shoulder to elbow to wrist; the hind is hip to knee to hock, then the foot. Lengths in body lengths. */
const FRONT_UPPER = 0.2;
const FRONT_LOWER = 0.2;
const FRONT_WRIST = 0.045;
const HIND_UPPER = 0.24;
const HIND_LOWER = 0.24;

/** How the four legs share a stride: near hind, near front, far hind, far front (a cat walks on one leg at a time, in that order). */
const GAIT_OFFSET = { hn: 0, fn: 0.25, hf: 0.5, ff: 0.75 } as const;

/** The ground a walk covers while the legs go once round (the lengths of the body), and what a gallop does: further, with each paw down for less of it. */
export const WALK_STRIDE = 0.6;
export const GALLOP_STRIDE = 1.05;

/** A gait of one leg at a time: the ground one round of the legs covers, the share of it that a paw is down for, and how high it is lifted. */
interface Gait {
  stride: number;
  duty: number;
  lift: number;
}
const WALK_GAIT: Gait = { stride: WALK_STRIDE, duty: 0.68, lift: 0.07 };
/** A wash of the face: how long one stroke is (seconds), the part of it spent licking the paw at the mouth, and the way the paw goes (forward along the face, up it: body lengths from the head's centre). */
const GROOM_BEAT = 1.5;
const GROOM_LICK = 0.28;
const GROOM_PATH: ReadonlyArray<readonly [number, number]> = [[0.075, -0.055], [0.035, -0.005], [-0.005, 0.07], [-0.05, 0.1]];
/** How far the shoulders and the rump rock over the feet in a walk (body lengths: a free model's own walk, doubled so that it is seen at the size a cat is drawn at). */
const ROCK_CHEST = 0.02;
const ROCK_RUMP = 0.015;
/** How quickly the tail follows what the posture does to it (a spring: a jump's posture changes at 9 Hz, which whipped the tail by half a body in a frame). */
const TAIL_POSE_HZ = 2.4;
/** The most a foot goes in a second while the cat leaps, in lengths of the body (the take-off's kick is about 5, and the landing's reach was over 10). */
const LEAP_FOOT_SPEED = 4.5;
/** A creeping cat takes short, slow steps, each foot lifted a little and set down with care. */
const STALK_GAIT: Gait = { stride: 0.36, duty: 0.8, lift: 0.05 };

/** Where a paw is in a gait, by the ground covered (so that a foot on the ground stays where it is while the body walks past it). */
function gaitPaw(key: "fn" | "ff" | "hn" | "hf", homeX: number, odoL: number, gait: Gait): { x: number; y: number } {
  const ph = fract(fract(odoL / gait.stride) + GAIT_OFFSET[key]);
  const half = (gait.stride * gait.duty) / 2;
  if (ph < gait.duty) return { x: homeX + half * (1 - (2 * ph) / gait.duty), y: 0 };
  const t = (ph - gait.duty) / (1 - gait.duty);
  return { x: homeX - half + 2 * half * easeInOut(t), y: -gait.lift * Math.sin(Math.PI * t) ** 0.8 };
}
/** The gallop's paws land in pairs, not one at a time: the two hind (one a little after the other), then the two front, with the body in the air between. */
const GALLOP_OFFSET = { hn: 0, hf: 0.1, ff: 0.4, fn: 0.5 } as const;
const GALLOP_DUTY = 0.3;
const GALLOP_LIFT = 0.17;
/** How far ahead of where it comes down a paw is put out in the air: the leg stretches out, and the paw is drawn back as it lands. */
const GALLOP_REACH = { fn: 0.1, ff: 0.1, hn: 0.06, hf: 0.06 } as const;

/** Where a paw is in a gallop, by the ground covered: down and still while the body goes over it, then quickly out ahead and down again. */
function gallopPaw(key: "fn" | "ff" | "hn" | "hf", homeX: number, odoL: number): { x: number; y: number } {
  const ph = fract(fract(odoL / GALLOP_STRIDE) + GALLOP_OFFSET[key]);
  const half = (GALLOP_STRIDE * GALLOP_DUTY) / 2;
  if (ph < GALLOP_DUTY) return { x: homeX + half * (1 - (2 * ph) / GALLOP_DUTY), y: 0 };
  const t = (ph - GALLOP_DUTY) / (1 - GALLOP_DUTY);
  const out = 1 - (1 - t) ** 2.2;
  return { x: homeX - half + 2 * half * out + GALLOP_REACH[key] * Math.sin(Math.PI * out), y: -GALLOP_LIFT * Math.sin(Math.PI * t) ** 0.8 };
}

const legOf = (front: boolean): Leg => ({ root: { x: 0, y: 0 }, mid: { x: 0, y: 0 }, hock: { x: 0, y: 0 }, toe: { x: 0, y: 0 }, front, lift: 0 });

export class CatRig {
  readonly solved: Solved;
  private readonly rng: Rng;
  /** The weight of each posture, for the front of the cat and for the rear (see the posture springs in `update`). */
  private readonly weights: Record<ShapeName, Dyn>;
  private readonly rearWeights: Record<ShapeName, Dyn>;
  private readonly values = new Float64Array(SHAPE_LENGTH);
  private readonly valuesFront = new Float64Array(SHAPE_LENGTH);
  private readonly valuesRear = new Float64Array(SHAPE_LENGTH);
  private time = 0;
  private breathPhase = 0;
  private prevVx = 0;
  private gait = dyn(0);
  private gallopDyn = dyn(0);
  /** How far the tail has gone out behind it: slower than the body, which is the rest of what a run changes. */
  private gallopTail = dyn(0);
  private eyeX = dyn(0);
  private eyeY = dyn(0);
  private yaw = dyn(0);
  private tilt = dyn(0);
  private flipDyn = dyn(1);
  private pitchDyn = dyn(0);
  /** How far it hangs from a hand (0..1, eased into and out of), and how far it swings under it (a pendulum, radians). */
  private carriedDyn = dyn(0);
  private swingDyn = dyn(0);
  /**
   * How hard it fights the hand (a spring after the frame's own number: a jump of that is not a jerk of the cat), and where it is in the beats of the fight: the twisting of the body, the
   * kicking of the hind legs, the swiping of the forepaws (each a turn, 0..1, that goes round faster the harder it fights, so that the beat can quicken without a jump in it).
   */
  private fightDyn = dyn(0);
  private twist = 0;
  private kick = 0;
  private swipe = 0;
  /** When the last shake of the whole body began (the rig's own time), for its envelope. */
  private shakeAt = -10;
  /**
   * How far into a climb the cat is (a spring: eased into and out of), how far the drawn cat still is from the place its climb puts it at (the frame jumps to the point the cat ends up standing at
   * when the climb begins, and the picture comes up to it from where the cat was: this is that distance, in body lengths, and it dies away), and where the frame was the last time.
   */
  private climbDyn = dyn(0);
  private shiftOffX = dyn(0);
  private shiftOffY = dyn(0);
  private lastAt: { x: number; y: number; clip: Clip } | null = null;
  private sqDyn = dyn(0);
  private jawDyn = dyn(0);
  private happyDyn = dyn(0);
  private asleepDyn = dyn(0);
  private pupilDyn = dyn(0.5);
  private earBaseL = dyn(0);
  private earBaseR = dyn(0);
  private earKickL = dyn(0);
  private earKickR = dyn(0);
  private nextTwitch: number;
  private nextBlink: number;
  private blinkAt = -1;
  private blinkAgain = false;
  private tailAngles: Dyn[];
  private tailRoot = dyn(0);
  private pawX = dyn(0);
  private pawY = dyn(0);
  private pawOn = dyn(0);
  private groomDyn = dyn(0);
  /** Where the paw is on its way up the face in a wash (0 at the mouth, 1 behind the ear), a spring after the clip's beat; and how far into a yawn and a stretch the cat is, the same. */
  private sweepDyn = dyn(0);
  private yawnDyn = dyn(0);
  private stretchDyn = dyn(0);
  private creepDyn = dyn(0);
  /** How far into each little scene the cat is (0..1, a spring each, so that a scene is eased into and out of). */
  private scratchDyn = dyn(0);
  private kneadDyn = dyn(0);
  private sniffDyn = dyn(0);
  private wiggleDyn = dyn(0);
  private stalkDyn = dyn(0);
  /** The new little scenes: looking over an edge, batting at the pointer, nodding off, and a sleeper changing its place. */
  private peekDyn = dyn(0);
  private dozeDyn = dyn(0);
  private shiftDyn = dyn(0);
  /** How far the weight has gone forward onto the poster in a swat (a spring after the swat's own curve: a swat that is cut short is let out of, not snapped out of). */
  private swatDyn = dyn(0);
  /** How far into each feeling the cat is (see `Emote`), eased into and out of; which way a head is tilted; the tip of the tail's own kick (a dream). */
  private readonly feel: Record<Exclude<Emote, "none">, Dyn> = { tilt: dyn(0), think: dyn(0), startle: dyn(0), joy: dyn(0), droop: dyn(0), annoyed: dyn(0), shake: dyn(0) };
  private tiltSign: 1 | -1 = 1;
  private lastEmote: Emote = "none";
  /** The tail follows a fright a little behind the face (a tail is long, and a whole tail that went up in a frame would be seen to snap). */
  private startleTail = dyn(0);
  private tipKick = dyn(0);
  /** What the posture asks of the tail (its base angle, its curl, how far it wraps the body), a spring behind it: a tail has weight. 	ailPoseReady is false until the first frame, and after snapTo. */
  private tailPoseAngle = dyn(0);
  private tailPoseCurl = dyn(0);
  private tailPoseFront = dyn(0);
  private tailPoseReady = false;
  /** How far a leap is on its way down, with the legs reaching for the ground (a spring: let go of at the landing, not in a frame). */
  private fallDyn = dyn(0);
  /** How far into a leap the cat is (a spring: held a moment after it), and where each foot was last frame, for the speed limit a leap's feet are held to. */
  private leapDyn = dyn(0);
  private readonly footAt = { fn: { x: 0, y: 0, ready: false }, ff: { x: 0, y: 0, ready: false }, hn: { x: 0, y: 0, ready: false }, hf: { x: 0, y: 0, ready: false } };
  private nextTip: number;
  private prevProgress = 0;
  private nextSlow: number;
  private slowAt = -1;
  private nextDream: number;
  private dreamAt = -1;
  private facing: 1 | -1 = 1;
  /** A resting cat's idle life, from a generator of its own (so that it does not change what the rest of the cat does): where its eyes go next, the ears' slow drift, a change of foot. */
  private readonly idle: Rng;
  private nextGaze = 0;
  private gazeX = 0.35;
  private gazeY = 0;
  private readonly earPhase: number[];
  private nextShuffle = 0;
  private shuffleAt = -1;
  private shuffleKey: "fn" | "ff" | "hn" | "hf" = "hn";
  private shuffleFrom = 0;
  private shuffleTo = 0;
  private readonly padOff = { fn: 0, ff: 0, hn: 0, hf: 0 };
  private readonly padLift = { fn: 0, ff: 0, hn: 0, hf: 0 };

  constructor(seed = 1) {
    this.rng = createRng(seed);
    this.idle = this.rng.fork("idle");
    this.nextGaze = this.idle.range(1, 3);
    this.nextShuffle = this.idle.range(4, 10);
    this.earPhase = Array.from({ length: 4 }, () => this.idle.range(0, TAU));
    this.weights = {} as Record<ShapeName, Dyn>;
    this.rearWeights = {} as Record<ShapeName, Dyn>;
    for (const name of SHAPE_NAMES) {
      this.weights[name] = dyn(name === "stand" ? 1 : 0);
      this.rearWeights[name] = dyn(name === "stand" ? 1 : 0);
    }
    this.nextTwitch = this.rng.range(2, 6);
    this.nextBlink = this.rng.range(1.5, 4);
    this.nextSlow = this.rng.range(4, 10);
    this.nextDream = this.rng.range(5, 12);
    this.nextTip = this.rng.range(3, 9);
    this.tailAngles = Array.from({ length: TAIL_SEGMENTS }, () => dyn(0));
    this.solved = {
      pose: makePose(),
      legs: { fn: legOf(true), ff: legOf(true), hn: legOf(false), hf: legOf(false) },
      head: { x: 0, y: 0, rot: 0, yaw: 0, eyeX: 0, eyeY: 0, openL: 1, openR: 1, pupil: 0.5, earL: 0, earR: 0, jaw: 0, happy: 0, asleep: 0 },
      tail: Array.from({ length: TAIL_SEGMENTS + 1 }, () => ({ x: 0, y: 0 })),
      flip: 1,
      sx: 1,
      sy: 1,
      air: 0,
      appear: 1,
      pitch: 0,
      breath: 0,
      shadow: 1,
      shift: { x: 0, y: 0 },
    };
  }

  /** Put the cat straight into the posture of a frame, with nothing left to settle (for the first frame, and for pictures of a pose). */
  snapTo(frame: CatFrame, px: number): void {
    this.update(frame, 0.001, px);
    const target = this.targetWeights(frame);
    for (const name of SHAPE_NAMES) {
      for (const d of [this.weights[name], this.rearWeights[name]]) {
        d.x = target[name];
        d.v = 0;
      }
    }
    this.flipDyn.x = frame.facing;
    this.facing = frame.facing;
    // (and a leap that is on its way down is already reaching for the ground, and the tail takes the posture's own tail straight away, not on its way from the one before)
    this.fallDyn.x = frame.clip === "jump" && !frame.grounded ? smoothstep(80, 520, frame.vy) : 0;
    this.fallDyn.v = 0;
    // (and a cat in a climb is already in it, in the place the climb puts it, not on its way to it from where the frame was)
    this.climbDyn.x = frame.clip === "climb" ? 1 : 0;
    this.climbDyn.v = 0;
    this.shiftOffX.x = 0;
    this.shiftOffX.v = 0;
    this.shiftOffY.x = 0;
    this.shiftOffY.v = 0;
    this.lastAt = { x: frame.x, y: frame.y, clip: frame.clip };
    for (const key of ["fn", "ff", "hn", "hf"] as const) this.footAt[key].ready = false;
    this.tailPoseReady = false;
    this.update(frame, 0.001, px);
  }

  private targetWeights(frame: CatFrame): Record<ShapeName, number> {
    const w: Record<ShapeName, number> = { stand: 0, sit: 0, loaf: 0, curl: 0, crouch: 0, stretch: 0, air: 0 };
    const p = frame.progress;
    if (frame.carried) {
      // (a cat that hangs by the scruff is a little longer than one that stands: its own weight pulls it out)
      w.stand = 0.55;
      w.air = 0.45;
      return w;
    }
    switch (frame.clip) {
      case "climb": {
        // (the same: hanging by its forepaws, its weight stretches it, and it is its own length again as it gets up onto the ledge)
        const stretch = climbPose(p).stretch;
        w.stand = 1 - stretch;
        w.air = stretch;
        break;
      }
      case "stand":
      case "walk":
      case "run":
      case "sniff":
      case "peek":
        w.stand = 1;
        break;
      case "sit":
      case "groom":
      case "pet":
      case "point":
      case "tap":
      case "yawn":
      case "scratch":
        w.sit = 1;
        break;
      case "loaf":
      case "knead":
      case "doze":
        w.loaf = 1;
        break;
      case "shift": {
        // a sleeper half wakes: the curl opens a little toward a loaf, is held, and closes again
        const open = smoothstep(0.1, 0.32, p) * (1 - smoothstep(0.62, 0.9, p));
        w.curl = 1 - 0.65 * open;
        w.loaf = 0.65 * open;
        break;
      }
      case "curl":
        w.curl = 1;
        break;
      case "crouch":
      case "wiggle":
        w.crouch = 1;
        break;
      case "stalk":
        // (low, with the front of it nearly as low as it can go: a cat that creeps)
        w.crouch = 0.85;
        w.stand = 0.15;
        break;
      case "swat":
        // (low on the front, nearly as low as the stalk: the paw has to reach over the lip of the shelf to the poster below it, and a sitting cat cannot)
        w.crouch = 0.8;
        w.stand = 0.2;
        break;
      case "stretch": {
        // down on the forelegs, rump up, held, then up again
        const hold = smoothstep(0.08, 0.3, p) * (1 - smoothstep(0.72, 0.95, p));
        w.stretch = hold;
        w.stand = 1 - hold;
        break;
      }
      case "jump": {
        const prep = 1 - smoothstep(JUMP_TAKEOFF - 0.06, JUMP_TAKEOFF, p);
        const air = smoothstep(JUMP_TAKEOFF - 0.02, JUMP_TAKEOFF + 0.08, p) * (1 - smoothstep(JUMP_LANDING - 0.04, JUMP_LANDING + 0.02, p));
        const land = smoothstep(JUMP_LANDING - 0.04, JUMP_LANDING + 0.03, p) * (1 - smoothstep(0.92, 1, p));
        w.crouch = prep * (p < JUMP_TAKEOFF ? 1 : 0.4) + land * 0.9;
        w.air = air;
        w.stand = Math.max(0, 1 - w.crouch - w.air);
        break;
      }
    }
    return w;
  }

  /** Advance the body by `dt` seconds. `px` is the cat's body length in pixels. */
  update(frame: CatFrame, dt: number, px: number): void {
    dt = clamp(dt, 0.0005, 0.05);
    const s = this.solved;
    this.time += dt;
    const sleepy = frame.drowsy;
    const clip = frame.clip;
    // --- in a hand: how far the cat hangs from it by the scruff (eased into, and out of: let go of, it rights itself in the air)
    // (a third of a second to tip over, a little less to right itself: the tail's tip is a body length from the middle it turns about, and would snap if it were quicker)
    smooth(this.carriedDyn, frame.carried ? 1 : 0, frame.carried ? 2.2 : 2.8, dt);
    const held = clamp01(this.carriedDyn.x);
    // --- fighting the hand (see `CatFrame.struggle`): how hard, and the beats of it, which come round faster the harder it is
    smooth(this.fightDyn, clamp01(frame.struggle ?? 0), 4, dt);
    const fight = clamp01(this.fightDyn.x);
    this.twist = fract(this.twist + dt * (0.9 + 1.7 * fight));
    this.kick = fract(this.kick + dt * (1.6 + 3.4 * fight));
    this.swipe = fract(this.swipe + dt * (1.1 + 1.6 * fight));
    // --- in a climb: the drawn cat is in the place the climb puts it, below and behind the point the frame holds, and comes up to it as the climb goes (see `climbPose`). The frame jumped to that point
    // when the climb began, from where the cat was (in the air at the lip, or on its feet under it): the picture does not, and is eased from there to the place of the climb
    const climbClip = clip === "climb";
    smooth(this.climbDyn, climbClip ? 1 : 0, climbClip ? 9 : 8, dt);
    const climbing = clamp01(this.climbDyn.x);
    const cp = climbPose(climbClip ? frame.progress : 1);
    const was = this.lastAt;
    if (climbClip && was && was.clip !== "climb") {
      const offX = ((was.x - frame.x) / px) * frame.facing - cp.x;
      const offY = (was.y - frame.y) / px - cp.y;
      // (a cat that was somewhere else altogether, not seen on its way here, is not brought from there)
      if (Math.abs(offX) < 2.5 && Math.abs(offY) < 3) {
        this.shiftOffX.x = offX;
        this.shiftOffX.v = 0;
        this.shiftOffY.x = offY;
        this.shiftOffY.v = 0;
      }
    }
    this.lastAt = { x: frame.x, y: frame.y, clip };
    smooth(this.shiftOffX, 0, 9, dt);
    smooth(this.shiftOffY, 0, 9, dt);
    // (how much of it hangs, with its hind legs and its tail down in the world: as it does in a hand, and the same way of drawing it)
    const climbHang = climbing * cp.hang;
    const hung = Math.max(held, climbHang);

    // --- posture: a spring moves the weight from one shape to another, one for the front of the cat and one for the rear. A cat that lowers itself
    // folds its rear first (and its front follows); one that rises lifts its front first. A jump is all at once.
    const target = this.targetWeights(frame);
    const jumping = clip === "jump";
    // (a jump gathers itself first, then goes all at once)
    const postureHz = frame.carried || clip === "climb"
      ? 6
      : jumping
      ? frame.progress < JUMP_TAKEOFF - 0.04
        ? 3.2
        : 9
      : clip === "stretch"
        ? 3
        : clip === "curl" || clip === "shift"
          ? 1.1
          : clip === "loaf" || clip === "knead" || clip === "doze"
            ? 1.3
            : clip === "crouch" || clip === "wiggle"
              ? 3
              : clip === "stalk"
                ? 2.4
                : clip === "swat"
                  ? 3.4
                  : clip === "stand" || clip === "walk" || clip === "run" || clip === "sniff" || clip === "peek"
                    ? 1.8
                    : 1.6;
    let goal = 0;
    let here = 0;
    let hereRear = 0;
    for (const name of SHAPE_NAMES) {
      goal += target[name] * SHAPE_HEIGHT[name]!;
      here += Math.max(0, this.weights[name].x) * SHAPE_HEIGHT[name]!;
      hereRear += Math.max(0, this.rearWeights[name].x) * SHAPE_HEIGHT[name]!;
    }
    const lowering = !jumping && goal < here - 0.03;
    const rising = !jumping && goal > here + 0.03;
    // (one that gets up from lying curled or in a loaf takes its time over it: the front comes up first and the rest follows, as a cat that has been asleep does it)
    const lowNow = clamp01(Math.max(0, this.weights.curl.x) + 0.55 * Math.max(0, this.weights.loaf.x));
    const getUp = rising && !frame.carried ? lerp(1, 0.32, lowNow) : 1;
    const frontFreq = postureHz * getUp * (lowering ? 0.6 : 1);
    const rearFreq = postureHz * getUp * (rising ? 0.6 : 1);
    let total = 0;
    let totalRear = 0;
    for (const name of SHAPE_NAMES) {
      smooth(this.weights[name], target[name], frontFreq, dt);
      smooth(this.rearWeights[name], target[name], rearFreq, dt);
      total += Math.max(0, this.weights[name].x);
      totalRear += Math.max(0, this.rearWeights[name].x);
    }
    const front = this.valuesFront;
    const rear = this.valuesRear;
    front.fill(0);
    rear.fill(0);
    for (const name of SHAPE_NAMES) {
      const wf = Math.max(0, this.weights[name].x) / (total || 1);
      const wr = Math.max(0, this.rearWeights[name].x) / (totalRear || 1);
      if (wf < 1e-4 && wr < 1e-4) continue;
      const flat = FLAT[name];
      for (let i = 0; i < SHAPE_LENGTH; i++) {
        front[i] = (front[i] ?? 0) + (flat[i] ?? 0) * wf;
        rear[i] = (rear[i] ?? 0) + (flat[i] ?? 0) * wr;
      }
    }
    for (let i = 0; i < SHAPE_LENGTH; i++) {
      const part = PART[i];
      this.values[i] = part === 1 ? rear[i]! : part === 2 ? (front[i]! + rear[i]!) / 2 : front[i]!;
    }
    const pose = unflatten(this.values, s.pose);
    const p = pose.p;

    // --- the little scenes: how far into each the cat is (eased into and out of, whatever the engine switches between)
    smooth(this.scratchDyn, clip === "scratch" ? 1 : 0, 4, dt);
    smooth(this.kneadDyn, clip === "knead" ? 1 : 0, 3, dt);
    smooth(this.sniffDyn, clip === "sniff" ? 1 : 0, 4, dt);
    smooth(this.wiggleDyn, clip === "wiggle" ? 1 : 0, 5, dt);
    smooth(this.stalkDyn, clip === "stalk" ? 1 : 0, 4, dt);
    smooth(this.peekDyn, clip === "peek" ? 1 : 0, 4, dt);
    smooth(this.dozeDyn, clip === "doze" ? 1 : 0, 2.2, dt);
    smooth(this.shiftDyn, clip === "shift" ? 1 : 0, 6, dt);
    const peeking = clamp01(this.peekDyn.x);
    const dozing = clamp01(this.dozeDyn.x);
    const shifting = clamp01(this.shiftDyn.x);
    // --- how the cat feels, laid over whatever it is doing: quick to come on (a flinch is at once), slower to go
    const emote: Emote = frame.emote ?? "none";
    if (emote !== this.lastEmote) {
      if (emote === "tilt") this.tiltSign = this.rng.chance(0.5) ? 1 : -1;
      if (emote === "shake") this.shakeAt = this.time;
      this.lastEmote = emote;
    }
    for (const name of ["tilt", "think", "startle", "joy", "droop", "annoyed", "shake"] as const) {
      const on = emote === name;
      // (a fright comes on fast, in a tenth of a second or so, and goes slowly: the tail would be seen to snap if it came on any faster; a shake is quick both ways, and has an envelope of its own)
      smooth(this.feel[name], on ? 1 : 0, name === "startle" ? (on ? 10 : 2.2) : name === "shake" ? (on ? 14 : 8) : name === "annoyed" ? (on ? 6 : 1.6) : on ? 5 : 2.6, dt);
    }
    const tilting = clamp01(this.feel.tilt.x);
    const thinking = clamp01(this.feel.think.x);
    const startled = clamp01(this.feel.startle.x);
    const joyful = clamp01(this.feel.joy.x);
    const drooping = clamp01(this.feel.droop.x);
    const annoyed = clamp01(this.feel.annoyed.x);
    // (a shake of the whole body: a quick burst that dies away, a second or so)
    const shakeU = (this.time - this.shakeAt) / 0.95;
    const shaking = clamp01(this.feel.shake.x) * (shakeU >= 0 && shakeU < 1 ? Math.sin(Math.PI * shakeU) ** 0.7 : 0);
    const shakeBeat = Math.sin(this.time * TAU * 11.5);
    const scratching = clamp01(this.scratchDyn.x);
    const kneading = clamp01(this.kneadDyn.x);
    const sniffing = clamp01(this.sniffDyn.x);
    const wiggling = clamp01(this.wiggleDyn.x);
    // (the hunt: the stalk and the wiggle before the pounce)
    const hunt = clamp01(Math.max(this.stalkDyn.x, wiggling));
    // in a deep sleep a cat dreams: now and then an ear flicks and a forepaw jerks, once, and is still
    if (sleepy >= 0.9 && this.time >= this.nextDream) {
      (this.rng.chance(0.5) ? this.earKickL : this.earKickR).v += this.rng.range(8, 13) * (this.rng.chance(0.5) ? -1 : 1);
      this.dreamAt = this.time;
      this.nextDream = this.time + this.rng.range(8, 22);
    }
    const dreamT = this.dreamAt >= 0 ? this.time - this.dreamAt : -1;
    const dream = dreamT >= 0 && dreamT < 0.35 ? Math.sin((dreamT / 0.35) * Math.PI) : 0;
    // (and the tip of its tail flicks, now and then, once, and is still: a sleeper's tail is not as asleep as the rest of it)
    if (sleepy >= 0.85 && this.time >= this.nextTip) {
      this.tipKick.v += this.rng.range(7, 12) * (this.rng.chance(0.5) ? -1 : 1);
      this.nextTip = this.time + this.rng.range(4, 13);
    }
    bounce(this.tipKick, 0, 5, 0.28, dt);

    // --- breathing: slower and deeper in sleep, quicker when excited; a purr is a faster, smaller pulse on top
    const breathRate = lerp(0.42, 0.28, sleepy) + frame.energy * 0.25;
    this.breathPhase = fract(this.breathPhase + dt * breathRate);
    const breath = Math.sin(this.breathPhase * TAU);
    const purr = Math.sin(this.time * TAU * 7) * 0.004 * Math.max(frame.petted ? 1 : 0, kneading);
    s.breath = breath;
    const chest = breath * lerp(0.011, 0.016, sleepy) + purr;
    for (const k of ["shoulderTop", "neckTop", "chestFront"] as const) p[k].y -= chest * 0.7;
    p.chestBottom.y += chest * 0.5;
    p.bellyMid.y += chest * 1.1;
    p.backMid.y -= chest * 0.4;

    // --- the walk: the legs are driven by the distance walked, so a foot on the ground stays where it is
    const stalking = clip === "stalk";
    const walking = clip === "walk" || clip === "run" || stalking;
    // (a cat that has been lying down gets up before it walks: legs that step while the hips are still low are folded double, and their knees would swing about, through the floor, and flip)
    const risen = clamp01(1 - (goal - Math.min(here, hereRear)) / 0.2);
    smooth(this.gait, walking ? risen : 0, walking ? 8 : 5, dt);
    const gaitW = clamp01(this.gait.x);
    const odoL = frame.odometer / px;
    // (a run is a gallop, and is eased into and out of: a cat that breaks into one does not jump from one gait to the other)
    smooth(this.gallopDyn, clip === "run" ? 1 : 0, clip === "run" ? 5 : 4, dt);
    const gallop = clamp01(this.gallopDyn.x);
    const gat = gaitW * gallop;
    smooth(this.gallopTail, gat, 2.4, dt);
    // (the creeping walk is the same: both are worked out from the ground covered and blended, so that the change from one to the other, or to a stop, does not jump a paw)
    const stalkW = clamp01(this.stalkDyn.x);
    const walkBeat = fract(odoL / WALK_GAIT.stride);
    const stalkBeat = fract(odoL / STALK_GAIT.stride);
    // (a walking cat's back rocks over its feet twice a stride, as a free model's own walk does, measured: the shoulders are at their highest as the hind feet come down and at their
    // lowest as the forefeet do, the rump the other way about, a little less; the head goes forward with the shoulders and its bob follows theirs by a quarter of a beat)
    const onFoot = gaitW * (1 - gallop);
    const rockAt = (beat: number, lag = 0): number => Math.cos(TAU * 2 * (beat + 0.03) - lag);
    const rock = onFoot * lerp(rockAt(walkBeat), 0.4 * rockAt(stalkBeat), stalkW);
    const rockLate = onFoot * lerp(rockAt(walkBeat, 1.4), 0.4 * rockAt(stalkBeat, 1.4), stalkW);
    const chestRise = ROCK_CHEST * rock;
    const rumpRise = -ROCK_RUMP * rock;
    // (where it is in the gallop's one beat: 0 is the hind feet coming down; gathered, with the feet under it, is the end of it, stretched out the middle)
    const gbeat = fract(odoL / GALLOP_STRIDE);
    const gather = gat > 0.001 ? Math.cos(TAU * (gbeat - 0.92)) : 0;
    const rearUp = gat > 0.001 ? 0.5 - 0.5 * Math.cos(TAU * (gbeat - 0.55)) : 0;
    const foreUp = gat > 0.001 ? 0.5 - 0.5 * Math.cos(TAU * (gbeat - 0.05)) : 0;

    // --- the whole body, tilted in the air and bowing to what it does
    const pitchTarget = jumping ? clamp(frame.vy / 1400, -0.5, 0.5) : 0;
    smooth(this.pitchDyn, pitchTarget, 7, dt);
    // (hanging by the scruff it is tipped nose up and swings under the hand like a pendulum: pushed by the hand's acceleration, and leaning back a little against its speed)
    const handAx = ((frame.vx - this.prevVx) / dt / px) * frame.facing;
    bounce(this.swingDyn, held > 0.5 ? clamp(handAx * 0.012 + (frame.vx / px) * frame.facing * 0.012, -0.55, 0.55) : 0, 1.5, 0.2, dt);
    // (it sways slowly under the hand all the same, as a weight on a string does, and the harder it fights the more it twists against the hand: a swing of its own, that comes round faster
    // and wider, with a second beat on top so that it is not a metronome)
    const hangSway = (0.055 * Math.sin(this.time * TAU * 0.42) + 0.022 * Math.sin(this.time * TAU * 0.97 + 1.1)) * (1 - 0.75 * fight);
    const hangThrash = fight * (0.3 * Math.sin(TAU * this.twist) + 0.09 * Math.sin(this.time * TAU * 1.37 + 0.9));
    const hangSwing = this.swingDyn.x + hangSway + hangThrash;
    // (hanging by its forepaws from a lip it sways a little under them, and its tip is the climb's own)
    const climbSway = Math.sin(this.time * 2.3) * 0.045 * climbHang;
    // (a shake rocks the whole body a little about its middle)
    s.pitch = lerp(lerp(this.pitchDyn.x, CARRY_PITCH + hangSwing, held), cp.pitch + climbSway, climbing) + 0.07 * shaking * Math.sin(this.time * TAU * 9.5 + 0.3);
    for (const k of ["shoulderTop", "neckTop", "chestFront", "chestBottom", "shoulder", "head"] as const) p[k].y -= chestRise;
    for (const k of ["rumpBack", "rumpTop", "groin", "rumpBottom", "hip", "tailRoot"] as const) p[k].y -= rumpRise;
    p.backMid.y -= (chestRise + rumpRise) / 2;
    p.bellyMid.y -= (chestRise + rumpRise) / 2;
    // --- hanging: the rear is curled in under the belly a little (a cat in a hand is not a plank), and the harder it fights the more it bends and straightens, a beat behind the twist of the
    // front, as a fish thrashes. The hind legs and the tail hang from it
    const bend = held * (-HANG_CURL + fight * 0.5 * Math.sin(TAU * this.twist - 1.3));
    if (Math.abs(bend) > 1e-4) {
      const cb = Math.cos(bend);
      const sb = Math.sin(bend);
      for (const k of REAR_POINTS) {
        const dx = p[k].x - WAIST.x;
        const dy = p[k].y - WAIST.y;
        p[k].x = WAIST.x + dx * cb - dy * sb;
        p[k].y = WAIST.y + dx * sb + dy * cb;
      }
    }
    if (gat > 0.001) {
      // (a cat that runs is lower on its legs, and rocks over them: the rump is down as the hind feet take the weight and up as the forefeet do, and the
      // shoulders the other way about; gathered, its back is arched and its body short, stretched out, it is long and flat)
      const rearDy = (0.035 - 0.065 * rearUp) * gat;
      const foreDy = (0.04 - 0.065 * foreUp) * gat;
      for (const k of ["rumpBack", "rumpTop", "groin", "rumpBottom", "hip", "tailRoot"] as const) {
        p[k].y += rearDy;
        p[k].x += 0.045 * gather * gat;
      }
      for (const k of ["shoulderTop", "neckTop", "chestFront", "chestBottom", "shoulder", "head"] as const) {
        p[k].y += foreDy;
        p[k].x -= 0.012 * gather * gat;
      }
      const arch = Math.max(0, gather) * gat;
      p.backMid.y += (rearDy + foreDy) / 2 - 0.05 * arch;
      p.bellyMid.y += (rearDy + foreDy) / 2 - 0.03 * arch;
    }

    // --- a cat that stands still changes its feet now and then: one paw comes up, goes a little way along, and is put down again (a foot that has strayed comes back the next time)
    const standing = clip === "stand" && !frame.carried && sleepy < 0.4 && gaitW < 0.05;
    if (standing && this.shuffleAt >= 0) {
      const u = (this.time - this.shuffleAt) / 0.42;
      const k = this.shuffleKey;
      if (u >= 1) {
        this.padOff[k] = this.shuffleTo;
        this.padLift[k] = 0;
        this.shuffleAt = -1;
      } else {
        this.padOff[k] = lerp(this.shuffleFrom, this.shuffleTo, smoothstep(0, 1, u));
        this.padLift[k] = 0.04 * Math.sin(Math.PI * u);
      }
    } else if (standing && this.time >= this.nextShuffle) {
      const k = this.idle.weighted(["hn", "hf", "fn", "ff"] as const, (n) => (n === "hn" ? 0.35 : n === "hf" ? 0.25 : n === "fn" ? 0.25 : 0.15))!;
      this.shuffleKey = k;
      this.shuffleFrom = this.padOff[k];
      this.shuffleTo = Math.abs(this.shuffleFrom) > 0.02 ? 0 : this.idle.range(0.022, 0.04) * (this.idle.chance(0.5) ? 1 : -1);
      this.shuffleAt = this.time;
      this.nextShuffle = this.time + this.idle.range(5, 14);
    } else if (!standing) {
      // (anything else it does puts the feet back where the pose has them, without a jump)
      this.shuffleAt = -1;
      const fade = Math.exp(-7 * dt);
      for (const k of ["fn", "ff", "hn", "hf"] as const) {
        this.padOff[k] *= fade;
        this.padLift[k] *= fade;
      }
    }

    // --- where each paw is (a step when walking, the posture's own rest place when not)
    const pawTarget = (key: "fn" | "ff" | "hn" | "hf") => {
      const home = p[key];
      const step = gaitPaw(key, home.x, odoL, WALK_GAIT);
      let gx = step.x;
      let gy = step.y;
      if (stalkW > 0.001) {
        const creep = gaitPaw(key, home.x, odoL, STALK_GAIT);
        gx = lerp(gx, creep.x, stalkW);
        gy = lerp(gy, creep.y, stalkW);
      }
      if (gallop > 0.001) {
        const g = gallopPaw(key, home.x, odoL);
        gx = lerp(gx, g.x, gallop);
        gy = lerp(gy, g.y, gallop);
      }
      return { x: lerp(home.x, gx, gaitW) + this.padOff[key], y: lerp(home.y, gy, gaitW) - this.padLift[key] };
    };

    const fnTarget = pawTarget("fn");
    const ffTarget = pawTarget("ff");
    const hnTarget = pawTarget("hn");
    const hfTarget = pawTarget("hf");

    // --- the head: it is the head that is turned to what the cat looks at, but the eyes get there first
    const headX = p.head.x;
    const headY = p.head.y;
    let wantX = 0.35;
    let wantY = 0;
    let attending = false;
    // (a cat with a tilted head has its face to whoever it is looking at: the tilt would not be seen in a side view)
    const facingOut = frame.viewer || emote === "tilt";
    if (facingOut) {
      wantX = 0;
      wantY = 0.12;
      attending = true;
    } else if (emote === "think") {
      // (a look away and up, ahead of it: it is not looking at anything)
      wantX = 0.85;
      wantY = -0.9;
      attending = true;
    } else if (frame.look) {
      const baseX = frame.x + headX * px * frame.facing;
      const baseY = frame.y + headY * px;
      wantX = clamp(((frame.look.x - baseX) * frame.facing) / (0.55 * px), -1, 1);
      wantY = clamp((frame.look.y - baseY) / (0.55 * px), -1, 1);
      attending = true;
    }
    if (sniffing > 0.4) {
      // (down at what it is sniffing)
      wantX = 0.5;
      wantY = 1;
      attending = true;
    }
    // (a cat at rest looks about: now and then its eyes go to something, quickly, and its head follows a little way after them)
    const calm = (clip === "sit" || clip === "stand" || clip === "loaf") && sleepy < 0.45 && !attending && !frame.carried;
    if (this.time >= this.nextGaze) {
      this.gazeX = this.idle.chance(0.4) ? 0.35 : this.idle.range(-0.6, 1);
      this.gazeY = this.idle.range(-0.4, 0.5);
      this.nextGaze = this.time + this.idle.range(1.4, 5);
    }
    if (calm) {
      wantX = this.gazeX;
      wantY = this.gazeY;
    }
    smooth(this.eyeX, wantX, 11, dt);
    smooth(this.eyeY, wantY, 11, dt);
    const yawTarget = facingOut ? 0 : calm ? 0.28 + 0.25 * (wantX - 0.35) : clamp(wantX * 0.8, -0.85, 0.85);
    smooth(this.yaw, yawTarget, attending ? 3.2 : 1.6, dt);
    smooth(this.tilt, wantY * (calm ? 0.2 : 0.28), 3, dt);

    // --- one-offs on the pose: a yawn, a stretch of the neck, being petted, grooming, pointing
    let jawTarget = 0;
    // (the walk's head: thrust forward with the shoulders, and a nod that follows them)
    let headRotExtra = -0.025 * rockLate;
    let headShiftX = 0.012 * rock;
    let headShiftY = -0.006 * rockLate;
    // (a yawn and a stretch follow their own shapes, but are only let out of them at a pace: one that is cut short, by a click or a fright, is undone in a quarter of a second or so, not in a frame)
    const yawning = clip === "yawn";
    const yt = frame.progress;
    this.yawnDyn.x += clamp((yawning ? smoothstep(0.08, 0.36, yt) * (1 - smoothstep(0.64, 0.86, yt)) : 0) - this.yawnDyn.x, -4 * dt, 6 * dt);
    const yawnOpen = clamp01(this.yawnDyn.x);
    if (yawnOpen > 0.001 || yawning) {
      // slowly open, hold (with a tremor at the top of it), close more quickly: the head goes back and up as the jaw drops and the chest is filled; the head is shaken when it is over
      const top = yawning ? smoothstep(0.3, 0.42, yt) * (1 - smoothstep(0.6, 0.7, yt)) : 0;
      const tremor = Math.sin(frame.clipTime * TAU * 13) * top;
      const shake = yawning ? smoothstep(0.86, 0.9, yt) * (1 - smoothstep(0.96, 1, yt)) * Math.sin(((yt - 0.86) / 0.14) * TAU * 2.5) : 0;
      const lick = yawning && yt > 0.9 ? Math.sin(((yt - 0.9) / 0.1) * Math.PI) : 0;
      jawTarget = yawnOpen * (1 + 0.04 * tremor) + 0.1 * lick;
      headRotExtra = -0.6 * yawnOpen + 0.012 * tremor + 0.08 * shake;
      headShiftX = 0.012 * yawnOpen + 0.003 * tremor + 0.008 * shake;
      headShiftY = -0.03 * yawnOpen;
      // (the chest is filled: the front of the cat goes up and forward with the head)
      p.chestFront.y -= 0.022 * yawnOpen;
      p.neckTop.y -= 0.014 * yawnOpen;
      p.shoulderTop.y -= 0.01 * yawnOpen;
      p.chestFront.x += 0.012 * yawnOpen;
    }
    // (held, a stretch goes on: the chest sinks a little further, the forepaws slide out along the floor, and a tremor runs through the held pose)
    const stretching = clip === "stretch";
    const st = frame.progress;
    this.stretchDyn.x += clamp((stretching ? smoothstep(0.1, 0.34, st) * (1 - smoothstep(0.72, 0.92, st)) : 0) - this.stretchDyn.x, -3 * dt, 6 * dt);
    const stretchHold = clamp01(this.stretchDyn.x);
    this.creepDyn.x += clamp((stretching ? smoothstep(0.22, 0.7, st) * stretchHold : 0) - this.creepDyn.x, -3 * dt, 6 * dt);
    if (stretchHold > 0.001) {
      const creep = clamp01(this.creepDyn.x);
      const shiver = Math.sin(frame.clipTime * TAU * 9) * (stretching ? smoothstep(0.4, 0.6, st) : 0) * stretchHold;
      p.chestFront.y += 0.014 * creep + 0.0015 * shiver;
      p.shoulderTop.y += 0.012 * creep + 0.0015 * shiver;
      p.neckTop.y += 0.012 * creep;
      headShiftY += 0.012 * creep;
      fnTarget.x += 0.03 * creep;
      ffTarget.x += 0.03 * creep;
    }
    if (gat > 0.001) {
      // (the neck is stretched out and the head low, the nose down, and it comes up a little with the shoulders)
      headShiftX += 0.03 * gat;
      headShiftY += (0.025 + 0.02 * (1 - foreUp)) * gat;
      headRotExtra += 0.1 * gat;
    }
    // --- a swat at a poster: the weight goes forward onto the front of the cat with the paw's cocking and its stroke (the shoulders sink, the head goes down and forward to the
    // poster, the rump comes up a little and the other forepaw reaches out to take the weight), and is eased out of when the swat is over. The paw itself is placed below, with the others
    const swing = clip === "swat" && frame.reach ? swatPose(frame.progress) : null;
    smooth(this.swatDyn, swing ? swing.lean : 0, swing ? 14 : 5, dt);
    const leaning = clamp(this.swatDyn.x, -0.6, 1);
    if (Math.abs(leaning) > 0.001) {
      for (const k of ["shoulder", "shoulderTop", "chestFront", "neckTop"] as const) {
        p[k].x += 0.06 * leaning;
        p[k].y += 0.09 * leaning;
      }
      headShiftX += 0.06 * leaning;
      headShiftY += 0.1 * leaning;
      headRotExtra += 0.3 * leaning;
      for (const k of ["rumpTop", "rumpBack"] as const) p[k].y -= 0.025 * leaning;
      ffTarget.x += 0.04 * Math.max(0, leaning);
    }
    // (and as the paw lands the tail lashes, and an ear goes back)
    if (swing && this.prevProgress < SWAT_HIT && frame.progress >= SWAT_HIT) {
      this.tipKick.v += this.rng.range(10, 14) * (this.rng.chance(0.5) ? -1 : 1);
      (this.rng.chance(0.5) ? this.earKickL : this.earKickR).v -= this.rng.range(8, 12);
    }
    const pawOn = clip === "groom" || clip === "point" || clip === "tap" || clip === "swat" ? 1 : 0;
    // (a paw goes up quickly and comes down gently: put down in a few frames, it would drop like a stone; a wash takes its time raising it to the face)
    smooth(this.pawOn, pawOn, pawOn > 0.5 ? (clip === "groom" ? 2.6 : 6) : 2.2, dt);
    // (a paw that is let go of comes down from where it was, by its weight going: its goal is not moved to the floor ahead of it, which put it down in a tenth of a second)
    let pawGoalX = pawOn > 0.5 ? p.fn.x : this.pawX.x;
    let pawGoalY = pawOn > 0.5 ? 0 : this.pawY.x;
    if (pawOn < 0.5 && this.pawOn.x < 0.004) {
      // (down and weightless: ready for the next one to start from the floor)
      pawGoalX = p.fn.x;
      pawGoalY = 0;
      this.pawX.x = pawGoalX;
      this.pawX.v = 0;
      this.pawY.x = pawGoalY;
      this.pawY.v = 0;
    }
    smooth(this.groomDyn, clip === "groom" ? 1 : 0, 3, dt);
    // washing its face: the head bows to the paw at the mouth, tips into it as it goes over, and the eye on that side shuts as it passes. All of it is eased into and out of (the sweep
    // too, which is a spring after the clip's own beat), so that a wash that is ended, or cut short, is not a head that snaps back
    const bow = clamp01(this.groomDyn.x);
    const beat = fract(frame.clipTime / GROOM_BEAT);
    smooth(this.sweepDyn, clip === "groom" && beat >= GROOM_LICK ? 0.5 - 0.5 * Math.cos(TAU * ((beat - GROOM_LICK) / (1 - GROOM_LICK))) : 0, 9, dt);
    const sweep = clamp01(this.sweepDyn.x);
    const groomSweep = sweep * bow;
    if (bow > 0.001) {
      headShiftX += (0.035 + 0.02 * sweep) * bow;
      headShiftY += (0.15 - 0.045 * sweep) * bow;
      headRotExtra += (0.3 + 0.16 * sweep) * bow;
    }
    if (clip === "groom") {
      // the paw is licked at the mouth (the jaw works a little), then drawn up the cheek, over the eye and the ear, held a moment behind it, and drawn down again
      // (the licks: the jaw opens a little twice while the paw is at the mouth)
      if (beat < GROOM_LICK) jawTarget = Math.max(jawTarget, 0.2 * Math.sin((beat / GROOM_LICK) * Math.PI * 2) ** 2 * bow);
      // (the paw's way, in the head's own terms: forward along the face and up it, from the mouth through the cheek and the eye to behind the ear; the head's tilt is carried with it)
      const q = sweep * (GROOM_PATH.length - 1);
      const k0 = Math.min(GROOM_PATH.length - 2, Math.floor(q));
      const f = q - k0;
      const a0 = GROOM_PATH[k0]!;
      const a1 = GROOM_PATH[k0 + 1]!;
      const lx = lerp(a0[0], a1[0], f);
      const ly = lerp(a0[1], a1[1], f);
      const rot = pose.s.headRot + headRotExtra + this.tilt.x;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      pawGoalX = headX + headShiftX + lx * cr + ly * sr;
      pawGoalY = headY + headShiftY - (-lx * sr + ly * cr);
    } else if ((clip === "point" || clip === "tap") && frame.reach) {
      const dx = ((frame.reach.x - frame.x) * frame.facing) / px;
      const dy = (frame.reach.y - frame.y) / px;
      const ox = p.shoulder.x;
      const oy = p.shoulder.y;
      const ang = Math.atan2(dy - oy, dx - ox);
      const a = clamp(ang, -1.4, 1.0);
      // (a tap is the same reach, drawn back and put out again, quickly, a few times a second: the paw is out at the top of each, and back by half as much between)
      const strike = clip === "tap" ? 0.5 + 0.5 * Math.sin(frame.clipTime * TAU * 2.4 - 0.6) : 1;
      const len = 0.37 * (clip === "tap" ? 0.58 + 0.42 * strike ** 1.5 : 1);
      pawGoalX = ox + Math.cos(a) * len;
      pawGoalY = oy + Math.sin(a) * len;
      if (clip === "tap") {
        // (it leans into each, a little)
        p.shoulderTop.x += 0.012 * strike * clamp01(this.pawOn.x);
        p.chestFront.x += 0.012 * strike * clamp01(this.pawOn.x);
      }
    } else if (swing && frame.reach) {
      // (the swat: the paw swung round the shoulder, off the line to the poster, and in and out along it: up and back to cock it, down through the line to land, back to rest)
      const ox = p.shoulder.x;
      const oy = p.shoulder.y;
      const aim = clamp(Math.atan2((frame.reach.y - frame.y) / px - oy, ((frame.reach.x - frame.x) * frame.facing) / px - ox), -0.6, 1.5);
      const a = Math.max(-2.2, aim + swing.turn);
      pawGoalX = ox + Math.cos(a) * swing.reach;
      pawGoalY = oy + Math.sin(a) * swing.reach;
    }
    // (a swat is quick: the paw follows its stroke closely, not at the pace of a paw that is put out to point)
    const pawHz = clip === "groom" ? 11 : swing ? 24 : 7;
    smooth(this.pawX, pawGoalX, pawHz, dt);
    smooth(this.pawY, pawGoalY, pawHz, dt);
    const pw = clamp01(this.pawOn.x);
    fnTarget.x = lerp(fnTarget.x, this.pawX.x, pw);
    fnTarget.y = lerp(fnTarget.y, this.pawY.x, pw);

    fnTarget.y -= 0.03 * dream;

    // --- sniffing: the front of the cat goes down, the nose to the ground, and bobs a little with each breath in
    if (sniffing > 0.001) {
      const nose = Math.sin(frame.clipTime * TAU * 3.6);
      for (const k of ["shoulderTop", "chestFront", "shoulder"] as const) p[k].y += 0.05 * sniffing;
      p.neckTop.y += 0.14 * sniffing;
      headShiftX += (0.09 + 0.008 * nose) * sniffing;
      headShiftY += (0.4 + 0.012 * nose) * sniffing;
      headRotExtra += 0.55 * sniffing;
    }

    // --- looking over an edge: the front of the cat goes down and forward, the neck out, the head out over what it looks at, the forepaws planted at the lip and the rump a
    // little up as the weight comes forward
    if (peeking > 0.001) {
      for (const k of ["shoulderTop", "chestFront", "shoulder"] as const) p[k].y += 0.035 * peeking;
      p.neckTop.y += 0.09 * peeking;
      p.neckTop.x += 0.02 * peeking;
      headShiftX += 0.085 * peeking;
      headShiftY += 0.2 * peeking;
      headRotExtra += 0.42 * peeking;
      fnTarget.x += 0.035 * peeking;
      ffTarget.x += 0.035 * peeking;
      for (const k of ["rumpTop", "rumpBack"] as const) p[k].y -= 0.012 * peeking;
    }

    // --- nodding off: the head sinks slowly and comes up with a start, and sinks again, deeper each time; the lids go with it
    let dozeLid = 0;
    if (dozing > 0.001) {
      const u = fract(frame.clipTime / 3.6);
      const sink = u < 0.82 ? smoothstep(0, 0.82, u) ** 1.3 : 1 - smoothstep(0.82, 0.93, u);
      const depth = (0.45 + 0.55 * clamp01(frame.clipTime / 9)) * dozing;
      headShiftX += 0.02 * sink * depth;
      headShiftY += 0.11 * sink * depth;
      headRotExtra += 0.4 * sink * depth;
      p.neckTop.y += 0.03 * sink * depth;
      dozeLid = dozing * (0.3 + 0.55 * sink * depth);
    }

    // --- a sleeper changing its place: the head comes up, the eyes half open, an ear flicks, and the head goes down again (the body does the rest: see the posture's weights)
    let shiftLift = 0;
    if (shifting > 0.001) {
      shiftLift = smoothstep(0.1, 0.3, frame.progress) * (1 - smoothstep(0.62, 0.86, frame.progress)) * shifting;
      headShiftY -= 0.07 * shiftLift;
      headRotExtra -= 0.25 * shiftLift;
      if (this.prevProgress < 0.14 && frame.progress >= 0.14) (this.rng.chance(0.5) ? this.earKickL : this.earKickR).v += this.rng.range(8, 12) * (this.rng.chance(0.5) ? -1 : 1);
    }
    this.prevProgress = frame.progress;

    // --- how it feels, on the face and the head (and a little of the body): see `Emote`
    if (tilting > 0.001) headRotExtra += this.tiltSign * 0.34 * tilting;
    if (thinking > 0.001) {
      headRotExtra += -0.2 * thinking;
      headShiftY -= 0.015 * thinking;
    }
    if (drooping > 0.001) {
      headShiftY += 0.05 * drooping;
      headShiftX -= 0.01 * drooping;
      headRotExtra += 0.22 * drooping;
    }
    if (startled > 0.001) {
      // (a flinch: the head back and up, the back arched and the whole of it drawn in)
      headShiftX -= 0.04 * startled;
      headShiftY -= 0.025 * startled;
      p.backMid.y -= 0.035 * startled;
      p.rumpTop.y -= 0.02 * startled;
      p.shoulderTop.y += 0.015 * startled;
    }
    if (joyful > 0.001) {
      // (a lift of the chest and of the head)
      p.shoulderTop.y -= 0.014 * joyful;
      p.chestFront.y -= 0.01 * joyful;
      headShiftY -= 0.02 * joyful;
    }
    if (annoyed > 0.001) {
      // (a cat that was handled and did not like it: the head low and the chin in, the whole of it a little drawn down)
      headShiftY += 0.02 * annoyed;
      headRotExtra += 0.1 * annoyed;
      p.backMid.y += 0.008 * annoyed;
    }
    if (shaking > 0.001) {
      // (a shake: the head thrown from side to side, the neck with it)
      headShiftX += 0.06 * shaking * shakeBeat;
      headRotExtra += 0.35 * shaking * Math.sin(this.time * TAU * 11.5 + 0.6);
      p.neckTop.x += 0.02 * shaking * shakeBeat;
      p.shoulderTop.x += 0.012 * shaking * shakeBeat;
    }
    if (fight > 0.001 && held > 0.001) {
      // (and a cat in a hand throws its head about with the twisting of its body, the face turned to the hand, a beat behind)
      headRotExtra += 0.2 * fight * held * Math.sin(TAU * this.twist + 0.7);
      headShiftX += 0.012 * fight * held * Math.sin(TAU * this.twist + 2.1);
    }

    // --- scratching behind the ear: the head goes down to meet the hind foot, which comes up to it and works fast
    let kneeUp = 0;
    const hockHind = { x: p.hock.x, y: p.hock.y };
    const hockFar = { x: p.hock.x, y: p.hock.y };
    // --- a leap on its way down: the hind legs come forward under the cat (the foot bent at the hock again) and the forelegs reach down for the ground
    // (and it lets go of that quickly but not in a frame: the legs go back over a tenth of a second or so at the landing, on top of the speed limit below, which alone left
    // two steps of a knee's swing in a row in the engine's own leaps)
    const fallingNow = jumping && !frame.grounded ? smoothstep(80, 520, frame.vy) : 0;
    smooth(this.fallDyn, fallingNow, fallingNow > this.fallDyn.x ? 16 : 9, dt);
    const falling = clamp01(this.fallDyn.x);
    if (falling > 0.001) {
      fnTarget.x -= 0.05 * falling;
      fnTarget.y += 0.13 * falling;
      ffTarget.x -= 0.05 * falling;
      ffTarget.y += 0.15 * falling;
      hnTarget.x += 0.5 * falling;
      hnTarget.y += 0.1 * falling;
      hfTarget.x += 0.5 * falling;
      hfTarget.y += 0.12 * falling;
      for (const h of [hockHind, hockFar]) {
        h.x = lerp(h.x, -0.07, falling);
        h.y = lerp(h.y, -0.15, falling);
      }
    }
    if (scratching > 0.001) {
      const shake = Math.sin(frame.clipTime * TAU * 8.5);
      // (the cat folds to meet its own foot: the head goes down and back over the shoulder, the neck and the chest lean back with it, and the head is shaken a little by the scratching)
      headShiftX += (-0.1 + 0.004 * shake) * scratching;
      headShiftY += (0.2 + 0.008 * shake) * scratching;
      headRotExtra += (0.5 + 0.06 * shake) * scratching;
      p.neckTop.x -= 0.04 * scratching;
      p.chestFront.x -= 0.035 * scratching;
      p.neckTop.y += 0.025 * scratching;
      // (the hip comes forward and up as the leg is lifted, and the foot is where the ear is: the head's middle, a little up and back)
      p.hip.x += 0.07 * scratching;
      p.hip.y -= 0.04 * scratching;
      hnTarget.x = lerp(hnTarget.x, headX + headShiftX - 0.02 + 0.026 * shake, scratching);
      hnTarget.y = lerp(hnTarget.y, headY + headShiftY - 0.02 + 0.034 * shake, scratching);
      // (the foot points up and forward from the hock; the knee is below the leg's line, by the belly, instead of behind and above)
      hockHind.x = lerp(hockHind.x, -0.1, scratching);
      hockHind.y = lerp(hockHind.y, 0.15, scratching);
      kneeUp = scratching;
    }

    // --- kneading: the forepaws take turns to reach out, press down and draw back, and the body rocks with them
    if (kneading > 0.001) {
      const beat = frame.clipTime * 1.3;
      for (const [paw, offset] of [[fnTarget, 0], [ffTarget, 0.5]] as const) {
        const f = fract(beat + offset);
        const out = f < 0.5 ? easeInOut(f / 0.5) : 1 - easeInOut((f - 0.5) / 0.5);
        const up = f < 0.5 ? Math.sin((f / 0.5) * Math.PI) : 0;
        paw.x = lerp(paw.x, paw.x + 0.04 * out - 0.02, kneading);
        paw.y = lerp(paw.y, paw.y - 0.075 * up, kneading);
      }
      const rock = Math.sin(beat * TAU * 2) * kneading;
      p.shoulderTop.y += 0.006 * rock;
      p.chestFront.y += 0.006 * rock;
      headShiftY += (0.03 + 0.005 * rock) * kneading;
      headRotExtra += 0.2 * kneading;
    }

    // --- the wiggle before a pounce: the rump comes up and works from side to side, the feet stay where they are
    if (wiggling > 0.001) {
      const w = Math.sin(frame.clipTime * TAU * 5.5) * wiggling;
      const w2 = Math.sin(frame.clipTime * TAU * 5.5 + 0.8) * wiggling;
      for (const k of ["rumpBack", "rumpTop", "rumpBottom", "tailRoot"] as const) {
        p[k].x += 0.022 * w;
        p[k].y -= 0.03 * wiggling;
      }
      p.hip.x += 0.014 * w2;
      p.hip.y -= 0.02 * wiggling;
      p.groin.x += 0.012 * w2;
      p.backMid.y -= 0.01 * wiggling;
      headShiftY += 0.01 * wiggling;
    }

    // --- hanging by the scruff (or by the forepaws, from a lip: the hind legs and the tail hang the same): the legs dangle straight down in the world, whichever way the body is tipped (the
    // forelegs folded a little, the hind legs longer and loose), and sway a little, out of step with each other
    if (hung > 0.001) {
      const dx = Math.sin(s.pitch);
      const dy = Math.cos(s.pitch);
      const loose = Math.sin(this.time * 2.1) * 0.012;
      // (a place from a root, in the world's own terms: `wx` on the way the cat faces, `wy` down. The kicks and the swipes are the world's too, whichever way the body is tipped)
      const dangle = (paw: { x: number; y: number }, root: { x: number; y: number }, wx: number, wy: number): void => {
        paw.x = lerp(paw.x, root.x + dy * wx + dx * wy, hung);
        paw.y = lerp(paw.y, root.y - dx * wx + dy * wy, hung);
      };
      // (the hind legs kick, one and then the other, the foot coming up and forward and going back and down; the forepaws, when it fights hard, are put up at the hand and swiped, the other
      // after it. A calm cat's legs hang a little forward of its hips, the forelegs folded)
      const kicking = (ph: number): { x: number; y: number } => {
        const c = TAU * (this.kick + ph);
        return { x: 0.17 * fight * Math.sin(c), y: -0.12 * fight * Math.max(0, Math.cos(c)) - 0.05 * fight };
      };
      const swiping = smoothstep(0.25, 0.7, fight);
      const swipeOf = (ph: number): number => {
        const u = fract(this.swipe + ph);
        return swiping * (u < 0.4 ? 1 - (1 - u / 0.4) ** 2 : 1 - ((u - 0.4) / 0.6) ** 2);
      };
      const tuck = 1 - fight;
      const kn = kicking(0);
      const kf = kicking(0.5);
      const an = swipeOf(0);
      const af = swipeOf(0.5);
      dangle(fnTarget, p.shoulder, lerp(loose, 0.26, an), lerp(0.3, -0.22, an));
      dangle(ffTarget, p.shoulder, lerp(-loose, 0.26, af), lerp(0.33, -0.22, af));
      dangle(hnTarget, p.hip, -loose * 1.3 + 0.04 * tuck + kn.x, 0.42 + kn.y);
      dangle(hfTarget, p.hip, loose * 1.3 + 0.04 * tuck + kf.x, 0.4 + kf.y);
      // (and the feet hang from the hocks)
      for (const h of [hockHind, hockFar]) {
        h.x = lerp(h.x, -dx * 0.12, hung);
        h.y = lerp(h.y, -dy * 0.12, hung);
      }
      // (the head is held level against the tipped body, chin up a little)
      headRotExtra += 0.75 * held;
      headShiftY -= 0.01 * held;
    }

    // --- hanging by the forepaws from a lip, and hauling itself up (see `climbPose`): the forelegs reach for the lip and then lie on the ledge, the hind legs hang (above) and then pedal
    // against the face of the ledge, one and then the other, and the head is up, looking over the lip
    if (climbing > 0.001) {
      const c = Math.cos(s.pitch);
      const n = Math.sin(s.pitch);
      const shiftX = cp.x + this.shiftOffX.x;
      const shiftY = cp.y + this.shiftOffY.x;
      // (a place on the screen, from the point the cat ends up standing at, as the cat's own numbers have it: against the shift, and the tip of the body about its middle)
      const local = (wx: number, wy: number): { x: number; y: number } => {
        const rx = wx - shiftX;
        const ry = wy - shiftY + 0.4;
        return { x: c * rx + n * ry, y: -n * rx + c * ry - 0.4 };
      };
      const gripping = climbPaws(cp.top);
      const reaching = climbing * cp.paws;
      const near = local(gripping.near.x, gripping.near.y);
      const far = local(gripping.far.x, gripping.far.y);
      fnTarget.x = lerp(fnTarget.x, near.x, reaching);
      fnTarget.y = lerp(fnTarget.y, near.y, reaching);
      ffTarget.x = lerp(ffTarget.x, far.x, reaching);
      ffTarget.y = lerp(ffTarget.y, far.y, reaching);
      // (a paw's way is a small ellipse in the world, turned into the body's own numbers)
      const pedal = this.time * TAU * 3.7;
      const scramble = cp.scramble * climbing;
      for (const [paw, phase] of [[hnTarget, 0], [hfTarget, Math.PI]] as const) {
        const wx = 0.085 * Math.sin(pedal + phase) * scramble;
        const wy = -0.065 * Math.max(0, Math.cos(pedal + phase)) * scramble;
        paw.x += c * wx + n * wy;
        paw.y += -n * wx + c * wy;
      }
      const looksUp = Math.max(0, climbHang - held);
      headRotExtra += 0.75 * looksUp * clamp01(-s.pitch / 1.2);
      headShiftY -= 0.01 * looksUp;
    }

    if (frame.petted) {
      // (it pushes up into the hand, one way and then the other, and back)
      const bunt = Math.sin(this.time * TAU * 0.9);
      headShiftX += 0.025 + 0.012 * bunt;
      headShiftY += -0.03 - 0.012 * bunt;
      headRotExtra += -0.25;
    }
    smooth(this.jawDyn, jawTarget, clip === "yawn" ? 6 : 12, dt);
    smooth(this.happyDyn, frame.petted ? 1 : Math.max(kneading * 0.9, scratching * 0.5), 6, dt);
    // (a sleeper that half wakes has its eyes a little open: the closed line is for a face that is asleep)
    smooth(this.asleepDyn, clamp01((sleepy - 0.55) / 0.35) * (1 - clamp01(shiftLift * 2.4)), 5, dt);

    // --- legs
    const solveFront = (leg: Leg, root: { x: number; y: number }, paw: { x: number; y: number }, raised: number) => {
      // (a paw on the ground has its wrist a little above it; one that is raised is the end of the leg: eased between, not switched)
      const wristY = paw.y - FRONT_WRIST * (1 - clamp01(raised));
      const j = twoBone(root.x, root.y, paw.x, wristY, FRONT_UPPER, FRONT_LOWER, 1);
      leg.root.x = root.x;
      leg.root.y = root.y;
      leg.mid.x = j.jx;
      leg.mid.y = j.jy;
      leg.hock.x = j.ex;
      leg.hock.y = j.ey;
      leg.toe.x = paw.x;
      leg.toe.y = paw.y;
      leg.lift = -paw.y;
    };
    const solveHind = (leg: Leg, root: { x: number; y: number }, paw: { x: number; y: number }, off = p.hock, kneeSide = 0) => {
      const hock = { x: paw.x + off.x, y: paw.y + off.y };
      const j = twoBone(root.x, root.y, hock.x, hock.y, HIND_UPPER, HIND_LOWER, -1);
      // (a leg lifted to the head bends the other way: the two solutions are one at full stretch, so the knee goes from one to the other)
      const k = kneeSide > 0 ? twoBone(root.x, root.y, hock.x, hock.y, HIND_UPPER, HIND_LOWER, 1) : j;
      leg.root.x = root.x;
      leg.root.y = root.y;
      leg.mid.x = lerp(j.jx, k.jx, kneeSide);
      leg.mid.y = lerp(j.jy, k.jy, kneeSide);
      leg.hock.x = j.ex;
      leg.hock.y = j.ey;
      leg.toe.x = paw.x;
      leg.toe.y = paw.y;
      leg.lift = -paw.y;
    };
    // (a shoulder blade slides on the ribs: back as the leg goes back, forward as it reaches, and up as the paw is lifted, so a foreleg is not hinged to a fixed point)
    const shoulderOf = (rootX: number, paw: { x: number; y: number }, home: { x: number; y: number }): { x: number; y: number } => ({
      x: rootX + (1 - hung) * clamp(0.1 * (paw.x - home.x), -0.03, 0.04),
      y: p.shoulder.y - (1 - hung) * 0.25 * clamp(-paw.y, 0, 0.08),
    });
    // (a leap's feet are only let go so fast: the posture changes at 9 Hz at the take-off and the landing, the hips drop as the feet reach, and a leg that is folded double swings its knee
    // about the hip by more than the foot moves, in a frame: this is what the foot's speed is held to, while it leaps and for a moment after, and not otherwise)
    smooth(this.leapDyn, jumping || climbClip ? 1 : 0, jumping || climbClip ? 20 : 3, dt);
    const leapLimit = lerp(100, LEAP_FOOT_SPEED, clamp01(this.leapDyn.x)) * dt;
    for (const [key, target] of [["fn", fnTarget], ["ff", ffTarget], ["hn", hnTarget], ["hf", hfTarget]] as const) {
      const last = this.footAt[key];
      if (last.ready) {
        const dx = target.x - last.x;
        const dy = target.y - last.y;
        const len = Math.hypot(dx, dy);
        if (len > leapLimit) {
          target.x = last.x + (dx * leapLimit) / len;
          target.y = last.y + (dy * leapLimit) / len;
        }
      }
      last.x = target.x;
      last.y = target.y;
      last.ready = true;
    }
    // (a paw on a lip is the end of the leg, as a paw in the air is)
    const gripped = climbing * cp.paws;
    solveFront(s.legs.fn, shoulderOf(p.shoulder.x, fnTarget, p.fn), fnTarget, Math.max(pw, hung, gripped));
    solveFront(s.legs.ff, shoulderOf(p.shoulder.x - 0.02, ffTarget, p.ff), ffTarget, Math.max(hung, gripped));
    solveHind(s.legs.hn, p.hip, hnTarget, hockHind, kneeUp);
    solveHind(s.legs.hf, { x: p.hip.x + 0.03, y: p.hip.y }, hfTarget, hockFar);

    // --- the face: blinking, ear flicks, how wide the eyes are
    if (this.time >= this.nextBlink && this.blinkAt < 0 && sleepy < 0.6) {
      this.blinkAt = this.time;
      this.blinkAgain = this.rng.chance(0.18);
      this.nextBlink = this.time + this.rng.range(2.2, 6.2);
    }
    let blink = 0;
    if (this.blinkAt >= 0) {
      const t = (this.time - this.blinkAt) / 0.2;
      if (t >= 1) {
        this.blinkAt = this.blinkAgain ? this.time + 0.05 - 0.2 : -1;
        this.blinkAgain = false;
      } else blink = Math.sin(clamp01(t) * Math.PI);
    }
    // a slow blink at whoever is looking out of the screen: the eyes close gently, stay shut a moment, and open as gently (a cat's kiss)
    if (facingOut && this.slowAt < 0 && this.time >= this.nextSlow && sleepy < 0.5 && this.blinkAt < 0) {
      this.slowAt = this.time;
      this.nextSlow = this.time + this.rng.range(14, 30);
    }
    if (this.slowAt >= 0) {
      const t = this.time - this.slowAt;
      blink = Math.max(blink, smoothstep(0, 0.45, t) * (1 - smoothstep(0.7, 1.2, t)));
      if (t >= 1.2) this.slowAt = -1;
    }
    if (this.time >= this.nextTwitch && sleepy < 0.9) {
      const left = this.rng.chance(0.5);
      (left ? this.earKickL : this.earKickR).v += this.rng.range(14, 22) * (left ? -1 : 1) * 0.1 * 10;
      this.nextTwitch = this.time + this.rng.range(2.5, 9) * (1 + sleepy);
    }
    const alert = clamp01(frame.energy * 0.6 + (attending ? 0.3 : 0));
    // (in a yawn the ears go back)
    // (and in a run they are laid back)
    // (a flinch lays them flat back; a letdown lets them out to the sides; a cat that is pleased, or that asks itself something, has them up and forward)
    const earRest =
      lerp(0.12, 0.42, sleepy) - alert * 0.12 + (frame.petted ? 0.25 : 0) + this.jawDyn.x * 0.3 + this.groomDyn.x * 0.12 + groomSweep * 0.3 + gat * 0.22 + hung * 0.4 + 0.85 * startled + 0.34 * drooping + 0.9 * annoyed + 0.55 * fight - 0.1 * joyful - 0.08 * tilting - 0.05 * thinking;
    smooth(this.earBaseL, earRest, 4, dt);
    smooth(this.earBaseR, earRest, 4, dt);
    bounce(this.earKickL, 0, 9, 0.35, dt);
    bounce(this.earKickR, 0, 9, 0.35, dt);
    // (the pupils are wide in the hunt, and when it is taken up by the scruff)
    smooth(this.pupilDyn, Math.max(lerp(0.34, 0.9, clamp01(frame.energy * 0.8 + (attending ? 0.2 : 0))) * (1 - sleepy * 0.5) * (1 - 0.45 * annoyed), 0.95 * hunt, 0.92 * hung, 1.0 * startled, 0.85 * joyful, 0.97 * fight), startled > 0.3 ? 14 : 4, dt);

    // --- the flip when it turns around: through a face-on moment, not a snap
    if (frame.facing !== this.facing) {
      this.facing = frame.facing;
    }
    smooth(this.flipDyn, frame.facing, 6.5, dt);
    const turning = 1 - Math.abs(this.flipDyn.x);
    s.flip = this.flipDyn.x;
    const faceFront = clamp01(turning * 1.4);

    // --- the head, as the painter needs it
    const hd = s.head;
    hd.x = headX + headShiftX + Math.sin(this.time * 0.9) * 0.004 * (1 - sleepy);
    hd.y = headY + headShiftY + chest * 0.4;
    hd.rot = pose.s.headRot + headRotExtra + this.tilt.x;
    hd.yaw = this.yaw.x * (1 - faceFront);
    hd.eyeX = clamp(this.eyeX.x, -1, 1);
    hd.eyeY = clamp(this.eyeY.x, -1, 1);
    const lidBase = lerp(1, 0.08, clamp01((sleepy - 0.3) / 0.6));
    // (the eyes screw shut in a yawn, and are half shut in a wash)
    // (half shut in a scratch, and heavy in kneading)
    // (nodding off, the lids are heavy, and heaviest as the head sinks; half waking, they are a little open; a slow blink in a letdown)
    const open = Math.max(
      lidBase * (1 - blink) * (1 - 0.92 * smoothstep(0.1, 0.5, this.jawDyn.x)) * (1 - clamp01(this.groomDyn.x) * (0.4 + 0.5 * groomSweep)) * (1 - 0.7 * scratching) * (1 - 0.55 * kneading) * (1 - dozeLid) * (1 - 0.25 * drooping) * (1 - 0.3 * annoyed) * (1 - 0.3 * fight),
      0.45 * shiftLift,
    );
    hd.openL = open;
    hd.openR = open;
    hd.pupil = this.pupilDyn.x;
    // (an awake cat's ears are never quite still: each turns, slowly and by itself, to what it hears)
    const listen = (1 - clamp01(sleepy * 1.6)) * (1 - 0.5 * gaitW) * (1 - startled);
    const ph = this.earPhase;
    const scanL = (0.085 * Math.sin(this.time * 0.7 + ph[0]!) + 0.06 * Math.sin(this.time * 2.1 + ph[1]!)) * listen;
    const scanR = (0.085 * Math.sin(this.time * 0.6 + ph[2]!) + 0.06 * Math.sin(this.time * 1.9 + ph[3]!)) * listen;
    // (the ears are flapped by a shake, and flattened by a fight)
    const flap = 0.3 * shaking * Math.sin(this.time * TAU * 11.5 + 1.1);
    hd.earL = this.earBaseL.x + this.earKickL.x + scanL + flap;
    hd.earR = this.earBaseR.x + this.earKickR.x + scanR - flap;
    // (and a cat that is carried says what it thinks of it, now and then: the mouth opens for a moment, the eyes and the ears stay as they are; and the harder it fights the oftener and the wider,
    // a yowl, then a pause for breath)
    hd.jaw = this.jawDyn.x + held * Math.max(0, Math.sin(this.time * TAU * 0.55)) ** 3 * 0.4 + fight * 0.7 * (0.5 + 0.5 * Math.sin(this.time * TAU * 1.5)) ** 2;
    hd.happy = this.happyDyn.x;
    hd.asleep = this.asleepDyn.x;

    // --- the tail trails what the body does
    smooth(this.startleTail, startled, 4.5, dt);
    const startledTail = clamp01(this.startleTail.x);
    const ax = ((frame.vx - this.prevVx) / dt / px) * frame.facing;
    this.prevVx = frame.vx;
    smooth(this.tailRoot, clamp(-ax * 0.035, -0.6, 0.6), 5, dt);
    // (the tip of a hunting cat's tail twitches, quickly)
    // (and quivers, held up, in joy; a flinch has it up and stiff; a letdown has it low and still)
    // (a tail that lashes: a cat that fights a hand, or is annoyed, swings it wide and quick)
    const swayAmp = lerp(0.09, 0.02, sleepy) + frame.energy * 0.22 + (frame.petted ? 0.12 : 0) + hunt * 0.12 + hung * 0.1 + 0.2 * joyful + 0.1 * startledTail - 0.05 * drooping + 0.08 * stretchHold + 0.4 * fight + 0.3 * annoyed;
    const swayRate = lerp(0.55, 0.2, sleepy) + frame.energy * 0.9 + hunt * 0.9 + 1.4 * joyful + 0.8 * stretchHold + 1.8 * fight + 1.4 * annoyed;
    // (in a run the tail streams out behind it, nearly straight, instead of going up and over; hanging in a hand it hangs straight down in the world, whichever way the body is tipped)
    const streaming = clamp01(this.gallopTail.x);
    // (a tail has weight: what the posture does to it, a jump's gather and its reach, a landing and a stand, it follows a moment behind, and does not whip with it)
    if (!this.tailPoseReady) {
      for (const [d, v] of [[this.tailPoseAngle, pose.s.tailAngle], [this.tailPoseCurl, pose.s.tailCurl], [this.tailPoseFront, pose.s.tailFront]] as const) {
        d.x = v;
        d.v = 0;
      }
      this.tailPoseReady = true;
    }
    smooth(this.tailPoseAngle, pose.s.tailAngle, TAIL_POSE_HZ, dt);
    smooth(this.tailPoseCurl, pose.s.tailCurl, TAIL_POSE_HZ, dt);
    smooth(this.tailPoseFront, pose.s.tailFront, TAIL_POSE_HZ, dt);
    const running = lerp(this.tailPoseAngle.x, 3.35, streaming);
    let tailBase = running + hung * angleDelta(running, Math.PI / 2 - s.pitch);
    tailBase += (0.65 * joyful + 0.9 * startledTail) * angleDelta(tailBase, -1.45) + 0.5 * drooping * angleDelta(tailBase, 2.9);
    // (the tail hangs straight down in the world, and does not follow the body's twist at once: it is thrown to one side and the other by it, a beat behind, and whipped by a shake)
    tailBase += 0.3 * fight * held * Math.sin(TAU * this.twist - 2.2) + 0.6 * shaking * Math.sin(this.time * TAU * 9 + 1);
    // (and an annoyed cat holds it low and out behind it, to lash it)
    tailBase += 0.45 * annoyed * angleDelta(tailBase, 3.3);
    let a = tailBase + (frame.petted ? -0.45 : 0);
    const curl = lerp(lerp(lerp(this.tailPoseCurl.x, 0.1, streaming), 0.05, hung), 0.1, clamp01(0.7 * joyful + startledTail));
    const wrap = clamp01(this.tailPoseFront.x) * (1 - hung);
    // (a tail lies on the ground, not in it; one that hangs in the air has no ground)
    const tailFloor = lerp(TAIL_FLOOR, 9, hung);
    let tx = p.tailRoot.x;
    let ty = p.tailRoot.y;
    const segLen = TAIL_LENGTH / TAIL_SEGMENTS;
    const joints = s.tail;
    joints[0]!.x = tx;
    joints[0]!.y = ty;
    let carry = this.tailRoot.x;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const f = i / (TAIL_SEGMENTS - 1);
      const d = this.tailAngles[i]!;
      const sway = Math.sin(this.time * TAU * swayRate - i * 0.55) * swayAmp * (0.25 + f) + this.tipKick.x * smoothstep(0.5, 1, f);
      smooth(d, carry * 0.55 + sway, lerp(5, 2.2, f), dt);
      carry = d.x;
      // (a tail that is wrapped round the cat goes back for a moment and then turns, quickly, to lie forward along its side)
      const along01 = lerp(f * f * 0.6 + f * 0.4, smoothstep(0.1, 0.32, f), wrap);
      // (a walking cat's tail rides the rock of its rump: the rump rises and the tail follows a little behind it, the tip furthest behind and furthest out)
      const lag = 0.45 * i + 0.9;
      const ride = onFoot * (0.025 + 0.07 * f) * lerp(Math.sin(TAU * 2 * (walkBeat + 0.03) - lag), 0.4 * Math.sin(TAU * 2 * (stalkBeat + 0.03) - lag), stalkW);
      a = tailBase + (frame.petted ? -0.45 : 0) + curl * along01 + d.x * (0.4 + f) + ride * (1 - streaming);
      let dx = Math.cos(a) * segLen;
      let dy = Math.sin(a) * segLen;
      if (ty + dy > tailFloor) {
        // (the tail lies on the ground, not in it: a piece that would go into it slides along it, as long as it is, towards where it was heading. One that points steeply down
        // does not flip from lying one way to lying the other, which was a jump of the whole tip: it buckles up, and swings over, as a tail does when it is turned about)
        const floorDy = tailFloor - ty;
        const run = Math.sqrt(Math.max(0, segLen * segLen - floorDy * floorDy));
        const side = clamp(Math.cos(a) / TAIL_BUCKLE, -1, 1);
        dx = side * run;
        dy = floorDy - run * Math.sqrt(1 - side * side);
      }
      tx += dx;
      ty += dy;
      const j = joints[i + 1]!;
      j.x = tx;
      j.y = ty;
    }

    // --- the whole: squash on landing, a shadow that shrinks in the air, a fade in
    smooth(this.sqDyn, 0, 6, dt);
    const landing = jumping ? smoothstep(JUMP_LANDING, JUMP_LANDING + 0.06, frame.progress) * (1 - smoothstep(JUMP_LANDING + 0.06, 1, frame.progress)) : 0;
    // (a cat that hangs by the scruff, or by its paws, is a little longer for its weight)
    // (a flinch draws the whole cat in a little, and a joy lengthens it)
    // (a fight with a hand narrows and widens it with the twisting, as a body that turns about its length does; a shake shudders it)
    s.sx = (1 + 0.05 * landing) * (1 - 0.03 * hung) * (1 + 0.03 * startled) * (1 - 0.04 * fight * held * (0.5 + 0.5 * Math.sin(TAU * 2 * this.twist))) * (1 + 0.05 * shaking * shakeBeat);
    s.sy = (1 - 0.07 * landing) * (1 + 0.05 * hung) * (1 - 0.05 * startled + 0.015 * joyful);
    s.air = frame.grounded ? 0 : 1;
    // (the shadow is of a cat that stands on the ground: the one that hangs from a lip, below the line of the ledge, has none until it is over it)
    s.shadow = 1 - Math.max(held, climbClip ? cp.hang : 0);
    s.appear = clamp01(frame.appear);
    // --- and where the whole of it is, from the frame's point: in a climb (see `Solved.shift`); and in a hand, where it swings about the hand and not about the middle of its body: the picture is turned
    // about the middle, and is moved by as much as that turn moves the hand, so that the hand stays where it is
    const turn = held * hangSwing;
    const gripX = GRIP.x - MIDDLE.x;
    const gripY = GRIP.y - MIDDLE.y;
    const cosT = Math.cos(turn);
    const sinT = Math.sin(turn);
    const holdX = gripX - (gripX * cosT - gripY * sinT);
    const holdY = gripY - (gripX * sinT + gripY * cosT);
    s.shift.x = (cp.x + this.shiftOffX.x + holdX) * this.flipDyn.x;
    s.shift.y = cp.y + this.shiftOffY.x + holdY;
  }
}
