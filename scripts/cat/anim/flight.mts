// A leap, as a clip. A donor's jump carries its body up and over: the hips rise by most of a body length and come back down, and the paws are where the paws are in the air. In the
// player the engine carries the cat (it knows the ledge it is going to and plans the arc), so the clip must not: the hips' height above standing is taken out here, and what is left is
// what the body does about the leap: the crouch, the push, the stretch, the tuck, the landing. The moments the engine's progress is shared out by (take-off and landing: types.ts's
// `JUMP_TAKEOFF` and `JUMP_LANDING`) are found in the clip from its paws, while the donor's body is still up in the air, and written into it as marks that the director plays it by.
import { after, matrixOf, turnAbout, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { analyseGait, restPads, soleVertices } from "./gait.mts";
import { played } from "./ground.mts";

/** The first frame the cat is off the floor in (every paw clear of it), and the first frame after that a paw is on it again. */
export function airborne(mesh: CatMesh, skeleton: Skeleton, source: ClipSource, clear = 0.03): { takeoff: number; land: number } | null {
  const soles = soleVertices(mesh, skeleton);
  const floors = restPads(mesh, skeleton, soles).map((p) => p[3]);
  const gait = analyseGait(mesh, skeleton, played(mesh.skeleton, skeleton, source), soles);
  const off = (f: number): boolean => gait.paws.every((p, k) => p.low[f]! > floors[k]! + clear);
  let takeoff = -1;
  for (let f = 0; f < source.frames; f++) {
    if (off(f)) {
      takeoff = f;
      break;
    }
  }
  if (takeoff < 0) return null;
  let land = source.frames - 1;
  for (let f = takeoff; f < source.frames; f++) {
    if (!off(f)) {
      land = f;
      break;
    }
  }
  return { takeoff, land };
}

/**
 * The clip with the hips no higher than `ceiling` above where they stand at rest (the rest is the cat standing: an extension of the legs a little above it is the push-off and is kept).
 * The height taken out of a frame is spread a couple of frames each way, so that the crouch and the landing, which are the body's own, meet the flight without a corner.
 */
export function stayLow(skeleton: Skeleton, source: ClipSource, ceiling = 0.05, spread = 2): ClipSource {
  const hips = skeleton.bone("Hips");
  const frames = source.frames;
  const own = source.t[hips];
  const t = new Float64Array(frames * 3);
  for (let f = 0; f < frames; f++) for (let k = 0; k < 3; k++) t[f * 3 + k] = own ? own[f * 3 + k]! : skeleton.restT[hips * 3 + k]!;
  const limit = skeleton.restT[hips * 3 + 1]! + ceiling;
  const excess = Array.from({ length: frames }, (_, f) => Math.max(0, t[f * 3 + 1]! - limit));
  // (the height taken out is the biggest within `spread` frames, then eased over the same: so a frame that is lowered is never lowered less than the one that is its neighbour in the air)
  const widest = excess.map((_, f) => {
    let m = 0;
    for (let k = -spread; k <= spread; k++) m = Math.max(m, excess[Math.min(frames - 1, Math.max(0, f + k))]!);
    return m;
  });
  const eased = widest.map((_, f) => {
    let s = 0;
    for (let k = -spread; k <= spread; k++) s += widest[Math.min(frames - 1, Math.max(0, f + k))]!;
    return s / (2 * spread + 1);
  });
  for (let f = 0; f < frames; f++) t[f * 3 + 1] = t[f * 3 + 1]! - Math.max(eased[f]!, excess[f]!);
  const tt = source.t.slice();
  tt[hips] = t;
  return { ...source, t: tt };
}

/**
 * The body turned level in the air. A donor's body pitches nose up on the way up and nose down on the way down; the engine pitches the whole cat for the arc it is flying (the
 * renderer's `pitchAbout`), and a clip that pitched as well would turn the cat twice as far. So, from just before take-off to just after landing, the hips' pitch against rest (the
 * turn about the cat's own z) is taken out of the hips' turn; the way the back, legs and head are bent against the hips is left as it is.
 */
export function levelInAir(skeleton: Skeleton, source: ClipSource, moment: { takeoff: number; land: number }, ramp = 3): ClipSource {
  const hips = skeleton.bone("Hips");
  const frames = source.frames;
  const own = source.r[hips];
  const r = new Float64Array(frames * 4);
  for (let f = 0; f < frames; f++) for (let k = 0; k < 4; k++) r[f * 4 + k] = own ? own[f * 4 + k]! : skeleton.restR[hips * 4 + k]!;
  const rest = new Array<number>(9).fill(0);
  matrixOf(rest, skeleton.restR[hips * 4]!, skeleton.restR[hips * 4 + 1]!, skeleton.restR[hips * 4 + 2]!, skeleton.restR[hips * 4 + 3]!);
  const m = new Array<number>(9).fill(0);
  for (let f = 0; f < frames; f++) {
    // 1 in the air, 0 on the ground, eased over `ramp` frames either side
    const inside = Math.min(f - (moment.takeoff - ramp), moment.land + ramp - f) / ramp;
    const w = Math.max(0, Math.min(1, inside));
    if (w <= 0) continue;
    const eased = w * w * (3 - 2 * w);
    matrixOf(m, r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!);
    // (the turn against rest, in the cat's axes: D = R x R0^T; its pitch is the angle the cat's forward axis has gone up in the plane of the picture)
    const d0 = m[0]! * rest[0]! + m[1]! * rest[1]! + m[2]! * rest[2]!;
    const d3 = m[3]! * rest[0]! + m[4]! * rest[1]! + m[5]! * rest[2]!;
    const pitch = Math.atan2(d3, d0);
    const q = after([r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!], turnAbout(0, 0, 1, -eased * pitch));
    for (let k = 0; k < 4; k++) r[f * 4 + k] = q[k]!;
  }
  const rr = source.r.slice();
  rr[hips] = r;
  return { ...source, r: rr };
}

/** The clip's marks with the moments of a leap added, in seconds (the file's own unit). */
export function withLeapMarks(source: ClipSource, moment: { takeoff: number; land: number }): ClipSource {
  return { ...source, marks: { ...(source.marks ?? {}), takeoff: moment.takeoff / source.fps, land: moment.land / source.fps } };
}
