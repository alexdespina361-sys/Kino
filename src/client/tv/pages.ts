import { DEFAULT_LIST, forChildren, fractionOf, isWanted, listOf, resumeAt, sectionOf, type AvatarId, type LibraryItem, type LibraryKind, type LibraryRow, type LibrarySection, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating, type Person } from "../../shared";
import { continueNote, listName, unfinished } from "../account/cards";
import { filterRatings, ownSection, type SectionOfRating } from "../account/ratingFilter";
import { ratingNote, ratingSummary, sortRatings } from "../account/ratingText";
import { getLanguage, rowTitle, t } from "../i18n";
import type { ChildGate } from "../shared/childGate";
import { formatTime } from "../shared/format";
import { titleOfPersonal } from "../shared/recommend";
import { personalAfter, seenKeys, withoutSeen, type PersonalRow } from "../shared/taste";
import { landscapeRows } from "../shared/shapes";
import { addressOf, type TitleOpening } from "../shared/titleAddress";
import { WATCHING_AFTER, watchingRow } from "../shared/watching";
import type { GridSection } from "./browseNav";

export type FriendTab = "lists" | "ratings";

export type View =
  | { kind: "home" }
  | { kind: "movies" }
  | { kind: "series" }
  | { kind: "cartoons" }
  | { kind: "anime" }
  | { kind: "list"; list?: string }
  | { kind: "history" }
  | { kind: "ratings"; section?: LibrarySection; score?: number }
  | { kind: "category"; rowId: string; from?: "categories" }
  | { kind: "categories"; of?: LibrarySection }
  | { kind: "search" }
  | { kind: "profile" }
  | { kind: "friends" }
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

export const shownList = (view: View, lists: readonly ListInfo[]): ListInfo => lists.find((list) => view.kind === "list" && list.id === view.list) ?? lists[0] ?? { id: DEFAULT_LIST };

export type RowsPage = "home" | "movies" | "series" | "cartoons" | "anime";
export const isRowsPage = (view: View): view is { kind: RowsPage } =>
  view.kind === "home" || view.kind === "movies" || view.kind === "series" || view.kind === "cartoons" || view.kind === "anime";

const SECTION_OF_PAGE: Readonly<Record<Exclude<RowsPage, "home">, LibrarySection>> = { movies: "movie", series: "series", cartoons: "cartoon", anime: "anime" };
export const sectionOfPage = (page: RowsPage): LibrarySection | undefined => (page === "home" ? undefined : SECTION_OF_PAGE[page]);

export const sectionName = (section: LibrarySection): string => t(section === "movie" ? "tv.movies" : section === "series" ? "tv.series" : section === "cartoon" ? "tv.cartoons" : "tv.anime");
export const hasRows = (view: View): boolean => isRowsPage(view) || view.kind === "profile" || view.kind === "friends";

export const isProfilePage = (view: View): boolean => view.kind === "profile" || view.kind === "ratings" || view.kind === "history" || view.kind === "friends" || view.kind === "friend";

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

export type Layout = "wide" | "continue" | "ranked" | "categories";

export interface Entry {
  id: string;
  title: string;
  url: string;
  image?: string;
  backdrop?: string;
  year?: number;
  description?: string;
  startAt?: number;
  resumeUrl?: string;
  asked?: TitleOpening;
  progress?: number;
  note?: string;
  progressKey?: string;
  kind?: LibraryKind;
  section?: "cartoon" | "anime";
  kids?: true;
  opens?: View;
  source?: string;
  inboxId?: string;
  party?: string;
  ask?: string;
  wants?: string;
  request?: Person;
  plan?: string;
  chat?: string;
  action?: "addFriend" | "friendSettings" | "news";
  avatar?: AvatarId;
  online?: boolean;
  hasRoDub?: boolean;
  posters?: string[];
}

export interface HomeRow {
  id: string;
  layout: Layout;
  title: string;
  source?: string;
  group?: string;
  shape?: "landscape";
  entries: Entry[];
}

export interface GridPage {
  title: string;
  meta: string;
  hint?: string;
  layout: Layout;
  entries: Entry[];
  sections?: GridSection[];
  empty: string;
}

export interface PageData {
  rows: readonly LibraryRow[];
  all: readonly LibraryRow[];
  progress: readonly LiveProgress[];
  lists: readonly ListInfo[];
  list: readonly LiveListItem[];
  ratings: readonly LiveRating[];
  personal?: readonly PersonalRow[] | undefined;
  looked?: ReadonlyMap<string, LibrarySection>;
  child?: ChildGate | undefined;
  wanted?: ReadonlySet<LibrarySection> | null | undefined;
  watching?: readonly LibraryItem[] | undefined;
}

