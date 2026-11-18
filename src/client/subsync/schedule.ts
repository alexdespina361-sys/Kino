import type { Range } from "./signals";

export const WINDOW = 15;

export interface Plan {
  playhead: number;
  rate: number;
  covered: readonly Range[];
  heard: readonly Range[];
  speed: number;
  live?: boolean;
  every?: number;
}

const onGrid = (from: number, every = 1): boolean => every <= 1 || Math.round(from / WINDOW) % every === 0;

export const LIVE_BEHIND = 4;

const within = (ranges: readonly Range[], from: number, to: number): boolean => ranges.some((range) => range.from <= from + 0.05 && range.to >= to - 0.05);

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

function lastWindow({ playhead, covered, heard, every }: Plan): number | undefined {
  const around = covered.find((range) => range.from <= playhead + 1 && range.to >= playhead - WINDOW) ?? covered[covered.length - 1];
  if (!around) return undefined;
  const newest = Math.floor((around.to + 0.05) / WINDOW) * WINDOW - WINDOW;
  for (let from = newest; from >= 0 && from >= newest - LIVE_BEHIND * WINDOW; from -= WINDOW) {
    if (onGrid(from, every) && within(covered, from, from + WINDOW) && !within(heard, from, from + WINDOW)) return from;
  }
  return undefined;
}

export function rest(busy: number, duty: number): number {
  return Math.max(0, busy * (1 / Math.min(1, Math.max(0.05, duty)) - 1));
}
