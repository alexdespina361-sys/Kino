// Poses made by constraints, not by hand-keyed curves. A posture is told as a few things that can be said of a cat (how high and how tilted the hips are, how the back, the neck and the
// tail bend, where each paw is to be), and what turns the bones need is found here: the bends are turns about the cat's own axes, the paws are put by a few steps of least squares
// (ik.mts), and the whole is put on the floor by the lowest part of the mesh (floor.mts). A clip is such a posture asked for at each of its frames, so that what moves (a paw that
// presses, a head that dips) is a formula of time and what holds still is held by the floor and the paws.
import { Pose, Skeleton, after, globals, solve, turnAbout, type Clip } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { PAWS, restPads, soleVertices } from "./gait.mts";
import { reachChain, type Limit, type Marker, type Prior, type Vec3 } from "./ik.mts";
import { learnPriors } from "./prior.mts";
import { quatOfMatrix, type Quat } from "./retarget.mts";

export type PawName = (typeof PAWS)[number]["name"];

/** The bones of each leg, from the hip (or the shoulder) down to the paw. */
const LEGS: Record<PawName, readonly string[]> = {
  "hind left": ["backleg", "backleg0", "backleg1", "backleg2"],
  "hind right": ["R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"],
  "front left": ["frontleg", "frontleg0", "frontleg1", "frontleg2"],
  "front right": ["R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"],
};

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
/**
 * How far the joints of a leg may close (degrees), the elbow (the knee) and the wrist (the hock): measured on the mesh, the skin holds while the elbow stays over about 50 degrees
 * (stretch99 under 1.6) and folds in on itself under it (31 degrees: 2.5, a tenth of the faces turned over).
 */
const CLOSE = { front: [55, 60], hind: [60, 25] } as const;

/** Where a paw's sole is to be, and how the paw is held: tipped about the cat's z axis (toes up positive), turned about the vertical, how much it is kept to the pose it had, and where its elbow (or knee) is to be. */
export interface PawAim {
  at: Vec3;
  tip?: number;
  toe?: number;
  hold?: number;
  elbow?: Vec3;
  /** How much each way (along, up, across) counts: a paw that is only to be about there along the floor (and on it) gives along a little, and the leg finds the place it can be at. */
  soft?: Vec3;
}

/**
 * A posture in a few numbers (angles in radians, places in body lengths). `back` has the angle of the two pieces of the spine, `neck` of the neck's two pieces, the head from its
 * joint to its snout (the way the nose points), and the tail's four pieces, each seen from the side as the angle above the way the cat faces: a back that runs level is 0 (the cat's own
 * is about -0.2 at rest), a tail that lies out behind is 3.14.
 */
export interface Spec {
  /** Left out, the hips are as the pose the spec is laid on (`make`'s `base`) has them. */
  hips?: { x?: number; y: number; pitch?: number; yaw?: number; roll?: number };
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
  paws?: Partial<Record<PawName, PawAim>>;
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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
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
  private readonly skinning: Float32Array;
  /** Every bone but the tail's (what a cat on the floor must not put through it). */
  private readonly nonTail: readonly string[];
  /** How the legs' bones turn in the clips the body has learned from (`learn`), by bone. */
  private priors = new Map<number, Prior>();

  constructor(
    readonly mesh: CatMesh,
    readonly skeleton: Skeleton,
  ) {
    this.hips = skeleton.bone("Hips");
    this.skinning = new Float32Array(skeleton.count * 12);
    this.nonTail = skeleton.names.filter((n) => !n.startsWith("tail"));
    this.rest = new Pose(skeleton);
    const soles = soleVertices(mesh, skeleton);
    this.pads = restPads(mesh, skeleton, soles);
    globals(skeleton, this.rest, undefined, R, T);
    this.padLocal = [];
    this.jointOff = [];
    PAWS.forEach((p, i) => {
      const paw = skeleton.bone(LEGS[p.name]![3]!);
      const pad = this.pads[i]!;
      const d = [pad[0] - T[paw * 3]!, pad[1] - T[paw * 3 + 1]!, pad[2] - T[paw * 3 + 2]!];
      this.padLocal.push([0, 1, 2].map((c) => R[paw * 9 + c]! * d[0]! + R[paw * 9 + 3 + c]! * d[1]! + R[paw * 9 + 6 + c]! * d[2]!) as Vec3);
      this.jointOff.push([T[paw * 3]! - pad[0], T[paw * 3 + 1]! - pad[1], T[paw * 3 + 2]! - pad[2]]);
    });
  }

