// Poses made by constraints, not by hand-keyed curves. A posture is told as a few things that can be said of a cat (how high and how tilted the hips are, how the back, the neck and the
// tail bend, where each paw is to be), and what turns the bones need is found here: the bends are turns about the cat's own axes, the paws are put by a few steps of least squares
// (ik.mts), and the whole is put on the floor by the lowest part of the mesh (floor.mts). A clip is such a posture asked for at each of its frames, so that what moves (a paw that
// presses, a head that dips) is a formula of time and what holds still is held by the floor and the paws.
import { Pose, SKIN_LINEAR, Skeleton, after, dualSkin, globals, solveDual, turnAbout } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { PAWS, restPads, soleVertices } from "./gait.mts";
import { reachChain, type Cap, type Limit, type Marker, type Twist, type Vec3 } from "./ik.mts";
import { quatOfMatrix, type Quat } from "./retarget.mts";

export type PawName = (typeof PAWS)[number]["name"];

/** The bones of each leg, from the hip (or the shoulder) down to the paw. */
const LEGS: Record<PawName, readonly string[]> = {
  "hind left": ["backleg", "backleg0", "backleg1", "backleg2"],
  "hind right": ["R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"],
  "front left": ["frontleg", "frontleg_e", "frontleg0", "frontleg1", "frontleg2"],
  "front right": ["R_frontleg", "R_frontleg_e", "R_frontleg0", "R_frontleg1", "R_frontleg2"],
};
/** The legs of a skeleton: the bones above that it has (a foreleg's elbow, `frontleg_e`, is only in a mesh built with `CAT_ELBOW=1`: see build-meshy.mts). */
const legsOf = (skeleton: Skeleton): Record<PawName, readonly string[]> => Object.fromEntries(Object.entries(LEGS).map(([paw, bones]) => [paw, bones.filter((b) => skeleton.has(b))])) as unknown as Record<PawName, readonly string[]>;

const BACK = ["spine1", "spine2", "chest"] as const;
const NECK = ["neck1", "neck2", "head"] as const;
const TAIL = ["tail", "tailstart", "tail1", "tail2", "tail3"] as const;

/** The turn about the cat's axes: `roll` about x (the way it faces), `yaw` about y (up), `pitch` about z (across: positive lifts a bone that points forward; a tail that points back goes down). */
export interface Bend {
  pitch?: number;
  yaw?: number;
  roll?: number;
}

const TORSO = ["Hips", "spine1", "spine2", "chest"];
/** A point of a leg lower than this is through the floor (a little under it, so that the sole's own fur does not count). */
const UNDER = -0.002;
/** How far a single point of the coat may be through the floor (body lengths; a tuft that hangs lower than this is seen as a part of the cat that is in the floor). */
const POKE = 0.025;
/**
 * How far the joints of a leg may close (degrees): a foreleg's elbow (the added bone), the joint of the forearm that the model had for an elbow (`frontleg0`: it bends the arm a little,
 * and may not fold much more) and the wrist, a hind leg's knee and hock. Measured on the mesh before the elbow was added, the skin held while the elbow stayed over about 50 degrees
 * (stretch99 under 1.6) and folded in on itself under it (31 degrees: 2.5, a tenth of the faces turned over).
 */
const CLOSE = { front: [55, 60], front5: (process.env.CAT_CLOSE_FRONT ?? "50,125,60").split(",").map(Number), hind: [60, 25] } as const;
/** A paw that ends further than this (body lengths) from its place is tried again from other starts. */
const STRAY = 0.03;
/** What a radian of turn (on average, over the bones of a leg) costs when a leg's ends are compared, in body lengths of a paw out of place. */
const FLING = 0.03;
/** The most that a leg's bones may turn between two frames (radians, on average) for a start over to be taken: a leg that is wound a half turn into another bend in a frame is a pop, whatever it gains. */
const MAX_TURN = 1.2;
/**
 * How far each of the first three bones of a leg (from the shoulder, or the hip, down) may turn from its rest before the solver is made to pay for it, in degrees: the swing (how far the
 * bone's own axis leaves where it points at rest) and the twist (about that axis), for each bone in turn. A paw's place does not say how its leg winds to reach it, and left to itself the
 * solver winds a shoulder a half turn with the paw on its mark: the coat of that leg is turned inside out, and a hind leg too far into the belly swells it. The model's first leg bone is
 * the whole upper limb (about a fifth of the body; a foreleg has an elbow added half way along it), the next ones are short ones about the knee, so the limits are by bone and not for the leg. `normal` is for a cat on its
 * feet, sitting, lying, reaching; `wide` for a stretch that takes its legs further; a spec that winds them up (a card, a wall) says `free` and has none (see `Spec.range`).
 */
const RANGES = {
  normal: { front: [125, 30, 150, 35, 130, 35], front5: [125, 30, 150, 35, 50, 20, 130, 35], hind: [70, 30, 125, 35, 120, 35] },
  wide: { front: [150, 45, 170, 45, 150, 45], front5: [150, 45, 170, 45, 70, 30, 150, 45], hind: [100, 40, 150, 45, 140, 45] },
} as const;
/** How much a paw that is turned past its range is charged (against the miss of the paw's place, which weighs 1). */
const RANGE_WEIGHT = 3;

