import type { Joint } from "../rig";
import type { CatMesh } from "./format";
import { HEAD_REST } from "./model";

/**
 * The locks of the coat: long hair is not a mist of single hairs, it lies in locks, each a flat tongue of hair that leaves the skin at a slant, runs the way the
 * coat is combed and ends in a soft point, with the next lock lying over its root like the tiles of a roof. They are made here from the mesh when the cat
 * is made (nothing of them is in the file): each lock is a curved ribbon laid on a point of the surface, carried by the bones that carry that point, and
 * drawn over the mesh by the same vertex program. The mesh says where hair is long and how long (the `fur` of its paint, in units of `LOCK_UNIT`); the way the
 * coat runs is worked out below from where the point is. What is under the locks (the short fur of the shells) shows between them.
 */

/** A hair of the mesh's `fur` 1 is this long in a lock, in body lengths. */
export const LOCK_UNIT = 0.04;
/** The fur below this has no locks (a muzzle, a paw and a lower leg have short hair). */
const MIN_FUR = 1.1;
/** The most the mesh's paint says: the paint's fur byte is this many to a unit of fur. */
export const FUR_PER_BYTE = 1 / 50;

export interface Locks {
  /** Vertices, in the order the locks were made. */
  count: number;
  pos: Float32Array;
  normal: Int8Array;
  skin: Uint8Array;
  weight: Uint8Array;
  paint: Uint8Array;
  /** Per vertex: how far along its lock it is (0 at the root, 255 at the tip), how far across (0 left edge, 128 middle, 255 right edge), the lock's own number, and a spare. */
  aux: Uint8Array;
  index: Uint16Array;
  /** The first of the locks are the coarse ones that cover the cat (a lean cat draws only those): how many triangles' indices they take. */
  mainIndex: number;
}

/** What a part of the coat does: how long its hair is against the mesh's fur, how wide a lock is for its length, how steeply it leaves the skin, how much it sags. */
interface Style {
  length: number;
  aspect: number;
  lift: number;
  sag: number;
  /** How far, in turns of the tangent plane, a lock may stray from the way the coat is combed. */
  swing: number;
  /** How much it bows to one side. */
  bow: number;
}

const STYLES = {
  body: { length: 1, aspect: 0.5, lift: 0.44, sag: 0.3, swing: 0.5, bow: 0.3 },
  chest: { length: 1.05, aspect: 0.5, lift: 0.7, sag: 0.18, swing: 0.55, bow: 0.3 },
  tail: { length: 1, aspect: 0.34, lift: 0.62, sag: 0.36, swing: 0.9, bow: 0.5 },
  leg: { length: 1, aspect: 0.55, lift: 0.3, sag: 0.0, swing: 0.4, bow: 0.25 },
  cheek: { length: 1, aspect: 0.5, lift: 0.5, sag: 0.2, swing: 0.4, bow: 0.3 },
} as const satisfies Record<string, Style>;
type Part = keyof typeof STYLES;

/** Rings of a lock along its length, and so its cost: three points across each ring, one at the tip. */
const RINGS = 5;
const VERTS = RINGS * 3 + 1;

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * How the locks of a cat of this mesh lie. `tail` is the rest of the tail (a line of points, up positive), for the way the hair of the tail runs; `density` is how
 * thick the coat is (1 is the full coat).
 */
