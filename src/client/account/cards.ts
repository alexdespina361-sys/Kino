import { resumeAt, type ListInfo, type LiveProgress, type PlayHint } from "../../shared";
import { t } from "../i18n";
import { formatLeft } from "../shared/format";
import type { ListEntry } from "./profileStore";

export const unfinished = (items: readonly LiveProgress[]): LiveProgress[] => items.filter((item) => !item.done);

export const hintOf = (item: { image?: string | undefined; backdrop?: string | undefined; year?: number | undefined; title?: string | undefined }): PlayHint => ({
  ...(item.title ? { title: item.title.slice(0, 300) } : {}),
  ...(item.image ? { poster: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
});

export function continueNote(item: LiveProgress): string | undefined {
  const episode = item.season !== undefined && item.episode !== undefined ? `S${item.season}:E${item.episode}` : undefined;
  const state = resumeAt(item) !== undefined ? t("card.timeLeft", { time: formatLeft(item.duration - item.position) }) : item.duration === 0 && episode ? t("card.upNext") : undefined;
  return [episode, state].filter(Boolean).join(" · ") || undefined;
}

export const listName = (list: ListInfo): string => list.name ?? t("list.favourites");

export const listEntryOf = (item: { id: string; title: string; url: string; image?: string | undefined; backdrop?: string | undefined; year?: number | undefined; description?: string | undefined }): ListEntry => ({
  id: item.id,
  title: item.title,
  url: item.url,
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
  ...(item.description ? { description: item.description } : {}),
});
