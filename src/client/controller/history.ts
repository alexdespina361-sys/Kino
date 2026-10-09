import { z } from "zod";

/**
 * "Recently played" for the phone: what was sent to the TV, and how far it got.
 * Lives in the phone's localStorage; every function here is pure so it can be tested without a browser.
 */
const EntrySchema = z.object({
  /** What was pasted or shared: a page or media link. Replaying it goes through the resolver again. */
  url: z.string().max(2048),
  title: z.string().max(300),
  /** The stream last played for it. Progress reports from the TV name the stream, not the page. */
  streamUrl: z.string().max(2048).optional(),
  /** Set for episodes: all episodes of one show share it, so the list keeps one "continue watching" entry per show. */
  seriesKey: z.string().max(300).optional(),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0),
  at: z.number().finite(),
});
export type HistoryEntry = z.infer<typeof EntrySchema>;

export const HISTORY_KEY = "controller.history";
export const HISTORY_MAX = 12;

/** Under this far in, there is nothing worth resuming. */
const MIN_RESUME_S = 15;
/** Within this of the end counts as finished. */
const FINISHED_S = 60;

export function parseHistory(raw: string | undefined): HistoryEntry[] {
  if (!raw) return [];
  try {
    const result = z.array(EntrySchema).safeParse(JSON.parse(raw));
    return result.success ? result.data.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export const serializeHistory = (list: HistoryEntry[]) => JSON.stringify(list.slice(0, HISTORY_MAX));

/**
 * A link was just sent to the TV. It moves to the top and keeps whatever progress it already had.
 * An episode replaces the earlier episode of the same show, so "continue watching" points at where you are.
 */
export function recordPlay(
  list: HistoryEntry[],
  play: { url: string; title: string; streamUrl: string; seriesKey?: string; now: number },
): HistoryEntry[] {
  const previous = list.find((entry) => entry.url === play.url);
  const entry: HistoryEntry = {
    url: play.url,
    title: play.title || previous?.title || play.url,
    streamUrl: play.streamUrl,
    ...(play.seriesKey ? { seriesKey: play.seriesKey } : {}),
    position: previous?.position ?? 0,
    duration: previous?.duration ?? 0,
    at: play.now,
  };
  const sameShow = (other: HistoryEntry) => Boolean(play.seriesKey) && other.seriesKey === play.seriesKey;
  return [entry, ...list.filter((other) => other.url !== play.url && !sameShow(other))].slice(0, HISTORY_MAX);
}

/** The TV reported where the stream is. Returns the same list when nothing worth saving changed. */
export function recordProgress(
  list: HistoryEntry[],
  progress: { streamUrl: string; position: number; duration: number; now: number },
): HistoryEntry[] {
  const index = list.findIndex((entry) => entry.streamUrl === progress.streamUrl);
  const entry = list[index];
  if (!entry || progress.duration <= 0) return list;
  const position = Math.min(progress.position, progress.duration);
  if (Math.abs(position - entry.position) < 2 && entry.duration === progress.duration) return list;
  const next = [...list];
  next[index] = { ...entry, position, duration: progress.duration, at: progress.now };
  return next;
}

export const removeEntry = (list: HistoryEntry[], url: string) => list.filter((entry) => entry.url !== url);

/** Where to pick up from, or undefined if it's not started, or as good as finished. */
export function resumePoint(entry: HistoryEntry): number | undefined {
  if (entry.duration <= 0 || entry.position < MIN_RESUME_S) return undefined;
  if (entry.position > entry.duration - FINISHED_S) return undefined;
  return Math.floor(entry.position);
}

/** 0..1 for the thin red bar under a card; 0 when there is nothing to show. */
export function progressFraction(entry: HistoryEntry): number {
  if (entry.duration <= 0 || resumePoint(entry) === undefined) return 0;
  return Math.min(1, entry.position / entry.duration);
}
