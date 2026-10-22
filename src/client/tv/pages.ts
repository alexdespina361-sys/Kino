import { DEFAULT_LIST, fractionOf, listOf, resumeAt, sectionOf, type AvatarId, type LibraryItem, type LibraryKind, type LibraryRow, type LibrarySection, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating, type Person } from "../../shared";
import { continueNote, listName, unfinished } from "../account/cards";
import { ratingNote, ratingSummary, sortRatings } from "../account/ratingText";
import { getLanguage, rowTitle, t } from "../i18n";
import type { Because } from "../shared/recommend";

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
  /** The titles this profile gave a score, and the seasons it scored. */
  | { kind: "ratings" }
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
  /** A smaller line under that one: what the page cannot show and why (what a friend watches, when it is not told). */
  hint?: string;
  layout: Layout;
  entries: Entry[];
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

/** `withSection` says which section the category is in too (the list of every category, where they sit together). */
const categoryEntry = (row: LibraryRow, rows: readonly LibraryRow[], withSection = false): Entry => {
  const first = row.items[0];
  const picture = first?.backdrop ?? first?.image;
  const section = sectionOf(row);
  const place = withSection && section ? sectionName(section) : "";
  return {
    id: row.id,
    title: rowTitle(row),
    url: "",
    opens: { kind: "category", rowId: row.id },
    ...sourceOf(rows, row),
    note: [place, t("tv.titles", { count: row.items.length })].filter(Boolean).join(" · "),
    ...(picture ? { image: picture } : {}),
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
const CATEGORIES_AFTER = 3;
const CATEGORY_TILES = 12;

function categoriesRow(rows: readonly LibraryRow[], of: LibrarySection | undefined): HomeRow {
  const entries = rows.slice(0, CATEGORY_TILES).map((row) => categoryEntry(row, rows));
  if (rows.length > CATEGORY_TILES) entries.push({ id: "all-categories", title: t("tv.allCategories"), url: "", opens: { kind: "categories", ...(of ? { of } : {}) }, note: t("tv.titles", { count: rows.length }) });
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

/** Where each title the library has listed is browsed, by its link (see `linkKey`): the section it says, else its row's, else its kind's. */
function sectionsByLink(rows: readonly LibraryRow[]): Map<string, LibrarySection> {
  const out = new Map<string, LibrarySection>();
  for (const row of rows) {
    for (const item of row.items) {
      const section = sectionOf(item) ?? sectionOf(row);
      const key = linkKey(item.url, (item.kind ?? row.kind) === "series");
      if (section && key && !out.has(key)) out.set(key, section);
    }
  }
  return out;
}

/**
 * The section a card of "Continue watching" belongs to: where the library lists its title, else its kind's (a card says only whether it is of a show,
 * so a title that was not listed here — one that was found by a search, long ago — is in Movies or Series).
 */
const sectionOfCard = (card: LiveProgress, known: ReadonlyMap<string, LibrarySection>): LibrarySection => {
  const show = isShowCard(card);
  const key = linkKey(card.url, show);
  return (key && known.get(key)) || (show ? "series" : "movie");
};

/**
 * The rows under the banner. Home has what this profile is part way through, titles like the ones it watched last or loved, a row for each of
 * its lists that has a title in it, then the library's rows with a row of categories among them. Movies, Series, Cartoons and Anime have the library's
 * rows of their section, and what is part way through of it.
 */
export function rowsOfPage(page: RowsPage, data: PageData): HomeRow[] {
  const section = sectionOfPage(page);
  const out: HomeRow[] = [];

  const known = section ? sectionsByLink(data.all) : undefined; // (only the page of a section has to tell the cards apart)
  const going = unfinished(data.progress).filter((card) => !known || sectionOfCard(card, known) === section);
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

  const library = section ? data.rows.filter((row) => sectionOf(row) === section) : data.rows;
  library.forEach((row, index) => {
    out.push({ id: row.id, layout: index === 0 ? "ranked" : "wide", title: rowTitle(row), ...sourceOf(data.rows, row), entries: (index === 0 ? row.items.slice(0, RANKED) : row.items).map(entryOfItem) });
    if (index === CATEGORIES_AFTER - 1 && library.length > CATEGORIES_AFTER + 1) out.push(categoriesRow(library, section));
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
      const row = data.all.find((candidate) => candidate.id === view.rowId);
      return row ? { title: rowTitle(row), meta: [t("tv.titles", { count: row.items.length }), sourceOf(data.all, row).source].filter(Boolean).join(" · "), layout: "wide", entries: row.items.map(entryOfItem), empty: "" } : null;
    }
    case "categories": {
      const rows = data.all.filter((row) => !view.of || sectionOf(row) === view.of);
      const title =
        view.of === "movie" ? t("tv.movieCategories") : view.of === "series" ? t("tv.seriesCategories") : view.of === "cartoon" ? t("tv.cartoonCategories") : view.of === "anime" ? t("tv.animeCategories") : t("tv.allCategories");
      const ordered = view.of ? rows : SECTION_ORDER.flatMap((section) => rows.filter((row) => sectionOf(row) === section));
      return { title, meta: "", layout: "categories", entries: ordered.map((row) => categoryEntry(row, data.all, !view.of)), empty: "" };
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
export type HeroAction = "play" | "list" | "remove" | "rate" | "recommend" | "dismiss" | "join" | "ask" | "start";
export const heroActions = (entry: Entry | undefined): HeroAction[] => {
  if (!entry || entry.opens || entry.action || entry.request || entry.plan) return []; // (somebody who asks to be friends, or a plan to watch together, is no film: pressing the tile answers)
  if (entry.party) return ["join", "dismiss"]; // an invitation to a watch party
  if (entry.ask) return ["ask", "dismiss"]; // ...one that has ended: the friend can be asked for another
  if (entry.wants) return ["start", "dismiss"]; // a friend asks for a party
  if (entry.progressKey) return ["play", "remove"];
  return entry.inboxId ? ["play", "list", "dismiss"] : ["play", "list"]; // (what a friend sent can be sent away)
};
/**
 * ...and on a title's own page, which any title can be kept from: play it (or pick it up), keep it in a list, give it a score (unless
 * ratings are turned off), send it to a friend (when friends are on), and for one part way through, take it off its row (as one a
 * friend sent is taken off theirs).
 */
export const overviewActions = (entry: Entry, ratings = true, friends = false): HeroAction[] => [
  "play",
  "list",
  ...(ratings ? (["rate"] as const) : []),
  ...(friends && entry.url ? (["recommend"] as const) : []),
  ...(entry.progressKey ? (["remove"] as const) : []),
  ...(entry.inboxId ? (["dismiss"] as const) : []),
];

/** Which titles a search shows: all, or those of one section. */
export type SectionFilter = "all" | LibrarySection;
export const SECTION_FILTERS: readonly SectionFilter[] = ["all", "movie", "series", "cartoon", "anime"];
export const ofSection = (items: readonly LibraryItem[], filter: SectionFilter): LibraryItem[] => (filter === "all" ? [...items] : items.filter((item) => sectionOf(item) === filter));
