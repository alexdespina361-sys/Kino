import { z } from "zod";
import { LibraryItemSchema, type LibraryItem } from "../../shared";

/**
 * A title's own address: while a title's page is open the address bar says which title it is (`/tv?title=movie-603`), so the link can be copied and sent,
 * and opening it opens that page (on any device: it is a link for a screen that plays, as a watch party's is). Only the address of the entry the page stands on
 * is changed (`replaceState`): no entry is added to the history, so what Back does is as it was.
 */

/** The question of the address that names a title. */
export const TITLE_PARAM = "title";

/** The ids the library gives its titles (`filmpire-movie-603`, `filmpire-tv-1399`) and the short names an address carries (`movie-603`, `tv-1399`). */
const OWN_ID = /^filmpire-(movie|tv)-(\d{1,10})$/;
const ADDRESS = /^(movie|tv)-(\d{1,10})$/;

/**
 * What the address says of a title: `movie-603` for the tile `filmpire-movie-603`. A card of a list, of Continue watching or of a rating has a key of its own,
 * and is named from the link it plays (`/watch/603`, a show's with its season and episode). None for anything else: a link pasted on the phone, a category.
 */
export function addressOf(entry: { id: string; url: string; kind?: string }): string | null {
  const own = OWN_ID.exec(entry.id);
  if (own) return `${own[1]}-${own[2]}`;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }
  const watch = /^\/watch\/(\d{1,10})$/.exec(url.pathname);
  if (!watch) return null;
  const show = entry.kind === "series" || url.searchParams.has("s") || url.searchParams.has("e");
  return `${show ? "tv" : "movie"}-${watch[1]}`;
}

/** The library's id of the title an address names (none for one that names nothing). */
export function titleIdOf(address: string | null | undefined): string | null {
  const named = address ? ADDRESS.exec(address) : null;
  return named ? `filmpire-${named[1]}-${named[2]}` : null;
}

/** The title the address of this page names, if any. */
export const linkedTitle = (search: string = typeof location === "undefined" ? "" : location.search): string | null => titleIdOf(new URLSearchParams(search).get(TITLE_PARAM));

let linkTaken = false;
/**
 * The title a link opened the site with: once, for the first library drawn after the page loads, and nothing after that. The library is drawn again after every
 * film, and by then the address may still name a title whose page a film was started from: that is not a link anybody opened, and its page must not open again
 * (it did, over and over, after other titles had played: the owner's report of 15 Nov).
 */
export function takeLinkedTitle(search?: string): string | null {
  if (linkTaken) return null;
  linkTaken = true;
  return linkedTitle(search);
}

/** The address with this title in it (none: without one), everything else in it as it was. */
export function withTitle(href: string, address: string | null): string {
  const url = new URL(href);
  if (address) url.searchParams.set(TITLE_PARAM, address);
  else url.searchParams.delete(TITLE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Puts the title in the address of this page, or takes it out: the entry the page stands on keeps what it was given (see backButton.ts). */
export function showTitle(address: string | null): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  if (new URLSearchParams(location.search).get(TITLE_PARAM) === address) return;
  history.replaceState(history.state, "", withTitle(location.href, address));
}

const TitleAnswerSchema = z.object({ item: LibraryItemSchema.nullable() });

/** The title of a link, from the server: none when nobody knows it, it would not play, or the server could not be asked. */
export async function fetchTitle(id: string): Promise<LibraryItem | null> {
  try {
    const res = await fetch(`/api/library/title?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const parsed = TitleAnswerSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.item : null;
  } catch {
    return null;
  }
}
