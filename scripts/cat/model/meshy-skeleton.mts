// The free cat model's own skeleton and animation, read from the file and put in the rig's frame (x forward, y up, z toward the viewer, body lengths), as the player in
// src/client/cat/render/gl/pose.ts wants them. Development tooling only (the model is research material and lives outside the repository).
//
// What the file has: the joints (a skin of 27, parents before children), each with a place and a turn against its parent; the joints hang from an "Armature" node that turns the
// file's y-up space and scales it by a hundredth; the mesh's vertices and the inverse bind matrices are in the space those make. `frameOf` (fit.mts) takes that space to the
// rig's frame; here that map is folded into the root joint (its place and its turn), and into every other joint's place as one scale, so that all the matrices in the rig's
// frame are plain turns and places (no scale), and the skin a joint gives is the same as the file's, carried over.
import { readGlb } from "../glb/glb.mts";
import { frameOf } from "../glb/fit.mts";
import { loadSkinned, type Skinned } from "../glb/skinned.mts";
import { after, type SkeletonData } from "../../../src/client/cat/render/gl/pose";

export type Quat = [number, number, number, number];
type V3 = [number, number, number];
type M4 = number[];

const mulM = (a: M4, c: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) o[col * 4 + row]! += a[k * 4 + row]! * c[col * 4 + k]!;
  return o;
};
const composeTRS = (t: number[], q: number[], s: number[]): M4 => {
  const [x, y, z, w] = q as [number, number, number, number];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [r[0]! * s[0]!, r[1]! * s[0]!, r[2]! * s[0]!, 0, r[3]! * s[1]!, r[4]! * s[1]!, r[5]! * s[1]!, 0, r[6]! * s[2]!, r[7]! * s[2]!, r[8]! * s[2]!, 0, t[0]!, t[1]!, t[2]!, 1];
};