const ownTitle = (card: { key: string; url: string; id?: string; kind?: LibraryKind | undefined }, show?: boolean) => ({ id: card.id ?? card.key, url: card.url, ...(show !== undefined ? { kind: show ? "series" : "movie" } : card.kind ? { kind: card.kind } : {}) });

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

function sameTitle(a: string, b: string): boolean {
  const first = titleOf(a);
  return first !== undefined && first === titleOf(b);
}

export const cardOf = (entry: Entry, progress: readonly LiveProgress[]): LiveProgress | undefined =>
  progress.find((card) => sameTitle(card.url, entry.url) && (entry.kind === undefined || isShowCard(card) === (entry.kind === "series")));

export function resumable(entry: Entry, progress: readonly LiveProgress[]): Entry {
  if (entry.startAt !== undefined || entry.opens || !entry.url) return entry;
  const card = cardOf(entry, progress);
  if (!card || card.done) return entry;
  const startAt = resumeAt(card);
  if (startAt === undefined && card.url === entry.url) return entry;
  return { ...entry, resumeUrl: card.url, ...(startAt !== undefined ? { startAt } : {}) };
}

export function asOpened(entry: Entry): Entry {
  const plain = { ...entry };
  delete plain.startAt;
  delete plain.resumeUrl;
  delete plain.progress;
  delete plain.note;
  delete plain.asked;
  return plain;
}

export function openedAt(entry: Entry, opening: TitleOpening | undefined): Entry {
  const episode = opening?.season !== undefined && opening.episode !== undefined;
  if (!opening || (!episode && opening.at === undefined)) return entry;
  if (episode) return entry.kind === "movie" ? entry : { ...entry, asked: { season: opening.season, episode: opening.episode, ...(opening.at !== undefined ? { at: opening.at } : {}) } };
  return entry.kind === "series" ? entry : { ...entry, asked: { at: opening.at }, startAt: opening.at! };
}

export function heldStart(entry: Entry): Start | undefined {
  const asked = entry.asked;
  if (asked?.season === undefined || asked.episode === undefined) return undefined;
  return { season: asked.season, episode: asked.episode, url: "", ...(asked.at !== undefined ? { startAt: asked.at, asked: true as const } : {}) };
}

export const askedTime = (entry: Entry): number | undefined => (entry.asked?.episode === undefined && entry.asked?.at !== undefined && entry.startAt === entry.asked.at ? entry.asked.at : undefined);

export function playLabel(entry: Entry, at: Start | undefined): string {
  if (at) {
    if (at.asked && at.startAt !== undefined) return t("series.playFrom", { season: at.season, episode: at.episode, time: formatTime(at.startAt) });
    return t(at.startAt !== undefined ? "series.resume" : "series.play", { season: at.season, episode: at.episode });
  }
  const from = askedTime(entry);
  if (from !== undefined) return t("rows.playFrom", { time: formatTime(from) });
  return entry.startAt !== undefined ? t("rows.resume") : t("rows.play");
}

export const EPISODES_AT_ONCE = 24;

export interface EpisodeWindow {
  from: number;
  to: number;
}

export function episodeWindow(count: number, anchor: number): EpisodeWindow {
  if (count <= EPISODES_AT_ONCE || anchor < 0) return { from: 0, to: Math.min(count, EPISODES_AT_ONCE) };
  const from = Math.max(0, Math.min(anchor, count - EPISODES_AT_ONCE));
  return { from, to: from + EPISODES_AT_ONCE };
}

export function listedWindow(count: number, anchor: number, paged: EpisodeWindow | undefined): EpisodeWindow {
  if (!paged) return episodeWindow(count, anchor);
  const window = { from: Math.min(paged.from, count), to: Math.min(paged.to, count) };
  if (window.to <= window.from || (anchor >= 0 && (anchor < window.from || anchor >= window.to))) return episodeWindow(count, anchor);
  return window;
}

export const showKeyOf = (entry: Entry, progress: readonly LiveProgress[]): string => cardOf(entry, progress)?.title ?? entry.title;

export interface Start {
  season: number;
  episode: number;
  url: string;
  startAt?: number;
  asked?: true;
}

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

