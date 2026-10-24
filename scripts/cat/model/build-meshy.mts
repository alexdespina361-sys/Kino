// Makes the cat's mesh from the free model (Meshy AI, "Fluffy Blue Eyed Cat", CC BY 4.0: see reports/kino-cat/06-risk-and-license-register.md). The model is research material and
// lives outside the repository: it is read from the path given, and only what is made of it (the mesh, as its own file) is written to the app.
//
//   node node_modules/tsx/dist/cli.mjs scripts/cat/model/build-meshy.mts MODEL.glb
//
// What it does: reads the model, puts it in the rig's frame (x forward, y up, feet on the floor), joins the vertices that the file split only to give each its own
// place in a texture, paints each vertex with the colour the texture has there (the eyes are taken out: they are drawn by the shader, which can blink), bakes how open
// to the room each vertex is, and skins every vertex to the model's OWN bones with the model's OWN weights (meshy-skeleton.mts); three bones are added to the model's
// 27 (a jaw and two ears, children of the head) and given their share of the head's weights. Writes src/client/cat/render/gl/cat.mesh.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openness } from "../glb/bvh.mts";
import { fit, vertexColours } from "../glb/fit.mts";
import { encodeMesh, keptSkeleton } from "../../../src/client/cat/render/gl/format";
import { EYE, jawShare } from "../../../src/client/cat/render/gl/mouth";
import { Pose, Skeleton, globals, type SkeletonData } from "../../../src/client/cat/render/gl/pose";
import { MESHY_REST } from "./meshy-rest.mts";
import { quatOfAxes, readMeshySkeleton } from "./meshy-skeleton.mts";
import { reskin, type Segment } from "./reskin.mts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../src/client/cat/render/gl");

const input = process.argv[2];
if (!input) throw new Error("usage: build-meshy.mts MODEL.glb");
const M = readMeshySkeleton(input);
const model = M.model;
const f = fit(model);
const rawColour = vertexColours(model);
const nRaw = f.pos.length / 3;

