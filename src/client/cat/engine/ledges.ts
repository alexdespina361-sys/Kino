import { clamp } from "../math";
import { CLIMB_BACK, type Clip, type Rect, type Surface, type World } from "../types";
import { FOOT_SLACK, HALF_WIDTH, HEIGHT, shapeCovers, standingMargin } from "./shape";

/**
 * Where the cat can actually stand. The page offers surfaces (the line along the tops of a row of posters, the bottom of the screen); a ledge is
 * a stretch of one of them where the cat's whole body would fit: on the screen, and clear of everything the cat must keep out of (text the
 * viewer is reading, buttons, the card that has the focus). How much room the body takes is what the drawn cat takes (shape.ts). Pure geometry, no page:
 * a hundred worlds can be tried in a test.
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

/** A ledge shorter than this (in body lengths) is not worth standing on. */
export const MIN_LEDGE = 0.45;

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

export function computeLedges(world: World): Ledge[] {
  const L = world.bodyLength;
  const halfW = HALF_WIDTH * L;
  const height = HEIGHT * L;
  const vp = world.viewport;
  const out: Ledge[] = [];
  for (const surface of world.surfaces) {
    // the feet must be on the screen, with room above them for most of the cat
    if (!(surface.y >= vp.y + height * 0.55) || !(surface.y <= vp.y + vp.h)) continue;
    // (the middle may come a good way towards the end of a row of posters, the cat having a place to stand on the end card; the edge of the screen it does not
    // come to: all of the cat is on it)
    const left = Math.max(surface.x0 + halfW * 0.5, vp.x + halfW);
    const right = Math.min(surface.x1 - halfW * 0.5, vp.x + vp.w - halfW);
    if (!(right > left)) continue;
    let intervals: Interval[] = [[left, right]];
    for (const zone of world.keepOut) {
      if (zone.y > surface.y + FOOT_SLACK) continue;
      // (as far from it as the cat reaches at the heights the zone is at)
      const margin = standingMargin(zone, surface.y, L);
      if (margin === 0) continue;
      intervals = subtract(intervals, zone.x - margin, zone.x + zone.w + margin);
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

/** The postures a cat settles in (a clip each). */
export type RestPose = Extract<Clip, "stand" | "sit" | "loaf" | "curl" | "knead">;

/** What a cat settling somewhere is to keep clear of: the zones (and the edges of the screen) it is not to be in, and the words it would rather not cover. */
export interface Clutter {
  soft?: readonly Rect[] | undefined;
  keepOut: readonly Rect[];
  viewport: Rect;
}

/** A zone covered is this many times worse than a word covered. */
const ZONE_WEIGHT = 6;

/**
 * What a cat settled in `pose` with its middle at `x` on the line `y`, facing `facing`, would cover: words once, and zones and the edges of the screen more.
 * Given several postures (the ones it goes through on the way to a long sleep: it lies down, kneads, curls up) it is the worst of them.
 */
export function settledCost(pose: Clip | readonly Clip[], facing: 1 | -1, x: number, y: number, bodyLength: number, around: Clutter): number {
  const zones = avoided(around, bodyLength);
  const words = around.soft ?? [];
  const one = (clip: Clip): number => shapeCovers(clip, facing, x, y, bodyLength, words) + ZONE_WEIGHT * shapeCovers(clip, facing, x, y, bodyLength, zones);
  return typeof pose === "string" ? one(pose) : Math.max(0, ...pose.map(one));
}

/**
 * The two edges of the screen as zones, the part of the cat that is off the screen not being seen. `slack` (body lengths) is how much of it may be: the tip
 * of a tail a little over an edge is not worth a cat's turning round for.
 */
export const screenEdges = (viewport: Rect, bodyLength: number, slack = 0): Rect[] => {
  const wide = 6 * bodyLength;
  const gap = slack * bodyLength;
  return [
    { x: viewport.x - wide - gap, y: viewport.y - wide, w: wide, h: viewport.h + 2 * wide },
    { x: viewport.x + viewport.w + gap, y: viewport.y - wide, w: wide, h: viewport.h + 2 * wide },
  ];
};

/** What the cat keeps out of, with the edges of the screen as two more zones. */
const avoided = (around: Clutter, bodyLength: number): Rect[] => [...around.keepOut, ...screenEdges(around.viewport, bodyLength)];

/** Where to settle (a place to walk to, or none: where the cat is will do) and what that costs (see `settledCost`). */
export interface Settling {
  x: number | undefined;
  cost: number;
}

/**
 * Where on `ledge` to settle for a while, when where the cat is would cover words or a zone: the spot within `reach` body lengths where it covers the least
 * (and of those the nearest), if that is at most half of what here covers and is worth a walk. It faces the way it walked there. No spot when where it is
 * will do, or nothing is better; the cost is that of the place it settles in either way.
 */
export function settle(ledge: Ledge, from: number, facing: 1 | -1, bodyLength: number, pose: RestPose | readonly RestPose[], around: Clutter, reach = 3.5): Settling {
  const unit = bodyLength * bodyLength;
  const here = settledCost(pose, facing, from, ledge.y, bodyLength, around);
  // (the edge of a letter under a paw is not covering it)
  if (here < 0.02 * unit) return { x: undefined, cost: here };
  let best: number | undefined;
  let bestArea = Infinity;
  let bestAway = Infinity;
  for (let x = Math.max(ledge.x0, from - reach * bodyLength); x <= Math.min(ledge.x1, from + reach * bodyLength); x += 0.12 * bodyLength) {
    const away = Math.abs(x - from);
    if (away < 0.25 * bodyLength) continue;
    const area = settledCost(pose, x > from ? 1 : -1, x, ledge.y, bodyLength, around);
    if (area > here * 0.5) continue;
    if (area < bestArea - 0.01 * unit || (area <= bestArea + 0.01 * unit && away < bestAway)) {
      best = x;
      bestArea = area;
      bestAway = away;
    }
  }
  return best === undefined ? { x: undefined, cost: here } : { x: best, cost: bestArea };
}

/** Where on `ledge` to settle (see `settle`), if it is somewhere else than where the cat is. */
export const restSpot = (ledge: Ledge, from: number, facing: 1 | -1, bodyLength: number, pose: RestPose | readonly RestPose[], around: Clutter, reach = 3.5): number | undefined =>
  settle(ledge, from, facing, bodyLength, pose, around, reach).x;

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
  /**
   * The cat climbs onto this ledge (it hauls itself up over the lip by its forepaws: see the `climb` clip) rather than leaping to it: `dir` is the way it faces, `landX` is where it stands on top,
   * and `takeoffX` is where it stands before, under the lip (`CLIMB_BACK` behind `landX`).
   */
  climb?: { dir: 1 | -1 };
  /**
   * The cat goes straight up the face of the card under this ledge, its back to the viewer (the `scale` clip), and then hauls itself over the lip as it does for a `climb`: `dir` is the way it
   * faces on top, `landX` is where it stands there, and `takeoffX` is where it sets off from, under the lip (`CLIMB_BACK` behind `landX`). Only where the painter can draw that (see `findPath`).
   */
  scale?: { dir: 1 | -1 };
}

/**
 * A step up that is climbed, not leapt at: a ledge this many body lengths above the one the cat stands on, at the least and at the most (a cat hangs `CLIMB_HANG` below the lip when it
 * has hold of it, so a step of about that is one it can go into without a jump of the picture, and a lower one is a leap of a stride, not worth the show).
 */
export const STEP_MIN = 1.2;
export const STEP_MAX = 1.6;
/** The highest step up (body lengths) that a cat whose painter can draw it from behind goes up the face of (see `Hop.scale`): a little more than it can leap up (`MAX_UP`). */
export const SCALE_MAX = 4.5;

/**
 * Where the cat stands, on `from`, to take hold of the lip of the ledge above it and haul itself up to stand at `landX` on top (a climb, or the top of a scale): `CLIMB_BACK` behind that, which
 * has to be a place of `from`; facing `first` if there is room for it there, and the other way if there is not. Null when there is room for neither.
 */
export function underLip(from: Ledge, landX: number, first: 1 | -1, bodyLength: number): { takeoffX: number; dir: 1 | -1 } | null {
  for (const dir of [first, first > 0 ? -1 : 1] as const) {
    const under = landX - dir * CLIMB_BACK * bodyLength;
    if (under >= from.x0 && under <= from.x1) return { takeoffX: under, dir };
  }
  return null;
}

/**
 * The take-off and landing places of a leap between two ledges. The cat lands where it is wanted if it can get there from the nearest place
 * on its own ledge; if that is too far, it lands as near as it can to where it stands now (and walks the rest of the way). A step up of `STEP_MIN` to `STEP_MAX` body lengths that has room
 * to stand under its lip is a climb (see `Hop.climb`): the cat walks to the place under the lip, and the leap is for the cat in a hurry. With `scale`, a step up that is higher than that, too high
 * to leap at and no higher than `SCALE_MAX`, is gone up the face of (see `Hop.scale`), from the place under the lip; a lower one that can be leapt at is a leap here, and the cat's own to scale or not.
 */
export function leapBetween(from: Ledge, fromX: number, to: Ledge, wantX: number, bodyLength: number, scale = false): { takeoffX: number; landX: number; climb?: { dir: 1 | -1 }; scale?: { dir: 1 | -1 } } | null {
  const rise = from.y - to.y;
  for (const landX of [clamp(wantX, to.x0, to.x1), clamp(fromX, to.x0, to.x1)]) {
    // take off from the place on the first ledge nearest the landing, then see whether that is a leap the cat can make
    const takeoffX = clamp(landX, from.x0, from.x1);
    if (!planJump(takeoffX, from.y, landX, to.y, bodyLength)) {
      // (facing right on top where there is room for that: the picture of its back is drawn facing right, so it does not turn round as it hangs from the lip)
      const lip = scale && rise > STEP_MAX * bodyLength && rise <= SCALE_MAX * bodyLength ? underLip(from, landX, 1, bodyLength) : null;
      if (lip) return { takeoffX: lip.takeoffX, landX, scale: { dir: lip.dir } };
      continue;
    }
    if (rise >= STEP_MIN * bodyLength && rise <= STEP_MAX * bodyLength) {
      // (it climbs from the side it comes from: the place under the lip is `CLIMB_BACK` out from where it stands on top, and has to be a place of its own ledge)
      const lip = underLip(from, landX, landX >= fromX ? 1 : -1, bodyLength);
      if (lip) return { takeoffX: lip.takeoffX, landX, climb: { dir: lip.dir } };
    }
    return { takeoffX, landX };
  }
  return null;
}

/** With `scale`, a step up too high for a hang may be gone up the face of (see `leapBetween`): for a cat whose painter can draw it from behind, and that is in no hurry. */
export function findPath(ledges: readonly Ledge[], from: Ledge, fromX: number, goal: Ledge, goalX: number, bodyLength: number, maxHops = 3, scale = false): Hop[] | null {
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
        const leap = leapBetween(node.ledge, node.x, ledge, want, bodyLength, scale);
        if (!leap) continue;
        const hops: Hop[] = [...node.hops, { ledge, takeoffX: leap.takeoffX, landX: leap.landX, ...(leap.climb ? { climb: leap.climb } : {}), ...(leap.scale ? { scale: leap.scale } : {}) }];
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
