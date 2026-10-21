// The face's profile: for each height, the furthest forward point of the head at the middle of the face (|z| small) and at the eyes.
import { loadSkinned } from "./skinned.mts";
import { fit, vertexColours } from "./fit.mts";

const m = loadSkinned(process.argv[2]!);
const f = fit(m);
const col = vertexColours(m);
const nV = m.pos.length / 3;
console.log("  y     xmax(|z|<0.02)  at z    xmax(|z| 0.04..0.07)   xmax(|z| 0.09..0.14)   colour at the front (r g b)");
for (let y0 = 0.4; y0 < 0.82; y0 += 0.02) {
  const row: string[] = [y0.toFixed(2)];
  for (const [zlo, zhi] of [[0, 0.02], [0.04, 0.07], [0.09, 0.14]] as const) {
    let best = -9;
    let bz = 0;
    let bv = -1;
    for (let v = 0; v < nV; v++) {
      const y = f.pos[v * 3 + 1]!;
      const z = Math.abs(f.pos[v * 3 + 2]!);
      const x = f.pos[v * 3]!;
      if (y < y0 || y >= y0 + 0.02 || z < zlo || z >= zhi || x < 0.2) continue;
      if (x > best) {
        best = x;
        bz = f.pos[v * 3 + 2]!;
        bv = v;
      }
    }
    row.push(best > -9 ? `${best.toFixed(3)} (z ${bz.toFixed(3)}) [${[0, 1, 2].map((k) => col[bv * 3 + k]!.toFixed(2)).join(" ")}]` : "      -      ");
  }
  console.log(row.join("   "));
}
