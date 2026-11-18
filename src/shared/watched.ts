export interface WatchedEntry {
  show: string;
  season: number;
  episode: number;
  position: number;
  duration: number;
  done: boolean;
}

const STARTED_S = 15;

const isEntryOf = (entry: WatchedEntry, show: string, season: number, episode: number) =>
  entry.show === show && entry.season === season && entry.episode === episode;

export type EpisodeStatus = { kind: "new" } | { kind: "started"; fraction: number; secondsLeft: number; position: number } | { kind: "watched" };

export function episodeStatus(list: readonly WatchedEntry[], show: string | undefined, season: number, episode: number): EpisodeStatus {
  const entry = show ? list.find((other) => isEntryOf(other, show, season, episode)) : undefined;
  if (!entry) return { kind: "new" };
  if (entry.done) return { kind: "watched" };
  if (entry.position < STARTED_S || entry.duration <= 0) return { kind: "new" };
  return { kind: "started", fraction: Math.min(1, entry.position / entry.duration), secondsLeft: Math.max(0, entry.duration - entry.position), position: entry.position };
}

export interface StatusWords {
  watched: string;
  left: (minutes: number) => string;
}
const ENGLISH_STATUS: StatusWords = { watched: "Watched", left: (minutes) => `${minutes} min left` };

export function describeStatus(status: EpisodeStatus, words: StatusWords = ENGLISH_STATUS): string | undefined {
  if (status.kind === "watched") return words.watched;
  if (status.kind === "started") return words.left(Math.max(1, Math.round(status.secondsLeft / 60)));
  return undefined;
}
