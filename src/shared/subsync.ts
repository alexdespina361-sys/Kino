import { z } from "zod";

export const SUBSYNC_KEY = /^[0-9a-f]{32}$/;
export const SUBSYNC_MAX_LINES = 8000;
export const SUBSYNC_MAX_MOVE = 300;

const Centiseconds = z
  .number()
  .int()
  .min(-SUBSYNC_MAX_MOVE * 100)
  .max(SUBSYNC_MAX_MOVE * 100);

export const SharedPlacementSchema = z.tuple([
  z
    .number()
    .int()
    .min(0)
    .max(SUBSYNC_MAX_LINES - 1),
  Centiseconds,
  Centiseconds,
  z.union([z.literal(0), z.literal(1)]),
]);
export type SharedPlacement = z.infer<typeof SharedPlacementSchema>;

export const SharedTimingSchema = z
  .object({
    v: z.literal(1),
    lines: z.number().int().min(1).max(SUBSYNC_MAX_LINES),
    placed: z.array(SharedPlacementSchema).min(1).max(SUBSYNC_MAX_LINES),
  })
  .refine(({ lines, placed }) => placed.every((each, i) => each[0] < lines && (i === 0 || each[0] > placed[i - 1]![0])), "placements must be in order, once each, within the file");
export type SharedTiming = z.infer<typeof SharedTimingSchema>;

export function mergeTimings(kept: SharedTiming | undefined, arrived: SharedTiming): SharedTiming | undefined {
  if (!kept) return arrived;
  if (kept.lines !== arrived.lines) return undefined;
  const byLine = new Map<number, SharedPlacement>(kept.placed.map((each) => [each[0], each]));
  let changed = false;
  for (const each of arrived.placed) {
    const before = byLine.get(each[0]);
    if (before && (each[3] < before[3] || (each[1] === before[1] && each[2] === before[2] && each[3] === before[3]))) continue;
    byLine.set(each[0], each);
    changed = true;
  }
  return changed ? { v: 1, lines: kept.lines, placed: [...byLine.values()].sort((a, b) => a[0] - b[0]) } : kept;
}
