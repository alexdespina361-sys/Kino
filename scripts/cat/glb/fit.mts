// The skinned model in the rig's frame (x forward, y up, z toward the viewer, the feet on the floor), and the colours it was painted with.
// Development tooling only (the model that is read is research material and lives outside the repository).
import type { Skinned } from "./skinned.mts";

/** The glTF space of the file -> the rig's frame: a scale and a shift (the standing cat's hind leg roots at x = -0.33). */
export const FIT = { s: 0.257, x0: -0.33 };

export interface Fitted {
  pos: Float32Array;
  nor: Float32Array;
  bones: Array<{ name: string; parent: number; head: [number, number, number] }>;
}

export function fit(m: Skinned, s = FIT.s, x0 = FIT.x0): Fitted {
  const nV = m.pos.length / 3;
  let yMin = 1e9;
  for (let v = 0; v < nV; v++) yMin = Math.min(yMin, m.pos[v * 3 + 1]!);
  const hipRootZ = (m.bones.find((b) => b.name === "backleg")!.head[2] + m.bones.find((b) => b.name === "R_backleg")!.head[2]) / 2;
  const conv = (x: number, y: number, z: number): [number, number, number] => [(z - hipRootZ) * 1000 * s + x0, (y - yMin) * 1000 * s, -x * 1000 * s];
  const pos = new Float32Array(nV * 3);
  const nor = new Float32Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    const p = conv(m.pos[v * 3]!, m.pos[v * 3 + 1]!, m.pos[v * 3 + 2]!);
    pos.set(p, v * 3);
    // (a direction: no shift)
    nor.set([m.nor[v * 3 + 2]!, m.nor[v * 3 + 1]!, -m.nor[v * 3]!], v * 3);
  }
  return { pos, nor, bones: m.bones.map((b) => ({ ...b, head: conv(...b.head) })) };
}

/** The colour of each vertex: the texture where the triangles that use it lie, a little way in from the vertex (so that the edge of a patch of the atlas is not taken). */
export function vertexColours(m: Skinned): Float64Array {
  const nV = m.pos.length / 3;
  const acc = new Float64Array(nV * 3);
  const cnt = new Float64Array(nV);
  const tex = m.tex!;
  const at = (u: number, v: number): [number, number, number] => {
    const x = Math.min(tex.w - 1, Math.max(0, Math.round(u * tex.w - 0.5)));
    const y = Math.min(tex.h - 1, Math.max(0, Math.round(v * tex.h - 0.5)));
    const o = (y * tex.w + x) * 4;
    return [tex.rgba[o]! / 255, tex.rgba[o + 1]! / 255, tex.rgba[o + 2]! / 255];
  };
  for (let t = 0; t < m.tri.length; t += 3) {
    const ids = [m.tri[t]!, m.tri[t + 1]!, m.tri[t + 2]!] as const;
    const cu = (m.uv[ids[0] * 2]! + m.uv[ids[1] * 2]! + m.uv[ids[2] * 2]!) / 3;
    const cv = (m.uv[ids[0] * 2 + 1]! + m.uv[ids[1] * 2 + 1]! + m.uv[ids[2] * 2 + 1]!) / 3;
    for (const id of ids) {
      const u = m.uv[id * 2]! + (cu - m.uv[id * 2]!) * 0.3;
      const v = m.uv[id * 2 + 1]! + (cv - m.uv[id * 2 + 1]!) * 0.3;
      const c = at(u, v);
      for (let k = 0; k < 3; k++) acc[id * 3 + k]! += c[k]!;
      cnt[id]!++;
    }
  }
  for (let v = 0; v < nV; v++) for (let k = 0; k < 3; k++) acc[v * 3 + k]! /= cnt[v] || 1;
  return acc;
}