/** smoothstep that also takes its edges the wrong way round. */
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- the skeleton: the model's bones, and a jaw and two ears hung from the head (each at the place the old rig had them, with no turn of its own: the pose turns them about the
// cat's own axes, so it does not matter which way the head's bone happens to point)
const file = M.fileData;
const headBone = file.names.indexOf("head");
if (headBone < 0) throw new Error("the model has no bone called head");
const rest0 = new Skeleton(file);
const R0 = new Float64Array(rest0.count * 9);
const T0 = new Float64Array(rest0.count * 3);
globals(rest0, new Pose(rest0), undefined, R0, T0);
const hR = R0.subarray(headBone * 9, headBone * 9 + 9);
const hT = T0.subarray(headBone * 3, headBone * 3 + 3);
const headTurn = quatOfAxes([hR[0]!, hR[3]!, hR[6]!], [hR[1]!, hR[4]!, hR[7]!], [hR[2]!, hR[5]!, hR[8]!]);
const EXTRAS = [
  { name: "jaw", at: MESHY_REST.jawHinge },
  { name: "earL", at: MESHY_REST.ears[0].base },
  { name: "earR", at: MESHY_REST.ears[1].base },
] as const;
// The model has no bones along the body between its hips and its chest, nor between its chest and its head: a back that bends, and a head that turns, do it at one joint. Two bones are
// added in each stretch (a spine and a neck), one third and two thirds of the way along it, each hung from the one before, with no turn of its own (so that its axes are the hips'
// or the chest's, and everything the model's own clips say of the chest and the head is as it was). The chest hangs from the second of the spine's, the head from the second of the neck's.
const hipsBone = file.names.indexOf("Hips");
const chestBone = file.names.indexOf("chest");
if (hipsBone < 0 || chestBone < 0) throw new Error("the model has no bone called Hips or chest");
const place = (j: number): [number, number, number] => [T0[j * 3]!, T0[j * 3 + 1]!, T0[j * 3 + 2]!];
const between = (a: number, b: number, k: number): [number, number, number] => {
  const p = place(a);
  const q = place(b);
  return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
};
const ADDED = [
  { name: "spine1", after: "Hips", hangsFrom: "Hips", axesOf: hipsBone, at: between(hipsBone, chestBone, 1 / 3) },
  { name: "spine2", after: "Hips", hangsFrom: "spine1", axesOf: hipsBone, at: between(hipsBone, chestBone, 2 / 3) },
  { name: "neck1", after: "chest", hangsFrom: "chest", axesOf: chestBone, at: between(chestBone, headBone, 1 / 3) },
  { name: "neck2", after: "chest", hangsFrom: "neck1", axesOf: chestBone, at: between(chestBone, headBone, 2 / 3) },
] as const;
/** What a bone of the model hangs from here (the chest from the end of the spine, the head from the end of the neck), by name. */
const hangsFromNow = (name: string, filed: string): string => (name === "chest" ? "spine2" : name === "head" ? "neck2" : filed);
// (parents come before their children: the added bones come right after the bone they are hung from, and the jaw and the ears, children of the head, last)
const order: string[] = [];
file.names.forEach((n) => {
  order.push(n);
  for (const a of ADDED) if (a.after === n) order.push(a.name);
});
const worldR = new Map<string, ArrayLike<number>>();
const worldT = new Map<string, [number, number, number]>();
file.names.forEach((n, j) => {
  worldR.set(n, R0.subarray(j * 9, j * 9 + 9));
  worldT.set(n, place(j));
});
for (const a of ADDED) {
  worldR.set(a.name, R0.subarray(a.axesOf * 9, a.axesOf * 9 + 9));
  worldT.set(a.name, [a.at[0], a.at[1], a.at[2]]);
}
const names: string[] = [];
const parent: number[] = [];
const restT: number[] = [];
const restR: number[] = [];
for (const n of order) {
  const added = ADDED.find((a) => a.name === n);
  const j = file.names.indexOf(n);
  const hangs = added ? added.hangsFrom : file.parent[j]! >= 0 ? hangsFromNow(n, file.names[file.parent[j]!]!) : null;
  names.push(n);
  parent.push(hangs === null ? -1 : names.indexOf(hangs));
  if (hangs === null) {
    restT.push(file.restT[j * 3]!, file.restT[j * 3 + 1]!, file.restT[j * 3 + 2]!);
    restR.push(file.restR[j * 4]!, file.restR[j * 4 + 1]!, file.restR[j * 4 + 2]!, file.restR[j * 4 + 3]!);
    continue;
  }
  // (the place against the parent, in the parent's own axes: the transpose of its turn)
  const pr = worldR.get(hangs)!;
  const pt = worldT.get(hangs)!;
  const wt = worldT.get(n)!;
  const d = [wt[0] - pt[0], wt[1] - pt[1], wt[2] - pt[2]];
  restT.push(pr[0]! * d[0]! + pr[3]! * d[1]! + pr[6]! * d[2]!, pr[1]! * d[0]! + pr[4]! * d[1]! + pr[7]! * d[2]!, pr[2]! * d[0]! + pr[5]! * d[1]! + pr[8]! * d[2]!);
  // (the model's own bones keep their turn against the parent: the new parent has the axes the old one had; an added bone has none of its own)
  if (added) restR.push(0, 0, 0, 1);
  else restR.push(file.restR[j * 4]!, file.restR[j * 4 + 1]!, file.restR[j * 4 + 2]!, file.restR[j * 4 + 3]!);
}
const headNow = names.indexOf("head");
for (const e of EXTRAS) {
  const d = [e.at[0] - hT[0]!, e.at[1] - hT[1]!, e.at[2] - hT[2]!];
  // (into the head's own axes: the transpose of its turn)
  restT.push(hR[0]! * d[0]! + hR[3]! * d[1]! + hR[6]! * d[2]!, hR[1]! * d[0]! + hR[4]! * d[1]! + hR[7]! * d[2]!, hR[2]! * d[0]! + hR[5]! * d[1]! + hR[8]! * d[2]!);
  restR.push(-headTurn[0], -headTurn[1], -headTurn[2], headTurn[3]);
  names.push(e.name);
  parent.push(headNow);
}
const skeleton: SkeletonData = keptSkeleton({ names, parent, restT, restR });
const BONES = names.length;
const JAW = names.indexOf("jaw");
const EAR_L = names.indexOf("earL");
const EAR_R = names.indexOf("earR");
if (BONES > 40) throw new Error(`${BONES} bones: the shader has room for 40`);
/** The model's bones, as the numbers the mesh was skinned to in the file, and the numbers they have here. */
const hereOf = file.names.map((n) => names.indexOf(n));
const idOf = (name: string): number => {
  const i = names.indexOf(name);
  if (i < 0) throw new Error(`no bone ${name}`);
  return i;
};
// the model's bones by what they carry
const HEAD_BONES = ["head", "headend", "earend", "R_earend"].map(idOf);
const TAIL_BONES = ["tail", "tailstart", "tail1", "tail2", "tail3"].map(idOf);
const LEG_UPPER = [["backleg", "frontleg"], ["R_backleg", "R_frontleg"]].map((side) => side.map(idOf));
const LEG_LOWER = [
  ["backleg0", "backleg1", "backleg2", "frontleg0", "frontleg1", "frontleg2"],
  ["R_backleg0", "R_backleg1", "R_backleg2", "R_frontleg0", "R_frontleg1", "R_frontleg2"],
].map((side) => side.map(idOf));
// (the left side of the cat is at z < 0 in the rig's frame: the legs without the R)

