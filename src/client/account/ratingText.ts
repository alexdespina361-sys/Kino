import { isScore, ratingKey, watchedAll, type LiveRating, type WatchFacts } from "../../shared";
import type { Key, Params } from "../i18n";
import { formatDay } from "./time";

export const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Score = (typeof SCORES)[number];

export type Translate = (key: Key, params?: Params) => string;

export const scoreWord = (say: Translate, score: number): string => (isScore(score) ? say(`rating.word${score as Score}`) : "");

export function ratingFor(ratings: readonly LiveRating[], url: string, season?: number): LiveRating | undefined {
  const key = ratingKey(url, season);
  return ratings.find((rating) => rating.key === key);
}

export const scoresOf = (ratings: readonly Pick<LiveRating, "key" | "score" | "season">[]): ReadonlyMap<string, number> =>
  new Map(ratings.filter((rating) => rating.season === undefined).map((rating) => [rating.key, rating.score] as const));

export const scoreOf = (scores: ReadonlyMap<string, number>, url: string): number | undefined => (url ? scores.get(ratingKey(url)) : undefined);

export type RatingOrder = "new" | "high";
export function sortRatings(ratings: readonly LiveRating[], order: RatingOrder): LiveRating[] {
  return [...ratings].sort((a, b) => (order === "high" ? b.score - a.score : 0) || b.ratedAt - a.ratedAt || a.title.localeCompare(b.title) || (a.season ?? 0) - (b.season ?? 0));
}

export const storedFacts = (rating: Pick<LiveRating, "watchedAt" | "percent" | "seen" | "of"> | undefined): WatchFacts => ({
  ...(rating?.watchedAt !== undefined ? { watchedAt: rating.watchedAt } : {}),
  ...(rating?.percent !== undefined ? { percent: rating.percent } : {}),
  ...(rating?.seen !== undefined ? { seen: rating.seen } : {}),
  ...(rating?.of !== undefined ? { of: rating.of } : {}),
});

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

export function factLines(say: Translate, language: string, ratedAt: number | undefined, facts: WatchFacts): string[] {
  const lines: string[] = [];
  if (ratedAt !== undefined) lines.push(say("rating.ratedOn", { date: formatDay(ratedAt, language) }));
  if (facts.percent !== undefined) lines.push(facts.percent >= 100 ? say("rating.watchedFull") : say("rating.watchedPercent", { percent: facts.percent }));
  else if (facts.seen !== undefined) lines.push(facts.of !== undefined ? say("rating.episodesOf", { seen: facts.seen, count: facts.of }) : say("rating.episodesSeen", { count: facts.seen }));
  if (facts.watchedAt !== undefined) lines.push(say(watchedAll(facts) ? "rating.finishedOn" : "rating.lastWatchedOn", { date: formatDay(facts.watchedAt, language) }));
  return lines;
}

export const ratingNote = (say: Translate, rating: Pick<LiveRating, "score" | "season">): string => [rating.season ? say("player.season", { n: rating.season }) : "", `${rating.score}/10`].filter(Boolean).join(" · ");

export function averageText(language: string, ratings: readonly Pick<LiveRating, "score">[]): string {
  const average = Math.round((ratings.reduce((sum, rating) => sum + rating.score, 0) / Math.max(1, ratings.length)) * 10) / 10;
  try {
    return average.toLocaleString(language, { maximumFractionDigits: 1 });
  } catch {
    return String(average);
  }
}

export function ratingSummary(say: Translate, language: string, ratings: readonly Pick<LiveRating, "score">[]): string {
  return ratings.length === 0 ? "" : say("rating.summary", { count: ratings.length, average: averageText(language, ratings) });
}
