// Cleans the skin of the cat and hands the body over along its spine and neck (build-meshy.mts calls this).
//
// What the model's own skin does, as its maker's program made it: a bone's weight reaches a long way from the bone (the front leg's forearm has a share in fur half a body
// length away, the hips in the back of the neck, the muzzle in the chest's fur under the chin), and the hand-over from the hips to the chest and from the chest to the head is
// done in one short stretch each. Whatever the pose, the picture is then a body whose parts drag at one another. Here:
//   1. a limb's or the tail's weight is cut off with the distance from the bone (a share beyond what the bone can reach goes to the body, along its chain),
//   2. what the hips, the chest and the head hold of a point (and what was cut off) is handed out again along the chain the hips, the spine, the chest, the neck and the head make,
//      by how far along it the point lies: it follows the bone it is nearest, and between two of them a share of each,
//   3. how far along the chain a point is, and how much of it is the chain's, are smoothed over the points that are near it in space first, so that two tufts side by side
//      follow the same bones (the line through the joints is not the shape of the body: the point nearest to it jumps from one stretch to another),
//   4. the weights are smoothed the same way once more, and two points side by side (or at the two ends of a strand of fur) are held to weights that differ by no more than
//      `RATE` for every body length between them: the bones of a neck that is turned move two points apart by about that much for a share of one, so a steeper hand-over tears the
//      strand; then the small weights are taken away (a bone that holds a twentieth of a point is not worth a seam) and each point keeps its four strongest.
// The fur is more than a thousand separate small pieces that share no edge with one another, so "near" is told in space, not along the mesh: weights that differ between two tufts
// side by side tear the fur apart as soon as the bones turn. A point that is mostly the head's keeps what the model gave it. The rest pose is the same whatever the weights are:
// this changes how the cat bends.
type Floats = ArrayLike<number>;

export interface Segment {
  bone: number;
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  /** How far from the segment the bone's weight may reach in full; it is gone at 1.6 times that. */
  radius: number;
}

export interface ReskinInput {
  count: number;
  pos: Floats;
  /** The mesh's triangles, three vertex numbers each. */
  index: ArrayLike<number>;
  bones: number;
  /** Each vertex's weight on each bone, `bones` numbers a vertex; rewritten. */
  dense: Float64Array;
  /** The joints of the chain, the hips first and the head last, as bone numbers and as places. */
  chain: readonly number[];
  chainAt: ReadonlyArray<readonly [number, number, number]>;
  limbs: readonly Segment[];
  /** The bone the model's maker gave a share of what is the neck's (the muzzle's). */
  muzzle: number;
  /** The bones that are the head's own (the head, the muzzle, the ears, the jaw): a point that is mostly them is the head's and is left alone. */
  headSet: readonly number[];
  /** How much the weights of two points may differ for each body length between them (default `RATE`). */
  rate?: number;
  /** Whether the points of limbs and the tail are held to the rate too (the body's are always). */
  limbsHeld?: boolean;
}

export interface ReskinReport {
  /** Points whose weights were changed. */
  changed: number;
  /** Weight cut off from limbs and the tail, and given to the body, summed over the points. */
  cut: number;
  /** The biggest difference, between two points a hand's breadth apart (a hundredth of the cat) of how far along the chain they are, before and after the smoothing. */
  jumpBefore: number;
  jumpAfter: number;
  /** The biggest difference between the weights of two held points over what it may be at `RATE` (1: right at it), before and after they were pulled together. */
  strainBefore: number;
  strainAfter: number;
  /** The most weight any point lost to keeping only its four strongest bones. */
  lost: number;
}

/** How far apart two points may be to be smoothed together, and to count as side by side. */
const REACH = 0.03;
const CLOSE = 0.012;
/** The weights under this (after the smoothing) are taken away: a seam is no better than nothing. */
const FLOOR = 0.03;
/** How much the weights of two points may differ (half the sum of what each bone's weight differs by) for each body length between them. */
const RATE = 8;
/** Points nearer than this are held as if they were this far apart (the hairs of one tuft: their ratio is rounding). */
const LEAST = 0.004;

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function distanceToSegment(p: Floats, v: number, a: readonly number[], b: readonly number[]): number {
  const abx = b[0]! - a[0]!;
  const aby = b[1]! - a[1]!;
  const abz = b[2]! - a[2]!;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const px = p[v * 3]! - a[0]!;
  const py = p[v * 3 + 1]! - a[1]!;
  const pz = p[v * 3 + 2]! - a[2]!;
  const t = Math.min(1, Math.max(0, (px * abx + py * aby + pz * abz) / l2));
  return Math.hypot(px - abx * t, py - aby * t, pz - abz * t);
}

