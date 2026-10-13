import { MAX_SCORE, type LiveProgress, type LiveRating, type LiveWatched } from "./account";

/**
 * What a rating remembers about the watching behind it, worked out from what the profile has watched when the score is given: how much
 * of the film (or how many episodes of the show or season) and when it was last watched. Pure, so both screens agree and it can be tested.
 */

/** From this far in, all of it counts as watched: the credits are often skipped, and the film was seen. */
export const WATCHED_ALL = 0.95;

/** How much was watched, in whole percent (never 100 until it is really all, or past `WATCHED_ALL`). Nothing when the length is not known. */
export function percentWatched(position: number, duration: number, done?: boolean): number | undefined {
  if (done) return 100;
  if (!(duration > 0)) return undefined;
  const fraction = Math.max(0, Math.min(1, position / duration));
  return fraction >= WATCHED_ALL ? 100 : Math.floor(fraction * 100);
}

/** What is known of the watching behind a rating. Each part is there only when it is known. */
export interface WatchFacts {
  watchedAt?: number;
  percent?: number;
  seen?: number;
  of?: number;
}

/** A film: from the card kept for it (a film that was never played here has none, and nothing is known of it). */
export function filmFacts(card: Pick<LiveProgress, "at" | "position" | "duration" | "done"> | undefined): WatchFacts {
  if (!card) return {};
  const percent = percentWatched(card.position, card.duration, card.done);
  return { watchedAt: card.at, ...(percent !== undefined ? { percent } : {}) };
}

/**
 * A show or one season of it, from the episodes marked watched: how many were watched to (nearly) the end, out of `total` when the
 * number of episodes is known, and when one was last watched. `season` absent is the whole show.
 */
export function showFacts(watched: readonly Pick<LiveWatched, "show" | "season" | "position" | "duration" | "done" | "at">[], show: string, season: number | undefined, total?: number): WatchFacts {
  const marks = watched.filter((mark) => mark.show === show && (season === undefined || mark.season === season));
  if (marks.length === 0) return {};
  const seen = marks.filter((mark) => percentWatched(mark.position, mark.duration, mark.done) === 100).length;
  const of = total !== undefined && total >= 1 ? total : undefined;
  return { watchedAt: Math.max(...marks.map((mark) => mark.at)), seen: of === undefined ? seen : Math.min(seen, of), ...(of !== undefined ? { of } : {}) };
}

/** Whether a rating's facts say it was all watched (a film past `WATCHED_ALL`, or every episode of a season or show whose size is known). */
export const watchedAll = (facts: WatchFacts): boolean => facts.percent === 100 || (facts.of !== undefined && facts.seen !== undefined && facts.seen >= facts.of);

/** The score a title has with this profile, if any: the rating of the whole title (not of a season). */
export const scoreOf = (ratings: readonly LiveRating[], key: string): LiveRating | undefined => ratings.find((rating) => rating.key === key);

/** The scores of the ratings given, as the mean out of ten with one decimal (what a person's taste looks like in a number), or nothing when there are none. */
export function averageScore(ratings: readonly Pick<LiveRating, "score">[]): number | undefined {
  if (ratings.length === 0) return undefined;
  return Math.round((ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length) * 10) / 10;
}

/** Whether a number is a score a rating can have. */
export const isScore = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= MAX_SCORE;
