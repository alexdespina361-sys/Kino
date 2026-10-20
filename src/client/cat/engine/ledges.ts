import { clamp } from "../math";
import type { Rect, Surface, World } from "../types";

/**
 * Where the cat can actually stand. The page offers surfaces (the line along the tops of a row of posters, the bottom of the screen); a ledge is
 * a stretch of one of them where the cat's whole body would fit: on the screen, and clear of everything the cat must keep out of (text the
 * viewer is reading, buttons, the card that has the focus, the subtitles). Pure geometry, no page: a hundred worlds can be tried in a test.
 */

export interface Ledge {
  /** `<surface id>#<n>`: a surface the keep-out zones cut in pieces has one ledge per piece. */
  id: string;
  surfaceId: string;
  kind: Surface["kind"];
  y: number;
  /** The cat's middle may be anywhere from `x0` to `x1`. */
  x0: number;
  x1: number;
  weight: number;
}

/** How much room the cat's body takes, as a part of its body length: half its width, and how tall it is sitting up with its head raised. */
export const HALF_WIDTH = 0.58;
export const HEIGHT = 1.02;
/** A ledge shorter than this (in body lengths) is not worth standing on. */
export const MIN_LEDGE = 0.45;
/** How far feet may sink into a zone before it counts as standing in it (pixels). */
const FOOT_SLACK = 3;

type Interval = [number, number];

function subtract(intervals: Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of intervals) {
    if (to <= a || from >= b) out.push([a, b]);
    else {
      if (from > a) out.push([a, from]);
      if (to < b) out.push([to, b]);
    }
  }
  return out;
}

/** Whether the cat standing with its middle at `x` on a line at `y` would overlap the rectangle. */
export function boxHits(x: number, y: number, bodyLength: number, rect: Rect): boolean {
  const halfW = HALF_WIDTH * bodyLength;
  const top = y - HEIGHT * bodyLength;
  return x + halfW > rect.x && x - halfW < rect.x + rect.w && y + FOOT_SLACK > rect.y && top < rect.y + rect.h;
}

export function computeLedges(world: World): Ledge[] {
  const L = world.bodyLength;
  const halfW = HALF_WIDTH * L;
  const height = HEIGHT * L;
  const vp = world.viewport;
  const out: Ledge[] = [];
  for (const surface of world.surfaces) {
    // the feet must be on the screen, with room above them for most of the cat
    if (!(surface.y >= vp.y + height * 0.55) || !(surface.y <= vp.y + vp.h)) continue;
    const left = Math.max(surface.x0, vp.x) + halfW * 0.5;
    const right = Math.min(surface.x1, vp.x + vp.w) - halfW * 0.5;
    if (!(right > left)) continue;
    let intervals: Interval[] = [[left, right]];
    for (const zone of world.keepOut) {
      if (zone.y > surface.y + FOOT_SLACK || zone.y + zone.h < surface.y - height) continue;
      intervals = subtract(intervals, zone.x - halfW, zone.x + zone.w + halfW);
      if (intervals.length === 0) break;
    }
    let n = 0;
    for (const [a, b] of intervals) {
      if (b - a < MIN_LEDGE * L) continue;
      out.push({ id: `${surface.id}#${n++}`, surfaceId: surface.id, kind: surface.kind, y: surface.y, x0: a, x1: b, weight: surface.weight });
    }
  }
  return out;
}

/* ------------------------------ settling ------------------------------ */

/** What a cat settled in a posture takes of the screen: half its width and how tall it is, in body lengths (lying down it is low, and the words above it can still be read). */
export const POSE_BOX = { stand: [HALF_WIDTH, HEIGHT], sit: [0.36, 0.72], loaf: [0.5, 0.46], curl: [0.42, 0.4] } as const;
export type RestPose = keyof typeof POSE_BOX;

/** How much of the words, in square pixels, a cat settled in `pose` with its middle at `x` on the line `y` would cover. */
export function covered(x: number, y: number, bodyLength: number, pose: RestPose, soft: readonly Rect[]): number {
  const [half, tall] = POSE_BOX[pose];
  const left = x - half * bodyLength;
  const right = x + half * bodyLength;
  const top = y - tall * bodyLength;
  let area = 0;
  for (const word of soft) {
    const across = Math.min(right, word.x + word.w) - Math.max(left, word.x);
    const down = Math.min(y, word.y + word.h) - Math.max(top, word.y);
    if (across > 0 && down > 0) area += across * down;
  }
  return area;
}

