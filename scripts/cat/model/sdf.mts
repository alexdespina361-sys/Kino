// Signed distance fields and a surface extractor, for building the cat's body offline (scripts/cat/model/build.mts).
// Development tooling: nothing of this is in the app; the app only loads the mesh that comes out.

export type Dist = (x: number, y: number, z: number) => number;
export type Box = readonly [number, number, number, number, number, number];

export interface Prim {
  name: string;
  /** The bone that carries what this part of the surface is made of (see render/gl/skeleton.ts). */
  bone: number;
  /** How softly this part grows into what is already there (the radius of the smooth union). */
  k: number;
  /** How wide the weights spread: the larger, the more the neighbours' bones carry this part too. */
  tau: number;
  /** What the part is (an id the shader paints by). */
  region: number;
  /** How long the fur is here (1 is the usual). */
  fur: number;
  d: Dist;
  box: Box;
  /** Where along a limb or the tail a point is, 0..1 (for the bands of the fur). */
  u?: (x: number, y: number, z: number) => number;
}

export const smin = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Subtract `b` from `a`, softly. */
export const ssub = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a + b), 0) / k;
  return Math.max(a, -b) + h * h * k * 0.25;
};

type Vec3 = readonly [number, number, number];

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** An orthonormal frame whose first axis is `ax` (the others are as the second hint allows). */
export function frameOf(ax: Vec3, hint: Vec3 = [0, 0, 1]): [Vec3, Vec3, Vec3] {
  const a = norm(ax);
  let h = hint;
  if (Math.abs(a[0] * h[0] + a[1] * h[1] + a[2] * h[2]) > 0.95) h = [0, 1, 0];
  const b = norm(cross(h, a));
  const c = cross(a, b);
  return [a, b, c];
}

export interface EllipsoidOpts {
  /** The axis the first radius lies along (the others follow `hint`). */
  axis?: Vec3;
  hint?: Vec3;
}

/** An ellipsoid centred on c with radii r along (axis, side, the third), axis defaulting to x. */
export function ellipsoid(c: Vec3, r: Vec3, opts: EllipsoidOpts = {}): { d: Dist; box: Box } {
  const [ax, ay, az] = frameOf(opts.axis ?? [1, 0, 0], opts.hint ?? [0, 0, 1]);
  const [rx, ry, rz] = r;
  const irx = 1 / rx;
  const iry = 1 / ry;
  const irz = 1 / rz;
  const R = Math.max(rx, ry, rz);
  return {
    d: (x, y, z) => {
      const dx = x - c[0];
      const dy = y - c[1];
      const dz = z - c[2];
      const lx = ax[0] * dx + ax[1] * dy + ax[2] * dz;
      const ly = ay[0] * dx + ay[1] * dy + ay[2] * dz;
      const lz = az[0] * dx + az[1] * dy + az[2] * dz;
      const k0 = Math.hypot(lx * irx, ly * iry, lz * irz);
      const k1 = Math.hypot(lx * irx * irx, ly * iry * iry, lz * irz * irz);
      return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
    },
    box: [c[0] - R, c[1] - R, c[2] - R, c[0] + R, c[1] + R, c[2] + R],
  };
}

