// The climbs of the cat that the Sphynx's motion is laid on (Cat_Climb_Tree: a loop of three quarters of a second, in place, the body up a tree trunk, belly to it). Like the groom in
// sphynx-acts.mts, each is the cat's own posture (the wall posture of acts.mts's `scale`, its chest leaning in to the card) moved the way the Sphynx's back, neck, head and tail turn from where
// they are at the first frame, and its hips as the Sphynx's go; the paws are places that the bones of the legs are solved for: where the Sphynx's paw is in the world (the card is the carrier's,
// and what the paw does against it is the donor's), taken from the Sphynx's joint of the leg to the cat's, as far as the cat's leg is longer than the Sphynx's. No bone is turned by a number
// written here.
import { Pose, after, globals, turnAbout, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import { CLIMB_LIP, CLIMB_TIME } from "../../../src/client/cat/types";
import { climbSpec, type Made } from "./acts.mts";
import { readDonor } from "./donor.mts";
import { Recorder, type PawAim, type PawName, type Spec } from "./posegen.mts";
import { CAT_HIPS_HEIGHT, SPHYNX, SPHYNX_FACING, SPHYNX_HIPS_HEIGHT, sphynxLinks } from "./recipes/sphynx.mts";
import { alignment, type Quat } from "./retarget.mts";
import { turned, turnsAt } from "./sphynx-acts.mts";

const FPS = 30;
const deg = (d: number): number => (d * Math.PI) / 180;

type V3 = [number, number, number];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const add = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const times = (a: ArrayLike<number>, k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
const apply = (M: ArrayLike<number>, v: ArrayLike<number>): V3 => [M[0]! * v[0]! + M[1]! * v[1]! + M[2]! * v[2]!, M[3]! * v[0]! + M[4]! * v[1]! + M[5]! * v[2]!, M[6]! * v[0]! + M[7]! * v[1]! + M[8]! * v[2]!];
const length = (a: ArrayLike<number>): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const mean = (list: readonly V3[]): V3 => times(list.reduce((s, v) => add(s, v), [0, 0, 0] as V3), 1 / list.length);

/** How far in front of the hips the card's face is, how far the soles are kept off it, and how far the paw is tipped on it (toes up): as acts.mts's `scale` has them. */
const FACE = 0.26;
const GRIP = 0.012;
const TIP = deg(80);

/** What the card climb is asked to do (everything that is a size is measured on the cat and on the donor; what is left is how much of each is taken). */
export interface ScaleOptions {
  /** How much of the donor's turns of the back, the neck and the head the cat does (1 is all of them). */
  amount?: number;
  /** Whether the donor's tail moves the cat's. */
  tail?: boolean;
  /** How far the chest leans in to the card (degrees: the cat's own wall posture, as `scale` has it). */
  lean?: number;
  /** How much of the tilt of the Sphynx's shoulder line (its shoulder blades sliding) the cat's chest is rolled by (1: all of it), and whether the head is held level against it. */
  shoulders?: number;
  level?: boolean;
  /** How much wider than the donor's the cat's paws are held across, from its shoulder or its hip (measured, as the shoulders' widths' ratio, if left out). */
  across?: number;
  /** How far from the middle of the cat the paws are held across, the forepaws' and the hind ones (body lengths: a presentation, the card is seen from behind and a paw under the body is not seen), with what the Sphynx's paw does across added. */
  spread?: { front: number; hind: number };
  /** How much of the donor's reach (how far the paw goes up and down against its joint) the fore paws have, and the hind ones (1: all of it), and how much higher the fore paws are held and how much lower the hind (body lengths). */
  reach?: number;
  kick?: number;
  lift?: number;
  sink?: number;
  /** Whether the elbow's (the knee's) place is told to the leg, and how much it counts against the paw's. */
  elbow?: boolean;
  elbowWeight?: number;
  /** How many times round the loop the legs are found (the first ones are to be where a loop that goes on is). */
  rounds?: number;
  /** How far the legs' bones may turn (posegen.mts's `range` and `cap`). */
  range?: "normal" | "wide" | "free";
  cap?: { front?: number; hind?: number };
}

/** What the card climb is made with: the options of the version that was judged blind (docs/cat-animation/QA.md, round 15; the lift, the sink, the spread and the reach were found by looking at sheets of it). */
export const SCALE: ScaleOptions = { amount: 2, tail: true, lean: 24, reach: 1.1, kick: 1.2, lift: 0.18, sink: -0.2, spread: { front: 0.2, hind: 0.2 }, elbow: false, range: "free", cap: { front: 130, hind: 130 } };

interface LegOf {
  paw: PawName;
  fore: boolean;
  side: 1 | -1;
  /** The donor's joint the leg hangs from, its middle joint (elbow, knee), and the joints whose mean is the middle of its sole. */
  joint: string;
  mid: string;
  foot: string;
  pad: string[];
  /** The cat's, the same. */
  catJoint: string;
  catMid: string;
  catFoot: string[];
}

const legs: LegOf[] = [
  { paw: "hind left", fore: false, side: -1, joint: "thigh.L", mid: "shin.L", foot: "foot.L", pad: [2, 3, 4, 5].map((k) => `h_digit${k}_02.L`), catJoint: "backleg", catMid: "backleg0", catFoot: ["backleg0", "backleg1", "backleg2"] },
  { paw: "hind right", fore: false, side: 1, joint: "thigh.R", mid: "shin.R", foot: "foot.R", pad: [2, 3, 4, 5].map((k) => `h_digit${k}_02.R`), catJoint: "R_backleg", catMid: "R_backleg0", catFoot: ["R_backleg0", "R_backleg1", "R_backleg2"] },
  { paw: "front left", fore: true, side: -1, joint: "upperarm.L", mid: "forearm.L", foot: "hand.L", pad: [2, 3, 4, 5].map((k) => `f_digit${k}_01.L`), catJoint: "frontleg", catMid: "frontleg0", catFoot: ["frontleg0", "frontleg1", "frontleg2"] },
  { paw: "front right", fore: true, side: 1, joint: "upperarm.R", mid: "forearm.R", foot: "hand.R", pad: [2, 3, 4, 5].map((k) => `f_digit${k}_01.R`), catJoint: "R_frontleg", catMid: "R_frontleg0", catFoot: ["R_frontleg0", "R_frontleg1", "R_frontleg2"] },
];

/** The nose to the sky and the belly to the wall: a quarter turn about the way across, from the cat facing the wall's way (x) with its back up. */
const UP = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const mul3 = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j]! += a[i * 3 + k]! * b[k * 3 + j]!;
  return out;
};

