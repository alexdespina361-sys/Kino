// Builds the cat's clips from the donors in the table below: each one is the donor's animation on the cat's bones (retarget.mts, feet.mts), given the style of a cat (style.mts), put
// on the floor by its contacts (plant.mts, ground.mts, floor.mts), its leap or its gait measured (flight.mts, gait.mts). What no donor does (lying down, a stretch, a paw at the face)
// is made by the pose generator (acts.mts) from the donors' own standing and sitting, and the two go into one clips file for the player.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/anim/build.mts [--out=.kino-cat/cands.clips] [--only=walk,loaf] [--mesh=src/client/cat/render/gl/cat.mesh]
//
// The mesh (cat.mesh) must be built first: the clips are made for the bones in it, and the file says which (a stamp of their names and rest). The donors are not in the repository
// (they are files of other people, kept with their licences in C:\Users\Me\tools\cat-workbench\donors: see docs/cat-animation/SOURCES.md).
import { readFileSync, writeFileSync } from "node:fs";
import { decodeClips, encodeClips, type ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import { decodeMesh } from "../../../src/client/cat/render/gl/format";
import { Skeleton } from "../../../src/client/cat/render/gl/pose";
import * as acts from "./acts.mts";
import { finishClips, type Finish } from "./finish.mts";
import { analyseGait, RUNNING, soleVertices, WALKING } from "./gait.mts";
import { plantPaws } from "./plant.mts";
import { foxClips, type Wanted as FoxWanted } from "./recipes/fox.mts";
import { mesh2motionClips, type Wanted as M2mWanted } from "./recipes/mesh2motion.mts";
import type { Style } from "./style.mts";

const DONORS = "C:\\Users\\Me\\tools\\cat-workbench\\donors";
const M2M = `${DONORS}\\mesh2motion\\app__static__animations__fox-animations.glb`;
const KHR = `${DONORS}\\fox\\Fox.glb`;

const ALL_PAWS = ["hind left", "hind right", "front left", "front right"];
const FRONT_PAWS = ["front left", "front right"];

/** How a donor's walk is made more of a cat's: the hips rise and fall more, the back and the neck turn more. (The fox's own is small, and a cat's coat hides what is left.) */
const WALK_STYLE: Style = {
  hips: [1, 3, 1.6],
  amplify: { spine1: 1.8, spine2: 1.8, chest: 1.8, neck1: 1.5, neck2: 1.5, head: 1.3, tail: 2, tailstart: 2, tail1: 2, tail2: 2, tail3: 2 },
};
const RUN_STYLE: Style = {
  hips: [1, 1.5, 1.4],
  amplify: { spine1: 1.4, spine2: 1.4, chest: 1.3, tail: 1.3, tailstart: 1.3, tail1: 1.3, tail2: 1.3, tail3: 1.3 },
};

interface Entry {
  name: string;
  donor: "m2m" | "khr";
  from: string;
  loop: boolean;
  lock?: boolean;
  style?: Style;
  /** Paws that are put on the floor, and whether the part of the body that sits on it is too. */
  plant?: { paws: string[]; seat: boolean };
  finish: Finish;
}

export const TABLE: readonly Entry[] = [
  { name: "walk", donor: "m2m", from: "Walk", loop: true, lock: true, style: WALK_STYLE, finish: { gait: WALKING, floor: "lift" } },
  { name: "run", donor: "m2m", from: "Run", loop: true, lock: true, style: RUN_STYLE, finish: { gait: RUNNING, floor: "lift" } },
  { name: "stalk", donor: "m2m", from: "Sneak", loop: true, lock: true, style: { ...WALK_STYLE, lower: 0.55 }, finish: { gait: WALKING, floor: "lift" } },
  { name: "stand", donor: "khr", from: "Survey", loop: true, plant: { paws: ALL_PAWS, seat: false }, finish: { floor: "pin" } },
  { name: "peek", donor: "m2m", from: "Idle Alert", loop: true, style: { lower: 0.6 }, plant: { paws: ALL_PAWS, seat: false }, finish: { floor: "pin" } },
  { name: acts.DONOR_SIT, donor: "m2m", from: "Sit", loop: false, plant: { paws: FRONT_PAWS, seat: true }, finish: { floor: "pin" } },
  { name: "jump", donor: "m2m", from: "Jump", loop: false, finish: { leap: true, floor: "lift" } },
  { name: "swat", donor: "m2m", from: "Bite", loop: false, finish: { floor: "pin" } },
  { name: "yawn", donor: "m2m", from: "Bark", loop: false, finish: { floor: "pin" } },
];

// (what the pose generator makes: acts.ACTS. Each is laid on the donors' standing and sitting, so the donors are built first.)

const arg = (name: string, fallback: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const f = readFileSync(arg("mesh", "src/client/cat/render/gl/cat.mesh"));
const mesh = decodeMesh(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
const skeleton = new Skeleton(mesh.skeleton);
// (`--only` is which clips are written: the donors are always built, the acts lean on them)
const only = arg("only", "").split(",").filter(Boolean);
const wanted = (name: string): boolean => only.length === 0 || only.includes(name);
const entries = TABLE;
const say = (line: string): void => console.log(line);

const raw = new Map<string, ClipSource>();
for (const donor of ["m2m", "khr"] as const) {
  const wanted = entries.filter((e) => e.donor === donor);
  if (wanted.length === 0) continue;
  const asked = wanted.map((e) => ({ from: e.from, as: e.name, loop: e.loop, ...(e.lock ? { lock: true } : {}), ...(e.style ? { style: e.style } : {}) }));
  const made = donor === "m2m" ? mesh2motionClips(M2M, skeleton, mesh, asked as M2mWanted[]) : foxClips(KHR, skeleton, mesh, asked as FoxWanted[]);
  for (const clip of made) raw.set(clip.name, clip);
}

const planted = entries.map((e) => {
  let source = raw.get(e.name)!;
  if (e.plant) {
    const p = plantPaws(mesh, skeleton, source, e.plant.paws, e.plant.seat);
    say(`${e.name}: planted (${e.plant.paws.length} paws${e.plant.seat ? " and the seat" : ""}): the worst contact was ${p.before.toFixed(3)} off the floor, now ${p.after.toFixed(3)}`);
    source = p.source;
  }
  return source;
});
const how: Record<string, Finish> = {};
for (const e of entries) how[e.name] = e.finish;
const finished = finishClips(mesh, skeleton, planted, how, say);

// when each paw lands, for the clips that walk (the director's footfalls: what the body does at each step)
const soles = soleVertices(mesh, skeleton);
const bytes = encodeClips(mesh.skeleton, finished);
const played = decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton);
const out = finished.map((s, i) => {
  const gait = how[s.name]?.gait;
  if (!gait) return s;
  const g = analyseGait(mesh, skeleton, played[i]!, soles, gait);
  const marks: Record<string, number> = {};
  for (const p of g.paws) if (p.lands >= 0) marks[`land:${p.name}`] = p.lands / s.fps;
  return { ...s, marks: { ...(s.marks ?? {}), ...marks } };
});

// what no donor does
const m = acts.context(mesh, skeleton, new Map(played.map((c) => [c.name, c])));
const made: ClipSource[] = [];
for (const [name, make] of Object.entries(acts.ACTS)) {
  if (!wanted(name)) continue;
  const t0 = Date.now();
  const clip = make(m);
  made.push(clip);
  say(`${name}: ${clip.frames} frames at ${clip.fps.toFixed(2)}${clip.loop ? " (loop)" : ""}, made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// (the donor's sit is what the acts are laid on and what the sit sits down to: the player has the one that sits down)
const all = [...out.filter((s) => s.name !== acts.DONOR_SIT && wanted(s.name)), ...made];
const dest = arg("out", ".kino-cat/cands.clips");
writeFileSync(dest, encodeClips(mesh.skeleton, all));
say(`wrote ${dest}: ${all.map((s) => s.name).join(", ")}`);