/** A capsule with a radius at each end (a "round cone"), after Inigo Quilez's formula. */
export function roundCone(a: Vec3, b: Vec3, r1: number, r2: number): { d: Dist; box: Box; t: (x: number, y: number, z: number) => number } {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const R = Math.max(r1, r2);
  return {
    d: (x, y, z) => {
      const pax = x - a[0];
      const pay = y - a[1];
      const paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    box: [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R, Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R],
    t: (x, y, z) => Math.max(0, Math.min(1, ((x - a[0]) * bax + (y - a[1]) * bay + (z - a[2]) * baz) * il2)),
  };
}

/** A shape placed in a frame of its own, squeezed along one axis (a flat ear is a cone squeezed in its thickness). */
export function squeezed(inner: { d: Dist; box: Box }, origin: Vec3, frame: [Vec3, Vec3, Vec3], squeeze: Vec3): { d: Dist; box: Box } {
  const [ax, ay, az] = frame;
  const [sx, sy, sz] = squeeze;
  const smax = Math.max(sx, sy, sz);
  const smin_ = Math.min(sx, sy, sz);
  // the inner shape is made in local coordinates (axis, side, third), then stretched by 1 / squeeze
  return {
    d: (x, y, z) => {
      const dx = x - origin[0];
      const dy = y - origin[1];
      const dz = z - origin[2];
      const lx = (ax[0] * dx + ax[1] * dy + ax[2] * dz) * sx;
      const ly = (ay[0] * dx + ay[1] * dy + ay[2] * dz) * sy;
      const lz = (az[0] * dx + az[1] * dy + az[2] * dz) * sz;
      return inner.d(lx, ly, lz) / smax;
    },
    box: [
      origin[0] + (inner.box[0] - 0) / smin_ - 0.05,
      origin[1] + (inner.box[1] - 0) / smin_ - 0.05,
      origin[2] + (inner.box[2] - 0) / smin_ - 0.05,
      origin[0] + (inner.box[3] - 0) / smin_ + 0.05,
      origin[1] + (inner.box[4] - 0) / smin_ + 0.05,
      origin[2] + (inner.box[5] - 0) / smin_ + 0.05,
    ],
  };
}

export interface Scene {
  prims: Prim[];
  /** Carved out of the union afterwards: (distance, softness). */
  cuts: Array<{ d: Dist; box: Box; k: number }>;
}

const boxGap = (b: Box, x: number, y: number, z: number): number => {
  const dx = Math.max(b[0] - x, 0, x - b[3]);
  const dy = Math.max(b[1] - y, 0, y - b[4]);
  const dz = Math.max(b[2] - z, 0, z - b[5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export function makeField(scene: Scene): Dist {
  const { prims, cuts } = scene;
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i]!;
      const lb = boxGap(p.box, x, y, z) * 0.7;
      if (lb > d + p.k + 0.02) continue;
      d = smin(d, p.d(x, y, z), p.k);
    }
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i]!;
      if (boxGap(c.box, x, y, z) > Math.abs(d) + c.k + 0.02) continue;
      d = ssub(d, c.d(x, y, z), c.k);
    }
    return d;
  };
}

/* ------------------------------ surface nets ------------------------------ */

export interface Lattice {
  /** The world position of grid point (0, 0, 0). */
  ox: number;
  oy: number;
  oz: number;
  h: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface RawMesh {
  /** Vertex positions (world), three numbers each. */
  pos: Float32Array;
  /** Triangles, three vertex numbers each. */
  tri: Uint32Array;
}

/** Samples a field on a lattice. */
export function sample(field: Dist, g: Lattice): Float32Array {
  const out = new Float32Array(g.nx * g.ny * g.nz);
  let at = 0;
  for (let k = 0; k < g.nz; k++) {
    const z = g.oz + k * g.h;
    for (let j = 0; j < g.ny; j++) {
      const y = g.oy + j * g.h;
      for (let i = 0; i < g.nx; i++) out[at++] = field(g.ox + i * g.h, y, z);
    }
  }
  return out;
}

const CUBE_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [3, 7],
  [2, 6],
];

/** Naive surface nets: one vertex in each cell the surface crosses, a quad over each crossed edge. */
export function surfaceNets(values: Float32Array, g: Lattice): RawMesh {
  const { nx, ny, nz, h } = g;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const verts: number[] = [];
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const corner = new Float64Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = values[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]!;
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of CUBE_EDGES) {
          const va = corner[a]!;
          const vb = corner[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ax = a & 1;
          const ay = (a >> 1) & 1;
          const az = (a >> 2) & 1;
          const bx = b & 1;
          const by = (b >> 1) & 1;
          const bz = (b >> 2) & 1;
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        }
        cellVert[i + cx * (j + cy * k)] = verts.length / 3;
        verts.push(g.ox + (i + sx / n) * h, g.oy + (j + sy / n) * h, g.oz + (k + sz / n) * h);
      }
    }
  }
  const tris: number[] = [];
  const cell = (i: number, j: number, k: number) => cellVert[i + cx * (j + cy * k)]!;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = values[idx(i, j, k)]! < 0;
        // an edge along x from (i,j,k) to (i+1,j,k) (the four cells around it: (i, j-1..j, k-1..k))
        if (i < cx) {
          const v1 = values[idx(i + 1, j, k)]! < 0;
          if (v0 !== v1) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), v0);
        }
        if (j < cy) {
          const v1 = values[idx(i, j + 1, k)]! < 0;
          if (v0 !== v1) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), v0);
        }
        if (k < cz) {
          const v1 = values[idx(i, j, k + 1)]! < 0;
          if (v0 !== v1) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), v0);
        }
      }
    }
  }
  return { pos: Float32Array.from(verts), tri: Uint32Array.from(tris) };
}

/** The gradient of a field (unit length) by central differences. */
export function gradient(field: Dist, x: number, y: number, z: number, e = 0.0025): [number, number, number] {
  const gx = field(x + e, y, z) - field(x - e, y, z);
  const gy = field(x, y + e, z) - field(x, y - e, z);
  const gz = field(x, y, z + e) - field(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
