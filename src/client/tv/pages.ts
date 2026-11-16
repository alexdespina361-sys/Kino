import { DEFAULT_LIST, forChildren, fractionOf, listOf, resumeAt, sectionOf, type AvatarId, type LibraryItem, type LibraryKind, type LibraryRow, type LibrarySection, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating, type Person } from "../../shared";
import { continueNote, listName, unfinished } from "../account/cards";
import { filterRatings, ownSection, type SectionOfRating } from "../account/ratingFilter";
import { ratingNote, ratingSummary, sortRatings } from "../account/ratingText";
import { getLanguage, rowTitle, t } from "../i18n";
import type { ChildGate } from "../shared/childGate";
import type { Because } from "../shared/recommend";
import { landscapeRows } from "../shared/shapes";
import { addressOf } from "../shared/titleAddress";
import type { GridSection } from "./browseNav";

/**
 * What the TV's library shows on each of its pages, worked out from the library's rows and from what this profile has watched
 * and saved. Pure, so what appears where can be tested without a screen; Browse.tsx draws it and walks it with the remote.
 */

/** What a friend's page shows: the lists they keep, or what they rated. */
export type FriendTab = "lists" | "ratings";

/** The page that is open. */
export type View =
  | { kind: "home" }
  | { kind: "movies" }
  | { kind: "series" }
  | { kind: "cartoons" }
  | { kind: "anime" }
  /** One of the lists (the first when none is named). */
  | { kind: "list"; list?: string }
  | { kind: "history" }
  /** The titles this profile gave a score, and the seasons it scored: all of them, or only one section's, or only those given one score (see ratingFilter.ts). */
  | { kind: "ratings"; section?: LibrarySection; score?: number }
  /** One category's titles; `from` is the list of every category when it was opened from there (Back goes back to it). */
  | { kind: "category"; rowId: string; from?: "categories" }
  /** Every category, or only those of one section (Movies, Series, Cartoons or Anime). */
  | { kind: "categories"; of?: LibrarySection }
  | { kind: "search" }
  /** The profile's own places: what it rated, its friends, what it watched, the settings (see profile.ts). */
  | { kind: "profile" }
  /** What friends sent and watch, and who they are (see friends/pages.ts). */
  | { kind: "friends" }
  /** One friend, with their lists (first) or their ratings. */
  | { kind: "friend"; id: string; tab?: FriendTab };

export const viewKey = (view: View): string =>
  view.kind === "category"
    ? `category:${view.rowId}`
    : view.kind === "categories"
      ? `categories:${view.of ?? "all"}`
      : view.kind === "friend"
        ? `friend:${view.id}:${view.tab ?? "lists"}`
        : view.kind === "list" && view.list && view.list !== DEFAULT_LIST
          ? `list:${view.list}`
          : view.kind;

/** The list a page of lists shows: the one it names, or the first when it names none or one that is gone. */
export const shownList = (view: View, lists: readonly ListInfo[]): ListInfo => lists.find((list) => view.kind === "list" && list.id === view.list) ?? lists[0] ?? { id: DEFAULT_LIST };

/** The pages made of a banner and rows of titles under it. */
export type RowsPage = "home" | "movies" | "series" | "cartoons" | "anime";
export const isRowsPage = (view: View): view is { kind: RowsPage } =>
  view.kind === "home" || view.kind === "movies" || view.kind === "series" || view.kind === "cartoons" || view.kind === "anime";

/** The section each page of a section is for. */
const SECTION_OF_PAGE: Readonly<Record<Exclude<RowsPage, "home">, LibrarySection>> = { movies: "movie", series: "series", cartoons: "cartoon", anime: "anime" };
/** What a page of rows is for: one section, or (Home) all of them. */
export const sectionOfPage = (page: RowsPage): LibrarySection | undefined => (page === "home" ? undefined : SECTION_OF_PAGE[page]);

/** A section as the person reads it: the name of its page. */
export const sectionName = (section: LibrarySection): string => t(section === "movie" ? "tv.movies" : section === "series" ? "tv.series" : section === "cartoon" ? "tv.cartoons" : "tv.anime");
/** The pages that have a banner and rows under it: those above, the profile's (profile.ts) and the friends' (whose rows come from friends/pages.ts). */
export const hasRows = (view: View): boolean => isRowsPage(view) || view.kind === "profile" || view.kind === "friends";

