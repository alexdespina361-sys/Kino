// Measures the skinned model in the rig's frame: its loose pieces, where the face is (eyes, nose), the ears, the tail's centreline, the body's thickness along its length.
import { loadSkinned } from "./skinned.mts";
import { fit, vertexColours } from "./fit.mts";

const m = loadSkinned(process.argv[2]!);
const f = fit(m);
const col = vertexColours(m);
const nV = m.pos.length / 3;
const P = (v: number): [number, number, number] => [f.pos[v * 3]!, f.pos[v * 3 + 1]!, f.pos[v * 3 + 2]!];
const boneIndex = (name: string): number => m.bones.findIndex((b) => b.name === name);
/** How much of a vertex a set of bones carries. */
const share = (v: number, names: string[]): number => {
  const ids = names.map(boneIndex);
  let s = 0;
  for (let k = 0; k < 4; k++) if (ids.includes(m.joints[v * 4 + k]!)) s += m.weights[v * 4 + k]!;
  return s;
};
const fmt = (a: number[]): string => a.map((v) => v.toFixed(3).padStart(7)).join(" ");

// ---- loose pieces: welded by position
const key = (v: number): string => `${Math.round(f.pos[v * 3]! * 1e5)},${Math.round(f.pos[v * 3 + 1]! * 1e5)},${Math.round(f.pos[v * 3 + 2]! * 1e5)}`;
const weld = new Map<string, number>();
const w = new Int32Array(nV);
for (let v = 0; v < nV; v++) {
  const k = key(v);
  if (!weld.has(k)) weld.set(k, weld.size);
  w[v] = weld.get(k)!;
}
const parent = Int32Array.from({ length: weld.size }, (_, i) => i);
const find = (i: number): number => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
};
for (let t = 0; t < m.tri.length; t += 3) {
  const a = find(w[m.tri[t]!]!);
  parent[find(w[m.tri[t + 1]!]!)] = a;
  parent[find(w[m.tri[t + 2]!]!)] = a;
}
const comp = new Map<number, { tris: number; lo: number[]; hi: number[]; verts: Set<number> }>();
for (let t = 0; t < m.tri.length; t += 3) {
  const r = find(w[m.tri[t]!]!);
  let c = comp.get(r);
  if (!c) comp.set(r, (c = { tris: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], verts: new Set() }));
  c.tris++;
  for (let k = 0; k < 3; k++) {
    const v = m.tri[t + k]!;
    c.verts.add(v);
    const p = P(v);
    for (let a = 0; a < 3; a++) {
      c.lo[a] = Math.min(c.lo[a]!, p[a]!);
      c.hi[a] = Math.max(c.hi[a]!, p[a]!);
    }
  }
}
const comps = [...comp.values()].sort((a, b) => b.tris - a.tris);
console.log("pieces", comps.length);
comps.slice(0, 40).forEach((c, i) => console.log(String(i).padStart(3), String(c.tris).padStart(6), "tris  lo", fmt(c.lo), " hi", fmt(c.hi)));

// ---- the face by colour
const eyes: Array<[number, number, number, number]> = [];
const noses: Array<[number, number, number]> = [];
for (let v = 0; v < nV; v++) {
  const r = col[v * 3]!, g = col[v * 3 + 1]!, b = col[v * 3 + 2]!;
  const p = P(v);
  if (p[0] > 0.18 && p[1] > 0.5) {
    if (b > r + 0.07 && b > g) eyes.push([p[0], p[1], p[2], b - r]);
    if (r > g + 0.07 && r > b + 0.03) noses.push(p);
  }
}
const centroid = (a: number[][], pred: (p: number[]) => boolean): { n: number; c: number[]; lo: number[]; hi: number[] } => {
  const s = a.filter(pred);
  const c = [0, 0, 0];
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (const p of s) for (let k = 0; k < 3; k++) {
    c[k]! += p[k]! / s.length;
    lo[k] = Math.min(lo[k]!, p[k]!);
    hi[k] = Math.max(hi[k]!, p[k]!);
  }
  return { n: s.length, c, lo, hi };
};
console.log("bluish vertices", eyes.length);
for (const side of [1, -1]) {
  const e = centroid(eyes, (p) => p[2]! * side > 0);
  console.log(" eye", side > 0 ? "near (+z)" : "far (-z)", e.n, "centre", fmt(e.c), "lo", fmt(e.lo), "hi", fmt(e.hi));
}
const nz = centroid(noses, () => true);
console.log("pinkish vertices (nose, ear inside, lips)", nz.n, "centre", fmt(nz.c), "lo", fmt(nz.lo), "hi", fmt(nz.hi));

// ---- the head, ears, tail by the model's own weights
const headVerts: number[] = [];
const earVerts: number[][] = [[], []];
const tailVerts: number[] = [];
for (let v = 0; v < nV; v++) {
  if (share(v, ["head", "headend", "earend", "R_earend"]) > 0.5) headVerts.push(v);
  if (share(v, ["earend"]) > 0.25) earVerts[0]!.push(v);
  if (share(v, ["R_earend"]) > 0.25) earVerts[1]!.push(v);
  if (share(v, ["tail", "tailstart", "tail1", "tail2", "tail3"]) > 0.5) tailVerts.push(v);
}
const box = (vs: number[]): { lo: number[]; hi: number[]; c: number[] } => {
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  const c = [0, 0, 0];
  for (const v of vs) {
    const p = P(v);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
      c[k]! += p[k]! / vs.length;
    }
  }
  return { lo, hi, c };
};
const hb = box(headVerts);
console.log("head vertices", headVerts.length, "lo", fmt(hb.lo), "hi", fmt(hb.hi), "centroid", fmt(hb.c));
for (const [i, e] of earVerts.entries()) {
  const b = box(e!);
  console.log("ear", i, e!.length, "lo", fmt(b.lo), "hi", fmt(b.hi), "centroid", fmt(b.c));
}
const tb = box(tailVerts);
console.log("tail vertices", tailVerts.length, "lo", fmt(tb.lo), "hi", fmt(tb.hi), "centroid", fmt(tb.c));

// the tail's centreline: slabs along the line from the root to the farthest tail vertex
const root = f.bones[boneIndex("tail")]!.head;
let far = tailVerts[0]!;
let farD = 0;
for (const v of tailVerts) {
  const p = P(v);
  const d = Math.hypot(p[0] - root[0], p[1] - root[1], p[2] - root[2]);
  if (d > farD) {
    farD = d;
    far = v;
  }
}
console.log("tail root", fmt(root), "farthest", fmt(P(far)), "distance", farD.toFixed(3));
// slabs by the distance from the root, centroid in each (a rough centreline)
const slabs = 16;
const slabW = (farD * 1.02) / slabs;
const cs: Array<{ n: number; c: number[]; r: number }> = Array.from({ length: slabs }, () => ({ n: 0, c: [0, 0, 0], r: 0 }));
for (const v of tailVerts) {
  const p = P(v);
  const d = Math.hypot(p[0] - root[0], p[1] - root[1], p[2] - root[2]);
  const s = Math.min(slabs - 1, Math.floor(d / slabW));
  cs[s]!.n++;
  for (let k = 0; k < 3; k++) cs[s]!.c[k]! += p[k]!;
}
cs.forEach((s, i) => {
  if (s.n) console.log(" slab", String(i).padStart(2), String(s.n).padStart(5), fmt(s.c.map((c) => c / s.n)));
});
