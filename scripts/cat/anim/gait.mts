// What a clip says about the ground. For a gait: where each paw's pad is while it is down, how far one cycle carries the cat without the paws sliding (the stride), and when each
// paw lands. For any clip: how far the cat is above (or through) the floor. The pads are measured on the mesh as the pose player skins it (src/client/cat/render/gl/pose.ts), in the
// cat's frame (x forward, y up, z across; body lengths), so that what is measured is what is drawn.
import { Pose, Skeleton, globals, sampleFrame, solve, type Clip } from "../../../src/client/cat/render/gl/pose";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";

export const PAWS = [
  { name: "hind left", bones: ["backleg0", "backleg1", "backleg2"] },
  { name: "hind right", bones: ["R_backleg0", "R_backleg1", "R_backleg2"] },
  { name: "front left", bones: ["frontleg0", "frontleg1", "frontleg2"] },
  { name: "front right", bones: ["R_frontleg0", "R_frontleg1", "R_frontleg2"] },
] as const;

/** The vertices of the soles: the points of the mesh near the floor that a paw's bones carry, for each paw. */
export function soleVertices(mesh: CatMesh, skeleton: Skeleton, floor = 0.04): number[][] {
  return PAWS.map((paw) => {
    const ids = paw.bones.map((b) => skeleton.bone(b));
    const out: number[] = [];
    for (let v = 0; v < mesh.count; v++) {
      if (mesh.pos[v * 3 + 1]! > floor) continue;
      let w = 0;
      for (let k = 0; k < 4; k++) if (ids.includes(mesh.skin[v * 4 + k]!)) w += mesh.weight[v * 4 + k]! / 255;
      if (w >= 0.5) out.push(v);
    }
    return out;
  });
}

export interface PawTrack {
  name: string;
  /** The middle of the paw's sole at each frame: forward of the hips, up from the floor. */
  x: number[];
  y: number[];
  /** How far above the floor the lowest point of the sole is, at each frame (negative: through it). */
  low: number[];
  /** The frames the paw is down in. */
  down: boolean[];
  /** The frame at which the paw lands (the first of a run of frames down), -1 if it is always down or never. */
  lands: number;
  /** The height of the pad while it is down, on average (the floor, as this paw sees it), and how far it goes from that. */
  floor: number;
  scatter: number;
  /** How far the pad slides over the ground while it is down, going at the clip's speed (body lengths). */
  slide: number;
}

export interface Gait {
  paws: PawTrack[];
  /** Body lengths a second the cat goes at, if its paws are to stay where they land. */
  speed: number;
  /** Body lengths of ground in one cycle (0 for a clip whose paws do not walk). */
  stride: number;
  /** The most any paw slides while it is down (body lengths). */
  slide: number;
}

/** The skinned places of the vertices of each paw's sole at a pose: their middle, and how low the lowest of them is. */
function pads(mesh: CatMesh, skeleton: Skeleton, pose: Pose, soles: number[][], skin: Float32Array): Array<[number, number, number, number]> {
  solve(skeleton, pose, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], skin);
  return soles.map((list) => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let low = Infinity;
    for (const v of list) {
      const p = [mesh.pos[v * 3]!, mesh.pos[v * 3 + 1]!, mesh.pos[v * 3 + 2]!];
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weight[v * 4 + k]! / 255;
        if (w <= 0) continue;
        const o = mesh.skin[v * 4 + k]! * 12;
        x += w * (skin[o]! * p[0]! + skin[o + 1]! * p[1]! + skin[o + 2]! * p[2]! + skin[o + 3]!);
        y += w * (skin[o + 4]! * p[0]! + skin[o + 5]! * p[1]! + skin[o + 6]! * p[2]! + skin[o + 7]!);
        z += w * (skin[o + 8]! * p[0]! + skin[o + 9]! * p[1]! + skin[o + 10]! * p[2]! + skin[o + 11]!);
      }
      sx += x;
      sy += y;
      sz += z;
      if (y < low) low = y;
    }
    const n = list.length || 1;
    return [sx / n, sy / n, sz / n, list.length ? low : 0];
  });
}

/** Where the hips are (the root joint), in the cat's frame, at a pose. */
function hipsAt(skeleton: Skeleton, pose: Pose, R: Float64Array, T: Float64Array): [number, number, number] {
  globals(skeleton, pose, undefined, R, T);
  const root = skeleton.bone("Hips");
  return [T[root * 3]!, T[root * 3 + 1]!, T[root * 3 + 2]!];
}

/**
 * The frames a paw is on the ground for, if the cat goes along at `v` body lengths a second: those at which the paw is where it was in the world (its place against the hips,
 * plus the ground the hips have covered, stays within `eps`). The longest such run, taken round the loop.
 */
