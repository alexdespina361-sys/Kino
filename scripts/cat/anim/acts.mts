// The cat's postures and acts that no animal of the donors does (lying down, curling up, the bow of a stretch, a paw at the face, a paw that kneads), made by constraints: each is a few
// postures told as numbers (posegen.mts: the hips, the bends of the back, the neck and the tail, where the paws are) and the way one passes into the next, and every frame is the posture
// the numbers say at that moment, solved for the bones. Nothing here is a bone's turn written by hand: change a number and the bones follow. An act that is done from a posture a donor
// has (a cat that sits and washes) is laid on that donor's pose, so that what is the donor's stays its own.
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { Pose, sampleFrame, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import { CLIMB_GRAB, CLIMB_LIP, CLIMB_OVER, CLIMB_PULL, CLIMB_TIME } from "../../../src/client/cat/types";
import { Body, mixSpec, Recorder, type PawName, type Spec } from "./posegen.mts";
import { poseAt } from "./source.mts";

const FPS = 30;
const deg = (d: number): number => (d * Math.PI) / 180;
const TAU = Math.PI * 2;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** 0 to 1 and slowly at both ends. */
const ease = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** `ease` over the stretch of time from `at` to `at + length`. */
const over = (t: number, at: number, length: number): number => ease((t - at) / length);
/** A bump: 0, up to 1 over `rise`, held until `fall` starts, and back to 0 over `fall`. */
const bump = (t: number, from: number, rise: number, hold: number, fall: number): number => over(t, from, rise) * (1 - over(t, from + rise + hold, fall));

const HIND: PawName[] = ["hind left", "hind right"];
const FRONT: PawName[] = ["front left", "front right"];
const ALL: PawName[] = [...HIND, ...FRONT];
/** The cat's side the viewer sees (the bones with an `R_`), and the one it does not. */
const NEAR = { front: "front right", hind: "hind right" } as const satisfies Record<string, PawName>;

export interface Made {
  body: Body;
  mesh: CatMesh;
  skeleton: Skeleton;
  /** The clips already made (a donor's, or an act's), by name: what an act lays itself on. */
  clips: Map<string, Clip>;
}

export function context(mesh: CatMesh, skeleton: Skeleton, clips: Map<string, Clip> = new Map()): Made {
  return { body: new Body(mesh, skeleton), mesh, skeleton, clips };
}

/** The pose a clip that is just made has at its last frame. */
export function lastOf(m: Made, source: ClipSource): Pose {
  const pose = new Pose(m.skeleton);
  poseAt(m.skeleton, source, source.frames - 1, pose);
  return pose;
}

/** The cat standing at rest, as a spec (the angles are measured on the mesh's own skeleton). */
export function standing(m: Made): Spec {
  const b = m.body;
  const pose = b.pose();
  const angle = (a: string, c: string): number => {
    const A = b.where(pose, a);
    const C = b.where(pose, c);
    return Math.atan2(C[1] - A[1], C[0] - A[0]);
  };
  const hips = b.where(pose, "Hips");
  return {
    hips: { x: hips[0], y: hips[1], pitch: 0 },
    back: [angle("spine1", "spine2"), angle("spine2", "chest")],
    neck: [angle("chest", "neck1"), angle("neck1", "neck2"), angle("neck2", "head"), angle("head", "headend")],
    tail: [angle("tail", "tailstart"), angle("tailstart", "tail1"), angle("tail1", "tail2"), angle("tail2", "tail3")],
    paws: Object.fromEntries(ALL.map((p) => [p, b.planted(p)])) as Spec["paws"],
  };
}

/** A pose as the numbers a posture is told in: the hips' place and tilt, the bends of the back, the neck and the tail, and where each paw's sole is (what a donor's posture comes to when it is to be gone to, or from). */
export function specOf(m: Made, pose: Pose): Spec {
  const b = m.body;
  const a = b.anglesOf(pose);
  const hips = b.where(pose, "Hips");
  return {
    hips: { x: hips[0], y: hips[1], pitch: b.pitchOf(pose) },
    back: a.back,
    neck: a.neck,
    tail: a.tail,
    paws: Object.fromEntries(ALL.map((p) => [p, { at: b.padOf(pose, p) }])) as Spec["paws"],
  };
}

/** `spec` with the hips where the settling puts them (so that a transition can go to the place without the settling being asked at every step). */
export function settled(m: Made, spec: Spec): Spec {
  const pose = m.body.make(spec);
  const y = m.body.where(pose, "Hips")[1];
  const { settle: _settle, ...rest } = spec;
  void _settle;
  return { ...rest, hips: { ...spec.hips, y } };
}

/** The timing of the parts of a body that pass from one posture to another: each is when the part starts (s), and how long it takes. */
export interface Timing {
  hips: [number, number];
  back: [number, number];
  neck: [number, number];
  tail: [number, number];
  hind: [number, number];
  front: [number, number];
}

/** The posture at time `t` of a body that goes from `a` to `b`, each of its parts on its own time. A paw that has to move lifts a little on the way (a paw does not slide over the floor). */
export function between(a: Spec, b: Spec, t: number, when: Timing, lift = 0.035): Spec {
  const k = (w: [number, number]): number => over(t, w[0], w[1]);
  const zeros = (o: Readonly<Record<string, number>> | undefined, like: Readonly<Record<string, number>> | undefined): Record<string, number> => Object.fromEntries(Object.keys(like ?? {}).map((n) => [n, o?.[n] ?? 0]));
  const out: Spec = {
    ...(a.hips && b.hips ? { hips: mixSpec(a.hips, b.hips, k(when.hips)) } : {}),
    ...(a.back && b.back ? { back: mixSpec(a.back, b.back, k(when.back)) } : {}),
    ...(a.neck && b.neck ? { neck: mixSpec(a.neck, b.neck, k(when.neck)) } : {}),
    ...(a.tail && b.tail ? { tail: mixSpec(a.tail, b.tail, k(when.tail)) } : {}),
    ...(b.tailFloor !== undefined ? { tailFloor: b.tailFloor } : {}),
  };
  if (a.yaw || b.yaw) out.yaw = mixSpec({ ...zeros(a.yaw, b.yaw), ...(a.yaw ?? {}) }, { ...zeros(b.yaw, a.yaw), ...(b.yaw ?? {}) }, k(when.back));
  if (a.roll || b.roll) out.roll = mixSpec({ ...zeros(a.roll, b.roll), ...(a.roll ?? {}) }, { ...zeros(b.roll, a.roll), ...(b.roll ?? {}) }, k(when.back));
  const paws: NonNullable<Spec["paws"]> = {};
  for (const p of ALL) {
    const pa = a.paws?.[p];
    const pb = b.paws?.[p];
    if (!pa || !pb) continue;
    // (the paws of a pair step one after the other, the left first, each in a share of the time that the pair has: a paw that moves is lifted, and the cat is not carried on the other two alone)
    const w = HIND.includes(p) ? when.hind : when.front;
    const kk = k([w[0] + (p.endsWith("right") ? 0.4 * w[1] : 0), 0.6 * w[1]]);
    const moved = Math.hypot(pb.at[0] - pa.at[0], pb.at[2] - pa.at[2]) > 0.02;
    const at = mixSpec(pa.at, pb.at, kk);
    if (moved) at[1] += lift * Math.sin(Math.PI * kk);
    paws[p] = { ...mixSpec(pa, pb, kk), at };
  }
  out.paws = paws;
  return out;
}

/** The tangents of a smooth curve through the points (x, y) that never runs past one of them (Fritsch and Butland): flat where a point is a peak or a dip, and at rest at the first and the last. */
function tangents(x: readonly number[], y: readonly number[]): number[] {
  const slope = y.slice(1).map((v, i) => (v - y[i]!) / (x[i + 1]! - x[i]!));
  return y.map((_, i) => {
    if (i === 0 || i === y.length - 1) return 0;
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) return 0;
    const w0 = 2 * (x[i + 1]! - x[i]!) + (x[i]! - x[i - 1]!);
    const w1 = (x[i + 1]! - x[i]!) + 2 * (x[i]! - x[i - 1]!);
    return (w0 + w1) / (w0 / a + w1 / b);
  });
}

