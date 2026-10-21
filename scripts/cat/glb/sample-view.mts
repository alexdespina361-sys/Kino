import { readGlb } from "./glb.mts";
import { sheet } from "./raster.mts";
const path = process.argv[2]!;
const out = process.argv[3]!;
const { mesh } = readGlb(path);
// glTF axes (x lateral, y up, z forward) -> ours (x forward, y up, z toward the viewer), floor at y = 0
const n = mesh.pos.length / 3;
let minY = 1e9;
for (let v = 0; v < n; v++) minY = Math.min(minY, mesh.pos[v * 3 + 1]!);
const pos = new Float64Array(n * 3);
for (let v = 0; v < n; v++) {
  pos[v * 3] = mesh.pos[v * 3 + 2]!;
  pos[v * 3 + 1] = mesh.pos[v * 3 + 1]! - minY;
  pos[v * 3 + 2] = -mesh.pos[v * 3]!;
}
const W = 900, H = 640, scale = 800;
sheet(out, { pos, tri: mesh.tri }, [
  { view: "side", scale, centre: [0, 0.3], width: W, height: H, grid: 0.02, label: "side (raw units, floor 0)" },
  { view: "front", scale: 1100, centre: [0, 0.3], width: 640, height: H, grid: 0.02, label: "front" },
  { view: "top", scale, centre: [0, 0], width: W, height: 480, grid: 0.02, label: "top" },
], 1);
console.log("done");
