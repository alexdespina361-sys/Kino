// The cat's postures and acts that no animal of the donors does (lying down, curling up, the bow of a stretch, a paw at the face, a paw that kneads), made by constraints: each is a few
// postures told as numbers (posegen.mts: the hips, the bends of the back, the neck and the tail, where the paws are) and the way one passes into the next, and every frame is the posture
// the numbers say at that moment, solved for the bones. Nothing here is a bone's turn written by hand: change a number and the bones follow. An act that is done from a posture a donor
// has (a cat that sits and washes) is laid on that donor's pose, so that what is the donor's stays its own.
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { Pose, blend, sampleFrame, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
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
  const body = new Body(mesh, skeleton);
  // (the legs are reached by the turns that the donors' legs make: what they do not do, a shoulder swung half a turn about the vertical, a forearm twisted, they are not asked to)
  body.learn(clips.values());
  return { body, mesh, skeleton, clips };
}

/** The pose a clip that is just made has at its last frame. */
export function lastOf(m: Made, source: ClipSource): Pose {
  const pose = new Pose(m.skeleton);
  poseAt(m.skeleton, source, source.frames - 1, pose);
  return pose;
}

/** The pose a clip has at a frame (`last`: its last). */
export function frameOf(m: Made, clip: string, frame: number | "last"): Pose {
  const c = m.clips.get(clip);
  if (!c) throw new Error(`no clip ${clip} to lay an act on (it has ${[...m.clips.keys()].join(", ")})`);
  const pose = new Pose(m.skeleton);
  sampleFrame(c, frame === "last" ? c.frames - 1 : frame, pose);
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
    const kk = k(HIND.includes(p) ? when.hind : when.front);
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

const LIE_DOWN: Timing = { hips: [0.1, 0.9], back: [0.1, 0.9], neck: [0.35, 0.9], tail: [0.4, 0.9], hind: [0, 0.9], front: [0.2, 0.9] };

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
  return render(m, name, seconds, false, (t) => between(from, to, t, LIE_DOWN));
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
  return render(m, "crouch", 0.9, false, (t) => between(from, to, t, CROUCH_IN));
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
    hips: { y: 0.52, pitch: -0.12 },
    back: [deg(-22), deg(-34)],
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
    const k = ease(u / 0.28) * (1 - ease((u - 0.52) / 0.48));
    return between(from, to, k, WIN);
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
  const keys: Array<[number, Spec]> = [
    key(0, { hips: stand.hips!, back: stand.back!, neck: stand.neck!, tail: stand.tail!, paws: on(rest("front left")[0], rest("front right")[0], rest("hind left")[0], rest("hind right")[0]) }),
    // the coil: the haunches down, the hind paws brought up under them, the chest forward and low, the head up on the place
    key(0.22, { hips: { x: -0.4, y: 0.37, pitch: -0.04 }, back: [deg(-14), deg(-20)], neck: [deg(36), deg(38), deg(30), deg(-16)], tail: [deg(182), deg(186), deg(190), deg(194)], paws: on(0.2, 0.17, -0.45, -0.46) }),
    // the push: the legs straight, the hips over and ahead of the hind paws, the chest up, the paws just off the floor
    key(LEAP.takeoff, { hips: { x: -0.34, y: 0.52, pitch: 0 }, back: [deg(2), deg(8)], neck: [deg(50), deg(46), deg(34), deg(-22)], tail: [deg(176), deg(170), deg(164), deg(158)], paws: feet([0.3, 0.12], [0.22, 0.16], [-0.58, 0.07], [-0.6, 0.09]) }),
    // in the air: the body level and long, the front paws reaching ahead, the hind ones trailing
    key(0.58, { hips: { x: -0.38, y: 0.5, pitch: 0 }, back: [deg(-4), deg(-2)], neck: [deg(34), deg(30), deg(22), deg(-22)], tail: [deg(176), deg(172), deg(166), deg(160)], paws: feet([0.42, 0.24], [0.33, 0.28], [-0.66, 0.2], [-0.62, 0.24]) }),
    // the reach: the front paws on the floor, the hind ones coming under
    key(LEAP.land, { hips: { x: -0.37, y: 0.44, pitch: 0 }, back: [deg(-12), deg(-14)], neck: [deg(40), deg(40), deg(34), deg(-20)], tail: [deg(172), deg(160), deg(148), deg(138)], paws: feet([0.24, floor], [0.19, floor], [-0.5, 0.12], [-0.47, 0.16]) }),
    // the landing gives
    key(0.88, { hips: { x: -0.4, y: 0.38, pitch: -0.03 }, back: [deg(-14), deg(-20)], neck: [deg(40), deg(40), deg(32), deg(-18)], tail: [deg(176), deg(168), deg(158), deg(150)], paws: on(0.2, 0.16, -0.48, -0.48) }),
    // and the cat stands where it landed
    key(1, { hips: stand.hips!, back: stand.back!, neck: stand.neck!, tail: stand.tail!, paws: on(0.18, 0.14, -0.5, -0.5) }),
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
 * clear a corner by being lifted: the forepaws walk forward on the ledge, the elbows fold and the chest comes over, the hind legs scrabble up the wall and then push.
 */
export function climb(m: Made): ClipSource {
  const stand = standing(m);
  const rest = (p: PawName): [number, number, number] => m.body.padAtRest(p).at;
  const LIP = -CLIMB_LIP;
  const FREE: [number, number, number] = [1, 1, 1];
  /** A paw's sole at a place in the ledge's space (the sides across are the rest's, pulled in by `across` for paws that grip together). */
  const at = (p: PawName, x: number, y: number, across = 1, soft: [number, number, number] = FREE): NonNullable<Spec["paws"]>[PawName] => ({ at: [x, y, rest(p)[2] * across], soft });
  /** The four paws: the front pair and the hind pair, near one first. */
  const paws = (fn: [number, number], ff: [number, number], hn: [number, number], hf: [number, number], across = 1): NonNullable<Spec["paws"]> => ({
    "front right": at("front right", fn[0], fn[1], across),
    "front left": at("front left", ff[0], ff[1], across),
    "hind right": at("hind right", hn[0], hn[1], across),
    "hind left": at("hind left", hf[0], hf[1], across),
  });
  const key = (u: number, spec: Omit<Spec, "tailFloor">): [number, Spec] => [u, spec];
  const lip = 0.015;
  const keys: Array<[number, Spec]> = [
    // reaching: stretched up the wall, the paws open over the lip, the hind legs and the tail hanging
    key(0, { hips: { x: LIP - 0.2, y: -0.8, pitch: 1.2 }, back: [deg(84), deg(82)], neck: [deg(88), deg(92), deg(84), deg(52)], tail: [deg(250), deg(262), deg(268), deg(272)], paws: paws([LIP + 0.04, 0.09], [LIP - 0.02, 0.1], [LIP - 0.2, -1.08], [LIP - 0.24, -1.1], 0.8) }),
    // the paws take hold of the lip and the weight comes on them
    key(CLIMB_GRAB, { hips: { x: LIP - 0.22, y: -0.84, pitch: 1.2 }, back: [deg(84), deg(82)], neck: [deg(88), deg(94), deg(86), deg(56)], tail: [deg(252), deg(264), deg(270), deg(274)], paws: paws([LIP + 0.02, lip], [LIP - 0.03, lip], [LIP - 0.2, -1.12], [LIP - 0.24, -1.14], 0.8) }),
    // hauling: the forepaws go forward on the ledge, the elbows fold, the chest rises, one hind leg pushes on the wall
    key(0.38, { hips: { x: LIP - 0.2, y: -0.62, pitch: 1.1 }, back: [deg(76), deg(72)], neck: [deg(78), deg(84), deg(76), deg(44)], tail: [deg(246), deg(258), deg(264), deg(268)], paws: paws([LIP + 0.16, lip], [LIP + 0.1, lip], [LIP - 0.03, -0.52], [LIP - 0.07, -0.78], 0.8) }),
    // the chest is over the lip, the paws are on the top of the ledge, the belly is at the corner
    key(CLIMB_PULL, { hips: { x: LIP - 0.14, y: -0.3, pitch: 0.9 }, back: [deg(52), deg(46)], neck: [deg(50), deg(58), deg(52), deg(22)], tail: [deg(236), deg(248), deg(258), deg(262)], paws: paws([LIP + 0.3, lip], [LIP + 0.37, lip], [LIP - 0.02, -0.34], [LIP - 0.05, -0.6], 0.9) }),
    // the hind legs come over: the weight goes forward over the paws, one hind paw on the top
    key(CLIMB_OVER, { hips: { x: LIP + 0.1, y: 0.2, pitch: 0.3 }, back: [deg(14), deg(8)], neck: [deg(40), deg(44), deg(40), deg(-6)], tail: [deg(214), deg(222), deg(232), deg(240)], paws: paws([LIP + 0.36, lip], [LIP + 0.4, lip], [LIP + 0.1, lip], [LIP - 0.02, -0.1], 1) }),
    // and the cat stands where it climbed to
    key(1, { hips: stand.hips!, back: stand.back!, neck: stand.neck!, tail: stand.tail!, paws: paws([rest("front right")[0], 0.02], [rest("front left")[0], 0.02], [rest("hind right")[0], 0.02], [rest("hind left")[0], 0.02], 1) }),
  ];
  const marks = { grab: CLIMB_GRAB * CLIMB_TIME, pull: CLIMB_PULL * CLIMB_TIME, over: CLIMB_OVER * CLIMB_TIME };
  return render(m, "climb", CLIMB_TIME, false, (_t, u) => through(keys, u), { marks, grounded: false });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// from a sit: a paw to the face, a paw out, a leg at the neck

/** The sit as the donor made it: the pose the acts below are laid on, and where its neck's pieces point (the head moves by turns of those). */
function sitting(m: Made): { base: Pose; neck: readonly [number, number, number, number] } {
  const base = frameOf(m, DONOR_SIT, 0);
  return { base, neck: m.body.anglesOf(base).neck };
}

/** The donor's clip of a cat that sits (kept under this name: `sit` is the one that sits down, made below from the donor's pose). */
export const DONOR_SIT = "sit_donor";

const SIT_DOWN: Timing = { hips: [0, 0.8], back: [0, 0.8], neck: [0.2, 0.8], tail: [0.3, 0.7], hind: [0, 0.8], front: [0, 0.8] };

/**
 * The sit the cat sits down to: the donor's, as the numbers a posture is told in. (It is a squat with the back near level, and that is what this cat can do: its seat is the fur of its rump,
 * which hangs far below the hips, and its legs are short: with the back steeper the shoulders are higher than the front legs reach and the paws are left hanging in the air, a begging cat.)
 */
export function sitSpec(m: Made): Spec {
  return specOf(m, frameOf(m, DONOR_SIT, "last"));
}

/**
 * The cat that sits down: from standing to the sit, the hips and the haunches first (the hind paws come forward under them), the back pitching up as the rump goes down, the neck and the
 * tail after, and then the sit held.
 */
export function sit(m: Made): ClipSource {
  const to = sitSpec(m);
  const from = standing(m);
  // (the legs of a pose that is told as numbers come out a little otherwise than the donor's: the last of the clip is eased into the donor's own, the pose that the acts done from a sit are laid on)
  return endingIn(m, render(m, "sit", 1.4, false, (t) => between(from, to, t, SIT_DOWN)), frameOf(m, DONOR_SIT, "last"));
}

/** A clip whose last stretch (from `from` of the way through it) is brought, by an ease, to a pose that it ends in exactly. */
export function endingIn(m: Made, source: ClipSource, target: Pose, from = 0.6): ClipSource {
  const rec = new Recorder(m.skeleton, source.frames);
  const pose = new Pose(m.skeleton);
  const first = Math.floor(from * (source.frames - 1));
  for (let f = 0; f < source.frames; f++) {
    poseAt(m.skeleton, source, f, pose);
    if (f > first) blend(pose, pose, target, ease((f - first) / (source.frames - 1 - first)));
    rec.put(f, pose);
  }
  return rec.source(source.name, source.fps, source.loop, source.marks ?? {});
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
        neck: [neck[0] - 0.2 * e, neck[1] - 0.3 * e, neck[2] - 0.35 * e + 0.03 * lick, neck[3] - 0.15 * e + 0.07 * lick],
        yaw: { neck2: -0.1 * e, head: -0.14 * e },
      };
      const nose = m.body.where(m.body.make(head, undefined, base), "headend");
      const rest = m.body.padOf(base, NEAR.front);
      const goal: [number, number, number] = [nose[0] - 0.03 + 0.012 * lick, nose[1] - 0.05 + 0.01 * lick, nose[2] + 0.05];
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
      const shoulder = m.body.where(base, "R_frontleg");
      const rest = m.body.padOf(base, NEAR.front);
      const goal: [number, number, number] = [shoulder[0] + 0.36, shoulder[1] - 0.02 + 0.012 * sway, shoulder[2] + 0.0];
      return {
        neck: [neck[0] + 0.05 * e, neck[1] + 0.05 * e, neck[2] + 0.04 * e, neck[3] + 0.06 * e],
        paws: { [NEAR.front]: { at: mixSpec(rest, goal, e), tip: 0.25 * e, elbow: [shoulder[0] + 0.12, shoulder[1] - 0.13, shoulder[2] + 0.05] } },
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
      const goal: [number, number, number] = [mixSpec(shoulder[0] - 0.1, shoulder[0] + 0.45, strike), mixSpec(shoulder[1] + 0.1, shoulder[1] - 0.12, strike), shoulder[2] + 0.04];
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
 * The acts that the pose generator makes, in the order a person would list the cat's doings. (The donor's swat stays: it bites, and the generated one only reaches out.)
 * Each is laid on the donors' standing and sitting, so the donors must be made first.
 */
export const ACTS: Readonly<Record<string, (m: Made) => ClipSource>> = { sit, loaf, doze, curl, shift, crouch, wiggle, stretch, jump, climb, stalk, groom, point, tap, pet, knead, sniff };

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
