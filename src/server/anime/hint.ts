import { AnimeHintSchema, skipTimesOf, type AnimeHint, type NormalizedMedia } from "../../shared";
import type { ResolveResult } from "../resolvers/types";

export interface AnimeFacts {
  anime?: AnimeHint;
}

export function withAnimeHint(result: ResolveResult, hint: AnimeHint | undefined): ResolveResult {
  if (result.status !== "success" || !hint || result.media.anime) return result;
  const checked = AnimeHintSchema.safeParse({ ...hint, title: hint.title.trim().slice(0, 200) });
  return checked.success ? { ...result, media: { ...result.media, anime: checked.data } } : result;
}

export function sourceSkipTimes(raw: unknown): Pick<NormalizedMedia, "skip"> {
  const skip = skipTimesOf(raw);
  return skip ? { skip } : {};
}