  /** Learns how the legs' bones turn from clips of animals that move (the first three bones of each leg: the paw's own is left free), so that a leg is only reached by turns such a leg makes. */
  learn(clips: Iterable<Clip>): void {
    this.priors = learnPriors(this.skeleton, clips, (Object.values(LEGS) as string[][]).flatMap((leg) => leg.slice(0, 3)));
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
    const j = this.skeleton.bone(bone);
    let w: Quat = [0, 0, 0, 1];
    if (b.roll) w = after(w, turnAbout(1, 0, 0, b.roll)) as Quat;
    if (b.yaw) w = after(w, turnAbout(0, 1, 0, b.yaw)) as Quat;
    if (b.pitch) w = after(w, turnAbout(0, 0, 1, b.pitch)) as Quat;
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
  reach(pose: Pose, paw: PawName, pad: Vec3, o: { tip?: number; toe?: number; hold?: number; elbow?: Vec3; elbowWeight?: number; soft?: Vec3 } = {}): number {
    const k = PAWS.findIndex((p) => p.name === paw);
    const chain = LEGS[paw]!.map((b) => this.skeleton.bone(b));
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
    const markers: Marker[] = [
      { bone: chain[3]!, local: this.padLocal[k]!, aim: pad, weight: 1, ...(axes ? { axes } : {}) },
      { bone: chain[3]!, local: [0, 0, 0], aim: [pad[0] + jx, pad[1] + ty, pad[2] + jz], weight: 1, ...(axes ? { axes } : {}) },
    ];
    if (o.elbow) markers.push({ bone: chain[1]!, local: [0, 0, 0], aim: o.elbow, weight: o.elbowWeight ?? 0.15 });
    const hold = o.hold ?? 0.004;
    // (the joints do not close past where the skin folds in on itself)
    const close = (paw.startsWith("front") ? CLOSE.front : CLOSE.hind).map((d) => (d * Math.PI) / 180);
    const limits: Limit[] = [
      { bone: chain[1]!, min: close[0]!, weight: 4 },
      { bone: chain[2]!, min: close[1]!, weight: 4 },
    ];
    const priors = chain.slice(0, 3).flatMap((j) => this.priors.get(j) ?? []);
    let miss = reachChain(this.skeleton, pose, chain, markers, hold, 30, limits, priors).miss[0]!;
    // (a leg that is folded may have a piece of itself through the floor: each point of it that is told to stay above the floor, and the leg is solved again)
    const contacts: Marker[] = [];
    for (let round = 0; round < 3; round++) {
      const low = this.under(pose, LEGS[paw]!, UNDER, 24);
      if (low.length === 0) break;
      for (const l of low) contacts.push({ bone: l.bone, local: l.local, aim: [0, l.rigid + (UNDER - l.y), 0], floor: true, weight: 2 });
      miss = reachChain(this.skeleton, pose, chain, [...markers, ...contacts], hold, 30, limits, priors).miss[0]!;
    }
    return miss;
  }

  /**
   * The vertices that the named bones carry (a half or more of the weight, between them) that the pose has lower than `floor`, the lowest `few` of them: each with the bone of the set
   * that carries it most, where it is in that bone's own axes (to put a marker on it), how high it is, and how high the bone's own turn would have it (the vertex as if it were all that
   * bone's).
   */
  under(pose: Pose, bones: readonly string[], floor: number, few = 16): Array<{ bone: number; local: Vec3; y: number; rigid: number }> {
    const ids = bones.map((b) => this.skeleton.bone(b));
    const m = this.mesh;
    solve(this.skeleton, pose, IDENTITY, this.skinning);
    const found: Array<{ v: number; y: number; bone: number }> = [];
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
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const wk = m.weight[v * 4 + k]! / 255;
        if (wk <= 0) continue;
        const o = m.skin[v * 4 + k]! * 12;
        y += wk * (this.skinning[o + 4]! * px + this.skinning[o + 5]! * py + this.skinning[o + 6]! * pz + this.skinning[o + 7]!);
      }
      if (y < floor) found.push({ v, y, bone });
    }
    found.sort((a, b) => a.y - b.y);
    globals(this.skeleton, pose, undefined, R, T);
    const bind = this.skeleton.bind;
    return found.slice(0, few).map(({ v, y, bone }) => {
      const px = m.pos[v * 3]!;
      const py = m.pos[v * 3 + 1]!;
      const pz = m.pos[v * 3 + 2]!;
      const l: Vec3 = [0, 1, 2].map((r) => bind[bone * 12 + r * 4]! * px + bind[bone * 12 + r * 4 + 1]! * py + bind[bone * 12 + r * 4 + 2]! * pz + bind[bone * 12 + r * 4 + 3]!) as Vec3;
      const rigid = T[bone * 3 + 1]! + R[bone * 9 + 3]! * l[0] + R[bone * 9 + 4]! * l[1] + R[bone * 9 + 5]! * l[2];
      return { bone, local: l, y, rigid };
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
    solve(this.skeleton, pose, IDENTITY, this.skinning);
    const low = new Float32Array(few).fill(Infinity);
    for (const v of list) {
      const px = m.pos[v * 3]!;
      const py = m.pos[v * 3 + 1]!;
      const pz = m.pos[v * 3 + 2]!;
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const w = m.weight[v * 4 + k]! / 255;
        if (w <= 0) continue;
        const o = m.skin[v * 4 + k]! * 12;
        y += w * (this.skinning[o + 4]! * px + this.skinning[o + 5]! * py + this.skinning[o + 6]! * pz + this.skinning[o + 7]!);
      }
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
    if (h) this.hipsAt(pose, { ...(h.x !== undefined ? { x: h.x } : {}), y: h.y }, { pitch: h.pitch ?? 0, yaw: h.yaw ?? 0, roll: h.roll ?? 0 });
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
      for (const name of Object.keys(LEGS) as PawName[]) for (const b of LEGS[name]!) {
        const j = this.skeleton.bone(b);
        for (let k = 0; k < 4; k++) pose.r[j * 4 + k] = prev.r[j * 4 + k]!;
      }
    }
    const putPaws = (): void => {
      for (const [name, aim] of Object.entries(spec.paws ?? {}) as Array<[PawName, PawAim]>) {
        this.reach(pose, name, aim.at, { ...(aim.tip !== undefined ? { tip: aim.tip } : {}), ...(aim.toe !== undefined ? { toe: aim.toe } : {}), ...(aim.hold !== undefined ? { hold: aim.hold } : {}), ...(aim.elbow ? { elbow: aim.elbow } : {}), ...(aim.soft ? { soft: aim.soft } : {}) });
      }
    };
    putPaws();
    if (grounded) {
      // (a cat that is on the floor is not through it: whatever is lowest but the tail, once the legs are in, is brought up to the floor, and the legs are put again from there)
      for (let pass = 0; pass < 2; pass++) {
        const low = this.lowest(pose, this.nonTail);
        if (low > -0.004) break;
        pose.t[this.hips * 3 + 1] = pose.t[this.hips * 3 + 1]! - low;
        putPaws();
      }
    }
    return pose;
  }

  /** Where the middle of a paw's sole is in the pose (the cat's space). */
  padOf(pose: Pose, paw: PawName): Vec3 {
    const k = PAWS.findIndex((p) => p.name === paw);
    const j = this.skeleton.bone(LEGS[paw]![3]!);
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
