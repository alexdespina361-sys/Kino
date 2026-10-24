// Planting the paws of a gait. A donor's feet are keyed by hand against its own ground, and they slide: the fore paws of the fox's walk go back at four tenths of a body length a
// second while it is down, its hind paws at six tenths, and a cat that is carried over the floor at one speed (the player moves it as far as the clip says it should go) skates on
// whichever is not that speed. A paw that is down must stay where it landed, so here the paws' targets (feet.mts) are made to: each paw's stance (the run of frames it is low in)
// is told to go back at one speed, the same for every paw, along a line through where the donor had it on average; the frames of the swing are the donor's, with the two ends of the
// stance's correction faded across them. Only the places along the cat and across it are changed, never the height: the floor is the next stage's (floor.mts).

export interface Stance {
  /** The first frame of the run, and how many frames it has (it may go round the end of a loop). */
  from: number;
  length: number;
}

/**
 * The frames a paw is down in: the longest run (round the loop) of frames in which it is low against its own range. A paw that hardly leaves the floor has none (null).
 * `share` is how much of the way up from its lowest to its highest a paw may be and still count as down.
 */
export function stanceOf(height: ArrayLike<number>, share = 0.4, least = 0.012): Stance | null {
  const n = height.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let f = 0; f < n; f++) {
    lo = Math.min(lo, height[f]!);
    hi = Math.max(hi, height[f]!);
  }
  if (hi - lo < least) return null;
  const limit = lo + share * (hi - lo);
  const low = (f: number): boolean => height[((f % n) + n) % n]! <= limit;
  let best: Stance | null = null;
  // (a run starts at a low frame whose frame before it, round the loop, is high)
  for (let a = 0; a < n; a++) {
    if (!low(a) || low(a - 1)) continue;
    let length = 1;
    while (length < n && low(a + length)) length++;
    if (length < n && (!best || length > best.length)) best = { from: a, length };
  }
  return best;
}

/** How fast a paw goes back against the body while it is down, in body lengths a second (a straight line through its places in the stance). */
export function sweepSpeed(x: ArrayLike<number>, stance: Stance, fps: number): number {
  const n = x.length;
  const { from, length } = stance;
  if (length < 2) return 0;
  let sj = 0;
  let sx = 0;
  let sjj = 0;
  let sjx = 0;
  for (let j = 0; j < length; j++) {
    const v = x[(from + j) % n]!;
    sj += j;
    sx += v;
    sjj += j * j;
    sjx += j * v;
  }
  const slope = (length * sjx - sj * sx) / (length * sjj - sj * sj);
  return -slope * fps;
}

/**
 * What to add to a paw's targets (along the cat, none up, across the cat; three numbers a frame) for the paw to stay put in the world while it is down, with the cat carried
 * forward at `speed` body lengths a second: its places in the stance are put on a line that goes back at that speed through their middle, and the swing is faded from the
 * correction at the stance's end to the one at the start of the next.
 */
export function plant(x: ArrayLike<number>, z: ArrayLike<number>, stance: Stance, speed: number, fps: number): Float64Array {
  const n = x.length;
  const { from, length } = stance;
  const out = new Float64Array(n * 3);
  let sx = 0;
  let sz = 0;
  for (let j = 0; j < length; j++) {
    sx += x[(from + j) % n]!;
    sz += z[(from + j) % n]!;
  }
  const xc = sx / length;
  const zc = sz / length;
  const jc = (length - 1) / 2;
  const first = [0, 0];
  const last = [0, 0];
  for (let j = 0; j < length; j++) {
    const f = (from + j) % n;
    const dx = xc - (speed / fps) * (j - jc) - x[f]!;
    const dz = zc - z[f]!;
    out[f * 3] = dx;
    out[f * 3 + 2] = dz;
    if (j === 0) {
      first[0] = dx;
      first[1] = dz;
    }
    if (j === length - 1) {
      last[0] = dx;
      last[1] = dz;
    }
  }
  const swing = n - length;
  for (let s = 1; s <= swing; s++) {
    const u = s / (swing + 1);
    const w = u * u * (3 - 2 * u);
    const f = (from + length - 1 + s) % n;
    out[f * 3] = last[0]! + (first[0]! - last[0]!) * w;
    out[f * 3 + 2] = last[1]! + (first[1]! - last[1]!) * w;
  }
  return out;
}
