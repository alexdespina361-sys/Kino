// A small reader for binary glTF (.glb): the triangles of every mesh in the scene, in world space, with their positions welded so that the pieces of
// a model can be told apart. Development tooling only (the model that is read is research material and lives outside the repository).
import { readFileSync } from "node:fs";

export interface GlbMesh {
  /** Welded positions, three numbers per vertex (glTF's own axes: y up). */
  pos: Float64Array;
  /** Triangle corners, indices into pos. */
  tri: Uint32Array;
  /** The material of each triangle (an index into the file's materials, -1 for none). */
  material: Int16Array;
  /** The mesh each triangle came from (the node's name), by triangle. */
  node: string[];
  nodeOf: Uint16Array;
}

type Json = Record<string, any>;

export function readGlb(path: string): { json: Json; mesh: GlbMesh } {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  let off = 12;
  let json: Json | null = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error("glb without json or bin");
  const b = bin;
  const bytesOf = (acc: Json): { view: DataView; stride: number; count: number; ctype: number; n: number; offset: number } => {
    const bv = json!.bufferViews[acc.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type as string]!;
    const csize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType as number]!;
    return { view: new DataView(b.buffer, b.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), bv.byteLength), stride: bv.byteStride ?? n * csize, count: acc.count, ctype: acc.componentType, n, offset: 0 };
  };
  const readAcc = (index: number): Float64Array => {
    const acc = json!.accessors[index];
    const { view, stride, count, ctype, n } = bytesOf(acc);
    const out = new Float64Array(count * n);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < n; k++) {
        const o = i * stride + k * ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[ctype] ?? 4);
        out[i * n + k] = ctype === 5126 ? view.getFloat32(o, true) : ctype === 5125 ? view.getUint32(o, true) : ctype === 5123 ? view.getUint16(o, true) : ctype === 5121 ? view.getUint8(o) : ctype === 5122 ? view.getInt16(o, true) : view.getInt8(o);
      }
    }
    return out;
  };

  const ident = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mulM = (a: number[], c: number[]): number[] => {
    const o = new Array<number>(16).fill(0);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) o[col * 4 + row]! += a[k * 4 + row]! * c[col * 4 + k]!;
    return o;
  };
  const local = (node: Json): number[] => {
    if (node.matrix) return node.matrix as number[];
    const t = node.translation ?? [0, 0, 0];
    const q = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    const [x, y, z, w] = q as [number, number, number, number];
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
    return [r[0]! * s[0], r[1]! * s[0], r[2]! * s[0], 0, r[4]! * s[1], r[5]! * s[1], r[6]! * s[1], 0, r[8]! * s[2], r[9]! * s[2], r[10]! * s[2], 0, t[0], t[1], t[2], 1];
  };

  const weld = new Map<string, number>();
  const pos: number[] = [];
  const tri: number[] = [];
  const material: number[] = [];
  const nodeOf: number[] = [];
  const names: string[] = [];
  const key = (x: number, y: number, z: number): string => `${Math.round(x * 1e7)},${Math.round(y * 1e7)},${Math.round(z * 1e7)}`;
  const visit = (index: number, parent: number[]): void => {
    const node = json!.nodes[index];
    const m = mulM(parent, local(node));
    if (node.mesh !== undefined) {
      const nodeIndex = names.push(node.name ?? `node${index}`) - 1;
      for (const prim of json!.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const p = readAcc(prim.attributes.POSITION);
        const ids = prim.indices !== undefined ? readAcc(prim.indices) : Float64Array.from({ length: p.length / 3 }, (_, i) => i);
        const map = new Int32Array(p.length / 3);
        for (let v = 0; v < p.length / 3; v++) {
          const x = p[v * 3]!;
          const y = p[v * 3 + 1]!;
          const z = p[v * 3 + 2]!;
          const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
          const k = key(wx, wy, wz);
          let id = weld.get(k);
          if (id === undefined) {
            id = pos.length / 3;
            weld.set(k, id);
            pos.push(wx, wy, wz);
          }
          map[v] = id;
        }
        for (let i = 0; i + 2 < ids.length; i += 3) {
          const a = map[ids[i]!]!;
          const c = map[ids[i + 1]!]!;
          const d = map[ids[i + 2]!]!;
          if (a === c || c === d || a === d) continue;
          tri.push(a, c, d);
          material.push(prim.material ?? -1);
          nodeOf.push(nodeIndex);
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const n of scene.nodes) visit(n, ident());
  return { json, mesh: { pos: Float64Array.from(pos), tri: Uint32Array.from(tri), material: Int16Array.from(material), node: names, nodeOf: Uint16Array.from(nodeOf) } };
}

/** The connected pieces of a mesh (welded): for each triangle, the piece it is in, and the pieces' sizes. */
export function pieces(mesh: GlbMesh): { of: Int32Array; count: number; tris: number[]; box: number[][] } {
  const nV = mesh.pos.length / 3;
  const parent = new Int32Array(nV).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let t = 0; t < mesh.tri.length; t += 3) {
    const a = find(mesh.tri[t]!);
    parent[find(mesh.tri[t + 1]!)] = a;
    parent[find(mesh.tri[t + 2]!)] = a;
  }
  const ids = new Map<number, number>();
  const of = new Int32Array(mesh.tri.length / 3);
  const tris: number[] = [];
  const box: number[][] = [];
  for (let t = 0; t < of.length; t++) {
    const r = find(mesh.tri[t * 3]!);
    let id = ids.get(r);
    if (id === undefined) {
      id = ids.size;
      ids.set(r, id);
      tris.push(0);
      box.push([1e9, 1e9, 1e9, -1e9, -1e9, -1e9]);
    }
    of[t] = id;
    tris[id]!++;
    for (let k = 0; k < 3; k++) {
      const v = mesh.tri[t * 3 + k]!;
      const bx = box[id]!;
      for (let a = 0; a < 3; a++) {
        bx[a] = Math.min(bx[a]!, mesh.pos[v * 3 + a]!);
        bx[3 + a] = Math.max(bx[3 + a]!, mesh.pos[v * 3 + a]!);
      }
    }
  }
  return { of, count: ids.size, tris, box };
}
