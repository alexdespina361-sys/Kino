// Looks at the skinned model in the rig's frame (x forward, y up, z toward the viewer): the colours it was painted with, its bones, a grid.
//   node meshy-view.mts MODEL.glb OUT.png [view:cx:cy:scale[:grid][:bones],...]
import { loadSkinned } from "./skinned.mts";
import { fit, vertexColours } from "./fit.mts";
import { renderSoup, writePng, type Shot } from "./raster.mts";
import { openness } from "./bvh.mts";

if (process.argv[1]?.endsWith("meshy-view.mts")) {
  const m = loadSkinned(process.argv[2]!);
  const f = fit(m);
  const col = vertexColours(m);
  const open = process.env.AO === "1" ? openness(f.pos, f.nor, m.tri, 0.06) : undefined;
  const spec = (process.argv[4] ?? "side:0:0.5:900:0.1:1,three:0:0.5:900").split(",");
  const W = 1000, H = 760;
  const sheetImg = new Uint8Array(W * spec.length * H * 4);
  spec.forEach((s, i) => {
    const [view, cx, cy, sc, grid, bones] = s.split(":");
    const marks = bones === "1" ? f.bones.map((b, k) => ({ p: b.head, text: String(k), color: [255, 80, 80] as [number, number, number] })) : [];
    const shot: Shot = { view: view as Shot["view"], scale: Number(sc), centre: [Number(cx), Number(cy)], width: W, height: H, grid: grid ? Number(grid) : 0, label: s, marks };
    const img = renderSoup({ pos: f.pos, tri: m.tri, color: col, normal: f.nor, ...(open ? { open } : {}) }, shot);
    for (let y = 0; y < H; y++) sheetImg.set(img.subarray(y * W * 4, (y + 1) * W * 4), (y * W * spec.length + i * W) * 4);
  });
  writePng(process.argv[3]!, sheetImg, W * spec.length, H);
  console.log("bounds x", Math.min(...Array.from({ length: f.pos.length / 3 }, (_, v) => f.pos[v * 3]!)).toFixed(3), "y max", Math.max(...Array.from({ length: f.pos.length / 3 }, (_, v) => f.pos[v * 3 + 1]!)).toFixed(3));
  f.bones.forEach((b, k) => console.log(String(k).padStart(2), b.name.padEnd(13), b.head.map((v) => v.toFixed(3).padStart(7)).join(" ")));
}
