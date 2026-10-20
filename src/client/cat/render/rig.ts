import { bounce, clamp, clamp01, dyn, easeInOut, fract, lerp, smooth, smoothstep, twoBone, TAU, type Dyn } from "../math";
import { createRng, type Rng } from "../rng";
import { JUMP_LANDING, JUMP_TAKEOFF, type CatFrame } from "../types";
import { FLAT, makePose, PART, SHAPE_HEIGHT, SHAPE_LENGTH, SHAPE_NAMES, unflatten, type Pose, type ShapeName } from "./shapes";

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
  /** Rotation of the whole body, radians (leaping up or down). */
  pitch: number;
  breath: number;
}

const TAIL_SEGMENTS = 10;
const TAIL_LENGTH = 0.64;
/** The height of the ground for the tail (the tail's own thickness above the ground line, so that it lies on it and does not sink in). */
const TAIL_FLOOR = -0.045;

/** Legs: the front is shoulder to elbow to wrist; the hind is hip to knee to hock, then the foot. Lengths in body lengths. */
const FRONT_UPPER = 0.2;
const FRONT_LOWER = 0.2;
const FRONT_WRIST = 0.045;
const HIND_UPPER = 0.24;
const HIND_LOWER = 0.24;

/** How the four legs share a stride: near hind, near front, far hind, far front (a cat walks on one leg at a time, in that order). */
const GAIT_OFFSET = { hn: 0, fn: 0.25, hf: 0.5, ff: 0.75 } as const;

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
  private eyeX = dyn(0);
  private eyeY = dyn(0);
  private yaw = dyn(0);
  private tilt = dyn(0);
  private flipDyn = dyn(1);
  private pitchDyn = dyn(0);
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
  private facing: 1 | -1 = 1;

  constructor(seed = 1) {
    this.rng = createRng(seed);
    this.weights = {} as Record<ShapeName, Dyn>;
    this.rearWeights = {} as Record<ShapeName, Dyn>;
    for (const name of SHAPE_NAMES) {
      this.weights[name] = dyn(name === "stand" ? 1 : 0);
      this.rearWeights[name] = dyn(name === "stand" ? 1 : 0);
    }
    this.nextTwitch = this.rng.range(2, 6);
    this.nextBlink = this.rng.range(1.5, 4);
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
    this.update(frame, 0.001, px);
  }

  private targetWeights(frame: CatFrame): Record<ShapeName, number> {
    const w: Record<ShapeName, number> = { stand: 0, sit: 0, loaf: 0, curl: 0, crouch: 0, stretch: 0, air: 0 };
    const p = frame.progress;
    switch (frame.clip) {
      case "stand":
      case "walk":
      case "run":
        w.stand = 1;
        break;
      case "sit":
      case "groom":
      case "pet":
      case "point":
      case "yawn":
        w.sit = 1;
        break;
      case "loaf":
        w.loaf = 1;
        break;
      case "curl":
        w.curl = 1;
        break;
      case "crouch":
        w.crouch = 1;
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

    // --- posture: a spring moves the weight from one shape to another, one for the front of the cat and one for the rear. A cat that lowers itself
    // folds its rear first (and its front follows); one that rises lifts its front first. A jump is all at once.
    const target = this.targetWeights(frame);
    const jumping = clip === "jump";
    // (a jump gathers itself first, then goes all at once)
    const postureHz = jumping ? (frame.progress < JUMP_TAKEOFF - 0.04 ? 3.2 : 9) : clip === "stretch" ? 3 : clip === "curl" ? 1.1 : clip === "loaf" ? 1.3 : clip === "crouch" ? 3 : clip === "stand" || clip === "walk" || clip === "run" ? 1.8 : 1.6;
    let goal = 0;
    let here = 0;
    for (const name of SHAPE_NAMES) {
      goal += target[name] * SHAPE_HEIGHT[name]!;
      here += Math.max(0, this.weights[name].x) * SHAPE_HEIGHT[name]!;
    }
    const lowering = !jumping && goal < here - 0.03;
    const rising = !jumping && goal > here + 0.03;
    const frontFreq = postureHz * (lowering ? 0.6 : 1);
    const rearFreq = postureHz * (rising ? 0.6 : 1);
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

    // --- breathing: slower and deeper in sleep, quicker when excited; a purr is a faster, smaller pulse on top
    const breathRate = lerp(0.42, 0.28, sleepy) + frame.energy * 0.25;
    this.breathPhase = fract(this.breathPhase + dt * breathRate);
    const breath = Math.sin(this.breathPhase * TAU);
    const purr = frame.petted ? Math.sin(this.time * TAU * 7) * 0.004 : 0;
    s.breath = breath;
    const chest = breath * lerp(0.011, 0.016, sleepy) + purr;
    for (const k of ["shoulderTop", "neckTop", "chestFront"] as const) p[k].y -= chest * 0.7;
    p.chestBottom.y += chest * 0.5;
    p.bellyMid.y += chest * 1.1;
    p.backMid.y -= chest * 0.4;

    // --- the walk: the legs are driven by the distance walked, so a foot on the ground stays where it is
    const walking = clip === "walk" || clip === "run";
    smooth(this.gait, walking ? 1 : 0, walking ? 8 : 5, dt);
    const gaitW = clamp01(this.gait.x);
    const odoL = frame.odometer / px;
    const running = clip === "run";
    const stride = running ? 0.92 : 0.6;
    const duty = running ? 0.46 : 0.68;
    const lift = running ? 0.12 : 0.07;
    const cycle = odoL / stride;
    const base = fract(cycle);
    const bob = gaitW * (running ? 0.03 : 0.012) * (1 - Math.cos(base * TAU * 2)) * 0.5;
    const roll = gaitW * Math.sin(base * TAU) * (running ? 0.03 : 0.012);

    // --- the whole body, tilted in the air and bowing to what it does
    const pitchTarget = jumping ? clamp(frame.vy / 1400, -0.5, 0.5) : 0;
    smooth(this.pitchDyn, pitchTarget, 7, dt);
    s.pitch = this.pitchDyn.x;
    for (const k of ["rumpBack", "rumpTop", "backMid", "shoulderTop", "neckTop", "chestFront", "chestBottom", "bellyMid", "groin", "rumpBottom", "shoulder", "hip", "head", "tailRoot"] as const) {
      p[k].y -= bob;
    }
    p.neckTop.y -= roll * 0.5;
    p.rumpTop.y += roll * 0.5;

    // --- where each paw is (a step when walking, the posture's own rest place when not)
    const pawTarget = (key: "fn" | "ff" | "hn" | "hf") => {
      const home = p[key];
      const ph = fract(base + GAIT_OFFSET[key]);
      const half = (stride * duty) / 2;
      let gx: number;
      let gy: number;
      if (ph < duty) {
        gx = home.x + half * (1 - (2 * ph) / duty);
        gy = 0;
      } else {
        const t = (ph - duty) / (1 - duty);
        gx = home.x - half + 2 * half * easeInOut(t);
        gy = -lift * Math.sin(Math.PI * t) ** 0.8;
      }
      return { x: lerp(home.x, gx, gaitW), y: lerp(home.y, gy, gaitW) };
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
    if (frame.viewer) {
      wantX = 0;
      wantY = 0.12;
      attending = true;
    } else if (frame.look) {
      const baseX = frame.x + headX * px * frame.facing;
      const baseY = frame.y + headY * px;
      wantX = clamp(((frame.look.x - baseX) * frame.facing) / (0.55 * px), -1, 1);
      wantY = clamp((frame.look.y - baseY) / (0.55 * px), -1, 1);
      attending = true;
    }
    smooth(this.eyeX, wantX, 11, dt);
    smooth(this.eyeY, wantY, 11, dt);
    const yawTarget = frame.viewer ? 0 : clamp(wantX * 0.8, -0.85, 0.85);
    smooth(this.yaw, yawTarget, attending ? 3.2 : 1.6, dt);
    smooth(this.tilt, wantY * 0.28, 3, dt);

    // --- one-offs on the pose: a yawn, a stretch of the neck, being petted, grooming, pointing
    let jawTarget = 0;
    let headRotExtra = 0;
    let headShiftX = 0;
    let headShiftY = 0;
    if (clip === "yawn") {
      // slowly open, hold, close more quickly: the head goes back and up as the jaw drops
      const t = frame.progress;
      const open = smoothstep(0.08, 0.4, t) * (1 - smoothstep(0.7, 0.94, t));
      jawTarget = open;
      headRotExtra = -0.6 * open;
      headShiftX = 0.012 * open;
      headShiftY = -0.03 * open;
    }
    const pawOn = clip === "groom" || clip === "point" ? 1 : 0;
    smooth(this.pawOn, pawOn, 6, dt);
    let pawGoalX = p.fn.x;
    let pawGoalY = 0;
    smooth(this.groomDyn, clip === "groom" ? 1 : 0, 3, dt);
    if (clip === "groom") {
      // washing its face: the head bows to a paw held up at the cheek, the paw goes up over the ear and back down to the mouth, and the head nods with it
      const t = frame.clipTime * TAU * 0.8;
      const rub = Math.sin(t);
      const bow = clamp01(this.groomDyn.x);
      headShiftX += 0.035 * bow;
      headShiftY += (0.15 + 0.014 * rub) * bow;
      headRotExtra += (0.3 - 0.06 * rub) * bow;
      // (the wrist is where it is aimed, and the paw reaches on up the face from there)
      pawGoalX = headX + headShiftX + 0.05 - 0.012 * rub;
      pawGoalY = headY + headShiftY + 0.045 - 0.05 * rub;
    } else if (clip === "point" && frame.reach) {
      const dx = ((frame.reach.x - frame.x) * frame.facing) / px;
      const dy = (frame.reach.y - frame.y) / px;
      const ox = p.shoulder.x;
      const oy = p.shoulder.y;
      const ang = Math.atan2(dy - oy, dx - ox);
      const a = clamp(ang, -1.4, 1.0);
      pawGoalX = ox + Math.cos(a) * 0.37;
      pawGoalY = oy + Math.sin(a) * 0.37;
    }
    smooth(this.pawX, pawGoalX, 7, dt);
    smooth(this.pawY, pawGoalY, 7, dt);
    const pw = clamp01(this.pawOn.x);
    fnTarget.x = lerp(fnTarget.x, this.pawX.x, pw);
    fnTarget.y = lerp(fnTarget.y, this.pawY.x, pw);

    if (frame.petted) {
      headShiftX += 0.025;
      headShiftY += -0.03;
      headRotExtra += -0.25;
    }
    smooth(this.jawDyn, jawTarget, clip === "yawn" ? 6 : 12, dt);
    smooth(this.happyDyn, frame.petted ? 1 : 0, 6, dt);
    smooth(this.asleepDyn, clamp01((sleepy - 0.55) / 0.35), 4, dt);

    // --- legs
    const solveFront = (leg: Leg, root: { x: number; y: number }, paw: { x: number; y: number }, raised: boolean) => {
      const wristY = raised ? paw.y : paw.y - FRONT_WRIST;
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
    const solveHind = (leg: Leg, root: { x: number; y: number }, paw: { x: number; y: number }) => {
      const hock = { x: paw.x + p.hock.x, y: paw.y + p.hock.y };
      const j = twoBone(root.x, root.y, hock.x, hock.y, HIND_UPPER, HIND_LOWER, -1);
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
    solveFront(s.legs.fn, p.shoulder, fnTarget, pw > 0.5);
    solveFront(s.legs.ff, { x: p.shoulder.x - 0.02, y: p.shoulder.y }, ffTarget, false);
    solveHind(s.legs.hn, p.hip, hnTarget);
    solveHind(s.legs.hf, { x: p.hip.x + 0.03, y: p.hip.y }, hfTarget);

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
    if (this.time >= this.nextTwitch && sleepy < 0.9) {
      const left = this.rng.chance(0.5);
      (left ? this.earKickL : this.earKickR).v += this.rng.range(14, 22) * (left ? -1 : 1) * 0.1 * 10;
      this.nextTwitch = this.time + this.rng.range(2.5, 9) * (1 + sleepy);
    }
    const alert = clamp01(frame.energy * 0.6 + (attending ? 0.3 : 0));
    // (in a yawn the ears go back)
    const earRest = lerp(0.12, 0.42, sleepy) - alert * 0.12 + (frame.petted ? 0.25 : 0) + this.jawDyn.x * 0.3 + this.groomDyn.x * 0.12;
    smooth(this.earBaseL, earRest, 4, dt);
    smooth(this.earBaseR, earRest, 4, dt);
    bounce(this.earKickL, 0, 9, 0.35, dt);
    bounce(this.earKickR, 0, 9, 0.35, dt);
    smooth(this.pupilDyn, lerp(0.34, 0.9, clamp01(frame.energy * 0.8 + (attending ? 0.2 : 0))) * (1 - sleepy * 0.5), 4, dt);

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
    const open = lidBase * (1 - blink) * (1 - 0.92 * smoothstep(0.1, 0.5, this.jawDyn.x)) * (1 - 0.7 * clamp01(this.groomDyn.x));
    hd.openL = open;
    hd.openR = open;
    hd.pupil = this.pupilDyn.x;
    hd.earL = this.earBaseL.x + this.earKickL.x;
    hd.earR = this.earBaseR.x + this.earKickR.x;
    hd.jaw = this.jawDyn.x;
    hd.happy = this.happyDyn.x;
    hd.asleep = this.asleepDyn.x;

    // --- the tail trails what the body does
    const ax = ((frame.vx - this.prevVx) / dt / px) * frame.facing;
    this.prevVx = frame.vx;
    smooth(this.tailRoot, clamp(-ax * 0.035, -0.6, 0.6), 5, dt);
    const swayAmp = lerp(0.09, 0.02, sleepy) + frame.energy * 0.22 + (frame.petted ? 0.12 : 0);
    const swayRate = lerp(0.55, 0.2, sleepy) + frame.energy * 0.9;
    let a = pose.s.tailAngle + (frame.petted ? -0.45 : 0);
    const curl = pose.s.tailCurl;
    const wrap = clamp01(pose.s.tailFront);
    let tx = p.tailRoot.x;
    let ty = p.tailRoot.y;
    const segLen = TAIL_LENGTH / TAIL_SEGMENTS;
    const joints = s.tail;
    joints[0]!.x = tx;
    joints[0]!.y = ty;
    let carry = this.tailRoot.x;
    let along = -1;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const f = i / (TAIL_SEGMENTS - 1);
      const d = this.tailAngles[i]!;
      const sway = Math.sin(this.time * TAU * swayRate - i * 0.55) * swayAmp * (0.25 + f);
      smooth(d, carry * 0.55 + sway, lerp(5, 2.2, f), dt);
      carry = d.x;
      // (a tail that is wrapped round the cat goes back for a moment and then turns, quickly, to lie forward along its side)
      const along01 = lerp(f * f * 0.6 + f * 0.4, smoothstep(0.1, 0.32, f), wrap);
      a = pose.s.tailAngle + (frame.petted ? -0.45 : 0) + curl * along01 + d.x * (0.4 + f);
      let dx = Math.cos(a) * segLen;
      let dy = Math.sin(a) * segLen;
      if (ty + dy > TAIL_FLOOR) {
        // (the tail lies on the ground, not in it: a piece that would go into it slides along it, as long as it is, towards where it was heading)
        dy = TAIL_FLOOR - ty;
        const run = Math.sqrt(Math.max(0, segLen * segLen - dy * dy));
        dx = (Math.abs(Math.cos(a)) > 0.12 ? Math.sign(Math.cos(a)) : along) * run;
      }
      if (dx !== 0) along = Math.sign(dx);
      tx += dx;
      ty += dy;
      const j = joints[i + 1]!;
      j.x = tx;
      j.y = ty;
    }

    // --- the whole: squash on landing, a shadow that shrinks in the air, a fade in
    smooth(this.sqDyn, 0, 6, dt);
    const landing = jumping ? smoothstep(JUMP_LANDING, JUMP_LANDING + 0.06, frame.progress) * (1 - smoothstep(JUMP_LANDING + 0.06, 1, frame.progress)) : 0;
    s.sx = 1 + 0.05 * landing;
    s.sy = 1 - 0.07 * landing;
    s.air = frame.grounded ? 0 : 1;
    s.appear = clamp01(frame.appear);
  }
}