/** The cat turned about the vertical through the origin (the hips' place and turn: the bones below them go with them): the card is the wall of the cat's side view, and the viewer has its back. */
function spun(cat: Skeleton, pose: Pose, angle: number): void {
  const h = cat.bone("Hips");
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = pose.t[h * 3]!;
  const z = pose.t[h * 3 + 2]!;
  pose.t[h * 3] = x * c + z * s;
  pose.t[h * 3 + 2] = -x * s + z * c;
  const q = after([pose.r[h * 4]!, pose.r[h * 4 + 1]!, pose.r[h * 4 + 2]!, pose.r[h * 4 + 3]!], turnAbout(0, 1, 0, angle)) as Quat;
  for (let k = 0; k < 4; k++) pose.r[h * 4 + k] = q[k]!;
}

/**
 * The climb up the face of a card, seen from behind (`scale`), from the Sphynx's climb of a tree: one round of its loop is a round of the clip, and its stride (what the card goes by in a
 * round) is what the donor's paws go down against its body in the half of the round that they hold, over the half.
 */
export function sphynxScale(m: Made, o: ScaleOptions = SCALE): ClipSource {
  const cat = m.skeleton;
  const body = m.body;
  const donor = readDonor(SPHYNX);
  const animation = donor.animations.findIndex((a) => a.name === "Cat_Climb_Tree");
  const seconds = donor.animations[animation]!.duration;
  const frames = Math.round(seconds * FPS);
  const fps = frames / seconds;
  const A = alignment(donor, SPHYNX_FACING);
  const idx = (name: string): number => donor.names.indexOf(name);
  const ref = donor.at(animation, 0);
  const shots = Array.from({ length: frames }, (_, f) => donor.at(animation, (f * seconds) / frames));
  const world = (P: Float64Array, name: string): V3 => apply(A, [P[idx(name) * 3]!, P[idx(name) * 3 + 1]!, P[idx(name) * 3 + 2]!]);
  const hipsMean = mean(shots.map((s) => world(s.P, "hips")));
  const hipsScale = CAT_HIPS_HEIGHT / SPHYNX_HIPS_HEIGHT;

  // the cat's own wall posture (as `scale` has it), and where its joints are in it
  const lean = o.lean ?? 24;
  const posture: Spec = {
    hips: { x: -0.12, y: 0, pitch: 1.3 },
    back: [deg(90 - lean * 0.4), deg(90 - lean * 0.9)],
    neck: [deg(90 - lean), deg(94 - lean), deg(90 - lean), deg(62 - lean)],
    tail: [deg(262), deg(266), deg(270), deg(272)],
  };
  // (not grounded: a cat on a card is not on a floor, and the hips are where they are told)
  const base = body.make(posture, undefined, undefined, false);
  const WRb = new Float64Array(cat.count * 9);
  const WTb = new Float64Array(cat.count * 3);
  globals(cat, base, undefined, WRb, WTb);
  const links = sphynxLinks(donor, cat).filter((l) => !/leg/.test(l.bone) && ((o.tail ?? true) || !l.bone.startsWith("tail")));
  const hipsBone = cat.bone("Hips");
  // (the Sphynx's shoulders go up and down with its arms, as its shoulder blades slide on its ribs (the cat has none): the line of its shoulders is tipped, and the cat's chest is rolled to the
  // same tilt, about the way it faces; the head is held level against it)
  const tilt = shots.map((s) => Math.atan2(world(s.P, "upperarm.L")[1] - world(s.P, "upperarm.R")[1], Math.abs(world(s.P, "upperarm.L")[2] - world(s.P, "upperarm.R")[2])));
  const tiltMean = tilt.reduce((a, b) => a + b, 0) / tilt.length;
  const laid = shots.map((now, f) => {
    const { D } = turnsAt(donor, animation, (f * seconds) / frames, ref, A);
    const { pose } = turned(cat, base, links, donor, D, o.amount ?? 1, WRb);
    const bob = times(sub(world(now.P, "hips"), hipsMean), hipsScale);
    for (let k = 0; k < 3; k++) pose.t[hipsBone * 3 + k] = base.t[hipsBone * 3 + k]! + bob[k]!;
    const roll = (o.shoulders ?? 0) * (tilt[f]! - tiltMean);
    if (roll) {
      body.turn(pose, "chest", { roll });
      if (o.level) for (const bone of ["neck1", "neck2", "head"]) body.turn(pose, bone, { roll: -roll / 3 });
    }
    return pose;
  });

  // (the legs' lengths, the cat's over the donor's: a leg's paw is as far from its joint as the Sphynx's is, in as many of the cat's lengths as the Sphynx's)
  const chain = (names: string[]): number => names.slice(1).reduce((s, b) => s + length([cat.restT[cat.bone(b) * 3]!, cat.restT[cat.bone(b) * 3 + 1]!, cat.restT[cat.bone(b) * 3 + 2]!]), 0);
  const donorChain = (leg: LegOf): number => {
    const r = donor.at(null, 0);
    const pad = mean(leg.pad.map((n) => world(r.P, n)));
    return length(sub(world(r.P, leg.mid), world(r.P, leg.joint))) + length(sub(world(r.P, leg.foot), world(r.P, leg.mid))) + length(sub(pad, world(r.P, leg.foot)));
  };
  const shoulders = Math.abs(WTb[cat.bone("R_frontleg") * 3 + 2]! - WTb[cat.bone("frontleg") * 3 + 2]!);
  const donorShoulders = Math.abs(world(ref.P, "upperarm.R")[2] - world(ref.P, "upperarm.L")[2]);
  const across = o.across ?? shoulders / donorShoulders;

  interface Track {
    target: V3[];
    away: number[];
    elbow: V3[];
    y: number[];
  }
  const tracks = new Map<PawName, Track>();
  const stride: number[] = [];
  const marks: Record<string, number> = {};
  for (const leg of legs) {
    const k = chain([leg.catJoint, ...leg.catFoot]) / donorChain(leg);
    const jd = mean(shots.map((s) => world(s.P, leg.joint)));
    const jc = body.where(base, leg.catJoint);
    const pads = shots.map((s) => mean(leg.pad.map((n) => world(s.P, n))));
    const depth = pads.map((p, f) => p[0] - world(shots[f]!.P, "hips")[0]);
    const deepest = Math.max(...depth);
    const away = depth.map((d) => k * Math.max(0, deepest - d));
    // (the paw's height from the joint, over the round: how far it goes up and down is the Sphynx's, times `reach` (the forepaws') or `kick` (the hind ones') about its mean, and where that mean is
    // is moved by `lift` and `sink`: a paw is told to work as far as is seen from behind, and the Sphynx's hugs a trunk with its legs folded)
    const heights = pads.map((p) => p[1] - jd[1]);
    const meanHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
    const gain = leg.fore ? (o.reach ?? 1) : (o.kick ?? 1);
    const shift = leg.fore ? (o.lift ?? 0) : (o.sink ?? 0);
    // (across: from the Sphynx's joint, as far as the cat's is wider; if the paws are told to be held out at a distance from the middle, that, with what the Sphynx's paw does about its mean)
    const sideways = pads.map((p) => p[2] - jd[2]);
    const meanSide = sideways.reduce((a, b) => a + b, 0) / sideways.length;
    const spread = o.spread ? (leg.fore ? o.spread.front : o.spread.hind) : undefined;
    const target = pads.map((p, f): V3 => {
      const y = jc[1] + k * (meanHeight + gain * (heights[f]! - meanHeight)) + shift;
      const z = spread === undefined ? jc[2] + across * (p[2] - jd[2]) : leg.side * spread + across * (sideways[f]! - meanSide);
      return [FACE - GRIP - away[f]!, y, z];
    });
    const elbow = shots.map((s, f): V3 => {
      const e = sub(world(s.P, leg.mid), world(s.P, leg.joint));
      const first = length([cat.restT[cat.bone(leg.catMid) * 3]!, cat.restT[cat.bone(leg.catMid) * 3 + 1]!, cat.restT[cat.bone(leg.catMid) * 3 + 2]!]);
      return add(body.where(laid[f]!, leg.catJoint), times(e, first / (length(e) || 1)));
    });
    const y = target.map((t) => t[1]);
    // (the stance is the half of the round that the paw goes down: how far it goes down, over the share of the round that is, is how far the card goes by in a round)
    const top = y.indexOf(Math.max(...y));
    const bottom = y.indexOf(Math.min(...y));
    const down = (bottom - top + frames) % frames;
    stride.push((y[top]! - y[bottom]!) / (down / frames));
    marks[`lift:${leg.paw}`] = (bottom / frames) * seconds;
    marks[`land:${leg.paw}`] = (top / frames) * seconds;
    tracks.set(leg.paw, { target, away, elbow, y });
    if (process.env.SPHYNX_LOG) console.log(`${leg.paw}: k ${k.toFixed(3)} away at most ${Math.max(...away).toFixed(3)} y ${Math.min(...y).toFixed(3)}..${Math.max(...y).toFixed(3)} stance ${down} of ${frames} frames, stride ${stride[stride.length - 1]!.toFixed(3)}`);
  }
  const awayMost = Math.max(...legs.map((l) => Math.max(...tracks.get(l.paw)!.away))) || 1;

  const paws = (f: number): Partial<Record<PawName, PawAim>> => {
    const out: Partial<Record<PawName, PawAim>> = {};
    for (const leg of legs) {
      const t = tracks.get(leg.paw)!;
      const aim: PawAim = { at: t.target[f]!, soft: [1, 1, 1], hold: 0.02, tip: TIP - deg(30) * Math.min(1, t.away[f]! / awayMost) };
      if (o.elbow) {
        aim.elbow = t.elbow[f]!;
        if (o.elbowWeight !== undefined) aim.elbowWeight = o.elbowWeight;
      }
      out[leg.paw] = aim;
    }
    return out;
  };
  const rec = new Recorder(cat, frames);
  let prev: Pose | undefined;
  const miss: number[] = [];
  const rounds = o.rounds ?? 3;
  for (let round = 0; round < rounds; round++) {
    for (let f = 0; f < frames; f++) {
      const aims = paws(f);
      const pose = body.make({ solid: { floor: false, wall: FACE }, range: o.range ?? "free", ...(o.cap ? { cap: o.cap } : {}), paws: aims }, prev, laid[f]!, false);
      prev = pose;
      if (round < rounds - 1) continue;
      for (const leg of legs) miss.push(length(sub(body.padOf(pose, leg.paw), aims[leg.paw]!.at)));
      spun(cat, pose, Math.PI / 2);
      rec.put(f, pose);
    }
  }
  if (process.env.SPHYNX_LOG) console.log(`sphynx scale: the paws are off their places by ${Math.max(...miss).toFixed(3)} at the worst, ${(miss.reduce((a, b) => a + b, 0) / miss.length).toFixed(3)} on average; stride ${(stride.reduce((a, b) => a + b, 0) / stride.length).toFixed(3)}`);
  return { ...rec.source("scale", fps, true, marks), stride: stride.reduce((a, b) => a + b, 0) / stride.length };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the ledge climb: the hang

/** What the hang of the ledge climb is asked to do (the sizes are measured on the cat and the donor; what is left is how much of each is taken, and when). */
export interface LedgeOptions {
  /** The Sphynx's animation the hang is laid on, and whether its body is horizontal (a swim: it is turned up a quarter, its nose to the sky and its belly to the wall, as the hanging cat is). */
  from?: string;
  upright?: boolean;
  /** How much of the donor's turns of the back, the neck, the head and the tail the hanging cat does (1 is all of them), and whether the tail is the donor's. */
  amount?: number;
  tail?: boolean;
  /** How fast the donor's round goes (1 is its own pace), and where in its round the clip starts (seconds: the hind paws at the bottom of their stroke, as a cat that hangs has them). */
  speed?: number;
  start?: number;
  /** How much of the donor's travel the hind paws have, up and down (1: as far as the Sphynx's, in the cat's lengths) and in and out from the wall. */
  kick?: number;
  depth?: number;
  /** How much of the donor's hips' travel the hanging cat's hips have. */
  hips?: number;
  /** Whether the hind paws are held to the wall while the Sphynx's are against its trunk, and come away from it as its do (rather than hung from the hips, in and out by the donor's travel). */
  wall?: boolean;
  /** The progress that the donor's hind paws take over from the climb's own by (from, to): the start of the clip is the climb's own hang. */
  in?: readonly [number, number];
  /** The progress that the donor's hold on the body is full to, and gone by (the body's turns), and the same for the hind paws, which then go to the places of the climb's own hook over the lip. */
  body?: readonly [number, number];
  paws?: readonly [number, number];
  /** Whether the climb's own swing of the body on its arms (a typed sway of the hips and the tail) is left in. */
  sway?: boolean;
}

/** What the hang is made with: the options of the version that was judged blind (QA.md, round 15): the Sphynx's swim, its body turned up a quarter, taking over from the climb's own hang over the first 0.12 of the clip. */
export const LEDGE: LedgeOptions = { from: "Cat_Swim", upright: true, in: [0, 0.12], amount: 1, tail: false, speed: 1, start: 0, kick: 1, depth: 1, hips: 0, wall: false, body: [0.32, 0.47], paws: [0.4, 0.62], sway: true };

/**
 * The ledge climb (`climb`, played by its progress, with the engine's beats where they are) with the Sphynx's climb of a tree (Cat_Climb_Tree) put on its hang: the climb's own keys and
 * the places of its forepaws on the lip are what they were, and while the cat hangs the body, the neck, the head and the tail turn as the Sphynx's do from where it starts, the hips go
 * as its hips go, and the hind paws go up and down the wall as its hind paws do (from where they hang), until they go over the lip as the climb has them.
 */
export function sphynxLedge(m: Made, o: LedgeOptions = LEDGE): ClipSource {
  const cat = m.skeleton;
  const body = m.body;
  const donor = readDonor(SPHYNX);
  const animation = donor.animations.findIndex((a) => a.name === (o.from ?? "Cat_Climb_Tree"));
  const seconds = donor.animations[animation]!.duration;
  // (the donor's body turned to the way the cat faces; an upright cat, hanging, is that turned up a quarter about the way across: its nose up and its belly to the wall)
  const faced = alignment(donor, SPHYNX_FACING);
  const A = o.upright ? mul3(UP, faced) : faced;
  const idx = (name: string): number => donor.names.indexOf(name);
  const world = (P: Float64Array, name: string): V3 => apply(A, [P[idx(name) * 3]!, P[idx(name) * 3 + 1]!, P[idx(name) * 3 + 2]!]);
  const start = o.start ?? 0.4;
  const ref = donor.at(animation, start);
  const links = sphynxLinks(donor, cat).filter((l) => !/leg/.test(l.bone) && ((o.tail ?? true) || !l.bone.startsWith("tail")));
  const hipsBone = cat.bone("Hips");
  const hipsScale = CAT_HIPS_HEIGHT / SPHYNX_HIPS_HEIGHT;

  const { spec, marks } = climbSpec(m, { sway: o.sway ?? false });
  const frames = Math.max(2, Math.round(CLIMB_TIME * FPS) + 1);
  const fps = (frames - 1) / CLIMB_TIME;
  const over = (u: number, from: number, to: number): number => {
    const x = Math.min(1, Math.max(0, (u - from) / (to - from || 1)));
    return x * x * (3 - 2 * x);
  };

  // (the hind legs: the Sphynx's paw against its hips, at the bottom of its stroke and at each time, taken in the cat's lengths: as many of the cat's as the Sphynx's)
  const chain = (names: string[]): number => names.slice(1).reduce((s, b) => s + length([cat.restT[cat.bone(b) * 3]!, cat.restT[cat.bone(b) * 3 + 1]!, cat.restT[cat.bone(b) * 3 + 2]!]), 0);
  const restPose = donor.at(null, 0);
  const hind = legs.filter((l) => !l.fore);
  const ratio = new Map<PawName, number>();
  for (const leg of hind) {
    const pad = mean(leg.pad.map((n) => world(restPose.P, n)));
    const donorChain = length(sub(world(restPose.P, leg.mid), world(restPose.P, leg.joint))) + length(sub(world(restPose.P, leg.foot), world(restPose.P, leg.mid))) + length(sub(pad, world(restPose.P, leg.foot)));
    ratio.set(leg.paw, chain([leg.catJoint, ...leg.catFoot]) / donorChain);
  }
  const padAgainstHips = (P: Float64Array, leg: LegOf): V3 => sub(mean(leg.pad.map((n) => world(P, n))), world(P, "hips"));
  const hang0 = new Map<PawName, V3>();
  for (const leg of hind) hang0.set(leg.paw, padAgainstHips(ref.P, leg));
  // (how near the wall a hind paw of the Sphynx's gets, against its hips, over a round: where it is against its trunk)
  const deepest = new Map<PawName, number>();
  const lowest = new Map<PawName, number>();
  for (const leg of hind) {
    const round = Array.from({ length: 24 }, (_, i) => padAgainstHips(donor.at(animation, (i * seconds) / 24).P, leg));
    deepest.set(leg.paw, Math.max(...round.map((p) => p[0])));
    lowest.set(leg.paw, Math.min(...round.map((p) => p[1])));
  }

  // (the places the climb has the hind paws at when it hangs: from the hips, as told at its first frame)
  const first = spec(0, 0);
  const hipsAt0 = first.hips!.y;
  const rec = new Recorder(cat, frames);
  let prev: Pose | undefined;
  let own: Pose | undefined;
  const WR = new Float64Array(cat.count * 9);
  const WT = new Float64Array(cat.count * 3);
  const miss: number[] = [];
  // (the arms of a cat that hangs by them are at the end of their reach, which they never get to: the search for them (posegen.mts's `reach`) tries other starts when the paw is not at its
  // place, and a body that has moved a little is enough for it to choose another bend of the elbow. The arms are the climb's own, as they are found for its body, and go with the chest; the
  // hind legs are found for the body that the Sphynx's turns have made, from where they were in the frame before)
  const arms = legs.filter((l) => l.fore).flatMap((l) => [l.catJoint, ...l.catFoot].map((b) => cat.bone(b)));
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const t = f / fps;
    const s = spec(t, u);
    own = body.make(s, own, undefined, false);
    const { paws: told, ...torso } = s;
    const wBody = 1 - over(u, o.body![0], o.body![1]);
    const wPaws = over(u, o.in![0], o.in![1]) * (1 - over(u, o.paws![0], o.paws![1]));
    // (the donor's time: its round goes on, at its pace times `speed`, from where the paws are at the bottom of their stroke)
    const when = (start + (o.speed ?? 1) * t) % seconds;
    const now = donor.at(animation, when);
    const P0 = body.make(torso, prev, undefined, false);
    globals(cat, P0, undefined, WR, WT);
    const { D } = turnsAt(donor, animation, when, ref, A);
    const { pose: P1 } = turned(cat, P0, links, donor, D, (o.amount ?? 1) * wBody, WR);
    const bob = times(sub(world(now.P, "hips"), world(ref.P, "hips")), hipsScale * (o.hips ?? 1) * wBody);
    for (let k = 0; k < 3; k++) P1.t[hipsBone * 3 + k] = P1.t[hipsBone * 3 + k]! + bob[k]!;
    const hipsY = P1.t[hipsBone * 3 + 1]!;
    const aims: Partial<Record<PawName, PawAim>> = {};
    for (const leg of hind) {
      const shipped = told![leg.paw]!;
      const against = sub(padAgainstHips(now.P, leg), hang0.get(leg.paw)!);
      const k = ratio.get(leg.paw)!;
      // (where the climb has the paw hung from the hips at its first frame, and the Sphynx's travel from the bottom of its stroke added: up, and in towards the wall)
      const hung = first.paws![leg.paw]!.at;
      const near = -CLIMB_LIP - GRIP - k * (o.depth ?? 1) * Math.max(0, deepest.get(leg.paw)! - padAgainstHips(now.P, leg)[0]);
      const here = padAgainstHips(now.P, leg);
      // (a donor that is upright (a swim) is told by where its paw is against its hips, not by how far it has gone from where it started: the paw is under the body, which is the wall's side, and
      // goes up the body and down it; at the bottom of its stroke it is where the cat's hangs)
      const at: V3 = o.upright
        ? [Math.min(-CLIMB_LIP - GRIP, P1.t[hipsBone * 3]! + k * (o.depth ?? 1) * here[0]), hipsY + (hung[1] - hipsAt0) + k * (o.kick ?? 1) * (here[1] - lowest.get(leg.paw)!), shipped.at[2]]
        : [o.wall ? near : hung[0] + k * (o.depth ?? 1) * against[0], hipsY + (hung[1] - hipsAt0) + k * (o.kick ?? 1) * against[1], shipped.at[2]];
      aims[leg.paw] = { ...shipped, at: [at[0] + (shipped.at[0] - at[0]) * (1 - wPaws), at[1] + (shipped.at[1] - at[1]) * (1 - wPaws), shipped.at[2]] };
    }
    const from = new Pose(cat);
    from.copy(prev ?? own);
    for (const j of arms) for (let k = 0; k < 4; k++) from.r[j * 4 + k] = own.r[j * 4 + k]!;
    const pose = body.make({ ...(s.solid ? { solid: s.solid } : {}), ...(s.cap ? { cap: s.cap } : {}), paws: aims }, from, P1, false);
    for (const leg of hind) miss.push(length(sub(body.padOf(pose, leg.paw), aims[leg.paw]!.at)));
    prev = pose;
    rec.put(f, pose);
  }
  if (process.env.SPHYNX_LOG) console.log(`sphynx ledge: the hind paws are off their places by ${Math.max(...miss).toFixed(3)} at the worst, ${(miss.reduce((a, b) => a + b, 0) / miss.length).toFixed(3)} on average`);
  return rec.source("climb", fps, false, marks);
}
