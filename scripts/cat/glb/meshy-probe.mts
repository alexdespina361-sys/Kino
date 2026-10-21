// A first look at a skinned model: bounds, the bind-pose bones, how the weights are spread.
import { loadSkinned } from "./skinned.mts";

const m = loadSkinned(process.argv[2]!);
const nV = m.pos.length / 3;
const lo = [1e9, 1e9, 1e9];
const hi = [-1e9, -1e9, -1e9];
for (let v = 0; v < nV; v++) for (let a = 0; a < 3; a++) {
  lo[a] = Math.min(lo[a]!, m.pos[v * 3 + a]!);
  hi[a] = Math.max(hi[a]!, m.pos[v * 3 + a]!);
}
console.log("vertices", nV, "triangles", m.tri.length / 3, "bounds", lo.map((v) => v.toExponential(3)).join(" "), "..", hi.map((v) => v.toExponential(3)).join(" "));
console.log("texture", m.tex ? `${m.tex.w}x${m.tex.h}` : "none");
const e = (v: number): string => v.toExponential(3).padStart(10);
m.bones.forEach((b, i) => console.log(String(i).padStart(2), b.name.padEnd(14), "parent", String(b.parent).padStart(2), b.head.map(e).join(" ")));
// weights: which bones carry how many vertices, and the biggest weight
const carry = new Float64Array(m.bones.length);
let used4 = 0;
for (let v = 0; v < nV; v++) {
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const w = m.weights[v * 4 + k]!;
    if (w > 0.001) { carry[m.joints[v * 4 + k]!]! += w; n++; }
  }
  if (n === 4) used4++;
}
console.log("vertices using all four influences", used4);
console.log("weight carried per bone:", m.bones.map((b, i) => `${b.name}=${carry[i]!.toFixed(0)}`).join(" "));
// unique uv charts: how many vertices share a position
const key = new Map<string, number>();
for (let v = 0; v < nV; v++) {
  const k = `${Math.round(m.pos[v * 3]! / 1e-7)},${Math.round(m.pos[v * 3 + 1]! / 1e-7)},${Math.round(m.pos[v * 3 + 2]! / 1e-7)}`;
  key.set(k, (key.get(k) ?? 0) + 1);
}
console.log("distinct positions", key.size, "of", nV);
