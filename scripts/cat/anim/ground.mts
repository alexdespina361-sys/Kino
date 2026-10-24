// Putting a gait on the floor. The paws of a walk that was not made against a floor (the model's own, made by an AI program, hovers a paw's width above it) are brought down by
// moving the whole cat: a lift of the hips and a pitch about them, the same in every frame, chosen so that the lowest point of each paw is at the floor (as the mesh has it at
// rest) while that paw is down. Nothing else of the clip is touched, so the way the legs bend is the maker's own.
import { after, turnAbout, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import { decodeClips, encodeClips, type ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { analyseGait, restPads, soleVertices, WALKING, type Gait, type SpeedRange } from "./gait.mts";

export interface GroundFit {
  /** Body lengths the hips were lowered by (negative) or raised by, and the turn about the hips (radians; negative is the nose down). */
  lift: number;
  pitch: number;
  /** How far the paws that were down were from the floor, on average (their lowest points), before and after. */
  before: number;
  after: number;
  /** The lowest any paw goes, below the floor (a negative number), over the whole cycle, before and after. */
  lowestBefore: number;
  lowestAfter: number;
}

/** A clip source as the player will have it (through the file's own rounding). */
export function played(data: Parameters<typeof encodeClips>[0], skeleton: Skeleton, source: ClipSource): Clip {
  const bytes = encodeClips(data, [source]);
  return decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton)[0]!;
}

function meanLow(gait: Gait, floors: number[]): number {
  let sum = 0;
  let n = 0;
  gait.paws.forEach((p, k) => {
    for (let f = 0; f < p.low.length; f++) if (p.down[f]) { sum += Math.abs(p.low[f]! - floors[k]!); n++; }
  });
  return n ? sum / n : 0;
}

function lowest(gait: Gait, floors: number[]): number {
  let m = Infinity;
  gait.paws.forEach((p, k) => p.low.forEach((v) => (m = Math.min(m, v - floors[k]!))));
  return m;
}

export function groundGait(mesh: CatMesh, skeleton: Skeleton, source: ClipSource, soles = soleVertices(mesh, skeleton), range: SpeedRange = WALKING): { source: ClipSource; fit: GroundFit } {
  const data = mesh.skeleton;
  const floors = restPads(mesh, skeleton, soles).map((p) => p[3]);
  const hips = skeleton.bone("Hips");
  const frames = source.frames;
  // the hips' own turn and place, frame by frame, as working numbers
  const r = new Float64Array(frames * 4);
  const t = new Float64Array(frames * 3);
  const rSrc = source.r[hips];
  const tSrc = source.t[hips];
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 4; k++) r[f * 4 + k] = rSrc ? rSrc[f * 4 + k]! : skeleton.restR[hips * 4 + k]!;
    for (let k = 0; k < 3; k++) t[f * 3 + k] = tSrc ? tSrc[f * 3 + k]! : skeleton.restT[hips * 3 + k]!;
  }
  const current = (): ClipSource => {
    const rr = source.r.slice();
    const tt = source.t.slice();
    rr[hips] = r;
    tt[hips] = t;
    return { ...source, r: rr, t: tt };
  };
  const first = analyseGait(mesh, skeleton, played(data, skeleton, current()), soles, range);
  const before = meanLow(first, floors);
  const lowestBefore = lowest(first, floors);
  let lift = 0;
  let pitch = 0;
  for (let pass = 0; pass < 4; pass++) {
    const gait = pass === 0 ? first : analyseGait(mesh, skeleton, played(data, skeleton, current()), soles, range);
    // least squares for a lift c and a pitch a: (the lowest point of a paw + c + a x ahead of the hips) = its floor, over the paws that are down
    let n = 0, sx = 0, sxx = 0, sy = 0, sxy = 0;
    gait.paws.forEach((p, k) => {
      for (let f = 0; f < frames; f++) {
        if (!p.down[f]) continue;
        const e = p.low[f]! - floors[k]!;
        n++;
        sx += p.x[f]!;
        sxx += p.x[f]! * p.x[f]!;
        sy += e;
        sxy += e * p.x[f]!;
      }
    });
    if (n === 0) break;
    const det = n * sxx - sx * sx;
    if (Math.abs(det) < 1e-9) break;
    const c = -(sxx * sy - sx * sxy) / det;
    const a = -(n * sxy - sx * sy) / det;
    lift += c;
    pitch += a;
    const turn = turnAbout(0, 0, 1, a);
    for (let f = 0; f < frames; f++) {
      const q = after([r[f * 4]!, r[f * 4 + 1]!, r[f * 4 + 2]!, r[f * 4 + 3]!], turn);
      for (let k = 0; k < 4; k++) r[f * 4 + k] = q[k]!;
      t[f * 3 + 1] = t[f * 3 + 1]! + c;
    }
    if (Math.abs(c) < 1e-5 && Math.abs(a) < 1e-5) break;
  }
  const out = current();
  const last = analyseGait(mesh, skeleton, played(data, skeleton, out), soles, range);
  return { source: out, fit: { lift, pitch, before, after: meanLow(last, floors), lowestBefore, lowestAfter: lowest(last, floors) } };
}