const sourceOf = (rows: readonly LibraryRow[], row: LibraryRow): { source?: string } => (row.source && new Set(rows.map((each) => each.source)).size > 1 ? { source: row.source } : {});

export const isTitle = (entry: Entry): boolean =>
  entry.url !== "" && !entry.opens && !entry.action && !entry.request && !entry.plan && !entry.party && !entry.ask && !entry.wants && !entry.chat;

const CATEGORY_POSTERS = 3;

const PICTURE_LOOK = 8;

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
    ...(place ? { note: place } : {}),
    ...(picture ? { image: picture } : {}),
    ...(posters.length > 0 ? { posters } : {}),
  };
};

const SECTION_ORDER: ReadonlyArray<LibrarySection | undefined> = ["movie", "series", "cartoon", "anime", undefined];

const isShowCard = (card: LiveProgress) => card.season !== undefined;

const LIST_ROW = "list:";
export const listOfRow = (rowId: string): string | undefined => (rowId.startsWith(LIST_ROW) ? rowId.slice(LIST_ROW.length) : undefined);
const BECAUSE_ROW = "because:";
export const PICKS_ROW = "picks";
export const WATCHING_ROW = "watching";

const RANKED = 10;
export const CATEGORIES_AFTER = 3;
export const CATEGORY_TILES = 12;

function categoriesRow(rows: readonly LibraryRow[], of: LibrarySection | undefined): HomeRow {
  const used = new Set<string>();
  const entries = rows.slice(0, CATEGORY_TILES).map((row) => categoryEntry(row, rows, false, used));
  if (rows.length > CATEGORY_TILES) entries.push({ id: "all-categories", title: t("tv.allCategories"), url: "", opens: { kind: "categories", ...(of ? { of } : {}) } });
  return { id: "categories", layout: "categories", title: t("tv.byCategory"), entries };
}

