import { clamp, easeInOut } from "../../math";
import { CLIMB_GRAB, CLIMB_OVER, CLIMB_PULL, JUMP_LANDING, JUMP_TAKEOFF, SWAT_HIT, type CatFrame, type Clip as EngineClip } from "../../types";
import { climbPose } from "../climb";
import type { Solved } from "../rig";
import { Pose, Skeleton, blend, lengthOf, sampleFrame, turnAbout, type Adjust, type Clip } from "./pose";
import { Dangle, type Hold } from "./held";
import { Secondary, type Gust } from "./secondary";

/**
 * What the solid cat does with its bones, picture after picture: which clip plays for what the engine says the cat is doing, how it is driven (by the ground the cat
 * has covered, by the clock, by how far along a one-shot is), how one clip passes into the next, and what is laid on top of the clip (the head turned to what the cat
 * looks at, the jaw, the ears, the breath). The clips are the maker's: recorded or retargeted motion of the cat's own bones (scripts/cat/anim); nothing here moves a bone
 * by a formula that the clip should have, only adds to it.
 */

/** How a clip is played. `odometer`: by the ground covered, so that a foot on the ground does not slide; `clock`: by time; `progress`: by how far through a one-shot the engine is. */
export type Drive = "odometer" | "clock" | "progress";

export interface Plan {
  /** The clip's name in the clips file. */
  clip: string;
  drive: Drive;
  /** Seconds to pass into it from whatever was showing. */
  fade: number;
  /**
   * For a clip played by `progress`: the moments of the clip (its marks) that the engine's progress passes at, in order. The engine shares a jump out as a crouch, a flight and a
   * landing of its own lengths; a clip that has the marks is played so that its take-off is at the engine's, its landing is, and the parts between are stretched to fit. A clip that
   * lacks any of them is played evenly through.
   */
  anchors?: ReadonlyArray<{ at: number; mark: string }>;
  /**
   * The clip is the cat getting into a posture it stays in (it lies down, sits down, crouches) and ends in it: the cat that gets out of the posture to stand is shown this clip backwards
   * (it gets up the way it got down) and not blended from the one pose to the other, which has its limbs pass through one another.
   */
  entry?: boolean;
}

/**
 * For each posture of the engine the clips to try, in order: the first the file has is played. (A posture the file has no clip for is shown as the rest of the skeleton;
 * `missing` says which, so that a test can tell the file is not whole.)
 */
export const PLANS: Record<EngineClip, readonly Plan[]> = {
  stand: [{ clip: "stand", drive: "clock", fade: 0.3 }],
  walk: [{ clip: "walk", drive: "odometer", fade: 0.25 }],
  run: [{ clip: "run", drive: "odometer", fade: 0.2 }, { clip: "walk", drive: "odometer", fade: 0.2 }],
  sit: [{ clip: "sit", drive: "clock", fade: 0.5, entry: true }],
  loaf: [{ clip: "loaf", drive: "clock", fade: 0.6, entry: true }],
  curl: [{ clip: "curl", drive: "clock", fade: 0.7, entry: true }],
  crouch: [{ clip: "crouch", drive: "clock", fade: 0.3, entry: true }],
  jump: [{ clip: "jump", drive: "progress", fade: 0.12, anchors: [{ at: JUMP_TAKEOFF, mark: "takeoff" }, { at: JUMP_LANDING, mark: "land" }] }],
  // (the picture of a climb starts below the point the cat ends up on, hanging by its forepaws from the lip: the clip does the travel itself, the engine holds the frame still)
  climb: [
    { clip: "climb", drive: "progress", fade: 0.12, anchors: [{ at: CLIMB_GRAB, mark: "grab" }, { at: CLIMB_PULL, mark: "pull" }, { at: CLIMB_OVER, mark: "over" }] },
    { clip: "stand", drive: "clock", fade: 0.3 },
  ],
  // (a gait up a wall: the distance the cat has gone up drives it, as the ground does a walk)
  scale: [{ clip: "scale", drive: "odometer", fade: 0.2 }],
  stretch: [{ clip: "stretch", drive: "progress", fade: 0.3 }],
  yawn: [{ clip: "yawn", drive: "progress", fade: 0.3 }],
  groom: [{ clip: "groom", drive: "clock", fade: 0.4 }],
  pet: [{ clip: "pet", drive: "clock", fade: 0.4 }],
  point: [{ clip: "point", drive: "clock", fade: 0.25 }],
  scratch: [{ clip: "scratch", drive: "clock", fade: 0.3 }, { clip: "groom", drive: "clock", fade: 0.4 }],
  knead: [{ clip: "knead", drive: "clock", fade: 0.4 }],
  sniff: [{ clip: "sniff", drive: "progress", fade: 0.3 }],
  stalk: [{ clip: "stalk", drive: "odometer", fade: 0.3 }, { clip: "walk", drive: "odometer", fade: 0.3 }],
  wiggle: [{ clip: "wiggle", drive: "clock", fade: 0.2 }],
  peek: [{ clip: "peek", drive: "clock", fade: 0.4 }],
  tap: [{ clip: "tap", drive: "clock", fade: 0.2 }],
  swat: [{ clip: "swat", drive: "progress", fade: 0.12, anchors: [{ at: SWAT_HIT, mark: "hit" }] }],
  doze: [{ clip: "doze", drive: "clock", fade: 0.6, entry: true }],
  shift: [{ clip: "shift", drive: "progress", fade: 0.4 }],
};

