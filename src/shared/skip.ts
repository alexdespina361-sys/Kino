import type { SkipInterval, SkipTimes } from "./media";

/**
 * Where to skip in an episode (its opening, its "previously on", its closing credits), and what of it can be believed. The times come from the source of
 * the video itself (HiAnime says where its own stream's opening is) or from AniSkip (times people sent in, server/anime/skipTimes.ts), and a time that is
 * wrong is worse than none: the player would offer to skip the story, or skip it by itself. So a time is kept only when it looks like what it says it is, for
 * a video of the length that is playing; the rest is left out, and the player shows no button for it.
 */

/** The parts the player offers to skip, in the order they come in an episode. */
export const SKIP_PARTS = ["recap", "intro", "outro"] as const;
export type SkipPart = (typeof SKIP_PARTS)[number];

/**
 * The least and most a part lasts (seconds), and where in the video it may be: a share of its length, and seconds from its start or before its end (so that
 * in a two-hour film an "opening" an hour in is not one, as a share alone would let it be).
 */
const RULES: Record<SkipPart, { shortest: number; longest: number; startsBy?: number; startsWithin?: number; startsFrom?: number; startsInLast?: number }> = {
  /** An opening: 10 s to a little over three minutes, in the first half and the first quarter of an hour. */
  intro: { shortest: 10, longest: 200, startsBy: 0.5, startsWithin: 900 },
  /** A "previously on": a few seconds to five minutes, near the start (in the first five minutes). */
  recap: { shortest: 5, longest: 300, startsBy: 0.35, startsWithin: 300 },
  /** Closing credits: 10 s to five minutes, in the second half and the last quarter of an hour. */
  outro: { shortest: 10, longest: 300, startsFrom: 0.5, startsInLast: 900 },
};

/** A video shorter than this has nothing to skip. */
const SHORTEST_VIDEO = 120;
/** How far past the video's end a time may say a part ends (a cut a second or two shorter): it is cut at the end. Further than that, the times are another cut's. */
const PAST_THE_END = 2;

/** One part's time, if it is a time at all: finite numbers, not before the start, ending after it starts (and not the 0-0 a source writes for "none"). */
function interval(value: unknown): SkipInterval | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { start, end } = value as { start?: unknown; end?: unknown };
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (start < 0 || end <= start || end > 86_400) return undefined;
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

/** What a source wrote about where to skip, as times (each part that is not a time is left out), or nothing. For what came from outside: never trusted as it is. */
export function skipTimesOf(raw: unknown): SkipTimes | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const found: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = interval((raw as Record<string, unknown>)[part]);
    if (its) found[part] = its;
  }
  return found.intro || found.recap || found.outro ? found : undefined;
}

/** `first`'s time for each part, and `second`'s where `first` has none. */
export function mergeSkipTimes(first: SkipTimes | undefined, second: SkipTimes | undefined): SkipTimes | undefined {
  const merged: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = first?.[part] ?? second?.[part];
    if (its) merged[part] = its;
  }
  return merged.intro || merged.recap || merged.outro ? merged : undefined;
}

/**
 * The times that can be believed for a video `length` seconds long (each cut at the end of the video), or nothing: each part lasts what such a part lasts and
 * is where such a part is, none ends well past the end (those are another cut's times), and a "previously on" that runs into the opening is left out.
 */
export function believableSkipTimes(skip: SkipTimes | undefined, length: number): SkipTimes | undefined {
  if (!skip || !Number.isFinite(length) || length < SHORTEST_VIDEO) return undefined;
  const kept: SkipTimes = {};
  for (const part of SKIP_PARTS) {
    const its = interval(skip[part]);
    if (!its) continue;
    const rule = RULES[part];
    if (its.end > length + PAST_THE_END) continue;
    const end = Math.min(its.end, length);
    const lasts = end - its.start;
    if (lasts < rule.shortest || lasts > rule.longest) continue;
    if (rule.startsBy !== undefined && its.start > rule.startsBy * length) continue;
    if (rule.startsWithin !== undefined && its.start > rule.startsWithin) continue;
    if (rule.startsFrom !== undefined && its.start < rule.startsFrom * length) continue;
    if (rule.startsInLast !== undefined && its.start < length - rule.startsInLast) continue;
    kept[part] = { start: its.start, end };
  }
  if (kept.recap && kept.intro && kept.recap.start < kept.intro.end && kept.intro.start < kept.recap.end) delete kept.recap;
  return kept.intro || kept.recap || kept.outro ? kept : undefined;
}
