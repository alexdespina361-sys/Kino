// Makes a recording (the same JSON scripts/cat/record.mts writes) of clips played one after another, with no behaviour engine in between, so that
// the motion of one clip can be looked at by itself: `node scripts/cat/glsheet.mjs film out.png --session=<this file>`.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/clip-film.mts <out.json> <clip>[:<seconds>[:<key>=<value>,...]] ...
//
//   sit:1 groom:4 sit:1                 sits, washes its face for four seconds, sits
//   walk:3:vx=140                       walks at 140 px a second (the body is 150 px)
//   sit:2:viewer=1,petted=1             the keys: drowsy energy viewer petted carried emote lookx looky reachx reachy vx
//
// The jump is the lab's own: a hop of 1.6 body lengths forward and 0.9 up over the seconds given. Development tooling: nothing in the app imports it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { JUMP_LANDING, JUMP_TAKEOFF, type CatFrame, type Clip, type Emote } from "../../src/client/cat/types";

const [out, ...segments] = process.argv.slice(2);
if (!out || segments.length === 0) throw new Error("usage: clip-film.mts <out.json> <clip>[:<seconds>[:<key>=<value>,...]] ...");

const fps = 30;
const body = 150;
const dt = 1 / fps;
const blank = (): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false });

const SPEED: Partial<Record<Clip, number>> = { walk: 140, run: 380, stalk: 50 };
const DROWSY: Partial<Record<Clip, number>> = { curl: 1, doze: 0.62, shift: 1 };

const frames: Array<Record<string, unknown>> = [];
let x = 0;
let odometer = 0;
let level = 0;
let acts = 0;
for (const spec of segments) {
  const [name = "stand", secondsText = "2", extra = ""] = spec.split(":");
  const clip = name as Clip;
  const seconds = Number(secondsText);
  const over: Record<string, string> = {};
  for (const pair of extra.split(",").filter(Boolean)) {
    const [k = "", v = ""] = pair.split("=");
    over[k] = v;
  }
  const steps = Math.max(1, Math.round(seconds * fps));
  const vx = Number(over.vx ?? SPEED[clip] ?? 0);
  for (let i = 0; i < steps; i++) {
    const progress = steps > 1 ? i / (steps - 1) : 0;
    const f = blank();
    f.clip = clip;
    f.clipTime = i * dt;
    f.progress = progress;
    f.drowsy = Number(over.drowsy ?? DROWSY[clip] ?? 0);
    f.energy = Number(over.energy ?? (clip === "run" ? 0.9 : 0.3));
    f.viewer = over.viewer === "1";
    f.petted = over.petted === "1";
    f.carried = over.carried === "1";
    if (over.emote) f.emote = over.emote as Emote;
    if (over.lookx !== undefined) f.look = { x: Number(over.lookx), y: Number(over.looky ?? 0) };
    if (over.reachx !== undefined) f.reach = { x: Number(over.reachx), y: Number(over.reachy ?? 0) };
    if (clip === "jump") {
      const fl = Math.min(1, Math.max(0, (progress - JUMP_TAKEOFF) / (JUMP_LANDING - JUMP_TAKEOFF)));
      const flying = progress > JUMP_TAKEOFF && progress < JUMP_LANDING;
      const dist = 1.6 * body;
      const rise = 0.9 * body;
      f.x = x + dist * fl;
      f.y = -(4 * rise * fl * (1 - fl));
      f.vx = flying ? dist / ((JUMP_LANDING - JUMP_TAKEOFF) * seconds) : 0;
      f.vy = flying ? (-4 * rise * (1 - 2 * fl)) / ((JUMP_LANDING - JUMP_TAKEOFF) * seconds) : 0;
      f.grounded = !flying;
    } else {
      x += vx * dt;
      odometer += Math.abs(vx) * dt;
      f.x = x;
      f.vx = vx;
    }
    f.odometer = odometer;
    f.y = clip === "jump" ? f.y : level;
    frames.push({ ...f, act: `${acts}:${name}` });
  }
  if (clip === "jump") x += 1.6 * body;
  acts++;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ fps, bodyLength: body, frames }));
console.log(`wrote ${out}: ${frames.length} frames (${(frames.length / fps).toFixed(1)} s)`);
