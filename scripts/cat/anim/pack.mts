// Packs the cat's clips into src/client/cat/render/gl/cat.clips: the clips of the model's own artist (its walk) and the ones made for its bones from other sources
// (scripts/cat/anim/retarget.mts), each measured for the ground it covers (gait.mts), for the renderer (pose.ts, clipfile.ts) to play.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/anim/pack.mts MODEL.glb [more/clips.json ...]
//
// The mesh (cat.mesh) must be built first: the clips are made for the bones in it, and the file says which (a stamp of their names and rest).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeClips, encodeClips, type ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { Skeleton } from "../../../src/client/cat/render/gl/pose";
import { readMeshySkeleton } from "../model/meshy-skeleton.mts";
import { analyseGait, restPads, soleVertices } from "./gait.mts";
import { groundGait } from "./ground.mts";

const here = dirname(fileURLToPath(import.meta.url));
const gl = resolve(here, "../../../src/client/cat/render/gl");

const glb = process.argv[2];
if (!glb) throw new Error("usage: pack.mts MODEL.glb");
const file = readFileSync(resolve(gl, "cat.mesh"));
const mesh = decodeMesh(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const data = mesh.skeleton;
const skeleton = new Skeleton(data);
const M = readMeshySkeleton(glb);
const soles = soleVertices(mesh, skeleton);
const rest = restPads(mesh, skeleton, soles);
console.log(`sole vertices per paw: ${soles.map((s) => s.length).join(" ")}; pads at rest (x, y): ${rest.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(3)}`).join("  ")}`);

/** The artist's clip, for the mesh's bones: the model's own bones have their numbers, the bones added to it (jaw, ears) keep their rest. */
function artistClip(name: string, frames: number, loop: boolean): ClipSource {
  const src = M.clip(name, frames, 30, (f) => f / 30);
  const r: ClipSource["r"] = [];
  const t: ClipSource["t"] = [];
  for (const bone of data.names) {
    const k = M.fileData.names.indexOf(bone);
    r.push(k >= 0 ? src.r[k]! : null);
    t.push(k >= 0 ? src.t[k]! : null);
  }
  return { name, fps: 30, frames, loop, r, t };
}

/** A gait that was not made against a floor, put on one (ground.mts). */
function grounded(source: ClipSource): ClipSource {
  const { source: out, fit } = groundGait(mesh, skeleton, source, soles);
  console.log(
    `${source.name}: grounded: hips ${fit.lift >= 0 ? "raised" : "lowered"} by ${Math.abs(fit.lift).toFixed(3)}, pitched ${((fit.pitch * 180) / Math.PI).toFixed(2)} deg; the paws that are down were ${fit.before.toFixed(3)} off the floor, now ${fit.after.toFixed(3)}; lowest paw point ${fit.lowestBefore.toFixed(3)} -> ${fit.lowestAfter.toFixed(3)} (a negative one is through the floor)`,
  );
  return out;
}

const sources: ClipSource[] = [
  // (the file's walk is thirty-one keys, the last the first again: a loop is the thirty before it)
  grounded(artistClip("walk", 30, true)),
];

/** Measures the clips as they will be played (through the codec) and puts what was measured in them. */
function measured(list: ClipSource[]): ClipSource[] {
  const bytes = encodeClips(data, list);
  const clips = decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton);
  return list.map((source, i) => {
    const clip = clips[i]!;
    const kind = source.name;
    if (!["walk", "run", "stalk"].includes(kind)) return source;
    const gait = analyseGait(mesh, skeleton, clip, soles);
    console.log(`${kind}: ${gait.speed.toFixed(2)} body lengths/s, stride ${gait.stride.toFixed(3)} body lengths a cycle (the most a paw slides while down: ${gait.slide.toFixed(3)})`);
    gait.paws.forEach((p, k) =>
      console.log(`  ${p.name.padEnd(12)} down on ${p.down.filter(Boolean).length} of ${clip.frames} frames, lands at frame ${p.lands}, slides ${p.slide.toFixed(3)}, pad ${p.floor.toFixed(3)} +- ${p.scatter.toFixed(3)} (at rest ${rest[k]![1].toFixed(3)})`),
    );
    const marks: Record<string, number> = {};
    for (const p of gait.paws) if (p.lands >= 0) marks[`land:${p.name}`] = p.lands / clip.fps;
    return { ...source, stride: gait.stride, marks };
  });
}

const packed = measured(sources);
const out = encodeClips(data, packed);
writeFileSync(resolve(gl, "cat.clips"), out);
console.log(`${packed.length} clips, ${out.length} bytes -> cat.clips (bones: ${data.names.length})`);