/** The value at `t` of the curve through the points (x, y), as above. */
function curve(x: readonly number[], y: readonly number[], t: number): number {
  const last = x.length - 1;
  if (t <= x[0]!) return y[0]!;
  if (t >= x[last]!) return y[last]!;
  let i = 0;
  while (x[i + 1]! < t) i++;
  const h = x[i + 1]! - x[i]!;
  const k = (t - x[i]!) / h;
  const m = tangents(x, y);
  const k2 = k * k;
  const k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * y[i]! + (k3 - 2 * k2 + k) * h * m[i]! + (3 * k2 - 2 * k3) * y[i + 1]! + (k3 - k2) * h * m[i + 1]!;
}

/** `curve` through the numbers that a spec's keys hold, whatever shape they are in (numbers, lists of them, records of them); a field that only some keys have is the nearest key's. */
function flow(x: readonly number[], values: readonly unknown[], t: number): unknown {
  const first = values.find((v) => v !== undefined);
  if (typeof first === "number") return curve(x, values as number[], t);
  if (Array.isArray(first)) return first.map((_, j) => flow(x, values.map((v) => (v as unknown[])[j]), t));
  if (first && typeof first === "object") {
    const out: Record<string, unknown> = {};
    for (const key of new Set(values.flatMap((v) => (v && typeof v === "object" ? Object.keys(v) : [])))) {
      const have = values.map((v) => (v as Record<string, unknown> | undefined)?.[key]);
      if (have.every((h) => h !== undefined)) {
        out[key] = flow(x, have, t);
        continue;
      }
      let near = -1;
      have.forEach((h, i) => {
        if (h !== undefined && (near < 0 || Math.abs(x[i]! - t) < Math.abs(x[near]! - t))) near = i;
      });
      out[key] = have[near];
    }
    return out;
  }
  return first;
}

/**
 * The posture at time `t` of a body that goes through the keys (a spec at each time), smoothly: a curve through each number, which does not stop at a key unless the motion turns
 * there (`between` eases each stretch to a stop at both ends, which is right for a cat that settles and wrong for one that is thrown through the air).
 */
export function through(keys: ReadonlyArray<readonly [number, Spec]>, t: number): Spec {
  return flow(keys.map((k) => k[0]), keys.map((k) => k[1]), t) as Spec;
}

/** The frames of a clip: the spec at each time (laid on `base`, if there is one), solved, and recorded. */
export function render(m: Made, name: string, seconds: number, loop: boolean, at: (t: number, u: number) => Spec, o: { marks?: Record<string, number>; base?: Pose; grounded?: boolean; from?: Pose } = {}): ClipSource {
  const frames = Math.max(2, Math.round(seconds * FPS) + (loop ? 0 : 1));
  const fps = loop ? frames / seconds : (frames - 1) / seconds;
  const rec = new Recorder(m.skeleton, frames);
  // (`from`: the pose the clip comes after, where the legs start their search: a crouch is found from the crouch it comes out of, not from the cat standing)
  let prev: Pose | undefined = o.from;
  // (a loop is gone round once beforehand, so that its first frame is found from its last and the legs do not start from another bend of the knee than they end in)
  if (loop) for (let f = 0; f < frames; f++) prev = m.body.make(at(f / fps, f / frames), prev, o.base, o.grounded);
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const pose = m.body.make(at(t, f / (loop ? frames : frames - 1)), prev, o.base, o.grounded);
    rec.put(f, pose);
    prev = pose;
  }
  return rec.source(name, fps, loop, o.marks ?? {});
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// lying down

// (a cat lies down front first: the forelegs fold and the chest goes down with the rump still up, and then the rump goes down onto the hind legs as they fold in, the tail last)
const LIE_DOWN: Timing = { hips: [0.35, 0.65], back: [0, 0.8], neck: [0.15, 0.7], tail: [0.55, 0.45], hind: [0.3, 0.55], front: [0, 0.6] };

/** Where the paws lie in a posture of lying: the front ones forward under the chest, the hind ones tucked by the haunch (a share of the rest's distance from the middle, across). */
function lying(m: Made, front: number, hind: number, frontAcross = 1.1, hindAcross = 1.5): NonNullable<Spec["paws"]> {
  const at = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  return {
    "front left": { at: [front, at("front left")[1], at("front left")[2] * frontAcross], soft: SOFT },
    "front right": { at: [front, at("front right")[1], at("front right")[2] * frontAcross], soft: SOFT },
    "hind left": { at: [hind, at("hind left")[1], at("hind left")[2] * hindAcross], soft: SOFT },
    "hind right": { at: [hind, at("hind right")[1], at("hind right")[2] * hindAcross], soft: SOFT },
  };
}

/** A paw that lies on the floor is only about where it is told along it: the joints do not close past where the skin holds, and the paw lies where the leg can put it. */
const SOFT: [number, number, number] = [0.2, 1, 0.6];

/** The loaf: the belly on the floor, the front paws forward under the chest, the hind paws tucked by the haunch, the head up, the tail along the floor. */
export function loafSpec(m: Made): Spec {
  return settled(m, {
    hips: { y: 0.3, pitch: 0 },
    back: [deg(-2), deg(-2)],
    neck: [deg(38), deg(40), deg(34), deg(-8)],
    tail: [deg(200), deg(190), deg(185), deg(180)],
    yaw: { tailstart: 0.35, tail1: 0.45, tail2: 0.35 },
    tailFloor: 0.07,
    settle: 0,
    paws: lying(m, 0.2, -0.3),
  });
}

/** The doze: the loaf with the head let down on the paws and a little to one side, the back rounder, the tail wrapped. */
export function dozeSpec(m: Made): Spec {
  return settled(m, {
    hips: { y: 0.3, pitch: 0 },
    back: [deg(2), deg(-8)],
    neck: [deg(20), deg(12), deg(0), deg(-34)],
    tail: [deg(200), deg(190), deg(185), deg(180)],
    yaw: { tailstart: 0.5, tail1: 0.7, tail2: 0.6 },
    roll: { head: 0.18 },
    tailFloor: 0.07,
    settle: 0,
    paws: lying(m, 0.22, -0.3),
  });
}

/** The curl: tighter still, the head down on the chest and turned in, the tail round the front. */
export function curlSpec(m: Made): Spec {
  return settled(m, {
    hips: { y: 0.3, pitch: 0 },
    back: [deg(4), deg(-12)],
    neck: [deg(10), deg(0), deg(-12), deg(-40)],
    tail: [deg(200), deg(190), deg(185), deg(180)],
    yaw: { tailstart: 0.6, tail1: 0.9, tail2: 0.9, neck2: -0.25, head: -0.2 },
    roll: { head: 0.25 },
    tailFloor: 0.07,
    settle: 0,
    paws: lying(m, 0.16, -0.26, 1.0, 1.3),
  });
}

function lieDown(m: Made, name: string, to: Spec, seconds = 1.4): ClipSource {
  const from = standing(m);
  return render(m, name, seconds, false, (t, u) => {
    const spec = between(from, to, t * (1.4 / seconds), LIE_DOWN);
    // (the chest goes down ahead of the rump: the back dips while the front folds, and comes back as the rump goes down)
    const dip = over(u, 0, 0.4) * (1 - over(u, 0.4, 0.4));
    return { ...spec, back: [spec.back![0] - 0.3 * dip, spec.back![1] - 0.5 * dip] };
  });
}