function stanceAt(x: number[], fps: number, v: number, eps: number): boolean[] {
  const n = x.length;
  const world = (f: number): number => x[f % n]! + (v * f) / fps;
  let best = { from: 0, length: 0 };
  for (let a = 0; a < n; a++) {
    let length = 1;
    let lo = world(a);
    let hi = lo;
    while (length < n) {
      const w = world(a + length);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
      if (hi - lo > eps) break;
      length++;
    }
    if (length > best.length) best = { from: a, length };
  }
  const down = new Array<boolean>(n).fill(false);
  for (let k = 0; k < best.length; k++) down[(best.from + k) % n] = true;
  return down;
}

/** The speeds (body lengths a second) a gait may be going at: from `min` to `max`, and the one that is the likelier when several hold the paws down equally. */
export interface SpeedRange {
  min: number;
  max: number;
  prefer: number;
}

/** A walk goes at about a body length a second; a gallop at several. */
export const WALKING: SpeedRange = { min: 0.1, max: 2.6, prefer: 0.6 };
export const RUNNING: SpeedRange = { min: 1.5, max: 9, prefer: 4 };

/** The speed (body lengths a second) at which the paws of a gait are down for the most frames altogether: the speed the clip's cat is walking at. */
export function bestSpeed(xs: number[][], fps: number, eps = 0.012, range: SpeedRange = WALKING): { v: number; down: boolean[][] } {
  let best = { v: 0, total: -1, down: xs.map((x) => x.map(() => false)) };
  // (steps of a hundredth, or of a hundredth of the range's top if that is bigger: a gallop is searched as finely as a walk, relative to its speed)
  const step = Math.max(0.01, range.max / 260);
  for (let v = range.min; v <= range.max; v += step) {
    const down = xs.map((x) => stanceAt(x, fps, v, eps));
    const total = down.reduce((s, d) => s + d.filter(Boolean).length, 0);
    // (a faster speed that covers as many frames is the likelier: a slow one holds a paw still for want of anything else)
    if (total > best.total || (total === best.total && Math.abs(v - range.prefer) < Math.abs(best.v - range.prefer))) best = { v, total, down };
  }
  return { v: best.v, down: best.down };
}

export function analyseGait(mesh: CatMesh, skeleton: Skeleton, clip: Clip, soles = soleVertices(mesh, skeleton), range: SpeedRange = WALKING): Gait {
  const n = skeleton.count;
  const R = new Float64Array(n * 9);
  const T = new Float64Array(n * 3);
  const pose = new Pose(skeleton);
  const skin = new Float32Array(n * 12);
  const frames = clip.frames;
  const xs = PAWS.map(() => new Array<number>(frames).fill(0));
  const ys = PAWS.map(() => new Array<number>(frames).fill(0));
  const lows = PAWS.map(() => new Array<number>(frames).fill(0));
  for (let f = 0; f < frames; f++) {
    sampleFrame(clip, f, pose);
    const hips = hipsAt(skeleton, pose, R, T);
    pads(mesh, skeleton, pose, soles, skin).forEach((p, k) => {
      xs[k]![f] = p[0] - hips[0];
      ys[k]![f] = p[1];
      lows[k]![f] = p[3];
    });
  }
  // the speed the cat goes at is the one at which the paws stay put in the world the most: a paw is down for the frames it does
  const { v: walking, down: downs } = bestSpeed(xs, clip.fps, 0.012, range);
  const paws: PawTrack[] = PAWS.map((paw, k) => {
    const y = ys[k]!;
    const x = xs[k]!;
    const down = downs[k]!;
    const m = down.filter(Boolean).length;
    let lands = -1;
    for (let f = 0; f < frames; f++) if (down[f] && !down[(f + frames - 1) % frames]) lands = f;
    const floorY = m > 0 ? y.reduce((s, v, f) => s + (down[f] ? v : 0), 0) / m : Math.min(...y);
    const scatter = m > 0 ? Math.sqrt(y.reduce((s, v, f) => s + (down[f] ? (v - floorY) ** 2 : 0), 0) / m) : 0;
    // where the pad is in the world while it is down (counted from the frame it lands, so that a run which goes round the loop is one run)
    let lo = Infinity;
    let hi = -Infinity;
    if (lands >= 0) {
      for (let j = 0; j < frames && down[(lands + j) % frames]; j++) {
        const w = x[(lands + j) % frames]! + (walking * j) / clip.fps;
        lo = Math.min(lo, w);
        hi = Math.max(hi, w);
      }
    }
    return { name: paw.name, x, y, low: lows[k]!, down, lands, floor: floorY, scatter, slide: hi >= lo ? hi - lo : 0 };
  });
  const stride = (walking * frames) / clip.fps;
  return { paws, speed: walking, stride, slide: Math.max(...paws.map((p) => p.slide)) };
}

/** The pads at rest: the height the soles are at when the cat stands as it was made (the floor, as the mesh has it). */
export function restPads(mesh: CatMesh, skeleton: Skeleton, soles = soleVertices(mesh, skeleton)): Array<[number, number, number, number]> {
  const pose = new Pose(skeleton);
  return pads(mesh, skeleton, pose, soles, new Float32Array(skeleton.count * 12));
}
