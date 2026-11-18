import { progressKey, watchedKey, type LiveProgress, type LiveWatched } from "./account";
import { seriesKeyOf, type NormalizedMedia } from "./media";

export const STARTED_S = 15;
export const FINISHED_S = 60;
const WORTH_SAVING_S = 5;

export interface Playback {
  currentTime: number;
  duration: number;
}

export const reachedEnd = ({ currentTime, duration }: Playback) => duration > 0 && currentTime >= duration - Math.min(FINISHED_S, duration * 0.1);

export const lastStartAt = (duration: number): number => Math.max(0, Math.floor(duration - Math.min(FINISHED_S, duration * 0.1)) - 1);

export function resumeAt(item: Pick<LiveProgress, "position" | "duration" | "done">): number | undefined {
  if (item.done || item.duration <= 0 || item.position < STARTED_S) return undefined;
  if (reachedEnd({ currentTime: item.position, duration: item.duration })) return undefined;
  return Math.floor(item.position);
}

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

export function progressKeyOf(media: NormalizedMedia): string | undefined {
  const show = seriesKeyOf(media);
  return media.page ? progressKey({ ...(show ? { show } : {}), url: media.page }) : undefined;
}

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
