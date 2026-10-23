import { clamp } from "../../math";

/**
 * The solid cat's skeleton as its maker made it, and the clips that move it.
 *
 * A bone is a place on the cat (a joint) and a turn about it; the bones hang from one another (a paw from a leg, a leg from the hips), so a bone's turn carries everything
 * below it. The mesh is skinned to these bones as it was in the file the cat came from (the weights are that file's), so a pose here is the very pose the maker's own
 * program would show. A clip is the turn of each bone at each of its frames; what plays, and how fast, is decided elsewhere (the director), and what is added on top of
 * a clip (the head looking at something, the jaw, an ear) is added with `Adjust`, as a turn of the whole cat's own axes.
 *
 * Space: the cat's own, as the rest of the renderer has it (x forward, y up, z toward the viewer, body lengths). Matrices are 3 x 4, row after row.
 */

export interface SkeletonData {
  names: string[];
  /** The bone each one hangs from: always a lower number than its own, -1 for the root. */
  parent: number[];
  /** Where each bone's joint is against its parent's, and the turn it has there at rest (x y z w), three and four numbers a bone. */
  restT: number[];
  restR: number[];
}

/** A turn to add to a bone's own, about the cat's axes: the bone and a quaternion (x y z w). */
export interface Adjust {
  bone: number;
  q: readonly [number, number, number, number];
}

const MAX_BONES = 48;
const gR = new Float64Array(MAX_BONES * 9);
const gT = new Float64Array(MAX_BONES * 3);
const adjR = new Float64Array(9);
const skinM = new Float64Array(12);

/** A turn as the matrix that does it (row after row): `out` has nine numbers. */
export function matrixOf(out: Float64Array | number[], x: number, y: number, z: number, w: number, at = 0): void {
  out[at] = 1 - 2 * (y * y + z * z);
  out[at + 1] = 2 * (x * y - z * w);
  out[at + 2] = 2 * (x * z + y * w);
  out[at + 3] = 2 * (x * y + z * w);
  out[at + 4] = 1 - 2 * (x * x + z * z);
  out[at + 5] = 2 * (y * z - x * w);
  out[at + 6] = 2 * (x * z - y * w);
  out[at + 7] = 2 * (y * z + x * w);
  out[at + 8] = 1 - 2 * (x * x + y * y);
}

/** The turn about an axis (unit) by an angle, as a quaternion. */
export function turnAbout(ax: number, ay: number, az: number, angle: number): [number, number, number, number] {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

/** The turn `b` after the turn `a`. */
export function after(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): [number, number, number, number] {
  return [
    b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1],
    b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0],
    b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3],
    b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2],
  ];
}

export class Skeleton {
  readonly count: number;
  readonly names: string[];
  readonly parent: Int16Array;
  readonly restT: Float32Array;
  readonly restR: Float32Array;
  /** The inverse of each bone's rest matrix: what takes a point of the mesh as it was made to the bone's own space. */
  readonly bind: Float64Array;
  private readonly byName = new Map<string, number>();

  constructor(data: SkeletonData) {
    const n = data.names.length;
    if (n === 0 || n > MAX_BONES || data.parent.length !== n || data.restT.length !== n * 3 || data.restR.length !== n * 4) throw new Error("a skeleton that does not hold together");
    this.count = n;
    this.names = data.names.slice();
    this.parent = Int16Array.from(data.parent);
    this.restT = Float32Array.from(data.restT);
    this.restR = Float32Array.from(data.restR);
    for (let j = 0; j < n; j++) {
      const p = this.parent[j]!;
      if (p >= j || p < -1) throw new Error("a bone that hangs from one that comes after it");
      this.byName.set(this.names[j]!, j);
    }
    // the rest, bone by bone from the root, and then its inverse
    const R = new Float64Array(n * 9);
    const T = new Float64Array(n * 3);
    const rest = new Pose(this);
    globals(this, rest, undefined, R, T);
    this.bind = new Float64Array(n * 12);
    for (let j = 0; j < n; j++) {
      // inverse of [R | t] is [R^T | -R^T t]
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.bind[j * 12 + r * 4 + c] = R[j * 9 + c * 3 + r]!;
      for (let r = 0; r < 3; r++) this.bind[j * 12 + r * 4 + 3] = -(R[j * 9 + r]! * T[j * 3]! + R[j * 9 + 3 + r]! * T[j * 3 + 1]! + R[j * 9 + 6 + r]! * T[j * 3 + 2]!);
    }
  }

