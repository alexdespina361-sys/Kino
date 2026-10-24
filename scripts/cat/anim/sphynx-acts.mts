// The acts of the cat that the Sphynx's motion is laid on, where the turns of its bones are not the whole of what is wanted (recipes/sphynx.mts says why: its trunk is a third as long as
// this cat's, and its forelegs have an elbow and a shoulder blade). Each act here is a posture that the cat already has (the last of its sit), moved the way the Sphynx's back, neck, head and
// tail move from where they are at the first frame of its animation (the turns of its bones in the world, as retarget.mts has them, laid on the cat's pose and not on its rest), with the
// paw that the Sphynx raises put where the Sphynx's is against its head (the place of its paw from its head's joint, in the world, taken to the cat's axes), and every other paw kept on the
// floor where the pose has it. No bone is turned by a number written here: the donor's motion is the head's and the neck's, and the paw is a place that the bones of the leg are solved for.
import { Pose, globals, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import { HEAD_CENTRE, MOUTH } from "../../../src/client/cat/render/gl/mouth";
import { lastOf, sit, type Made } from "./acts.mts";
import { readDonor, type Donor } from "./donor.mts";
import { Recorder, type PawName, type PawAim } from "./posegen.mts";
import { SPHYNX, SPHYNX_FACING, sphynxLinks } from "./recipes/sphynx.mts";
import { alignment, matOf, mul3, quatOfMatrix, slerp, tr3, type Link } from "./retarget.mts";

const FPS = 30;
const ALL: PawName[] = ["hind left", "hind right", "front left", "front right"];

type V3 = [number, number, number];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const add = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const scale = (a: ArrayLike<number>, k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
const apply = (M: ArrayLike<number>, v: ArrayLike<number>): V3 => [M[0]! * v[0]! + M[1]! * v[1]! + M[2]! * v[2]!, M[3]! * v[0]! + M[4]! * v[1]! + M[5]! * v[2]!, M[6]! * v[0]! + M[7]! * v[1]! + M[8]! * v[2]!];
const length = (a: ArrayLike<number>): number => Math.hypot(a[0]!, a[1]!, a[2]!);
/** The smaller of two numbers, rounded off over `k` where they are close (so that a ceiling is not a corner). */
const smoothMin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** What an act of the Sphynx is asked to do (all of these are measured on the cat and on the donor; the numbers that are left are places and times). */
export interface SphynxOptions {
  /** How much of the Sphynx's distance from its head to its paw the cat's paw keeps (the heads are about as large: 1). */
  scale?: number;
  /** Where the cat's paw is held against the donor's own place, across the head's frame: a turn about the cat's z axis (radians) of the paw's place about the head's joint. */
  trim?: number;
  /** Whether the donor's tail moves the cat's (the sit's tail is left to lie as it is if not). */
  tail?: boolean;
  /** Whether the elbow's place is told to the leg (where the Sphynx's elbow is against its shoulder, as far as the cat's upper limb is long). */
  elbow?: boolean;
  /** How much of the donor's head, neck and back motion the cat does (1 is all of it). */
  amount?: number;
  /** How much of the turn of the donor's paw (the toes up or down against where they were) the cat's paw is given (1 is all of it, 0 keeps the paw as it stands). */
  tip?: number;
  /** How much wider than the donor's the cat's paw is held across (the cat's shoulders over the donor's: measured, if not told). */
  across?: number;
  /** How far above the shoulder the paw may be held (body lengths). */
  ceiling?: number;
  /** How far out from the shoulder, to its side, the paw may be held (body lengths). */
  outside?: number;
  /** How much the elbow's place counts against the paw's (the leg's own default if left out). */
  elbowWeight?: number;
  /** How much more the elbow's place counts while the paw wipes the face (added to `elbowWeight` at the most of the wipe). */
  elbowWipe?: number;
  /** How much of the donor's wipe of its face (the paw above and out from where it is held for the licks) the cat's paw makes (1: all of it). */
  wipe?: number;
  /** The licks go on from this second of the donor's animation to this (where the paw is held at the mouth). */
  lickFrom?: number;
  lickTo?: number;
  /** How many frames either side the paw's goal is averaged over (the binomial window). */
  slow?: number;
  /** The same for how far the paw has come up from the floor (the rise and the fall are spread over this many frames more). */
  ramp?: number;
  /** The power the paw's rise is raised to (more than 1: slow at the start of the rise and the end of the fall). */
  start?: number;
  /** How many times longer than the donor's the paw's rise and its fall are taken. */
  raiseBy?: number;
  lowerBy?: number;
  /** How much of the paw's rise it has to be (of the licks' height) for the leg to be left to the search alone: under it the leg is as the sit has it, eased in. */
  settle?: number;
  /** The leg is solved for the paw's place at the head at every frame, and the sit's bones are turned toward the solved ones by how far the paw has come up (instead of the paw being searched for on its way up). */
  blend?: boolean;
  /**
   * The paw is held against the cat's face, not where the donor's is against its head's joint: the donor's paw is a head's height below its mouth and its long tongue goes down to it, the cat's
   * mouth is painted on its muzzle and its tongue does not leave it, so the paw is taken up to a place of the cat's lower lip (`contact`), and what the donor's paw does round the place where it
   * is held for the licks (the strokes, the wipe) is done round that one.
   */
  face?: boolean;
  /** That place, from the middle of the head, forward and up, as the mesh has it at rest (body lengths): the lower lip, a little under the lip line, if it is not told. */
  contact?: readonly [number, number];
}

/** What the groom is made with (found by looking at sheets of it: docs/cat-animation/QA.md, round 15). */
export const GROOM: SphynxOptions = { scale: 0.9, amount: 0.6, tip: 1, elbow: true, face: true, ceiling: 0.2, across: 1, wipe: 0.4, elbowWipe: 0.8, slow: 3, ramp: 4, start: 1, raiseBy: 1.5, lowerBy: 2, blend: true };

/** A donor's pose, in the cat's axes: the turn of every bone from the donor's first frame of `animation` to `time` (`D` of retarget.mts, taken to the cat's axes by `A`), and the places of its joints. */
export function turnsAt(donor: Donor, animation: number, time: number, ref: ReturnType<Donor["at"]>, A: number[]): { D: number[][]; now: ReturnType<Donor["at"]> } {
  const now = donor.at(animation, time);
  const At = tr3(A);
  const D: number[][] = [];
  for (let i = 0; i < donor.names.length; i++) D.push(mul3(mul3(A, mul3(now.R, tr3(ref.R, i * 9), i * 9, 0)), At));
  return { D, now };
}

/** A turn `D` (about the cat's axes) made `k` of the way (a slerp from nothing). */
const part = (D: number[], k: number): number[] => (k === 1 ? D : matOf(slerp([0, 0, 0, 1], quatOfMatrix(D), k)));

/**
 * The cat's pose with its back, neck, head and tail turned as the donor's are from `ref` to `time`, where the pose `base` has them: a bone of the cat that follows a bone of the donor is
 * given the donor's turn in the world after its own world turn in `base`, and every other bone keeps its turn against its parent. Returns the pose and the world turn of every bone.
 */
export function turned(cat: Skeleton, base: Pose, links: readonly Link[], donor: Donor, D: number[][], amount: number, WRb: Float64Array): { pose: Pose; W: number[][] } {
  const n = cat.count;
  const pose = new Pose(cat);
  pose.copy(base);
  const linkOf = new Map<number, Link>();
  for (const l of links) linkOf.set(cat.bone(l.bone), l);
  const W: number[][] = new Array(n);
  for (let j = 0; j < n; j++) {
    const parent = cat.parent[j]!;
    const link = linkOf.get(j);
    if (link) {
      const turn = (name: string): number[] => D[donor.names.indexOf(name)]!;
      let delta: number[];
      if (typeof link.follows === "string") delta = turn(link.follows);
      else delta = matOf(slerp(quatOfMatrix(turn(link.follows.from)), quatOfMatrix(turn(link.follows.to)), link.follows.at));
      W[j] = mul3(amount === 1 ? delta : part(delta, amount), WRb, 0, j * 9);
      const local = parent >= 0 ? mul3(tr3(W[parent]!), W[j]!) : W[j]!;
      const q = quatOfMatrix(local);
      for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = q[k]!;
    } else {
      // (it goes with its parent as it was in the pose)
      const own = matOf([pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!]);
      W[j] = parent >= 0 ? mul3(W[parent]!, own) : own;
    }
  }
  return { pose, W };
}

const PAD = ["f_digit2_01.R", "f_digit3_01.R", "f_digit4_01.R", "f_digit5_01.R"];

/**
 * The groom: the cat that sits washes its paw as the Sphynx does (Cat_Lick_Paw): the head and the neck go down to the paw, which is brought up to the chin; a few licks; the paw is
 * wiped across the face; it goes down again. The clip starts and ends in the last pose of the sit (the director plays a groom from the sit).
 */
export function sphynxGroom(m: Made, o: SphynxOptions = GROOM): ClipSource {
  const cat = m.skeleton;
  const body = m.body;
  const donor = readDonor(SPHYNX);
  const animation = donor.animations.findIndex((a) => a.name === "Cat_Lick_Paw");
  const length0 = donor.animations[animation]!.duration;
  // (the paw comes up in the donor from about 0.12 s to 0.55 s, and goes down from about 3.35 s to 3.8 s: a cat of this build, with a long upper limb to fold, is given longer for each, and the
  // donor's time runs slower through them; the rest of the clip is the donor's own pace)
  const [r0, r1, l0, l1] = [0.12, 0.55, 3.35, 3.8];
  const raiseBy = o.raiseBy ?? 1;
  const lowerBy = o.lowerBy ?? 1;
  const T1 = r0 + (r1 - r0) * raiseBy;
  const T2 = T1 + (l0 - r1);
  const T3 = T2 + (l1 - l0) * lowerBy;
  const seconds = T3 + (length0 - l1);
  const warp = (t: number): number => (t <= r0 ? t : t <= T1 ? r0 + ((t - r0) / raiseBy) : t <= T2 ? r1 + (t - T1) : t <= T3 ? l0 + (t - T2) / lowerBy : l1 + (t - T3));
  const frames = Math.round(seconds * FPS);
  const fps = frames / seconds;
  const time = (f: number): number => warp((f * seconds) / frames);
  const A = alignment(donor, SPHYNX_FACING);
  const ref = donor.at(animation, 0);
  const base = lastOf(m, sit(m));
  const WRb = new Float64Array(cat.count * 9);
  const WTb = new Float64Array(cat.count * 3);
  globals(cat, base, undefined, WRb, WTb);
  // the bones that follow the donor's: the back above the hips, the neck, the head and (if asked) the tail; the legs, and the hips, stay as the sit has them
  const tailed = o.tail ?? false;
  const links = sphynxLinks(donor, cat).filter((l) => !/leg/.test(l.bone) && l.bone !== "Hips" && (tailed || !l.bone.startsWith("tail")));
  const idx = (name: string): number => donor.names.indexOf(name);
  const head = idx("head");
  const padOfDonor = (P: Float64Array): V3 => {
    let s: V3 = [0, 0, 0];
    for (const n of PAD) s = add(s, scale([P[idx(n) * 3]!, P[idx(n) * 3 + 1]!, P[idx(n) * 3 + 2]!], 1 / PAD.length));
    return s;
  };
  const headOf = (P: Float64Array): V3 => [P[head * 3]!, P[head * 3 + 1]!, P[head * 3 + 2]!];
  const near: PawName = "front right";
  const s = o.scale ?? 1;
  // (the cat's shoulders are as far apart as they are, and the donor's as far: what is across, the paw's place and the head's, goes by how much wider the one is)
  const shoulders = Math.abs(WTb[cat.bone("R_frontleg") * 3 + 2]! - WTb[cat.bone("frontleg") * 3 + 2]!);
  const donorShoulders = Math.abs(ref.P[idx("upperarm.R") * 3]! - ref.P[idx("upperarm.L") * 3]!);
  const across = o.across ?? shoulders / donorShoulders;
  // (the direction the toes point in, seen from the side: the angle above the way the cat faces; a paw on the floor has it at where it is at the first frame)
  const toes = (P: Float64Array): number => {
    const d = apply(A, sub([P[idx("f_digit3_02.R") * 3]!, P[idx("f_digit3_02.R") * 3 + 1]!, P[idx("f_digit3_02.R") * 3 + 2]!], [P[idx("f_digit3_01.R") * 3]!, P[idx("f_digit3_01.R") * 3 + 1]!, P[idx("f_digit3_01.R") * 3 + 2]!]));
    return Math.atan2(d[1], d[0]);
  };
  const toes0 = toes(ref.P);
  // the paw's lift in the donor (0 on the floor, 1 where it is at while it is licked): the cat's paw comes up as far, of the way to where the mouth is, as the donor's does
  const donorAt = (f: number): ReturnType<Donor["at"]> => donor.at(animation, time(f));
  const rise = Array.from({ length: frames }, (_, f) => padOfDonor(donorAt(f).P)[1]);
  const low = Math.min(...rise);
  // (the licks: from the first second to the last but one's end, where the paw is held at the mouth, over and over)
  const licking = Array.from({ length: frames }, (_, f) => f).filter((f) => time(f) >= (o.lickFrom ?? 0.8) && time(f) <= (o.lickTo ?? 2.5));
  const mean = <T,>(values: T[], pick: (v: T) => number): number => values.reduce((a, v) => a + pick(v), 0) / values.length;
  const held = mean(licking, (f) => rise[f]!);
  // (a straight leg that is folded gives its first joint most of its bend in the first tenth of its paw's rise: the rise is spread over more frames than the donor's, all the way round the loop)
  const raw = Array.from({ length: frames }, (_, f) => Math.max(0, Math.min(1, (rise[f]! - low) / (held - low || 1))));
  const ramp = o.ramp ?? 5;
  const eased = raw.map((_, f) => {
    let sum = 0;
    let weight = 0;
    for (let d = -ramp; d <= ramp; d++) {
      const w = ramp + 1 - Math.abs(d);
      sum += raw[(f + d + frames) % frames]! * w;
      weight += w;
    }
    return sum / weight;
  });
  // (and a straight leg's elbow opens as the square root of how far the paw is from where it is straight: the paw's rise is made to start slowly, as that square, so that the elbow's turn is an even one)
  const lifted = (f: number): number => Math.pow(eased[f]!, o.start ?? 2);
  // (where the donor's paw is from its head's joint, in the cat's axes, at each frame, and where it is held while the licks go on; across, it is from its shoulder, whose side the paw is on)
  const shoulderOf = (P: Float64Array): V3 => [P[idx("upperarm.R") * 3]!, P[idx("upperarm.R") * 3 + 1]!, P[idx("upperarm.R") * 3 + 2]!];
  // (the Sphynx's mouth, a point of its head: the tip of its tongue as it lies in the rest, in the head's own frame; and at each frame, where that point is)
  const restDonor = donor.at(null, 0);
  const mouthLocal = ((): V3 => {
    const t = idx("tongue_05");
    const d = sub([restDonor.P[t * 3]!, restDonor.P[t * 3 + 1]!, restDonor.P[t * 3 + 2]!], [restDonor.P[head * 3]!, restDonor.P[head * 3 + 1]!, restDonor.P[head * 3 + 2]!]);
    return [0, 1, 2].map((i) => restDonor.R[head * 9 + i]! * d[0] + restDonor.R[head * 9 + 3 + i]! * d[1] + restDonor.R[head * 9 + 6 + i]! * d[2]) as V3;
  })();
  const mouthOf = (now: ReturnType<Donor["at"]>): V3 => {
    const h = headOf(now.P);
    return [0, 1, 2].map((i) => h[i]! + now.R[head * 9 + i * 3]! * mouthLocal[0] + now.R[head * 9 + i * 3 + 1]! * mouthLocal[1] + now.R[head * 9 + i * 3 + 2]! * mouthLocal[2]) as V3;
  };
  const relative = Array.from({ length: frames }, (_, f): V3 => {
    const now = donorAt(f);
    const P = now.P;
    const pad = padOfDonor(P);
    const fromHead = apply(A, sub(pad, o.face ? mouthOf(now) : headOf(P)));
    const fromShoulder = apply(A, sub(pad, shoulderOf(P)));
    return [fromHead[0], fromHead[1], fromShoulder[2]];
  });
  // (the cat's: a point of its head, the lower lip, in the head's own frame, and where it is in a pose)
  const R0 = new Float64Array(cat.count * 9);
  const T0 = new Float64Array(cat.count * 3);
  globals(cat, new Pose(cat), undefined, R0, T0);
  const headBone = cat.bone("head");
  const contactRest: V3 = [HEAD_CENTRE[0] + (o.contact?.[0] ?? 0.09), HEAD_CENTRE[1] + (o.contact?.[1] ?? MOUTH.front - 0.045), 0];
  const contactLocal = ((): V3 => {
    const d = sub(contactRest, [T0[headBone * 3]!, T0[headBone * 3 + 1]!, T0[headBone * 3 + 2]!]);
    return [0, 1, 2].map((i) => R0[headBone * 9 + i]! * d[0] + R0[headBone * 9 + 3 + i]! * d[1] + R0[headBone * 9 + 6 + i]! * d[2]) as V3;
  })();
  const RP = new Float64Array(cat.count * 9);
  const TP = new Float64Array(cat.count * 3);
  const contactAt = (pose: Pose): V3 => {
    globals(cat, pose, undefined, RP, TP);
    return [0, 1, 2].map((i) => TP[headBone * 3 + i]! + RP[headBone * 9 + i * 3]! * contactLocal[0] + RP[headBone * 9 + i * 3 + 1]! * contactLocal[1] + RP[headBone * 9 + i * 3 + 2]! * contactLocal[2]) as V3;
  };
  const plateau: V3 = [mean(licking, (f) => relative[f]![0]), mean(licking, (f) => relative[f]![1]), mean(licking, (f) => relative[f]![2])];
  const wipe = o.wipe ?? 0.4;
  const padBase: Record<string, V3> = {};
  for (const p of ALL) padBase[p] = body.padOf(base, p);
  const trim = o.trim ?? 0;
  const cs = Math.cos(trim);
  const sn = Math.sin(trim);
  // the turned poses, and the paw's goal at each frame (the paw's place against the head, whose place is the turned pose's)
  const laid = Array.from({ length: frames }, (_, f) => turned(cat, base, links, donor, turnsAt(donor, animation, time(f), ref, A).D, o.amount ?? 1, WRb).pose);
  const goals = Array.from({ length: frames }, (_, f): V3 => {
    const r = relative[f]!;
    // (the donor's paw goes above where it is held for the licks, and out from it, to wipe its face: a cat whose upper limb is this long winds the whole of it round its chest to do that, so
    // as much of the way past the licks as `wipe` says)
    const up = r[1] - plateau[1];
    const out = r[2] - plateau[2];
    // (held against the face, the place is the lip's, and the paw's strokes and wipes are from where it is held)
    const y = (o.face ? 0 : plateau[1]) + (up > 0 ? wipe * up : up);
    const z = plateau[2] + (out > 0 ? wipe * out : out);
    const x = o.face ? r[0] - plateau[0] : r[0];
    const rotated: V3 = [x * cs - y * sn, x * sn + y * cs, z];
    const head = o.face ? contactAt(laid[f]!) : body.where(laid[f]!, "head");
    const shoulder = body.where(laid[f]!, "R_frontleg");
    // (along and up from the head's joint, or from the lip; across from the shoulder)
    const at: V3 = [head[0] + rotated[0] * s, head[1] + rotated[1] * s, shoulder[2] + rotated[2] * across];
    at[1] = smoothMin(at[1], shoulder[1] + (o.ceiling ?? 0.05), 0.05);
    at[2] = smoothMin(at[2], shoulder[2] + (o.outside ?? 0.04), 0.04);
    // (a blended leg is solved for the paw's place against the head at every frame, and is let down to the sit's by blending: its goal is not eased down to the floor)
    const k = o.blend ? 1 : lifted(f);
    const down = padBase[near]!;
    return [down[0] + (at[0] - down[0]) * k, down[1] + (at[1] - down[1]) * k, down[2] + (at[2] - down[2]) * k];
  });
  // (the donor's paw is tossed to its face in a tenth of a second: a limb this heavy is not, and the goal is made a little slower, all the way round the loop)
  const smoothed = goals.map((_, f): V3 => {
    const radius = o.slow ?? 2;
    let sum: V3 = [0, 0, 0];
    let weight = 0;
    for (let d = -radius; d <= radius; d++) {
      const w = radius + 1 - Math.abs(d);
      sum = add(sum, scale(goals[(f + d + frames) % frames]!, w));
      weight += w;
    }
    return scale(sum, 1 / weight);
  });
  const toeAngles = Array.from({ length: frames }, (_, f) => toes(donorAt(f).P) - toes0);
  // (how far into the wipe the donor's paw is, 0 to 1: the elbow is held back and down as that goes on, so that the limb does not fold itself forward round the paw)
  const excess = relative.map((r) => Math.max(0, r[1] - plateau[1]) + Math.max(0, r[2] - plateau[2]));
  const mostExcess = Math.max(...excess) || 1;
  const wiping = excess.map((x) => Math.min(1, x / (0.6 * mostExcess)));
  const elbows = Array.from({ length: frames }, (_, f): V3 => {
    const P = donorAt(f).P;
    const sh = body.where(laid[f]!, "R_frontleg");
    const e = apply(A, sub([P[idx("forearm.R") * 3]!, P[idx("forearm.R") * 3 + 1]!, P[idx("forearm.R") * 3 + 2]!], [P[idx("upperarm.R") * 3]!, P[idx("upperarm.R") * 3 + 1]!, P[idx("upperarm.R") * 3 + 2]!]));
    const reach = Math.hypot(cat.restT[cat.bone("R_frontleg0") * 3]!, cat.restT[cat.bone("R_frontleg0") * 3 + 1]!, cat.restT[cat.bone("R_frontleg0") * 3 + 2]!);
    return add(sh, scale(e, reach / (length(e) || 1)));
  });
  const nearLeg = ["R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"].map((b) => cat.bone(b));
  const rec = new Recorder(cat, frames);
  let prev: Pose | undefined;
  const miss: number[] = [];
  const paws = (f: number): Partial<Record<PawName, PawAim>> => {
    const out: Partial<Record<PawName, PawAim>> = {};
    for (const p of ALL) out[p] = { at: padBase[p]! };
    const aim: PawAim = { at: smoothed[f]! };
    if (o.tip) aim.tip = o.tip * toeAngles[f]!;
    if (o.elbow) {
      aim.elbow = elbows[f]!;
      aim.elbowWeight = (o.elbowWeight ?? 0.15) + (o.elbowWipe ?? 0) * wiping[f]!;
    }
    out[near] = aim;
    return out;
  };
  // (a loop is gone round once beforehand, so that its first frame is found from its last)
  for (let round = 0; round < 2; round++) {
    for (let f = 0; f < frames; f++) {
      const aims = paws(f);
      const pose = body.make({ paws: aims }, prev, laid[f]!, false);
      prev = pose;
      if (round < 1) continue;
      // (the leg is as the sit has it where the paw is on the floor, whichever of its bends the search came to: the clip starts and ends in the sit, and a loop closes)
      // (a blended leg: the sit's bones turned toward the solved ones as far as the paw has come up, whatever the paw's place in between: the elbow opens evenly, as the paw comes up)
      const up = Math.min(1, Math.max(0, lifted(f)));
      const share = o.blend ? 1 - up : Math.max(0, 1 - lifted(f) / (o.settle ?? 0.25));
      if (share > 0) {
        const keep = o.blend ? 1 - up * up * (3 - 2 * up) : share * share * (3 - 2 * share);
        for (const j of nearLeg) {
          const q = slerp([pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!], [base.r[j * 4]!, base.r[j * 4 + 1]!, base.r[j * 4 + 2]!, base.r[j * 4 + 3]!], keep);
          for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = q[k]!;
        }
      }
      rec.put(f, pose);
      miss.push(length(sub(body.padOf(pose, near), aims[near]!.at)));
    }
  }
  if (process.env.SPHYNX_LOG) console.log(`sphynx groom: the near paw is off its place by ${Math.max(...miss).toFixed(3)} at the worst, ${(miss.reduce((a, b) => a + b, 0) / miss.length).toFixed(3)} on average`);
  return rec.source("groom", fps, true, {});
}
