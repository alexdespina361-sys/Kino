import type { LibraryItem } from "../../shared";
import { addressOf, extrasOf, extrasQuery, TITLE_PARAM, titleIdOf, type TitleExtras, type TitleOpening } from "../shared/titleAddress";

export type OpenTitle = (item: LibraryItem, opening?: TitleOpening) => void;

const ADDRESS = /https?:\/\/[^\s<>"]+/gi;
const TRAILING = /[.,!?;:)\]}'"»]+$/;

export interface TitleInText {
  id: string;
  link: string;
  rest: string;
  extras: TitleExtras;
}

export function titleIn(text: string): TitleInText | null {
  for (const match of text.matchAll(ADDRESS)) {
    const link = match[0].replace(TRAILING, "");
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    const address = url.searchParams.get(TITLE_PARAM);
    const id = titleIdOf(address);
    if (!id) continue;
    const at = match.index ?? 0;
    const rest = `${text.slice(0, at)} ${text.slice(at + link.length)}`
      .replace(/\s+/g, " ")
      .replace(/(^|\s)[([{«.,!?;:)\]}'"»]+(?=\s|$)/g, "")
      .trim();
    return { id, link, rest, extras: extrasOf(url.searchParams, address) };
  }
  return null;
}

export const titleLabel = (title: { title: string; year?: number | undefined }): string => (title.year ? `${title.title} (${title.year})` : title.title);

export function titleMessage(entry: { id: string; url: string; kind?: string; title: string; year?: number | undefined }, origin: string): string | null {
  const address = addressOf(entry);
  return address ? messageOf({ address, title: entry.title, year: entry.year }, origin) : null;
}

export interface Sendable {
  address: string;
  title: string;
  year?: number | undefined;
  image?: string | undefined;
  url?: string | undefined;
}

export const messageOf = (title: Pick<Sendable, "address" | "title" | "year">, origin: string, extras: TitleExtras = {}): string =>
  `${titleLabel(title)} ${origin}/tv?${TITLE_PARAM}=${title.address}${extrasQuery(extras)}`;

export const isShowAddress = (address: string): boolean => address.startsWith("tv-");

export const TIME_MAX = 86_400;

export function typedTime(text: string, max = TIME_MAX): number | undefined {
  const parts = /^\s*(\d{1,4})(?::(\d{2}))?(?::(\d{2}))?\s*$/.exec(text);
  if (!parts) return undefined;
  const first = Number(parts[1]);
  const second = parts[2] === undefined ? undefined : Number(parts[2]);
  const third = parts[3] === undefined ? undefined : Number(parts[3]);
  if ((second ?? 0) > 59 || (third ?? 0) > 59) return undefined;
  const seconds = third !== undefined ? first * 3600 + second! * 60 + third : second !== undefined ? first * 60 + second : first * 60;
  return seconds <= max ? seconds : undefined;
}

export const movedTime = (at: number, minutes: number, max: number): number => Math.max(0, Math.min(max, at + minutes * 60));

export function chosenExtras(choice: { show: boolean; episode: { season: number; episode: number } | null; at: number; score: number | undefined }): TitleExtras {
  const episode = choice.show ? choice.episode : null;
  const at = Math.floor(choice.at);
  return {
    ...(episode ? { season: episode.season, episode: episode.episode } : {}),
    ...(at > 0 && at <= TIME_MAX && (episode || !choice.show) ? { at } : {}),
    ...(choice.score !== undefined ? { score: choice.score } : {}),
  };
}

export const SENDABLE_MAX = 24;

export function sendableTitles(
  progress: readonly { key: string; at: number; title: string; url: string; image?: string | undefined; year?: number | undefined; season?: number | undefined }[],
  saved: readonly { id: string; at: number; title: string; url: string; image?: string | undefined; year?: number | undefined }[],
  max = SENDABLE_MAX,
): Sendable[] {
  const all = [
    ...progress.map((card) => ({ at: card.at, title: card, address: addressOf({ id: card.key, url: card.url, kind: card.season !== undefined ? "series" : "movie" }) })),
    ...saved.map((card) => ({ at: card.at, title: card, address: addressOf({ id: card.id, url: card.url }) })),
  ].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const out: Sendable[] = [];
  for (const { title, address } of all) {
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push({ address, title: title.title, url: title.url, ...(title.year ? { year: title.year } : {}), ...(title.image ? { image: title.image } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

export const onlyNames = (rest: string, title: { title: string; year?: number | undefined }): boolean => {
  const said = rest.toLocaleLowerCase();
  return said === "" || said === titleLabel(title).toLocaleLowerCase() || said === title.title.toLocaleLowerCase();
};
