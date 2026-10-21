// What colours the built mesh carries (for choosing the shader's grade): the mean colour of the vertices by region, and the spread of the openness.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/client/cat/render/gl");
const file = readFileSync(resolve(root, "cat.mesh"));
const mesh = decodeMesh(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

const regions: Record<string, (x: number, y: number, z: number) => boolean> = {
  "body (x -0.5..0.15, y 0.3..0.6)": (x, y) => x > -0.5 && x < 0.15 && y > 0.3 && y < 0.6,
  "belly (y < 0.25, x -0.5..0.15)": (x, y) => x > -0.5 && x < 0.15 && y < 0.25,
  "tail (x < -0.62)": (x) => x < -0.62,
  "head (x > 0.25, y > 0.55)": (x, y) => x > 0.25 && y > 0.55,
  "chest (x > 0.2, y < 0.5)": (x, y) => x > 0.2 && y < 0.5 && y > 0.2,
  "feet (y < 0.1)": (x, y) => y < 0.1,
};
for (const [name, test] of Object.entries(regions)) {
  let n = 0;
  const sum = [0, 0, 0, 0];
  const lum: number[] = [];
  for (let v = 0; v < mesh.count; v++) {
    if (!test(mesh.pos[v * 3]!, mesh.pos[v * 3 + 1]!, mesh.pos[v * 3 + 2]!)) continue;
    n++;
    for (let k = 0; k < 4; k++) sum[k]! += mesh.color[v * 4 + k]!;
    lum.push(0.3 * mesh.color[v * 4]! + 0.55 * mesh.color[v * 4 + 1]! + 0.15 * mesh.color[v * 4 + 2]!);
  }
  lum.sort((a, b) => a - b);
  const q = (f: number): string => (lum.length ? lum[Math.min(lum.length - 1, Math.floor(f * lum.length))]!.toFixed(0) : "-");
  console.log(`${name.padEnd(34)} n ${String(n).padStart(5)}  rgb ${sum.slice(0, 3).map((s) => (s / Math.max(n, 1)).toFixed(0).padStart(3)).join(" ")}  ao ${(sum[3]! / Math.max(n, 1)).toFixed(0).padStart(3)}  luma p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}`);
}
