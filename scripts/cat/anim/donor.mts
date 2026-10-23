// Another model's skeleton and its animations, read from a .glb, for borrowing its motion (retarget.mts). Development tooling only: the donors are research material and live
// outside the repository, with their licences written down (scripts/cat/anim/sources.json).
//
// A donor's bones are the joints of its (first) skin. The numbers it gives are in its own world space (glTF's: y up, the model facing +z unless it says otherwise), with every
// ancestor's scale in them, so that the places are those the model is drawn at; the turns are the bones' own, with that scale taken out.
import { readGlb } from "../glb/glb.mts";

type M4 = number[];

export interface Donor {
  /** The names of the joints (the skin's order) and the node of each. */
  names: string[];
  nodeOf: number[];
  /** The nearest joint above each joint, -1 for the roots. */
  parent: number[];
  /** The animations in the file, by name, and how long each is (seconds). */
  animations: Array<{ name: string; duration: number; channels: number }>;
  /** Every joint's turn (a 3 x 3 matrix, row after row) and place in the donor's world, at a time of an animation (null: the file's rest pose). */
  at: (animation: number | null, time: number) => { R: Float64Array; P: Float64Array };
  /** The times at which the animation has a key, sorted (all the channels' together), for choosing a frame rate that does not lose any. */
  keys: (animation: number) => number[];
}

const mulM = (a: M4, c: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) o[col * 4 + row]! += a[k * 4 + row]! * c[col * 4 + k]!;
  return o;
};
const trs = (t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): M4 => {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [r[0]! * s[0]!, r[1]! * s[0]!, r[2]! * s[0]!, 0, r[3]! * s[1]!, r[4]! * s[1]!, r[5]! * s[1]!, 0, r[6]! * s[2]!, r[7]! * s[2]!, r[8]! * s[2]!, 0, t[0]!, t[1]!, t[2]!, 1];
};

const slerp = (a: ArrayLike<number>, b: ArrayLike<number>, u: number): number[] => {
  let d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sg = d < 0 ? -1 : 1;
  d *= sg;
  if (d > 0.9995) {
    const out = [0, 1, 2, 3].map((i) => a[i]! + (sg * b[i]! - a[i]!) * u);
    const l = Math.hypot(...out);
    return out.map((v) => v / l);
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th);
  const sb = (Math.sin(u * th) / Math.sin(th)) * sg;
  return [0, 1, 2, 3].map((i) => a[i]! * sa + b[i]! * sb);
};

interface Track {
  times: Float64Array;
  values: Float64Array;
  width: number;
  mode: "LINEAR" | "STEP" | "CUBICSPLINE";
}

