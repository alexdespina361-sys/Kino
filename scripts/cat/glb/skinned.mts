// Reads a skinned glb: the one mesh with its normals, uvs, bone weights, the skeleton's bind pose (from the inverse bind matrices) and the base colour texture.
// Development tooling only (the model that is read is research material and lives outside the repository).
import { readGlb } from "./glb.mts";
import { readPng, type Png } from "./png.mts";

export interface Bone {
  name: string;
  /** Index into the bones (the skin's own order), -1 for a root. */
  parent: number;
  /** Where the bone's joint is in the bind pose, in the space of the mesh's vertices. */
  head: [number, number, number];
}

export interface Skinned {
  /** Three numbers per vertex, in the glTF file's own space. */
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  /** Four bone indices (into `bones`) and four weights per vertex. */
  joints: Uint16Array;
  weights: Float32Array;
  tri: Uint32Array;
  bones: Bone[];
  tex: Png | null;
}

/** The inverse of an affine matrix given column by column (the last row 0 0 0 1). */
function invertAffine(m: ArrayLike<number>): number[] {
  const a = m[0]!, b = m[4]!, c = m[8]!;
  const d = m[1]!, e = m[5]!, f = m[9]!;
  const g = m[2]!, h = m[6]!, i = m[10]!;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const k = 1 / det;
  const r = [
    (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
    (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
  ];
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  // columns: x axis (r00, r10, r20) ...
  return [r[0]!, r[3]!, r[6]!, 0, r[1]!, r[4]!, r[7]!, 0, r[2]!, r[5]!, r[8]!, 0, -(r[0]! * tx + r[1]! * ty + r[2]! * tz), -(r[3]! * tx + r[4]! * ty + r[5]! * tz), -(r[6]! * tx + r[7]! * ty + r[8]! * tz), 1];
}

export function loadSkinned(path: string): Skinned {
  const { json, bin, acc } = readGlb(path);
  const nodes: any[] = json.nodes;
  const meshNode = nodes.find((n) => n.skin !== undefined && n.mesh !== undefined);
  if (!meshNode) throw new Error("no skinned mesh in the file");
  const skin = json.skins[meshNode.skin];
  const prims = json.meshes[meshNode.mesh].primitives;
  if (prims.length !== 1) throw new Error(`expected one primitive, got ${prims.length}`);
  const prim = prims[0];
  const at = prim.attributes;
  const pos = Float32Array.from(acc(at.POSITION));
  const nor = Float32Array.from(acc(at.NORMAL));
  const uv = Float32Array.from(acc(at.TEXCOORD_0));
  const nV = pos.length / 3;
  const joints = Uint16Array.from(acc(at.JOINTS_0));
  const wAcc = json.accessors[at.WEIGHTS_0];
  const wRaw = acc(at.WEIGHTS_0);
  const wScale = wAcc.componentType === 5121 ? 1 / 255 : wAcc.componentType === 5123 ? 1 / 65535 : 1;
  const weights = Float32Array.from(wRaw, (v) => v * wScale);
  const tri = Uint32Array.from(acc(prim.indices));
  if (joints.length !== nV * 4 || weights.length !== nV * 4) throw new Error("expected four influences per vertex");

  const ibm = acc(skin.inverseBindMatrices);
  const parentNode = new Map<number, number>();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parentNode.set(c, i)));
  const jointOfNode = new Map<number, number>();
  (skin.joints as number[]).forEach((n, j) => jointOfNode.set(n, j));
  const bones: Bone[] = (skin.joints as number[]).map((n, j) => {
    const inv = invertAffine(ibm.subarray(j * 16, j * 16 + 16));
    return { name: nodes[n].name ?? `joint${j}`, parent: jointOfNode.get(parentNode.get(n) ?? -1) ?? -1, head: [inv[12]!, inv[13]!, inv[14]!] };
  });

  let tex: Png | null = null;
  const mat = json.materials?.[prim.material ?? 0];
  const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texIndex !== undefined) {
    const image = json.images[json.textures[texIndex].source];
    const bv = json.bufferViews[image.bufferView];
    tex = readPng(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  }
  return { pos, nor, uv, joints, weights, tri, bones, tex };
}
