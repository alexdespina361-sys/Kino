// Prints the rig's body points, legs and tail in a clip next to the fitted pose of the model (heights, y up), to see what the fit does.
//   node pose-dump.mts clip[:progress[:odometer]]
import { CatRig } from "../../../src/client/cat/render/rig";
import { PoseFit } from "../../../src/client/cat/render/gl/fit";
import type { CatFrame } from "../../../src/client/cat/types";

const [clip, progress, odo] = (process.argv[2] ?? "sit").split(":");
const base: CatFrame = { x: 0, y: 0, facing: 1, clip: clip as CatFrame["clip"], clipTime: 0, progress: Number(progress ?? 0), odometer: Number(odo ?? 0), vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false };
const rig = new CatRig(3);
rig.snapTo(base, 100);
for (let k = 0; k < 90; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
const fit = new PoseFit();
const s = rig.solved;
const f = fit.apply(s);
const fmt = (j: { x: number; y: number }): string => `(${j.x.toFixed(3)}, ${(-j.y).toFixed(3)})`;
console.log("point        rig rest         rig now          model rest       model now");
for (const k of ["rumpTop", "rumpBottom", "groin", "backMid", "bellyMid", "shoulderTop", "chestBottom", "neckTop", "chestFront"] as const) {
  console.log(k.padEnd(12), fmt(fit.rig.pose.p[k]).padEnd(16), fmt(s.pose.p[k]).padEnd(16), fmt(fit.rest.pose.p[k]).padEnd(16), fmt(f.pose.p[k]));
}
console.log("head".padEnd(12), fmt(fit.rig.head).padEnd(16), fmt(s.head).padEnd(16), fmt(fit.rest.head).padEnd(16), fmt(f.head));
for (const key of ["fn", "ff", "hn", "hf"] as const) {
  for (const part of ["root", "mid", "hock", "toe"] as const) {
    console.log(`${key}.${part}`.padEnd(12), fmt(fit.rig.legs[key][part]).padEnd(16), fmt(s.legs[key][part]).padEnd(16), fmt(fit.rest.legs[key][part]).padEnd(16), fmt(f.legs[key][part]));
  }
}
for (let i = 0; i < s.tail.length; i++) console.log(`tail${i}`.padEnd(12), fmt(fit.rig.tail[i]!).padEnd(16), fmt(s.tail[i]!).padEnd(16), fmt(fit.rest.tail[i]!).padEnd(16), fmt(f.tail[i]!));