/** Which of the cat's homes a posture is of: standing about, sitting, lying, or crouching. Getting from the second or the third to the first is a rise. */
type Home = "stand" | "sit" | "lie" | "crouch";
const HOME: Record<EngineClip, Home> = {
  stand: "stand",
  walk: "stand",
  run: "stand",
  stalk: "stand",
  jump: "stand",
  climb: "stand",
  scale: "stand",
  stretch: "stand",
  yawn: "stand",
  sniff: "stand",
  swat: "stand",
  peek: "stand",
  sit: "sit",
  groom: "sit",
  point: "sit",
  tap: "sit",
  scratch: "sit",
  pet: "sit",
  loaf: "lie",
  doze: "lie",
  curl: "lie",
  knead: "lie",
  shift: "lie",
  crouch: "crouch",
  wiggle: "crouch",
};
/** The postures a cat that has been sitting or lying gets up to be in (the others are walked, run or leapt into: those start from where the body is, with a long blend). */
const RISE_TO: ReadonlySet<EngineClip> = new Set<EngineClip>(["stand", "stretch", "yawn", "sniff"]);
/** How much faster than it went down a cat gets up, and the blend (s) from the end of that into the next clip. */
const RISE_SPEED = 1.5;
const RISE_FADE = 0.2;
/** The shortest blend (s) from a sitting, lying or crouching cat to a different home: a body that is on the floor does not stand in a third of a second. */
const LEAVE_FADE = 0.5;

type Turn = [number, number, number, number];

/**
 * How much a tail sways at rest in each posture (0..1): a cat that sits or stands about swishes it slowly, one that is running or leaping has a tail that does what the clip says, and
 * one that is asleep hardly moves it.
 */
const SWAY: Record<EngineClip, number> = {
  stand: 1,
  walk: 0.25,
  run: 0.1,
  sit: 1,
  loaf: 0.6,
  curl: 0.2,
  crouch: 0.4,
  jump: 0,
  climb: 0,
  scale: 0.2,
  stretch: 0.5,
  yawn: 0.8,
  groom: 0.8,
  pet: 1,
  point: 0.8,
  scratch: 0.5,
  knead: 0.7,
  sniff: 0.6,
  stalk: 0.5,
  wiggle: 1,
  peek: 0.5,
  tap: 0.8,
  swat: 0.5,
  doze: 0.15,
  shift: 0.3,
};
/** How quickly the body's acceleration is taken in (Hz): the engine's speed changes in steps, which a tail would be seen to snap at. */
const PUSH_HZ = 10;
/** The most the body can be taken to be accelerating (body lengths a second squared): a cat that is moved from one place to another is not one that sped up. */
const PUSH_MOST = 60;

/** What the engine's numbers ask of the bones, beyond the clip. */
const HEAD_YAW_REACH = 2.1;

/** How far the head is turned about the vertical against the body: from the rig's `yaw` (0 faces the viewer, 1 faces the way the body faces). */
export function headYawOf(s: Solved): number {
  return clamp(-(Math.PI / 2) * s.flip * (1 - s.head.yaw), -HEAD_YAW_REACH, HEAD_YAW_REACH);
}

