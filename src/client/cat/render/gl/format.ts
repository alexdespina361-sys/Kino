import { skeletonStamp } from "./clipfile";
import type { SkeletonData } from "./pose";

/**
 * The cat's mesh as a file: what scripts/cat/model/build-meshy.mts writes and the renderer loads. Little-endian; the arrays follow the header one
 * after the other, each starting on a multiple of four bytes.
 *
 *   header   16 x 4 bytes: magic, version, vertex count, index count, bounds (min x y z, max x y z), a stamp of the skeleton it is skinned to, the length of
 *            the index stream in bytes, the length of the skeleton in bytes, spare
 *   pos      vertex count x 3 int16, over the bounds
 *   normal   vertex count x 3 int8
 *   skin     vertex count x 4 uint8: bone numbers
 *   weight   vertex count x 4 uint8: their weights, which add up to 255
 *   color    vertex count x 4 uint8: the coat's colour here (red, green, blue, as the model was painted) and how open to the room the skin is (0 closed)
 *   part     vertex count x 4 uint8: what part of the cat a point is (the coats of other cats are painted by it): how much of it is a leg, how much the tail,
 *            how far along the tail, and how much of it the legs on the cat's left side
 *   index    the triangles, in the order of their lowest vertex, each as three numbers in a stream of varints (7 bits to a byte, the high bit says
 *            there is more): the first vertex as a step from the first vertex of the triangle before it, the other two as steps from the first. The
 *            vertices of a surface are numbered along it, so the steps are small and a triangle is a few bytes
 *   skeleton the bones the mesh is skinned to, in JSON (names, parents, and where each joint is against its parent's and the turn it has there)
 */

export const MESH_MAGIC = 0x5441434b; // "KCAT"
export const MESH_VERSION = 4;