  /** The number of a bone by its name (throws for a name the skeleton does not have: the mesh and the clips must be made around the same bones). */
  bone(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`no bone ${name}`);
    return i;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}

/** What each bone is doing: its turn and (for the few that move away from their parent) its place against the parent's. */
export class Pose {
  readonly r: Float32Array;
  readonly t: Float32Array;

  constructor(readonly skeleton: Skeleton) {
    this.r = new Float32Array(skeleton.count * 4);
    this.t = new Float32Array(skeleton.count * 3);
    this.reset();
  }

  reset(): void {
    this.r.set(this.skeleton.restR);
    this.t.set(this.skeleton.restT);
  }

  copy(from: Pose): void {
    this.r.set(from.r);
    this.t.set(from.t);
  }
}

/**
 * A clip: the turn of every bone at each frame. A bone that never leaves its rest has no numbers (kind 0); one that holds still somewhere else has one set (kind 1);
 * the rest have a set for every frame (kind 2). A looping clip is `frames` frames long, the one after the last being the first; a clip that is played once is `frames`
 * frames long and ends on its last.
 */
export interface Clip {
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  /** For a gait: how far (body lengths) one cycle of the clip carries the cat along the ground without its feet sliding; 0 for a clip that is not one. */
  stride: number;
  rKind: Uint8Array;
  rAt: Int32Array;
  r: Float32Array;
  tKind: Uint8Array;
  tAt: Int32Array;
  t: Float32Array;
  /** What else the clip's maker said about it (named moments, in seconds, such as when a paw lands), by name. */
  marks: Record<string, number>;
}

export const lengthOf = (clip: Clip): number => (clip.loop ? clip.frames / clip.fps : Math.max(0, clip.frames - 1) / clip.fps);

/** The pose of `clip` at a (fractional) frame: a looping clip wraps, a clip played once holds its ends. */
export function sampleFrame(clip: Clip, frame: number, out: Pose): void {
  const n = clip.frames;
  let f = frame;
  let i0: number;
  let i1: number;
  let u: number;
  if (clip.loop) {
    f = ((f % n) + n) % n;
    i0 = Math.floor(f);
    u = f - i0;
    i1 = i0 + 1 >= n ? 0 : i0 + 1;
  } else {
    f = clamp(f, 0, n - 1);
    i0 = Math.min(n - 1, Math.floor(f));
    u = f - i0;
    i1 = Math.min(n - 1, i0 + 1);
  }
  const count = out.skeleton.count;
  for (let j = 0; j < count; j++) {
    const kind = clip.rKind[j]!;
    if (kind === 1) {
      const at = clip.rAt[j]!;
      for (let k = 0; k < 4; k++) out.r[j * 4 + k] = clip.r[at + k]!;
    } else if (kind === 2) {
      const a = clip.rAt[j]! + i0 * 4;
      const b = clip.rAt[j]! + i1 * 4;
      // (the short way round: a turn and its negative are one turn, and a loop's last frame may face the other way from its first)
      const s = clip.r[a]! * clip.r[b]! + clip.r[a + 1]! * clip.r[b + 1]! + clip.r[a + 2]! * clip.r[b + 2]! + clip.r[a + 3]! * clip.r[b + 3]! < 0 ? -1 : 1;
      const x = clip.r[a]! + (s * clip.r[b]! - clip.r[a]!) * u;
      const y = clip.r[a + 1]! + (s * clip.r[b + 1]! - clip.r[a + 1]!) * u;
      const z = clip.r[a + 2]! + (s * clip.r[b + 2]! - clip.r[a + 2]!) * u;
      const w = clip.r[a + 3]! + (s * clip.r[b + 3]! - clip.r[a + 3]!) * u;
      const l = Math.hypot(x, y, z, w) || 1;
      out.r[j * 4] = x / l;
      out.r[j * 4 + 1] = y / l;
      out.r[j * 4 + 2] = z / l;
      out.r[j * 4 + 3] = w / l;
    } else {
      for (let k = 0; k < 4; k++) out.r[j * 4 + k] = out.skeleton.restR[j * 4 + k]!;
    }
    const tk = clip.tKind[j]!;
    if (tk === 1) {
      const at = clip.tAt[j]!;
      for (let k = 0; k < 3; k++) out.t[j * 3 + k] = clip.t[at + k]!;
    } else if (tk === 2) {
      const a = clip.tAt[j]! + i0 * 3;
      const b = clip.tAt[j]! + i1 * 3;
      for (let k = 0; k < 3; k++) out.t[j * 3 + k] = clip.t[a + k]! + (clip.t[b + k]! - clip.t[a + k]!) * u;
    } else {
      for (let k = 0; k < 3; k++) out.t[j * 3 + k] = out.skeleton.restT[j * 3 + k]!;
    }
  }
}

