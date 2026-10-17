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
}

const within = (ranges: readonly Range[], from: number, to: number): boolean => ranges.some((range) => range.from <= from + 0.05 && range.to >= to - 0.05);

/**
 * The window to give the recogniser next: the nearest one from the picture on that has sound and has not been heard, and that it can
 * finish before the picture gets to its end (one that cannot is no use and is left to whatever comes later). The recogniser works
 * through windows in this order, so a device that cannot keep up hears every other window, or fewer, and the aligner places the
 * lines in between from their neighbours.
 */
export function nextWindow(plan: Plan): number | undefined {
  const { playhead, rate, covered, heard, speed } = plan;
  const end = covered.reduce((latest, range) => Math.max(latest, range.to), 0);
  const takes = WINDOW / Math.max(0.05, speed);
  for (let from = Math.floor(playhead / WINDOW) * WINDOW; from + WINDOW <= end + 0.05; from += WINDOW) {
    if (!within(covered, from, from + WINDOW) || within(heard, from, from + WINDOW)) continue;
    if ((from + WINDOW - playhead) / Math.max(0.25, rate) < takes) continue;
    return from;
  }
  return undefined;
}

/** How long the recogniser rests after a window that took `busy` ms, so that it uses `duty` of the time (0 to 1) and leaves the rest to the picture. */
export function rest(busy: number, duty: number): number {
  return Math.max(0, busy * (1 / Math.min(1, Math.max(0.05, duty)) - 1));
}
