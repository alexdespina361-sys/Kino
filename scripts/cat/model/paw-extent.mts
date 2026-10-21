// The extent of each paw's sole in the built mesh (vertices near the floor, by bone group): for choosing where the model's toe points are.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/client/cat/render/gl");
const file = readFileSync(resolve(root, "cat.mesh"));
const mesh = decodeMesh(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const groups: Record<string, number[]> = { "front near (10-12)": [10, 11, 12], "front far (13-15)": [13, 14, 15], "hind near (16-18)": [16, 17, 18], "hind far (19-21)": [19, 20, 21] };
for (const [name, bones] of Object.entries(groups)) {
  let n = 0;
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let v = 0; v < mesh.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (bones.includes(mesh.skin[v * 4 + k]!)) w += mesh.weight[v * 4 + k]! / 255;
    if (w < 0.5) continue;
    if (mesh.pos[v * 3 + 1]! > 0.03) continue;
    n++;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, mesh.pos[v * 3 + k]!); hi[k] = Math.max(hi[k]!, mesh.pos[v * 3 + k]!); }
  }
  console.log(`${name}: ${n} vertices below y 0.03, x ${lo[0]!.toFixed(3)}..${hi[0]!.toFixed(3)}, y ${lo[1]!.toFixed(3)}..${hi[1]!.toFixed(3)}, z ${lo[2]!.toFixed(3)}..${hi[2]!.toFixed(3)}`);
}
