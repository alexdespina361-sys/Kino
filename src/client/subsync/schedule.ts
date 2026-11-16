import type { Range } from "./signals";

/** Seconds of sound the recogniser is given at a time (it takes up to 30; the lab used 15). Windows sit on this grid, so they never overlap. */
export const WINDOW = 15;

export interface Plan {
  /** Where the picture is, and how fast it plays. */
  playhead: number;
  rate: number;
  /** The sound the aligner has, and the windows the recogniser has done. */
  covered: readonly Range[];
  heard: readonly Range[];
  /** How many seconds of sound the recogniser gets through per second of its own work (1 until it has been measured). */
  speed: number;
  /** The sound arrives as the film plays, never ahead of the picture (a film the browser plays by itself: see capture.ts). */
  live?: boolean;
  /** Only one window in this many is heard (those on every `every`-th place of the grid): the light way of timing, see `LIGHT_EVERY` in session.ts. */
  every?: number;
}

/** Whether the window at `from` is one of those to hear when only one in `every` is. */
const onGrid = (from: number, every = 1): boolean => every <= 1 || Math.round(from / WINDOW) % every === 0;

/** With sound that arrives as it plays, the recogniser is given windows this far behind the picture at most. */
export const LIVE_BEHIND = 4;

const within = (ranges: readonly Range[], from: number, to: number): boolean => ranges.some((range) => range.from <= from + 0.05 && range.to >= to - 0.05);

/**
 * The window to give the recogniser next: the nearest one from the picture on that has sound and has not been heard, and that it can
 * finish before the picture gets to its end (one that cannot is no use and is left to whatever comes later). The recogniser works
 * through windows in this order, so a device that cannot keep up hears every other window, or fewer, and the aligner places the
 * lines in between from their neighbours.
 */
export function nextWindow(plan: Plan): number | undefined {
  const { playhead, rate, covered, heard, speed } = plan;
  if (plan.live) return lastWindow(plan);
  const end = covered.reduce((latest, range) => Math.max(latest, range.to), 0);
  const takes = WINDOW / Math.max(0.05, speed);
  for (let from = Math.floor(playhead / WINDOW) * WINDOW; from + WINDOW <= end + 0.05; from += WINDOW) {
    if (!onGrid(from, plan.every) || !within(covered, from, from + WINDOW) || within(heard, from, from + WINDOW)) continue;
    if ((from + WINDOW - playhead) / Math.max(0.25, rate) < takes) continue;
    return from;
  }
  return undefined;
}

/**
 * With sound that only comes as the film plays, every window is behind the picture by the time it is whole: its lines have been on
 * screen, and what the words say of their timing is for the lines to come (the timing of a file is mostly one shift, or a slow
 * stretch). So the newest whole window is the one to hear, back to `LIVE_BEHIND` windows behind the sound around the picture.
 */
function lastWindow({ playhead, covered, heard, every }: Plan): number | undefined {
  const around = covered.find((range) => range.from <= playhead + 1 && range.to >= playhead - WINDOW) ?? covered[covered.length - 1];
  if (!around) return undefined;
  const newest = Math.floor((around.to + 0.05) / WINDOW) * WINDOW - WINDOW;
  for (let from = newest; from >= 0 && from >= newest - LIVE_BEHIND * WINDOW; from -= WINDOW) {
    if (onGrid(from, every) && within(covered, from, from + WINDOW) && !within(heard, from, from + WINDOW)) return from;
  }
  return undefined;
}

/** How long the recogniser rests after a window that took `busy` ms, so that it uses `duty` of the time (0 to 1) and leaves the rest to the picture. */
export function rest(busy: number, duty: number): number {
  return Math.max(0, busy * (1 / Math.min(1, Math.max(0.05, duty)) - 1));
}
