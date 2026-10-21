// Makes the cat's mesh from the free model (Meshy AI, "Fluffy Blue Eyed Cat", CC BY 4.0: see reports/kino-cat/06-risk-and-license-register.md). The model is research material and
// lives outside the repository: it is read from the path given, and only what is made of it (the mesh, as its own file) is written to the app.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/model/build-meshy.mts MODEL.glb
//
// What it does: reads the model, puts it in the rig's frame (x forward, y up, feet on the floor), joins the vertices that the file split only to give each its own
// place in a texture, paints each vertex with the colour the texture has there (the eyes are taken out: they are drawn by the shader, which can blink), bakes how open
// to the room each vertex is, skins every vertex to the bones round it (meshy-skin.mts), and writes src/client/cat/render/gl/cat.mesh and model.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openness } from "../glb/bvh.mts";
import { fit, vertexColours } from "../glb/fit.mts";
import { loadSkinned } from "../glb/skinned.mts";
import { encodeMesh } from "../../../src/client/cat/render/gl/format";
import { EYE } from "../../../src/client/cat/render/gl/mouth";
import { modelStamp } from "../../../src/client/cat/render/gl/rest";
import { MESHY_REST } from "./meshy-rest.mts";
import { skinPoints } from "./meshy-skin.mts";
import { modelFile } from "./write-model.mts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../src/client/cat/render/gl");

const input = process.argv[2];
if (!input) throw new Error("usage: build-meshy.mts MODEL.glb");
const model = loadSkinned(input);
const f = fit(model);
const rawColour = vertexColours(model);
const nRaw = f.pos.length / 3;

// ---- join the vertices the file split for its texture: same place, same way of facing, same colour
interface Merged {
  pos: number[];
  nor: number[];
  col: number[];
  n: number[];
}
const byPlace = new Map<string, number[]>();
for (let v = 0; v < nRaw; v++) {
  const key = `${f.pos[v * 3]},${f.pos[v * 3 + 1]},${f.pos[v * 3 + 2]}`;
  const list = byPlace.get(key);
  if (list) list.push(v);
  else byPlace.set(key, [v]);
}
const remap = new Int32Array(nRaw).fill(-1);
const merged: Merged = { pos: [], nor: [], col: [], n: [] };
const NORMAL_SAME = 0.92;
const COLOUR_SAME = 0.07;
for (const list of byPlace.values()) {
  const groups: number[] = [];
  for (const v of list) {
    const nx = f.nor[v * 3]!, ny = f.nor[v * 3 + 1]!, nz = f.nor[v * 3 + 2]!;
    const nl = Math.hypot(nx, ny, nz) || 1;
    let found = -1;
    for (const g of groups) {
      const gl = Math.hypot(merged.nor[g * 3]!, merged.nor[g * 3 + 1]!, merged.nor[g * 3 + 2]!) || 1;
      const dot = (nx * merged.nor[g * 3]! + ny * merged.nor[g * 3 + 1]! + nz * merged.nor[g * 3 + 2]!) / (nl * gl);
      const c = merged.n[g]!;
      const dc = Math.max(
        Math.abs(rawColour[v * 3]! - merged.col[g * 3]! / c),
        Math.abs(rawColour[v * 3 + 1]! - merged.col[g * 3 + 1]! / c),
        Math.abs(rawColour[v * 3 + 2]! - merged.col[g * 3 + 2]! / c),
      );
      if (dot >= NORMAL_SAME && dc <= COLOUR_SAME) {
        found = g;
        break;
      }
    }
    if (found < 0) {
      found = merged.n.length;
      groups.push(found);
      merged.pos.push(f.pos[v * 3]!, f.pos[v * 3 + 1]!, f.pos[v * 3 + 2]!);
      merged.nor.push(nx / nl, ny / nl, nz / nl);
      merged.col.push(rawColour[v * 3]!, rawColour[v * 3 + 1]!, rawColour[v * 3 + 2]!);
      merged.n.push(1);
    } else {
      const c = merged.n[found]!;
      // (running sums: the normal is a sum of unit normals, the colour a sum of colours; both are divided when they are used)
      merged.nor[found * 3]! += nx / nl;
      merged.nor[found * 3 + 1]! += ny / nl;
      merged.nor[found * 3 + 2]! += nz / nl;
      merged.col[found * 3]! += rawColour[v * 3]!;
      merged.col[found * 3 + 1]! += rawColour[v * 3 + 1]!;
      merged.col[found * 3 + 2]! += rawColour[v * 3 + 2]!;
      merged.n[found] = c + 1;
    }
    remap[v] = found;
  }
}
const nV = merged.n.length;
const P = Float32Array.from(merged.pos);
const N = new Float32Array(nV * 3);
const C = new Float64Array(nV * 3);
for (let v = 0; v < nV; v++) {
  const l = Math.hypot(merged.nor[v * 3]!, merged.nor[v * 3 + 1]!, merged.nor[v * 3 + 2]!) || 1;
  for (let k = 0; k < 3; k++) {
    N[v * 3 + k] = merged.nor[v * 3 + k]! / l;
    C[v * 3 + k] = merged.col[v * 3 + k]! / merged.n[v]!;
  }
}
const tri: number[] = [];
for (let t = 0; t < model.tri.length; t += 3) {
  const a = remap[model.tri[t]!]!, b = remap[model.tri[t + 1]!]!, c = remap[model.tri[t + 2]!]!;
  if (a === b || b === c || a === c) continue;
  tri.push(a, b, c);
}
console.log(`vertices ${nRaw} -> ${nV}, triangles ${model.tri.length / 3} -> ${tri.length / 3}`);