/** The pose of `clip` at a time in seconds. */
export function sampleClip(clip: Clip, time: number, out: Pose): void {
  sampleFrame(clip, time * clip.fps, out);
}

/** `out` = `a` made `k` of the way to `b` (k from 0 to 1): each bone's turn along the short way round, and the places in a straight line. `out` may be `a`. */
export function blend(out: Pose, a: Pose, b: Pose, k: number): void {
  const count = out.skeleton.count;
  for (let j = 0; j < count; j++) {
    const o = j * 4;
    let dot = a.r[o]! * b.r[o]! + a.r[o + 1]! * b.r[o + 1]! + a.r[o + 2]! * b.r[o + 2]! + a.r[o + 3]! * b.r[o + 3]!;
    const s = dot < 0 ? -1 : 1;
    dot *= s;
    let x = a.r[o]! + (s * b.r[o]! - a.r[o]!) * k;
    let y = a.r[o + 1]! + (s * b.r[o + 1]! - a.r[o + 1]!) * k;
    let z = a.r[o + 2]! + (s * b.r[o + 2]! - a.r[o + 2]!) * k;
    let w = a.r[o + 3]! + (s * b.r[o + 3]! - a.r[o + 3]!) * k;
    const l = Math.hypot(x, y, z, w) || 1;
    out.r[o] = x / l;
    out.r[o + 1] = y / l;
    out.r[o + 2] = z / l;
    out.r[o + 3] = w / l;
    for (let c = 0; c < 3; c++) out.t[j * 3 + c] = a.t[j * 3 + c]! + (b.t[j * 3 + c]! - a.t[j * 3 + c]!) * k;
  }
}

/**
 * Every bone's matrix as the pose has it (the bone's own place and turn after its parent's), in the cat's space. `adjust` is added on the way: the turn is made about the
 * bone's joint, about the cat's axes, so it carries all that hangs from the bone.
 */
