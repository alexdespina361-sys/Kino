import { progressKey, watchedKey, type LiveProgress, type LiveWatched } from "./account";
import { seriesKeyOf, type NormalizedMedia } from "./media";

/**
 * What a screen makes of "this is playing and it is at 12:40": the card for "Continue watching", and the mark on an
 * episode. Everything here is pure, so TV and phone share it and it can be tested without a browser.
 */

/** Under this far in, there is nothing worth resuming. */
export const STARTED_S = 15;
/** Within this of the end (or the last tenth of a short video) counts as watched. */
export const FINISHED_S = 60;
/** A change in position smaller than this is not worth saving (or sending to the other screens). */
const WORTH_SAVING_S = 5;

export interface Playback {
  currentTime: number;
  duration: number;
}

export const reachedEnd = ({ currentTime, duration }: Playback) => duration > 0 && currentTime >= duration - Math.min(FINISHED_S, duration * 0.1);

/** Where to pick up from, or undefined when it is not started, or as good as finished. */
export function resumeAt(item: Pick<LiveProgress, "position" | "duration" | "done">): number | undefined {
  if (item.done || item.duration <= 0 || item.position < STARTED_S) return undefined;
  if (reachedEnd({ currentTime: item.position, duration: item.duration })) return undefined;
  return Math.floor(item.position);
}

/** 0..1 for the thin bar under a card; 0 when there is nothing to show. */
export function fractionOf(item: Pick<LiveProgress, "position" | "duration" | "done">): number {
  return resumeAt(item) === undefined ? 0 : Math.min(1, item.position / item.duration);
}

const nameOf = (media: NormalizedMedia, show: string | undefined, page: string) => show ?? (media.title?.trim() || hostname(page));
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The key of the card a media belongs to (one per show, one per film), or undefined when nothing says where it came from. */
export function progressKeyOf(media: NormalizedMedia): string | undefined {
  const show = seriesKeyOf(media);
  return media.page ? progressKey({ ...(show ? { show } : {}), url: media.page }) : undefined;
}

/**
 * The card for what is playing. Without `playback` it has just been started: it moves to the front, keeping its place if it
 * is the same episode that was left unfinished. With it, the card follows the playback, and the very same card comes back
 * while there is nothing new worth saving. `previous` is the card with the same key that is already kept, if any.
 */
export function progressFor(media: NormalizedMedia, now: number, playback?: Playback, previous?: LiveProgress): LiveProgress | undefined {
  const key = progressKeyOf(media);
  const page = media.page;
  if (!key || !page) return undefined;
  const show = seriesKeyOf(media);
  const before = previous?.key === key ? previous : undefined;

  const image = media.poster ?? before?.image;
  const backdrop = media.backdrop ?? before?.backdrop;
  const year = media.year ?? before?.year;
  const card = {
    key,
    at: now,
    title: nameOf(media, show, page),
    url: page,
    ...(image ? { image } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(year ? { year } : {}),
    ...(media.series ? { season: media.series.season, episode: media.series.episode } : {}),
  };

  if (!playback || !(playback.duration > 0)) {
    const again = before !== undefined && before.url === page && !before.done;
    return { ...card, position: again ? before.position : 0, duration: again ? before.duration : 0 };
  }

  const position = Math.min(playback.currentTime, playback.duration);
  const next = media.series?.next;
  let item: LiveProgress;
  if (reachedEnd({ currentTime: position, duration: playback.duration })) {
    // The end of an episode points at the next one; the end of a film, or of the last episode, leaves the row.
    item = next
      ? { ...card, url: next.url, season: next.season, episode: next.episode, position: 0, duration: 0 }
      : { ...card, position: playback.duration, duration: playback.duration, done: true };
  } else {
    item = { ...card, position, duration: playback.duration };
  }

  if (before && sameCard(before, item) && Math.abs(before.position - item.position) < WORTH_SAVING_S && before.duration === item.duration) return before;
  return item;
}

const sameCard = (a: LiveProgress, b: LiveProgress) =>
  a.url === b.url && a.title === b.title && a.image === b.image && a.backdrop === b.backdrop && a.year === b.year && a.season === b.season && a.episode === b.episode && Boolean(a.done) === Boolean(b.done);

/** The mark on one episode of a show: how far it got, and whether it was seen to the end (which stays true if it is started again). */
export function watchedFor(media: NormalizedMedia, playback: Playback, now: number, previous?: LiveWatched): LiveWatched | undefined {
  const show = seriesKeyOf(media);
  const series = media.series;
  if (!show || !series || !(playback.duration > 0)) return undefined;

  const position = Math.min(playback.currentTime, playback.duration);
  const done = Boolean(previous?.done) || reachedEnd({ currentTime: position, duration: playback.duration });
  if (previous && previous.done === done && previous.duration === playback.duration && Math.abs(previous.position - position) < WORTH_SAVING_S) return previous;
  const entry = { show, season: series.season, episode: series.episode };
  return { key: watchedKey(entry), at: now, ...entry, position, duration: playback.duration, done };
}