export function readDonor(path: string, skinIndex = 0): Donor {
  const g = readGlb(path);
  const json = g.json as any;
  const nodes: any[] = json.nodes;
  const skin = json.skins?.[skinIndex];
  if (!skin) throw new Error(`${path}: no skin ${skinIndex}`);
  const joints: number[] = skin.joints;
  const parentNode = new Map<number, number>();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parentNode.set(c, i)));
  const jointIndex = new Map<number, number>();
  joints.forEach((n, j) => jointIndex.set(n, j));
  const parent = joints.map((n) => {
    let p = parentNode.get(n);
    while (p !== undefined && !jointIndex.has(p)) p = parentNode.get(p);
    return p === undefined ? -1 : jointIndex.get(p)!;
  });
  const names = joints.map((n, j) => (nodes[n].name as string | undefined) ?? `joint${j}`);

  // every animation's tracks, by node and path
  const animations = (json.animations ?? []) as any[];
  const tracks = animations.map((anim) => {
    const map = new Map<string, Track>();
    for (const ch of anim.channels) {
      if (ch.target.node === undefined) continue;
      const s = anim.samplers[ch.sampler];
      const width = ch.target.path === "rotation" ? 4 : ch.target.path === "weights" ? 0 : 3;
      if (width === 0) continue;
      map.set(`${ch.target.node}:${ch.target.path}`, { times: g.acc(s.input), values: g.acc(s.output), width, mode: (s.interpolation ?? "LINEAR") as Track["mode"] });
    }
    return map;
  });
  const durations = tracks.map((m) => {
    let d = 0;
    for (const t of m.values()) d = Math.max(d, t.times[t.times.length - 1]!);
    return d;
  });

  const sample = (map: Map<string, Track> | null, node: number, path: "translation" | "rotation" | "scale", time: number, rest: number[]): number[] => {
    const tr = map?.get(`${node}:${path}`);
    if (!tr) return rest;
    const n = tr.times.length;
    // (the time wraps into the track's own span only if the caller asks: here a time past the end holds the last key)
    let k = 0;
    while (k + 1 < n && tr.times[k + 1]! <= time + 1e-9) k++;
    const stride = tr.mode === "CUBICSPLINE" ? tr.width * 3 : tr.width;
    const base = tr.mode === "CUBICSPLINE" ? tr.width : 0;
    const at = (i: number): number[] => Array.from(tr.values.subarray(i * stride + base, i * stride + base + tr.width));
    if (tr.mode === "STEP" || k + 1 >= n) return at(Math.min(k, n - 1));
    const span = tr.times[k + 1]! - tr.times[k]!;
    const u = span > 0 ? Math.min(1, Math.max(0, (time - tr.times[k]!) / span)) : 0;
    if (tr.mode === "CUBICSPLINE") {
      // (cubic Hermite between the keys, with the file's tangents scaled by the span)
      const p0 = at(k);
      const p1 = at(k + 1);
      const m0 = Array.from(tr.values.subarray(k * stride + tr.width * 2, k * stride + tr.width * 3)).map((v) => v * span);
      const m1 = Array.from(tr.values.subarray((k + 1) * stride, (k + 1) * stride + tr.width)).map((v) => v * span);
      const u2 = u * u;
      const u3 = u2 * u;
      const out = p0.map((v, i) => (2 * u3 - 3 * u2 + 1) * v + (u3 - 2 * u2 + u) * m0[i]! + (-2 * u3 + 3 * u2) * p1[i]! + (u3 - u2) * m1[i]!);
      if (path === "rotation") {
        const l = Math.hypot(...out);
        return out.map((v) => v / l);
      }
      return out;
    }
    return path === "rotation" ? slerp(at(k), at(k + 1), u) : at(k).map((v, i) => v + (at(k + 1)[i]! - v) * u);
  };

  const at = (animation: number | null, time: number): { R: Float64Array; P: Float64Array } => {
    const map = animation === null ? null : tracks[animation]!;
    const memo = new Map<number, M4>();
    const world = (i: number): M4 => {
      const hit = memo.get(i);
      if (hit) return hit;
      const node = nodes[i];
      const local = node.matrix
        ? (node.matrix as M4)
        : trs(sample(map, i, "translation", time, node.translation ?? [0, 0, 0]), sample(map, i, "rotation", time, node.rotation ?? [0, 0, 0, 1]), sample(map, i, "scale", time, node.scale ?? [1, 1, 1]));
      const p = parentNode.get(i);
      const m = p === undefined ? local : mulM(world(p), local);
      memo.set(i, m);
      return m;
    };
    const R = new Float64Array(joints.length * 9);
    const P = new Float64Array(joints.length * 3);
    joints.forEach((n, j) => {
      const m = world(n);
      // (columns of the matrix are the bone's axes, each with the scale in it: normalised, written row after row)
      for (let c = 0; c < 3; c++) {
        const l = Math.hypot(m[c * 4]!, m[c * 4 + 1]!, m[c * 4 + 2]!) || 1;
        for (let r = 0; r < 3; r++) R[j * 9 + r * 3 + c] = m[c * 4 + r]! / l;
      }
      P[j * 3] = m[12]!;
      P[j * 3 + 1] = m[13]!;
      P[j * 3 + 2] = m[14]!;
    });
    return { R, P };
  };

  const keys = (animation: number): number[] => {
    const set = new Set<number>();
    for (const t of tracks[animation]!.values()) for (const v of t.times) set.add(Math.round(v * 1e6) / 1e6);
    return [...set].sort((a, b) => a - b);
  };

  return {
    names,
    nodeOf: joints,
    parent,
    animations: animations.map((a, i) => ({ name: (a.name as string | undefined) ?? `animation${i}`, duration: durations[i]!, channels: tracks[i]!.size })),
    at,
    keys,
  };
}