export function globals(skeleton: Skeleton, pose: Pose, adjust: readonly Adjust[] | undefined, R: Float64Array, T: Float64Array): void {
  const n = skeleton.count;
  for (let j = 0; j < n; j++) {
    const o = j * 4;
    // this bone's own turn as a matrix, then after the parent's
    const p = skeleton.parent[j]!;
    const m = j * 9;
    const q = pose.r;
    // (a matrix for the local turn, held in R's own slot while the parent's is multiplied in)
    matrixOf(R, q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!, m);
    const tx = pose.t[j * 3]!;
    const ty = pose.t[j * 3 + 1]!;
    const tz = pose.t[j * 3 + 2]!;
    if (p < 0) {
      T[j * 3] = tx;
      T[j * 3 + 1] = ty;
      T[j * 3 + 2] = tz;
    } else {
      const pm = p * 9;
      T[j * 3] = R[pm]! * tx + R[pm + 1]! * ty + R[pm + 2]! * tz + T[p * 3]!;
      T[j * 3 + 1] = R[pm + 3]! * tx + R[pm + 4]! * ty + R[pm + 5]! * tz + T[p * 3 + 1]!;
      T[j * 3 + 2] = R[pm + 6]! * tx + R[pm + 7]! * ty + R[pm + 8]! * tz + T[p * 3 + 2]!;
      const l0 = R[m]!, l1 = R[m + 1]!, l2 = R[m + 2]!, l3 = R[m + 3]!, l4 = R[m + 4]!, l5 = R[m + 5]!, l6 = R[m + 6]!, l7 = R[m + 7]!, l8 = R[m + 8]!;
      for (let r = 0; r < 3; r++) {
        const a0 = R[pm + r * 3]!;
        const a1 = R[pm + r * 3 + 1]!;
        const a2 = R[pm + r * 3 + 2]!;
        R[m + r * 3] = a0 * l0 + a1 * l3 + a2 * l6;
        R[m + r * 3 + 1] = a0 * l1 + a1 * l4 + a2 * l7;
        R[m + r * 3 + 2] = a0 * l2 + a1 * l5 + a2 * l8;
      }
    }
    if (adjust) {
      for (const a of adjust) {
        if (a.bone !== j) continue;
        matrixOf(adjR, a.q[0], a.q[1], a.q[2], a.q[3]);
        const g0 = R[m]!, g1 = R[m + 1]!, g2 = R[m + 2]!, g3 = R[m + 3]!, g4 = R[m + 4]!, g5 = R[m + 5]!, g6 = R[m + 6]!, g7 = R[m + 7]!, g8 = R[m + 8]!;
        for (let r = 0; r < 3; r++) {
          const a0 = adjR[r * 3]!;
          const a1 = adjR[r * 3 + 1]!;
          const a2 = adjR[r * 3 + 2]!;
          R[m + r * 3] = a0 * g0 + a1 * g3 + a2 * g6;
          R[m + r * 3 + 1] = a0 * g1 + a1 * g4 + a2 * g7;
          R[m + r * 3 + 2] = a0 * g2 + a1 * g5 + a2 * g8;
        }
      }
    }
  }
}

/**
 * The bones the card is given to skin by dual quaternions (a bone's skin is a turn and a move and nothing else, so it is one: the turn as a quaternion, and half the move turned by
 * it). Two bones that are turned far apart are then blended as a turn that is half of the one and half of the other, not as two matrices that are averaged (which shrinks
 * what lies between them: a neck that is twisted, a knee that is bent). The `world` of the whole cat (its squash and tilt, which are not a turn and a move) is the card's, applied
 * after. `out` has eight numbers a bone: the turn (x y z w), then the dual part (x y z w).
 */
