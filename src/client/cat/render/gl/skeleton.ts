import { clamp, lerp } from "../../math";
import type { CatFrame } from "../../types";
import { CatRig, type Joint, type Leg, type Solved } from "../rig";
import { stamp } from "./format";
import { EARS, JAW_HINGE } from "./model";

/**
 * The bones of the solid cat, and how the numbers the rig works out each frame (a Solved: joints in the side view) move them.
 *
 * The mesh is made once, in the posture of a standing cat, around the very joints the rig has for that posture (the REST below); a bone is the way
 * from where a part of that mesh stood to where the rig now has it. The legs and the tail are chains of rigid pieces. The body is not: the rig gives
 * the line of the back and the line of the belly, and the body is stretched between them in five stations (each station is the pair of points
 * where the back and the belly are, so a cat that sits, curls or stretches is the body the rig drew, thick or thin where the rig made it so).
 * The head turns about the vertical, which the side view had no way of showing.
 */

export const BONE = {
  f0: 0,
  f1: 1,
  f2: 2,
  f3: 3,
  f4: 4,
  neck: 5,
  head: 6,
  earL: 7,
  earR: 8,
  jaw: 9,
  fnU: 10,
  fnL: 11,
  fnP: 12,
  ffU: 13,
  ffL: 14,
  ffP: 15,
  hnU: 16,
  hnL: 17,
  hnP: 18,
  hfU: 19,
  hfL: 20,
  hfP: 21,
  tail0: 22,
} as const;
export const TAIL_BONES = 10;
/** How far out of the middle of the cat (toward the viewer) a tail that is wrapped round it lies, in body lengths. */
const TAIL_AROUND = 0.15;
export const BONE_COUNT = BONE.tail0 + TAIL_BONES;
/** Numbers in a bone: a 3 x 4 matrix, row after row. */
export const BONE_FLOATS = 12;

/** What the face is told besides the bones: read by the shader, not by the skin. */
export interface FaceState {
  openL: number;
  openR: number;
  pupil: number;
  gazeX: number;
  gazeY: number;
  happy: number;
  asleep: number;
  jaw: number;
}

type Mat = Float64Array;
const mat = (): Mat => {
  const m = new Float64Array(12);
  m[0] = m[5] = m[10] = 1;
  return m;
};
const setIdentity = (m: Mat): void => {
  m.fill(0);
  m[0] = m[5] = m[10] = 1;
};
const scratch = new Float64Array(12);
/** out = a after b (b is applied first). */
export function mul(out: Mat, a: Mat, b: Mat): Mat {
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4]!;
    const a1 = a[r * 4 + 1]!;
    const a2 = a[r * 4 + 2]!;
    for (let c = 0; c < 3; c++) scratch[r * 4 + c] = a0 * b[c]! + a1 * b[4 + c]! + a2 * b[8 + c]!;
    scratch[r * 4 + 3] = a0 * b[3]! + a1 * b[7]! + a2 * b[11]! + a[r * 4 + 3]!;
  }
  out.set(scratch);
  return out;
}

/** A change made of a 2 x 2 matrix on the side view's plane, a scale across it, and a shift. */
function plane(out: Mat, a: number, b: number, c: number, d: number, tx: number, ty: number, sz = 1): Mat {
  out.fill(0);
  out[0] = a;
  out[1] = b;
  out[4] = c;
  out[5] = d;
  out[10] = sz;
  out[3] = tx;
  out[7] = ty;
  return out;
}

/**
 * The rest of a segment a-b taken to where the segment p-q is now: a turn and a shift, and (if asked) a stretch along its length. A segment that is
 * not stretched is rigid, and one whose length the rig changes ends where it ends: `byEnd` has it land on q (the toe, which has to be on the floor)
 * and leave the other end to the skin around it. A segment the rig has shrunk to nothing (a paw held up, with no foot to speak of) has no direction of
 * its own: it turns as `without` says (the piece before it, so the paw hangs from the leg as it did).
 */
