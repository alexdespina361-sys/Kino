import { fractionOf, resumeAt, type LibraryItem, type LibraryKind, type LibraryRow, type LiveListItem, type LiveProgress } from "../../shared";
import { continueNote, unfinished } from "../account/cards";
import { t } from "../i18n";

/**
 * What the TV's library shows on each of its pages, worked out from the library's rows and from what this profile has watched
 * and saved. Pure, so what appears where can be tested without a screen; Browse.tsx draws it and walks it with the remote.
 */

/** The page that is open. */
export type View =
  | { kind: "home" }
  | { kind: "movies" }
  | { kind: "series" }
  | { kind: "list" }
  | { kind: "history" }
  | { kind: "category"; rowId: string }
  /** Every category, or only those of films or of shows. */
  | { kind: "categories"; of?: LibraryKind }
  | { kind: "search" };

export const viewKey = (view: View): string =>
  view.kind === "category" ? `category:${view.rowId}` : view.kind === "categories" ? `categories:${view.of ?? "all"}` : view.kind;

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
  /** 0..1, the thin bar across the picture of a title left unfinished. */
  progress?: number;
  /** A line under the title (the episode and what is left; how many titles a category has). */
  note?: string;
  /** Set on the cards of "Continue watching": what removes the card. */
  progressKey?: string;
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

/** The titles of a grid page (My List, History, one category, the list of categories). */
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
  list: readonly LiveListItem[];
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
    ...(card.image ? { image: card.image } : {}),
    ...(card.backdrop ? { backdrop: card.backdrop } : {}),
    ...(card.year ? { year: card.year } : {}),
    ...(startAt !== undefined ? { startAt } : {}),
    ...(note ? { note } : {}),
  };
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

const categoryEntry = (row: LibraryRow): Entry => {
  const first = row.items[0];
  const picture = first?.backdrop ?? first?.image;
  return { id: row.id, title: row.title, url: "", opens: { kind: "category", rowId: row.id }, source: row.source, note: t("tv.titles", { count: row.items.length }), ...(picture ? { image: picture } : {}) };
};

/** A card of a show has an episode; a film's has none. */
const isShowCard = (card: LiveProgress) => card.season !== undefined;

/** The first row of a page is shown as a ranking of this many. */
const RANKED = 10;
/** The row of categories comes in after this many rows of titles, and shows this many tiles before "All categories". */
const CATEGORIES_AFTER = 3;
const CATEGORY_TILES = 12;

function categoriesRow(rows: readonly LibraryRow[], of: LibraryKind | undefined): HomeRow {
  const entries = rows.slice(0, CATEGORY_TILES).map(categoryEntry);
  if (rows.length > CATEGORY_TILES) entries.push({ id: "all-categories", title: t("tv.allCategories"), url: "", opens: { kind: "categories", ...(of ? { of } : {}) }, note: t("tv.titles", { count: rows.length }) });
  return { id: "categories", layout: "categories", title: t("tv.byCategory"), entries };
}

/**
 * The rows under the banner. Home has what this profile is part way through, titles like the last one it watched, its list, then
 * the library's rows with a row of categories among them. Movies and Series have the library's rows of that kind, and what is
 * part way through of that kind.
 */
export function rowsOfPage(page: RowsPage, data: PageData): HomeRow[] {
  const kind: LibraryKind | undefined = page === "movies" ? "movie" : page === "series" ? "series" : undefined;
  const out: HomeRow[] = [];

  const going = unfinished(data.progress).filter((card) => !kind || isShowCard(card) === (kind === "series"));
  if (going.length > 0) out.push({ id: "continue", layout: "continue", title: t("rows.continue"), entries: going.map(entryOfProgress) });
  if (!kind && data.similar && data.similar.items.length > 0) out.push({ id: "similar", layout: "wide", title: t("rows.because", { title: data.similar.title }), entries: data.similar.items.map(entryOfItem) });
  if (!kind && data.list.length > 0) out.push({ id: "list", layout: "wide", title: t("rows.myList"), entries: data.list.map(entryOfSaved) });

  const library = kind ? data.rows.filter((row) => row.kind === kind) : data.rows;
  library.forEach((row, index) => {
    out.push({ id: row.id, layout: index === 0 ? "ranked" : "wide", title: row.title, source: row.source, entries: (index === 0 ? row.items.slice(0, RANKED) : row.items).map(entryOfItem) });
    if (index === CATEGORIES_AFTER - 1 && library.length > CATEGORIES_AFTER + 1) out.push(categoriesRow(library, kind));
  });
  return out;
}

/** The pages that are one grid. Null for the others, and for a category the library no longer has. */
export function gridOf(view: View, data: PageData): GridPage | null {
  switch (view.kind) {
    case "list":
      return { title: t("rows.myList"), meta: t("tv.titles", { count: data.list.length }), layout: "wide", entries: data.list.map(entryOfSaved), empty: t("tv.listEmpty") };
    case "history":
      return { title: t("tv.history"), meta: t("tv.historyHelp"), layout: "wide", entries: data.progress.map(entryOfProgress), empty: t("tv.historyEmpty") };
    case "category": {
      const row = data.rows.find((candidate) => candidate.id === view.rowId);
      return row ? { title: row.title, meta: `${t("tv.titles", { count: row.items.length })} · ${row.source}`, layout: "wide", entries: row.items.map(entryOfItem), empty: "" } : null;
    }
    case "categories": {
      const rows = data.rows.filter((row) => !view.of || row.kind === view.of);
      const title = view.of === "movie" ? t("tv.movieCategories") : view.of === "series" ? t("tv.seriesCategories") : t("tv.allCategories");
      return { title, meta: "", layout: "categories", entries: rows.map(categoryEntry), empty: "" };
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
export type HeroAction = "play" | "list" | "remove";
export const heroActions = (entry: Entry | undefined): HeroAction[] => (!entry || entry.opens ? [] : entry.progressKey ? ["play", "remove"] : ["play", "list"]);

/** Which titles a search shows. */
export type KindFilter = "all" | LibraryKind;
export const KIND_FILTERS: readonly KindFilter[] = ["all", "movie", "series"];
export const ofKind = (items: readonly LibraryItem[], filter: KindFilter): LibraryItem[] => (filter === "all" ? [...items] : items.filter((item) => item.kind === filter));
