// The tail's centreline by fitting a chain of points to the dark plume: each point is the mean of the dark vertices nearest to it, over and over (a principal curve),
// then the chain is cut into equal pieces.
import { loadSkinned } from "./skinned.mts";
import { fit, vertexColours } from "./fit.mts";

const m = loadSkinned(process.argv[2]!);
const f = fit(m);
const col = vertexColours(m);
const nV = m.pos.length / 3;
const lum = (v: number): number => 0.3 * col[v * 3]! + 0.55 * col[v * 3 + 1]! + 0.15 * col[v * 3 + 2]!;
const tail: number[] = [];
for (let v = 0; v < nV; v++) {
  const x = f.pos[v * 3]!;
  if (x < -0.45 && f.pos[v * 3 + 1]! > 0.42 && lum(v) < 0.5) tail.push(v);
}
console.log("dark tail vertices", tail.length);
const P = (v: number): [number, number, number] => [f.pos[v * 3]!, f.pos[v * 3 + 1]!, f.pos[v * 3 + 2]!];
// a first chain by eye: from the root up and back
let chain: Array<[number, number, number]> = [[-0.52, 0.5, 0], [-0.58, 0.52, 0], [-0.65, 0.56, 0], [-0.72, 0.63, 0], [-0.78, 0.72, 0], [-0.84, 0.8, 0], [-0.92, 0.86, 0], [-1.02, 0.88, 0], [-1.1, 0.9, 0]];
for (let it = 0; it < 30; it++) {
  const sum = chain.map(() => [0, 0, 0, 0]);
  for (const v of tail) {
    const p = P(v);
    let best = 0;
    let bd = 1e9;
    chain.forEach((c, i) => {
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    sum[best]![0]! += p[0];
    sum[best]![1]! += p[1];
    sum[best]![2]! += 0;
    sum[best]![3]! += 1;
  }
  chain = chain.map((c, i) => (sum[i]![3]! > 3 ? [sum[i]![0]! / sum[i]![3]!, sum[i]![1]! / sum[i]![3]!, sum[i]![2]! / sum[i]![3]!] : c)) as typeof chain;
  // keep the chain's order and smooth it a little
  chain = chain.map((c, i) => (i === 0 || i === chain.length - 1 ? c : [(chain[i - 1]![0] + 2 * c[0] + chain[i + 1]![0]) / 4, (chain[i - 1]![1] + 2 * c[1] + chain[i + 1]![1]) / 4, c[2]])) as typeof chain;
}
console.log("chain:");
chain.forEach((c, i) => console.log(" ", i, c.map((v) => v.toFixed(3)).join(" ")));
// radius along it
const radius = chain.map(() => ({ n: 0, r: 0 }));
for (const v of tail) {
  const p = P(v);
  let best = 0;
  let bd = 1e9;
  chain.forEach((c, i) => {
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  radius[best]!.n++;
  radius[best]!.r = Math.max(radius[best]!.r, Math.sqrt(bd));
}
console.log("radius (max) per chain point:", radius.map((r) => r.r.toFixed(3)).join(" "));