export function solveDual(skeleton: Skeleton, pose: Pose, out: Float32Array, adjust?: readonly Adjust[]): void {
  globals(skeleton, pose, adjust, gR, gT);
  const n = skeleton.count;
  for (let j = 0; j < n; j++) {
    const m = j * 9;
    const b = j * 12;
    // skin = [R | t] x bind (as `solve` has it)
    const s = skinM;
    for (let r = 0; r < 3; r++) {
      const r0 = gR[m + r * 3]!;
      const r1 = gR[m + r * 3 + 1]!;
      const r2 = gR[m + r * 3 + 2]!;
      for (let c = 0; c < 3; c++) s[r * 4 + c] = r0 * skeleton.bind[b + c]! + r1 * skeleton.bind[b + 4 + c]! + r2 * skeleton.bind[b + 8 + c]!;
      s[r * 4 + 3] = r0 * skeleton.bind[b + 3]! + r1 * skeleton.bind[b + 7]! + r2 * skeleton.bind[b + 11]! + gT[j * 3 + r]!;
    }
    // the turn of the matrix's rotation part, as a quaternion
    const m00 = s[0]!, m01 = s[1]!, m02 = s[2]!, m10 = s[4]!, m11 = s[5]!, m12 = s[6]!, m20 = s[8]!, m21 = s[9]!, m22 = s[10]!;
    const trace = m00 + m11 + m22;
    let x: number, y: number, z: number, w: number;
    if (trace > 0) {
      const k = Math.sqrt(trace + 1) * 2;
      w = k / 4;
      x = (m21 - m12) / k;
      y = (m02 - m20) / k;
      z = (m10 - m01) / k;
    } else if (m00 > m11 && m00 > m22) {
      const k = Math.sqrt(1 + m00 - m11 - m22) * 2;
      w = (m21 - m12) / k;
      x = k / 4;
      y = (m01 + m10) / k;
      z = (m02 + m20) / k;
    } else if (m11 > m22) {
      const k = Math.sqrt(1 + m11 - m00 - m22) * 2;
      w = (m02 - m20) / k;
      x = (m01 + m10) / k;
      y = k / 4;
      z = (m12 + m21) / k;
    } else {
      const k = Math.sqrt(1 + m22 - m00 - m11) * 2;
      w = (m10 - m01) / k;
      x = (m02 + m20) / k;
      y = (m12 + m21) / k;
      z = k / 4;
    }
    const l = Math.hypot(x, y, z, w) || 1;
    x /= l;
    y /= l;
    z /= l;
    w /= l;
    // (a bone's turn and its negative are one turn: which of the two it is is fixed below, for the whole skeleton at once)
    const tx = s[3]!;
    const ty = s[7]!;
    const tz = s[11]!;
    const o = j * 8;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + 3] = w;
    // half the move (as a quaternion with no scalar part) after the turn
    out[o + 4] = 0.5 * (tx * w + ty * z - tz * y);
    out[o + 5] = 0.5 * (-tx * z + ty * w + tz * x);
    out[o + 6] = 0.5 * (tx * y - ty * x + tz * w);
    out[o + 7] = 0.5 * (-tx * x - ty * y - tz * z);
  }
  // A bone's turn and its negative are one turn, but a blend of two bones is not: it goes the short way between the two quaternions the card has. Which of the two a bone has is
  // therefore told here, once, down the skeleton (a bone on the side of the bone it hangs from, the root's with a share of w): a bone and its parent are never more than a half
  // turn apart, so they are always on one side, and a point that two neighbouring bones carry is a turn between them. (The card used to put each point's bones on the side of the
  // first of them. Two points side by side that carry the same three bones, one listing the forearm first and the other the hips, then chose different sides for a forearm that
  // was folded back past a half turn from the hips, and were a third of a body apart.)
  for (let j = 0; j < n; j++) {
    const o = j * 8;
    const p = skeleton.parent[j]!;
    const flip = p >= 0 ? out[o]! * out[p * 8]! + out[o + 1]! * out[p * 8 + 1]! + out[o + 2]! * out[p * 8 + 2]! + out[o + 3]! * out[p * 8 + 3]! < 0 : out[o + 3]! < 0;
    if (flip) for (let k = 0; k < 8; k++) out[o + k] = -out[o + k]!;
  }
}

/**
 * A point of the mesh and its normal, skinned by up to four of the bones `solveDual` gave (`skin` and `weight` are the point's four bones and their weights, the weights
 * adding to one): the same arithmetic as the vertex shader's. `at` is where the point's numbers start in `skin` and `weight`; the result is written to `p` and `n`.
 */
