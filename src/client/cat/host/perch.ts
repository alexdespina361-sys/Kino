import { reachOf } from "../engine/shape";
import type { Rect, Surface } from "../types";

/**
 * Where the cat rests in a film: on the line at the foot of the picture, in the stretch of the controls' row that has no button in it (the cat's layer is over the bars, so
 * that a hand can take it while they are up, and it is over no button there), or, where the row leaves no such stretch (a narrow screen, a row that has wrapped), in a corner of
 * the picture, on the line where the bars' lowest block begins, so that it is over no button there either.
 */

/** How much of the screen's width a corner of the picture takes for the cat to sit on (in body lengths from the screen's edge). */
const CORNER_FROM = 0.7;
const CORNER_TO = 3.6;

/** How far above the top of the bars' block the feet of a cat in a corner are (in body lengths), and the highest on the screen that line may be (a share of its height). */
const BARS_ABOVE = 0.08;
const CORNER_LOWEST = 0.5;

/** How far the cat reaches to either side in the postures it takes in a film, its tail included (in body lengths): the room it needs on both sides of its middle. */
const FILM_REACH = Math.max(
  ...(["loaf", "curl", "sit", "knead", "stretch"] as const).map((clip) => {
    const reach = reachOf(clip);
    return Math.max(reach.back, reach.front);
  }),
);

/** The least a perch may be (in body lengths) to be worth having: the cat's middle can be anywhere on it, and a hand's breadth is no place to rest. */
const LEAST = 0.3;

/**
 * The widest stretch between the groups of buttons of the controls' row, as [left, right] (the groups are the rectangles of the row's children), or null when
 * there is none: fewer than two groups, or groups that are not on one line (the row has wrapped).
 */
export function widestGap(groups: readonly Rect[]): [number, number] | null {
  const row = [...groups].filter((box) => box.w > 1 && box.h > 1).sort((a, b) => a.x - b.x);
  if (row.length < 2) return null;
  const first = row[0]!;
  if (row.some((box) => Math.abs(box.y - first.y) > 0.5 * first.h)) return null;
  let best: [number, number] | null = null;
  for (let i = 1; i < row.length; i++) {
    const left = row[i - 1]!.x + row[i - 1]!.w;
    const right = row[i]!.x;
    if (right - left > (best ? best[1] - best[0] : 0)) best = [left, right];
  }
  return best;
}

/**
 * The places for the cat to rest in a film, the one it should take first before the others. `groups` is where the controls' groups of buttons are, if they are there. `bars` is
 * where the top of the bars' lowest block is, as it is laid out whether they are up or not (its first row is the film's bar and its times), if there is one: the corners are
 * on that line then, since the cat is over the bars and a corner at the foot of the screen would be over the last buttons of the row.
 */
export function perchesFor(groups: readonly Rect[], width: number, height: number, L: number, bars?: number): Surface[] {
  const y = height - Math.max(6, height * 0.025);
  const gap = widestGap(groups);
  if (gap) {
    const x0 = gap[0] + FILM_REACH * L;
    const x1 = gap[1] - FILM_REACH * L;
    // (the only place, when there is one: a corner is where the row's buttons are, and a cat left in it when the row comes would stay there)
    if (x1 - x0 >= LEAST * L) return [{ id: "perch-gap", kind: "playerPerch", y, x0, x1, weight: 1 }];
  }
  const corner = bars !== undefined && Number.isFinite(bars) ? Math.min(y, Math.max(bars - BARS_ABOVE * L, CORNER_LOWEST * height)) : y;
  return [
    { id: "perch-right", kind: "playerPerch", y: corner, x0: width - CORNER_TO * L, x1: width - CORNER_FROM * L, weight: 1 },
    { id: "perch-left", kind: "playerPerch", y: corner, x0: CORNER_FROM * L, x1: CORNER_TO * L, weight: 0.7 },
  ];
}