/** How far along the chain a point is, in joints (0 at the first, `chainAt.length - 1` at the last): the nearest point of the line through the joints. */
export function chainCoordinate(chainAt: ReadonlyArray<readonly [number, number, number]>, x: number, y: number, z: number): number {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < chainAt.length; i++) {
    const a = chainAt[i]!;
    const b = chainAt[i + 1]!;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * ab[0]! + (y - a[1]) * ab[1]! + (z - a[2]) * ab[2]!) / l2));
    const d = Math.hypot(x - (a[0] + ab[0]! * t), y - (a[1] + ab[1]! * t), z - (a[2] + ab[2]! * t));
    if (d < best) {
      best = d;
      at = i + t;
    }
  }
  return at;
}

/** The points near each point in space: `start[v]..start[v + 1]` index `list` (not the point itself) and `weight`, the share each has in an average (a bell: 0.14 at `reach`). */
export interface Near {
  start: Uint32Array;
  list: Uint32Array;
  weight: Float32Array;
}

/** The share the other end of an edge has in an average, however long the edge is: a strand of fur is one piece and its two ends hold together. */
const JOINED = 0.6;

/** `index`: the mesh's triangles; when they are given, the points an edge joins are near each other too, whatever the distance (a long strand is not torn between its ends). */
export function nearby(pos: Floats, count: number, reach: number, index?: ArrayLike<number>): Near {
  const cell = (x: number): number => Math.floor(x / reach) + 512;
  const key = (i: number, j: number, k: number): number => (i * 2048 + j) * 2048 + k;
  const grid = new Map<number, number[]>();
  for (let v = 0; v < count; v++) {
    const id = key(cell(pos[v * 3]!), cell(pos[v * 3 + 1]!), cell(pos[v * 3 + 2]!));
    const list = grid.get(id);
    if (list) list.push(v);
    else grid.set(id, [v]);
  }
  const joined = Array.from({ length: count }, () => new Set<number>());
  if (index) {
    for (let t = 0; t + 2 < index.length; t += 3) {
      for (let c = 0; c < 3; c++) {
        const a = index[t + c]!;
        const b = index[t + ((c + 1) % 3)]!;
        joined[a]!.add(b);
        joined[b]!.add(a);
      }
    }
  }
  const start = new Uint32Array(count + 1);
  const list: number[] = [];
  const weight: number[] = [];
  const r2 = reach * reach;
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    const bell = (u: number): number => Math.exp((-2 * ((pos[u * 3]! - x) ** 2 + (pos[u * 3 + 1]! - y) ** 2 + (pos[u * 3 + 2]! - z) ** 2)) / r2);
    for (const u of joined[v]!) {
      if (u === v) continue;
      list.push(u);
      weight.push(Math.max(JOINED, bell(u)));
    }
    const i0 = cell(x);
    const j0 = cell(y);
    const k0 = cell(z);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          const here = grid.get(key(i, j, k));
          if (!here) continue;
          for (const u of here) {
            if (u === v || joined[v]!.has(u)) continue;
            const d2 = (pos[u * 3]! - x) ** 2 + (pos[u * 3 + 1]! - y) ** 2 + (pos[u * 3 + 2]! - z) ** 2;
            if (d2 > r2) continue;
            list.push(u);
            weight.push(Math.exp((-2 * d2) / r2));
          }
        }
      }
    }
    start[v + 1] = list.length;
  }
  return { start, list: Uint32Array.from(list), weight: Float32Array.from(weight) };
}

/** Smooths `dim` numbers a point over the points near it, `steps` times (each takes a bell-weighted mean of its own and its neighbours'); the points `pinned` hold what they have. */
export function blur(values: Float64Array, dim: number, net: Near, steps: number, pinned: (v: number) => boolean): void {
  const n = values.length / dim;
  const next = new Float64Array(values.length);
  for (let k = 0; k < steps; k++) {
    for (let v = 0; v < n; v++) {
      const o = v * dim;
      if (pinned(v)) {
        for (let d = 0; d < dim; d++) next[o + d] = values[o + d]!;
        continue;
      }
      let total = 1;
      for (let d = 0; d < dim; d++) next[o + d] = values[o + d]!;
      for (let i = net.start[v]!; i < net.start[v + 1]!; i++) {
        const u = net.list[i]! * dim;
        const w = net.weight[i]!;
        total += w;
        for (let d = 0; d < dim; d++) next[o + d]! += w * values[u + d]!;
      }
      for (let d = 0; d < dim; d++) next[o + d]! /= total;
    }
    values.set(next);
  }
}