export const loaf = (m: Made): ClipSource => lieDown(m, "loaf", loafSpec(m));
export const doze = (m: Made): ClipSource => lieDown(m, "doze", dozeSpec(m), 1.8);
export const curl = (m: Made): ClipSource => lieDown(m, "curl", curlSpec(m), 2.0);

/** A cat that has been asleep for a while moves: it lifts its head, shuffles, and lies down again a little differently (the engine puts it back in the posture it left). */
export function shift(m: Made): ClipSource {
  const down = curlSpec(m);
  const up: Spec = {
    ...down,
    hips: { ...down.hips!, y: down.hips!.y + 0.025 },
    back: [deg(8), deg(-4)],
    neck: [deg(40), deg(36), deg(22), deg(-14)],
    yaw: { ...down.yaw, neck2: 0.2, head: 0.25 },
    roll: { head: 0 },
  };
  const again: Spec = { ...down, yaw: { ...down.yaw, neck2: -0.1, head: -0.35 }, roll: { head: -0.25 }, neck: [deg(12), deg(2), deg(-8), deg(-38)] };
  const HEAD_FIRST: Timing = { hips: [0, 0.8], back: [0, 0.8], neck: [0, 0.7], tail: [0.2, 0.8], hind: [0, 1], front: [0, 1] };
  return render(m, "shift", 2.8, false, (t, u) => {
    // up over the first third, a pause, then down into the new place
    if (u < 0.5) return between(down, up, t, HEAD_FIRST);
    return between(up, again, t - 1.4, { ...HEAD_FIRST, hips: [0.2, 0.9], back: [0.2, 0.9], neck: [0.1, 1] });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// crouching, and what is done from a crouch

/** The crouch of a cat that has seen something: the chest low, the hips lower than a stand and the hind paws brought under, the head level, the tail low and waiting. */
export function crouchSpec(m: Made): Spec {
  const at = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  return settled(m, {
    hips: { y: 0.32, pitch: -0.05 },
    back: [deg(-14), deg(-22)],
    neck: [deg(22), deg(18), deg(8), deg(-12)],
    tail: [deg(185), deg(188), deg(192), deg(195)],
    tailFloor: 0.09,
    settle: 0.05,
    // (the legs fold up under the body, further than a cat on its feet turns them: under the limits of one the cat stays on its feet and is not a crouch)
    range: "wide",
    paws: {
      "front left": { at: [0.27, at("front left")[1], at("front left")[2]], soft: SOFT },
      "front right": { at: [0.27, at("front right")[1], at("front right")[2]], soft: SOFT },
      "hind left": { at: [-0.42, at("hind left")[1], at("hind left")[2] * 1.1], soft: SOFT },
      "hind right": { at: [-0.42, at("hind right")[1], at("hind right")[2] * 1.1], soft: SOFT },
    },
  });
}

const CROUCH_IN: Timing = { hips: [0, 0.7], back: [0, 0.7], neck: [0.1, 0.6], tail: [0.1, 0.7], hind: [0, 0.7], front: [0.05, 0.7] };

export function crouch(m: Made): ClipSource {
  const from = standing(m);
  const to = crouchSpec(m);
  return render(m, "crouch", 0.9, false, (t) => ({ ...between(from, to, t, CROUCH_IN), range: "wide" }));
}

/** The haunches of a cat that is about to pounce, wagged: the hips turn about the vertical, the paws stay where they are, the tail's end answers. Four to the second. */
export function wiggle(m: Made): ClipSource {
  const low = crouchSpec(m);
  // (it comes out of the crouch: the legs are found from where that leaves them)
  const from = lastOf(m, crouch(m));
  return render(
    m,
    "wiggle",
    1.0,
    true,
    (t) => {
      const s = Math.sin(TAU * 4 * t);
      return { ...low, hips: { ...low.hips!, yaw: 0.2 * s }, yaw: { spine1: -0.1 * s, spine2: -0.08 * s, tailstart: 0.2 * s, tail1: 0.3 * s, tail2: 0.3 * s } };
    },
    { from },
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the stretch

/** The bow: the front down on the floor with the paws out ahead, the hips high, the back dipped, the tail up. */
export function bowSpec(m: Made): Spec {
  const at = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  return {
    hips: { y: 0.54, pitch: -0.1 },
    back: [deg(-17), deg(-27)],
    neck: [deg(-6), deg(-10), deg(-14), deg(-30)],
    tail: [deg(100), deg(90), deg(82), deg(76)],
    paws: {
      "front left": { at: [0.52, at("front left")[1], at("front left")[2]] },
      "front right": { at: [0.52, at("front right")[1], at("front right")[2]] },
      "hind left": { at: [at("hind left")[0] - 0.02, at("hind left")[1], at("hind left")[2]] },
      "hind right": { at: [at("hind right")[0] - 0.02, at("hind right")[1], at("hind right")[2]] },
    },
  };
}

export function stretch(m: Made): ClipSource {
  const from = standing(m);
  const to = bowSpec(m);
  const WIN: Timing = { hips: [0, 0.85], back: [0.05, 0.85], neck: [0.15, 0.85], tail: [0.1, 0.8], hind: [0, 0.8], front: [0, 0.75] };
  return render(m, "stretch", 2.5, false, (t, u) => {
    // down over the first quarter, held, and up over the last half (a cat gets up out of a stretch more slowly than it went down: the engine's shot is two and a half seconds, and a rise in
    // the last quarter of it is a body snapping up)
    // (`between` eases each part of the body within its own window, so the way down and the way up are told straight: eased as well they would be an S of an S, and the body drops in a picture)
    const k = clamp01(u / 0.4) * (1 - clamp01((u - 0.5) / 0.5));
    const out = between(from, to, k, WIN);
    // (the hold is not a freeze: the cat pushes on into the stretch, the breath goes through it and the tail answers)
    const hold = over(u, 0.32, 0.08) * (1 - over(u, 0.5, 0.08));
    const push = Math.sin(TAU * 0.7 * t) * hold;
    const shift = (a: readonly number[], f: (i: number) => number): number[] => a.map((v, i) => v + f(i));
    // (the front legs go out along the floor ahead of the head and the shoulders sink between them: the arms turn further than a cat on its feet turns them)
    return {
      ...out,
      range: "wide",
      hips: { ...out.hips!, y: out.hips!.y + 0.012 * push },
      back: shift(out.back!, (i) => (i === 0 ? 0.03 : -0.04) * push) as unknown as NonNullable<Spec["back"]>,
      neck: shift(out.neck!, (i) => (i === 0 ? 0.05 : 0.025) * push) as unknown as NonNullable<Spec["neck"]>,
      tail: shift(out.tail!, (i) => 0.07 * Math.sin(TAU * 1.1 * t - 0.5 * i) * hold) as unknown as NonNullable<Spec["tail"]>,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the stalk

/** `v` brought `k` of the way back to `mean` from where it is (1: as it is, 0: all the way to the mean). */
const toward = (v: number, mean: number, k: number): number => mean + k * (v - mean);

/**
 * The stalk: the walk with the body brought down, the head forward and low, the tail trailing, each paw where the walk puts it (so the stride, the footfalls and the pace are the walk's)
 * and the legs found again for the hips that are lower. A donor's own sneak is a fox crawling on its belly, and its folds in the legs are not ones this cat's short legs and coat can
 * make: they come out a lump.
 */
export function stalk(m: Made): ClipSource {
  const walk = m.clips.get("walk");
  if (!walk) throw new Error("no walk to lay the stalk on");
  const pose = new Pose(m.skeleton);
  const specs: Spec[] = [];
  for (let f = 0; f < walk.frames; f++) {
    sampleFrame(walk, f, pose);
    specs.push(specOf(m, pose));
  }
  const mean = (pick: (s: Spec) => number): number => specs.reduce((sum, s) => sum + pick(s), 0) / specs.length;
  const hipsY = mean((s) => s.hips!.y);
  const back = [mean((s) => s.back![0]), mean((s) => s.back![1])];
  const neck = [0, 1, 2, 3].map((i) => mean((s) => s.neck![i]!));
  // (how low the body goes, and where the head and the tail are held; what the walk does around them is kept in part: the sway of the body, a nod of the head. The body is hardly
  // lowered: this cat's legs are short and its coat comes down over them, so that a crouch of a hand's breadth turns them into a lump; a low head and tail make the stalk)
  const DROP = 0.01;
  const SHOULDERS = 0;
  const HEAD: [number, number, number, number] = [deg(12), deg(8), deg(0), deg(-22)];
  const TAIL: [number, number, number, number] = [deg(190), deg(186), deg(182), deg(178)];
  const low = specs.map(
    (s): Spec => ({
      hips: { ...s.hips!, y: toward(s.hips!.y, hipsY, 0.5) - DROP },
      back: [toward(s.back![0], back[0]!, 0.5) - deg(SHOULDERS), toward(s.back![1], back[1]!, 0.5) - deg(SHOULDERS * 1.3)],
      neck: s.neck!.map((a, i) => HEAD[i]! + 0.3 * (a - neck[i]!)) as unknown as [number, number, number, number],
      tail: TAIL,
      tailFloor: 0.06,
      paws: s.paws!,
    }),
  );
  const seconds = walk.frames / walk.fps;
  const clip = render(m, "stalk", seconds, true, (_t, u) => {
    const at = u * walk.frames;
    const i = Math.floor(at) % walk.frames;
    return mixSpec(low[i]!, low[(i + 1) % walk.frames]!, at - Math.floor(at));
  });
  return { ...clip, stride: walk.stride, marks: { ...walk.marks } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the leap

/** When the leap's paws leave the floor and when one is on it again (s): the marks the director plays it by (the engine's take-off and landing). */
export const LEAP = { takeoff: 0.38, land: 0.78 } as const;

/**
 * The leap, as a body does it: the coil, the push (the hips up and forward over the hind paws as the legs straighten), the stretch in the air with the front paws out ahead and the hind
 * ones trailing, the reach for the floor, the landing that gives at the knees, and the stand. The body stays level: the engine carries the cat along its arc, and the renderer tips the
 * whole cat to the way it is going, so a clip that tipped as well would turn the cat twice as far (a donor's jump does: it pounces, and comes down on its nose).
 */
export function jump(m: Made): ClipSource {
  const stand = standing(m);
  const rest = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  const FREE: [number, number, number] = [1, 1, 1];
  /** The four paws, each as how far forward the sole is and how high; the sides across are the rest's. */
  const feet = (fl: [number, number], fr: [number, number], hl: [number, number], hr: [number, number], soft: [number, number, number] = FREE): NonNullable<Spec["paws"]> => ({
    "front left": { at: [fl[0], fl[1], rest("front left")[2]], soft },
    "front right": { at: [fr[0], fr[1], rest("front right")[2]], soft },
    "hind left": { at: [hl[0], hl[1], rest("hind left")[2]], soft },
    "hind right": { at: [hr[0], hr[1], rest("hind right")[2]], soft },
  });
  const floor = rest("front left")[1];
  const key = (at: number, spec: Omit<Spec, "tailFloor">): [number, Spec] => [at, { tailFloor: 0.05, ...spec }];
  const on = (fl: number, fr: number, hl: number, hr: number): NonNullable<Spec["paws"]> => feet([fl, floor], [fr, floor], [hl, floor], [hr, floor], SOFT);
  /** The hips, with the turn about the vertical always told (a key that leaves it out would be given the nearest key's). */
  const hips = (x: number, y: number, pitch: number, yaw = 0): NonNullable<Spec["hips"]> => ({ x, y, pitch, yaw });
  const keys: Array<[number, Spec]> = [
    key(0, { hips: { ...stand.hips!, yaw: 0 }, back: stand.back!, neck: stand.neck!, tail: stand.tail!, paws: on(rest("front left")[0], rest("front right")[0], rest("hind left")[0], rest("hind right")[0]) }),
    // the gather: the weight goes back over the haunches, the head comes up to the place it is going to (the eyes first, as a cat's are)
    key(0.1, { hips: hips(stand.hips!.x ?? -0.34, stand.hips!.y - 0.04, -0.02, 0.04), back: [stand.back![0]! - deg(4), stand.back![1]! - deg(6)], neck: [stand.neck![0]! + deg(6), stand.neck![1]! + deg(6), stand.neck![2]!, stand.neck![3]!], tail: stand.tail!, paws: on(rest("front left")[0], rest("front right")[0], rest("hind left")[0], rest("hind right")[0]) }),
    // the first dip and the wiggle of the haunches: a cat measures the jump before it makes it
    key(0.16, { hips: hips(-0.38, 0.4, -0.03, 0.09), back: [deg(-10), deg(-14)], neck: [deg(40), deg(40), deg(32), deg(-18)], tail: [deg(184), deg(188), deg(192), deg(198)], paws: on(0.19, 0.16, -0.44, -0.45) }),
    key(0.22, { hips: hips(-0.39, 0.39, -0.035, -0.09), back: [deg(-12), deg(-17)], neck: [deg(38), deg(40), deg(32), deg(-17)], tail: [deg(188), deg(192), deg(196), deg(202)], paws: on(0.2, 0.17, -0.45, -0.46) }),
    // the coil: the haunches down, the hind paws brought up under them, the chest forward and low, the head up on the place
    key(0.3, { hips: hips(-0.4, 0.37, -0.04), back: [deg(-14), deg(-20)], neck: [deg(36), deg(38), deg(30), deg(-16)], tail: [deg(182), deg(186), deg(190), deg(194)], paws: on(0.2, 0.17, -0.45, -0.46) }),
    // the push: the legs straight, the hips over and ahead of the hind paws, the chest up, the paws just off the floor (the tail is left behind: it trails the body, and comes after)
    key(LEAP.takeoff, { hips: hips(-0.34, 0.52, 0), back: [deg(2), deg(8)], neck: [deg(50), deg(46), deg(34), deg(-22)], tail: [deg(184), deg(180), deg(174), deg(168)], paws: feet([0.3, 0.12], [0.22, 0.16], [-0.58, 0.07], [-0.6, 0.09]) }),
    // in the air: the body level and long, the front paws reaching ahead, the hind ones trailing, the tail streaming back and up
    key(0.58, { hips: hips(-0.38, 0.5, 0), back: [deg(-4), deg(-2)], neck: [deg(34), deg(30), deg(22), deg(-22)], tail: [deg(176), deg(168), deg(160), deg(152)], paws: feet([0.42, 0.24], [0.33, 0.28], [-0.66, 0.2], [-0.62, 0.24]) }),
    // the reach: the front paws on the floor, the hind ones coming under
    key(LEAP.land, { hips: hips(-0.37, 0.44, 0), back: [deg(-12), deg(-14)], neck: [deg(40), deg(40), deg(34), deg(-20)], tail: [deg(172), deg(160), deg(148), deg(138)], paws: feet([0.24, floor], [0.19, floor], [-0.5, 0.12], [-0.47, 0.16]) }),
    // the landing gives (the tail swings on over the body, the way it was going)
    key(0.86, { hips: hips(-0.4, 0.355, -0.04), back: [deg(-16), deg(-22)], neck: [deg(38), deg(38), deg(30), deg(-18)], tail: [deg(176), deg(164), deg(150), deg(134)], paws: on(0.2, 0.16, -0.48, -0.48) }),
    // and comes up out of it, a little past the stand, as the legs push back
    key(0.94, { hips: hips(stand.hips!.x ?? -0.34, stand.hips!.y + 0.012, 0.01), back: [stand.back![0]! + deg(2), stand.back![1]! + deg(2)], neck: stand.neck!, tail: [stand.tail![0]! - deg(4), stand.tail![1]! - deg(8), stand.tail![2]! - deg(10), stand.tail![3]! - deg(10)], paws: on(0.18, 0.14, -0.5, -0.5) }),
    // and the cat stands where it landed
    key(1, { hips: { ...stand.hips!, yaw: 0 }, back: stand.back!, neck: stand.neck!, tail: stand.tail!, paws: on(0.18, 0.14, -0.5, -0.5) }),
  ];
  return render(m, "jump", 1, false, (t) => through(keys, t), { marks: { takeoff: LEAP.takeoff, land: LEAP.land } });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the climb

/**
 * Hauling itself up over the lip of a ledge by the forepaws. The engine holds the frame still at the point the cat ends up standing at, on the top of the ledge, and leaves all the travel
 * to the picture: so this clip is in the ledge's own space (the origin is where the cat stands at the end, the top of the ledge is the floor from the lip, `CLIMB_LIP` behind that point,
 * forward; the face of the ledge is the wall below the lip), and it starts with the cat hanging below the lip by its forepaws, the body upright, the hind legs and the tail hanging, and goes
 * through the engine's beats (`CLIMB_GRAB`: the paws take hold; `CLIMB_PULL`: the chest is over the lip and the paws on top; `CLIMB_OVER`: the hind legs are over) to the stand. A cat's body does not
 * clear a corner by being lifted: the forepaws take hold of the lip and the body is hauled up under them, the chest comes over, the forepaws step forward on the ledge, the hind legs scrabble
 * at the wall and then come over.
 *
 * A cat's legs are short (a third of a body length from the shoulder to the sole), so the places of the paws are told as footholds that the body passes: a paw that was put where the chest
 * ends up has its leg folded flat against the shoulder, and a solver that is asked for it turns the whole limb the other way round in a frame (the pop in the clip). The paws are told
 * against the body's own path instead: the forepaws are planted on the lip (A) until the shoulders are under them, stepped on to B ahead of the chest, and last to the stand; the hind
 * paws are told against the hips (hanging, and kicking at the wall in time), and go up over the lip when the hips are over it.
 */
export function climb(m: Made): ClipSource {
  const stand = standing(m);
  const rest = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  const LIP = -CLIMB_LIP;
  const FREE: [number, number, number] = [1, 1, 1];
  const lip = 0.015;
  // (the floor is the top of the ledge, from its lip on: below the lip there is a wall, and a leg that hangs there is not through any floor; the arms and the thighs are kept from winding up
  // past a bit over a third of a turn: hanging by the arms and going over a corner wind a limb as far as the skin can go)
  const key = (u: number, spec: Omit<Spec, "tailFloor" | "solid" | "cap" | "paws">): [number, Spec] => [u, { solid: { floor: 0, wall: LIP }, cap: { front: 130, hind: 130 }, ...spec }];
  const keys: Array<[number, Spec]> = [
    // reaching: stretched up the wall, the paws open over the lip, the hind legs and the tail hanging
    key(0, { hips: { x: LIP - 0.2, y: -0.72, pitch: 1.2 }, back: [deg(84), deg(82)], neck: [deg(88), deg(92), deg(84), deg(52)], tail: [deg(250), deg(262), deg(268), deg(272)] }),
    // the paws take hold of the lip and the weight comes on them
    key(CLIMB_GRAB, { hips: { x: LIP - 0.22, y: -0.77, pitch: 1.2 }, back: [deg(84), deg(82)], neck: [deg(88), deg(94), deg(86), deg(56)], tail: [deg(252), deg(264), deg(270), deg(274)] }),
    // hauling: the elbows fold, the chest rises
    key(0.38, { hips: { x: LIP - 0.2, y: -0.56, pitch: 1.1 }, back: [deg(76), deg(72)], neck: [deg(78), deg(84), deg(76), deg(44)], tail: [deg(246), deg(258), deg(264), deg(268)] }),
    // the chest is over the lip, the belly is at the corner
    key(CLIMB_PULL, { hips: { x: LIP - 0.14, y: -0.27, pitch: 0.9 }, back: [deg(52), deg(46)], neck: [deg(50), deg(58), deg(52), deg(22)], tail: [deg(236), deg(248), deg(258), deg(262)] }),
    // the hind legs come over: the weight goes forward over the paws
    key(CLIMB_OVER, { hips: { x: LIP + 0.1, y: 0.2, pitch: 0.3 }, back: [deg(14), deg(8)], neck: [deg(40), deg(44), deg(40), deg(-6)], tail: [deg(214), deg(222), deg(232), deg(240)] }),
    // and the cat stands where it climbed to
    key(1, { hips: stand.hips!, back: stand.back!, neck: stand.neck!, tail: stand.tail! }),
  ];
  /** How long a forepaw takes to step on, as a share of the clip. */
  const STEP = 0.14;
  /** The lip's side of the forepaws' foothold, (the near paw's, the far one's) and the one ahead of the chest, and when each steps on (the far paw a little after the near). */
  const FORE = {
    [NEAR.front]: { A: LIP + 0.04, B: LIP + 0.64, on: 0.48, out: 0.8 },
    "front left": { A: LIP + 0.08, B: LIP + 0.68, on: 0.52, out: 0.84 },
  } as const satisfies Partial<Record<PawName, { A: number; B: number; on: number; out: number }>>;
  const fore = (p: PawName, u: number, across: number): NonNullable<Spec["paws"]>[PawName] => {
    const f = FORE[p as keyof typeof FORE];
    const x = f.A + (f.B - f.A) * over(u, f.on, STEP) + (rest(p)[0] - f.B) * over(u, f.out, STEP);
    // (reaching over the lip until the weight is on the paws, and a paw that steps on goes up and over)
    const y = lip + (0.09 - lip) * (1 - over(u, 0, CLIMB_GRAB)) + 0.12 * (Math.sin(Math.PI * clamp01((u - f.on) / STEP)) + Math.sin(Math.PI * clamp01((u - f.out) / STEP)));
    return { at: [x, y, rest(p)[2] * across], soft: FREE, hold: 0.02 };
  };
  /** The hind paws: told against the hips (hanging under them, kicking at the wall in turn while the weight is on the arms), and up over the lip to where the cat stands once the hips are over it. */
  const hind = (p: PawName, u: number, hips: { x: number; y: number }, across: number): NonNullable<Spec["paws"]>[PawName] => {
    const near = p === NEAR.hind;
    const phase = TAU * (u * (CLIMB_TIME / 0.5)) + (near ? 0 : Math.PI);
    const work = over(u, 0.1, 0.12) * (1 - over(u, 0.7, 0.15));
    const x = Math.min(hips.x + 0.07 * work * Math.cos(phase), LIP - 0.04);
    const y = hips.y - 0.3 + 0.08 * work * Math.sin(phase);
    const land = over(u, near ? 0.86 : 0.9, 0.12);
    const to = rest(p);
    return { at: [x + (to[0] - x) * land, y + (0.02 - y) * land + 0.08 * Math.sin(Math.PI * land), to[2] * across], soft: FREE, hold: 0.02 };
  };
  const spec = (_t: number, u: number): Spec => {
    const key = through(keys, u);
    // (a cat that hangs by its arms is not still: the body swings a little on them, each kick of the hind legs at the wall lifts it, and the tail answers; it dies away as the haul begins)
    const hang = 1 - over(u, CLIMB_GRAB + 0.12, 0.15);
    const swing = Math.sin(TAU * 2.5 * u);
    const kick = Math.sin(TAU * (u * (CLIMB_TIME / 0.5)));
    const hipsKey = key.hips!;
    const body: Spec = {
      ...key,
      hips: { ...hipsKey, x: (hipsKey.x ?? 0) + 0.014 * swing * hang, y: hipsKey.y + 0.012 * kick * hang * over(u, 0.1, 0.12) },
      tail: key.tail!.map((a, i) => a + deg(7) * Math.sin(TAU * (2.5 * u - 0.12 * (i + 1))) * hang) as unknown as NonNullable<Spec["tail"]>,
    };
    const hips = { x: body.hips!.x ?? 0, y: body.hips!.y };
    const across = 0.8 + 0.2 * over(u, 0.5, 0.4);
    return { ...body, paws: { "front right": fore("front right", u, across), "front left": fore("front left", u, across), "hind right": hind("hind right", u, hips, across), "hind left": hind("hind left", u, hips, across) } };
  };
  const marks = { grab: CLIMB_GRAB * CLIMB_TIME, pull: CLIMB_PULL * CLIMB_TIME, over: CLIMB_OVER * CLIMB_TIME };
  return render(m, "climb", CLIMB_TIME, false, spec, { marks, grounded: false });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// up the face of a card, seen from behind

/** One round of the climb (seconds): a bound, the hind legs push and the forepaws reach above the head together, the forepaws pull and the hind legs come up under the body together. */
const SCALE_TIME = 1.0;
/** How far the card goes by in a round (body lengths): what the climb gains in a bound. */
const SCALE_BOUND = 0.5;
/** For each pair of paws: where in the round it is lifted and the share of the round that it is off the card (the fore pair is placed at the end of the reach, the hind pair while the fore pair holds and pulls, so that at least two paws hold at every moment). */
const SCALE_PAIRS = { front: { lift: 0, swing: 0.22 }, hind: { lift: 0.5, swing: 0.25 } } as const;

/**
 * Climbing straight up the face of a card (a wall, anything the page has that is higher than a step), seen from behind: the viewer has the cat's back, the tail hanging, the hind legs
 * out at the sides and pushing, the forepaws reaching above the head and pulling. The engine holds the cat's frame and moves it up at the speed of the climb, and the clip is the
 * gait that goes with it (the paws that are on the card go down against the body at that speed, so that none slides over the card).
 *
 * It is told in the cat's own side view, the cat upright with its belly to the card (`solid.wall`), and turned a quarter about the vertical at the end (`hips.spin`): the card is the wall
 * and the paws are reached to it as for any other wall; the viewer's side of the cat is its back.
 */
export function scale(m: Made): ClipSource {
  const FREE: [number, number, number] = [1, 1, 1];
  /** How far in front of the hips the card's face is (body lengths: the belly is against it, and the paws' soles). */
  const FACE = 0.26;
  /** How far the soles are kept off it, and how far a paw swings out from it when it is lifted. */
  const GRIP = 0.012;
  const OUT = 0.09;
  /** The heights (over the hips) at which a stance starts, for the forepaws (high over the head) and the hind (the knee up by the haunch), and how far out across they are. */
  const TOP = { front: 0.88, hind: -0.02 } as const;
  const ACROSS = { front: 0.31, hind: 0.28 } as const;
  /** How far the paws are tipped (toes up): the soles flat to the card. */
  const TIP = deg(80);
  /**
   * How far the chest and the neck lean in to the card, and where the hips are and how they are tilted to go with it. (A cat that is upright reaches its forepaws up the card past its head by turning
   * the arm 90 degrees or more at the shoulder, with a twist, and the skin round the shoulder collapses on itself (stretch99 over 5, flat sheets of coat over the head); a chest that leans in is
   * a shoulder that has not as far to turn, and it is what a cat does.)
   */
  const LEAN = 24;
  /** How far the body rises and sinks against the line the card goes by at (it shoots up with the push of the hind legs and lags while the forepaws pull), and the bend of the back that goes with it. */
  const BOB = 0.05;
  const ARCH = deg(4);
  /** How far the shoulders rock from one side to the other in a round, and how far the left paws of a pair are ahead of the right (a bound is not as even as a trot). */
  const SWAY = 1;
  const AHEAD = 0.04;
  // (a paw's height over the round: it goes down at the card's speed while it holds, and, when it is lifted, it is carried up to where it holds again with the speed it has at both ends,
  // the card's: a cubic, so that the paw does not stop in the air or run on the card)
  const carried = (s: number, slope: number): number => -slope * (2 * s * s * s - 3 * s * s + s) + 3 * s * s - 2 * s * s * s;
  const paw = (p: PawName, u: number): NonNullable<Spec["paws"]>[PawName] => {
    const front = p.startsWith("front");
    const side = p.endsWith("right") ? 1 : -1;
    const { lift, swing } = front ? SCALE_PAIRS.front : SCALE_PAIRS.hind;
    const k = (((u - lift - (side > 0 ? AHEAD : 0)) % 1) + 1) % 1;
    const top = front ? TOP.front : TOP.hind;
    // (a stance goes down as far as the card goes by while it lasts)
    const drop = SCALE_BOUND * (1 - swing);
    const lifted = k < swing;
    const s = lifted ? k / swing : (k - swing) / (1 - swing);
    const y = lifted ? top - drop + drop * carried(s, swing / (1 - swing)) : top - drop * s;
    const away = lifted ? Math.sin(Math.PI * s) : 0;
    return { at: [FACE - GRIP - OUT * away, y, side * (front ? ACROSS.front : ACROSS.hind)], soft: FREE, tip: TIP - deg(30) * away };
  };
  const spec = (_t: number, u: number): Spec => {
    const wave = (lag: number): number => Math.sin(TAU * (u - lag));
    // (`rock` is 1 as the body leans to the left, -1 to the right: the weight goes to the side of the paws that are not reaching, the pelvis tips the other way, and the head is held about level and turns to the paw)
    const rock = SWAY * wave(0.1);
    // (`reach` is 1 when the forepaws have just been placed, the body shot up and out long, and -1 when it is gathered up with the hind legs under it)
    const reach = Math.cos(TAU * (u - SCALE_PAIRS.front.swing));
    const bob = BOB * reach;
    const f = -ARCH * reach;
    return {
      solid: { floor: false, wall: FACE },
      // (the legs are splayed against the card: the limits of a cat on its feet turn a thigh inside out there)
      range: "free",
      hips: { x: -0.12, y: bob, z: 0.03 * rock, pitch: 1.3, roll: -deg(7) * rock, spin: Math.PI / 2 },
      back: [deg(90 - LEAN * 0.4) + f, deg(90 - LEAN * 0.9) - f],
      neck: [deg(90 - LEAN), deg(94 - LEAN), deg(90 - LEAN), deg(62 - LEAN)],
      tail: [deg(262), deg(266), deg(270), deg(272)],
      roll: { spine1: deg(8) * rock, spine2: deg(7) * rock, chest: deg(5) * rock, neck1: -deg(4) * rock, neck2: -deg(3) * rock, head: -deg(3) * rock, tail: deg(8) * wave(0.3), tailstart: deg(11) * wave(0.4), tail1: deg(13) * wave(0.5), tail2: deg(13) * wave(0.6), tail3: deg(11) * wave(0.7) },
      yaw: { neck2: deg(10) * rock, head: deg(10) * rock },
      paws: Object.fromEntries(ALL.map((p) => [p, paw(p, u)])) as Spec["paws"],
    };
  };
  const marks: Record<string, number> = {};
  for (const p of ALL) {
    const { lift, swing } = p.startsWith("front") ? SCALE_PAIRS.front : SCALE_PAIRS.hind;
    marks[`lift:${p}`] = lift * SCALE_TIME;
    marks[`land:${p}`] = ((lift + swing) % 1) * SCALE_TIME;
  }
  // (the director plays the clip by the distance climbed, so many body lengths a round)
  return { ...render(m, "scale", SCALE_TIME, true, spec, { marks, grounded: false }), stride: SCALE_BOUND };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// from a sit: a paw to the face, a paw out, a leg at the neck

/** The sit the acts below are laid on (the last of the clip that sits down), and where its neck's pieces point (the head moves by turns of those). */
function sitting(m: Made): { base: Pose; neck: readonly [number, number, number, number] } {
  const base = lastOf(m, sit(m));
  return { base, neck: m.body.anglesOf(base).neck };
}

// (the hind paws come forward under the haunch first, and then the rump goes down onto them: sent down with them, the thigh is folded against the floor before the paw is where it is to be)
const SIT_DOWN: Timing = { hips: [0.25, 0.9], back: [0.25, 0.9], neck: [0.35, 0.8], tail: [0.4, 0.8], hind: [0, 0.55], front: [0.05, 0.5] };

/** How far the sit pitches the torso up (radians): found by trying pitches (scripts in the log of docs/cat-animation): under this the cat is a loaf with its head up, over it the haunch folds in on itself. */
const SIT_PITCH = 0.46;

/**
 * The sit the cat sits down to: the haunch on the floor, the torso pitched up from it, the front legs straight down from the shoulders, the hind paws flat on the floor ahead of the haunch,
 * the tail along the floor. (The sit that a fox does is a squat on this cat: its seat is the fur of its rump, which hangs far below the hips, and its legs are short, and a back steep
 * enough puts the shoulders higher than the front legs reach. The haunch is what a sit is read by, and it holds its shape in this one: the numbers are where the skin is least stretched.)
 */
export function sitSpec(m: Made): Spec {
  const stand = standing(m);
  const torso: Spec = {
    hips: { x: -0.52, y: 0.3, pitch: SIT_PITCH + deg(12) },
    back: [SIT_PITCH - 0.02, SIT_PITCH - 0.1],
    neck: [stand.neck![0] + 0.5 * SIT_PITCH, stand.neck![1] + 0.3 * SIT_PITCH, stand.neck![2], stand.neck![3]],
    tail: [deg(190), deg(185), deg(180), deg(180)],
    tailFloor: 0.05,
    settle: 0,
  };
  // (where the shoulders and the hips come to with the torso on the floor: the front paws go down under the shoulders, the hind ones ahead of the haunch)
  const pose = m.body.make(torso);
  const shoulder = m.body.where(pose, "R_frontleg");
  const hips = m.body.where(pose, "Hips");
  const at = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  const paws: NonNullable<Spec["paws"]> = {};
  for (const p of FRONT) paws[p] = { at: [shoulder[0] + 0.03, at(p)[1], at(p)[2]], tip: 0 };
  for (const p of HIND) paws[p] = { at: [hips[0] + 0.3, at(p)[1], at(p)[2] * 1.15], tip: 0 };
  return settled(m, { ...torso, paws });
}

/** The clips that have been made once for a body (a clip is a few seconds of solving, and the acts from a sit are laid on the last of this one). */
const made = new WeakMap<Made, Map<string, ClipSource>>();
function once(m: Made, name: string, make: () => ClipSource): ClipSource {
  const clips = made.get(m) ?? made.set(m, new Map()).get(m)!;
  return clips.get(name) ?? clips.set(name, make()).get(name)!;
}

/**
 * The cat that sits down: from standing to the sit, the hips and the haunches first (the hind paws come forward under them), the back pitching up as the rump goes down, the neck and the
 * tail after, and then the sit held.
 */
export function sit(m: Made): ClipSource {
  return once(m, "sit", () => {
    const to = sitSpec(m);
    const from = standing(m);
    return render(m, "sit", 1.4, false, (t) => between(from, to, t, SIT_DOWN));
  });
}

export function groom(m: Made): ClipSource {
  const { base, neck } = sitting(m);
  return render(
    m,
    "groom",
    4.2,
    true,
    (t) => {
      // the paw comes up to the mouth, the head goes down to meet it, a few licks, and the paw goes down again
      const e = bump(t, 0.25, 0.6, 2.3, 0.7);
      const lick = e * Math.sin(TAU * 2.2 * t);
      const head: Spec = {
        neck: [neck[0] - 0.2 * e + 0.02 * lick, neck[1] - 0.3 * e + 0.03 * lick, neck[2] - 0.35 * e + 0.05 * lick, neck[3] - 0.15 * e + 0.11 * lick],
        yaw: { neck2: -0.1 * e, head: -0.14 * e },
      };
      const nose = m.body.where(m.body.make(head, undefined, base), "headend");
      const rest = m.body.padOf(base, NEAR.front);
      const goal: [number, number, number] = [nose[0] - 0.03 + 0.02 * lick, nose[1] - 0.05 + 0.018 * lick, nose[2] + 0.05];
      const shoulder = m.body.where(base, "R_frontleg");
      return {
        ...head,
        paws: { [NEAR.front]: { at: mixSpec(rest, goal, e), tip: 0.9 * e, elbow: [shoulder[0] - 0.06, shoulder[1] - 0.12, shoulder[2] + 0.07] } },
      };
    },
    { base },
  );
}

/** A paw held out ahead, to point at something: the arm out, the head up to look along it. Held, with a slight sway, for as long as the clip lasts (six seconds, then it stays). */
export function point(m: Made): ClipSource {
  const { base, neck } = sitting(m);
  return render(
    m,
    "point",
    6,
    false,
    (t) => {
      const e = over(t, 0, 0.5);
      const sway = Math.sin(TAU * 0.5 * t) * e;
      // (a point is not a freeze: every second or so the paw is put out again, a little further, and drawn back, while the head follows what it points at)
      const pulse = Math.pow(Math.max(0, Math.sin(TAU * 0.62 * t - 1.2)), 3) * e;
      const shoulder = m.body.where(base, "R_frontleg");
      const rest = m.body.padOf(base, NEAR.front);
      const goal: [number, number, number] = [shoulder[0] + 0.34 + 0.04 * pulse, shoulder[1] - 0.03 + 0.025 * sway + 0.02 * pulse, shoulder[2] + 0.0];
      return {
        neck: [neck[0] + 0.05 * e + 0.015 * pulse, neck[1] + 0.05 * e + 0.02 * pulse, neck[2] + 0.04 * e + 0.03 * sway, neck[3] + 0.06 * e + 0.04 * pulse],
        yaw: { neck2: 0.05 * sway, head: 0.08 * sway, tailstart: 0.1 * Math.sin(TAU * 0.4 * t) * e, tail1: 0.16 * Math.sin(TAU * 0.4 * t - 0.6) * e, tail2: 0.2 * Math.sin(TAU * 0.4 * t - 1.2) * e },
        paws: { [NEAR.front]: { at: mixSpec(rest, goal, e), tip: 0.25 * e + 0.2 * pulse, elbow: [shoulder[0] + 0.12, shoulder[1] - 0.13, shoulder[2] + 0.05] } },
      };
    },
    { base },
  );
}

/** A paw that taps: out ahead and down, two to the second, the body leaning in a little. */
export function tap(m: Made): ClipSource {
  const { base, neck } = sitting(m);
  return render(
    m,
    "tap",
    2.0,
    true,
    (t) => {
      const beat = Math.sin(TAU * 2 * t);
      const lift = Math.pow(Math.max(0, beat), 1.5);
      const shoulder = m.body.where(base, "R_frontleg");
      const floor = m.body.padOf(base, NEAR.front)[1];
      const goal: [number, number, number] = [shoulder[0] + 0.3, floor + 0.01 + 0.14 * lift, shoulder[2] + 0.02];
      return {
        neck: [neck[0] - 0.04, neck[1] - 0.05, neck[2] - 0.05, neck[3] - 0.04 + 0.03 * lift],
        paws: { [NEAR.front]: { at: goal, tip: 0.1 + 0.5 * lift, elbow: [shoulder[0] + 0.1, shoulder[1] - 0.14, shoulder[2] + 0.06] } },
      };
    },
    { base },
  );
}

/**
 * A hind leg up to the neck, scratching fast (six to the second), the head leaning into it. (Not in ACTS: the leg that the pose generator can reach up with is a stick under a coat
 * that hides it, and the clip is not one a viewer reads as a scratch; the director shows the cat's wash instead. Kept for the day the leg is a better one.)
 */
export function scratch(m: Made): ClipSource {
  const { base, neck } = sitting(m);
  return render(
    m,
    "scratch",
    4.0,
    true,
    (t) => {
      const e = bump(t, 0.3, 0.5, 2.6, 0.5);
      const s = e * Math.sin(TAU * 6 * t);
      const hip = m.body.where(base, "R_backleg");
      const rest = m.body.padOf(base, NEAR.hind);
      const goal: [number, number, number] = [hip[0] + 0.4 + 0.025 * s, hip[1] + 0.1 + 0.02 * s, hip[2] + 0.06];
      return {
        neck: [neck[0], neck[1] + 0.05 * e, neck[2] + 0.1 * e, neck[3] + 0.1 * e],
        roll: { head: -0.25 * e },
        yaw: { head: -0.15 * e },
        paws: { [NEAR.hind]: { at: mixSpec(rest, goal, e), tip: 0.4 * e, elbow: [hip[0] + 0.12, hip[1] + 0.1, hip[2] + 0.12] } },
      };
    },
    { base },
  );
}

/** A cat that is being stroked: the head leans up and into the hand, slowly, and eases off. */
export function pet(m: Made): ClipSource {
  const { base, neck } = sitting(m);
  return render(
    m,
    "pet",
    2.4,
    true,
    (t) => {
      const push = 0.5 - 0.5 * Math.cos(TAU * t / 2.4);
      return { neck: [neck[0] + 0.05 * push, neck[1] + 0.08 * push, neck[2] + 0.1 * push, neck[3] + 0.12 * push], roll: { head: 0.1 * push } };
    },
    { base },
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// treading, a swat, a sniff

/** Treading: the loaf's body, forward on its chest, the front paws pushing in turn (about one push to the second a paw), the head down to watch them. */
export function knead(m: Made): ClipSource {
  const base = loafSpec(m);
  const at = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  const P = 2.4;
  // (it comes out of the loaf)
  const from = lastOf(m, loaf(m));
  return render(
    m,
    "knead",
    P,
    true,
    (t) => {
      const a = TAU * t / P * 2;
      const paw = (p: PawName, phase: number): { at: [number, number, number]; tip: number } => {
        const q = a + phase;
        return { at: [0.3 + 0.05 * Math.cos(q), at(p)[1] + 0.07 * Math.max(0, Math.sin(q)), at(p)[2] * 1.1], tip: 0.3 * Math.max(0, Math.sin(q)) };
      };
      return {
        ...base,
        hips: base.hips!,
        neck: [deg(30), deg(26), deg(16), deg(-26)],
        back: [deg(-2) + 0.02 * Math.sin(a), deg(-5) + 0.03 * Math.sin(a)],
        paws: { ...base.paws, "front left": paw("front left", 0), "front right": paw("front right", Math.PI) },
      };
    },
    { from },
  );
}

/** A swat: the paw back and up as the cat leans away, then out and down hard, and back. The hit is at 0.4 s. */
export function swat(m: Made): ClipSource {
  const stand = standing(m);
  const shoulder = m.body.where(m.body.pose(), "R_frontleg");
  const rest = m.body.padAtRest(NEAR.front).at;
  return render(
    m,
    "swat",
    0.9,
    false,
    (t) => {
      const wind = over(t, 0, 0.3);
      const strike = over(t, 0.3, 0.1);
      const recover = over(t, 0.42, 0.45);
      const out = strike * (1 - recover);
      const back = wind * (1 - strike);
      const goal: [number, number, number] = [mixSpec(shoulder[0] - 0.1, shoulder[0] + 0.34, strike), mixSpec(shoulder[1] + 0.1, shoulder[1] - 0.1, strike), shoulder[2] + 0.04];
      const lift = Math.max(back, out);
      return {
        ...stand,
        hips: { ...stand.hips!, x: stand.hips!.x! + 0.05 * out, pitch: 0.06 * back - 0.05 * out },
        neck: [stand.neck![0] + 0.1 * back - 0.1 * out, stand.neck![1] + 0.1 * back - 0.1 * out, stand.neck![2] + 0.05 * back, stand.neck![3] + 0.1 * back - 0.15 * out],
        paws: { ...stand.paws, [NEAR.front]: { at: mixSpec([rest[0], rest[1], rest[2]] as [number, number, number], goal, lift), tip: 0.5 * lift, elbow: [shoulder[0] - 0.05 + 0.2 * out, shoulder[1] - 0.12, shoulder[2] + 0.07] } },
      };
    },
    { marks: { hit: 0.42 } },
  );
}

/**
 * The acts that the pose generator makes, in the order a person would list the cat's doings. (The sit, the swat and the peek are the generator's too: the donors' are a fox's squat with the
 * paws in the air, a fox's bite that a viewer reads as a duck, and a fox's alert that is a stuck walk.) Each is told from the cat's own rest and from the sit that is made here, and only the
 * stalk is laid on a donor's clip: the walk, so that its stride is the walk's, which must be made first.
 */
export const ACTS: Readonly<Record<string, (m: Made) => ClipSource>> = { sit, loaf, doze, curl, shift, crouch, wiggle, stretch, jump, climb, scale, stalk, groom, point, tap, pet, knead, sniff, swat, peek };

/**
 * A peek over an edge: the front low at the edge with the paws on it, the neck stretched out and down, the head turning slowly to look along the drop and back, the tail low and
 * swaying. (The donor's alert fox is a stuck walk on this cat: a paw up and the tail raised, held.)
 */
export function peek(m: Made): ClipSource {
  const low = crouchSpec(m);
  const P = 1.6;
  const from = lastOf(m, crouch(m));
  return render(
    m,
    "peek",
    P,
    true,
    (t) => {
      const a = (TAU * t) / P;
      const look = Math.sin(a);
      return {
        ...low,
        neck: [deg(16) + 0.03 * look, deg(-2) + 0.05 * Math.sin(a - 0.6), deg(-20) + 0.06 * Math.sin(a - 1.2), deg(-36)],
        yaw: { neck1: 0.06 * look, neck2: 0.16 * look, head: 0.28 * look, tailstart: 0.12 * Math.sin(a - 0.8), tail1: 0.2 * Math.sin(a - 1.1), tail2: 0.24 * Math.sin(a - 1.4) },
        roll: { head: 0.08 * look },
      };
    },
    { from },
  );
}

/** A sniff: the head down to the floor and moving about it, the nose working, and up again. */
export function sniff(m: Made): ClipSource {
  const stand = standing(m);
  const low: [number, number, number, number] = [deg(36), deg(8), deg(-18), deg(-62)];
  return render(m, "sniff", 2.8, false, (t, u) => {
    const e = over(u, 0, 0.18) * (1 - over(u, 0.82, 0.18));
    const nose = e * Math.sin(TAU * 3.4 * t);
    const sweep = e * Math.sin(TAU * 0.8 * t);
    const n = stand.neck!;
    return {
      ...stand,
      neck: [n[0] + (low[0] - n[0]) * e, n[1] + (low[1] - n[1]) * e, n[2] + (low[2] - n[2]) * e + 0.04 * nose, n[3] + (low[3] - n[3]) * e + 0.05 * nose],
      yaw: { neck2: 0.2 * sweep, head: 0.3 * sweep },
      back: [stand.back![0] - 0.08 * e, stand.back![1] - 0.1 * e],
    };
  });
}