export function dualSkin(dq: ArrayLike<number>, skin: ArrayLike<number>, weight: ArrayLike<number>, at: number, scale: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, p: number[], n: number[]): void {
  let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0;
  // (the bones are blended as `solveDual` signed them: each on the side of the bone it hangs from, whatever bone a point lists first)
  for (let k = 0; k < 4; k++) {
    const w = weight[at + k]! * scale;
    if (w <= 0) continue;
    const o = skin[at + k]! * 8;
    rx += w * dq[o]!;
    ry += w * dq[o + 1]!;
    rz += w * dq[o + 2]!;
    rw += w * dq[o + 3]!;
    dx += w * dq[o + 4]!;
    dy += w * dq[o + 5]!;
    dz += w * dq[o + 6]!;
    dw += w * dq[o + 7]!;
  }
  const len = Math.hypot(rx, ry, rz, rw) || 1;
  rx /= len;
  ry /= len;
  rz /= len;
  rw /= len;
  dx /= len;
  dy /= len;
  dz /= len;
  dw /= len;
  turnBy(rx, ry, rz, rw, px, py, pz, p);
  // the move: twice the vector part of d x (the turn turned back)
  p[0] = p[0]! + 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
  p[1] = p[1]! + 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
  p[2] = p[2]! + 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
  turnBy(rx, ry, rz, rw, nx, ny, nz, n);
}

/** A vector turned by a quaternion (unit): v + 2 r x (r x v + w v). */
export function turnBy(rx: number, ry: number, rz: number, rw: number, vx: number, vy: number, vz: number, out: number[]): void {
  const cx = ry * vz - rz * vy + rw * vx;
  const cy = rz * vx - rx * vz + rw * vy;
  const cz = rx * vy - ry * vx + rw * vz;
  out[0] = vx + 2 * (ry * cz - rz * cy);
  out[1] = vy + 2 * (rz * cx - rx * cz);
  out[2] = vz + 2 * (rx * cy - ry * cx);
}

/**
 * The bones the card is given: each bone's matrix after the skin's (what takes a point of the mesh as it was made to where the pose has it), then the `world` matrix of the
 * whole cat (its turn, squash and tilt) after that. `out` has twelve numbers a bone, row after row.
 */
export function solve(skeleton: Skeleton, pose: Pose, world: ArrayLike<number>, out: Float32Array, adjust?: readonly Adjust[]): void {
  globals(skeleton, pose, adjust, gR, gT);
  const n = skeleton.count;
  const W = world;
  for (let j = 0; j < n; j++) {
    const m = j * 9;
    const b = j * 12;
    // skin = [R | t] x bind
    const s = skinM;
    for (let r = 0; r < 3; r++) {
      const r0 = gR[m + r * 3]!;
      const r1 = gR[m + r * 3 + 1]!;
      const r2 = gR[m + r * 3 + 2]!;
      for (let c = 0; c < 3; c++) s[r * 4 + c] = r0 * skeleton.bind[b + c]! + r1 * skeleton.bind[b + 4 + c]! + r2 * skeleton.bind[b + 8 + c]!;
      s[r * 4 + 3] = r0 * skeleton.bind[b + 3]! + r1 * skeleton.bind[b + 7]! + r2 * skeleton.bind[b + 11]! + gT[j * 3 + r]!;
    }
    // out = world x skin
    for (let r = 0; r < 3; r++) {
      const w0 = W[r * 4]!;
      const w1 = W[r * 4 + 1]!;
      const w2 = W[r * 4 + 2]!;
      for (let c = 0; c < 3; c++) out[b + r * 4 + c] = w0 * s[c]! + w1 * s[4 + c]! + w2 * s[8 + c]!;
      out[b + r * 4 + 3] = w0 * s[3]! + w1 * s[7]! + w2 * s[11]! + W[r * 4 + 3]!;
    }
  }
}