// ---- the eyes are drawn by the shader (it blinks them, and they look about): the model's own, painted into its vertices, are taken out and the fur round them is
// carried over them. The same is done to the colour of the pupils: nothing blue is left.
const headX = MESHY_REST.head[0];
const headY = MESHY_REST.head[1];
let neutral = 0;
for (const side of [1, -1]) {
  const ex = headX + EYE.x;
  const ey = headY + EYE.y;
  const ez = side * EYE.z;
  const radius = (v: number): number => Math.hypot((P[v * 3 + 2]! - ez) / (EYE.a * 1.35), (P[v * 3 + 1]! - ey) / (EYE.b * 1.5), (P[v * 3]! - ex) / 0.05);
  // the fur round the eye (from the ring of points just outside the lid, that are not blue)
  const ring = [0, 0, 0];
  let rn = 0;
  for (let v = 0; v < nV; v++) {
    const r = radius(v);
    if (r < 1.25 || r > 2.1) continue;
    if (C[v * 3 + 2]! - C[v * 3]! > 0.08) continue;
    for (let k = 0; k < 3; k++) ring[k]! += C[v * 3 + k]!;
    rn++;
  }
  if (rn === 0) throw new Error("no fur found round an eye: the eye's place is wrong");
  for (let k = 0; k < 3; k++) ring[k]! /= rn;
  for (let v = 0; v < nV; v++) {
    const r = radius(v);
    const w = r < 1 ? 1 : r < 1.25 ? (1.25 - r) / 0.25 : 0;
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) C[v * 3 + k] = C[v * 3 + k]! * (1 - w) + ring[k]! * w;
    neutral++;
  }
}
console.log(`eyes taken out of ${neutral} vertices`);

// ---- the bones round each vertex
const { skin, weight } = skinPoints(P, tri, MESHY_REST);

// ---- how open to the room each vertex is (a fur-covered cat is lit mostly from outside: this is what the creases between tufts and the underside get)
const ao = openness(P, N, tri, 0.06, 32);

// ---- the file
const color = new Uint8Array(nV * 4);
for (let v = 0; v < nV; v++) {
  for (let k = 0; k < 3; k++) color[v * 4 + k] = Math.max(0, Math.min(255, Math.round(C[v * 3 + k]! * 255)));
  color[v * 4 + 3] = Math.max(0, Math.min(255, Math.round(ao[v]! * 255)));
}
const normal = new Int8Array(nV * 3);
for (let i = 0; i < nV * 3; i++) normal[i] = Math.max(-127, Math.min(127, Math.round(N[i]! * 127)));
const lo = [1e9, 1e9, 1e9];
const hi = [-1e9, -1e9, -1e9];
for (let v = 0; v < nV; v++) {
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, P[v * 3 + k]!);
    hi[k] = Math.max(hi[k]!, P[v * 3 + k]!);
  }
}
const bounds = [lo[0]! - 1e-3, lo[1]! - 1e-3, lo[2]! - 1e-3, hi[0]! + 1e-3, hi[1]! + 1e-3, hi[2]! + 1e-3] as const;
const bytes = encodeMesh({ bounds, rest: modelStamp(MESHY_REST), pos: P, normal, skin, weight, color, index: tri });
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "cat.mesh"), bytes);
writeFileSync(resolve(out, "model.ts"), modelFile());
console.log(`cat.mesh: ${bytes.length} bytes, ${nV} vertices, ${tri.length / 3} triangles, bounds ${bounds.map((v) => v.toFixed(3)).join(" ")}`);
