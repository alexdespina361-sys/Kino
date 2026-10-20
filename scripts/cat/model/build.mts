// Builds the cat's mesh: the shapes of cat-model.mts are sampled on a lattice, the surface is taken out of that (surface nets), pulled onto the
// true surface, and given what the renderer needs at each point: a normal, how closed in the point is, which bones carry it, which part it is.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/model/build.mts [--voxel=0.0145] [--out=src/client/cat/render/gl/cat.mesh]
//
// Development tooling: only the mesh it writes is part of the app.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BONE_COUNT, restStamp } from "../../../src/client/cat/render/gl/skeleton";
import { encodeMesh } from "../../../src/client/cat/render/gl/format";
import { buildModel, REGION } from "./cat-model.mts";
import { makeField, sample, surfaceNets, type Lattice } from "./sdf.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (name: string, fallback: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const h = Number(arg("voxel", "0.0145"));
const out = resolve(root, arg("out", "src/client/cat/render/gl/cat.mesh"));

const t0 = performance.now();
const model = buildModel();
const field = makeField(model.scene);
const { prims } = model.scene;

const lo = [-0.8, -0.03, -0.2];
const hi = [0.8, 1.13, 0.2];
const lattice: Lattice = { ox: lo[0]!, oy: lo[1]!, oz: lo[2]!, h, nx: Math.ceil((hi[0]! - lo[0]!) / h) + 1, ny: Math.ceil((hi[1]! - lo[1]!) / h) + 1, nz: Math.ceil((hi[2]! - lo[2]!) / h) + 1 };
console.log(`lattice ${lattice.nx} x ${lattice.ny} x ${lattice.nz} (${((lattice.nx * lattice.ny * lattice.nz) / 1e6).toFixed(2)} M), ${prims.length} shapes`);
const values = sample(field, lattice);
console.log(`sampled in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const raw = surfaceNets(values, lattice);
console.log(`surface: ${raw.pos.length / 3} vertices, ${raw.tri.length / 3} triangles`);

/* ------------------------------ pull the points onto the true surface ------------------------------ */
const nV = raw.pos.length / 3;
const pos = new Float64Array(raw.pos);
const grad = (x: number, y: number, z: number): [number, number, number, number] => {
  const e = 0.0022;
  const gx = field(x + e, y, z) - field(x - e, y, z);
  const gy = field(x, y + e, z) - field(x, y - e, z);
  const gz = field(x, y, z + e) - field(x, y, z - e);
  const raw = Math.hypot(gx, gy, gz) / (2 * e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l, raw];
};
for (let v = 0; v < nV; v++) {
  let x = pos[v * 3]!;
  let y = pos[v * 3 + 1]!;
  let z = pos[v * 3 + 2]!;
  for (let it = 0; it < 3; it++) {
    const d = field(x, y, z);
    const [gx, gy, gz, mag] = grad(x, y, z);
    const step = Math.max(-h, Math.min(h, d / Math.max(0.35, mag)));
    x -= gx * step;
    y -= gy * step;
    z -= gz * step;
  }
  pos[v * 3] = x;
  pos[v * 3 + 1] = y;
  pos[v * 3 + 2] = z;
}

/* ------------------------------ which way is out: turn the triangles to face outward, drop what hangs loose ------------------------------ */
const tri = Array.from(raw.tri);
for (let t = 0; t < tri.length; t += 3) {
  const a = tri[t]!;
  const b = tri[t + 1]!;
  const c = tri[t + 2]!;
  const ax = pos[b * 3]! - pos[a * 3]!;
  const ay = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
  const az = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
  const bx = pos[c * 3]! - pos[a * 3]!;
  const by = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
  const bz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const mx = (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3;
  const my = (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3;
  const mz = (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3;
  const [gx, gy, gz] = grad(mx, my, mz);
  if (nx * gx + ny * gy + nz * gz < 0) {
    tri[t + 1] = c;
    tri[t + 2] = b;
  }
}
// connected pieces: keep the big ones
const parent = new Int32Array(nV).map((_, i) => i);
const find = (i: number): number => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
};
for (let t = 0; t < tri.length; t += 3) {
  const a = find(tri[t]!);
  const b = find(tri[t + 1]!);
  const c = find(tri[t + 2]!);
  parent[b] = a;
  parent[c] = a;
}
const size = new Map<number, number>();
for (let v = 0; v < nV; v++) size.set(find(v), (size.get(find(v)) ?? 0) + 1);
const keepPiece = (v: number) => (size.get(find(v)) ?? 0) > 200;
const remap = new Int32Array(nV).fill(-1);
let kept = 0;
for (let v = 0; v < nV; v++) if (keepPiece(v)) remap[v] = kept++;
const dropped = nV - kept;
if (dropped > 0) console.log(`dropped ${dropped} loose vertices in ${new Set([...size.entries()].filter(([, n]) => n <= 200).map(([k]) => k)).size} pieces`);

/* ------------------------------ what each point is ------------------------------ */
const nK = kept;
const P = new Float32Array(nK * 3);
const N = new Int8Array(nK * 3);
const skin = new Uint8Array(nK * 4);
const weight = new Uint8Array(nK * 4);
const paint = new Uint8Array(nK * 4);
const wsum = new Float64Array(BONE_COUNT);
for (let v = 0; v < nV; v++) {
  const k = remap[v]!;
  if (k < 0) continue;
  const x = pos[v * 3]!;
  const y = pos[v * 3 + 1]!;
  const z = pos[v * 3 + 2]!;
  P[k * 3] = x;
  P[k * 3 + 1] = y;
  P[k * 3 + 2] = z;
  const [gx, gy, gz] = grad(x, y, z);
  N[k * 3] = Math.round(gx * 127);
  N[k * 3 + 1] = Math.round(gy * 127);
  N[k * 3 + 2] = Math.round(gz * 127);

  // how open to the room: the field a little way out along the normal, against how far out that is
  let occ = 0;
  let sca = 1;
  for (let i = 1; i <= 5; i++) {
    const hr = 0.008 + (0.06 * i) / 5;
    const dd = field(x + gx * hr, y + gy * hr, z + gz * hr);
    occ += (hr - dd) * sca;
    sca *= 0.8;
  }
  const open = Math.max(0, Math.min(1, 1 - 2.4 * occ));

  // the bones: each shape pulls on its own bone by how near it is
  let dMin = 1e9;
  const ds = new Float64Array(prims.length);
  for (let i = 0; i < prims.length; i++) {
    const d = prims[i]!.d(x, y, z);
    ds[i] = d;
    if (d < dMin) dMin = d;
  }
  wsum.fill(0);
  let fur = 0;
  let total = 0;
  let limbW = 0;
  let limbU = 0;
  for (let i = 0; i < prims.length; i++) {
    const w = Math.exp(-(ds[i]! - dMin) / prims[i]!.tau);
    if (w < 0.004) continue;
    wsum[prims[i]!.bone] = (wsum[prims[i]!.bone] ?? 0) + w;
    fur += prims[i]!.fur * w;
    total += w;
    const part = prims[i]!;
    if (part.region === REGION.foreleg || part.region === REGION.hindleg || part.region === REGION.paw || part.region === REGION.tail) {
      limbW += w;
      limbU += w * (part.u?.(x, y, z) ?? 0);
    }
  }
  const order = Array.from(wsum.keys())
    .filter((b) => wsum[b]! > 0)
    .sort((a, b) => wsum[b]! - wsum[a]!)
    .slice(0, 4);
  let sum = 0;
  for (const b of order) sum += wsum[b]!;
  let given = 0;
  for (let i = 0; i < 4; i++) {
    const b = order[i];
    skin[k * 4 + i] = b ?? 0;
    const w = b === undefined ? 0 : Math.round((wsum[b]! / sum) * 255);
    weight[k * 4 + i] = w;
    given += w;
  }
  weight[k * 4] = weight[k * 4]! + (255 - given);
  paint[k * 4] = Math.round(open * 255);
  paint[k * 4 + 1] = Math.round(Math.max(0, Math.min(2.5, fur / total)) * 100);
  paint[k * 4 + 2] = Math.round(Math.max(0, Math.min(1, limbW > 0 ? limbU / limbW : 0)) * 255);
  paint[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, limbW / total)) * 255);
}

const idx: number[] = [];
for (let t = 0; t < tri.length; t += 3) {
  const a = remap[tri[t]!]!;
  const b = remap[tri[t + 1]!]!;
  const c = remap[tri[t + 2]!]!;
  if (a < 0 || b < 0 || c < 0) continue;
  idx.push(a, b, c);
}
if (nK > 65535) throw new Error(`too many vertices for a 16-bit index: ${nK}`);

let minX = 1e9;
let minY = 1e9;
let minZ = 1e9;
let maxX = -1e9;
let maxY = -1e9;
let maxZ = -1e9;
for (let k = 0; k < nK; k++) {
  minX = Math.min(minX, P[k * 3]!);
  maxX = Math.max(maxX, P[k * 3]!);
  minY = Math.min(minY, P[k * 3 + 1]!);
  maxY = Math.max(maxY, P[k * 3 + 1]!);
  minZ = Math.min(minZ, P[k * 3 + 2]!);
  maxZ = Math.max(maxZ, P[k * 3 + 2]!);
}
const pad = 0.002;
const bounds = [minX - pad, minY - pad, minZ - pad, maxX + pad, maxY + pad, maxZ + pad] as const;

const stampOfRest = restStamp();
const bytes = encodeMesh({ bounds, rest: stampOfRest, pos: P, normal: N, skin, weight, paint, index: idx });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote ${out}: ${nK} vertices, ${idx.length / 3} triangles, ${(bytes.length / 1024).toFixed(0)} KB, rest ${stampOfRest.toString(16)}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
writeFileSync(resolve(root, ".kino-cat/model-info.json"), JSON.stringify({ vertices: nK, triangles: idx.length / 3, bounds, voxel: h }, null, 1));

// what the bones and the shader are told about the model: kept next to the mesh, made by the same run
const r4 = (v: readonly number[]): string => `[${v.map((n) => Number(n.toFixed(4))).join(", ")}]`;
const ear = (e: (typeof model.ears)[number]): string => `{ base: ${r4(e.base)}, a: ${r4(e.a)}, b: ${r4(e.b)}, c: ${r4(e.c)} }`;
writeFileSync(
  resolve(dirname(out), "model.ts"),
  `// Made by scripts/cat/model/build.mts with cat.mesh: do not edit.\n` +
    `/** The centre of the head in the rest (the point it turns about), and the ears: the ear at z < 0, then the one at z > 0. */\n` +
    `export const HEAD_REST = ${r4(model.head)} as const;\n` +
    `export const EARS = [${ear(model.ears[0])}, ${ear(model.ears[1])}] as const;\n` +
    `export const JAW_HINGE = ${r4(model.jawHinge)} as const;\n`,
);

