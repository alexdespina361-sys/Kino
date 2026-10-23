// Does the cat hold together while it lives? A clip may be sound and the cat still break: where one clip passes into the next, where the head is turned to a face that is not the way
// the body goes, where the engine tilts and squashes the whole. This plays a recording of the engine (scripts/cat/record.mts) through the rig and the director as the player does,
// skins every picture (integrity.mts) and says where the body was worst, and in what: the clip, whether it was passing from another, what the engine had the cat doing.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/anim/behaviour.mts <recording.json> [--clips=src/client/cat/render/gl/cat.clips] [--every=2] [--worst=6] [--skinning=dual|linear]
//
// Development tooling: nothing in the app imports it.
import { readFileSync } from "node:fs";
import { decodeClips } from "../../../src/client/cat/render/gl/clipfile";
import { Director, headYawOf } from "../../../src/client/cat/render/gl/director";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { Skeleton } from "../../../src/client/cat/render/gl/pose";
import { CatRig } from "../../../src/client/cat/render/rig";
import { IntegrityMeter, type FrameIntegrity } from "./integrity.mts";

const [recording, ...rest] = process.argv.slice(2);
if (!recording) throw new Error("usage: behaviour.mts <recording.json> [--clips=<file>] [--every=2] [--worst=6]");
const flag = (name: string, fallback: string): string => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const every = Math.max(1, Number(flag("every", "2")));
const show = Number(flag("worst", "6"));

const read = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const mesh = decodeMesh(read("src/client/cat/render/gl/cat.mesh"));
const skeleton = new Skeleton(mesh.skeleton);
const director = new Director(skeleton, decodeClips(read(flag("clips", "src/client/cat/render/gl/cat.clips")), skeleton));
const meter = new IntegrityMeter(mesh, skeleton, flag("skinning", "dual") === "linear" ? "linear" : "dual");
const film = JSON.parse(readFileSync(recording, "utf8")) as { fps: number; bodyLength: number; frames: Array<Record<string, any>> };
// (the recording is in the page's pixels; the cat is drawn a hundred and fifty pixels long)
const px = 150;
const k = px / film.bodyLength;
const rig = new CatRig(7);
const scaled = (f: Record<string, any>): any => ({ ...f, x: f.x * k, y: f.y * k, vx: f.vx * k, vy: f.vy * k, odometer: f.odometer * k, ...(f.look ? { look: { x: f.look.x * k, y: f.look.y * k } } : {}), ...(f.reach ? { reach: { x: f.reach.x * k, y: f.reach.y * k } } : {}) });
rig.snapTo(scaled(film.frames[0]!), px);
const dt = 1 / film.fps;

interface Seen extends FrameIntegrity {
  at: number;
  clip: string;
  blending: boolean;
  act: string;
  engine: string;
}
const seen: Seen[] = [];
const byClip = new Map<string, { frames: number; blended: number; stretch99: number; area1: number; flipped: number }>();
film.frames.forEach((f, i) => {
  rig.update(scaled(f), dt, px);
  const s = rig.solved;
  director.update(s, dt, px, headYawOf(s));
  if (i % every !== 0) return;
  const m = meter.frame(director.pose, i, director.adjust);
  const row: Seen = { ...m, at: i / film.fps, clip: director.playing, blending: director.blending, act: String(f.act ?? ""), engine: String(f.clip) };
  seen.push(row);
  const key = `${row.clip || "(rest)"}${row.blending ? " (blending)" : ""}`;
  const c = byClip.get(key) ?? { frames: 0, blended: 0, stretch99: 0, area1: Infinity, flipped: 0 };
  c.frames++;
  c.stretch99 = Math.max(c.stretch99, m.stretch99);
  c.area1 = Math.min(c.area1, m.area1);
  c.flipped = Math.max(c.flipped, m.flipped);
  byClip.set(key, c);
});

const num = (v: number, d = 3): string => v.toFixed(d).padStart(d + 3);
console.log(`${recording}: ${film.frames.length} frames (${(film.frames.length / film.fps).toFixed(0)} s), every ${every}th measured: ${seen.length}`);
console.log("");
console.log("by what the director was playing (worst stretch of the 99th percentile of edges, smallest 1st percentile triangle against rest, most faces flipped):");
for (const [key, c] of [...byClip.entries()].sort((a, b) => b[1].stretch99 - a[1].stretch99)) console.log(`  ${key.padEnd(24)} ${String(c.frames).padStart(5)} pictures   stretch99 ${num(c.stretch99)}   area1 ${num(c.area1)}   flipped ${num(c.flipped)}`);
const list = (title: string, rows: Seen[], value: (r: Seen) => string): void => {
  console.log("");
  console.log(title);
  for (const r of rows.slice(0, show)) console.log(`  ${r.at.toFixed(2).padStart(7)} s  frame ${String(r.frame).padStart(5)}  ${(r.clip || "(rest)").padEnd(8)}${r.blending ? " blending" : "         "}  engine ${r.engine.padEnd(8)} ${r.act.padEnd(12)} ${value(r)}`);
};
list("the most stretched bodies:", [...seen].sort((a, b) => b.stretch99 - a.stretch99), (r) => `stretch99 ${num(r.stretch99)} max ${num(r.stretchMax, 2)} area1 ${num(r.area1)}`);
list("the most collapsed (smallest triangles):", [...seen].sort((a, b) => a.area1 - b.area1), (r) => `area1 ${num(r.area1)} squash ${num(r.squashMin)} volume ${num(r.volume)}`);
list("the most turned inside out:", [...seen].sort((a, b) => b.flipped - a.flipped), (r) => `flipped ${num(r.flipped)}`);
const volumes = seen.map((r) => r.volume);
console.log("");
console.log(`volume against rest: ${Math.min(...volumes).toFixed(3)} .. ${Math.max(...volumes).toFixed(3)}`);
