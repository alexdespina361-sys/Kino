import { AnimeHintSchema, skipTimesOf, type AnimeHint, type NormalizedMedia } from "../../shared";
import type { ResolveResult } from "../resolvers/types";

/** What a look-up learns of an anime on its way (filmpire.ts): set where it learns it, put on the answer at the end, whichever way the film was found. */
export interface AnimeFacts {
  anime?: AnimeHint;
}

/**
 * `result` with what was known of the anime it found (shared/media.ts `AnimeHintSchema`), for the player to ask AniSkip with once it plays. Nothing is
 * asked here: the look-up of a film never waits for it. A hint that is not one (a season that is not a number) is left out, and so is one on a failure.
 */
export function withAnimeHint(result: ResolveResult, hint: AnimeHint | undefined): ResolveResult {
  if (result.status !== "success" || !hint || result.media.anime) return result;
  const checked = AnimeHintSchema.safeParse({ ...hint, title: hint.title.trim().slice(0, 200) });
  return checked.success ? { ...result, media: { ...result.media, anime: checked.data } } : result;
}

/**
 * Where a source says its own stream's opening and ending are (HiAnime's player does), as times that are times: what it wrote is never taken as it is (a part
 * that is not two numbers, or the 0-0 it writes for "none", is left out). No check against the video's length here: the player does that, once it knows it.
 */
export function sourceSkipTimes(raw: unknown): Pick<NormalizedMedia, "skip"> {
  const skip = skipTimesOf(raw);
  return skip ? { skip } : {};
}
