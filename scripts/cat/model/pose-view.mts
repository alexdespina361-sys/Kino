// Looks at the cat's mesh in the rig's poses, skinned on the processor (so no card is needed): the mesh's own colours, lit, or coloured by the bones that carry each point.
//   node pose-view.mts OUT.png [spec,...]      spec = clip[:progress[:odometer[:view[:mode]]]]   (view: side|front|top|three; mode: lit|bones)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CatRig } from "../../../src/client/cat/render/rig";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { PoseFit } from "../../../src/client/cat/render/gl/fit";
import { BONE_COUNT, BONE_FLOATS, Skeleton, mat } from "../../../src/client/cat/render/gl/skeleton";
import type { CatFrame } from "../../../src/client/cat/types";
import { renderSoup, writePng, type Shot, type ViewName } from "../glb/raster.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/client/cat/render/gl");
const file = readFileSync(resolve(root, "cat.mesh"));
const mesh = decodeMesh(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

const fit = new PoseFit();
const skeleton = new Skeleton(fit.rest);

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false, ...over });

/** A cat in a clip, settled: what the rig has after a second and a half of it. */
function solvedIn(over: Partial<CatFrame>) {
  const rig = new CatRig(3);
  const base = frame(over);
  rig.snapTo(base, 100);
  for (let k = 0; k < 90; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
  return rig.solved;
}

const BONE_PALETTE = Array.from({ length: BONE_COUNT }, (_, b): [number, number, number] => {
  const h = (b * 0.618) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const v = b % 2 ? 1 : 0.72;
  const p = v * 0.2, q = v * (1 - f * 0.8), t = v * (1 - (1 - f) * 0.8);
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]!) as [number, number, number];
});

function skinned(bones: Float32Array): { pos: Float32Array; nor: Float32Array } {
  const n = mesh.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = mesh.pos[v * 3]!, y = mesh.pos[v * 3 + 1]!, z = mesh.pos[v * 3 + 2]!;
    const nx = mesh.normal[v * 3]! / 127, ny = mesh.normal[v * 3 + 1]! / 127, nz = mesh.normal[v * 3 + 2]! / 127;
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weight[v * 4 + k]! / 255;
      if (w === 0) continue;
      const o = mesh.skin[v * 4 + k]! * BONE_FLOATS;
      px += w * (bones[o]! * x + bones[o + 1]! * y + bones[o + 2]! * z + bones[o + 3]!);
      py += w * (bones[o + 4]! * x + bones[o + 5]! * y + bones[o + 6]! * z + bones[o + 7]!);
      pz += w * (bones[o + 8]! * x + bones[o + 9]! * y + bones[o + 10]! * z + bones[o + 11]!);
      qx += w * (bones[o]! * nx + bones[o + 1]! * ny + bones[o + 2]! * nz);
      qy += w * (bones[o + 4]! * nx + bones[o + 5]! * ny + bones[o + 6]! * nz);
      qz += w * (bones[o + 8]! * nx + bones[o + 9]! * ny + bones[o + 10]! * nz);
    }
    pos.set([px, py, pz], v * 3);
    const l = Math.hypot(qx, qy, qz) || 1;
    nor.set([qx / l, qy / l, qz / l], v * 3);
  }
  return { pos, nor };
}

if (process.argv[1]?.endsWith("pose-view.mts")) {
  const specs = (process.argv[3] ?? "stand,walk:0:0,walk:0:0.15,walk:0:0.3,sit,loaf").split(",");
  const W = 700, H = 620;
  const sheet = new Uint8Array(W * specs.length * H * 4);
  const tri = Array.from(mesh.index);
  const colour = new Float64Array(mesh.count * 3);
  const open = new Float32Array(mesh.count);
  for (let v = 0; v < mesh.count; v++) {
    for (let k = 0; k < 3; k++) colour[v * 3 + k] = mesh.color[v * 4 + k]! / 255;
    open[v] = mesh.color[v * 4 + 3]! / 255;
  }
  const boneColour = new Float64Array(mesh.count * 3);
  for (let v = 0; v < mesh.count; v++) {
    for (let k = 0; k < 4; k++) {
      const w = mesh.weight[v * 4 + k]! / 255;
      const c = BONE_PALETTE[mesh.skin[v * 4 + k]!]!;
      for (let i = 0; i < 3; i++) boneColour[v * 3 + i]! += w * c[i]!;
    }
  }
  specs.forEach((spec, i) => {
    const [clip, progress, odo, view, mode] = spec.split(":");
    const s = solvedIn({ clip: clip as CatFrame["clip"], progress: Number(progress ?? 0), odometer: Number(odo ?? 0), drowsy: clip === "curl" ? 1 : 0 });
    const posed = fit.apply(s);
    const bones = new Float32Array(BONE_COUNT * BONE_FLOATS);
    skeleton.solve(posed, 0, mat(), bones);
    const { pos, nor } = skinned(bones);
    const shot: Shot = { view: (view || "side") as ViewName, scale: 460, centre: [-0.3, 0.5], width: W, height: H, grid: 0, ss: 3, label: spec };
    const img = renderSoup({ pos, tri, color: mode === "bones" ? boneColour : colour, normal: nor, open }, shot);
    for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 4, (y + 1) * W * 4), (y * W * specs.length + i * W) * 4);
  });
  writePng(process.argv[2]!, sheet, W * specs.length, H);
}
