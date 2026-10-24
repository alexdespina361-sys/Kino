// The floor. A retargeted clip puts the cat's bones where another animal's were, and nothing in that knows where the floor is: a play bow can have the chest through it, a sit
// can have the haunches above it. Here the whole cat is moved up or down (the hips' height, frame by frame) so that the lowest part of the mesh is where the floor is:
//   pin   the lowest part is on the floor in every frame (a cat that stays on the ground: sitting, standing, stretching, and the crouch and landing of a jump, whose flight is the
//         engine's own: it carries the cat up),
//   lift  the cat is only ever raised, never lowered (a gallop has moments in the air, which are the clip's).
// The height is smoothed over a few frames so that the root does not shiver with whichever tuft of fur happens to be lowest.
import { Pose, solve, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { poseAt } from "./source.mts";

export type FloorPolicy = "pin" | "lift";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** How low the skinned mesh reaches at a pose: the mean height of its lowest vertices (so that one tuft does not decide). */
export function reach(mesh: CatMesh, skeleton: Skeleton, pose: Pose, skin: Float32Array, ys: Float32Array, few = 24): number {
  solve(skeleton, pose, IDENTITY, skin);
  for (let v = 0; v < mesh.count; v++) {
    const px = mesh.pos[v * 3]!;
    const py = mesh.pos[v * 3 + 1]!;
    const pz = mesh.pos[v * 3 + 2]!;
    let y = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weight[v * 4 + k]! / 255;
      if (w <= 0) continue;
      const o = mesh.skin[v * 4 + k]! * 12;
      y += w * (skin[o + 4]! * px + skin[o + 5]! * py + skin[o + 6]! * pz + skin[o + 7]!);
    }
    ys[v] = y;
  }
  // (the lowest few: a partial selection, the few smallest kept in order)
  const low = new Float32Array(few).fill(Infinity);
  for (let v = 0; v < mesh.count; v++) {
    const y = ys[v]!;
    if (y >= low[few - 1]!) continue;
    let i = few - 1;
    while (i > 0 && low[i - 1]! > y) {
      low[i] = low[i - 1]!;
      i--;
    }
    low[i] = y;
  }
  let sum = 0;
  for (let i = 0; i < few; i++) sum += low[i]!;
  return sum / few;
}

/** How high the cat has to be raised, at each frame of a clip, to have its lowest part on the floor (negative: lowered). */
export function heights(mesh: CatMesh, skeleton: Skeleton, source: ClipSource): number[] {
  const skin = new Float32Array(skeleton.count * 12);
  const ys = new Float32Array(mesh.count);
  const pose = new Pose(skeleton);
  const floor = reach(mesh, skeleton, new Pose(skeleton), skin, ys);
  const out: number[] = [];
  for (let f = 0; f < source.frames; f++) {
    poseAt(skeleton, source, f, pose);
    out.push(floor - reach(mesh, skeleton, pose, skin, ys));
  }
  return out;
}

const at = (a: readonly number[], i: number, loop: boolean): number => (loop ? a[((i % a.length) + a.length) % a.length]! : a[Math.min(a.length - 1, Math.max(0, i))]!);

export function keepOnFloor(mesh: CatMesh, skeleton: Skeleton, source: ClipSource, policy: FloorPolicy, smooth = 2): { source: ClipSource; lift: number[] } {
  const hips = skeleton.bone("Hips");
  const raw = heights(mesh, skeleton, source).map((h) => (policy === "lift" ? Math.max(0, h) : h));
  // ("lift" is smoothed by the largest in the neighbourhood first, so that smoothing never gives back a bit of the floor that was taken)
  const widest = policy === "lift" ? raw.map((_, i) => Math.max(...Array.from({ length: 2 * smooth + 1 }, (_, k) => at(raw, i + k - smooth, source.loop)))) : raw;
  const lift = widest.map((_, i) => {
    let s = 0;
    for (let k = -smooth; k <= smooth; k++) s += at(widest, i + k, source.loop);
    return s / (2 * smooth + 1);
  });
  const t = new Float64Array(source.frames * 3);
  const own = source.t[hips];
  for (let f = 0; f < source.frames; f++) {
    for (let k = 0; k < 3; k++) t[f * 3 + k] = own ? own[f * 3 + k]! : skeleton.restT[hips * 3 + k]!;
    t[f * 3 + 1] = t[f * 3 + 1]! + lift[f]!;
  }
  const tt = source.t.slice();
  tt[hips] = t;
  return { source: { ...source, t: tt }, lift };
}