/** The pages that belong to the profile: the corner button that opens the first of them stands for them all, and Back from any but the first goes to the first. */
export const isProfilePage = (view: View): boolean => view.kind === "profile" || view.kind === "ratings" || view.kind === "history" || view.kind === "friends" || view.kind === "friend";

/**
 * The page Back goes to from this one, for the remote's Back key and for the button that says it: a category opened from the list of every category
 * goes back to that list, a friend's page to the friends', what the profile rated, its History and its friends to the profile's, and any other page
 * but Home to Home. Home is as far back as it goes (the menu is the next step), so it has none.
 */
export function backOf(view: View): View | null {
  switch (view.kind) {
    case "home":
      return null;
    case "category":
      return view.from === "categories" ? { kind: "categories" } : { kind: "home" };
    case "friend":
      return { kind: "friends" };
    case "ratings":
    case "history":
    case "friends":
      return { kind: "profile" };
    default:
      return { kind: "home" };
  }
}

/** How a row is laid out: wide tiles, a numbered ranking of posters, wide "continue" cards with a progress bar, or tiles of categories. */
export type Layout = "wide" | "continue" | "ranked" | "categories";

/** One thing the remote can land on in a row or a grid: a title (from the library, or from this profile's own rows), or a category. */
export interface Entry {
  id: string;
  title: string;
  /** What plays. Empty for something that opens a page. */
  url: string;
  /** The poster (upright) and a wide picture of the same. */
  image?: string;
  backdrop?: string;
  year?: number;
  description?: string;
  /** Where to pick up a title left unfinished. */
  startAt?: number;
  /** The episode to pick a show up at, when it is not the one `url` names. */
  resumeUrl?: string;
  /** 0..1, the thin bar across the picture of a title left unfinished. */
  progress?: number;
  /** A line under the title (the episode and what is left; how many titles a category has). */
  note?: string;
  /** Set on the cards of "Continue watching": what removes the card. */
  progressKey?: string;
  /** A film or a show, when it is known (a title saved in a list does not say). */
  kind?: LibraryKind;
  /** A cartoon or an anime, when the library says so: kept with a rating, which the ratings are filtered by. */
  section?: "cartoon" | "anime";
  /** For children, when the library says so (`LibraryItem.kids`): what a child's profile may open (see `forChildren`). */
  kids?: true;
  /** A category: opening it shows that page instead of playing. */
  opens?: View;
  /** Where a category's titles come from. */
  source?: string;
  /** What a friend sent: the item of the inbox that dismissing it takes away. */
  inboxId?: string;
  /** An invitation to a watch party: the 6-digit code that joins it. */
  party?: string;
  /** An invitation to a party that has ended: the friend whom pressing it asks to watch together instead. */
  ask?: string;
  /** A friend's request to watch together: the friend, whom pressing it starts a party for (and invites). */
  wants?: string;
  /** Somebody's request to be friends: pressing it asks whether to say yes. */
  request?: Person;
  /** A plan to watch together, or the news of one: the item of the inbox that pressing the tile asks about (to say yes or no to, or to read). */
  plan?: string;
  /** A friend who wrote and is not answered yet (a line of the bell): pressing it opens the chat with them. */
  chat?: string;
  /** A tile that opens a page over the library, instead of a title or a page of the library. */
  action?: "addFriend" | "friendSettings";
  /** A person's tile (a friend): the picture they chose, and whether they are online now. */
  avatar?: AvatarId;
  online?: boolean;
  /** Whether a Romanian dub is available. */
  hasRoDub?: boolean;
  /** A category's tile: the posters of its first few titles, which say what is in it better than a number would. */
  posters?: string[];
}

export interface HomeRow {
  id: string;
  layout: Layout;
  title: string;
  source?: string;
  /** The heading several rows stand under together (the friends page's "Waiting for you"): drawn once, over the first of them. */
  group?: string;
  /** A row of the library drawn as wide cards, a still of each title, instead of posters (see `landscapeRows`). Its layout stays "wide". */
  shape?: "landscape";
  entries: Entry[];
}

