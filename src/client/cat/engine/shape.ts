import type { Clip, Rect } from "../types";
import { BANDS, CORES } from "./shape-table";

/**
 * What the cat's body takes of the screen, as it is drawn. Where the cat may stand, where it settles and what it is made to step away from are all asked of
 * this one place, so that none of them is told about a cat that is smaller than the one on the screen. The table is measured from pictures of the drawn cat
 * (scripts/cat/extents.mjs makes shape-table.ts): for every clip, per band of a tenth of a body length from the feet up, how far back and forward of its
 * middle it reaches. Facing left is the same, turned round.
 */

/** The height of a band, in body lengths. */
export const BAND = 0.1;
/** How far below the feet a zone may start and still be one the cat is standing in (pixels). */
export const FOOT_SLACK = 3;

type Bands = ReadonlyArray<readonly [number, number]>;

/** The left and right of one band of a cat whose middle is at `x`, facing the way `facing` says. */
const across = (band: readonly [number, number], facing: 1 | -1, x: number, L: number): [number, number] =>
  facing > 0 ? [x - band[0] * L, x + band[1] * L] : [x - band[1] * L, x + band[0] * L];

/** Whether the cat in `clip`, its middle at `x` and its feet on the line `y`, facing `facing`, overlaps the rectangle. */
export function shapeHits(clip: Clip, facing: 1 | -1, x: number, y: number, L: number, rect: Rect): boolean {
  const bands = BANDS[clip];
  const step = BAND * L;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    if (band[0] + band[1] <= 0) continue;
    const bottom = y - i * step + (i === 0 ? FOOT_SLACK : 0);
    const top = y - (i + 1) * step;
    if (bottom <= rect.y || top >= rect.y + rect.h) continue;
    const [left, right] = across(band, facing, x, L);
    if (right > rect.x && left < rect.x + rect.w) return true;
  }
  return false;
}

/** How much of the rectangles, in square pixels, the cat in `clip` covers (a rectangle covered twice over is counted twice). */
export function shapeCovers(clip: Clip, facing: 1 | -1, x: number, y: number, L: number, rects: readonly Rect[]): number {
  const bands = BANDS[clip];
  const step = BAND * L;
  let area = 0;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    if (band[0] + band[1] <= 0) continue;
    const bottom = y - i * step;
    const top = bottom - step;
    const [left, right] = across(band, facing, x, L);
    for (const rect of rects) {
      const wide = Math.min(right, rect.x + rect.w) - Math.max(left, rect.x);
      const high = Math.min(bottom, rect.y + rect.h) - Math.max(top, rect.y);
      if (wide > 0 && high > 0) area += wide * high;
    }
  }
  return area;
}

/** How far the cat in `clip` reaches in any direction, in body lengths: back, forward, and up. */
export function reachOf(clip: Clip): { back: number; front: number; up: number } {
  const bands = BANDS[clip];
  let back = 0;
  let front = 0;
  for (const band of bands) {
    if (band[0] + band[1] <= 0) continue;
    back = Math.max(back, band[0]);
    front = Math.max(front, band[1]);
  }
  return { back, front, up: bands.length * BAND };
}

/** The body and the head, without the tail: [back, forward, up], in body lengths (where a hand is on the cat). */
export const coreOf = (clip: Clip): readonly [number, number, number] => CORES[clip];

/* ------------------------------ standing and walking ------------------------------ */

// What the cat takes of a ledge it stands or walks along (the larger of the two, band by band): the ledges are worked out from it, whichever way it faces.
const WALKING: Bands = BANDS.stand.map((band, i) => {
  const walk = BANDS.walk[i] ?? [0, 0];
  return [Math.max(band[0], walk[0]), Math.max(band[1], walk[1])] as const;
});

/** Half the width of a cat on its feet, and how tall it is, in body lengths: the most of any height of it (a ledge shorter than this is not worth standing on). */
export const HALF_WIDTH = Math.max(...WALKING.map((band) => Math.max(band[0], band[1])));
export const HEIGHT = WALKING.length * BAND;

/**
 * How far from a zone (to the left and right of it, in pixels) the middle of a cat on its feet on the line `y` must keep: as far as the cat reaches at the
 * heights the zone is at. A zone above the cat's head, or below its feet, asks for nothing; one at the height of its paws only for a little.
 */
export function standingMargin(zone: Rect, y: number, L: number): number {
  const step = BAND * L;
  let most = 0;
  for (let i = 0; i < WALKING.length; i++) {
    const band = WALKING[i]!;
    const bottom = y - i * step + (i === 0 ? FOOT_SLACK : 0);
    const top = y - (i + 1) * step;
    if (bottom <= zone.y || top >= zone.y + zone.h) continue;
    most = Math.max(most, band[0], band[1]);
  }
  return most * L;
}
