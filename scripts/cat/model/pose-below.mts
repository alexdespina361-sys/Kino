// Lists the vertices that a clip puts below the floor (or far from where they were): which bones carry them, and where they were. For finding the points that tear.
//   node pose-below.mts clip[:progress[:odometer]] [floor]
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CatRig } from "../../../src/client/cat/render/rig";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { PoseFit } from "../../../src/client/cat/render/gl/fit";
import { BONE_COUNT, BONE_FLOATS, Skeleton, mat } from "../../../src/client/cat/render/gl/skeleton";
import type { CatFrame } from "../../../src/client/cat/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/client/cat/render/gl");
const file = readFileSync(resolve(root, "cat.mesh"));
const mesh = decodeMesh(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const fit = new PoseFit();
const skeleton = new Skeleton(fit.rest);
const [clip, progress, odo] = (process.argv[2] ?? "sit").split(":");
const floor = Number(process.argv[3] ?? -0.02);
const base: CatFrame = { x: 0, y: 0, facing: 1, clip: clip as CatFrame["clip"], clipTime: 0, progress: Number(progress ?? 0), odometer: Number(odo ?? 0), vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false };
const rig = new CatRig(3);
rig.snapTo(base, 100);
for (let k = 0; k < 90; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
const bones = new Float32Array(BONE_COUNT * BONE_FLOATS);
skeleton.solve(fit.apply(rig.solved), 0, mat(), bones);
let shown = 0;
let lowest = 1e9;
for (let v = 0; v < mesh.count; v++) {
  const x = mesh.pos[v * 3]!, y = mesh.pos[v * 3 + 1]!, z = mesh.pos[v * 3 + 2]!;
  let py = 0;
  for (let k = 0; k < 4; k++) {
    const w = mesh.weight[v * 4 + k]! / 255;
    const o = mesh.skin[v * 4 + k]! * BONE_FLOATS;
    py += w * (bones[o + 4]! * x + bones[o + 5]! * y + bones[o + 6]! * z + bones[o + 7]!);
  }
  lowest = Math.min(lowest, py);
  if (py < floor && shown < 40) {
    shown++;
    const bs = [0, 1, 2, 3].map((k) => `${mesh.skin[v * 4 + k]}:${(mesh.weight[v * 4 + k]! / 255).toFixed(2)}`).join(" ");
    console.log(`v${v} rest (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) now y ${py.toFixed(3)}  bones ${bs}`);
  }
}
console.log("lowest point", lowest.toFixed(3));
