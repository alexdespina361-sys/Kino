import { DEFAULT_LIST, fractionOf, listOf, resumeAt, type LibraryItem, type LibraryKind, type LibraryRow, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { continueNote, listName, unfinished } from "../account/cards";
import { ratingNote, ratingSummary, sortRatings } from "../account/ratingText";
import { getLanguage, rowTitle, t } from "../i18n";

/**
 * What the TV's library shows on each of its pages, worked out from the library's rows and from what this profile has watched
 * and saved. Pure, so what appears where can be tested without a screen; Browse.tsx draws it and walks it with the remote.
 */

/** The page that is open. */
export type View =
  | { kind: "home" }
  | { kind: "movies" }
  | { kind: "series" }
  /** One of the lists (the first when none is named). */
  | { kind: "list"; list?: string }
  | { kind: "history" }
  /** The titles this profile gave a score, and the seasons it scored. */
  | { kind: "ratings" }
  | { kind: "category"; rowId: string }
  /** Every category, or only those of films or of shows. */
  | { kind: "categories"; of?: LibraryKind }
  | { kind: "search" };

export const viewKey = (view: View): string =>
  view.kind === "category"
    ? `category:${view.rowId}`
    : view.kind === "categories"
      ? `categories:${view.of ?? "all"}`
      : view.kind === "list" && view.list && view.list !== DEFAULT_LIST
        ? `list:${view.list}`
        : view.kind;

/** The list a page of lists shows: the one it names, or the first when it names none or one that is gone. */
export const shownList = (view: View, lists: readonly ListInfo[]): ListInfo => lists.find((list) => view.kind === "list" && list.id === view.list) ?? lists[0] ?? { id: DEFAULT_LIST };

/** The pages made of a banner and rows of titles under it. */
export type RowsPage = "home" | "movies" | "series";
export const isRowsPage = (view: View): view is { kind: RowsPage } => view.kind === "home" || view.kind === "movies" || view.kind === "series";

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
  /** A category: opening it shows that page instead of playing. */
  opens?: View;
  /** Where a category's titles come from. */
  source?: string;
}

export interface HomeRow {
  id: string;
  layout: Layout;
  title: string;
  source?: string;
  entries: Entry[];
}

/** The titles of a grid page (a list, History, one category, the list of categories). */
export interface GridPage {
  title: string;
  /** The line under the title. */
  meta: string;
  layout: Layout;
  entries: Entry[];
  /** What to say when there is nothing to show. */
  empty: string;
}

/** Everything the pages are made of. */
export interface PageData {
  /** The library's rows that have titles. */
  rows: readonly LibraryRow[];
  /** This profile's cards, newest first. */
  progress: readonly LiveProgress[];
  /** The profile's lists, the first one always, and every title saved in any of them. */
  lists: readonly ListInfo[];
  list: readonly LiveListItem[];
  /** What this profile rated (nothing at all when it has turned ratings off). */
  ratings: readonly LiveRating[];
  /** "Because you watched ...": the title, and the titles like it. */
  similar: { title: string; items: readonly LibraryItem[] } | null;
}

export const entryOfItem = (item: LibraryItem): Entry => ({
  id: item.id,
  title: item.title,
  url: item.url,
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year ? { year: item.year } : {}),
  ...(item.description ? { description: item.description } : {}),
  ...(item.kind ? { kind: item.kind } : {}),
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
  note: ratingNote(t, rating),
});

/** Where a row's titles come from, said only when the library has more than one source (with one, every title would carry the same word). */
const sourceOf = (rows: readonly LibraryRow[], row: LibraryRow): { source?: string } => (row.source && new Set(rows.map((each) => each.source)).size > 1 ? { source: row.source } : {});

const categoryEntry = (row: LibraryRow, rows: readonly LibraryRow[]): Entry => {
  const first = row.items[0];
  const picture = first?.backdrop ?? first?.image;
  return { id: row.id, title: rowTitle(row), url: "", opens: { kind: "category", rowId: row.id }, ...sourceOf(rows, row), note: t("tv.titles", { count: row.items.length }), ...(picture ? { image: picture } : {}) };
};

/** A card of a show has an episode; a film's has none. */
const isShowCard = (card: LiveProgress) => card.season !== undefined;

/** A row of Home that is made of one of this profile's lists is named after it. */
const LIST_ROW = "list:";
export const listOfRow = (rowId: string): string | undefined => (rowId.startsWith(LIST_ROW) ? rowId.slice(LIST_ROW.length) : undefined);

/** The first row of a page is shown as a ranking of this many. */
const RANKED = 10;
/** The row of categories comes in after this many rows of titles, and shows this many tiles before "All categories". */
const CATEGORIES_AFTER = 3;
const CATEGORY_TILES = 12;