function segment(out: Mat, a: Joint, b: Joint, p: Joint, q: Joint, stretch: boolean, byEnd = false, without = 0): Mat {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const px = q.x - p.x;
  const py = q.y - p.y;
  const rl = Math.hypot(rx, ry) || 1;
  const pl = Math.hypot(px, py) || 1;
  const theta = Math.hypot(px, py) < 0.3 * rl ? without : Math.atan2(py, px) - Math.atan2(ry, rx);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  let m00 = c;
  let m01 = -s;
  let m10 = s;
  let m11 = c;
  let sz = 1;
  if (stretch) {
    // along the piece it is stretched, across it it gives (a stretched neck is a thinner one, but not as much as that)
    const along = clamp(pl / rl, 0.55, 1.8);
    const across = Math.pow(along, -0.45);
    sz = across;
    const k = along - across;
    const ux = rx / rl;
    const uy = ry / rl;
    // (across I + k u u^T), then the turn
    const e00 = across + k * ux * ux;
    const e01 = k * ux * uy;
    const e11 = across + k * uy * uy;
    m00 = c * e00 - s * e01;
    m01 = c * e01 - s * e11;
    m10 = s * e00 + c * e01;
    m11 = s * e01 + c * e11;
  }
  return byEnd
    ? plane(out, m00, m01, m10, m11, q.x - (m00 * b.x + m01 * b.y), q.y - (m10 * b.x + m11 * b.y), sz)
    : plane(out, m00, m01, m10, m11, p.x - (m00 * a.x + m01 * a.y), p.y - (m10 * a.x + m11 * a.y), sz);
}

/** The rest of a station (the back and the belly, two points) taken to where the station is now: turned and thickened as the pair is. */
function station(out: Mat, rt: Joint, rb: Joint, pt: Joint, pb: Joint): Mat {
  const rux = rt.x - rb.x;
  const ruy = rt.y - rb.y;
  const pux = pt.x - pb.x;
  const puy = pt.y - pb.y;
  const rl = Math.hypot(rux, ruy) || 1;
  const pl = Math.hypot(pux, puy) || 1;
  const k = clamp(pl / rl, 0.4, 2.4);
  // rest axes: up (u) and forward (f = u turned a quarter, so that f is +x when up is +y)
  const ru = [rux / rl, ruy / rl] as const;
  const rf = [ru[1], -ru[0]] as const;
  const pu = [pux / pl, puy / pl] as const;
  const pf = [pu[1], -pu[0]] as const;
  // A = [pf pu] diag(1, k) [rf ru]^T
  const m00 = pf[0] * rf[0] + pu[0] * k * ru[0];
  const m01 = pf[0] * rf[1] + pu[0] * k * ru[1];
  const m10 = pf[1] * rf[0] + pu[1] * k * ru[0];
  const m11 = pf[1] * rf[1] + pu[1] * k * ru[1];
  const cx = (rt.x + rb.x) / 2;
  const cy = (rt.y + rb.y) / 2;
  const qx = (pt.x + pb.x) / 2;
  const qy = (pt.y + pb.y) / 2;
  return plane(out, m00, m01, m10, m11, qx - (m00 * cx + m01 * cy), qy - (m10 * cx + m11 * cy), clamp(1 + (k - 1) * 0.55, 0.7, 1.7));
}

/** A turn about the vertical line through x = cx (and z = 0). */
function yaw(out: Mat, angle: number, cx: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.fill(0);
  out[0] = c;
  out[2] = s;
  out[3] = cx - c * cx;
  out[5] = 1;
  out[8] = -s;
  out[10] = c;
  out[11] = s * cx;
  return out;
}

/** A turn about the line along x through (y, z) = (py, pz): the way an ear leans. */
function lean(out: Mat, angle: number, py: number, pz: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.fill(0);
  out[0] = 1;
  out[5] = c;
  out[6] = -s;
  out[7] = py - (c * py - s * pz);
  out[9] = s;
  out[10] = c;
  out[11] = pz - (s * py + c * pz);
  return out;
}

const copyJoint = (j: Joint): Joint => ({ x: j.x, y: j.y });
const copyLeg = (l: Leg): Leg => ({ root: copyJoint(l.root), mid: copyJoint(l.mid), hock: copyJoint(l.hock), toe: copyJoint(l.toe), front: l.front, lift: 0 });

/** The cat's rest: the standing posture the mesh is made around, as the rig has it. */
export function restSolved(): Solved {
  const rig = new CatRig(1);
  const frame: CatFrame = { x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false };
  rig.snapTo(frame, 100);
  const s = rig.solved;
  const snap = (j: Joint): Joint => ({ x: Math.round(j.x * 1e4) / 1e4, y: Math.round(j.y * 1e4) / 1e4 });
  return {
    ...s,
    legs: { fn: copyLeg(s.legs.fn), ff: copyLeg(s.legs.ff), hn: copyLeg(s.legs.hn), hf: copyLeg(s.legs.hf) },
    tail: s.tail.map(snap),
    head: { ...s.head, x: snap(s.head).x, y: snap(s.head).y },
    pose: { p: Object.fromEntries(Object.entries(s.pose.p).map(([k, v]) => [k, snap(v)])) as Solved["pose"]["p"], s: { ...s.pose.s } },
  };
}