function linkKey(link: string, isShow: boolean): string | undefined {
  try {
    const url = new URL(link);
    for (const name of ["s", "e", "key"]) url.searchParams.delete(name);
    return `${isShow ? "show" : "film"}|${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

const placeOf = (item: LibraryItem, row: LibraryRow): LibrarySection | undefined => item.section ?? row.section ?? item.kind ?? row.kind;

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

export const addressOfCard = (card: LiveProgress): string | null => addressOf({ id: card.key, url: card.url, ...(isShowCard(card) ? { kind: "series" } : {}) });

interface CardPlaces {
  known: ReadonlyMap<string, LibrarySection>;
  hosts: ReadonlyMap<string, LibrarySection | null>;
  looked: ReadonlyMap<string, LibrarySection> | undefined;
}

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

export function rowsOfPage(page: RowsPage, data: PageData): HomeRow[] {
  const { child } = data;
  const wanted = child ? null : data.wanted;
  const section = child ? "cartoon" : sectionOfPage(page);
  const out: HomeRow[] = [];

  const places: CardPlaces | undefined = section ? { known: sectionsByLink(data.all), hosts: sectionsByHost(data.all), looked: data.looked } : undefined;
  const going = unfinished(data.progress).filter((card) => (child ? child.allows(ownTitle(card, isShowCard(card))) : !places || sectionOfCard(card, places) === section));
  if (going.length > 0) out.push({ id: "continue", layout: "continue", title: t("rows.continue"), entries: going.map(entryOfProgress) });
  const personal = child ? [] : (data.personal ?? []);
  const own = (row: PersonalRow): HomeRow => ({ id: row.why === "picks" ? PICKS_ROW : `${BECAUSE_ROW}${row.key}`, layout: "wide", title: titleOfPersonal(row), entries: row.items.map(entryOfItem) });
  if (!section) {
    for (const info of data.lists) {
      const saved = data.list.filter((item) => listOf(item) === info.id);
      if (saved.length > 0) out.push({ id: `${LIST_ROW}${info.id}`, layout: "wide", title: listName(info), entries: saved.map(entryOfSaved) });
    }
  }

  const library = rowsFor(section ? data.rows.filter((row) => sectionOf(row) === section) : data.rows.filter((row) => isWanted(wanted, row)), child);
  const wide = landscapeRows(library);
  const seen = child ? new Set<string>() : seenKeys(data.progress, data.ratings);
  const watching = section || child ? [] : watchingRow(data.watching, wanted);
  library.forEach((row, index) => {
    out.push({
      id: row.id,
      layout: index === 0 ? "ranked" : "wide",
      title: rowTitle(row),
      ...sourceOf(data.rows, row),
      ...(wide.has(row.id) ? { shape: "landscape" as const } : {}),
      entries: (index === 0 ? row.items.slice(0, RANKED) : withoutSeen(row.items, seen)).map(entryOfItem),
    });
    const next = personalAfter(index);
    if (next !== undefined && personal[next]) out.push(own(personal[next]));
    if (index === WATCHING_AFTER && watching.length > 0) out.push({ id: WATCHING_ROW, layout: "wide", title: t("rows.watching"), entries: watching.map(entryOfItem) });
    if (index === CATEGORIES_AFTER - 1 && library.length > CATEGORIES_AFTER + 1) out.push(categoriesRow(library, section));
  });
  return out;
}

export function gridOf(view: View, data: PageData): GridPage | null {
  const { child } = data;
  const progress = child ? data.progress.filter((card) => child.allows(ownTitle(card, isShowCard(card)))) : data.progress;
  const all = rowsFor(child ? data.all.filter((row) => sectionOf(row) === "cartoon") : data.all.filter((row) => isWanted(data.wanted, row)), child);
  switch (view.kind) {
    case "list": {
      const info = shownList(view, data.lists);
      const saved = data.list.filter((item) => listOf(item) === info.id && (!child || child.allows(ownTitle(item))));
      return { title: listName(info), meta: t("tv.titles", { count: saved.length }), layout: "wide", entries: saved.map(entryOfSaved), empty: t("tv.listEmpty") };
    }
    case "history":
      return { title: t("tv.history"), meta: t("tv.historyHelp"), layout: "wide", entries: progress.map(entryOfProgress), empty: t("tv.historyEmpty") };
    case "ratings": {
      const shown = filterRatings(child ? data.ratings.filter((rating) => child.allows(ownTitle(rating))) : data.ratings, view, ratingSectionIn(data.all));
      return { title: t("rating.mine"), meta: ratingSummary(t, getLanguage(), shown) || t("rating.mineHelp"), layout: "wide", entries: sortRatings(shown, "new").map(entryOfRating), empty: t("rating.empty") };
    }
    case "category": {
      const row = all.find((candidate) => candidate.id === view.rowId);
      return row ? { title: rowTitle(row), meta: categoryEntry(row, all, true).note ?? "", layout: "wide", entries: row.items.map(entryOfItem), empty: "" } : null;
    }
    case "categories": {
      const of = child ? "cartoon" : view.of;
      const rows = all.filter((row) => !of || sectionOf(row) === of);
      const title = of === "movie" ? t("tv.movieCategories") : of === "series" ? t("tv.seriesCategories") : of === "cartoon" ? t("tv.cartoonCategories") : of === "anime" ? t("tv.animeCategories") : t("tv.allCategories");
      const ordered = of ? rows : SECTION_ORDER.flatMap((section) => rows.filter((row) => sectionOf(row) === section));
      const used = new Set<string>();
      return { title, meta: "", layout: "categories", entries: ordered.map((row) => categoryEntry(row, all, false, used)), empty: "" };
    }
    default:
      return null;
  }
}

export function freshSimilar(items: readonly LibraryItem[], progress: readonly LiveProgress[], list: readonly LiveListItem[]): LibraryItem[] {
  const known = new Set([...progress, ...list].map((each) => each.title.toLowerCase()));
  return items.filter((item) => !known.has(item.title.toLowerCase()));
}

export type HeroAction = "play" | "tv" | "list" | "lists" | "remove" | "rate" | "recommend" | "dismiss" | "join" | "ask" | "start";
export const heroActions = (entry: Entry | undefined): HeroAction[] => {
  if (!entry || entry.opens || entry.action || entry.request || entry.plan) return [];
  if (entry.party) return ["join", "dismiss"];
  if (entry.ask) return ["ask", "dismiss"];
  if (entry.wants) return ["start", "dismiss"];
  if (entry.progressKey) return ["play", "remove"];
  return entry.inboxId ? ["play", "list", "dismiss"] : ["play", "list"];
};
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

export type SectionFilter = "all" | LibrarySection;
export const SECTION_FILTERS: readonly SectionFilter[] = ["all", "movie", "series", "cartoon", "anime"];
export const ofSection = (items: readonly LibraryItem[], filter: SectionFilter): LibraryItem[] => (filter === "all" ? [...items] : items.filter((item) => sectionOf(item) === filter));
