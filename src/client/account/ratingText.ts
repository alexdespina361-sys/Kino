import { isScore, ratingKey, watchedAll, type LiveRating, type WatchFacts } from "../../shared";
import type { Key, Params } from "../i18n";
import { formatDay } from "./time";

/**
 * What the screens say about ratings, with nothing of the screens in it: the scores and their words, which rating a title has, the
 * lines that tell what is known of the watching behind a rating, and how a list of ratings is ordered and summed up.
 */

/** The scores a person can give, out of ten. */
export const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Score = (typeof SCORES)[number];

export type Translate = (key: Key, params?: Params) => string;

/** What a score is called ("Masterpiece" for 10 down to "Appalling" for 1): the line under the buttons. Nothing for a number that is no score. */
export const scoreWord = (say: Translate, score: number): string => (isScore(score) ? say(`rating.word${score as Score}`) : "");

/** The rating a title has (or one of its seasons, for a show). */
export function ratingFor(ratings: readonly LiveRating[], url: string, season?: number): LiveRating | undefined {
  const key = ratingKey(url, season);
  return ratings.find((rating) => rating.key === key);
}

/** The ratings, newest rated first, or the best first (the newest first among equals). */
export type RatingOrder = "new" | "high";
export function sortRatings(ratings: readonly LiveRating[], order: RatingOrder): LiveRating[] {
  return [...ratings].sort((a, b) => (order === "high" ? b.score - a.score : 0) || b.ratedAt - a.ratedAt || a.title.localeCompare(b.title) || (a.season ?? 0) - (b.season ?? 0));
}

/** The watching a rating remembers, as the facts the rest of the app speaks. */
export const storedFacts = (rating: Pick<LiveRating, "watchedAt" | "percent" | "seen" | "of"> | undefined): WatchFacts => ({
  ...(rating?.watchedAt !== undefined ? { watchedAt: rating.watchedAt } : {}),
  ...(rating?.percent !== undefined ? { percent: rating.percent } : {}),
  ...(rating?.seen !== undefined ? { seen: rating.seen } : {}),
  ...(rating?.of !== undefined ? { of: rating.of } : {}),
});

/**
 * Two accounts of the same watching, put together: the furthest anyone got and the latest time (watching it again from the start does
 * not make a film less seen than it was), and the size of a season from whoever knows it.
 */
export function mergeFacts(before: WatchFacts, now: WatchFacts): WatchFacts {
  const most = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
  const [watchedAt, percent, seen] = [most(before.watchedAt, now.watchedAt), most(before.percent, now.percent), most(before.seen, now.seen)];
  const of = now.of ?? before.of;
  return {
    ...(watchedAt !== undefined ? { watchedAt } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(seen !== undefined ? { seen: of !== undefined ? Math.min(seen, of) : seen } : {}),
    ...(of !== undefined ? { of } : {}),
  };
}

/**
 * The few short lines a rating shows beside its score, worked out the same way on both screens: when it was rated, how much was
 * watched, and when it was finished (or last watched, when it was not all). A line is there only when it is known.
 */
export function factLines(say: Translate, language: string, ratedAt: number | undefined, facts: WatchFacts): string[] {
  const lines: string[] = [];
  if (ratedAt !== undefined) lines.push(say("rating.ratedOn", { date: formatDay(ratedAt, language) }));
  if (facts.percent !== undefined) lines.push(facts.percent >= 100 ? say("rating.watchedFull") : say("rating.watchedPercent", { percent: facts.percent }));
  else if (facts.seen !== undefined) lines.push(facts.of !== undefined ? say("rating.episodesOf", { seen: facts.seen, count: facts.of }) : say("rating.episodesSeen", { count: facts.seen }));
  if (facts.watchedAt !== undefined) lines.push(say(watchedAll(facts) ? "rating.finishedOn" : "rating.lastWatchedOn", { date: formatDay(facts.watchedAt, language) }));
  return lines;
}

/** The line under a rated title in a row or a grid: "8/10", and which season when it is one. */
export const ratingNote = (say: Translate, rating: Pick<LiveRating, "score" | "season">): string => [rating.season ? say("player.season", { n: rating.season }) : "", `${rating.score}/10`].filter(Boolean).join(" · ");

/** The mean of the scores with one decimal, written the way the language writes numbers ("7.4", "7,4"). */
export function averageText(language: string, ratings: readonly Pick<LiveRating, "score">[]): string {
  const average = Math.round((ratings.reduce((sum, rating) => sum + rating.score, 0) / Math.max(1, ratings.length)) * 10) / 10;
  try {
    return average.toLocaleString(language, { maximumFractionDigits: 1 });
  } catch {
    return String(average);
  }
}

/** "12 ratings · average 7.4", or nothing for no ratings. */
export function ratingSummary(say: Translate, language: string, ratings: readonly Pick<LiveRating, "score">[]): string {
  return ratings.length === 0 ? "" : say("rating.summary", { count: ratings.length, average: averageText(language, ratings) });
}