/** The turn a rotation matrix (three columns, as glTF lays a matrix out: x axis, y axis, z axis) stands for. */
export function quatOfAxes(xa: V3, ya: V3, za: V3): Quat {
  const m00 = xa[0], m10 = xa[1], m20 = xa[2];
  const m01 = ya[0], m11 = ya[1], m21 = ya[2];
  const m02 = za[0], m12 = za[1], m22 = za[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export interface MeshySkeleton {
  model: Skinned;
  /** The file's bones (the skin's own order), as the player's skeleton: without anything added. */
  fileData: SkeletonData;
  /** The map from the file's space to the rig's frame (a point). */
  toRig: (p: readonly number[]) => V3;
  /** Metres of the rig's frame to a unit of a joint's place in the file: what every joint's place is multiplied by. */
  placeScale: number;
  /** The node of each of the file's bones. */
  nodeOf: number[];
  /** What the file's animation makes of each bone, at each of `frames` frames at `fps`: turns (four a frame) and, for the bones whose place moves, places (three a frame). */
  clip(name: string, frames: number, fps: number, timeOf: (frame: number) => number): { r: Float64Array[]; t: Array<Float64Array | null> };
  duration: number;
  keyTimes: Float64Array;
  /** The file's own skinning of a point at a time, in the rig's frame: for checking the player against the file with code that does not share a line with it. */
  skinPoint: (v: number, time: number | null) => V3;
}

export function readMeshySkeleton(path: string): MeshySkeleton {
  const g = readGlb(path);
  const json = g.json as any;
  const nodes: any[] = json.nodes;
  const model = loadSkinned(path);
  const skin = json.skins[json.nodes.find((n: any) => n.skin !== undefined).skin];
  const joints: number[] = skin.joints;
  const parentNode = new Map<number, number>();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parentNode.set(c, i)));
  const jointIndex = new Map<number, number>();
  joints.forEach((n, j) => jointIndex.set(n, j));
  const parent = joints.map((n) => jointIndex.get(parentNode.get(n) ?? -1) ?? -1);
  parent.forEach((p, j) => {
    if (p >= j) throw new Error(`joint ${j} comes before its parent`);
  });
  const roots = parent.filter((p) => p < 0).length;
  if (roots !== 1) throw new Error(`expected one root joint, found ${roots}`);

  // the nodes above the root joint make the matrix `up` (the "Armature": a turn and a scale), as glTF has it
  const localOf = (n: any): M4 => (n.matrix ? (n.matrix as M4) : composeTRS(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]));
  let up: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  {
    const chain: number[] = [];
    let at = parentNode.get(joints[parent.indexOf(-1)]!);
    while (at !== undefined) {
      chain.unshift(at);
      at = parentNode.get(at);
    }
    for (const n of chain) up = mulM(up, localOf(nodes[n]));
  }
  const scaleUp = Math.hypot(up[0]!, up[1]!, up[2]!);

  // the map to the rig's frame, as an affine map (this is the same one the mesh was put in: `frameOf` of fit.mts)
  const conv = frameOf(model);
  const o = conv(0, 0, 0);
  const ex = conv(1, 0, 0);
  const ey = conv(0, 1, 0);
  const ez = conv(0, 0, 1);
  const cols = [ex, ey, ez].map((c) => [c[0] - o[0], c[1] - o[1], c[2] - o[2]] as V3);
  const k = Math.hypot(...cols[0]!);
  for (const c of cols) if (Math.abs(Math.hypot(...c) - k) > 1e-6 * k) throw new Error("the map to the rig's frame is not a turn and one scale");
  const C = cols.map((c) => c.map((v) => v / k) as V3); // columns of the turn
  const placeScale = k * scaleUp;
  const toRig = (p: readonly number[]): V3 => conv(p[0]!, p[1]!, p[2]!);

  // the turn of the root: the rig's turn after the Armature's (its scale taken out), after the joint's own
  const upAxes = [0, 1, 2].map((c) => [up[c * 4]! / scaleUp, up[c * 4 + 1]! / scaleUp, up[c * 4 + 2]! / scaleUp] as V3);
  const rigTurn = quatOfAxes(C[0]!, C[1]!, C[2]!);
  const upTurn = quatOfAxes(upAxes[0]!, upAxes[1]!, upAxes[2]!);
  const rootTurn = after(upTurn, rigTurn); // (rig after armature)

  const names = joints.map((n, j) => (nodes[n].name as string | undefined) ?? model.bones[j]!.name);
  const restT: number[] = [];
  const restR: number[] = [];
  joints.forEach((n, j) => {
    const node = nodes[n];
    const t: number[] = node.translation ?? [0, 0, 0];
    const q: number[] = node.rotation ?? [0, 0, 0, 1];
    if (node.matrix || (node.scale && node.scale.some((v: number) => Math.abs(v - 1) > 1e-6))) throw new Error(`joint ${names[j]} has a scale or a matrix`);
    if (parent[j]! < 0) {
      // (the place of the root: where the Armature carries it, in the rig's frame)
      const w = [up[0]! * t[0]! + up[4]! * t[1]! + up[8]! * t[2]! + up[12]!, up[1]! * t[0]! + up[5]! * t[1]! + up[9]! * t[2]! + up[13]!, up[2]! * t[0]! + up[6]! * t[1]! + up[10]! * t[2]! + up[14]!];
      restT.push(...toRig(w));
      restR.push(...after(q as Quat, rootTurn));
    } else {
      restT.push(t[0]! * placeScale, t[1]! * placeScale, t[2]! * placeScale);
      restR.push(q[0]!, q[1]!, q[2]!, q[3]!);
    }
  });
  const fileData: SkeletonData = { names, parent, restT, restR };

  // ---- the animation tracks
  const anim = json.animations[0];
  type Track = { times: Float64Array; values: Float64Array; width: number; step: boolean };
  const tracks = new Map<string, Track>();
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    tracks.set(`${ch.target.node}:${ch.target.path}`, { times: g.acc(s.input), values: g.acc(s.output), width: ch.target.path === "rotation" ? 4 : 3, step: s.interpolation === "STEP" });
  }
  let duration = 0;
  let keyTimes = new Float64Array(0);
  for (const t of tracks.values()) {
    duration = Math.max(duration, t.times[t.times.length - 1]!);
    if (t.times.length > keyTimes.length) keyTimes = t.times;
  }
  const slerp = (a: number[], b: number[], u: number): number[] => {
    let d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
    const sg = d < 0 ? -1 : 1;
    d *= sg;
    if (d > 0.9995) {
      const out = a.map((v, i) => v + (sg * b[i]! - v) * u);
      const l = Math.hypot(...out);
      return out.map((v) => v / l);
    }
    const th = Math.acos(d);
    const sa = Math.sin((1 - u) * th) / Math.sin(th);
    const sb = (Math.sin(u * th) / Math.sin(th)) * sg;
    return a.map((v, i) => v * sa + b[i]! * sb);
  };
  const sample = (node: number, path: "translation" | "rotation" | "scale", time: number | null, rest: number[]): number[] => {
    if (time === null) return rest;
    const tr = tracks.get(`${node}:${path}`);
    if (!tr) return rest;
    const n = tr.times.length;
    let kk = 0;
    while (kk + 1 < n && tr.times[kk + 1]! <= time + 1e-9) kk++;
    const at = (i: number): number[] => Array.from(tr.values.subarray(i * tr.width, i * tr.width + tr.width));
    if (tr.step || kk + 1 >= n) return at(kk);
    const span = tr.times[kk + 1]! - tr.times[kk]!;
    const u = span > 0 ? Math.min(1, Math.max(0, (time - tr.times[kk]!) / span)) : 0;
    return path === "rotation" ? slerp(at(kk), at(kk + 1), u) : at(kk).map((v, i) => v + (at(kk + 1)[i]! - v) * u);
  };

  const clip = (_name: string, frames: number, _fps: number, timeOf: (frame: number) => number) => {
    const r: Float64Array[] = joints.map(() => new Float64Array(frames * 4));
    const t: Array<Float64Array | null> = joints.map((_, j) => (tracks.has(`${joints[j]}:translation`) ? new Float64Array(frames * 3) : null));
    for (let f = 0; f < frames; f++) {
      const time = timeOf(f);
      joints.forEach((n, j) => {
        const node = nodes[n];
        const q = sample(n, "rotation", time, node.rotation ?? [0, 0, 0, 1]);
        const turn = parent[j]! < 0 ? after(q as Quat, rootTurn) : (q as Quat);
        r[j]!.set(turn, f * 4);
        const tt = t[j];
        if (tt) {
          const p = sample(n, "translation", time, node.translation ?? [0, 0, 0]);
          if (parent[j]! < 0) {
            const w = [up[0]! * p[0]! + up[4]! * p[1]! + up[8]! * p[2]! + up[12]!, up[1]! * p[0]! + up[5]! * p[1]! + up[9]! * p[2]! + up[13]!, up[2]! * p[0]! + up[6]! * p[1]! + up[10]! * p[2]! + up[14]!];
            tt.set(toRig(w), f * 3);
          } else tt.set([p[0]! * placeScale, p[1]! * placeScale, p[2]! * placeScale], f * 3);
        }
      });
    }
    return { r, t };
  };

  // ---- the file's own skinning of one vertex, in the world of the file (the Armature included), by the spec: joint matrix = joint's world x inverse bind
  const ibm = g.acc(skin.inverseBindMatrices);
  const worldOf = (i: number, time: number | null, memo: Map<number, M4>): M4 => {
    const hit = memo.get(i);
    if (hit) return hit;
    const node = nodes[i];
    const local = node.matrix ? (node.matrix as M4) : composeTRS(sample(i, "translation", time, node.translation ?? [0, 0, 0]), sample(i, "rotation", time, node.rotation ?? [0, 0, 0, 1]), node.scale ?? [1, 1, 1]);
    const p = parentNode.get(i);
    const m = p === undefined ? local : mulM(worldOf(p, time, memo), local);
    memo.set(i, m);
    return m;
  };
  const skinPoint = (v: number, time: number | null): V3 => {
    const memo = new Map<number, M4>();
    const px = model.pos[v * 3]!;
    const py = model.pos[v * 3 + 1]!;
    const pz = model.pos[v * 3 + 2]!;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < 4; i++) {
      const w = model.weights[v * 4 + i]!;
      if (w <= 0) continue;
      const j = model.joints[v * 4 + i]!;
      const m = mulM(worldOf(joints[j]!, time, memo), Array.from(ibm.subarray(j * 16, j * 16 + 16)));
      x += w * (m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!);
      y += w * (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!);
      z += w * (m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!);
    }
    return toRig([x, y, z]);
  };

  return { model, fileData, toRig, placeScale, nodeOf: joints, clip, duration, keyTimes, skinPoint };
}