/** Where a paw's sole is to be, and how the paw is held: tipped about the cat's z axis (toes up positive), turned about the vertical, how much it is kept to the pose it had, and where its elbow (or knee) is to be. */
export interface PawAim {
  at: Vec3;
  tip?: number;
  toe?: number;
  hold?: number;
  elbow?: Vec3;
  /** How much the elbow's place counts against the paw's (0.15 if left out). */
  elbowWeight?: number;
  /** How much each way (along, up, across) counts: a paw that is only to be about there along the floor (and on it) gives along a little, and the leg finds the place it can be at. */
  soft?: Vec3;
}

/**
 * A posture in a few numbers (angles in radians, places in body lengths). `back` has the angle of the two pieces of the spine, `neck` of the neck's two pieces, the head from its
 * joint to its snout (the way the nose points), and the tail's four pieces, each seen from the side as the angle above the way the cat faces: a back that runs level is 0 (the cat's own
 * is about -0.2 at rest), a tail that lies out behind is 3.14.
 */
export interface Spec {
  /**
   * Left out, the hips are as the pose the spec is laid on (`make`'s `base`) has them. `z` is how far across they are. `spin` turns the whole cat about the vertical when everything else is
   * found (the wall, the floor and the paws are told in the cat's own side view, and the cat is turned after): a cat that climbs up a wall seen from behind is such a turn of one seen from the side.
   */
  hips?: { x?: number; y: number; z?: number; pitch?: number; yaw?: number; roll?: number; spin?: number };
  back?: readonly [number, number];
  neck?: readonly [number, number, number, number];
  tail?: readonly [number, number, number, number];
  /** Bends about the cat's vertical and its long axis, by the bone, after the above. */
  yaw?: Readonly<Record<string, number>>;
  roll?: Readonly<Record<string, number>>;
  /** The torso's lowest part is this high over the floor (the hips are moved to make it so, whatever `hips.y` says). */
  settle?: number;
  /** The pieces of the tail are not let below this height. */
  tailFloor?: number;
  /** What the legs are kept out of, where it is not the floor alone (see `Solid`). */
  solid?: Solid;
  /**
   * How far the first two bones of a leg (the shoulder and the arm, the hip and the thigh) may be turned from their rest (degrees) before the solver is made to pay for it; left out, no
   * limit. The skin has a vertex that two bones carry blended through nothing when the two are a half turn apart (the player's skinning: a share under a twentieth of a turn's cosine,
   * about 174 degrees), and a shoulder or a hip wound up that far is a coat that turns itself inside out; a leg has more bones than it needs to turn, and the turn is shared among them
   * instead. For a clip whose legs are wound up (hanging by the arms, scrabbling at a wall): the hind legs of a sit fold further than any limit that is good for a wall.
   */
  cap?: { front?: number; hind?: number };
  /** How far each bone of a leg may be turned (see `RANGES`); left out, `normal`. */
  range?: keyof typeof RANGES | "free";
  paws?: Partial<Record<PawName, PawAim>>;
}

/**
 * What a cat's legs must not go into: the floor (how high it is: 0 unless told, `false` for none) and a wall (how far forward it begins; the cat's space has the cat facing forward, so the
 * wall is on the side the belly is on). Both together are a ledge: the floor is its top, from the lip on, and its face is the wall below the lip; a leg that hangs there is not through any
 * floor. A wall alone is the face of something a cat climbs (a card).
 */
export interface Solid {
  floor?: number | false;
  wall?: number;
}

/** A spec made `k` of the way from `a` to `b` (numbers go in a straight line; what only one has is the one's, from the half way on). */
export function mixSpec<T>(a: T, b: T, k: number): T {
  if (typeof a === "number" && typeof b === "number") return (a + (b - a) * k) as T;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mixSpec(v, b[i], k)) as T;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out: Record<string, unknown> = {};
    const A = a as Record<string, unknown>;
    const B = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (key in A && key in B) out[key] = mixSpec(A[key], B[key], k);
      else out[key] = key in A ? (k < 0.5 ? A[key] : undefined) : k >= 0.5 ? B[key] : undefined;
    }
    return out as T;
  }
  return (k < 0.5 ? a : b) as T;
}

const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** (CAT_ELBOW_PULL: every elbow hint counts this many times what the spec says, for trying how much of a bend a leg should be given) */
const ELBOW_PULL = Number(process.env.CAT_ELBOW_PULL ?? 1);
const R = new Float64Array(48 * 9);
const T = new Float64Array(48 * 3);