// ---- join the vertices the file split for its texture: same place, same way of facing, same colour
interface Merged {
  pos: number[];
  nor: number[];
  col: number[];
  n: number[];
  rep: number[];
}
const byPlace = new Map<string, number[]>();
for (let v = 0; v < nRaw; v++) {
  const key = `${f.pos[v * 3]},${f.pos[v * 3 + 1]},${f.pos[v * 3 + 2]}`;
  const list = byPlace.get(key);
  if (list) list.push(v);
  else byPlace.set(key, [v]);
}
const remap = new Int32Array(nRaw).fill(-1);
const merged: Merged = { pos: [], nor: [], col: [], n: [], rep: [] };
const NORMAL_SAME = 0.92;
const COLOUR_SAME = 0.07;
for (const list of byPlace.values()) {
  const groups: number[] = [];
  for (const v of list) {
    const nx = f.nor[v * 3]!, ny = f.nor[v * 3 + 1]!, nz = f.nor[v * 3 + 2]!;
    const nl = Math.hypot(nx, ny, nz) || 1;
    let found = -1;
    for (const g of groups) {
      const gl = Math.hypot(merged.nor[g * 3]!, merged.nor[g * 3 + 1]!, merged.nor[g * 3 + 2]!) || 1;
      const dot = (nx * merged.nor[g * 3]! + ny * merged.nor[g * 3 + 1]! + nz * merged.nor[g * 3 + 2]!) / (nl * gl);
      const c = merged.n[g]!;
      const dc = Math.max(
        Math.abs(rawColour[v * 3]! - merged.col[g * 3]! / c),
        Math.abs(rawColour[v * 3 + 1]! - merged.col[g * 3 + 1]! / c),
        Math.abs(rawColour[v * 3 + 2]! - merged.col[g * 3 + 2]! / c),
      );
      if (dot >= NORMAL_SAME && dc <= COLOUR_SAME) {
        found = g;
        break;
      }
    }
    if (found < 0) {
      found = merged.n.length;
      groups.push(found);
      merged.pos.push(f.pos[v * 3]!, f.pos[v * 3 + 1]!, f.pos[v * 3 + 2]!);
      merged.nor.push(nx / nl, ny / nl, nz / nl);
      merged.col.push(rawColour[v * 3]!, rawColour[v * 3 + 1]!, rawColour[v * 3 + 2]!);
      merged.n.push(1);
      merged.rep.push(v);
    } else {
      const c = merged.n[found]!;
      // (running sums: the normal is a sum of unit normals, the colour a sum of colours; both are divided when they are used)
      merged.nor[found * 3]! += nx / nl;
      merged.nor[found * 3 + 1]! += ny / nl;
      merged.nor[found * 3 + 2]! += nz / nl;
      merged.col[found * 3]! += rawColour[v * 3]!;
      merged.col[found * 3 + 1]! += rawColour[v * 3 + 1]!;
      merged.col[found * 3 + 2]! += rawColour[v * 3 + 2]!;
      merged.n[found] = c + 1;
    }
    remap[v] = found;
  }
}
const nV = merged.n.length;
// (the vertices that were joined are one place of the model and should have one set of weights: say if the file ever disagrees)
{
  const byJoint = (v: number): number[] => {
    const w = new Array<number>(BONES).fill(0);
    for (let i = 0; i < 4; i++) w[model.joints[v * 4 + i]!]! += model.weights[v * 4 + i]!;
    return w;
  };
  let disagree = 0;
  let worst = 0;
  for (let v = 0; v < nRaw; v++) {
    const rep = merged.rep[remap[v]!]!;
    if (rep === v) continue;
    const a = byJoint(v);
    const b = byJoint(rep);
    const d = Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
    worst = Math.max(worst, d);
    if (d > 1e-3) disagree++;
  }
  console.log(`joined vertices that disagree about their weights: ${disagree} (worst ${worst.toExponential(2)})`);
}
const P = Float32Array.from(merged.pos);
const N = new Float32Array(nV * 3);
const C = new Float64Array(nV * 3);
for (let v = 0; v < nV; v++) {
  const l = Math.hypot(merged.nor[v * 3]!, merged.nor[v * 3 + 1]!, merged.nor[v * 3 + 2]!) || 1;
  for (let k = 0; k < 3; k++) {
    N[v * 3 + k] = merged.nor[v * 3 + k]! / l;
    C[v * 3 + k] = merged.col[v * 3 + k]! / merged.n[v]!;
  }
}
const tri: number[] = [];
for (let t = 0; t < model.tri.length; t += 3) {
  const a = remap[model.tri[t]!]!, b = remap[model.tri[t + 1]!]!, c = remap[model.tri[t + 2]!]!;
  if (a === b || b === c || a === c) continue;
  tri.push(a, b, c);
}
console.log(`vertices ${nRaw} -> ${nV}, triangles ${model.tri.length / 3} -> ${tri.length / 3}`);

