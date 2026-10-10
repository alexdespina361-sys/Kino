/**
 * Which episodes of a show were watched, and how far into the others: what marks the episode lists. The records themselves
 * are kept in the profile (see account.ts and progress.ts); these helpers only read them.
 */

/** The part of a record the episode lists read: `LiveWatched` has it. */
export interface WatchedEntry {
  /** `seriesKeyOf` the media: all episodes of a show share it. */
  show: string;
  season: number;
  episode: number;
  position: number;
  duration: number;
  /** Played to (nearly) the end at some point. Stays set when the episode is started again. */
  done: boolean;
}

/** Under this far in, an episode counts as not started. */
const STARTED_S = 15;

const isEntryOf = (entry: WatchedEntry, show: string, season: number, episode: number) =>
  entry.show === show && entry.season === season && entry.episode === episode;

export type EpisodeStatus = { kind: "new" } | { kind: "started"; fraction: number; secondsLeft: number } | { kind: "watched" };

export function episodeStatus(list: readonly WatchedEntry[], show: string | undefined, season: number, episode: number): EpisodeStatus {
  const entry = show ? list.find((other) => isEntryOf(other, show, season, episode)) : undefined;
  if (!entry) return { kind: "new" };
  if (entry.done) return { kind: "watched" };
  if (entry.position < STARTED_S || entry.duration <= 0) return { kind: "new" };
  return { kind: "started", fraction: Math.min(1, entry.position / entry.duration), secondsLeft: Math.max(0, entry.duration - entry.position) };
}

/** The words of `describeStatus`, for a page that speaks another language. */
export interface StatusWords {
  watched: string;
  left: (minutes: number) => string;
}
const ENGLISH_STATUS: StatusWords = { watched: "Watched", left: (minutes) => `${minutes} min left` };

/** "Watched", "12 min left", or nothing for an episode not started. */
export function describeStatus(status: EpisodeStatus, words: StatusWords = ENGLISH_STATUS): string | undefined {
  if (status.kind === "watched") return words.watched;
  if (status.kind === "started") return words.left(Math.max(1, Math.round(status.secondsLeft / 60)));
  return undefined;
}
