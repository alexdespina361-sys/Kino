import type { LibraryItem } from "../../shared";
import { addressOf, extrasOf, extrasQuery, TITLE_PARAM, titleIdOf, type TitleExtras, type TitleOpening } from "../shared/titleAddress";

/** What a press on a chat's card does: opens the title's page, at the episode and the time the card names (when it names them). */
export type OpenTitle = (item: LibraryItem, opening?: TitleOpening) => void;

/**
 * A title sent in a chat: the message is plain text, the title's name and its own address (`https://kino4tv.com/tv?title=movie-603`), so a page that
 * does not know of cards (an old one, a report to the team) shows something anybody can read. A page that does shows a card for it: the poster and the
 * name, and a press opens the title's page here. Which site the address is of does not matter (the site has more than one), only the title it names;
 * the address itself is never followed. Pure, so what makes a card can be tested without a screen.
 */

/** An address in a message (the rest of the words around it are what the message says). */
const ADDRESS = /https?:\/\/[^\s<>"]+/gi;
/** What ends a sentence after an address is not part of it ("watch this: https://.../tv?title=movie-603!"). */
const TRAILING = /[.,!?;:)\]}'"»]+$/;

export interface TitleInText {
  /** The library's id of the title (`filmpire-movie-603`). */
  id: string;
  /** The address as it is in the message. */
  link: string;
  /** What the message says besides the address (spaces made single, trimmed): empty when it is only the address. */
  rest: string;
  /** The episode, the time and the writer's rating the address asks for (titleAddress.ts `TitleExtras`): none of them when it asks for nothing. */
  extras: TitleExtras;
}

/** The first address of a title in the message, if there is one. */
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
    // (What ended the sentence after the address, or opened a bracket around it, is not left standing alone: "Watch this: !", "(" of "(https://...).".)
    const rest = `${text.slice(0, at)} ${text.slice(at + link.length)}`
      .replace(/\s+/g, " ")
      .replace(/(^|\s)[([{«.,!?;:)\]}'"»]+(?=\s|$)/g, "")
      .trim();
    return { id, link, rest, extras: extrasOf(url.searchParams, address) };
  }
  return null;
}

/** "Alpha Film (1931)": how a title is named in a message. */
export const titleLabel = (title: { title: string; year?: number | undefined }): string => (title.year ? `${title.title} (${title.year})` : title.title);

/** What is written to send a title: its name, and its address on this site. None for a title that has no address (a link pasted on the phone). */
export function titleMessage(entry: { id: string; url: string; kind?: string; title: string; year?: number | undefined }, origin: string): string | null {
  const address = addressOf(entry);
  return address ? messageOf({ address, title: entry.title, year: entry.year }, origin) : null;
}

/** A title that can be sent from the chat: one this profile watched or saved, by its address on the site. */
export interface Sendable {
  address: string;
  title: string;
  year?: number | undefined;
  image?: string | undefined;
  /** The link it plays (what its seasons, its episodes and this profile's rating of it are found by). */
  url?: string | undefined;
}

/**
 * The message that sends one (see `titleMessage`): its name, and its address with the episode, the time and the rating that were chosen to go with it. The
 * words are the same whatever goes with it: a page of before (or a report to the team) reads the name, and a page of now says the rest on the card.
 */
export const messageOf = (title: Pick<Sendable, "address" | "title" | "year">, origin: string, extras: TitleExtras = {}): string =>
  `${titleLabel(title)} ${origin}/tv?${TITLE_PARAM}=${title.address}${extrasQuery(extras)}`;

/** Whether the title an address names is a show (`tv-1399`): it can name an episode. */
export const isShowAddress = (address: string): boolean => address.startsWith("tv-");

/** The longest time a message can name (titleAddress.ts: as far as a player's start may go). */
export const TIME_MAX = 86_400;

/**
 * A time typed by hand into the send step (TitlePick.tsx): "1:02:10", "12:34", or minutes alone ("45"), in whole seconds; none for anything else, or past `max`.
 * "0" and "0:00" are the beginning.
 */
export function typedTime(text: string, max = TIME_MAX): number | undefined {
  const parts = /^\s*(\d{1,4})(?::(\d{2}))?(?::(\d{2}))?\s*$/.exec(text);
  if (!parts) return undefined;
  const first = Number(parts[1]);
  const second = parts[2] === undefined ? undefined : Number(parts[2]);
  const third = parts[3] === undefined ? undefined : Number(parts[3]);
  // (Minutes and seconds after a colon go up to 59; what comes first is as long as it is.)
  if ((second ?? 0) > 59 || (third ?? 0) > 59) return undefined;
  const seconds = third !== undefined ? first * 3600 + second! * 60 + third : second !== undefined ? first * 60 + second : first * 60;
  return seconds <= max ? seconds : undefined;
}

/** A time moved by some minutes, between the beginning and `max`. */
export const movedTime = (at: number, minutes: number, max: number): number => Math.max(0, Math.min(max, at + minutes * 60));

/** What the send step chose (TitlePick.tsx), as what goes in the address: an episode only of a show, a time only in a film or an episode, the score only when it is given. */
export function chosenExtras(choice: { show: boolean; episode: { season: number; episode: number } | null; at: number; score: number | undefined }): TitleExtras {
  const episode = choice.show ? choice.episode : null;
  const at = Math.floor(choice.at);
  return {
    ...(episode ? { season: episode.season, episode: episode.episode } : {}),
    ...(at > 0 && at <= TIME_MAX && (episode || !choice.show) ? { at } : {}),
    ...(choice.score !== undefined ? { score: choice.score } : {}),
  };
}

/** How many are offered: the newest, which are the ones a friend is told about. */
export const SENDABLE_MAX = 24;

/**
 * What the chat offers to send: what this profile watched (Continue watching and what it finished) and what it saved, in any list, the newest first, each
 * title once. A title without an address on the site (a link pasted on the phone) is left out: it would be a link nobody could open.
 */
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

/** Whether what the message says besides the address only names the title (then the card says it, and the words are not said twice). */
export const onlyNames = (rest: string, title: { title: string; year?: number | undefined }): boolean => {
  const said = rest.toLocaleLowerCase();
  return said === "" || said === titleLabel(title).toLocaleLowerCase() || said === title.title.toLocaleLowerCase();
};
