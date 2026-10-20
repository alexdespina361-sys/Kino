/**
 * The cat's mesh as a file: what scripts/cat/model/build.mts writes and the renderer loads. Little-endian; the arrays follow the header one
 * after the other, each starting on a multiple of four bytes.
 *
 *   header  16 x 4 bytes: magic, version, vertex count, index count, bounds (min x y z, max x y z), a stamp of the rest pose it was made around,
 *           the length of the index stream in bytes, spare
 *   pos     vertex count x 3 int16, over the bounds
 *   normal  vertex count x 3 int8
 *   skin    vertex count x 4 uint8: bone numbers
 *   weight  vertex count x 4 uint8: their weights, which add up to 255
 *   paint   vertex count x 4 uint8: how open to the room the skin is here (0 closed), the length of the fur, how far along the part, how much of a limb
 *   index   the triangles, in the order of their lowest vertex, each as three numbers in a stream of varints (7 bits to a byte, the high bit says
 *           there is more): the first vertex as a step from the first vertex of the triangle before it, the other two as steps from the first. The
 *           vertices of a surface that was cut out of a lattice are numbered along it, so the steps are small and a triangle is a few bytes
 */

export const MESH_MAGIC = 0x5441434b; // "KCAT"
export const MESH_VERSION = 2;

export interface CatMesh {
  count: number;
  bounds: readonly [number, number, number, number, number, number];
  /** A number that is made of the rest pose the mesh was built around: the bones are no good with a mesh that was made around another. */
  rest: number;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  paint: Uint8Array;
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

export function encodeMesh(mesh: {
  bounds: readonly [number, number, number, number, number, number];
  rest: number;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  paint: Uint8Array;
  index: ArrayLike<number>;
}): Uint8Array {
  const count = mesh.pos.length / 3;
  const index = packIndex(mesh.index);
  const parts = [count * 6, count * 3, count * 4, count * 4, count * 4].map(pad4);
  const head = 64;
  const total = head + parts.reduce((a, b) => a + b, 0) + index.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, MESH_MAGIC, true);
  view.setUint32(4, MESH_VERSION, true);
  view.setUint32(8, count, true);
  view.setUint32(12, mesh.index.length, true);
  mesh.bounds.forEach((v, i) => view.setFloat32(16 + i * 4, v, true));
  view.setUint32(40, mesh.rest >>> 0, true);
  view.setUint32(44, index.length, true);
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
  new Uint8Array(buffer, at, count * 4).set(mesh.paint);
  at += parts[4]!;
  new Uint8Array(buffer, at, index.length).set(index);
  return new Uint8Array(buffer);
}

export function decodeMesh(data: ArrayBuffer): CatMesh {
  const view = new DataView(data);
  if (data.byteLength < 64 || view.getUint32(0, true) !== MESH_MAGIC) throw new Error("not a cat mesh");
  if (view.getUint32(4, true) !== MESH_VERSION) throw new Error("a cat mesh of another version");
  const count = view.getUint32(8, true);
  const indices = view.getUint32(12, true);
  const indexBytes = view.getUint32(44, true);
  const bounds = [0, 1, 2, 3, 4, 5].map((i) => view.getFloat32(16 + i * 4, true)) as unknown as CatMesh["bounds"];
  const rest = view.getUint32(40, true);
  const parts = [count * 6, count * 3, count * 4, count * 4, count * 4].map(pad4);
  let at = 64;
  if (at + parts.reduce((a, b) => a + b, 0) + indexBytes > data.byteLength || indices % 3 !== 0) throw new Error("a cat mesh that is cut short");
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
  const paint = new Uint8Array(data, at, count * 4);
  at += parts[4]!;
  const index = unpackIndex(new Uint8Array(data, at, indexBytes), indices);
  return { count, bounds, rest, pos, normal, skin, weight, paint, index };
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