/** The titles of a grid page (a list, History, one category, the list of categories). */
export interface GridPage {
  title: string;
  /** The line under the title. */
  meta: string;
  /** A smaller line under that one: what the page cannot show and why (what a friend watches, when it is not told). */
  hint?: string;
  layout: Layout;
  entries: Entry[];
  /** The entries in sections, one under the other, each under a heading (a friend's lists): how many of the entries, from the first, each section takes. Without it, the entries are one grid. */
  sections?: GridSection[];
  /** What to say when there is nothing to show. */
  empty: string;
}

/** Everything the pages are made of. */
export interface PageData {
  /** The library's rows that have titles, as the page that is open lays them out: the first ones, then the ones brought after them as it is scrolled. */
  rows: readonly LibraryRow[];
  /** Every row the library has listed so far, each whole: a category opens any of them. */
  all: readonly LibraryRow[];
  /** This profile's cards, newest first. */
  progress: readonly LiveProgress[];
  /** The profile's lists, the first one always, and every title saved in any of them. */
  lists: readonly ListInfo[];
  list: readonly LiveListItem[];
  /** What this profile rated (nothing at all when it has turned ratings off). */
  ratings: readonly LiveRating[];
  /** "Because you watched ..." and "Because you loved ...": a title, and the titles like it. */
  because: readonly Because[];
  /** The sections the server gave for titles of "Continue watching" the rows do not list, by the title's address (`tv-46260`; see cardSections.ts). */
  looked?: ReadonlyMap<string, LibrarySection>;
  /**
   * A child's profile (the `child` setting): what it may see of its own cards (see childGate.ts). Its pages of rows are the Cartoons' (it has no other section),
   * with only the titles for children (`forChildren`), and its lists, History, ratings and categories show those only.
   */
  child?: ChildGate | undefined;
}

/** A title of this profile's own (a card, a saved title, a rating) as the child gate names it. */
const ownTitle = (card: { key: string; url: string; id?: string; kind?: LibraryKind | undefined }, show?: boolean) => ({ id: card.id ?? card.key, url: card.url, ...(show !== undefined ? { kind: show ? "series" : "movie" } : card.kind ? { kind: card.kind } : {}) });

/** The rows as a child's profile sees them: their titles for children only, and none of the rows left with nothing in them. Any other profile's are as they are. */
const rowsFor = (rows: readonly LibraryRow[], child: ChildGate | undefined): readonly LibraryRow[] =>
  child ? rows.map((row) => ({ ...row, items: row.items.filter((item) => forChildren(item, row)) })).filter((row) => row.items.length > 0) : rows;

export const entryOfItem = (item: LibraryItem): Entry => ({
  id: item.id,
  title: item.title,
  url: item.url,
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
  ...(item.description ? { description: item.description } : {}),
  ...(item.kind ? { kind: item.kind } : {}),
  ...(item.section === "cartoon" || item.section === "anime" ? { section: item.section } : {}),
  ...(item.hasRoDub !== undefined ? { hasRoDub: item.hasRoDub } : {}),
  ...(item.kids ? { kids: true as const } : {}),
});

export function entryOfProgress(card: LiveProgress): Entry {
  const startAt = resumeAt(card);
  const note = card.done ? t("card.watched") : continueNote(card);
  return {
    id: card.key,
    title: card.title,
    url: card.url,
    progressKey: card.key,
    progress: fractionOf(card),
    kind: isShowCard(card) ? "series" : "movie",
    ...(card.image ? { image: card.image } : {}),
    ...(card.backdrop ? { backdrop: card.backdrop } : {}),
    ...(card.year ? { year: card.year } : {}),
    ...(startAt !== undefined ? { startAt } : {}),
    ...(note ? { note } : {}),
  };
}