/**
 * How far the whole body is tipped (the rig's pitch: negative lifts the nose). A climb is the exception: the flat cat is tipped by the rig as it hangs from the lip, but the solid cat's clip is told
 * in the ledge's own space and hangs the body itself, so a tip on top of it would turn the cat twice.
 */
export function tipOf(s: Solved): number {
  return s.frame.clip === "climb" ? 0 : s.pitch;
}
/**
 * How a turn of the head against the body is shared along the neck (the bones from the chest up, each with its share of the turn about the vertical and of the tilt): a head turned
 * on its own bone alone wrings the neck at one joint. A skeleton with no bones of the neck turns the head alone.
 */
const NECK: ReadonlyArray<readonly [string, number, number]> = [
  ["neck1", 0.34, 0.15],
  ["neck2", 0.33, 0.3],
  ["head", 0.33, 0.55],
];
/** How much of the body's tip the head makes up for when the cat hangs (a cat hung by the scruff keeps its head up: the neck bends back against the body). */
const HEAD_LEVEL = 0.7;
/** How quickly the cat takes hold of the hand and lets go of it (the weight of a hang goes from 0 to 1 at this rate a second, in and out), and how it goes into a fall and out of it. */
const HANG_IN = 9;
const HANG_OUT = 5;
/** The speed (body lengths a second, downward) from which a cat that is in the air and not leaping is falling free. */
const FALL_SPEED = 7;
/** How quickly the floor comes under the tail of a cat that lands or is set down, and goes from under a cat that is lifted, a second (the tail is held up from it as it goes, not dropped). */
const FLOOR_IN = 6;
const FLOOR_OUT = 14;
/** The most the jaw opens (radians: a yawn is wide). */
const JAW_OPEN = 0.8;
/** How far an ear leans for a whole unit of the rig's ear angle. */
const EAR_LEAN = 0.9;

export class Director {
  readonly pose: Pose;
  readonly adjust: Adjust[];
  /** Postures of the engine that the clips do not cover (and so show as the skeleton's rest), by the last picture. */
  missing = new Set<EngineClip>();
  private readonly byName = new Map<string, Clip>();
  private readonly from: Pose;
  private readonly to: Pose;
  private readonly bone: { jaw: number; earL: number; earR: number; chest: number };
  /** The bones that carry the head's turn and tilt, each with its turns and its share of them. */
  private readonly neck: Array<{ yaw: Turn; roll: Turn; yawShare: number; rollShare: number }>;
  private readonly turns: { jaw: Turn; earL: Turn; earR: Turn; chest: Turn };
  /** Whether what follows the clip is laid on it (the lab turns it off to show what the clip does by itself). */
  follows = true;
  /** What follows the clip (the tail, the back, the breath), and the body's speed and how it is changing, as the last picture had them. */
  private readonly secondary: Secondary;
  /** What the limbs do when nothing holds them up (hanging, falling, thrashing), and how far the cat is into each. */
  private readonly dangle: Dangle;
  private held = 0;
  private falling = 0;
  private struggle = 0;
  /** How far the rear of the cat hangs while its forepaws hold on to a lip, and how hard its hind legs pedal against the face of the ledge. */
  private rear = 0;
  private scramble = 0;
  /** How much of the floor there is under the tail (1 for a cat on its feet or lying, 0 for one that hangs or is in the air), eased. */
  private floor = 0;
  private lastVx = 0;
  private lastVy = 0;
  private accelX = 0;
  private accelY = 0;
  private current: Plan | null = null;
  private currentKey = "";
  private age = 0;
  private fading = 0;
  private fadeLength = 0.0001;
  private started = false;
  /** Which home the cat is in (the posture the engine last asked for is of it), and the clip that got it into the one it sits or lies in. */
  private home: Home = "stand";
  private entryName = "";
  /** A cat that is getting up: the clip it went down by, played backwards (`at` is the frame it is at), and the clip it is to pass to when it is up. */
  private rising: { clip: Clip; at: number } | null = null;
  private pending: Plan | null = null;