export class Body {
  readonly hips: number;
  private readonly pads: Array<[number, number, number, number]>;
  /** Where each paw's sole is against the paw's bone at rest (the bone's own axes), and the paw's joint against the sole's middle at rest (the cat's axes). */
  private readonly padLocal: Vec3[];
  private readonly jointOff: Vec3[];
  private readonly rest: Pose;
  /** The vertices that a set of bones carries (by the set's names), and the bones as the card has them, for measuring how low the mesh reaches. */
  private readonly carried = new Map<string, Int32Array>();
  /** The bones as the player draws with them (dual quaternions, `solveDual`), and the place of a point that `dualSkin` writes: how low the mesh is is measured as it is drawn, not as matrices would have it. */
  private readonly dq: Float32Array;
  private readonly at = [0, 0, 0];
  private readonly normal = [0, 0, 0];
  /** Every bone but the tail's (what a cat on the floor must not put through it). */
  private readonly nonTail: readonly string[];
  /** The bones of each leg of this skeleton, from the hip (or the shoulder) down to the paw. */
  private readonly legs: Record<PawName, readonly string[]>;

  constructor(
    readonly mesh: CatMesh,
    readonly skeleton: Skeleton,
  ) {
    this.hips = skeleton.bone("Hips");
    this.legs = legsOf(skeleton);
    this.dq = new Float32Array(skeleton.count * 8);
    this.nonTail = skeleton.names.filter((n) => !n.startsWith("tail"));
    this.rest = new Pose(skeleton);
    const soles = soleVertices(mesh, skeleton);
    this.pads = restPads(mesh, skeleton, soles);
    globals(skeleton, this.rest, undefined, R, T);
    this.padLocal = [];
    this.jointOff = [];
    PAWS.forEach((p, i) => {
      const paw = skeleton.bone(this.legs[p.name]![this.legs[p.name]!.length - 1]!);
      const pad = this.pads[i]!;
      const d = [pad[0] - T[paw * 3]!, pad[1] - T[paw * 3 + 1]!, pad[2] - T[paw * 3 + 2]!];
      this.padLocal.push([0, 1, 2].map((c) => R[paw * 9 + c]! * d[0]! + R[paw * 9 + 3 + c]! * d[1]! + R[paw * 9 + 6 + c]! * d[2]!) as Vec3);
      this.jointOff.push([T[paw * 3]! - pad[0], T[paw * 3 + 1]! - pad[1], T[paw * 3 + 2]! - pad[2]]);
    });
  }

  /** A pose at rest. */
  pose(): Pose {
    const p = new Pose(this.skeleton);
    p.copy(this.rest);
    return p;
  }

  /** Where the middle of a paw's sole is at rest (the cat's space), and the height of the lowest point of it (the floor, as that paw sees it). */
  padAtRest(paw: PawName): { at: Vec3; floor: number } {
    const k = PAWS.findIndex((p) => p.name === paw);
    const p = this.pads[k]!;
    return { at: [p[0], p[1], p[2]], floor: p[3] };
  }

  /** The hips: where they are (the cat's space, body lengths), and how they are turned (about the cat's axes). A field left out stays as the pose has it. */
  hipsAt(pose: Pose, at: { x?: number; y?: number; z?: number }, turn: Bend = {}): void {
    const h = this.hips;
    if (at.x !== undefined) pose.t[h * 3] = at.x;
    if (at.y !== undefined) pose.t[h * 3 + 1] = at.y;
    if (at.z !== undefined) pose.t[h * 3 + 2] = at.z;
    let w: Quat = [0, 0, 0, 1];
    if (turn.roll) w = after(w, turnAbout(1, 0, 0, turn.roll)) as Quat;
    if (turn.yaw) w = after(w, turnAbout(0, 1, 0, turn.yaw)) as Quat;
    if (turn.pitch) w = after(w, turnAbout(0, 0, 1, turn.pitch)) as Quat;
    const rest: Quat = [this.skeleton.restR[h * 4]!, this.skeleton.restR[h * 4 + 1]!, this.skeleton.restR[h * 4 + 2]!, this.skeleton.restR[h * 4 + 3]!];
    const q = after(rest, w);
    for (let k = 0; k < 4; k++) pose.r[h * 4 + k] = q[k]!;
  }

  /** A bone turned further, about the cat's axes, after what its parents and it have (the bones below it go with it). */
  turn(pose: Pose, bone: string, b: Bend): void {
    let w: Quat = [0, 0, 0, 1];
    if (b.roll) w = after(w, turnAbout(1, 0, 0, b.roll)) as Quat;
    if (b.yaw) w = after(w, turnAbout(0, 1, 0, b.yaw)) as Quat;
    if (b.pitch) w = after(w, turnAbout(0, 0, 1, b.pitch)) as Quat;
    this.turnBy(pose, this.skeleton.bone(bone), w);
  }

  /** A bone given the turn `w` (about the cat's axes, whatever axis it is) after what its parents and it have. */
  private turnBy(pose: Pose, j: number, w: Quat): void {
    globals(this.skeleton, pose, undefined, R, T);
    const parent = this.skeleton.parent[j]!;
    const P: Quat = parent >= 0 ? quatOfMatrix(R, parent * 9) : [0, 0, 0, 1];
    const d = after(after(P, w), conj(P));
    const local: Quat = [pose.r[j * 4]!, pose.r[j * 4 + 1]!, pose.r[j * 4 + 2]!, pose.r[j * 4 + 3]!];
    const q = after(local, d);
    for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = q[k]!;
  }

