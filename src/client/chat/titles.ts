import { addressOf, TITLE_PARAM, titleIdOf } from "../shared/titleAddress";

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
    const id = titleIdOf(url.searchParams.get(TITLE_PARAM));
    if (!id) continue;
    const at = match.index ?? 0;
    // (What ended the sentence after the address, or opened a bracket around it, is not left standing alone: "Watch this: !", "(" of "(https://...).".)
    const rest = `${text.slice(0, at)} ${text.slice(at + link.length)}`
      .replace(/\s+/g, " ")
      .replace(/(^|\s)[([{«.,!?;:)\]}'"»]+(?=\s|$)/g, "")
      .trim();
    return { id, link, rest };
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
}

/** The message that sends one (see `titleMessage`). */
export const messageOf = (title: Sendable, origin: string): string => `${titleLabel(title)} ${origin}/tv?${TITLE_PARAM}=${title.address}`;

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
    out.push({ address, title: title.title, ...(title.year ? { year: title.year } : {}), ...(title.image ? { image: title.image } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** Whether what the message says besides the address only names the title (then the card says it, and the words are not said twice). */
export const onlyNames = (rest: string, title: { title: string; year?: number | undefined }): boolean => {
  const said = rest.toLocaleLowerCase();
  return said === "" || said === titleLabel(title).toLocaleLowerCase() || said === title.title.toLocaleLowerCase();
};
