import { MAX_SCORE, type LiveProgress, type LiveRating, type LiveWatched } from "./account";

export const WATCHED_ALL = 0.95;

export function percentWatched(position: number, duration: number, done?: boolean): number | undefined {
  if (done) return 100;
  if (!(duration > 0)) return undefined;
  const fraction = Math.max(0, Math.min(1, position / duration));
  return fraction >= WATCHED_ALL ? 100 : Math.floor(fraction * 100);
}

export interface WatchFacts {
  watchedAt?: number;
  percent?: number;
  seen?: number;
  of?: number;
}

export function filmFacts(card: Pick<LiveProgress, "at" | "position" | "duration" | "done"> | undefined): WatchFacts {
  if (!card) return {};
  const percent = percentWatched(card.position, card.duration, card.done);
  return { watchedAt: card.at, ...(percent !== undefined ? { percent } : {}) };
}

export function showFacts(watched: readonly Pick<LiveWatched, "show" | "season" | "position" | "duration" | "done" | "at">[], show: string, season: number | undefined, total?: number): WatchFacts {
  const marks = watched.filter((mark) => mark.show === show && (season === undefined || mark.season === season));
  if (marks.length === 0) return {};
  const seen = marks.filter((mark) => percentWatched(mark.position, mark.duration, mark.done) === 100).length;
  const of = total !== undefined && total >= 1 ? total : undefined;
  return { watchedAt: Math.max(...marks.map((mark) => mark.at)), seen: of === undefined ? seen : Math.min(seen, of), ...(of !== undefined ? { of } : {}) };
}

export const watchedAll = (facts: WatchFacts): boolean => facts.percent === 100 || (facts.of !== undefined && facts.seen !== undefined && facts.seen >= facts.of);

export const scoreOf = (ratings: readonly LiveRating[], key: string): LiveRating | undefined => ratings.find((rating) => rating.key === key);

export function averageScore(ratings: readonly Pick<LiveRating, "score">[]): number | undefined {
  if (ratings.length === 0) return undefined;
  return Math.round((ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length) * 10) / 10;
}

export const isScore = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= MAX_SCORE;