/**
 * Where on `ledge` to settle for a while, when where the cat is would cover words: the spot within `reach` body lengths that covers the least (and of
 * those the nearest), if it covers at most half of what here does and is worth a walk. Undefined when where it is will do, or nothing is better.
 */
export function restSpot(ledge: Ledge, from: number, bodyLength: number, pose: RestPose, soft: readonly Rect[] | undefined, reach = 3.5): number | undefined {
  if (!soft || soft.length === 0) return undefined;
  const unit = bodyLength * bodyLength;
  const here = covered(from, ledge.y, bodyLength, pose, soft);
  // (the edge of a letter under a paw is not covering it)
  if (here < 0.02 * unit) return undefined;
  let best: number | undefined;
  let bestArea = Infinity;
  let bestAway = Infinity;
  for (let x = Math.max(ledge.x0, from - reach * bodyLength); x <= Math.min(ledge.x1, from + reach * bodyLength); x += 0.12 * bodyLength) {
    const area = covered(x, ledge.y, bodyLength, pose, soft);
    const away = Math.abs(x - from);
    if (away < 0.25 * bodyLength || area > here * 0.5) continue;
    if (area < bestArea - 0.01 * unit || (area <= bestArea + 0.01 * unit && away < bestAway)) {
      best = x;
      bestArea = area;
      bestAway = away;
    }
  }
  return best;
}

/** The ledge of this surface that has `x`, or the nearest piece of it. */
export function ledgeAt(ledges: readonly Ledge[], surfaceId: string, x: number): Ledge | undefined {
  let best: Ledge | undefined;
  let bestGap = Infinity;
  for (const ledge of ledges) {
    if (ledge.surfaceId !== surfaceId) continue;
    const gap = x < ledge.x0 ? ledge.x0 - x : x > ledge.x1 ? x - ledge.x1 : 0;
    if (gap < bestGap) {
      best = ledge;
      bestGap = gap;
    }
  }
  return best;
}

export const clampToLedge = (ledge: Ledge, x: number): number => clamp(x, ledge.x0, ledge.x1);

/* ------------------------------ jumping ------------------------------ */

/** Gravity in body lengths per second squared: a little floaty, as a cat in a cartoon is. */
export const GRAVITY = 24;
/** The highest the cat jumps up, the furthest it drops, and how far it leaps across, in body lengths. */
export const MAX_UP = 4.1;
export const MAX_DOWN = 5.5;
export const MAX_ACROSS = 3.4;
/** How far over the higher of the two places the cat's feet go. */
const CLEARANCE = 0.5;

export interface JumpPlan {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  apexY: number;
  /** Seconds up to the top of the arc, and from there down to the landing. */
  up: number;
  down: number;
  flight: number;
}

/** The top of the arc after the two ends have moved (the page scrolled while the cat was in the air). */
export function reshape(plan: JumpPlan, bodyLength: number): void {
  plan.apexY = Math.min(plan.fromY, plan.toY) - CLEARANCE * bodyLength;
}

/** The arc from one place to another (feet to feet), or null when it is more than the cat can do. */
export function planJump(fromX: number, fromY: number, toX: number, toY: number, bodyLength: number): JumpPlan | null {
  const L = bodyLength;
  const rise = fromY - toY; // positive: going up
  const across = Math.abs(toX - fromX);
  if (rise > MAX_UP * L || -rise > MAX_DOWN * L || across > MAX_ACROSS * L) return null;
  const apexY = Math.min(fromY, toY) - CLEARANCE * L;
  const g = GRAVITY * L;
  const up = Math.sqrt((2 * (fromY - apexY)) / g);
  const down = Math.sqrt((2 * (toY - apexY)) / g);
  return { fromX, fromY, toX, toY, apexY, up, down, flight: up + down };
}

/** Where the cat is `t` seconds into the flight of a plan. */
export function jumpAt(plan: JumpPlan, t: number): { x: number; y: number; vx: number; vy: number } {
  const T = plan.flight || 1e-6;
  const c = clamp(t, 0, T);
  const x = plan.fromX + ((plan.toX - plan.fromX) * c) / T;
  const vx = (plan.toX - plan.fromX) / T;
  if (c <= plan.up) {
    const f = c / (plan.up || 1e-6);
    // y falls from fromY to apexY with the speed dropping to nothing at the top
    const y = plan.fromY + (plan.apexY - plan.fromY) * (1 - (1 - f) * (1 - f));
    const vy = (2 * (plan.apexY - plan.fromY) * (1 - f)) / (plan.up || 1e-6);
    return { x, y, vx, vy };
  }
  const f = (c - plan.up) / (plan.down || 1e-6);
  const y = plan.apexY + (plan.toY - plan.apexY) * f * f;
  const vy = (2 * (plan.toY - plan.apexY) * f) / (plan.down || 1e-6);
  return { x, y, vx, vy };
}