// ---- the eyes are drawn by the shader (it blinks them, and they look about): the model's own, painted into its vertices, are taken out and the fur round them is
// carried over them. The same is done to the colour of the pupils: nothing blue is left.
const headX = MESHY_REST.head[0];
const headY = MESHY_REST.head[1];
let neutral = 0;
for (const side of [1, -1]) {
  const ex = headX + EYE.x;
  const ey = headY + EYE.y;
  const ez = side * EYE.z;
  const radius = (v: number): number => Math.hypot((P[v * 3 + 2]! - ez) / (EYE.a * 1.35), (P[v * 3 + 1]! - ey) / (EYE.b * 1.5), (P[v * 3]! - ex) / 0.05);
  // the fur round the eye (from the ring of points just outside the lid, that are not blue)
  const ring = [0, 0, 0];
  let rn = 0;
  for (let v = 0; v < nV; v++) {
    const r = radius(v);
    if (r < 1.25 || r > 2.1) continue;
    if (C[v * 3 + 2]! - C[v * 3]! > 0.08) continue;
    for (let k = 0; k < 3; k++) ring[k]! += C[v * 3 + k]!;
    rn++;
  }
  if (rn === 0) throw new Error("no fur found round an eye: the eye's place is wrong");
  for (let k = 0; k < 3; k++) ring[k]! /= rn;
  for (let v = 0; v < nV; v++) {
    const r = radius(v);
    const w = r < 1 ? 1 : r < 1.25 ? (1.25 - r) / 0.25 : 0;
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) C[v * 3 + k] = C[v * 3 + k]! * (1 - w) + ring[k]! * w;
    neutral++;
  }
}
console.log(`eyes taken out of ${neutral} vertices`);

