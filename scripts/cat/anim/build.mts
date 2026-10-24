// Builds the cat's clips from the donors in the table below: each one is the donor's animation on the cat's bones (retarget.mts, feet.mts), given the style of a cat (style.mts), put
// on the floor by its contacts (plant.mts, ground.mts, floor.mts), its leap or its gait measured (flight.mts, gait.mts). What no donor does (lying down, a stretch, a paw at the face)
// is made by the pose generator (acts.mts), told as postures and solved for the cat's bones, and the two go into one clips file for the player. (The sit, the leap, the swat and the peek
// are the generator's too: the donors' are a fox's squat, a fox's pounce that comes down on its nose, a fox's bite and a fox's alert that is a stuck walk.)
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
import { SPHYNX, sphynxClips, type Wanted as SphynxWanted } from "./recipes/sphynx.mts";
import { LEG, smoothed } from "./smooth.mts";
import { GROOM, sphynxGroom } from "./sphynx-acts.mts";
import { sphynxLedge, sphynxScale } from "./sphynx-climb.mts";
import type { Style } from "./style.mts";
import { thin } from "./thin.mts";

const DONORS = "C:\\Users\\Me\\tools\\cat-workbench\\donors";
const M2M = `${DONORS}\\mesh2motion\\app__static__animations__fox-animations.glb`;
const KHR = `${DONORS}\\fox\\Fox.glb`;

const ALL_PAWS = ["hind left", "hind right", "front left", "front right"];

/** How a donor's walk is made more of a cat's: the hips rise and fall more, the back and the neck turn more. (The fox's own is small, and a cat's coat hides what is left.) */
const WALK_STYLE: Style = {
  hips: [1, 3, 1.6],
  amplify: { spine1: 1.8, spine2: 1.8, chest: 1.8, neck1: 1.5, neck2: 1.5, head: 1.3, tail: 2, tailstart: 2, tail1: 2, tail2: 2, tail3: 2 },
};
const RUN_STYLE: Style = {
  hips: [1, 1.2, 1.2],
  amplify: { spine1: 1.4, spine2: 1.4, chest: 1.3, tail: 0.5, tailstart: 0.5, tail1: 0.5, tail2: 0.5, tail3: 0.5 },
};

interface Entry {
  name: string;
  donor: "m2m" | "khr" | "sphynx";
  from: string;
  loop: boolean;
  lock?: boolean;
  style?: Style;
  /** Paws that are put on the floor, and whether the part of the body that sits on it is too. */
  plant?: { paws: string[]; seat: boolean };
  finish: Finish;
  /** A clip that an act leans on, made like the others and not packed. */
  scaffold?: boolean;
  /** The part of the donor's animation to take, in seconds from its start (all of it if left out; the Sphynx's only). */
  range?: readonly [number, number];
}

export const TABLE: readonly Entry[] = [
  { name: "walk", donor: "m2m", from: "Walk", loop: true, lock: true, style: WALK_STYLE, finish: { gait: WALKING, floor: "lift" } },
  { name: "run", donor: "m2m", from: "Run", loop: true, lock: true, style: RUN_STYLE, finish: { gait: RUNNING, floor: "lift" } },
  { name: "stand", donor: "khr", from: "Survey", loop: true, plant: { paws: ALL_PAWS, seat: false }, finish: { floor: "pin" } },
  { name: "yawn", donor: "m2m", from: "Bark", loop: false, finish: { floor: "pin" } },
];

// (what the pose generator makes: acts.ACTS, told from the cat's own rest; the stalk is laid on the walk, so the donors are built first.)

// (the acts that the Sphynx's motion is put through (sphynx-acts.mts) and not the generator's own posture: `--sphynx=groom` asks for the ones named, `--sphynx=off` for none; the ones that
// are in the app by default are SPHYNX_SHIPPED: they won their blind reviews, docs/cat-animation/QA.md round 15; the donor is not in the repository, SOURCES.md)
const SPHYNX_ACTS: Record<string, (m: acts.Made) => ClipSource> = {
  groom: (m) => sphynxGroom(m, GROOM),
  // (the card climb, and the ledge climb with the Sphynx's motion on its hang: sphynx-climb.mts)
  scale: (m) => sphynxScale(m),
  climb: (m) => sphynxLedge(m),
  // (the generator's stalk with the paws of the Sphynx's stalk in place of the walk's)
  stalk: (m) => acts.stalk(m, m.clips.get("stalk-gait")),
};
const SPHYNX_SHIPPED: string[] = [];
// (and the Sphynx's animations on the cat's bones as they are, a donor of the table's own kind, asked for by `--sphynx=<asks>`: `plain-stalk` and `plain-jump` stand in for the generator's clip
// of the name; `stalk` makes the Sphynx's stalk as a gait, not packed, for the generator's stalk above to follow)
interface SphynxEntry extends Entry {
  asks: string;
}
const SPHYNX_TABLE: readonly SphynxEntry[] = [
  { asks: "plain-stalk", name: "stalk", donor: "sphynx", from: "Cat_Stalk_Hunt", loop: true, lock: true, finish: { gait: WALKING, floor: "lift" } },
  { asks: "plain-jump", name: "jump", donor: "sphynx", from: "Cat_Leap_Jump", loop: false, finish: { leap: true, floor: "pin" } },
  { asks: "plain-crouch", name: "crouch", donor: "sphynx", from: "Cat_Pounce_Attack", loop: false, range: [0, 2], finish: { floor: "pin" } },
  { asks: "stalk", name: "stalk-gait", donor: "sphynx", from: "Cat_Stalk_Hunt", loop: true, lock: true, finish: { gait: WALKING, floor: "lift" }, scaffold: true },
];