export interface FlightStep {
  /** 0..1 on the way up to the top of the arc, 1..2 on the way down. */
  phase: number;
  /** How much of the leap (in time) is done, 0..1: what the clip's pose follows. */
  s: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  done: boolean;
}

/**
 * Moves the cat on along the arc by `dt`. The two ends of the arc may have moved since the leap began (the page scrolls under it), so the times
 * up and down are worked out afresh from the heights as they are now and the cat is moved on by a part of each: the speed is always the one
 * gravity gives for the height it is rising or falling through, whatever the page does, and nothing lurches.
 */
export function stepFlight(plan: JumpPlan, phase: number, dt: number, bodyLength: number): FlightStep {
  const g = GRAVITY * bodyLength;
  const rise = Math.max(plan.fromY - plan.apexY, 1);
  const drop = Math.max(plan.toY - plan.apexY, 1);
  const up = Math.sqrt((2 * rise) / g);
  const down = Math.sqrt((2 * drop) / g);
  let p = clamp(phase, 0, 2);
  let left = Math.max(0, dt);
  if (p < 1) {
    const need = (1 - p) * up;
    if (left < need) {
      p += left / up;
      left = 0;
    } else {
      left -= need;
      p = 1;
    }
  }
  if (left > 0) p = Math.min(2, p + left / down);
  const total = up + down;
  const s = p <= 1 ? (p * up) / total : (up + (p - 1) * down) / total;
  const x = plan.fromX + (plan.toX - plan.fromX) * s;
  const vx = (plan.toX - plan.fromX) / total;
  if (p <= 1) {
    const y = plan.fromY + (plan.apexY - plan.fromY) * (1 - (1 - p) * (1 - p));
    return { phase: p, s, x, y, vx, vy: (2 * (plan.apexY - plan.fromY) * (1 - p)) / up, done: false };
  }
  const f = p - 1;
  return { phase: p, s, x, y: plan.apexY + (plan.toY - plan.apexY) * f * f, vx, vy: (2 * (plan.toY - plan.apexY) * f) / down, done: p >= 2 };
}

/**
 * Ledges the cat can get to from where it stands, by walking along the ledge it is on to the best take-off place and jumping. Breadth first, a
 * few jumps deep: `path` is the list of (ledge, where to land on it) to go through, nearest first.
 */
export interface Hop {
  ledge: Ledge;
  /** Where on the ledge before it the cat takes off. */
  takeoffX: number;
  /** Where on this ledge it lands. */
  landX: number;
}

/**
 * The take-off and landing places of a leap between two ledges. The cat lands where it is wanted if it can get there from the nearest place
 * on its own ledge; if that is too far, it lands as near as it can to where it stands now (and walks the rest of the way).
 */
export function leapBetween(from: Ledge, fromX: number, to: Ledge, wantX: number, bodyLength: number): { takeoffX: number; landX: number } | null {
  for (const landX of [clamp(wantX, to.x0, to.x1), clamp(fromX, to.x0, to.x1)]) {
    // take off from the place on the first ledge nearest the landing, then see whether that is a leap the cat can make
    const takeoffX = clamp(landX, from.x0, from.x1);
    if (planJump(takeoffX, from.y, landX, to.y, bodyLength)) return { takeoffX, landX };
  }
  return null;
}

export function findPath(ledges: readonly Ledge[], from: Ledge, fromX: number, goal: Ledge, goalX: number, bodyLength: number, maxHops = 3): Hop[] | null {
  if (from.id === goal.id) return [];
  interface Node {
    ledge: Ledge;
    x: number;
    hops: Hop[];
  }
  const seen = new Set<string>([from.id]);
  let frontier: Node[] = [{ ledge: from, x: fromX, hops: [] }];
  for (let depth = 0; depth < maxHops; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const ledge of ledges) {
        if (seen.has(ledge.id)) continue;
        const want = ledge.id === goal.id ? goalX : node.x;
        const leap = leapBetween(node.ledge, node.x, ledge, want, bodyLength);
        if (!leap) continue;
        const hops = [...node.hops, { ledge, takeoffX: leap.takeoffX, landX: leap.landX }];
        if (ledge.id === goal.id) return hops;
        seen.add(ledge.id);
        next.push({ ledge, x: leap.landX, hops });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}
