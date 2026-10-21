// The back line and the belly line of the body as the skin has it: for slabs along the cat, the highest and the lowest point carried mostly by the body's own bones
// (the stations and the neck), and the lowest point of the rest. For choosing where the stations' backs and bellies are.
import { loadSkinned } from "../glb/skinned.mts";
import { fit } from "../glb/fit.mts";
import { MESHY_REST } from "./meshy-rest.mts";
import { skinPoints } from "./meshy-skin.mts";

const m = loadSkinned(process.argv[2]!);
const f = fit(m);
const { skin, weight } = skinPoints(f.pos, m.tri, MESHY_REST);
const nV = f.pos.length / 3;
console.log("x        back(body)  belly(body)  belly(any)   body weight share of belly point");
for (let x0 = -0.62; x0 < 0.45; x0 += 0.05) {
  let hi = -9, lo = 9, any = 9, share = 0;
  for (let v = 0; v < nV; v++) {
    const x = f.pos[v * 3]!;
    if (x < x0 || x >= x0 + 0.05) continue;
    let body = 0;
    for (let k = 0; k < 4; k++) if (skin[v * 4 + k]! <= 5) body += weight[v * 4 + k]! / 255;
    const y = f.pos[v * 3 + 1]!;
    if (y > 0.3 && body > 0.5) hi = Math.max(hi, y);
    if (body > 0.5 && y < lo) {
      lo = y;
      share = body;
    }
    any = Math.min(any, y);
  }
  console.log(`${x0.toFixed(2)}   ${hi > -9 ? hi.toFixed(3) : "  -  "}      ${lo < 9 ? lo.toFixed(3) : "  -  "}       ${any < 9 ? any.toFixed(3) : "  -  "}      ${share.toFixed(2)}`);
}
