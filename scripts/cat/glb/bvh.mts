// A small bounding volume hierarchy over triangles, for asking whether a ray meets a surface before some distance, and for baking how open to the room each point of a mesh is.
// Development tooling only.

export class Bvh {
  private readonly nodeMin: Float32Array;
  private readonly nodeMax: Float32Array;
  /** For a node: the first child (or, for a leaf, the first triangle) and how many triangles (0 for an inner node). */
  private readonly nodeA: Int32Array;
  private readonly nodeN: Int32Array;
  private readonly order: Int32Array;
  private nodes = 0;
  private readonly cx: Float32Array;

  constructor(
    private readonly pos: ArrayLike<number>,
    private readonly tri: ArrayLike<number>,
  ) {
    const T = tri.length / 3;
    this.order = Int32Array.from({ length: T }, (_, i) => i);
    const cap = Math.max(1, 2 * T);
    this.nodeMin = new Float32Array(cap * 3);
    this.nodeMax = new Float32Array(cap * 3);
    this.nodeA = new Int32Array(cap);
    this.nodeN = new Int32Array(cap);
    this.cx = new Float32Array(T * 3);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) {
        this.cx[t * 3 + k] = (pos[tri[t * 3]! * 3 + k]! + pos[tri[t * 3 + 1]! * 3 + k]! + pos[tri[t * 3 + 2]! * 3 + k]!) / 3;
      }
    }
    this.build(0, T);
  }

  private bounds(node: number, from: number, to: number): void {
    const lo = [1e30, 1e30, 1e30];
    const hi = [-1e30, -1e30, -1e30];
    for (let i = from; i < to; i++) {
      const t = this.order[i]!;
      for (let c = 0; c < 3; c++) {
        const v = this.tri[t * 3 + c]!;
        for (let k = 0; k < 3; k++) {
          const x = this.pos[v * 3 + k]!;
          if (x < lo[k]!) lo[k] = x;
          if (x > hi[k]!) hi[k] = x;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      this.nodeMin[node * 3 + k] = lo[k]!;
      this.nodeMax[node * 3 + k] = hi[k]!;
    }
  }

  private build(from: number, to: number): number {
    const node = this.nodes++;
    this.bounds(node, from, to);
    if (to - from <= 4) {
      this.nodeA[node] = from;
      this.nodeN[node] = to - from;
      return node;
    }
    // split the longest side at the median of the centroids
    let axis = 0;
    let best = -1;
    for (let k = 0; k < 3; k++) {
      const w = this.nodeMax[node * 3 + k]! - this.nodeMin[node * 3 + k]!;
      if (w > best) {
        best = w;
        axis = k;
      }
    }
    const slice = Array.from(this.order.subarray(from, to));
    slice.sort((a, b) => this.cx[a * 3 + axis]! - this.cx[b * 3 + axis]!);
    this.order.set(slice, from);
    const mid = (from + to) >> 1;
    const left = this.build(from, mid);
    const right = this.build(mid, to);
    this.nodeA[node] = left;
    this.nodeN[node] = 0;
    void right; // (the right child follows the left subtree: it is found by the left's size, so both are kept in the arrays below)
    this.rightOf.set(node, right);
    return node;
  }

  private readonly rightOf = new Map<number, number>();

  /** The distance along the ray to the nearest surface closer than `max`, or Infinity. */
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    let nearest = max;
    const stack: number[] = [0];
    const ix = 1 / (dx || 1e-12);
    const iy = 1 / (dy || 1e-12);
    const iz = 1 / (dz || 1e-12);
    while (stack.length) {
      const n = stack.pop()!;
      // slab test
      let t0 = 0;
      let t1 = nearest;
      const o = [ox, oy, oz] as const;
      const inv = [ix, iy, iz] as const;
      let miss = false;
      for (let k = 0; k < 3; k++) {
        let a = (this.nodeMin[n * 3 + k]! - o[k]) * inv[k];
        let b = (this.nodeMax[n * 3 + k]! - o[k]) * inv[k];
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) {
          miss = true;
          break;
        }
      }
      if (miss) continue;
      const count = this.nodeN[n]!;
      if (count === 0) {
        stack.push(this.nodeA[n]!, this.rightOf.get(n)!);
        continue;
      }
      for (let i = 0; i < count; i++) {
        const t = this.order[this.nodeA[n]! + i]!;
        const d = this.triangle(t, ox, oy, oz, dx, dy, dz);
        if (d < nearest) nearest = d;
      }
    }
    return nearest < max ? nearest : Infinity;
  }

  /** Möller-Trumbore, both sides. */
  private triangle(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const a = this.tri[t * 3]! * 3;
    const b = this.tri[t * 3 + 1]! * 3;
    const c = this.tri[t * 3 + 2]! * 3;
    const p = this.pos;
    const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
    const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return Infinity;
    const inv = 1 / det;
    const tx = ox - p[a]!, ty = oy - p[a + 1]!, tz = oz - p[a + 2]!;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return Infinity;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return d > 1e-6 ? d : Infinity;
  }
}

/** A tiny deterministic random number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How open to the room each vertex is, 0 (shut in) to 1 (open): cosine-weighted rays from just off the surface, along the normal's side, that count against
 * what they meet within `reach` (a nearer hit counts more).
 */
export function openness(pos: ArrayLike<number>, nor: ArrayLike<number>, tri: ArrayLike<number>, reach: number, rays = 32, lift = 0.004): Float32Array {
  const bvh = new Bvh(pos, tri);
  const n = pos.length / 3;
  const out = new Float32Array(n);
  const rand = rng(7);
  for (let v = 0; v < n; v++) {
    let nx = nor[v * 3]!, ny = nor[v * 3 + 1]!, nz = nor[v * 3 + 2]!;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // a frame around the normal
    const ax = Math.abs(nx) < 0.9 ? 1 : 0;
    const ay = ax ? 0 : 1;
    let tx = ay * nz, ty = -ax * nz, tz = ax * ny - ay * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = pos[v * 3]! + nx * lift, oy = pos[v * 3 + 1]! + ny * lift, oz = pos[v * 3 + 2]! + nz * lift;
    let shut = 0;
    for (let i = 0; i < rays; i++) {
      const u1 = (i + rand()) / rays;
      const u2 = rand();
      const r = Math.sqrt(u1);
      const ph = 2 * Math.PI * u2;
      const cx = r * Math.cos(ph), cy = r * Math.sin(ph), cz = Math.sqrt(Math.max(0, 1 - u1));
      const dx = tx * cx + bx * cy + nx * cz, dy = ty * cx + by * cy + ny * cz, dz = tz * cx + bz * cy + nz * cz;
      const d = bvh.hit(ox, oy, oz, dx, dy, dz, reach);
      if (d < Infinity) shut += 1 - 0.5 * (d / reach);
    }
    out[v] = 1 - shut / rays;
  }
  return out;
}
