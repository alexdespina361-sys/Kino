// The cat's postures and acts that no animal of the donors does (lying down, curling up, the bow of a stretch, a paw at the face, a paw that kneads), made by constraints: each is a few
// postures told as numbers (posegen.mts: the hips, the bends of the back, the neck and the tail, where the paws are) and the way one passes into the next, and every frame is the posture
// the numbers say at that moment, solved for the bones. Nothing here is a bone's turn written by hand: change a number and the bones follow. An act that is done from a posture a donor
// has (a cat that sits and washes) is laid on that donor's pose, so that what is the donor's stays its own.
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { Pose, sampleFrame, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
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
    // down over the first third, held, and up over the last
    const k = ease(u / 0.3) * (1 - ease((u - 0.72) / 0.28));
    return between(from, to, k, WIN);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// from a sit: a paw to the face, a paw out, a leg at the neck

/** The sit as the donor made it: the pose the acts below are laid on, and where its neck's pieces point (the head moves by turns of those). */
function sitting(m: Made): { base: Pose; neck: readonly [number, number, number, number] } {
  const base = frameOf(m, "sit", 0);
  return { base, neck: m.body.anglesOf(base).neck };
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

/** A hind leg up to the neck, scratching fast (six to the second), the head leaning into it. */
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