const arg = (name: string, fallback: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const f = readFileSync(arg("mesh", "src/client/cat/render/gl/cat.mesh"));
const mesh = decodeMesh(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
const skeleton = new Skeleton(mesh.skeleton);
// (`--only` is which clips are written: the donors are always built, the acts lean on them)
const only = arg("only", "").split(",").filter(Boolean);
const wanted = (name: string): boolean => only.length === 0 || only.includes(name);
const sphynx = arg("sphynx", SPHYNX_SHIPPED.join(",")) === "off" ? [] : arg("sphynx", SPHYNX_SHIPPED.join(",")).split(",").filter(Boolean);
const entries: Entry[] = [...TABLE, ...SPHYNX_TABLE.filter((e) => sphynx.includes(e.asks))];
const say = (line: string): void => console.log(line);

const raw = new Map<string, ClipSource>();
for (const donor of ["m2m", "khr", "sphynx"] as const) {
  const wanted = entries.filter((e) => e.donor === donor);
  if (wanted.length === 0) continue;
  const asked = wanted.map((e) => ({ from: e.from, as: e.name, loop: e.loop, ...(e.lock ? { lock: true } : {}), ...(e.style ? { style: e.style } : {}), ...(e.range ? { range: e.range } : {}) }));
  const made =
    donor === "m2m"
      ? mesh2motionClips(M2M, skeleton, mesh, asked as M2mWanted[])
      : donor === "khr"
        ? foxClips(KHR, skeleton, mesh, asked as FoxWanted[])
        : sphynxClips(SPHYNX, skeleton, mesh, asked as SphynxWanted[]);
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
  if (!wanted(name) || SPHYNX_TABLE.some((e) => !e.scaffold && e.name === name && sphynx.includes(e.asks))) continue;
  const t0 = Date.now();
  const fromSphynx = sphynx.includes(name) ? SPHYNX_ACTS[name] : undefined;
  const clip = (fromSphynx ?? make)(m);
  made.push(clip);
  say(`${name}: ${clip.frames} frames at ${clip.fps.toFixed(2)}${clip.loop ? " (loop)" : ""}${fromSphynx ? " (from the Sphynx)" : ""}, made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// (a leg that is reached for each frame of a clip on its own flicks now and then, a few degrees off the line between its neighbours: each such frame is brought back to within `--smooth`
// degrees of it (`--smooth=off` leaves them as solved); the strike of a swat is meant to be sudden)
const smooth = arg("smooth", "3");
const SUDDEN = ["swat"];
const smoothMade = smooth === "off" ? made : made.map((s) => (SUDDEN.includes(s.name) ? s : smoothed(s, (j) => LEG.test(skeleton.names[j]!), (Number(smooth) * Math.PI) / 180)));
// (a clip is kept at fewer frames a second where the player's interpolation gives the same motion: `--thin=off` keeps them all, `--tol=<degrees>` says how far a bone may be turned from
// where it was made, which is half a degree if it is not told, and a place may be a thousandth of the body for each half degree)
const everything = [...out.filter((s) => wanted(s.name) && !entries.some((e) => e.scaffold && e.name === s.name)), ...smoothMade];
const tolerance = { turn: (Number(arg("tol", "0.5")) * Math.PI) / 180, place: Number(arg("tol", "0.5")) * 0.002 };
const all =
  arg("thin", "on") === "off"
    ? everything
    : everything.map((s) => {
        const { source, by } = thin(s, tolerance);
        if (by > 1) say(`${s.name}: kept every ${by}th frame (${s.frames} -> ${source.frames} frames, ${s.fps.toFixed(1)} -> ${source.fps.toFixed(1)} a second)`);
        return source;
      });
const dest = arg("out", ".kino-cat/cands.clips");
const packed = encodeClips(mesh.skeleton, all);
writeFileSync(dest, packed);
say(`wrote ${dest}: ${all.map((s) => s.name).join(", ")} (${packed.length} bytes)`);