/** Pairs of points whose weights are held to `RATE`: the points of each, and how far apart they are. */
interface Held {
  a: Uint32Array;
  b: Uint32Array;
  length: Float64Array;
}

function held(pos: Floats, net: Near, count: number, bendable: (v: number) => boolean, stiff: (v: number) => boolean): Held {
  const a: number[] = [];
  const b: number[] = [];
  const length: number[] = [];
  for (let v = 0; v < count; v++) {
    if (!bendable(v) && !stiff(v)) continue;
    for (let i = net.start[v]!; i < net.start[v + 1]!; i++) {
      const u = net.list[i]!;
      if (u <= v) continue;
      // (a pair is held when one of them gives and the other gives or is the head's own, which is not moved)
      if (!((bendable(v) && (bendable(u) || stiff(u))) || (stiff(v) && bendable(u)))) continue;
      a.push(v);
      b.push(u);
      length.push(Math.max(LEAST, Math.hypot(pos[v * 3]! - pos[u * 3]!, pos[v * 3 + 1]! - pos[u * 3 + 1]!, pos[v * 3 + 2]! - pos[u * 3 + 2]!)));
    }
  }
  return { a: Uint32Array.from(a), b: Uint32Array.from(b), length: Float64Array.from(length) };
}

/**
 * Takes the difference of the weights of each held pair that is over the rate out (half from each, all from the one that gives when the other is the head's own); `steps` times.
 * Returns the worst pair's difference over what it may be, at the first pass and at the last (1 or less: all within the rate).
 */
function relax(dense: Float64Array, bones: number, h: Held, bendable: (v: number) => boolean, steps: number, rate: number): [number, number] {
  const delta = new Float64Array(dense.length);
  const hits = new Uint16Array(dense.length / bones);
  let worst = 0;
  let first = 0;
  for (let k = 0; k < steps; k++) {
    delta.fill(0);
    hits.fill(0);
    worst = 0;
    for (let i = 0; i < h.a.length; i++) {
      const a = h.a[i]!;
      const b = h.b[i]!;
      let tv = 0;
      for (let d = 0; d < bones; d++) tv += Math.abs(dense[a * bones + d]! - dense[b * bones + d]!);
      tv *= 0.5;
      const cap = rate * h.length[i]!;
      worst = Math.max(worst, tv / cap);
      if (tv <= cap) continue;
      const takes = 1 - cap / tv;
      const giveA = bendable(a);
      const giveB = bendable(b);
      const share = giveA && giveB ? 0.5 : 1;
      for (let d = 0; d < bones; d++) {
        const diff = dense[a * bones + d]! - dense[b * bones + d]!;
        if (giveA) delta[a * bones + d]! -= share * takes * diff;
        if (giveB) delta[b * bones + d]! += share * takes * diff;
      }
      if (giveA) hits[a]!++;
      if (giveB) hits[b]!++;
    }
    if (k === 0) first = worst;
    for (let v = 0; v < hits.length; v++) {
      if (hits[v] === 0) continue;
      for (let d = 0; d < bones; d++) dense[v * bones + d]! += delta[v * bones + d]! / hits[v]!;
    }
  }
  return [first, worst];
}