/** A link without the season and episode of its query (`s` and `e`), which are all that tells one episode of a show from another. */
function titleOf(link: string): string | undefined {
  try {
    const url = new URL(link);
    url.searchParams.delete("s");
    url.searchParams.delete("e");
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

/** Whether two links are one title's: a show's episodes differ in their season and episode only (films whose links differ in anything else are two). */
function sameTitle(a: string, b: string): boolean {
  const first = titleOf(a);
  return first !== undefined && first === titleOf(b);
}

/** The card this profile has for a title, if any (a film and a show can have the same number in a place's links, so the kind, when it is known, tells them apart). */
export const cardOf = (entry: Entry, progress: readonly LiveProgress[]): LiveProgress | undefined =>
  progress.find((card) => sameTitle(card.url, entry.url) && (entry.kind === undefined || isShowCard(card) === (entry.kind === "series")));

/**
 * A title part way through is picked up from wherever it is shown, not only from Continue watching: the entry as it plays from there.
 * A show whose last episode was finished goes on with the next one (its card points at it), from the start.
 */
export function resumable(entry: Entry, progress: readonly LiveProgress[]): Entry {
  if (entry.startAt !== undefined || entry.opens || !entry.url) return entry;
  const card = cardOf(entry, progress);
  if (!card || card.done) return entry;
  const startAt = resumeAt(card);
  if (startAt === undefined && card.url === entry.url) return entry;
  return { ...entry, resumeUrl: card.url, ...(startAt !== undefined ? { startAt } : {}) };
}

/** A title without what was known of how far it had got when it was opened: for opening its page again after more of it was watched (see `resumable`). */
export function asOpened(entry: Entry): Entry {
  const plain = { ...entry };
  delete plain.startAt;
  delete plain.resumeUrl;
  delete plain.progress;
  delete plain.note;
  return plain;
}

/** What this profile's watched episodes of a show are filed under: the name its card has (the show's, as the player gave it), else the title's own. */
export const showKeyOf = (entry: Entry, progress: readonly LiveProgress[]): string => cardOf(entry, progress)?.title ?? entry.title;

/** What Play does on a show's own page: the episode it leads to, and where in it. */
export interface Start {
  season: number;
  episode: number;
  url: string;
  /** Where the episode was left, when it was left part way. */
  startAt?: number;
}

/**
 * Where this profile is in a show: the episode it left off, or the one that the last finished episode pointed at; a show not
 * started begins with its first episode (which a title's own link plays). Nothing for what is not a show.
 */
export function startOf(entry: Entry, isShow: boolean, progress: readonly LiveProgress[]): Start | undefined {
  const card = cardOf(entry, progress);
  if (card?.season !== undefined && card.episode !== undefined) {
    const startAt = resumeAt(card);
    return { season: card.season, episode: card.episode, url: card.url, ...(startAt !== undefined ? { startAt } : {}) };
  }
  return isShow ? { season: 1, episode: 1, url: entry.url } : undefined;
}

export const entryOfSaved = (card: LiveListItem): Entry => ({
  id: card.key,
  title: card.title,
  url: card.url,
  ...(card.image ? { image: card.image } : {}),
  ...(card.backdrop ? { backdrop: card.backdrop } : {}),
  ...(card.year ? { year: card.year } : {}),
  ...(card.description ? { description: card.description } : {}),
});

/** A rated title (or season) as a card: what it plays is the title's own link, and the line under it is the score. */
export const entryOfRating = (rating: LiveRating): Entry => ({
  id: rating.key,
  title: rating.title,
  url: rating.url,
  ...(rating.image ? { image: rating.image } : {}),
  ...(rating.backdrop ? { backdrop: rating.backdrop } : {}),
  ...(rating.year ? { year: rating.year } : {}),
  ...(rating.kind ? { kind: rating.kind } : {}),
  ...(rating.section ? { section: rating.section } : {}),
  note: ratingNote(t, rating),
});

/** Where a row's titles come from, said only when the library has more than one source (with one, every title would carry the same word). */
const sourceOf = (rows: readonly LibraryRow[], row: LibraryRow): { source?: string } => (row.source && new Set(rows.map((each) => each.source)).size > 1 ? { source: row.source } : {});

/**
 * Whether a tile is a title (a film, a show): something that plays, and so is shown by its poster. A plan, an invitation, a request, a
 * page that opens: those are tiles of words, and stay wide.
 */
export const isTitle = (entry: Entry): boolean =>
  entry.url !== "" && !entry.opens && !entry.action && !entry.request && !entry.plan && !entry.party && !entry.ask && !entry.wants && !entry.chat;

/** A category's tile shows the posters of this many of its titles. */
const CATEGORY_POSTERS = 3;

/** How far into a category its picture is looked for, past the ones the categories before it have. */
const PICTURE_LOOK = 8;

/**
 * `withSection` says which section the category is in too (the list of every category, where they sit together), unless its name says it already
 * ("Trending Movies" is not "Trending Movies · Movies": the judge, 16 Nov). `used` is the pictures of the categories before it in the same list: each
 * takes the first of its titles' pictures that none of them has (most of the film categories had the same week's hit for theirs).
 */
const categoryEntry = (row: LibraryRow, rows: readonly LibraryRow[], withSection = false, used?: Set<string>): Entry => {
  const pictures = row.items.slice(0, PICTURE_LOOK).flatMap((item) => (item.backdrop ?? item.image ? [(item.backdrop ?? item.image)!] : []));
  const picture = pictures.find((one) => !used?.has(one)) ?? pictures[0];
  if (picture) used?.add(picture);
  const posters = row.items.flatMap((item) => (item.image ? [item.image] : [])).slice(0, CATEGORY_POSTERS);
  const section = sectionOf(row);
  const title = rowTitle(row);
  const place = withSection && section && !title.toLocaleLowerCase(getLanguage()).includes(sectionName(section).toLocaleLowerCase(getLanguage())) ? sectionName(section) : "";
  return {
    id: row.id,
    title,
    url: "",
    opens: { kind: "category", rowId: row.id },
    ...sourceOf(rows, row),
    // (No count of titles: a category goes on as it is scrolled, so the number was only what had come so far.)
    ...(place ? { note: place } : {}),
    ...(picture ? { image: picture } : {}),
    ...(posters.length > 0 ? { posters } : {}),
  };
};

/** The order every category is listed in: those of Movies, then of Series, Cartoons and Anime, then the others (each keeps the library's order). */
const SECTION_ORDER: ReadonlyArray<LibrarySection | undefined> = ["movie", "series", "cartoon", "anime", undefined];

/** A card of a show has an episode; a film's has none. */
const isShowCard = (card: LiveProgress) => card.season !== undefined;

/** A row of Home that is made of one of this profile's lists is named after it. */
const LIST_ROW = "list:";
export const listOfRow = (rowId: string): string | undefined => (rowId.startsWith(LIST_ROW) ? rowId.slice(LIST_ROW.length) : undefined);
/** ...and one of titles like a title the profile watched or loved. */
const BECAUSE_ROW = "because:";

/** The first row of a page is shown as a ranking of this many. */
const RANKED = 10;
/** The row of categories comes in after this many rows of titles, and shows this many tiles before "All categories". */
export const CATEGORIES_AFTER = 3;
export const CATEGORY_TILES = 12;

function categoriesRow(rows: readonly LibraryRow[], of: LibrarySection | undefined): HomeRow {
  const used = new Set<string>();
  const entries = rows.slice(0, CATEGORY_TILES).map((row) => categoryEntry(row, rows, false, used));
  if (rows.length > CATEGORY_TILES) entries.push({ id: "all-categories", title: t("tv.allCategories"), url: "", opens: { kind: "categories", ...(of ? { of } : {}) } });
  return { id: "categories", layout: "categories", title: t("tv.byCategory"), entries };
}

/** A title's link without what tells its episodes apart (the season and the episode, and the key a place adds to them), with whether it is a show: what a title of the library and a card for it have in common. */
function linkKey(link: string, isShow: boolean): string | undefined {
  try {
    const url = new URL(link);
    for (const name of ["s", "e", "key"]) url.searchParams.delete(name);
    return `${isShow ? "show" : "film"}|${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

/** Where a title of a row is browsed: the cartoon or anime it or its row says it is, else its kind, else its row's. */
const placeOf = (item: LibraryItem, row: LibraryRow): LibrarySection | undefined => item.section ?? row.section ?? item.kind ?? row.kind;

/** Where each title the library has listed is browsed, by its link (see `linkKey` and `placeOf`). */
function sectionsByLink(rows: readonly LibraryRow[]): Map<string, LibrarySection> {
  const out = new Map<string, LibrarySection>();
  for (const row of rows) {
    for (const item of row.items) {
      const section = placeOf(item, row);
      const key = linkKey(item.url, (item.kind ?? row.kind) === "series");
      if (section && key && !out.has(key)) out.set(key, section);
    }
  }
  return out;
}

/**
 * Where each rated title is browsed: what the rating says when it says it is a cartoon or an anime, else where the library lists it (a title rated before
 * ratings kept that), else its kind (see `ownSection`). A rating that does not say whether it is a show is looked for as a film and as a show.
 */
export function ratingSectionIn(rows: readonly LibraryRow[]): SectionOfRating {
  const known = sectionsByLink(rows);
  return (rating) => {
    if (rating.section) return rating.section;
    const keys = rating.kind ? [linkKey(rating.url, rating.kind === "series")] : [linkKey(rating.url, false), linkKey(rating.url, true)];
    for (const key of keys) {
      const section = key ? known.get(key) : undefined;
      if (section) return section;
    }
    return ownSection(rating);
  };
}

/**
 * The places whose titles are all cartoons, or all anime, by the place's address (a place of anime only): a title of theirs that no row lists is one too.
 * (Only those two: that every film listed so far comes from a place says nothing of what else it has.)
 */
function sectionsByHost(rows: readonly LibraryRow[]): Map<string, LibrarySection | null> {
  const out = new Map<string, LibrarySection | null>();
  for (const row of rows) {
    for (const item of row.items) {
      const section = placeOf(item, row);
      const host = hostOf(item.url);
      if (!host || !section) continue;
      const had = out.get(host);
      out.set(host, (had === undefined || had === section) && (section === "cartoon" || section === "anime") ? section : null);
    }
  }
  return out;
}

function hostOf(link: string): string | undefined {
  try {
    return new URL(link).host;
  } catch {
    return undefined;
  }
}

/** The address a card's title is asked for by (`tv-46260`), when its link is one the server knows titles by. */
export const addressOfCard = (card: LiveProgress): string | null => addressOf({ id: card.key, url: card.url, ...(isShowCard(card) ? { kind: "series" } : {}) });

interface CardPlaces {
  /** Where the rows list each title, by its link. */
  known: ReadonlyMap<string, LibrarySection>;
  /** The section of a place whose titles are all in one. */
  hosts: ReadonlyMap<string, LibrarySection | null>;
  /** What the server said of the titles the rows did not list. */
  looked: ReadonlyMap<string, LibrarySection> | undefined;
}

/**
 * The section a card of "Continue watching" belongs to: where the library lists its title; else what the server said of it (asked once: see
 * cardSections.ts); else the one section of the place it plays from; else its kind's. (A card says only whether it is of a show: an anime the rows
 * loaded so far did not list used to be put in Series - the owner's report of 15 Nov.)
 */
const sectionOfCard = (card: LiveProgress, places: CardPlaces): LibrarySection => {
  const show = isShowCard(card);
  const key = linkKey(card.url, show);
  const listed = key ? places.known.get(key) : undefined;
  if (listed) return listed;
  const address = addressOfCard(card);
  const looked = address ? places.looked?.get(address) : undefined;
  if (looked) return looked;
  const host = hostOf(card.url);
  return (host && places.hosts.get(host)) || (show ? "series" : "movie");
};

/**
 * The addresses of the cards of "Continue watching" whose section is not known from the rows, nor from what was asked before, nor from the place they
 * play from: the ones to ask the server about.
 */
export function cardsToLookUp(progress: readonly LiveProgress[], rows: readonly LibraryRow[], looked: ReadonlyMap<string, LibrarySection>): string[] {
  const known = sectionsByLink(rows);
  const hosts = sectionsByHost(rows);
  const out = new Set<string>();
  for (const card of unfinished(progress)) {
    const key = linkKey(card.url, isShowCard(card));
    if (key && known.has(key)) continue;
    const host = hostOf(card.url);
    if (host && hosts.get(host)) continue;
    const address = addressOfCard(card);
    if (address && !looked.has(address)) out.add(address);
  }
  return [...out];
}

/**
 * The rows under the banner. Home has what this profile is part way through, titles like the ones it watched last or loved, a row for each of
 * its lists that has a title in it, then the library's rows with a row of categories among them. Movies, Series, Cartoons and Anime have the library's
 * rows of their section, and what is part way through of it.
 */
export function rowsOfPage(page: RowsPage, data: PageData): HomeRow[] {
  const { child } = data;
  // (A child's profile has the Cartoons on every page of rows, Home too: it has no other section.)
  const section = child ? "cartoon" : sectionOfPage(page);
  const out: HomeRow[] = [];

  // (Only the page of a section has to tell the cards apart.)
  const places: CardPlaces | undefined = section ? { known: sectionsByLink(data.all), hosts: sectionsByHost(data.all), looked: data.looked } : undefined;
  // (A child's profile's cards are its gate's to say: what it lets through is a cartoon for children, wherever the library lists it.)
  const going = unfinished(data.progress).filter((card) => (child ? child.allows(ownTitle(card, isShowCard(card))) : !places || sectionOfCard(card, places) === section));
  if (going.length > 0) out.push({ id: "continue", layout: "continue", title: t("rows.continue"), entries: going.map(entryOfProgress) });
  if (!section) {
    for (const like of data.because) {
      if (like.items.length > 0) out.push({ id: `${BECAUSE_ROW}${like.key}`, layout: "wide", title: t(like.why === "loved" ? "rows.loved" : "rows.because", { title: like.title }), entries: like.items.map(entryOfItem) });
    }
  }
  if (!section) {
    for (const info of data.lists) {
      const saved = data.list.filter((item) => listOf(item) === info.id);
      if (saved.length > 0) out.push({ id: `${LIST_ROW}${info.id}`, layout: "wide", title: listName(info), entries: saved.map(entryOfSaved) });
    }
  }

  const library = rowsFor(section ? data.rows.filter((row) => sectionOf(row) === section) : data.rows, child);
  // (Some of them are wide cards, so that a page is not one size of poster from top to bottom: see `landscapeRows`.)
  const wide = landscapeRows(library);
  library.forEach((row, index) => {
    out.push({
      id: row.id,
      layout: index === 0 ? "ranked" : "wide",
      title: rowTitle(row),
      ...sourceOf(data.rows, row),
      ...(wide.has(row.id) ? { shape: "landscape" as const } : {}),
      entries: (index === 0 ? row.items.slice(0, RANKED) : row.items).map(entryOfItem),
    });
    if (index === CATEGORIES_AFTER - 1 && library.length > CATEGORIES_AFTER + 1) out.push(categoriesRow(library, section));
  });
  return out;
}

/** The pages that are one grid. Null for the others, and for a category the library no longer has. */
export function gridOf(view: View, data: PageData): GridPage | null {
  const { child } = data;
  // (A child's profile sees only what is for children of what it saved, watched and rated, and of the library only the Cartoons: see `PageData.child`.)
  const progress = child ? data.progress.filter((card) => child.allows(ownTitle(card, isShowCard(card)))) : data.progress;
  const all = rowsFor(child ? data.all.filter((row) => sectionOf(row) === "cartoon") : data.all, child);
  switch (view.kind) {
    case "list": {
      const info = shownList(view, data.lists);
      const saved = data.list.filter((item) => listOf(item) === info.id && (!child || child.allows(ownTitle(item))));
      return { title: listName(info), meta: t("tv.titles", { count: saved.length }), layout: "wide", entries: saved.map(entryOfSaved), empty: t("tv.listEmpty") };
    }
    case "history":
      return { title: t("tv.history"), meta: t("tv.historyHelp"), layout: "wide", entries: progress.map(entryOfProgress), empty: t("tv.historyEmpty") };
    case "ratings": {
      // (What the filter keeps: the line under the title is about those, the count and the average of what is shown.)
      const shown = filterRatings(child ? data.ratings.filter((rating) => child.allows(ownTitle(rating))) : data.ratings, view, ratingSectionIn(data.all));
      return { title: t("rating.mine"), meta: ratingSummary(t, getLanguage(), shown) || t("rating.mineHelp"), layout: "wide", entries: sortRatings(shown, "new").map(entryOfRating), empty: t("rating.empty") };
    }
    case "category": {
      const row = all.find((candidate) => candidate.id === view.rowId);
      // (Under its name, the section it is in, as its tile says it: not the catalog's name, "Filmpire" - the judge, 16 Nov.)
      return row ? { title: rowTitle(row), meta: categoryEntry(row, all, true).note ?? "", layout: "wide", entries: row.items.map(entryOfItem), empty: "" } : null;
    }
    case "categories": {
      const of = child ? "cartoon" : view.of;
      const rows = all.filter((row) => !of || sectionOf(row) === of);
      const title = of === "movie" ? t("tv.movieCategories") : of === "series" ? t("tv.seriesCategories") : of === "cartoon" ? t("tv.cartoonCategories") : of === "anime" ? t("tv.animeCategories") : t("tv.allCategories");
      const ordered = of ? rows : SECTION_ORDER.flatMap((section) => rows.filter((row) => sectionOf(row) === section));
      const used = new Set<string>();
      return { title, meta: "", layout: "categories", entries: ordered.map((row) => categoryEntry(row, all, !of, used)), empty: "" };
    }
    default:
      return null;
  }
}

/** The titles like the last one watched that are not already started or saved. */
export function freshSimilar(items: readonly LibraryItem[], progress: readonly LiveProgress[], list: readonly LiveListItem[]): LibraryItem[] {
  const known = new Set([...progress, ...list].map((each) => each.title.toLowerCase()));
  return items.filter((item) => !known.has(item.title.toLowerCase()));
}

/** What the buttons under the banner can do for a title. */
export type HeroAction = "play" | "tv" | "list" | "lists" | "remove" | "rate" | "recommend" | "dismiss" | "join" | "ask" | "start";
export const heroActions = (entry: Entry | undefined): HeroAction[] => {
  if (!entry || entry.opens || entry.action || entry.request || entry.plan) return []; // (somebody who asks to be friends, or a plan to watch together, is no film: pressing the tile answers)
  if (entry.party) return ["join", "dismiss"]; // an invitation to a watch party
  if (entry.ask) return ["ask", "dismiss"]; // ...one that has ended: the friend can be asked for another
  if (entry.wants) return ["start", "dismiss"]; // a friend asks for a party
  if (entry.progressKey) return ["play", "remove"];
  return entry.inboxId ? ["play", "list", "dismiss"] : ["play", "list"]; // (what a friend sent can be sent away)
};
/**
 * ...and on a title's own page, which any title can be kept from: play it (or pick it up), on a phone or a tablet play it on the TV instead
 * (`onTv`), keep it in a list, give it a score (unless ratings are turned off), send it to a friend (when friends are on), and for one part
 * way through, take it off its row (as one a friend sent is taken off theirs). With several lists (`several`), "list" is one tap for the main list
 * and "lists" ("Other lists") opens the picker; it is there whatever lists the title is in, so that nothing moves when one is tapped.
 */
export const overviewActions = (entry: Entry, ratings = true, friends = false, onTv = false, several = false): HeroAction[] => [
  "play",
  ...(onTv && entry.url ? (["tv"] as const) : []),
  "list",
  ...(several ? (["lists"] as const) : []),
  ...(ratings ? (["rate"] as const) : []),
  ...(friends && entry.url ? (["recommend"] as const) : []),
  ...(entry.progressKey ? (["remove"] as const) : []),
  ...(entry.inboxId ? (["dismiss"] as const) : []),
];

/** Which titles a search shows: all, or those of one section. */
export type SectionFilter = "all" | LibrarySection;
export const SECTION_FILTERS: readonly SectionFilter[] = ["all", "movie", "series", "cartoon", "anime"];
export const ofSection = (items: readonly LibraryItem[], filter: SectionFilter): LibraryItem[] => (filter === "all" ? [...items] : items.filter((item) => sectionOf(item) === filter));