function categoriesRow(rows: readonly LibraryRow[], of: LibraryKind | undefined): HomeRow {
  const entries = rows.slice(0, CATEGORY_TILES).map((row) => categoryEntry(row, rows));
  if (rows.length > CATEGORY_TILES) entries.push({ id: "all-categories", title: t("tv.allCategories"), url: "", opens: { kind: "categories", ...(of ? { of } : {}) }, note: t("tv.titles", { count: rows.length }) });
  return { id: "categories", layout: "categories", title: t("tv.byCategory"), entries };
}

/**
 * The rows under the banner. Home has what this profile is part way through, titles like the last one it watched, a row for each of
 * its lists that has a title in it, then the library's rows with a row of categories among them. Movies and Series have the library's rows of that kind, and what is
 * part way through of that kind.
 */
export function rowsOfPage(page: RowsPage, data: PageData): HomeRow[] {
  const kind: LibraryKind | undefined = page === "movies" ? "movie" : page === "series" ? "series" : undefined;
  const out: HomeRow[] = [];

  const going = unfinished(data.progress).filter((card) => !kind || isShowCard(card) === (kind === "series"));
  if (going.length > 0) out.push({ id: "continue", layout: "continue", title: t("rows.continue"), entries: going.map(entryOfProgress) });
  if (!kind && data.similar && data.similar.items.length > 0) out.push({ id: "similar", layout: "wide", title: t("rows.because", { title: data.similar.title }), entries: data.similar.items.map(entryOfItem) });
  if (!kind) {
    for (const info of data.lists) {
      const saved = data.list.filter((item) => listOf(item) === info.id);
      if (saved.length > 0) out.push({ id: `${LIST_ROW}${info.id}`, layout: "wide", title: listName(info), entries: saved.map(entryOfSaved) });
    }
  }

  const library = kind ? data.rows.filter((row) => row.kind === kind) : data.rows;
  library.forEach((row, index) => {
    out.push({ id: row.id, layout: index === 0 ? "ranked" : "wide", title: rowTitle(row), ...sourceOf(data.rows, row), entries: (index === 0 ? row.items.slice(0, RANKED) : row.items).map(entryOfItem) });
    if (index === CATEGORIES_AFTER - 1 && library.length > CATEGORIES_AFTER + 1) out.push(categoriesRow(library, kind));
  });
  return out;
}

/** The pages that are one grid. Null for the others, and for a category the library no longer has. */
export function gridOf(view: View, data: PageData): GridPage | null {
  switch (view.kind) {
    case "list": {
      const info = shownList(view, data.lists);
      const saved = data.list.filter((item) => listOf(item) === info.id);
      return { title: listName(info), meta: t("tv.titles", { count: saved.length }), layout: "wide", entries: saved.map(entryOfSaved), empty: t("tv.listEmpty") };
    }
    case "history":
      return { title: t("tv.history"), meta: t("tv.historyHelp"), layout: "wide", entries: data.progress.map(entryOfProgress), empty: t("tv.historyEmpty") };
    case "ratings":
      return { title: t("rating.mine"), meta: ratingSummary(t, getLanguage(), data.ratings) || t("rating.mineHelp"), layout: "wide", entries: sortRatings(data.ratings, "new").map(entryOfRating), empty: t("rating.empty") };
    case "category": {
      const row = data.rows.find((candidate) => candidate.id === view.rowId);
      return row ? { title: rowTitle(row), meta: [t("tv.titles", { count: row.items.length }), sourceOf(data.rows, row).source].filter(Boolean).join(" · "), layout: "wide", entries: row.items.map(entryOfItem), empty: "" } : null;
    }
    case "categories": {
      const rows = data.rows.filter((row) => !view.of || row.kind === view.of);
      const title = view.of === "movie" ? t("tv.movieCategories") : view.of === "series" ? t("tv.seriesCategories") : t("tv.allCategories");
      return { title, meta: "", layout: "categories", entries: rows.map((row) => categoryEntry(row, data.rows)), empty: "" };
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
export type HeroAction = "play" | "list" | "remove" | "rate";
export const heroActions = (entry: Entry | undefined): HeroAction[] => (!entry || entry.opens ? [] : entry.progressKey ? ["play", "remove"] : ["play", "list"]);
/**
 * ...and on a title's own page, which any title can be kept from: play it (or pick it up), keep it in a list, give it a score (unless
 * ratings are turned off), and for one part way through, take it off its row.
 */
export const overviewActions = (entry: Entry, ratings = true): HeroAction[] => [
  "play",
  "list",
  ...(ratings ? (["rate"] as const) : []),
  ...(entry.progressKey ? (["remove"] as const) : []),
];

/** Which titles a search shows. */
export type KindFilter = "all" | LibraryKind;
export const KIND_FILTERS: readonly KindFilter[] = ["all", "movie", "series"];
export const ofKind = (items: readonly LibraryItem[], filter: KindFilter): LibraryItem[] => (filter === "all" ? [...items] : items.filter((item) => item.kind === filter));