  /**
   * A bone turned (about the cat's z axis) until the line from its joint to its child's points `angle` radians above the way the cat faces (x), seen from the side: the back at about
   * -0.2, a neck that rises at 0.9, a tail that lies out behind at 3.14. `mix` is how much of the way to go (1: all of it).
   */
  aim(pose: Pose, bone: string, child: string, angle: number, mix = 1): void {
    const a = this.where(pose, bone);
    const c = this.where(pose, child);
    const now = Math.atan2(c[1] - a[1], c[0] - a[0]);
    let d = angle - now;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.turn(pose, bone, { pitch: d * mix });
  }

  /** The back, the neck or the tail bent: `bends[i]` is the turn of the i-th bone of the part, from the root out (the part's own bones are named in `BACK`, `NECK` and `TAIL`). */
  bend(pose: Pose, part: "back" | "neck" | "tail", bends: ReadonlyArray<Bend | undefined>): void {
    const bones = part === "back" ? BACK : part === "neck" ? NECK : TAIL;
    bones.forEach((name, i) => {
      const b = bends[i];
      if (b && (b.pitch || b.yaw || b.roll)) this.turn(pose, name, b);
    });
  }

  /**
   * A leg reached to a place: the middle of the paw's sole at `pad` (the cat's space), the paw tipped about the cat's z axis by `tip` (positive: the toes up) and turned about the
   * vertical by `toe`. Returns how far the sole ended from the place (body lengths).
   */
  reach(pose: Pose, paw: PawName, pad: Vec3, o: { tip?: number; toe?: number; hold?: number; elbow?: Vec3; elbowWeight?: number; soft?: Vec3; solid?: Solid; cap?: number; range?: Spec["range"] } = {}): number {
    const k = PAWS.findIndex((p) => p.name === paw);
    const chain = this.legs[paw]!.map((b) => this.skeleton.bone(b));
    const tip = o.tip ?? 0;
    const toe = o.toe ?? 0;
    // the joint of the paw's bone against the sole: the rest offset, tipped and turned
    const off = this.jointOff[k]!;
    const ct = Math.cos(tip);
    const st = Math.sin(tip);
    const cy = Math.cos(toe);
    const sy = Math.sin(toe);
    const tx = off[0] * ct - off[1] * st;
    const ty = off[0] * st + off[1] * ct;
    const jx = tx * cy + off[2] * sy;
    const jz = -tx * sy + off[2] * cy;
    const axes = o.soft;
    const front = paw.startsWith("front");
    // (a foreleg with an elbow of its own has five bones, a leg without has four: the hind legs, and the forelegs of the model's own skeleton)
    const elbowed = chain.length === 5;
    const last = chain[chain.length - 1]!;
    const markers: Marker[] = [
      { bone: last, local: this.padLocal[k]!, aim: pad, weight: 1, ...(axes ? { axes } : {}) },
      { bone: last, local: [0, 0, 0], aim: [pad[0] + jx, pad[1] + ty, pad[2] + jz], weight: 1, ...(axes ? { axes } : {}) },
    ];
    if (o.elbow) {
      // (a foreleg's hint says where the end of the first bone of the model's is to be, which is what an elbow was; the added elbow is that far from the shoulder, the share it has of the bone)
      let aim = o.elbow;
      if (elbowed) {
        const s = this.where(pose, this.legs[paw]![0]!);
        const a = Math.hypot(this.skeleton.restT[chain[1]! * 3]!, this.skeleton.restT[chain[1]! * 3 + 1]!, this.skeleton.restT[chain[1]! * 3 + 2]!);
        const b = Math.hypot(this.skeleton.restT[chain[2]! * 3]!, this.skeleton.restT[chain[2]! * 3 + 1]!, this.skeleton.restT[chain[2]! * 3 + 2]!);
        const share = a / (a + b);
        aim = [s[0] + (aim[0] - s[0]) * share, s[1] + (aim[1] - s[1]) * share, s[2] + (aim[2] - s[2]) * share];
      }
      markers.push({ bone: chain[1]!, local: [0, 0, 0], aim, weight: o.elbowWeight ?? 0.15 });
    }
    const hold = o.hold ?? 0.004;
    // (the joints do not close past where the skin folds in on itself)
    const close = (front ? (elbowed ? CLOSE.front5 : CLOSE.front) : CLOSE.hind).map((d) => (d * Math.PI) / 180);
    const limits: Limit[] = close.map((min, i) => ({ bone: chain[i + 1]!, min, weight: 4 }));
    const cap = o.cap ?? 0;
    const caps: Cap[] = cap > 0 ? chain.slice(0, 2).map((bone) => ({ bone, max: (cap * Math.PI) / 180, weight: 3 })) : [];
    // (the range of each bone: its swing and its twist about the line to the next bone, as the rest has the line)
    const twists: Twist[] = [];
    const rangeName = o.range;
    if (rangeName !== "free") {
      const table = RANGES[rangeName ?? "normal"][front ? (elbowed ? "front5" : "front") : "hind"];
      for (let i = 0; i < chain.length - 1; i++) {
        const child = chain[i + 1]!;
        const x = this.skeleton.restT[child * 3]!;
        const y = this.skeleton.restT[child * 3 + 1]!;
        const z = this.skeleton.restT[child * 3 + 2]!;
        const l = Math.hypot(x, y, z) || 1;
        caps.push({ bone: chain[i]!, max: (table[i * 2]! * Math.PI) / 180, weight: RANGE_WEIGHT });
        twists.push({ bone: chain[i]!, axis: [x / l, y / l, z / l], max: (table[i * 2 + 1]! * Math.PI) / 180, weight: RANGE_WEIGHT });
      }
    }
    const solve = (p: Pose): number => {
      let miss = reachChain(this.skeleton, p, chain, markers, hold, 30, limits, caps, twists).miss[0]!;
      // (a leg that is folded may have a piece of itself through the floor: each point of it that is told to stay above the floor, and the leg is solved again)
      const contacts: Marker[] = [];
      for (let round = 0; round < 3; round++) {
        const low = this.under(p, this.legs[paw]!, o.solid ?? {}, 24);
        if (low.length === 0) break;
        for (const l of low) contacts.push(l.wall ? { bone: l.bone, local: l.local, aim: [l.rigid - l.depth, 0, 0], wall: true, weight: 2 } : { bone: l.bone, local: l.local, aim: [0, l.rigid + l.depth, 0], floor: true, weight: 2 });
        miss = reachChain(this.skeleton, p, chain, [...markers, ...contacts], hold, 30, limits, caps, twists).miss[0]!;
      }
      return miss;
    };
    const origin = this.pose();
    origin.copy(pose);
    let miss = solve(pose);
    if (miss <= STRAY) return miss;
    // (the search is from where the leg is, and a leg that is far from the place can settle in a bend that never gets there (a hind leg folded up over the back, with the paw by the
    // shoulder): the leg is started again, turned at the hip to point at the place, from the pose it had and from the rest's, and the best of the ends is kept. The best counts the
    // turn the leg took from where it was: a leg that is flung into another bend for a few hundredths of a body length is a pop in the clip, not a better pose)
    const trial = this.pose();
    let best = miss + FLING * this.turned(origin, pose, chain);
    for (const fromRest of [false, true]) {
      trial.copy(origin);
      if (fromRest) for (const b of this.legs[paw]!) for (let c = 0; c < 4; c++) trial.r[this.skeleton.bone(b) * 4 + c] = this.rest.r[this.skeleton.bone(b) * 4 + c]!;
      this.aimLeg(trial, paw, pad);
      const m2 = solve(trial);
      if (this.turned(origin, trial, chain) > MAX_TURN) continue;
      const score = m2 + FLING * this.turned(origin, trial, chain);
      if (score < best) {
        best = score;
        miss = m2;
        for (const j of chain) for (let c = 0; c < 4; c++) pose.r[j * 4 + c] = trial.r[j * 4 + c]!;
      }
      if (miss <= STRAY) break;
    }
    return miss;
  }