export interface CatMesh {
  count: number;
  bounds: readonly [number, number, number, number, number, number];
  /** The bones the mesh is skinned to: clips are made for them (clipfile.ts), and a mesh is no good with clips that were made for other bones. */
  skeleton: SkeletonData;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  color: Uint8Array;
  part: Uint8Array;
  index: Uint16Array;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** A signed number as an unsigned one that is small when it is: 0, -1, 1, -2, 2 ... are 0, 1, 2, 3, 4 ... */
const zigzag = (n: number): number => (n < 0 ? -2 * n - 1 : 2 * n);
const unzigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function putVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 128) {
    out.push((v % 128) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** The triangles as the index stream (see above); the triangles are put in the order of their lowest vertex, which the stream is shortest in. */
export function packIndex(index: ArrayLike<number>): Uint8Array {
  const tris: [number, number, number][] = [];
  for (let i = 0; i + 2 < index.length; i += 3) tris.push([index[i]!, index[i + 1]!, index[i + 2]!]);
  tris.sort((p, q) => Math.min(...p) - Math.min(...q) || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const out: number[] = [];
  let before = 0;
  for (const [a, b, c] of tris) {
    putVarint(out, zigzag(a - before));
    putVarint(out, zigzag(b - a));
    putVarint(out, zigzag(c - a));
    before = a;
  }
  return Uint8Array.from(out);
}

export function unpackIndex(bytes: Uint8Array, count: number): Uint16Array {
  const out = new Uint16Array(count);
  let at = 0;
  const next = (): number => {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (at >= bytes.length) throw new Error("a cat mesh that ends in the middle of its triangles");
      const byte = bytes[at++]!;
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  };
  let before = 0;
  for (let i = 0; i < count; i += 3) {
    const a = before + unzigzag(next());
    out[i] = a;
    out[i + 1] = a + unzigzag(next());
    out[i + 2] = a + unzigzag(next());
    before = a;
  }
  return out;
}

/** The skeleton as it is kept in the file: the numbers to a millionth (so that clips are made for the skeleton as it is read back, not as it was before it was written). */
export const keptSkeleton = (data: SkeletonData): SkeletonData => ({
  names: data.names.slice(),
  parent: data.parent.slice(),
  restT: data.restT.map((v) => Math.round(v * 1e6) / 1e6),
  restR: data.restR.map((v) => Math.round(v * 1e6) / 1e6),
});

export function encodeMesh(mesh: {
  bounds: readonly [number, number, number, number, number, number];
  skeleton: SkeletonData;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  color: Uint8Array;
  part: Uint8Array;
  index: ArrayLike<number>;
}): Uint8Array {
  const count = mesh.pos.length / 3;
  const index = packIndex(mesh.index);
  const kept = keptSkeleton(mesh.skeleton);
  const skeleton = new TextEncoder().encode(JSON.stringify(kept));
  const parts = [count * 6, count * 3, count * 4, count * 4, count * 4, count * 4].map(pad4);
  const head = 64;
  const indexAt = head + parts.reduce((a, b) => a + b, 0);
  const total = indexAt + pad4(index.length) + skeleton.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, MESH_MAGIC, true);
  view.setUint32(4, MESH_VERSION, true);
  view.setUint32(8, count, true);
  view.setUint32(12, mesh.index.length, true);
  mesh.bounds.forEach((v, i) => view.setFloat32(16 + i * 4, v, true));
  view.setUint32(40, skeletonStamp(kept) >>> 0, true);
  view.setUint32(44, index.length, true);
  view.setUint32(48, skeleton.length, true);
  let at = head;
  const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.bounds;
  const pos = new Int16Array(buffer, at, count * 3);
  for (let i = 0; i < count; i++) {
    const x = mesh.pos[i * 3]!;
    const y = mesh.pos[i * 3 + 1]!;
    const z = mesh.pos[i * 3 + 2]!;
    pos[i * 3] = Math.round(((x - minX) / (maxX - minX)) * 65535 - 32768);
    pos[i * 3 + 1] = Math.round(((y - minY) / (maxY - minY)) * 65535 - 32768);
    pos[i * 3 + 2] = Math.round(((z - minZ) / (maxZ - minZ)) * 65535 - 32768);
  }
  at += parts[0]!;
  new Int8Array(buffer, at, count * 3).set(mesh.normal);
  at += parts[1]!;
  new Uint8Array(buffer, at, count * 4).set(mesh.skin);
  at += parts[2]!;
  new Uint8Array(buffer, at, count * 4).set(mesh.weight);
  at += parts[3]!;
  new Uint8Array(buffer, at, count * 4).set(mesh.color);
  at += parts[4]!;
  new Uint8Array(buffer, at, count * 4).set(mesh.part);
  at += parts[5]!;
  new Uint8Array(buffer, at, index.length).set(index);
  at += pad4(index.length);
  new Uint8Array(buffer, at, skeleton.length).set(skeleton);
  return new Uint8Array(buffer);
}

export function decodeMesh(data: ArrayBuffer): CatMesh {
  const view = new DataView(data);
  if (data.byteLength < 64 || view.getUint32(0, true) !== MESH_MAGIC) throw new Error("not a cat mesh");
  if (view.getUint32(4, true) !== MESH_VERSION) throw new Error("a cat mesh of another version");
  const count = view.getUint32(8, true);
  const indices = view.getUint32(12, true);
  const indexBytes = view.getUint32(44, true);
  const skeletonBytes = view.getUint32(48, true);
  const bounds = [0, 1, 2, 3, 4, 5].map((i) => view.getFloat32(16 + i * 4, true)) as unknown as CatMesh["bounds"];
  const stampWas = view.getUint32(40, true);
  const parts = [count * 6, count * 3, count * 4, count * 4, count * 4, count * 4].map(pad4);
  let at = 64;
  if (at + parts.reduce((a, b) => a + b, 0) + pad4(indexBytes) + skeletonBytes > data.byteLength || indices % 3 !== 0) throw new Error("a cat mesh that is cut short");
  const quantised = new Int16Array(data, at, count * 3);
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = ((quantised[i * 3]! + 32768) / 65535) * (maxX - minX) + minX;
    pos[i * 3 + 1] = ((quantised[i * 3 + 1]! + 32768) / 65535) * (maxY - minY) + minY;
    pos[i * 3 + 2] = ((quantised[i * 3 + 2]! + 32768) / 65535) * (maxZ - minZ) + minZ;
  }
  at += parts[0]!;
  const normal = new Int8Array(data, at, count * 3);
  at += parts[1]!;
  const skin = new Uint8Array(data, at, count * 4);
  at += parts[2]!;
  const weight = new Uint8Array(data, at, count * 4);
  at += parts[3]!;
  const color = new Uint8Array(data, at, count * 4);
  at += parts[4]!;
  const part = new Uint8Array(data, at, count * 4);
  at += parts[5]!;
  const index = unpackIndex(new Uint8Array(data, at, indexBytes), indices);
  at += pad4(indexBytes);
  const skeleton = JSON.parse(new TextDecoder().decode(new Uint8Array(data, at, skeletonBytes))) as SkeletonData;
  if (skeletonStamp(skeleton) !== stampWas) throw new Error("a cat mesh whose skeleton is not the one it was made for");
  return { count, bounds, skeleton, pos, normal, skin, weight, color, part, index };
}

/** A small number made of numbers, for telling whether two rest poses are the same one. */
export function stamp(values: readonly number[]): number {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
