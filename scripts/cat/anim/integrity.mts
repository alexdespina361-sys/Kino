// Does the cat hold together? A pose that asks more of the skin than it can give makes the body stretch, fold in on itself or turn inside out: a candy-wrapper waist, a leg that
// thins to a thread, a flank that is pushed through the other. Each frame of a clip is skinned as the player skins it and the mesh is measured against the mesh at rest:
//   stretch   how much longer the edges of the triangles got (the biggest one, and the 99th percentile: a few fur tufts may stretch, a limb must not),
//   squash    how much shorter the shortest did (a fold),
//   area      how small the triangles got (a collapse) and how big (a smear), as the 1st and 99th percentile of the ratio to rest,
//   volume    what the mesh encloses, against what it enclosed at rest (a body that fills out or thins away),
//   flipped   the share of triangles that face the other way against the way they faced at rest, in the frame of the bone that carries them most (a surface turned inside out),
//   tufts     the same as stretch for pairs of points a hand's breadth apart that are NOT joined by an edge: the fur is a thousand separate small pieces, and an edge only says how a
//             piece holds together, not whether the tufts side by side tear apart (the 99th percentile and the biggest of the ratio, and the 1st percentile: tufts pushed into one another).
// Nothing here says a clip is good; it says where to look, and whether a clip is worse than the ones that are known to be fine.
import { Pose, dualSkin, sampleFrame, solve, solveDual, turnBy, type Adjust, type Clip, type Skeleton } from "../../../src/client/cat/render/gl/pose";
import type { ClipSource } from "../../../src/client/cat/render/gl/clipfile";
import type { CatMesh } from "../../../src/client/cat/render/gl/format";
import { nearby } from "../model/reskin.mts";
import { poseAt } from "./source.mts";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Points this far apart or less (at rest) are side by side; those nearer than `PAIR_NEAR` are the same hair and are left out (their ratio is mostly rounding). */
const PAIR_REACH = 0.02;
const PAIR_NEAR = 0.004;

export interface FrameIntegrity {
  frame: number;
  stretchMax: number;
  stretch99: number;
  squashMin: number;
  area1: number;
  area99: number;
  volume: number;
  flipped: number;
  tufts99: number;
  tuftsMax: number;
  tufts1: number;
}

export interface Integrity {
  frames: FrameIntegrity[];
  /** The worst of each over the clip. */
  worst: { stretchMax: number; stretch99: number; squashMin: number; area1: number; area99: number; volumeLow: number; volumeHigh: number; flipped: number; tufts99: number; tuftsMax: number; tufts1: number };
  /** The frame each worst number is at. */
  at: { stretch99: number; area1: number; volume: number; flipped: number };
}

/** The mesh's edges (each once, as the two vertices) and the triangles. */
function edgesOf(mesh: CatMesh): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  const n = mesh.count;
  const add = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * n + hi;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(lo, hi);
  };
  for (let i = 0; i + 2 < mesh.index.length; i += 3) {
    const a = mesh.index[i]!;
    const b = mesh.index[i + 1]!;
    const c = mesh.index[i + 2]!;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  return Uint32Array.from(out);
}

export class IntegrityMeter {
  private readonly edges: Uint32Array;
  private readonly rest: Float64Array;
  private readonly restLen: Float64Array;
  private readonly restArea: Float64Array;
  private readonly restNormal: Float64Array;
  private readonly restVolume: number;
  /** The pairs of points side by side at rest (two numbers a pair) and how far apart they are. */
  private readonly pairs: Uint32Array;
  private readonly pairRest: Float64Array;
  /** For each triangle, the bone that carries its first vertex the most (a surface's turn is told in that bone's frame). */
  private readonly carrier: Int32Array;
  private readonly pos: Float64Array;
  /** The bones as the card has them: eight numbers a bone for dual-quaternion skinning (what the player draws with), twelve for linear. */
  private readonly skin: Float32Array;
  private readonly at = [0, 0, 0];
  private readonly nor = [0, 0, 0];

