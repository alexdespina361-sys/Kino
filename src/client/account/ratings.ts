import { filmFacts, showFacts, type LiveProgress, type LiveWatched, type WatchFacts } from "../../shared";
import { cardOf, showKeyOf, type Entry } from "../tv/pages";
import type { RatedTitle } from "./profileStore";
import { mergeFacts, ratingFor, storedFacts } from "./ratingText";
import { profileStore, useProfileData } from "./store";

/** What the rating boxes of the phone and the TV's rating page are made with: the pure words (ratingText.ts) and the hooks that bring a title's rating to a screen. */
export * from "./ratingText";

/** The title a rating is filed under, from what the library (or a list, or a card) knows of it. A page that knows it is a show says so. */
export const ratedTitleOf = (entry: Pick<Entry, "title" | "url" | "image" | "backdrop" | "year" | "kind">, isShow = false): RatedTitle => ({
  title: entry.title,
  url: entry.url,
  image: entry.image,
  backdrop: entry.backdrop,
  year: entry.year,
  kind: isShow ? "series" : entry.kind,
});

/**
 * What this profile has watched of a title, or of one season of a show (`total`: how many episodes it has, when that is known): from the
 * card kept for a film, and from the episodes marked as watched for a show.
 */
export function watchFacts(entry: Entry, isShow: boolean, season: number | undefined, total: number | undefined, progress: readonly LiveProgress[], watched: readonly LiveWatched[]): WatchFacts {
  if (isShow || season !== undefined) return showFacts(watched, showKeyOf({ ...entry, kind: "series" }, progress), season, total);
  return filmFacts(cardOf({ ...entry, kind: "movie" }, progress));
}

/** Whether ratings are on for this profile: they are, unless it turned them off in the settings. */
export const useRatingsOn = (): boolean => useProfileData().settings.ratings ?? true;

/** One title's (or one season's) rating, what is known of the watching behind it, and what changes it. */
export function useRatingFor(entry: Entry, isShow: boolean, season: number | undefined, total: number | undefined) {
  const { ratings, progress, watched } = useProfileData();
  const rating = ratingFor(ratings, entry.url, season);
  const watching = watchFacts(entry, isShow, season, total, progress, watched);
  // (What was seen when it was rated stays true when it is watched again, and grows when more is watched.)
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
