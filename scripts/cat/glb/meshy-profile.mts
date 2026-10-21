// The body's thickness along its length: the highest and lowest points of the torso (the vertices the model's own weights give to the hips and the chest) in slices of x.
import { loadSkinned } from "./skinned.mts";
import { fit } from "./fit.mts";

const m = loadSkinned(process.argv[2]!);
const s = Number(process.argv[3] ?? 0.257);
const f = fit(m, s);
const nV = m.pos.length / 3;
const id = (n: string): number => m.bones.findIndex((b) => b.name === n);
const torso = [id("Hips"), id("chest")];
const share = (v: number, ids: number[]): number => {
  let t = 0;
  for (let k = 0; k < 4; k++) if (ids.includes(m.joints[v * 4 + k]!)) t += m.weights[v * 4 + k]!;
  return t;
};
const pct = (a: number[], q: number): number => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.max(0, Math.floor(q * (b.length - 1))))]!;
};
console.log("x slice      n   y bottom(5%)  y top(95%)   y min   y max   |z| max(95%)");
for (let x0 = -0.7; x0 < 0.5; x0 += 0.05) {
  const ys: number[] = [];
  const zs: number[] = [];
  for (let v = 0; v < nV; v++) {
    const x = f.pos[v * 3]!;
    if (x < x0 || x >= x0 + 0.05) continue;
    if (share(v, torso) < 0.6) continue;
    ys.push(f.pos[v * 3 + 1]!);
    zs.push(Math.abs(f.pos[v * 3 + 2]!));
  }
  if (ys.length < 5) continue;
  console.log(x0.toFixed(2).padStart(6), String(ys.length).padStart(6), pct(ys, 0.05).toFixed(3).padStart(10), pct(ys, 0.95).toFixed(3).padStart(10), pct(ys, 0).toFixed(3).padStart(10), pct(ys, 1).toFixed(3).padStart(8), pct(zs, 0.95).toFixed(3).padStart(8));
}