// ---- the spine and the neck take their share, and a limb's weight stops where the limb does (reskin.mts): the chain of the hips, the spine, the chest, the neck and the head, and the
// limbs and the tail, each as the line from its joint to the next with how far from it the bone may reach
const CHAIN = ["Hips", "spine1", "spine2", "chest", "neck1", "neck2", "head"].map(idOf);
const chainAt = CHAIN.map((b) => worldT.get(names[b]!)!);
const HEADEND = idOf("headend");
const LIMB_REACH: Record<string, number> = {
  backleg: 0.22, backleg0: 0.13, backleg1: 0.07, backleg2: 0.09,
  frontleg: 0.08, frontleg0: 0.07, frontleg1: 0.062, frontleg2: 0.067,
  tail: 0.125, tailstart: 0.115, tail1: 0.155, tail2: 0.185, tail3: 0.33,
};
const LIMBS: Segment[] = [];
// How much further than the table above a limb's weight reaches. Found by building the skin with 1, 1.4, 1.8, 2.4 and no limit at all and measuring the donors' clips and the head
// turned: the tighter, the more the root of a leg stretches in a jump or a run (the worst 1 % of edges 4.1 times their length at 1, 2.8 at 1.8); the looser, the more the belly
// swells when the legs are drawn up (the volume up to 1.31 with no limit, 1.22 at 1.8). (CAT_LIMB_SCALE tries another, for the experiments that compare ways of skinning.)
const LIMB_SCALE = Number(process.env.CAT_LIMB_SCALE ?? 1.8);
for (const [bone, reach0] of Object.entries(LIMB_REACH)) {
  const reach = reach0 * LIMB_SCALE;
  for (const side of ["", "R_"]) {
    // (the tail has one side)
    if (side === "R_" && bone.startsWith("tail")) continue;
    const name = `${side}${bone}`;
    const j = idOf(name);
    const here = worldT.get(name)!;
    const child = names.findIndex((_, c) => parent[c] === j);
    // (a bone with no bone below it, a paw or the end of the tail, goes on the way its parent's goes)
    const there = child >= 0 ? worldT.get(names[child]!)! : ((): [number, number, number] => {
      const up = worldT.get(names[parent[j]!]!)!;
      return [here[0] + (here[0] - up[0]) * 0.4, here[1] + (here[1] - up[1]) * 0.4, here[2] + (here[2] - up[2]) * 0.4];
    })();
    LIMBS.push({ bone: j, from: here, to: there, radius: reach });
  }
}
// ---- the bones round each vertex: the model's own weights, with the jaw and the ears cut out of the head's share
const skin = new Uint8Array(nV * 4);
const weight = new Uint8Array(nV * 4);
const part = new Uint8Array(nV * 4);
const dense = new Float64Array(BONES);
/** Every vertex's weight on every bone, as the model gave it (less the jaw's and the ears'), before the spine and the neck take their share. */
const all = new Float64Array(nV * BONES);
const tailLine = MESHY_REST.tail;
const tailLength = tailLine.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - tailLine[i]![0], p[1] - tailLine[i]![1]), 0);
let jawPoints = 0;
let earPoints = 0;
for (let v = 0; v < nV; v++) {
  const raw = merged.rep[v]!;
  dense.fill(0);
  for (let i = 0; i < 4; i++) dense[hereOf[model.joints[raw * 4 + i]!]!]! += model.weights[raw * 4 + i]!;
  const x = P[v * 3]!, y = P[v * 3 + 1]!, z = P[v * 3 + 2]!;
  const headW = HEAD_BONES.reduce((s, b) => s + dense[b]!, 0);
  if (headW > 0) {
    // the ears: a share that falls off with the distance from the line from the ear's base to its tip
    const ear = [0, 0];
    for (let i = 0; i < 2; i++) {
      const e = MESHY_REST.ears[i]!;
      const a = [e.tip[0] - e.base[0], e.tip[1] - e.base[1], e.tip[2] - e.base[2]] as const;
      const l2 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
      const t = ((x - e.base[0]) * a[0] + (y - e.base[1]) * a[1] + (z - e.base[2]) * a[2]) / l2;
      const tc = Math.min(1, Math.max(0, t));
      const d = Math.hypot(x - (e.base[0] + a[0] * tc), y - (e.base[1] + a[1] * tc), z - (e.base[2] + a[2] * tc));
      const r = 0.05 + (0.012 - 0.05) * tc;
      ear[i] = sstep(-0.1, 0.35, t) * sstep(1.55 * r, 1.05 * r, d) * sstep(1.25, 1.05, t);
    }
    const earL = Math.min(ear[0]!, headW);
    const earR = Math.min(ear[1]!, headW);
    // the jaw: below the lip line, ahead of the hinge (the head's own space: the origin is the centre of the head)
    const jaw = Math.min(jawShare(x - MESHY_REST.head[0], y - MESHY_REST.head[1], z), Math.max(0, headW - earL - earR));
    const taken = earL + earR + jaw;
    if (taken > 0) {
      const keep = (headW - taken) / headW;
      for (const b of HEAD_BONES) dense[b]! *= keep;
      dense[EAR_L] = earL;
      dense[EAR_R] = earR;
      dense[JAW] = jaw;
      if (jaw > 0.5) jawPoints++;
      if (earL > 0.5 || earR > 0.5) earPoints++;
    }
  }
  all.set(dense, v * BONES);

  // what part of the cat a point is, for the coats of other cats (they are painted by it): how much of it is a leg (the thigh and the upper arm count for half: the top of a leg
  // is the body's), how much the tail, how far along the tail, and how much of the legs are the left side's
  const sideShare = (side: number): number => LEG_LOWER[side]!.reduce((s, b) => s + dense[b]!, 0) + 0.5 * LEG_UPPER[side]!.reduce((s, b) => s + dense[b]!, 0);
  const left = sideShare(0);
  const right = sideShare(1);
  const tailW = TAIL_BONES.reduce((s, b) => s + dense[b]!, 0);
  let along = 0;
  if (tailW > 0.01) {
    let best = 1e9;
    let bs = 0;
    let acc = 0;
    for (let i = 0; i < tailLine.length - 1; i++) {
      const a = tailLine[i]!;
      const b = tailLine[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / (len * len || 1e-9)));
      const d = Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t), z);
      if (d < best) {
        best = d;
        bs = acc + t * len;
      }
      acc += len;
    }
    along = bs / tailLength;
  }
  const q = (a: number): number => Math.max(0, Math.min(255, Math.round(a * 255)));
  part[v * 4] = q(left + right);
  part[v * 4 + 1] = q(tailW);
  part[v * 4 + 2] = q(along);
  part[v * 4 + 3] = q(left);
}
console.log(`${BONES} bones; the jaw is most of ${jawPoints} points, an ear most of ${earPoints}`);
const handed = reskin({
  count: nV,
  pos: P,
  index: tri,
  bones: BONES,
  dense: all,
  chain: CHAIN,
  chainAt,
  limbs: LIMBS,
  muzzle: HEADEND,
  headSet: [...HEAD_BONES, JAW, EAR_L, EAR_R],
  // (the limbs are held to the rate too: it took the worst edge of a sit from 6 to 3.8 times its length and of a jump from 45 to 11 at no cost to the rest.
  // CAT_RATE and CAT_LIMBS_HELD=0 try others, for the experiments that compare ways of skinning)
  limbsHeld: process.env.CAT_LIMBS_HELD !== "0",
  ...(process.env.CAT_RATE ? { rate: Number(process.env.CAT_RATE) } : {}),
});
console.log(
  `the spine and the neck took a share of ${handed.changed} points, ${handed.cut.toFixed(1)} of limb weight was cut back to the body; ` +
    `along the chain, two points side by side differ by at most ${handed.jumpBefore.toFixed(2)} joints before the smoothing and ${handed.jumpAfter.toFixed(2)} after; ` +
    `held to the rate, the worst pair went from ${handed.strainBefore.toFixed(1)} times what it may differ by to ${handed.strainAfter.toFixed(1)}; ` +
    `keeping four bones a point lost at most ${(handed.lost * 100).toFixed(1)} % of its weight`,
);
// the four strongest bones of each vertex, as bytes that add up to 255
for (let v = 0; v < nV; v++) {
  dense.set(all.subarray(v * BONES, (v + 1) * BONES));
  const top = Array.from(dense.keys()).sort((a, b) => dense[b]! - dense[a]!).slice(0, 4);
  const sum = top.reduce((s, b) => s + dense[b]!, 0) || 1;
  const bytes = top.map((b) => Math.round((dense[b]! / sum) * 255));
  // (what the rounding lost or gained goes to the strongest)
  bytes[0] = bytes[0]! + 255 - bytes.reduce((s, x) => s + x, 0);
  top.forEach((b, k) => {
    skin[v * 4 + k] = b;
    weight[v * 4 + k] = bytes[k]!;
  });
}

