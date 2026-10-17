import { z } from "zod";

/**
 * Subtitle timings that are shared: what a viewer who has timed a subtitle file to the sound leaves for the next one who plays the same
 * file on the same cut of the same film. There is no subtitle text in it and nothing about the viewer, only a hash that names the file
 * (see `client/subsync/cache.ts`) and how far each line was moved.
 */

/** A key: 32 hex digits. */
export const SUBSYNC_KEY = /^[0-9a-f]{32}$/;
/** More lines than this in one file is not a film's subtitles. */
export const SUBSYNC_MAX_LINES = 8000;
/** The farthest (seconds) a line is moved. A file for another cut is more than this off, and has a key of its own. */
export const SUBSYNC_MAX_MOVE = 300;

const Centiseconds = z
  .number()
  .int()
  .min(-SUBSYNC_MAX_MOVE * 100)
  .max(SUBSYNC_MAX_MOVE * 100);

/** `[line, how far its start moved, how far its end moved (both in centiseconds), 1 when the recogniser's words placed it, else 0]`. */
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
    /** How many lines the file has: a timing is for one file, and is not mixed with another's. */
    lines: z.number().int().min(1).max(SUBSYNC_MAX_LINES),
    /** The lines that have been placed, by line number from the first, each once. */
    placed: z.array(SharedPlacementSchema).min(1).max(SUBSYNC_MAX_LINES),
  })
  .refine(({ lines, placed }) => placed.every((each, i) => each[0] < lines && (i === 0 || each[0] > placed[i - 1]![0])), "placements must be in order, once each, within the file");
export type SharedTiming = z.infer<typeof SharedTimingSchema>;

/**
 * What is kept for a file when a timing arrives for it: every line that was placed by either, and for a line placed by both the one that
 * had words to go by (the newer one when both did, or neither did). Undefined when the two are not for the same file; `kept` itself when
 * the arrived one has nothing to add, so a store knows there is nothing to write.
 */
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