export function makeLocks(mesh: CatMesh, tail: readonly Joint[], seed = 7, density = 1): Locks {
  const rand = mulberry(seed);
  const { pos, normal, skin, weight, paint, index } = mesh;
  const tris = index.length / 3;
  const furOf = (v: number): number => (paint[v * 4 + 1] ?? 0) * FUR_PER_BYTE;

  // the triangles where the hair is long, by their area
  const cdf = new Float64Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const a = index[t * 3]!;
    const b = index[t * 3 + 1]!;
    const c = index[t * 3 + 2]!;
    const fur = (furOf(a) + furOf(b) + furOf(c)) / 3;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    total += fur >= MIN_FUR ? area : 0;
    cdf[t] = total;
  }
  const pickTriangle = (): number => {
    const r = rand() * total;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const maxLocks = 1400;
  const outPos = new Float32Array(maxLocks * VERTS * 3);
  const outNormal = new Int8Array(maxLocks * VERTS * 3);
  const outSkin = new Uint8Array(maxLocks * VERTS * 4);
  const outWeight = new Uint8Array(maxLocks * VERTS * 4);
  const outPaint = new Uint8Array(maxLocks * VERTS * 4);
  const outAux = new Uint8Array(maxLocks * VERTS * 4);
  const outIndex = new Uint16Array(maxLocks * (RINGS - 1) * 12 + maxLocks * 6);
  let locks = 0;
  let indices = 0;
  let mainIndex = 0;

  // (where the roots are, so that no two are nearer than the room a lock needs: a grid of cells)
  const CELL = 0.05;
  const grid = new Map<number, number[]>();
  const roots: number[] = [];
  const widths: number[] = [];
  const cellKey = (x: number, y: number, z: number): number => ((Math.floor(x / CELL) + 64) * 4096 + (Math.floor(y / CELL) + 64)) * 128 + (Math.floor(z / CELL) + 64);
  const crowded = (x: number, y: number, z: number, room: number): boolean => {
    const reach = Math.ceil(room / CELL);
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        for (let k = -reach; k <= reach; k++) {
          const list = grid.get(((cx + i + 64) * 4096 + (cy + j + 64)) * 128 + (cz + k + 64));
          if (!list) continue;
          for (const n of list) {
            const d = Math.hypot(roots[n * 3]! - x, roots[n * 3 + 1]! - y, roots[n * 3 + 2]! - z);
            if (d < room) return true;
          }
        }
      }
    }
    return false;
  };

  const tailAt = (x: number, y: number): { dx: number; dy: number } => {
    let best = Infinity;
    let dx = 1;
    let dy = 0;
    for (let i = 0; i + 1 < tail.length; i++) {
      const a = tail[i]!;
      const b = tail[i + 1]!;
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const l2 = sx * sx + sy * sy || 1;
      const k = Math.max(0, Math.min(1, ((x - a.x) * sx + (y - a.y) * sy) / l2));
      const d = Math.hypot(x - (a.x + sx * k), y - (a.y + sy * k));
      if (d < best) {
        best = d;
        const l = Math.sqrt(l2);
        dx = sx / l;
        dy = sy / l;
      }
    }
    return { dx, dy };
  };

  const mergedBones = new Map<number, number>();
  const bonesOf = (verts: readonly number[], bary: readonly number[], outS: Uint8Array, outW: Uint8Array, at: number): void => {
    mergedBones.clear();
    for (let i = 0; i < verts.length; i++) {
      for (let k = 0; k < 4; k++) {
        const w = (weight[verts[i]! * 4 + k] ?? 0) * bary[i]!;
        if (w <= 0) continue;
        const b = skin[verts[i]! * 4 + k]!;
        mergedBones.set(b, (mergedBones.get(b) ?? 0) + w);
      }
    }
    const top = [...mergedBones.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    let given = 0;
    for (let k = 0; k < 4; k++) {
      const e = top[k];
      outS[at + k] = e ? e[0] : 0;
      const w = e ? Math.round((e[1] / sum) * 255) : 0;
      outW[at + k] = w;
      given += w;
    }
    outW[at] = outW[at]! + (255 - given);
  };

  const place = (pass: number, spacing: number, share: number): void => {
    const want = Math.round(maxLocks * share * density);
    let tries = 0;
    const budget = want * 14;
    let made = 0;
    while (made < want && tries < budget && locks < maxLocks) {
      tries++;
      const t = pickTriangle();
      const verts = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
      const r1 = Math.sqrt(rand());
      const r2 = rand();
      const bary = [1 - r1, r1 * (1 - r2), r1 * r2];
      const px = pos[verts[0]! * 3]! * bary[0]! + pos[verts[1]! * 3]! * bary[1]! + pos[verts[2]! * 3]! * bary[2]!;
      const py = pos[verts[0]! * 3 + 1]! * bary[0]! + pos[verts[1]! * 3 + 1]! * bary[1]! + pos[verts[2]! * 3 + 1]! * bary[2]!;
      const pz = pos[verts[0]! * 3 + 2]! * bary[0]! + pos[verts[1]! * 3 + 2]! * bary[1]! + pos[verts[2]! * 3 + 2]! * bary[2]!;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let open = 0;
      let furByte = 0;
      let uByte = 0;
      let limbByte = 0;
      for (let i = 0; i < 3; i++) {
        const v = verts[i]!;
        const w = bary[i]!;
        nx += (normal[v * 3] ?? 0) * w;
        ny += (normal[v * 3 + 1] ?? 0) * w;
        nz += (normal[v * 3 + 2] ?? 0) * w;
        open += (paint[v * 4] ?? 0) * w;
        furByte += (paint[v * 4 + 1] ?? 0) * w;
        uByte += (paint[v * 4 + 2] ?? 0) * w;
        limbByte += (paint[v * 4 + 3] ?? 0) * w;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const fur = furByte * FUR_PER_BYTE;
      if (fur < MIN_FUR) continue;

      // which part of the coat this is
      const hx = px - HEAD_REST[0];
      const hy = py - HEAD_REST[1];
      const hz = pz - HEAD_REST[2];
      const limb = limbByte / 255;
      const onTail = limb > 0.5 && px < -0.43 && py > 0.42;
      const onLeg = limb > 0.5 && !onTail;
      // (no locks on the ears or the crown, or anywhere above the eyes near the head)
      if (hy > 0.03 && hx * hx + hy * hy + hz * hz < 0.34 * 0.34) continue;
      const nearHead = hx * hx + hy * hy + hz * hz < 0.2 * 0.2;
      let part: Part = "body";
      if (onTail) part = "tail";
      else if (onLeg) part = "leg";
      else if (nearHead) part = "cheek";
      else if (px > 0.28 && py < 0.56) part = "chest";
      // the face is bare: hair grows on the cheek behind the eye and the whisker pad (at the side of the head, below the eye), not in front of them, over them, or on the crown
      if (part === "cheek" && (hx > 0.05 || hx < -0.07 || hy > -0.005 || Math.abs(hz) < 0.045)) continue;
      const style: Style = STYLES[part];

      let length = LOCK_UNIT * fur * style.length * (0.82 + 0.36 * rand());
      // (the hair of a leg ends above the floor, and does not grow into it)
      if (part === "leg") length = Math.min(length, Math.max(0, py - 0.035) * 0.9);
      if (length < 0.03) continue;
      const width = length * style.aspect * (0.85 + 0.3 * rand());
      const room = spacing * width;
      if (crowded(px, py, pz, room)) continue;

      // the way it runs: along the tangent plane of the skin, as the coat is combed here
      let fx: number;
      let fy: number;
      let fz: number;
      if (part === "tail") {
        const a = tailAt(px, py);
        fx = a.dx;
        fy = a.dy;
        fz = 0;
      } else if (part === "leg") {
        fx = -0.12;
        fy = -1;
        fz = 0;
      } else if (part === "chest") {
        // the ruff parts down the middle and falls to both sides
        fx = -0.18;
        fy = -1;
        fz = Math.sign(pz || 1) * 0.42;
      } else if (part === "cheek") {
        fx = -0.85;
        fy = -0.45 - 0.5 * Math.max(0, -hy / 0.08);
        fz = Math.sign(pz || 1) * 0.55;
      } else {
        // the lower the flank, the more the hair hangs; along the back it lies back and outward from the spine
        const low = Math.max(0, Math.min(1, (0.62 - py) / 0.28));
        fx = -1 + 0.55 * low;
        fy = -0.18 - 1.05 * low;
        fz = Math.sign(pz || 1) * 0.12 * (1 - low);
      }
      const dot = fx * nx + fy * ny + fz * nz;
      let tx = fx - nx * dot;
      let ty = fy - ny * dot;
      let tz = fz - nz * dot;
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 0.12) continue;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // (a little off the comb, lock by lock)
      const swing = (rand() - 0.5) * style.swing;
      const sx0 = ny * tz - nz * ty;
      const sy0 = nz * tx - nx * tz;
      const sz0 = nx * ty - ny * tx;
      tx += sx0 * swing;
      ty += sy0 * swing;
      tz += sz0 * swing;
      const tn = Math.hypot(tx, ty, tz) || 1;
      tx /= tn;
      ty /= tn;
      tz /= tn;
      // the side of the lock (its width runs along it)
      let sx = ny * tz - nz * ty;
      let sy = nz * tx - nx * tz;
      let sz = nx * ty - ny * tx;
      const sn = Math.hypot(sx, sy, sz) || 1;
      sx /= sn;
      sy /= sn;
      sz /= sn;

      roots.push(px, py, pz);
      widths.push(width);
      const key = cellKey(px, py, pz);
      const cell = grid.get(key);
      const at = roots.length / 3 - 1;
      if (cell) cell.push(at);
      else grid.set(key, [at]);

      // the ribbon: its centre line leaves the skin at a slant, and bows back towards it and downward; a little to one side
      const lift = style.lift * (0.8 + 0.4 * rand());
      const bow = (rand() - 0.5) * style.bow;
      const id = Math.round(rand() * 255);
      const base = locks * VERTS;
      const centre = (u: number): [number, number, number] => {
        const along = length * u;
        const up = length * lift * u * (1 - 0.72 * u);
        const sag = length * style.sag * u * u;
        const side = length * bow * u * u;
        return [px - nx * 0.004 + tx * along + nx * up + sx * side, py - ny * 0.004 + ty * along + ny * up + sy * side - sag, pz - nz * 0.004 + tz * along + nz * up + sz * side];
      };
      const widthAt = (u: number): number => width * (0.62 + 0.38 * Math.sin(Math.min(1, u / 0.35) * Math.PI * 0.5)) * Math.pow(Math.max(0, 1 - Math.pow(u, 1.7)), 0.75);
      for (let r = 0; r <= RINGS; r++) {
        const u = r / RINGS;
        const c = centre(u);
        const c0 = centre(Math.max(0, u - 0.06));
        const c1 = centre(Math.min(1, u + 0.06));
        let kx = c1[0] - c0[0];
        let ky = c1[1] - c0[1];
        let kz = c1[2] - c0[2];
        const kn = Math.hypot(kx, ky, kz) || 1;
        kx /= kn;
        ky /= kn;
        kz /= kn;
        // (the face of the ribbon turns as the lock does)
        let mx = ky * sz - kz * sy;
        let my = kz * sx - kx * sz;
        let mz = kx * sy - ky * sx;
        const mn = Math.hypot(mx, my, mz) || 1;
        mx /= mn;
        my /= mn;
        mz /= mn;
        const w = widthAt(u);
        const across = r === RINGS ? [0] : [-1, 0, 1];
        for (const a of across) {
          const v = base + (r === RINGS ? RINGS * 3 : r * 3 + a + 1);
          const bulge = a === 0 ? 0.24 * w : 0;
          outPos[v * 3] = c[0] + sx * w * 0.5 * a + mx * bulge;
          outPos[v * 3 + 1] = c[1] + sy * w * 0.5 * a + my * bulge;
          outPos[v * 3 + 2] = c[2] + sz * w * 0.5 * a + mz * bulge;
          let qx = mx + sx * 0.55 * a;
          let qy = my + sy * 0.55 * a;
          let qz = mz + sz * 0.55 * a;
          const qn = Math.hypot(qx, qy, qz) || 1;
          qx /= qn;
          qy /= qn;
          qz /= qn;
          outNormal[v * 3] = Math.round(qx * 127);
          outNormal[v * 3 + 1] = Math.round(qy * 127);
          outNormal[v * 3 + 2] = Math.round(qz * 127);
          bonesOf(verts, bary, outSkin, outWeight, v * 4);
          outPaint[v * 4] = Math.round(open);
          outPaint[v * 4 + 1] = Math.round(furByte);
          outPaint[v * 4 + 2] = Math.round(uByte);
          outPaint[v * 4 + 3] = Math.round(limbByte);
          outAux[v * 4] = Math.round(u * 255);
          outAux[v * 4 + 1] = a < 0 ? 0 : a === 0 ? 128 : 255;
          outAux[v * 4 + 2] = id;
        }
      }
      // the triangles: a strip of quads between each two rings, and a fan at the tip
      for (let r = 0; r < RINGS - 1; r++) {
        for (let a = 0; a < 2; a++) {
          const p0 = base + r * 3 + a;
          const p1 = p0 + 1;
          const q0 = p0 + 3;
          const q1 = p1 + 3;
          outIndex[indices++] = p0;
          outIndex[indices++] = p1;
          outIndex[indices++] = q0;
          outIndex[indices++] = p1;
          outIndex[indices++] = q1;
          outIndex[indices++] = q0;
        }
      }
      const last = base + (RINGS - 1) * 3;
      const tip = base + RINGS * 3;
      outIndex[indices++] = last;
      outIndex[indices++] = last + 1;
      outIndex[indices++] = tip;
      outIndex[indices++] = last + 1;
      outIndex[indices++] = last + 2;
      outIndex[indices++] = tip;
      locks++;
      made++;
    }
    if (pass === 0) mainIndex = indices;
  };

  // the coarse locks that cover the cat first, then the finer ones in the gaps between them
  place(0, 0.95, 0.42);
  place(1, 0.55, 1);

  const count = locks * VERTS;
  return {
    count,
    pos: outPos.slice(0, count * 3),
    normal: outNormal.slice(0, count * 3),
    skin: outSkin.slice(0, count * 4),
    weight: outWeight.slice(0, count * 4),
    paint: outPaint.slice(0, count * 4),
    aux: outAux.slice(0, count * 4),
    index: outIndex.slice(0, indices),
    mainIndex,
  };
}
