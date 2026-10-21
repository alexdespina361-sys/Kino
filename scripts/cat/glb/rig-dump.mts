// Prints how a rigged glb is put together: the node tree, the skins (joint lists), the animations (names, lengths, which joints they move) and the meshes.
// Development tooling only (the model that is read is research material and lives outside the repository).
import { readGlb } from "./glb.mts";

const path = process.argv[2]!;
const { json } = readGlb(path);
console.log("asset", JSON.stringify(json.asset));
console.log("extensionsUsed", JSON.stringify(json.extensionsUsed ?? []), "scenes", json.scenes?.length, "nodes", json.nodes.length, "meshes", json.meshes?.length, "skins", json.skins?.length ?? 0, "animations", json.animations?.length ?? 0);
console.log("materials", (json.materials ?? []).map((m: any) => `${m.name}${m.pbrMetallicRoughness?.baseColorTexture ? "(tex)" : ""}`).join(", "));
console.log("images", (json.images ?? []).map((i: any) => `${i.name ?? i.uri ?? "?"}:${i.mimeType ?? ""}`).join(", "));

const nodes: any[] = json.nodes;
const parentOf = new Array<number>(nodes.length).fill(-1);
nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => (parentOf[c] = i)));
const skinJoints = new Set<number>();
for (const s of json.skins ?? []) for (const j of s.joints) skinJoints.add(j);
const show = (i: number, depth: number): void => {
  const n = nodes[i];
  const t = n.translation ? `t(${n.translation.map((v: number) => v.toFixed(3)).join(",")})` : "";
  const r = n.rotation ? `r(${n.rotation.map((v: number) => v.toFixed(3)).join(",")})` : "";
  const s = n.scale ? `s(${n.scale.map((v: number) => v.toFixed(3)).join(",")})` : "";
  const flags = `${n.mesh !== undefined ? " MESH" + n.mesh : ""}${n.skin !== undefined ? " SKIN" + n.skin : ""}${skinJoints.has(i) ? "" : " (not a joint)"}`;
  console.log(`${"  ".repeat(depth)}${i}:${n.name ?? "?"} ${t} ${r} ${s}${flags}`);
  for (const c of n.children ?? []) show(c, depth + 1);
};
const sc = json.scenes[json.scene ?? 0];
for (const r of sc.nodes) show(r, 0);

for (const [i, s] of (json.skins ?? []).entries()) console.log(`skin ${i}: ${s.joints.length} joints, skeleton ${s.skeleton}, ibm accessor ${s.inverseBindMatrices}`);
for (const [i, m] of (json.meshes ?? []).entries()) {
  for (const p of m.primitives) {
    const acc = json.accessors[p.attributes.POSITION];
    console.log(`mesh ${i} ${m.name ?? ""}: attrs ${Object.keys(p.attributes).join(",")} verts ${acc.count} idx ${p.indices !== undefined ? json.accessors[p.indices].count : "-"} mat ${p.material} min ${acc.min?.map((v: number) => v.toFixed(3))} max ${acc.max?.map((v: number) => v.toFixed(3))}${p.targets ? " morphs " + p.targets.length : ""}`);
  }
}
for (const [i, a] of (json.animations ?? []).entries()) {
  let dur = 0;
  const moved = new Set<number>();
  const paths = new Set<string>();
  for (const c of a.channels) {
    const smp = a.samplers[c.sampler];
    const inp = json.accessors[smp.input];
    dur = Math.max(dur, inp.max?.[0] ?? 0);
    moved.add(c.target.node);
    paths.add(c.target.path);
  }
  console.log(`anim ${i} "${a.name}": ${dur.toFixed(2)} s, ${a.channels.length} channels, ${moved.size} nodes, ${[...paths].join("/")}, keys ${json.accessors[a.samplers[0].input].count}`);
}
