// The numbers that can be had of a clip before a person looks at it: does the body hold together (integrity.mts), is the cat on the floor and not through it, does a bone jump from one
// frame to the next, does a loop close. Nothing here says a clip is good (that is for blind eyes); it says which clips are not fit to be shown yet, and why.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/anim/qa.mts <clips-file> [--only=a,b] [--json=out.json] [--mesh=cat.mesh]
//
// Development tooling: nothing in the app imports it.
import { readFileSync, writeFileSync } from "node:fs";
import { decodeClips } from "../../../src/client/cat/render/gl/clipfile";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { Pose, Skeleton, sampleFrame, solveDual, type Clip } from "../../../src/client/cat/render/gl/pose";
import { reach } from "./floor.mts";
import { IntegrityMeter } from "./integrity.mts";

const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error("usage: qa.mts <clips-file> [--only=a,b] [--json=out.json] [--mesh=cat.mesh]");
const flag = (name: string, fallback: string): string => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const only = flag("only", "").split(",").filter(Boolean);
const read = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const mesh = decodeMesh(read(flag("mesh", "src/client/cat/render/gl/cat.mesh")));
const skeleton = new Skeleton(mesh.skeleton);
const clips = decodeClips(read(file), skeleton).filter((c) => only.length === 0 || only.includes(c.name));
const meter = new IntegrityMeter(mesh, skeleton, "dual");

const skin = new Float32Array(skeleton.count * 12);
const ys = new Float32Array(mesh.count);
const restFloor = reach(mesh, skeleton, new Pose(skeleton), skin, ys);

/** The angle (degrees) between two turns. */
function between(a: Pose, b: Pose, j: number): number {
  const d = Math.abs(a.r[j * 4]! * b.r[j * 4]! + a.r[j * 4 + 1]! * b.r[j * 4 + 1]! + a.r[j * 4 + 2]! * b.r[j * 4 + 2]! + a.r[j * 4 + 3]! * b.r[j * 4 + 3]!);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

const dq = new Float32Array(skeleton.count * 8);
/**
 * A point that two bones carry (each by a tenth or more) which are turned a half turn or more from each other (their quaternions, as the card has them, a dot product under a
 * twentieth) is blended through nothing, and what it is then depends on the weights to the last digit: two points side by side are far apart. The share of points like that.
 */
function hazardOf(pose: Pose): number {
  solveDual(skeleton, pose, dq);
  let bad = 0;
  for (let v = 0; v < mesh.count; v++) {
    let hit = false;
    for (let a = 0; a < 4 && !hit; a++) {
      if (mesh.weight[v * 4 + a]! < 26) continue;
      const oa = mesh.skin[v * 4 + a]! * 8;
      for (let b = a + 1; b < 4; b++) {
        if (mesh.weight[v * 4 + b]! < 26) continue;
        const ob = mesh.skin[v * 4 + b]! * 8;
        if (dq[oa]! * dq[ob]! + dq[oa + 1]! * dq[ob + 1]! + dq[oa + 2]! * dq[ob + 2]! + dq[oa + 3]! * dq[ob + 3]! < 0.05) {
          hit = true;
          break;
        }
      }
    }
    if (hit) bad++;
  }
  return bad / mesh.count;
}

export interface Report {
  name: string;
  frames: number;
  seconds: number;
  loop: boolean;
  stretch99: number;
  area1: number;
  flipped: number;
  volumeLow: number;
  volumeHigh: number;
  /** How far under the floor the cat's lowest part goes at worst, and how far over it at worst (body lengths). */
  sink: number;
  float: number;
  /** The most vertices at one frame that carry two bones which are turned so far from each other that their blend is a guess, as a share of all (see `hazardOf`). */
  hazard: number;
  /** The biggest turn of any bone between two frames (degrees), the bone and the frame; and for a loop the turn at the seam. */
  pop: number;
  popBone: string;
  popFrame: number;
  seam: number;
}

function check(clip: Clip): Report {
  const integrity = meter.clip(clip);
  const a = new Pose(skeleton);
  const b = new Pose(skeleton);
  let sink = 0;
  let float = 0;
  let pop = 0;
  let popBone = "";
  let popFrame = 0;
  let seam = 0;
  const steps = clip.loop ? clip.frames : clip.frames - 1;
  let hazard = 0;
  for (let f = 0; f < clip.frames; f++) {
    sampleFrame(clip, f, a);
    const low = reach(mesh, skeleton, a, skin, ys);
    sink = Math.max(sink, restFloor - low);
    float = Math.max(float, low - restFloor);
    hazard = Math.max(hazard, hazardOf(a));
  }
  for (let f = 0; f < steps; f++) {
    sampleFrame(clip, f, a);
    sampleFrame(clip, (f + 1) % clip.frames, b);
    for (let j = 0; j < skeleton.count; j++) {
      const d = between(a, b, j);
      if (clip.loop && f === steps - 1) seam = Math.max(seam, d);
      else if (d > pop) {
        pop = d;
        popBone = skeleton.names[j]!;
        popFrame = f;
      }
    }
  }
  return {
    name: clip.name,
    frames: clip.frames,
    seconds: clip.loop ? clip.frames / clip.fps : (clip.frames - 1) / clip.fps,
    loop: clip.loop,
    stretch99: integrity.worst.stretch99,
    area1: integrity.worst.area1,
    flipped: integrity.worst.flipped,
    volumeLow: integrity.worst.volumeLow,
    volumeHigh: integrity.worst.volumeHigh,
    sink,
    float,
    hazard,
    pop,
    popBone,
    popFrame,
    seam,
  };
}

const rows = clips.map(check);
const n = (v: number, d = 2, w = 6): string => v.toFixed(d).padStart(w);
console.log(`${file}: ${rows.length} clips (the floor at rest is ${restFloor.toFixed(3)})`);
console.log("clip".padEnd(10) + "frames".padStart(7) + "   s".padStart(6) + " loop " + "stretch99".padStart(10) + "area1".padStart(7) + "flip".padStart(7) + " volume".padStart(14) + "  sink".padStart(8) + " float".padStart(7) + " hazard".padStart(8) + "   pop".padStart(7) + "  seam".padStart(7) + "  worst bone");
for (const r of rows) {
  console.log(
    r.name.padEnd(10) + String(r.frames).padStart(7) + n(r.seconds, 1, 6) + (r.loop ? " loop " : " once ") + n(r.stretch99, 3, 10) + n(r.area1, 2, 7) + n(r.flipped, 3, 7) + ` ${r.volumeLow.toFixed(2)}..${r.volumeHigh.toFixed(2)}`.padStart(14) + n(r.sink, 3, 8) + n(r.float, 3, 7) + n(r.hazard, 3, 8) + n(r.pop, 1, 7) + n(r.seam, 1, 7) + `  ${r.popBone}@${r.popFrame}`,
  );
}
const json = flag("json", "");
if (json) writeFileSync(json, JSON.stringify(rows, null, 2));