export function reskin(o: ReskinInput): ReskinReport {
  const { count, bones, dense, chain, chainAt } = o;
  const last = chain.length - 1;
  const net = nearby(o.pos, count, REACH, o.index);
  const w = (v: number, b: number): number => dense[v * bones + b]!;

  // 1. cut a limb's and the tail's weight off with the distance from the bone; what is cut goes to the body
  const cutOff = new Float64Array(count);
  let cut = 0;
  for (const seg of o.limbs) {
    for (let v = 0; v < count; v++) {
      const have = w(v, seg.bone);
      if (have <= 0) continue;
      const d = distanceToSegment(o.pos, v, seg.from, seg.to);
      const keep = 1 - sstep(seg.radius, 1.6 * seg.radius, d);
      if (keep >= 1) continue;
      dense[v * bones + seg.bone] = have * keep;
      cutOff[v]! += have * (1 - keep);
      cut += have * (1 - keep);
    }
  }
  const limbShare = new Float64Array(count);
  const headShare = new Float64Array(count);
  const limbBones = Array.from(new Set(o.limbs.map((l) => l.bone)));
  for (let v = 0; v < count; v++) {
    let l = 0;
    for (const b of limbBones) l += w(v, b);
    limbShare[v] = l;
    let h = 0;
    for (const b of o.headSet) h += w(v, b);
    headShare[v] = h;
  }
  const isHead = (v: number): boolean => headShare[v]! > 0.5;

  // 2. how far along the chain each point is, and how much of it the chain's (as against a limb's, the tail's or the head's)
  const s = new Float64Array(count);
  const nu = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    s[v] = chainCoordinate(chainAt, o.pos[v * 3]!, o.pos[v * 3 + 1]!, o.pos[v * 3 + 2]!);
    nu[v] = (1 - sstep(0, 0.4, limbShare[v]!)) * (1 - sstep(0.5, 0.9, headShare[v]!));
    // (the head's own points are at the head's end of the chain, whichever way the line through the joints happens to run past them)
    if (isHead(v)) s[v] = last;
  }
  const jump = (): number => {
    let worst = 0;
    for (let v = 0; v < count; v++) {
      if (nu[v]! < 0.05) continue;
      for (let i = net.start[v]!; i < net.start[v + 1]!; i++) {
        const u = net.list[i]!;
        if (nu[u]! < 0.05) continue;
        const d = Math.hypot(o.pos[v * 3]! - o.pos[u * 3]!, o.pos[v * 3 + 1]! - o.pos[u * 3 + 1]!, o.pos[v * 3 + 2]! - o.pos[u * 3 + 2]!);
        if (d <= CLOSE) worst = Math.max(worst, Math.abs(s[v]! - s[u]!));
      }
    }
    return worst;
  };
  const jumpBefore = jump();
  // (the points that are the head's or a limb's are not moved by the smoothing, but are what the points next to them are smoothed towards)
  blur(s, 1, net, 8, isHead);
  blur(nu, 1, net, 3, (v) => nu[v]! < 1e-3);
  const jumpAfter = jump();

  // 3. hand out what the chain holds of each point along the chain
  let changed = 0;
  for (let v = 0; v < count; v++) {
    const k = nu[v]!;
    if (k < 1e-3 && cutOff[v]! <= 0) continue;
    const moved = k * (1 - sstep(4.5, 5.5, s[v]!)) * w(v, o.muzzle);
    const pool = k * (w(v, chain[0]!) + w(v, chain[3]!) + w(v, chain[last]!)) + moved + cutOff[v]!;
    if (pool < 1e-9) continue;
    // (what was cut off a limb is the body's whatever the point is: a point that is the head's gives it to the head)
    const where = Math.min(last, Math.max(0, isHead(v) ? last : s[v]!));
    for (const b of [chain[0]!, chain[3]!, chain[last]!]) dense[v * bones + b] = w(v, b) * (1 - k);
    dense[v * bones + o.muzzle] = w(v, o.muzzle) - moved;
    const i = Math.min(last - 1, Math.floor(where));
    const f = where - i;
    dense[v * bones + chain[i]!] = w(v, chain[i]!) + pool * (1 - f);
    dense[v * bones + chain[i + 1]!] = w(v, chain[i + 1]!) + pool * f;
    changed++;
  }

  // 4. the weights themselves, smoothed over the points near and held to the rate, the small ones taken away, and the four strongest kept (twice, so that what the keeping drops is
  // smoothed too). The head's own points (nearly all head) are not moved: the points next to them are held to them.
  const stiff = (v: number): boolean => headShare[v]! >= 0.9;
  const bendable = (v: number): boolean => (o.limbsHeld || limbShare[v]! < 0.45) && headShare[v]! < 0.9;
  const pairs = held(o.pos, net, count, bendable, stiff);
  let lost = 0;
  let strainBefore = 0;
  let strainAfter = 0;
  const order = new Int32Array(bones);
  for (let round = 0; round < 2; round++) {
    blur(dense, bones, net, round === 0 ? 2 : 1, isHead);
    const [first, final] = relax(dense, bones, pairs, bendable, round === 0 ? 60 : 20, o.rate ?? RATE);
    if (round === 0) strainBefore = first;
    strainAfter = final;
    for (let v = 0; v < count; v++) {
      const at = v * bones;
      let sum = 0;
      for (let b = 0; b < bones; b++) {
        const x = Math.max(0, dense[at + b]! - FLOOR);
        dense[at + b] = x;
        sum += x;
      }
      if (sum <= 1e-9) continue;
      for (let b = 0; b < bones; b++) order[b] = b;
      order.sort((a, b) => dense[at + b]! - dense[at + a]!);
      let kept = 0;
      for (let k = 0; k < 4; k++) kept += dense[at + order[k]!]!;
      if (round === 1) lost = Math.max(lost, (sum - kept) / sum);
      for (let k = 4; k < bones; k++) dense[at + order[k]!] = 0;
      for (let b = 0; b < bones; b++) dense[at + b]! /= kept || 1;
    }
  }
  return { changed, cut, jumpBefore, jumpAfter, strainBefore, strainAfter, lost };
}