// ---- how open to the room each vertex is (a fur-covered cat is lit mostly from outside: this is what the creases between tufts and the underside get)
const ao = openness(P, N, tri, 0.06, 32);

// ---- the file
const color = new Uint8Array(nV * 4);
for (let v = 0; v < nV; v++) {
  for (let k = 0; k < 3; k++) color[v * 4 + k] = Math.max(0, Math.min(255, Math.round(C[v * 3 + k]! * 255)));
  color[v * 4 + 3] = Math.max(0, Math.min(255, Math.round(ao[v]! * 255)));
}
const normal = new Int8Array(nV * 3);
for (let i = 0; i < nV * 3; i++) normal[i] = Math.max(-127, Math.min(127, Math.round(N[i]! * 127)));
const lo = [1e9, 1e9, 1e9];
const hi = [-1e9, -1e9, -1e9];
for (let v = 0; v < nV; v++) {
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, P[v * 3 + k]!);
    hi[k] = Math.max(hi[k]!, P[v * 3 + k]!);
  }
}
const bounds = [lo[0]! - 1e-3, lo[1]! - 1e-3, lo[2]! - 1e-3, hi[0]! + 1e-3, hi[1]! + 1e-3, hi[2]! + 1e-3] as const;
const bytes = encodeMesh({ bounds, skeleton, pos: P, normal, skin, weight, color, part, index: tri });
// (CAT_MESH_OUT: a mesh to try, written elsewhere, for the experiments that compare ways of skinning)
const target = process.env.CAT_MESH_OUT ? resolve(process.env.CAT_MESH_OUT) : resolve(out, "cat.mesh");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`cat.mesh: ${bytes.length} bytes, ${nV} vertices, ${tri.length / 3} triangles, bounds ${bounds.map((v) => v.toFixed(3)).join(" ")}`);