  /** `skinning`: how the mesh is skinned: "dual" as the player's shader does it (default), "linear" as the model's own program would, to see what the one saves over the other. */
  constructor(
    private readonly mesh: CatMesh,
    private readonly skeleton: Skeleton,
    private readonly skinning: "dual" | "linear" = "dual",
  ) {
    this.edges = edgesOf(mesh);
    this.skin = new Float32Array(skeleton.count * (skinning === "dual" ? 8 : 12));
    this.pos = new Float64Array(mesh.count * 3);
    this.rest = new Float64Array(mesh.count * 3);
    this.skinned(new Pose(skeleton), this.rest);
    const e = this.edges.length / 2;
    this.restLen = new Float64Array(e);
    for (let i = 0; i < e; i++) this.restLen[i] = dist(this.rest, this.edges[i * 2]!, this.edges[i * 2 + 1]!);
    const t = mesh.index.length / 3;
    this.restArea = new Float64Array(t);
    this.restNormal = new Float64Array(t * 3);
    this.carrier = new Int32Array(t);
    for (let i = 0; i < t; i++) {
      const a = mesh.index[i * 3]!;
      const b = mesh.index[i * 3 + 1]!;
      const c = mesh.index[i * 3 + 2]!;
      this.restArea[i] = faceNormal(this.rest, a, b, c, this.restNormal, i * 3);
      let best = -1;
      let weight = -1;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weight[a * 4 + k]!;
        if (w > weight) {
          weight = w;
          best = mesh.skin[a * 4 + k]!;
        }
      }
      this.carrier[i] = best;
    }
    this.restVolume = volume(this.rest, mesh.index);
    const net = nearby(this.rest, mesh.count, PAIR_REACH);
    const pairs: number[] = [];
    const far: number[] = [];
    for (let v = 0; v < mesh.count; v++) {
      for (let i = net.start[v]!; i < net.start[v + 1]!; i++) {
        const u = net.list[i]!;
        if (u <= v) continue;
        const d = dist(this.rest, v, u);
        if (d < PAIR_NEAR) continue;
        pairs.push(v, u);
        far.push(d);
      }
    }
    this.pairs = Uint32Array.from(pairs);
    this.pairRest = Float64Array.from(far);
  }

  /** The mesh's vertices as the pose has them (and the turns the director lays on top of it, when they are given), in the cat's frame. */
  private skinned(pose: Pose, into: Float64Array, adjust?: readonly Adjust[]): void {
    const { mesh, skin } = this;
    if (this.skinning === "dual") {
      solveDual(this.skeleton, pose, skin, adjust);
      const { at, nor } = this;
      for (let v = 0; v < mesh.count; v++) {
        dualSkin(skin, mesh.skin, mesh.weight, v * 4, 1 / 255, mesh.pos[v * 3]!, mesh.pos[v * 3 + 1]!, mesh.pos[v * 3 + 2]!, 0, 0, 1, at, nor);
        into[v * 3] = at[0]!;
        into[v * 3 + 1] = at[1]!;
        into[v * 3 + 2] = at[2]!;
      }
      return;
    }
    solve(this.skeleton, pose, IDENTITY, skin, adjust);
    for (let v = 0; v < mesh.count; v++) {
      const px = mesh.pos[v * 3]!;
      const py = mesh.pos[v * 3 + 1]!;
      const pz = mesh.pos[v * 3 + 2]!;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 4; k++) {
        const w = mesh.weight[v * 4 + k]! / 255;
        if (w <= 0) continue;
        const o = mesh.skin[v * 4 + k]! * 12;
        x += w * (skin[o]! * px + skin[o + 1]! * py + skin[o + 2]! * pz + skin[o + 3]!);
        y += w * (skin[o + 4]! * px + skin[o + 5]! * py + skin[o + 6]! * pz + skin[o + 7]!);
        z += w * (skin[o + 8]! * px + skin[o + 9]! * py + skin[o + 10]! * pz + skin[o + 11]!);
      }
      into[v * 3] = x;
      into[v * 3 + 1] = y;
      into[v * 3 + 2] = z;
    }
  }

  frame(pose: Pose, f: number, adjust?: readonly Adjust[]): FrameIntegrity {
    const { mesh } = this;
    this.skinned(pose, this.pos, adjust);
    const e = this.edges.length / 2;
    const ratios = new Float64Array(e);
    let max = 0;
    let min = Infinity;
    for (let i = 0; i < e; i++) {
      const r = this.restLen[i]! > 1e-6 ? dist(this.pos, this.edges[i * 2]!, this.edges[i * 2 + 1]!) / this.restLen[i]! : 1;
      ratios[i] = r;
      if (r > max) max = r;
      if (r < min) min = r;
    }
    ratios.sort();
    const t = mesh.index.length / 3;
    const areas = new Float64Array(t);
    const normal = [0, 0, 0];
    let flipped = 0;
    let counted = 0;
    for (let i = 0; i < t; i++) {
      const a = mesh.index[i * 3]!;
      const b = mesh.index[i * 3 + 1]!;
      const c = mesh.index[i * 3 + 2]!;
      const area = faceNormal(this.pos, a, b, c, normal, 0);
      areas[i] = this.restArea[i]! > 1e-9 ? area / this.restArea[i]! : 1;
      if (this.restArea[i]! > 1e-7 && area > 1e-9) {
        // the face's normal against the one at rest, both told in the carrying bone's frame (the bone's turn is taken off the pose's normal with the skin matrix's rotation)
        const s = this.skin;
        const nx = normal[0]!;
        const ny = normal[1]!;
        const nz = normal[2]!;
        let bx: number;
        let by: number;
        let bz: number;
        if (this.skinning === "dual") {
          // (the bone's turn is a quaternion: the opposite turn takes a normal back to the rest frame)
          const o = this.carrier[i]! * 8;
          turnBy(-s[o]!, -s[o + 1]!, -s[o + 2]!, s[o + 3]!, nx, ny, nz, this.nor);
          bx = this.nor[0]!;
          by = this.nor[1]!;
          bz = this.nor[2]!;
        } else {
          // (the skin matrix is a rotation (and no scale) after the bind, so its transpose takes a normal back to the rest frame)
          const o = this.carrier[i]! * 12;
          bx = s[o]! * nx + s[o + 4]! * ny + s[o + 8]! * nz;
          by = s[o + 1]! * nx + s[o + 5]! * ny + s[o + 9]! * nz;
          bz = s[o + 2]! * nx + s[o + 6]! * ny + s[o + 10]! * nz;
        }
        const d = bx * this.restNormal[i * 3]! + by * this.restNormal[i * 3 + 1]! + bz * this.restNormal[i * 3 + 2]!;
        counted++;
        if (d < -0.2) flipped++;
      }
    }
    areas.sort();
    // (the tufts: a count of the ratios in steps of a hundredth, from 0 to 8)
    const bins = new Uint32Array(801);
    const np = this.pairs.length / 2;
    let tuftsMax = 0;
    for (let i = 0; i < np; i++) {
      const r = dist(this.pos, this.pairs[i * 2]!, this.pairs[i * 2 + 1]!) / this.pairRest[i]!;
      if (r > tuftsMax) tuftsMax = r;
      bins[Math.min(800, Math.floor(r * 100))]!++;
    }
    const at = (share: number): number => {
      let seen = 0;
      for (let b = 0; b <= 800; b++) {
        seen += bins[b]!;
        if (seen >= np * share) return (b + 0.5) / 100;
      }
      return 8;
    };
    return {
      frame: f,
      stretchMax: max,
      stretch99: ratios[Math.floor(e * 0.99)]!,
      squashMin: min,
      area1: areas[Math.floor(t * 0.01)]!,
      area99: areas[Math.floor(t * 0.99)]!,
      volume: volume(this.pos, mesh.index) / this.restVolume,
      flipped: counted ? flipped / counted : 0,
      tufts99: np ? at(0.99) : 1,
      tuftsMax: np ? tuftsMax : 1,
      tufts1: np ? at(0.01) : 1,
    };
  }

  /** A clip as its maker has it (clipfile.ts's `ClipSource`), or as the player has it from the file (`Clip`). */
  clip(clip: ClipSource | Clip): Integrity {
    const pose = new Pose(this.skeleton);
    const frames: FrameIntegrity[] = [];
    for (let f = 0; f < clip.frames; f++) {
      if ("rKind" in clip) sampleFrame(clip, f, pose);
      else poseAt(this.skeleton, clip, f, pose);
      frames.push(this.frame(pose, f));
    }
    const worst = {
      stretchMax: Math.max(...frames.map((x) => x.stretchMax)),
      stretch99: Math.max(...frames.map((x) => x.stretch99)),
      squashMin: Math.min(...frames.map((x) => x.squashMin)),
      area1: Math.min(...frames.map((x) => x.area1)),
      area99: Math.max(...frames.map((x) => x.area99)),
      volumeLow: Math.min(...frames.map((x) => x.volume)),
      volumeHigh: Math.max(...frames.map((x) => x.volume)),
      flipped: Math.max(...frames.map((x) => x.flipped)),
      tufts99: Math.max(...frames.map((x) => x.tufts99)),
      tuftsMax: Math.max(...frames.map((x) => x.tuftsMax)),
      tufts1: Math.min(...frames.map((x) => x.tufts1)),
    };
    const argmax = (key: (x: FrameIntegrity) => number): number => frames.reduce((best, x) => (key(x) > key(frames[best]!) ? x.frame : best), 0);
    return {
      frames,
      worst,
      at: {
        stretch99: argmax((x) => x.stretch99),
        area1: argmax((x) => -x.area1),
        volume: argmax((x) => Math.abs(Math.log(x.volume))),
        flipped: argmax((x) => x.flipped),
      },
    };
  }
}

function dist(p: Float64Array, a: number, b: number): number {
  return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
}

/** The area of the triangle abc, and its unit normal written to `into` at `at`. */
function faceNormal(p: Float64Array, a: number, b: number, c: number, into: ArrayLike<number> & { [i: number]: number }, at: number): number {
  const ux = p[b * 3]! - p[a * 3]!;
  const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
  const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!;
  const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
  const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l > 1e-12) {
    into[at] = nx / l;
    into[at + 1] = ny / l;
    into[at + 2] = nz / l;
  } else {
    into[at] = 0;
    into[at + 1] = 0;
    into[at + 2] = 0;
  }
  return l / 2;
}

/** What the surface encloses (the sum of the signed volumes of the tetrahedra from the origin: right for a closed surface, and a fair number to compare by for one that is nearly). */
function volume(p: Float64Array, index: Uint16Array): number {
  let v = 0;
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i]! * 3;
    const b = index[i + 1]! * 3;
    const c = index[i + 2]! * 3;
    v += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  return v;
}
