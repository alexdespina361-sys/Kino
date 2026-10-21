import { readGlb, pieces } from "./glb.mts";
const path = process.argv[2]!;
const { json, mesh } = readGlb(path);
console.log("nodes", json.nodes.length, "meshes", json.meshes.length, "materials", (json.materials ?? []).map((m: any) => m.name).join(", "));
console.log("extras", JSON.stringify(json.asset));
console.log("welded vertices", mesh.pos.length / 3, "triangles", mesh.tri.length / 3);
const p = pieces(mesh);
console.log("pieces", p.count);
const order = Array.from({ length: p.count }, (_, i) => i).sort((a, b) => p.tris[b]! - p.tris[a]!);
for (const i of order.slice(0, 40)) {
  const bx = p.box[i]!;
  // the node and material of the first triangle of the piece
  let t0 = 0;
  for (let t = 0; t < p.of.length; t++) if (p.of[t] === i) { t0 = t; break; }
  console.log(String(i).padStart(3), String(p.tris[i]).padStart(6), "tris  node", mesh.node[mesh.nodeOf[t0]!], " mat", mesh.material[t0], " box", bx.map((v) => v.toFixed(4)).join(" "));
}
