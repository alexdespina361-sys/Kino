// Samples the model's animation and says where its bones go, in the rig's frame (x forward, y up, z toward the viewer, the feet on the floor, body lengths):
// for judging a gait, and for tuning the rig's own walk against it.
//
//   node anim-trace.mts MODEL.glb [--bones]            the bones, and where they are at bind
//   node anim-trace.mts MODEL.glb --track=NAME[,NAME]  where those bones are at each key of the animation
//   node anim-trace.mts MODEL.glb --gait               what the legs, the back, the head and the tail do, in numbers
import { frameOf } from "./fit.mts";
import { readGlb } from "./glb.mts";
import { loadSkinned } from "./skinned.mts";

const path = process.argv[2];
if (!path) throw new Error("usage: anim-trace.mts MODEL.glb [--bones|--track=a,b|--gait]");
const flag = (name: string): string | undefined => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split("=")[1] ?? (process.argv.includes(`--${name}`) ? "" : undefined);

const g = readGlb(path);
const model = loadSkinned(path);
const conv = frameOf(model);
const json = g.json as {
  nodes: Array<{ name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; skin?: number; mesh?: number }>;
  skins: Array<{ joints: number[] }>;
  animations: Array<{ channels: Array<{ sampler: number; target: { node: number; path: string } }>; samplers: Array<{ input: number; output: number }> }>;
};
const nodes = json.nodes;
const parent = new Map<number, number>();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const skin = json.skins[0]!;
const anim = json.animations[0]!;

type Track = { times: Float64Array; values: Float64Array; width: number };
const tracks = new Map<string, Track>();
for (const ch of anim.channels) {
  const s = anim.samplers[ch.sampler]!;
  tracks.set(`${ch.target.node}:${ch.target.path}`, { times: g.acc(s.input), values: g.acc(s.output), width: ch.target.path === "rotation" ? 4 : 3 });
}
const times = [...tracks.values()][0]!.times;
const duration = times[times.length - 1]!;

type M4 = number[];
const mulM = (a: M4, c: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) o[col * 4 + row]! += a[k * 4 + row]! * c[col * 4 + k]!;
  return o;
};
const compose = (t: number[], q: number[], s: number[]): M4 => {
  const [x, y, z, w] = q as [number, number, number, number];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [r[0]! * s[0]!, r[1]! * s[0]!, r[2]! * s[0]!, 0, r[3]! * s[1]!, r[4]! * s[1]!, r[5]! * s[1]!, 0, r[6]! * s[2]!, r[7]! * s[2]!, r[8]! * s[2]!, 0, t[0]!, t[1]!, t[2]!, 1];
};
const slerp = (a: number[], b: number[], u: number): number[] => {
  let d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
  const sign = d < 0 ? -1 : 1;
  d *= sign;
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (sign * b[i]! - v) * u);
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th);
  const sb = (Math.sin(u * th) / Math.sin(th)) * sign;
  return a.map((v, i) => v * sa + b[i]! * sb);
};
const sample = (node: number, pathName: "translation" | "rotation" | "scale", t: number, rest: number[]): number[] => {
  const tr = tracks.get(`${node}:${pathName}`);
  if (!tr) return rest;
  const n = tr.times.length;
  let k = 0;
  while (k + 1 < n && tr.times[k + 1]! <= t) k++;
  const k2 = Math.min(n - 1, k + 1);
  const span = tr.times[k2]! - tr.times[k]!;
  const u = span > 0 ? (t - tr.times[k]!) / span : 0;
  const at = (i: number): number[] => Array.from(tr.values.subarray(i * tr.width, i * tr.width + tr.width));
  const a = at(k);
  const b = at(k2);
  return pathName === "rotation" ? slerp(a, b, u) : a.map((v, i) => v + (b[i]! - v) * u);
};
const localAt = (i: number, t: number | null): M4 => {
  const n = nodes[i]!;
  if (n.matrix && t === null) return n.matrix;
  const rt = n.translation ?? [0, 0, 0];
  const rq = n.rotation ?? [0, 0, 0, 1];
  const rs = n.scale ?? [1, 1, 1];
  return compose(t === null ? rt : sample(i, "translation", t, rt), t === null ? rq : sample(i, "rotation", t, rq), t === null ? rs : sample(i, "scale", t, rs));
};
const worldAt = (i: number, t: number | null, memo: Map<number, M4>): M4 => {
  const hit = memo.get(i);
  if (hit) return hit;
  const p = parent.get(i);
  const m = p === undefined ? localAt(i, t) : mulM(worldAt(p, t, memo), localAt(i, t));
  memo.set(i, m);
  return m;
};
const originOf = (m: M4): [number, number, number] => [m[12]!, m[13]!, m[14]!];

const jointNode = new Map<string, number>();
skin.joints.forEach((n) => jointNode.set(nodes[n]!.name ?? `node${n}`, n));
const bindMemo = new Map<number, M4>();
const bindOrigin = (n: number): [number, number, number] => originOf(worldAt(n, null, bindMemo));

/** Where a bone's joint is at time t, in the rig's frame: its bind place in the mesh, moved as the joint has moved in the file. */
const place = (name: string, t: number, memo: Map<number, M4>): [number, number, number] => {
  const n = jointNode.get(name);
  if (n === undefined) throw new Error(`no bone ${name}`);
  const head = model.bones.find((b) => b.name === name)!.head;
  const now = originOf(worldAt(n, t, memo));
  const was = bindOrigin(n);
  return conv(head[0] + (now[0] - was[0]), head[1] + (now[1] - was[1]), head[2] + (now[2] - was[2]));
};

if (flag("bones") !== undefined) {
  console.log(`duration ${duration.toFixed(3)} s, ${times.length} keys`);
  for (const b of model.bones) {
    const h = conv(...b.head);
    console.log(`${b.name.padEnd(18)} parent ${b.parent < 0 ? "-" : model.bones[b.parent]!.name.padEnd(16)}  x ${h[0].toFixed(3).padStart(7)} y ${h[1].toFixed(3).padStart(6)} z ${h[2].toFixed(3).padStart(7)}`);
  }
}

const trackNames = flag("track");
if (trackNames) {
  const names = trackNames.split(",");
  console.log(`time   ${names.map((n) => n.padEnd(28)).join("")}`);
  times.forEach((t) => {
    const memo = new Map<number, M4>();
    console.log(`${t.toFixed(3)}  ${names.map((n) => place(n, t, memo).map((v) => v.toFixed(3).padStart(7)).join(" ").padEnd(28)).join("")}`);
  });
}
