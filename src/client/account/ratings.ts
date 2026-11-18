import { useMemo } from "react";
import { filmFacts, ratingsShown, showFacts, type LiveProgress, type LiveWatched, type WatchFacts } from "../../shared";
import { cardOf, showKeyOf, type Entry } from "../tv/pages";
import type { RatedTitle } from "./profileStore";
import { mergeFacts, ratingFor, scoresOf, storedFacts } from "./ratingText";
import { profileStore, useProfileData } from "./store";

export * from "./ratingText";

export const ratedTitleOf = (entry: Pick<Entry, "title" | "url" | "image" | "backdrop" | "year" | "kind" | "section">, isShow = false): RatedTitle => ({
  title: entry.title,
  url: entry.url,
  image: entry.image,
  backdrop: entry.backdrop,
  year: entry.year,
  kind: isShow ? "series" : entry.kind,
  section: entry.section,
});

export function watchFacts(entry: Entry, isShow: boolean, season: number | undefined, total: number | undefined, progress: readonly LiveProgress[], watched: readonly LiveWatched[]): WatchFacts {
  if (isShow || season !== undefined) return showFacts(watched, showKeyOf({ ...entry, kind: "series" }, progress), season, total);
  return filmFacts(cardOf({ ...entry, kind: "movie" }, progress));
}

export const useRatingsOn = (): boolean => ratingsShown(useProfileData().settings);

const NO_SCORES: ReadonlyMap<string, number> = new Map();

export function useScores(): ReadonlyMap<string, number> {
  const { ratings, settings } = useProfileData();
  const on = ratingsShown(settings);
  return useMemo(() => (on ? scoresOf(ratings) : NO_SCORES), [ratings, on]);
}

export function useRatingFor(entry: Entry, isShow: boolean, season: number | undefined, total: number | undefined) {
  const { ratings, progress, watched } = useProfileData();
  const rating = ratingFor(ratings, entry.url, season);
  const watching = watchFacts(entry, isShow, season, total, progress, watched);
  const facts = mergeFacts(storedFacts(rating), watching);
  const title = ratedTitleOf(entry, isShow);
  return {
    rating,
    facts,
    score: (score: number) => profileStore.setRating(title, season, { score }, facts),
    note: (note: string) => profileStore.setRating(title, season, { note }, facts),
    remove: () => profileStore.removeRating(entry.url, season),
  };
}