  /** How far the bones of a chain are turned between two poses, on average (radians). */
  private turned(a: Pose, b: Pose, chain: readonly number[]): number {
    let sum = 0;
    for (const j of chain) {
      let d = 0;
      for (let c = 0; c < 4; c++) d += a.r[j * 4 + c]! * b.r[j * 4 + c]!;
      sum += 2 * Math.acos(Math.min(1, Math.abs(d)));
    }
    return sum / chain.length;
  }

  /** A leg turned at its hip, all in one piece, until the line from the hip to the middle of the paw's sole points at `pad` (the start of a search for the bends that put it there). */
  private aimLeg(pose: Pose, paw: PawName, pad: Vec3): void {
    const root = this.where(pose, this.legs[paw]![0]!);
    const now = this.padOf(pose, paw);
    const a: Vec3 = [now[0] - root[0], now[1] - root[1], now[2] - root[2]];
    const b: Vec3 = [pad[0] - root[0], pad[1] - root[1], pad[2] - root[2]];
    const axis: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const s = Math.hypot(axis[0], axis[1], axis[2]);
    if (s < 1e-9) return;
    const angle = Math.atan2(s, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    this.turnBy(pose, this.skeleton.bone(this.legs[paw]![0]!), turnAbout(axis[0] / s, axis[1] / s, axis[2] / s, angle) as Quat);
  }

  /**
   * The vertices that the named bones carry (a half or more of the weight, between them) that the pose has in the solid (below the floor, and, where there is a wall, beyond it), the
   * `few` that are furthest in: each with the bone of the set that carries it most, where it is in that bone's own axes (to put a marker on it), how far in it is, and where the bone's
   * own turn would have it (the vertex as if it were all that bone's: how high, or, for a point that leaves by the wall, how far forward). A point that is in a ledge comes out by the
   * nearer way, up or back.
   */
  under(pose: Pose, bones: readonly string[], solid: Solid, few = 16): Array<{ bone: number; local: Vec3; depth: number; rigid: number; wall: boolean }> {
    if (solid.floor === false && solid.wall === undefined) return [];
    // (a little in is not in: the sole's own fur)
    const floor = solid.floor === false ? Infinity : (solid.floor ?? 0) + UNDER;
    const wall = solid.wall === undefined ? Infinity : solid.wall - UNDER;
    const ids = bones.map((b) => this.skeleton.bone(b));
    const m = this.mesh;
    solveDual(this.skeleton, pose, this.dq);
    const found: Array<{ v: number; depth: number; bone: number; wall: boolean }> = [];
    for (let v = 0; v < m.count; v++) {
      let w = 0;
      let top = 0;
      let bone = -1;
      for (let k = 0; k < 4; k++) {
        const id = m.skin[v * 4 + k]!;
        const wk = m.weight[v * 4 + k]! / 255;
        if (wk <= 0 || !ids.includes(id)) continue;
        w += wk;
        if (wk > top) {
          top = wk;
          bone = id;
        }
      }
      if (w < 0.5) continue;
      const px = m.pos[v * 3]!;
      const py = m.pos[v * 3 + 1]!;
      const pz = m.pos[v * 3 + 2]!;
      dualSkin(this.dq, m.skin, m.weight, v * 4, 1 / 255, px, py, pz, 0, 1, 0, this.at, this.normal, SKIN_LINEAR);
      const up = floor - this.at[1]!;
      const back = wall === Infinity ? Infinity : this.at[0]! - wall;
      if (up <= 0 || back <= 0) continue;
      found.push({ v, bone, depth: Math.min(up, back), wall: back < up });
    }
    found.sort((a, b) => b.depth - a.depth);
    globals(this.skeleton, pose, undefined, R, T);
    const bind = this.skeleton.bind;
    return found.slice(0, few).map(({ v, depth, bone, wall }) => {
      const px = m.pos[v * 3]!;
      const py = m.pos[v * 3 + 1]!;
      const pz = m.pos[v * 3 + 2]!;
      const l: Vec3 = [0, 1, 2].map((r) => bind[bone * 12 + r * 4]! * px + bind[bone * 12 + r * 4 + 1]! * py + bind[bone * 12 + r * 4 + 2]! * pz + bind[bone * 12 + r * 4 + 3]!) as Vec3;
      const at = wall ? 0 : 1;
      const rigid = T[bone * 3 + at]! + R[bone * 9 + at * 3]! * l[0] + R[bone * 9 + at * 3 + 1]! * l[1] + R[bone * 9 + at * 3 + 2]! * l[2];
      return { bone, local: l, depth, rigid, wall };
    });
  }

  /**
   * How low the mesh reaches in the pose, counting only the vertices that the named bones carry (a half or more of each vertex's weight): the mean height of the lowest few, so that
   * one tuft does not decide. (A cat that lies down is on the floor by its belly, not by the tip of its tail.)
   */
  lowest(pose: Pose, bones: readonly string[], few = 24): number {
    const ids = new Set(bones.map((b) => this.skeleton.bone(b)));
    const m = this.mesh;
    let list = this.carried.get(bones.join());
    if (!list) {
      const out: number[] = [];
      for (let v = 0; v < m.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (ids.has(m.skin[v * 4 + k]!)) w += m.weight[v * 4 + k]! / 255;
        if (w >= 0.5) out.push(v);
      }
      list = Int32Array.from(out);
      this.carried.set(bones.join(), list);
    }
    solveDual(this.skeleton, pose, this.dq);
    const low = new Float32Array(few).fill(Infinity);
    for (const v of list) {
      dualSkin(this.dq, m.skin, m.weight, v * 4, 1 / 255, m.pos[v * 3]!, m.pos[v * 3 + 1]!, m.pos[v * 3 + 2]!, 0, 1, 0, this.at, this.normal, SKIN_LINEAR);
      const y = this.at[1]!;
      if (y >= low[few - 1]!) continue;
      let i = few - 1;
      while (i > 0 && low[i - 1]! > y) {
        low[i] = low[i - 1]!;
        i--;
      }
      low[i] = y;
    }
    let sum = 0;
    for (let i = 0; i < few; i++) sum += low[i]!;
    return sum / few;
  }

  /** The hips moved up or down until the named bones' lowest part is `above` over the floor. Returns how far they moved. */
  settle(pose: Pose, bones: readonly string[], above = 0): number {
    const h = this.hips;
    const before = pose.t[h * 3 + 1]!;
    for (let i = 0; i < 3; i++) pose.t[h * 3 + 1] = pose.t[h * 3 + 1]! + (above - this.lowest(pose, bones));
    return pose.t[h * 3 + 1]! - before;
  }

  /** The angles of the back, the neck and the tail as the pose has them (the same pieces and the same meaning as in a `Spec`). */
  anglesOf(pose: Pose): { back: [number, number]; neck: [number, number, number, number]; tail: [number, number, number, number] } {
    const angle = (a: string, c: string): number => {
      const A = this.where(pose, a);
      const C = this.where(pose, c);
      return Math.atan2(C[1] - A[1], C[0] - A[0]);
    };
    return {
      back: [angle("spine1", "spine2"), angle("spine2", "chest")],
      neck: [angle("chest", "neck1"), angle("neck1", "neck2"), angle("neck2", "head"), angle("head", "headend")],
      tail: [angle("tail", "tailstart"), angle("tailstart", "tail1"), angle("tail1", "tail2"), angle("tail2", "tail3")],
    };
  }

  /** How far the hips are turned about the cat's z axis from their rest (positive: the front up), the number `hips.pitch` of a spec says. */
  pitchOf(pose: Pose): number {
    const h = this.hips;
    const R0 = new Float64Array(this.skeleton.count * 9);
    const T0 = new Float64Array(this.skeleton.count * 3);
    globals(this.skeleton, this.rest, undefined, R0, T0);
    globals(this.skeleton, pose, undefined, R, T);
    // (the turn that takes the rest's hips to the pose's, in the cat's own axes: R * R0^T; where it takes the way the cat faces)
    const x = R[h * 9]! * R0[h * 9]! + R[h * 9 + 1]! * R0[h * 9 + 1]! + R[h * 9 + 2]! * R0[h * 9 + 2]!;
    const y = R[h * 9 + 3]! * R0[h * 9]! + R[h * 9 + 4]! * R0[h * 9 + 1]! + R[h * 9 + 5]! * R0[h * 9 + 2]!;
    return Math.atan2(y, x);
  }

  /** A paw put where it stands at rest, moved by `dx` forward and `dz` across (body lengths). */
  planted(paw: PawName, dx = 0, dz = 0, lift = 0): PawAim {
    const p = this.padAtRest(paw).at;
    return { at: [p[0] + dx, p[1] + lift, p[2] + dz] };
  }

  /**
   * A pose that the spec tells: the hips, the bends of the back, the neck and the tail (seen from the side, as angles above the way the cat faces), lateral bends and rolls of named
   * bones, the hips settled on the floor by the torso, and the paws reached to their places. `prev` (the pose of the frame before) is where the legs start their search, so that a leg
   * that moves does it by small steps and does not jump to another bend of the knee.
   */
  make(spec: Spec, prev?: Pose, base?: Pose, grounded = base === undefined): Pose {
    const pose = this.pose();
    if (base) pose.copy(base);
    const h = spec.hips;
    if (h) this.hipsAt(pose, { ...(h.x !== undefined ? { x: h.x } : {}), y: h.y, ...(h.z !== undefined ? { z: h.z } : {}) }, { pitch: h.pitch ?? 0, yaw: h.yaw ?? 0, roll: h.roll ?? 0 });
    if (spec.back) {
      this.aim(pose, "spine1", "spine2", spec.back[0]);
      this.aim(pose, "spine2", "chest", spec.back[1]);
    }
    if (spec.neck) {
      this.aim(pose, "chest", "neck1", spec.neck[0]);
      this.aim(pose, "neck1", "neck2", spec.neck[1]);
      this.aim(pose, "neck2", "head", spec.neck[2]);
      this.aim(pose, "head", "headend", spec.neck[3]);
    }
    // (the bends about the cat's vertical and long axes: the tail's come after its pieces are aimed, for an aim is a turn in the side view and a tail that is already turned aside is not one)
    const aside = (bone: string): boolean => bone.startsWith("tail");
    for (const [bone, a] of Object.entries(spec.yaw ?? {})) if (a && !aside(bone)) this.turn(pose, bone, { yaw: a });
    for (const [bone, a] of Object.entries(spec.roll ?? {})) if (a && !aside(bone)) this.turn(pose, bone, { roll: a });
    if (spec.settle !== undefined) this.settle(pose, TORSO, spec.settle);
    if (spec.tail) {
      const pieces: Array<[string, string]> = [["tail", "tailstart"], ["tailstart", "tail1"], ["tail1", "tail2"], ["tail2", "tail3"]];
      pieces.forEach(([a, b], i) => {
        this.aim(pose, a, b, spec.tail![i]!);
        const floor = spec.tailFloor;
        if (floor === undefined) return;
        const A = this.where(pose, a);
        const B = this.where(pose, b);
        if (B[1] < floor) {
          // (as steeply as the floor lets this piece go: the angle from the way the piece points, kept on the side it was on)
          const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
          const target = Math.asin(Math.max(-1, Math.min(1, (floor - A[1]) / len)));
          this.aim(pose, a, b, B[0] - A[0] < 0 ? Math.PI - target : target);
        }
      });
    }
    for (const [bone, a] of Object.entries(spec.yaw ?? {})) if (a && aside(bone)) this.turn(pose, bone, { yaw: a });
    for (const [bone, a] of Object.entries(spec.roll ?? {})) if (a && aside(bone)) this.turn(pose, bone, { roll: a });
    if (prev) {
      for (const name of Object.keys(this.legs) as PawName[]) for (const b of this.legs[name]!) {
        const j = this.skeleton.bone(b);
        for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = prev.r[j * 4 + k]!;
      }
    }
    const putPaws = (): void => {
      for (const [name, aim] of Object.entries(spec.paws ?? {}) as Array<[PawName, PawAim]>) {
        this.reach(pose, name, aim.at, { ...(aim.tip !== undefined ? { tip: aim.tip } : {}), ...(aim.toe !== undefined ? { toe: aim.toe } : {}), ...(aim.hold !== undefined ? { hold: aim.hold } : {}), ...(aim.elbow ? { elbow: aim.elbow, elbowWeight: (aim.elbowWeight ?? 0.15) * ELBOW_PULL } : {}), ...(aim.soft ? { soft: aim.soft } : {}), ...(spec.solid ? { solid: spec.solid } : {}), ...(spec.range ? { range: spec.range } : {}), ...(spec.cap ? { cap: (name.startsWith("front") ? spec.cap.front : spec.cap.hind) ?? 0 } : {}) });
      }
    };
    putPaws();
    if (grounded) {
      // (a cat that is on the floor is not through it: whatever is lowest but the tail, once the legs are in, is brought up to the floor, and the legs are put again from there)
      // (the mean of the lowest few is what must be on the floor, so that one tuft does not decide; but no single point of the coat is let by more than `POKE` through it)
      for (let pass = 0; pass < 3; pass++) {
        const low = this.lowest(pose, this.nonTail);
        const lowest = this.lowest(pose, this.nonTail, 1);
        if (low > -0.004 && lowest > -POKE) break;
        pose.t[this.hips * 3 + 1] = pose.t[this.hips * 3 + 1]! + Math.max(-low, -POKE * 0.7 - lowest);
        putPaws();
      }
    }
    if (h?.spin) this.spinBy(pose, h.spin);
    return pose;
  }

  /** The whole cat turned about the vertical through the origin (the hips' place and turn: the bones below them go with them). */
  private spinBy(pose: Pose, angle: number): void {
    const h = this.hips;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = pose.t[h * 3]!;
    const z = pose.t[h * 3 + 2]!;
    pose.t[h * 3] = x * c + z * s;
    pose.t[h * 3 + 2] = -x * s + z * c;
    const q = after([pose.r[h * 4]!, pose.r[h * 4 + 1]!, pose.r[h * 4 + 2]!, pose.r[h * 4 + 3]!], turnAbout(0, 1, 0, angle));
    for (let k = 0; k < 4; k++) pose.r[h * 4 + k] = q[k]!;
  }

  /** Where the middle of a paw's sole is in the pose (the cat's space). */
  padOf(pose: Pose, paw: PawName): Vec3 {
    const k = PAWS.findIndex((p) => p.name === paw);
    const j = this.skeleton.bone(this.legs[paw]![this.legs[paw]!.length - 1]!);
    globals(this.skeleton, pose, undefined, R, T);
    const l = this.padLocal[k]!;
    return [T[j * 3]! + R[j * 9]! * l[0] + R[j * 9 + 1]! * l[1] + R[j * 9 + 2]! * l[2], T[j * 3 + 1]! + R[j * 9 + 3]! * l[0] + R[j * 9 + 4]! * l[1] + R[j * 9 + 5]! * l[2], T[j * 3 + 2]! + R[j * 9 + 6]! * l[0] + R[j * 9 + 7]! * l[1] + R[j * 9 + 8]! * l[2]];
  }

  /** Where a bone's joint is in the pose (the cat's space). */
  where(pose: Pose, bone: string): Vec3 {
    const j = this.skeleton.bone(bone);
    globals(this.skeleton, pose, undefined, R, T);
    return [T[j * 3]!, T[j * 3 + 1]!, T[j * 3 + 2]!];
  }
}

/** Poses, frame after frame, as a clip's source. */
export class Recorder {
  private readonly r: Float64Array[];
  private readonly t: Float64Array;
  private count = 0;

  constructor(
    private readonly skeleton: Skeleton,
    readonly frames: number,
  ) {
    this.r = Array.from({ length: skeleton.count }, () => new Float64Array(frames * 4));
    this.t = new Float64Array(frames * 3);
  }

  /** Writes frame `f` (the turn of every bone, and the hips' place). */
  put(f: number, pose: Pose): void {
    const hips = this.skeleton.bone("Hips");
    for (let j = 0; j < this.skeleton.count; j++) for (let k = 0; k < 4; k++) this.r[j]![f * 4 + k] = pose.r[j * 4 + k]!;
    for (let k = 0; k < 3; k++) this.t[f * 3 + k] = pose.t[hips * 3 + k]!;
    this.count++;
  }

  source(name: string, fps: number, loop: boolean, marks: Record<string, number> = {}): ClipSource {
    if (this.count < this.frames) throw new Error(`${name}: ${this.count} of ${this.frames} frames were written`);
    const t = new Array<Float64Array | null>(this.skeleton.count).fill(null);
    t[this.skeleton.bone("Hips")] = this.t;
    return { name, fps, frames: this.frames, loop, stride: 0, marks, r: this.r.slice(), t };
  }
}
