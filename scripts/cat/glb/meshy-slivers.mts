// Which triangles are long thin slivers (the whiskers are): their number by sliver ratio, and the head from the front with them in red.
//   node meshy-slivers.mts MODEL.glb OUT.png [ratio]
import { loadSkinned } from "./skinned.mts";
import { fit, vertexColours } from "./fit.mts";
import { renderSoup, writePng, type Shot } from "./raster.mts";

const m = loadSkinned(process.argv[2]!);
const f = fit(m);
const col = vertexColours(m);
const limit = Number(process.argv[4] ?? 0.08);
const P = (v: number): [number, number, number] => [f.pos[v * 3]!, f.pos[v * 3 + 1]!, f.pos[v * 3 + 2]!];
const T = m.tri.length / 3;
const ratio: number[] = [];
for (let t = 0; t < T; t++) {
  const a = P(m.tri[t * 3]!), b = P(m.tri[t * 3 + 1]!), c = P(m.tri[t * 3 + 2]!);
  const e = (p: number[], q: number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
  const ab = e(a, b), bc = e(b, c), ca = e(c, a);
  const s = (ab + bc + ca) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  const longest = Math.max(ab, bc, ca);
  ratio.push(longest > 1e-9 ? area / (longest * longest) : 0);
}
const hist = new Array(12).fill(0);
for (const r of ratio) hist[Math.min(11, Math.floor(r / 0.025))]++;
console.log("triangles by area / longest edge squared, in steps of 0.025:", hist.join(" "));
const red = new Float64Array(col);
let slivers = 0;
for (let t = 0; t < T; t++) {
  if (ratio[t]! >= limit) continue;
  slivers++;
  for (let k = 0; k < 3; k++) {
    const v = m.tri[t * 3 + k]!;
    red[v * 3] = 1; red[v * 3 + 1] = 0.1; red[v * 3 + 2] = 0.1;
  }
}
console.log("slivers under", limit, ":", slivers, "of", T);
const W = 1000, H = 760;
const spec = [["front", 0, 0.62, 2000], ["side", 0.3, 0.62, 2000], ["top", 0.3, 0, 1800]] as const;
const img = new Uint8Array(W * spec.length * H * 4);
spec.forEach(([view, cx, cy, sc], i) => {
  const shot: Shot = { view, scale: sc, centre: [cx, cy], width: W, height: H, grid: 0, label: view };
  const out = renderSoup({ pos: f.pos, tri: m.tri, color: red, normal: f.nor }, shot);
  for (let y = 0; y < H; y++) img.set(out.subarray(y * W * 4, (y + 1) * W * 4), (y * W * spec.length + i * W) * 4);
});
writePng(process.argv[3]!, img, W * spec.length, H);
