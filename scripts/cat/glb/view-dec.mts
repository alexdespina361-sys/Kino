// Looks at a decimated model (the files decimate.py wrote): colours, and a few views, from the files alone.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSoup, writePng, type Shot } from "./raster.mts";

export interface Decimated {
  pos: Float32Array;
  nor: Float32Array;
  col: Uint8Array;
  ao: Uint8Array;
  tri: Uint32Array;
}
export function loadDecimated(dir: string): Decimated {
  const f32 = (n: string) => { const b = readFileSync(resolve(dir, n)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const u32 = (n: string) => { const b = readFileSync(resolve(dir, n)); return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const u8 = (n: string) => { const b = readFileSync(resolve(dir, n)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
  return { pos: f32("pos.f32"), nor: f32("nor.f32"), col: u8("col.u8"), ao: u8("ao.u8"), tri: u32("tri.u32") };
}

if (process.argv[1]?.endsWith("view-dec.mts")) {
  // node view-dec.mts DIR OUT.png [col|ao|nor] [view:cx:cy:scale[:grid],...]
  const dir = process.argv[2]!;
  const out = process.argv[3]!;
  const d = loadDecimated(dir);
  const n = d.pos.length / 3;
  const mode = process.argv[4] ?? "col";
  const colors = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) colors[v * 3 + k] = mode === "lit" ? d.col[v * 3 + k]! / 255 : mode === "ao" ? d.ao[v]! / 255 : mode === "nor" ? 0.5 + 0.5 * d.nor[v * 3 + k]! : d.col[v * 3 + k]! / 255;
  const spec = (process.argv[5] ?? "side:0:0:900,three:0:0:900").split(",");
  const W = 1000, H = 640;
  const tiles: Shot[] = spec.map((s) => {
    const [view, cx, cy, sc, grid] = s.split(":");
    return { view: view as Shot["view"], scale: Number(sc), centre: [Number(cx), Number(cy)], width: W, height: H, grid: grid ? Number(grid) : 0, label: s };
  });
  const sheetImg = new Uint8Array(W * tiles.length * H * 4);
  tiles.forEach((s, i) => {
    const img = renderSoup({ pos: d.pos, tri: d.tri, color: colors, ...(mode === "lit" ? { normal: d.nor, open: Float64Array.from(d.ao, (v) => v / 255) } : {}) }, s);
    for (let y = 0; y < H; y++) sheetImg.set(img.subarray(y * W * 4, (y + 1) * W * 4), (y * W * tiles.length + i * W) * 4);
  });
  writePng(out, sheetImg, W * tiles.length, H);
  console.log("vertices", n, "triangles", d.tri.length / 3);
}