/** A number made of the rest's joints: the mesh carries the one it was made around, and is not worn on bones that were made around another. */
export function restStamp(rest: Solved = restSolved()): number {
  return stamp([
    ...Object.values(rest.pose.p).flatMap((j) => [j.x, j.y]),
    ...(["fn", "ff", "hn", "hf"] as const).flatMap((k) => [rest.legs[k].root, rest.legs[k].mid, rest.legs[k].hock, rest.legs[k].toe].flatMap((j) => [j.x, j.y])),
    ...rest.tail.flatMap((j) => [j.x, j.y]),
    rest.head.x,
    rest.head.y,
  ]);
}

/** The five stations of the body: where the back and the belly are at each, as points of the rig's pose (y is down there). */
function stations(p: Solved["pose"]["p"], out: Array<[Joint, Joint]>): void {
  const lerpJ = (a: Joint, b: Joint, t: number): Joint => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  out[0] = [p.rumpTop, p.rumpBottom];
  out[1] = [lerpJ(p.rumpTop, p.backMid, 0.45), p.groin];
  out[2] = [p.backMid, p.bellyMid];
  out[3] = [p.shoulderTop, lerpJ(p.bellyMid, p.chestBottom, 0.6)];
  out[4] = [p.neckTop, p.chestFront];
}

/** The rig's numbers are in a view where up is negative; the mesh and the bones are in a world where up is positive. */
const up = (j: Joint): Joint => ({ x: j.x, y: -j.y });
const upLeg = (l: Leg): Leg => ({ root: up(l.root), mid: up(l.mid), hock: up(l.hock), toe: up(l.toe), front: l.front, lift: l.lift });

/** Where the head's centre (the point the mesh's head turns about) is in the rest, and the ear and neck pivots the model is made with. */
export interface RestFrame {
  head: Joint;
  /** The two ends of the neck's bone: the centre of the last station, and the head. */
  neckBase: Joint;
}

export class Skeleton {
  readonly rest: Solved;
  /** The rest, in the world where up is positive. */
  readonly restUp: { head: Joint; tail: Joint[]; legs: Record<"fn" | "ff" | "hn" | "hf", Leg>; stations: Array<[Joint, Joint]> };
  private readonly tmp = mat();
  private readonly tmp2 = mat();
  private readonly tmp3 = mat();
  private readonly st: Array<[Joint, Joint]> = [];

  constructor(rest: Solved = restSolved()) {
    this.rest = rest;
    const restStations: Array<[Joint, Joint]> = [];
    stations(rest.pose.p, restStations);
    this.restUp = {
      head: up(rest.head),
      tail: rest.tail.map(up),
      legs: { fn: upLeg(rest.legs.fn), ff: upLeg(rest.legs.ff), hn: upLeg(rest.legs.hn), hf: upLeg(rest.legs.hf) },
      stations: restStations.map(([a, b]) => [up(a), up(b)]),
    };
  }