  constructor(
    readonly skeleton: Skeleton,
    clips: readonly Clip[],
  ) {
    this.pose = new Pose(skeleton);
    this.from = new Pose(skeleton);
    this.to = new Pose(skeleton);
    this.secondary = new Secondary(skeleton);
    for (const clip of clips) this.byName.set(clip.name, clip);
    this.bone = { jaw: skeleton.bone("jaw"), earL: skeleton.bone("earL"), earR: skeleton.bone("earR"), chest: skeleton.bone("chest") };
    this.turns = { jaw: [0, 0, 0, 1], earL: [0, 0, 0, 1], earR: [0, 0, 0, 1], chest: [0, 0, 0, 1] };
    const links = skeleton.has("neck1") && skeleton.has("neck2") ? NECK : ([["head", 1, 1]] as const);
    this.neck = links.map(([, yawShare, rollShare]) => ({ yaw: [0, 0, 0, 1], roll: [0, 0, 0, 1], yawShare, rollShare }));
    // (the order is the order they are applied in: a bone is turned about the vertical, then tilted)
    this.adjust = [
      ...links.flatMap(([name], i) => [
        { bone: skeleton.bone(name), q: this.neck[i]!.yaw },
        { bone: skeleton.bone(name), q: this.neck[i]!.roll },
      ]),
      { bone: this.bone.jaw, q: this.turns.jaw },
      { bone: this.bone.earL, q: this.turns.earL },
      { bone: this.bone.earR, q: this.turns.earR },
      { bone: this.bone.chest, q: this.turns.chest },
    ];
    this.dangle = new Dangle(skeleton);
    this.adjust.push(...this.dangle.adjust);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Forgets everything the director was doing: the next picture is the first of a cat that has just appeared (no clip is passed from, no spring is on its way, nothing is held). For the lab, which draws one cat in many places. */
  restart(): void {
    this.started = false;
    this.current = null;
    this.currentKey = "";
    this.age = 0;
    this.fading = 0;
    this.home = "stand";
    this.entryName = "";
    this.rising = null;
    this.pending = null;
    this.held = 0;
    this.falling = 0;
    this.struggle = 0;
    this.rear = 0;
    this.scramble = 0;
    this.floor = 0;
    this.lastVx = 0;
    this.lastVy = 0;
    this.accelX = 0;
    this.accelY = 0;
    this.secondary.reset();
    this.dangle.reset();
    this.pose.reset();
  }

  /** The ground (body lengths) one cycle of a gait clip carries the cat over, 0 for a clip that is not one or is not there. (For the lab, which stands the cat at a point of a cycle.) */
  strideOf(name: string): number {
    return this.byName.get(name)?.stride ?? 0;
  }

  private planFor(posture: EngineClip): Plan | null {
    for (const plan of PLANS[posture]) if (this.byName.has(plan.clip)) return plan;
    return null;
  }

  /**
   * The engine asks for another posture (or for the first): what shows now is what is faded from (a cat that was in the middle of passing from one clip to another passes on from where it
   * is). A cat that sits or lies and is to stand, stretch or sniff gets up first, by the clip it got down by, played backwards: a blend from the one pose to the other would pass its legs
   * through its body. One that is to walk, run or leap is blended over longer than a cat that stands: it does not leave the floor in a third of a second.
   */
  private change(frame: CatFrame, plan: Plan | null, key: string): void {
    const was = this.started;
    const from = this.home;
    const home = HOME[frame.clip];
    let rise: { clip: Clip; at: number } | null = null;
    if (was && this.rising === null && plan && (from === "sit" || from === "lie") && home === "stand" && RISE_TO.has(frame.clip) && frame.grounded && !frame.carried && frame.appear >= 0.9) {
      const entry = this.byName.get(this.entryName);
      // (from where the clip had got to, if that is what was playing; from the end of it for an act that is done from the posture)
      if (entry) rise = { clip: entry, at: this.current?.clip === entry.name ? Math.min(this.age * entry.fps, entry.frames - 1) : entry.frames - 1 };
    }
    if (was) this.from.copy(this.pose);
    this.fading = was ? 1 : 0;
    this.currentKey = key;
    this.started = true;
    this.home = home;
    if (plan?.entry) this.entryName = plan.clip;
    if (rise) {
      this.rising = rise;
      this.pending = plan;
      this.fadeLength = RISE_FADE;
      return;
    }
    this.rising = null;
    this.pending = null;
    this.current = plan;
    this.age = 0;
    this.fadeLength = Math.max(0.0001, plan?.fade ?? 0.3, was && from !== home && from !== "stand" ? LEAVE_FADE : 0);
  }

  /**
   * The pose and the added turns for a cat the rig has solved. `px` is the body's length in pixels (the odometer is in pixels), `headYaw` how far the head is turned about the
   * vertical against the body (radians).
   */
  update(s: Solved, dt: number, px: number, headYaw: number): void {
    const frame = s.frame;
    const plan = this.planFor(frame.clip);
    if (!plan) this.missing.add(frame.clip);
    const key = plan ? `${plan.clip}/${plan.drive}` : "";
    if (!this.started || key !== this.currentKey) this.change(frame, plan, key);
    this.age += dt;

    const clip = plan ? this.byName.get(plan.clip)! : null;
    const rising = this.rising;
    if (rising) {
      // (a cat that gets up: the clip it went down by, backwards, a little faster, from where it got to)
      rising.at = Math.max(0, rising.at - dt * rising.clip.fps * RISE_SPEED);
      sampleFrame(rising.clip, rising.at, this.to);
    } else if (clip && plan) {
      let at: number;
      if (plan.drive === "odometer") {
        // (one cycle of the clip is `stride` body lengths of ground; a clip with no stride is played by the clock)
        at = clip.stride > 0 ? (frame.odometer / px / clip.stride) * clip.frames : this.age * clip.fps;
      } else if (plan.drive === "progress") {
        at = progressFrame(clip, plan, clamp(frame.progress, 0, 1));
      } else {
        at = this.age * clip.fps;
        if (!clip.loop) at = Math.min(at, clip.frames - 1);
      }
      sampleFrame(clip, at, this.to);
    } else {
      this.to.reset();
    }

    if (this.fading > 0) {
      this.fading = Math.max(0, this.fading - dt / this.fadeLength);
      blend(this.pose, this.from, this.to, easeInOut(1 - this.fading));
    } else {
      this.pose.copy(this.to);
    }
    if (rising && rising.at <= 0) {
      // (it is up: it passes on to what it was getting up for, from where it stands)
      this.rising = null;
      this.from.copy(this.pose);
      this.fading = 1;
      this.fadeLength = RISE_FADE;
      this.current = this.pending;
      this.pending = null;
      this.age = 0;
    }
    // --- what follows the clip (the tail, the back) and what the body does beside it (the breath)
    const gust = this.gust(frame, dt, px, s.breath);
    if (this.follows) this.secondary.apply(this.pose, dt, gust);

    // --- what hangs: the limbs of a cat in a hand or in the air answer to the world, not to the clip
    // (the renderer tips the whole body by the rig's pitch turned over: positive is nose up)
    const tip = -tipOf(s);
    this.takeHold(frame, dt, px);
    if (this.follows) {
      const hold: Hold = { held: this.held, falling: this.falling, struggle: this.struggle, rear: this.rear, scramble: this.scramble, pitch: tip, forward: gust.forward, up: gust.up, time: this.age };
      this.dangle.update(this.pose, dt, hold);
      // --- and the floor: a tail that lies on it is not in it (a cat that is held, falls, is in the air or hauls itself over a ledge has none under it)
      const standing = frame.grounded && !frame.carried && frame.clip !== "climb" && frame.clip !== "jump" ? 1 - Math.max(this.held, this.falling, this.rear) : 0;
      this.floor += (standing - this.floor) * (1 - Math.exp(-dt * (standing > this.floor ? FLOOR_IN : FLOOR_OUT)));
      this.secondary.settle(this.pose, this.floor);
    }

    // --- what is laid on top
    const h = s.head;
    const yaw = clamp(headYaw, -HEAD_YAW_REACH, HEAD_YAW_REACH);
    // (a cat that hangs by the scruff keeps its head up: the neck bends back against the body's tip)
    const level = -HEAD_LEVEL * tip * this.held;
    for (const link of this.neck) {
      set(link.yaw, turnAbout(0, 1, 0, yaw * link.yawShare));
      // (the rig's y is down: its tilt is turned over)
      set(link.roll, turnAbout(0, 0, 1, -h.rot * link.rollShare + level * link.rollShare));
    }
    set(this.turns.jaw, turnAbout(0, 0, 1, -clamp(h.jaw, 0, 1) * JAW_OPEN));
    set(this.turns.earL, turnAbout(1, 0, 0, -clamp(h.earL, -0.5, 1.2) * EAR_LEAN));
    set(this.turns.earR, turnAbout(1, 0, 0, clamp(h.earR, -0.5, 1.2) * EAR_LEAN));
    set(this.turns.chest, turnAbout(0, 0, 1, 0));
  }

  /** How far the cat hangs from a hand, falls free and thrashes, eased: in a hand it takes hold at once, and lets go less quickly. */
  private takeHold(frame: CatFrame, dt: number, px: number): void {
    const toward = (now: number, to: number): number => now + (to - now) * (1 - Math.exp(-dt * (to > now ? HANG_IN : HANG_OUT)));
    this.held = toward(this.held, frame.carried ? 1 : 0);
    const dropping = !frame.carried && !frame.grounded && frame.clip !== "jump" && px > 0 && frame.vy / px > FALL_SPEED;
    this.falling = toward(this.falling, dropping ? 1 : 0);
    // (a cat that is not in a hand does not fight it, whatever the last picture said)
    this.struggle = toward(this.struggle, frame.carried ? clamp(frame.struggle ?? 0, 0, 1) : 0);
    // (a cat that climbs hangs by its forepaws until its chest is over the lip: its hind legs and its tail hang from it as they hang from a hand, and pedal against the wall; the engine's own numbers for how much)
    const up = frame.clip === "climb" && !frame.carried ? climbPose(frame.progress) : null;
    this.rear = toward(this.rear, up ? up.hang : 0);
    this.scramble = toward(this.scramble, up ? up.scramble : 0);
  }

  /** What the body is doing just now, for what follows the clip: how it is speeding up (the engine gives its speed, in pixels a second), how much a tail would sway, how lively and how it breathes. */
  private gust(frame: CatFrame, dt: number, px: number, breath: number): Gust {
    if (dt > 0 && px > 0) {
      const per = 1 / (dt * px);
      const k = Math.min(1, dt * PUSH_HZ);
      this.accelX += (clamp((frame.vx - this.lastVx) * per, -PUSH_MOST, PUSH_MOST) - this.accelX) * k;
      this.accelY += (clamp((frame.vy - this.lastVy) * per, -PUSH_MOST, PUSH_MOST) - this.accelY) * k;
    }
    this.lastVx = frame.vx;
    this.lastVy = frame.vy;
    return {
      // (forward is the way the cat faces; the engine's y grows downward)
      forward: this.accelX * frame.facing,
      up: -this.accelY,
      sway: SWAY[frame.clip] * (1 - 0.85 * clamp(frame.drowsy, 0, 1)),
      energy: frame.energy,
      breath,
    };
  }

  /** How long the clip that is playing is, in seconds (0 when none is). */
  get length(): number {
    return this.current ? lengthOf(this.byName.get(this.current.clip)!) : 0;
  }

  /** The name of the clip that is playing ("" when none is), and whether the cat is still passing into it from the one before. (For the tools that measure the body.) */
  get playing(): string {
    return this.current?.clip ?? "";
  }
  get blending(): boolean {
    return this.fading > 0;
  }
}

/**
 * The frame of a clip that the engine's progress through a one-shot (0..1) is at. Evenly through the clip, unless the plan names moments of it that the engine's progress is to
 * pass at and the clip has them all: then a line between the moments (and from the start to the first, and from the last to the end).
 */
export function progressFrame(clip: Clip, plan: Plan, progress: number): number {
  const last = clip.loop ? clip.frames : clip.frames - 1;
  const anchors = plan.anchors;
  if (anchors && anchors.length > 0 && anchors.every((a) => clip.marks[a.mark] !== undefined)) {
    // (the pairs (progress, frame) from the start of the clip to its end)
    const points: Array<[number, number]> = [[0, 0]];
    for (const a of anchors) points.push([a.at, clamp(clip.marks[a.mark]! * clip.fps, 0, last)]);
    points.push([1, last]);
    for (let i = 1; i < points.length; i++) {
      const [p1, f1] = points[i]!;
      const [p0, f0] = points[i - 1]!;
      if (progress <= p1 || i === points.length - 1) return p1 > p0 ? f0 + ((f1 - f0) * clamp((progress - p0) / (p1 - p0), 0, 1)) : f1;
    }
  }
  return progress * last;
}

const set = (to: Turn, from: readonly [number, number, number, number]): void => {
  to[0] = from[0];
  to[1] = from[1];
  to[2] = from[2];
  to[3] = from[3];
};
