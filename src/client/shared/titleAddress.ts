import { z } from "zod";
import { LibraryItemSchema, type LibraryItem } from "../../shared";

/**
 * A title's own address: while a title's page is open the address bar says which title it is (`/tv?title=movie-603`), so the link can be copied and sent,
 * and opening it opens that page (on any device: it is a link for a screen that plays, as a watch party's is). Only the address of the entry the page stands on
 * is changed (`replaceState`): no entry is added to the history, so what Back does is as it was.
 */

/** The question of the address that names a title. */
export const TITLE_PARAM = "title";

/**
 * What an address can ask for besides the title (the owner, 17 Nov: "a specific episode for series/animes, showing the rating given, including a timed send"):
 * `/tv?title=tv-1399&s=2&e=5&t=754&r=8` is episode 5 of season 2, from 12:34, and the one who sent it gave the show 8 out of 10. Anything odd in them (they can
 * be typed by hand) is as if it were not there: the title's page opens as it always did.
 */
export interface TitleExtras {
  /** An episode of a show: both or neither. */
  season?: number;
  episode?: number;
  /** Where to start, in whole seconds: in a film, or in the episode (of a whole show it says nothing). */
  at?: number;
  /** The rating the writer of a chat's message gave the title (1..10): what they say of it, shown with their name; a link opened from elsewhere has no writer, and none. */
  score?: number;
}

/** What a title's page is opened with from a link or a chat's card: the episode and the time (the rating is only said, on the card). */
export type TitleOpening = Omit<TitleExtras, "score">;

/** The questions of the address that carry `TitleExtras`, and how far each goes (the time as far as a player's start may: protocol.ts `StartAtSchema`). */
const EXTRA_PARAMS = [
  ["season", "s", 1, 200],
  ["episode", "e", 1, 5000],
  ["at", "t", 1, 86_400],
  ["score", "r", 1, 10],
] as const;

const wholeIn = (value: string | null, min: number, max: number): number | undefined => {
  if (value === null || !/^\d{1,6}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
};

/** What the questions of an address ask for besides the title (`address`: the title's, `tv-1399`, which says whether it is a show). */
export function extrasOf(params: URLSearchParams, address: string | null): TitleExtras {
  const found: TitleExtras = {};
  for (const [name, param, min, max] of EXTRA_PARAMS) {
    const n = wholeIn(params.get(param), min, max);
    if (n !== undefined) found[name] = n;
  }
  const show = address?.startsWith("tv-") ?? false;
  const episode = show && found.season !== undefined && found.episode !== undefined;
  return {
    ...(episode ? { season: found.season, episode: found.episode } : {}),
    // (A time is in a film, or in one episode: in a whole show it is in nothing.)
    ...(found.at !== undefined && (episode || !show) ? { at: found.at } : {}),
    ...(found.score !== undefined ? { score: found.score } : {}),
  };
}

/** The questions that carry them, to go after the title's (`&s=2&e=5&t=754&r=8`): only what is there. */
export function extrasQuery(extras: TitleExtras): string {
  return EXTRA_PARAMS.map(([name, param]) => (extras[name] !== undefined ? `&${param}=${extras[name]}` : "")).join("");
}

/** Whether they ask for anything. */
export const asksAnything = (extras: TitleExtras | undefined): boolean => extras !== undefined && EXTRA_PARAMS.some(([name]) => extras[name] !== undefined);

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

/**
 * What a link asks for: none (`null`) when the address has no title in it, else the library's id of the one it names - `id: null` for one that names nothing
 * (`?title=x`) - and the episode and the time it asks for (never a rating: a link opened from elsewhere has nobody's name to show it with).
 */
export type TitleAsk = { id: string | null; extras: TitleExtras } | null;

/** What the address of this page asks for (see `TitleAsk`). */
export function titleAsk(search: string = typeof location === "undefined" ? "" : location.search): TitleAsk {
  const params = new URLSearchParams(search);
  if (!params.has(TITLE_PARAM)) return null;
  const { score: _score, ...extras } = extrasOf(params, params.get(TITLE_PARAM));
  return { id: titleIdOf(params.get(TITLE_PARAM)), extras };
}

/** The link the site was opened with: what it asked for (read from the address once, when the library was first drawn), whether it has been dealt with, and the server's answer. */
let link: { ask: TitleAsk; done: boolean; item?: Promise<LibraryItem | null> } | undefined;

/**
 * The title a link opened the site with (see `TitleAsk`), with the server's answer about it: until it has been dealt with (`dropLink`), and nothing after that.
 * The library is drawn again after every film, and by then the address may still name a title whose page a film was started from: that is not a link anybody
 * opened, and its page must not open again (it did, over and over, after other titles had played: the owner's report of 15 Nov). Until it is dealt with, a
 * library drawn again has the same link and the same answer: the server is asked once (a library drawn twice before the answer came lost the link, and its
 * page never opened - seen in the tests, 16 Nov).
 */
export function pendingLink(search?: string): { id: string | null; extras: TitleExtras; item: Promise<LibraryItem | null> } | null {
  link ??= { ask: titleAsk(search), done: false };
  if (link.done || !link.ask) return null;
  const { id, extras } = link.ask;
  link.item ??= id ? fetchTitle(id) : Promise.resolve(null);
  return { id, extras, item: link.item };
}

/** The link has been dealt with: its page was opened, or Home said it names nothing, or the viewer went somewhere else before the answer came. */
export function dropLink(): void {
  if (link) link.done = true;
  else link = { ask: null, done: true };
}

/**
 * The address with this title in it (none: without one), everything else in it as it was - but the episode, the time and the rating a link asked for, which
 * were of the title it named and would be carried on to the next one.
 */
export function withTitle(href: string, address: string | null): string {
  const url = new URL(href);
  for (const [, param] of EXTRA_PARAMS) url.searchParams.delete(param);
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

/** A title by its id, from the server: none (`null`) when nobody knows it or it would not play, and no answer (`undefined`) when the server could not be asked or would not say (too many asks, a place that could not be reached). */
export async function askTitle(id: string): Promise<LibraryItem | null | undefined> {
  try {
    const res = await fetch(`/api/library/title?id=${encodeURIComponent(id)}`);
    if (!res.ok) return res.status === 400 ? null : undefined;
    const parsed = TitleAnswerSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.item : undefined;
  } catch {
    return undefined;
  }
}

/** The title of a link, from the server: none when nobody knows it, it would not play, or the server could not be asked. */
export const fetchTitle = async (id: string): Promise<LibraryItem | null> => (await askTitle(id)) ?? null;
