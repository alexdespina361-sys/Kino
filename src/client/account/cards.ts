import { resumeAt, type LiveProgress, type PlayHint } from "../../shared";
import { t } from "../i18n";
import { formatLeft } from "../shared/format";
import type { ListEntry } from "./profileStore";

/** What "Continue watching" shows: the films and shows left unfinished, and the episode that comes next. */
export const unfinished = (items: readonly LiveProgress[]): LiveProgress[] => items.filter((item) => !item.done);

/** The pictures and year a title is known by, which "Continue watching" shows for it later. */
export const hintOf = (item: { image?: string | undefined; backdrop?: string | undefined; year?: number | undefined }): PlayHint => ({
  ...(item.image ? { poster: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
});

/** The line under a "Continue watching" card: the episode, and what is left of it (or that it is the one up next). */
export function continueNote(item: LiveProgress): string | undefined {
  const episode = item.season !== undefined && item.episode !== undefined ? `S${item.season}:E${item.episode}` : undefined;
  const state = resumeAt(item) !== undefined ? t("card.timeLeft", { time: formatLeft(item.duration - item.position) }) : item.duration === 0 && episode ? t("card.upNext") : undefined;
  return [episode, state].filter(Boolean).join(" · ") || undefined;
}

/** A library title as My List keeps it. */
export const listEntryOf = (item: { id: string; title: string; url: string; image?: string | undefined; backdrop?: string | undefined; year?: number | undefined; description?: string | undefined }): ListEntry => ({
  id: item.id,
  title: item.title,
  url: item.url,
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
  ...(item.description ? { description: item.description } : {}),
});
