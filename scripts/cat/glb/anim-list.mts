// Lists the animations a model file carries: name, length, frames, how many bones it moves, and what it moves (rotation, translation, scale).
//   node anim-list.mts MODEL.glb
import { readGlb } from "./glb.mts";

const g = readGlb(process.argv[2]!);
const json = g.json as {
  animations?: Array<{ name?: string; channels: Array<{ sampler: number; target: { node: number; path: string } }>; samplers: Array<{ input: number; output: number; interpolation?: string }> }>;
  accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
  nodes: Array<{ name?: string }>;
};
const anims = json.animations ?? [];
console.log(`${anims.length} animations`);
anims.forEach((a, i) => {
  const nodes = new Set<number>();
  const paths: Record<string, number> = {};
  let dur = 0;
  let frames = 0;
  for (const ch of a.channels) {
    nodes.add(ch.target.node);
    paths[ch.target.path] = (paths[ch.target.path] ?? 0) + 1;
    const s = a.samplers[ch.sampler]!;
    const acc = json.accessors[s.input]!;
    dur = Math.max(dur, acc.max?.[0] ?? 0);
    frames = Math.max(frames, acc.count);
  }
  console.log(`${String(i).padStart(2)} ${(a.name ?? "(unnamed)").padEnd(28)} ${dur.toFixed(2)} s  ${String(frames).padStart(4)} keys  ${String(nodes.size).padStart(2)} bones  ${Object.entries(paths).map(([k, v]) => `${k}:${v}`).join(" ")}  ${a.samplers[0]?.interpolation ?? ""}`);
});
