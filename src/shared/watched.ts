import { z } from "zod";
import { seriesKeyOf, type NormalizedMedia } from "./media";

/**
 * Which episodes of a show have been watched, and how far into the others. Kept by the TV and by the phone, each in its
 * own localStorage, to mark the episode lists. Everything here is pure so it can be tested without a browser.
 */
const EntrySchema = z.object({
  /** `seriesKeyOf` the media: all episodes of a show share it. */
  show: z.string().max(300),
  season: z.number().int(),
  episode: z.number().int(),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  /** Played to (nearly) the end at some point. Stays set when the episode is started again. */
  done: z.boolean(),
  at: z.number().finite(),
});
export type WatchedEntry = z.infer<typeof EntrySchema>;

export const WATCHED_MAX = 600;
/** Under this far in, an episode counts as not started. */
const STARTED_S = 15;
/** Within this of the end (or the last tenth of a short video) counts as watched. */
const FINISHED_S = 60;

export function parseWatched(raw: string | undefined): WatchedEntry[] {
  if (!raw) return [];
  try {
    const result = z.array(EntrySchema).safeParse(JSON.parse(raw));
    return result.success ? result.data.slice(0, WATCHED_MAX) : [];
  } catch {
    return [];
  }
}

export const serializeWatched = (list: WatchedEntry[]) => JSON.stringify(list.slice(0, WATCHED_MAX));

const isEntryOf = (entry: WatchedEntry, show: string, season: number, episode: number) =>
  entry.show === show && entry.season === season && entry.episode === episode;

/**
 * The episode that is playing reported where it is. Returns the same list when there is nothing new worth keeping
 * (a few seconds more, no new state), so callers can store it without re-rendering on every tick.
 */
export function recordWatching(
  list: WatchedEntry[],
  media: NormalizedMedia,
  progress: { currentTime: number; duration: number },
  now: number,
): WatchedEntry[] {
  const show = seriesKeyOf(media);
  const series = media.series;
  if (!show || !series || progress.duration <= 0) return list;

  const position = Math.min(progress.currentTime, progress.duration);
  const previous = list.find((entry) => isEntryOf(entry, show, series.season, series.episode));
  const reachedEnd = position >= progress.duration - Math.min(FINISHED_S, progress.duration * 0.1);
  const done = Boolean(previous?.done) || reachedEnd;
  if (previous && previous.done === done && previous.duration === progress.duration && Math.abs(previous.position - position) < 5) return list;

  const entry: WatchedEntry = { show, season: series.season, episode: series.episode, position, duration: progress.duration, done, at: now };
  const rest = list.filter((other) => other !== previous);
  return [entry, ...rest].slice(0, WATCHED_MAX);
}

export type EpisodeStatus = { kind: "new" } | { kind: "started"; fraction: number; secondsLeft: number } | { kind: "watched" };

export function episodeStatus(list: readonly WatchedEntry[], show: string | undefined, season: number, episode: number): EpisodeStatus {
  const entry = show ? list.find((other) => isEntryOf(other, show, season, episode)) : undefined;
  if (!entry) return { kind: "new" };
  if (entry.done) return { kind: "watched" };
  if (entry.position < STARTED_S || entry.duration <= 0) return { kind: "new" };
  return { kind: "started", fraction: Math.min(1, entry.position / entry.duration), secondsLeft: Math.max(0, entry.duration - entry.position) };
}

/** "Watched", "12 min left", or nothing for an episode not started. */
export function describeStatus(status: EpisodeStatus): string | undefined {
  if (status.kind === "watched") return "Watched";
  if (status.kind === "started") return `${Math.max(1, Math.round(status.secondsLeft / 60))} min left`;
  return undefined;
}