  /**
   * The bone matrices for a solved cat. `headYaw` is how far the head is turned about the vertical against the body (radians, the face turned toward the
   * viewer is negative for a cat that faces right); the ears lean by their own angles; the whole is then put through `world` (the body's turn, its squash
   * and its tilt) so that the shader has only one thing to do with a bone.
   */
  solve(s: Solved, headYaw: number, world: Mat, out: Float32Array): void {
    const R = this.restUp;
    const m = this.tmp;
    const bone = (i: number, source: Mat): void => {
      mul(this.tmp3, world, source);
      for (let k = 0; k < 12; k++) out[i * 12 + k] = this.tmp3[k]!;
    };

    // --- the body: five stations
    stations(s.pose.p, this.st);
    for (let i = 0; i < 5; i++) {
      const rest = R.stations[i]!;
      const now = this.st[i]!;
      station(m, rest[0], rest[1], up(now[0]), up(now[1]));
      bone(BONE.f0 + i, m);
    }

    // --- the neck and the head: the neck runs from the middle of the last station to the head's centre
    const restTop = R.stations[4]!;
    const restBase = { x: (restTop[0].x + restTop[1].x) / 2, y: (restTop[0].y + restTop[1].y) / 2 };
    const nowTop = this.st[4]!;
    const nowBase = { x: (nowTop[0].x + nowTop[1].x) / 2, y: -(nowTop[0].y + nowTop[1].y) / 2 };
    const headNow = { x: s.head.x, y: -s.head.y };
    segment(m, restBase, R.head, nowBase, headNow, true);
    yaw(this.tmp2, headYaw * 0.35, R.head.x);
    mul(this.tmp3, m, this.tmp2);
    mul(this.tmp3, world, this.tmp3);
    for (let k = 0; k < 12; k++) out[BONE.neck * 12 + k] = this.tmp3[k]!;

    // the head: a turn about its own centre in the plane (the tilt; the rig's y is down, so its angle is turned over), then the turn about the vertical
    const roll = -s.head.rot;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    plane(m, cr, -sr, sr, cr, headNow.x - (cr * R.head.x - sr * R.head.y), headNow.y - (sr * R.head.x + cr * R.head.y));
    yaw(this.tmp2, headYaw, R.head.x);
    mul(m, m, this.tmp2);
    this.head.set(m);
    mul(this.tmp3, world, m);
    for (let k = 0; k < 12; k++) out[BONE.head * 12 + k] = this.tmp3[k]!;

    // the ears: the head's, and a lean about the ear's base (the rig's angle is how far the ear is laid out from upright)
    lean(this.tmp2, -clamp(s.head.earL, -0.5, 1.2) * 0.9, EARS[0].base[1], EARS[0].base[2]);
    mul(this.tmp3, this.head, this.tmp2);
    bone(BONE.earL, this.tmp3);
    lean(this.tmp2, clamp(s.head.earR, -0.5, 1.2) * 0.9, EARS[1].base[1], EARS[1].base[2]);
    mul(this.tmp3, this.head, this.tmp2);
    bone(BONE.earR, this.tmp3);

    // the jaw: a turn about the hinge (a line along z through it): the chin drops, the mouth opens (a yawn is wide: about 45 degrees)
    const open = clamp(s.head.jaw, 0, 1) * 0.8;
    const cj = Math.cos(open);
    const sj = Math.sin(open);
    this.tmp2.fill(0);
    this.tmp2[0] = cj;
    this.tmp2[1] = sj;
    this.tmp2[4] = -sj;
    this.tmp2[5] = cj;
    this.tmp2[10] = 1;
    this.tmp2[3] = JAW_HINGE[0] - (cj * JAW_HINGE[0] + sj * JAW_HINGE[1]);
    this.tmp2[7] = JAW_HINGE[1] - (-sj * JAW_HINGE[0] + cj * JAW_HINGE[1]);
    mul(this.tmp3, this.head, this.tmp2);
    bone(BONE.jaw, this.tmp3);

    // --- the legs: three rigid pieces each (the rest of each piece to where the rig has it)
    const legs: Array<["fn" | "ff" | "hn" | "hf", number]> = [
      ["fn", BONE.fnU],
      ["ff", BONE.ffU],
      ["hn", BONE.hnU],
      ["hf", BONE.hfU],
    ];
    for (const [key, first] of legs) {
      const rest = R.legs[key];
      const now = upLeg(s.legs[key]);
      // a front paw held up (to the face, to point) comes out toward the viewer, so that it is seen against the face and not lost against the chest
      const held = key === "fn" ? clamp((now.toe.y - 0.25) / 0.3, 0, 1) : 0;
      segment(m, rest.root, rest.mid, now.root, now.mid, false);
      m[11] = (m[11] ?? 0) + held * 0.015;
      bone(first, m);
      segment(m, rest.mid, rest.hock, now.mid, now.hock, false);
      m[11] = (m[11] ?? 0) + held * 0.045;
      bone(first + 1, m);
      const restLower = Math.atan2(rest.hock.y - rest.mid.y, rest.hock.x - rest.mid.x);
      const lowerTurn = Math.atan2(now.hock.y - now.mid.y, now.hock.x - now.mid.x) - restLower;
      // (a paw that has no foot to speak of, held up, carries on from the forearm, bent a little toward the face)
      segment(m, rest.hock, rest.toe, now.hock, now.toe, false, true, lowerTurn + restLower + 0.2);
      m[11] = (m[11] ?? 0) + held * 0.07;
      bone(first + 2, m);
    }

    // --- the tail: ten pieces
    const around = clamp(s.pose.s.tailFront, 0, 1) * TAIL_AROUND;
    for (let i = 0; i < TAIL_BONES; i++) {
      // (a piece of the tail is as long as the rig makes it: it curls in a sit, and the pieces do not come apart)
      segment(m, R.tail[i]!, R.tail[i + 1]!, up(s.tail[i]!), up(s.tail[i + 1]!), true);
      // a tail that is wrapped round the cat lies on the near side of it: the further along, the further out from the middle
      m[11] = (m[11] ?? 0) + around * clamp((i - 0.5) / 2.5, 0, 1);
      bone(BONE.tail0 + i, m);
    }
  }

  private readonly head = mat();
}

export { mat, setIdentity, plane, yaw as yawMatrix };
