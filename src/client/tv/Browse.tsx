import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { canAskTogether, DEFAULT_LIST, friendChoices, LibraryItemsSchema, LibrarySchema, listKey, MAX_LISTS, savedKeys, titleLink, type Library, type PlayHint, type Person } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { hintOf, listEntryOf, listName } from "../account/cards";
import { CatChip } from "../cat/Chip";
import { useCatWanted } from "../cat/settings";
import { describeError } from "../account/errors";
import { ListEditor } from "../account/Lists";
import { ratingFor, scoreOf } from "../account/ratingText";
import { useScores } from "../account/ratings";
import { profileStore, useProfileData } from "../account/store";
import { waitingFrom } from "../chat/notices";
import { TvChat } from "../chat/TvChat";
import { nameOf, recommendationOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { useBell } from "../friends/useBell";
import { friendGrid, friendRows } from "../friends/pages";
import { askLists, askRatings, useShared } from "../friends/useShared";
import { useLanguage, useT } from "../i18n";
import { useHandHeldBack } from "../shared/backButton";
import { AnimeIcon, BackspaceIcon, CartoonIcon, CheckIcon, ChevronIcon, ChevronLeftIcon, ClearIcon, ClockIcon, CloseIcon, FilmIcon, GridIcon, HomeIcon, ListIcon, MessageIcon, PencilIcon, PhoneIcon, PlayIcon, PlusIcon, SearchIcon, StarIcon, TvIcon, UsersIcon } from "../shared/icons";
import { allRows, failedShelves, feed, GRID_CAP, hasMoreShelves, hasMoreTitles, loadingShelves, loadingTitles, pageRows, ROW_CAP, useFeed } from "../shared/feed";
import { canFullscreen } from "../shared/fullscreen";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { Logo } from "../shared/Logo";
import { comesIn, hueOf } from "../shared/Poster";
import { useBecause } from "../shared/recommend";
import { ScoreBadge } from "../shared/ScoreBadge";
import { switchRole, thisIsPhone } from "../role";
import { gridRows, stepFrom, type Pos, type Shape, type Target, type Zone } from "./browseNav";
import { isCompact, useCompact } from "./compact";
import { SeriesSection, useSeriesPage, type PageEpisode } from "./Episodes";
import { AddFriendTv, FriendPickerTv, FriendRequestTv, FriendSettingsTv, NotificationsTv, PlanPickerTv, PlanTv, UnfriendTv } from "./Friends";
import { AccountChip, BackButton, BellChip, Screen } from "./Idle";
import { actionForKey } from "./keys";
import { allExact, editBox, KEYBOARD_COLUMNS, KEYBOARD_KEYS, KEYBOARD_SHAPE, keepMatching, matchLocal, mergeAnswers, NO_ANSWERS, onlySection, typedCharacter, type Answers, type BoxEdit, type SearchBox } from "./librarySearch";
import { asOpened, backOf, entryOfItem, gridOf, hasRows, heroActions, isProfilePage, isRowsPage, listOfRow, overviewActions, resumable, rowsOfPage, SECTION_FILTERS, sectionOfPage, shownList, viewKey, type Entry, type FriendTab, type HeroAction, type HomeRow, type Layout, type PageData, type SectionFilter, type Start, type View } from "./pages";
import { profileRows } from "./profile";
import { ProfileHead, type ProfilePlace } from "./ProfileHead";
import { Rail, type RailEntry } from "./Rail";
import { RateOverlay } from "./RateOverlay";
import { RowTiles } from "./RowTiles";
import { SearchField } from "./SearchField";

/** What a screen that starts a title can add: where to pick it up, and the picture and year the library already knows for it. */
export interface PlayOptions {
  startAt?: number;
  hint?: PlayHint;
}

interface BrowseProps {
  onPlay: (url: string, options?: PlayOptions) => void;
  /** The profile page's way to sign in (a guest's): the page of the account that is not the library. */
  onSignIn: () => void;
  /** Settings, from the corner of the profile's page; and the menu's other pages that are not the library: pairing a phone and the watch party. */
  onSettings: () => void;
  onConnect: () => void;
  onParty: () => void;
  /** Join the watch party a friend invited this TV to (by its code). */
  onJoinParty: (code: string) => void;
  /** A friend asked to watch together: start a party and invite them (their request is taken away by the server once they are invited). */
  onStartTogether: (friend: string) => void;
  /** A phone is connected to this TV. */
  connected: boolean;
  /** How many screens are in the watch party this TV hosts (itself included); 0 when there is none. */
  partySize: number;
  /** Said when the title that was just chosen would not play. */
  notice?: string | null;
}

/** What the screen looked like when it was left, so coming back from a film lands on the same title, at once. */
const remembered = {
  library: null as Library | null,
  view: { kind: "home" } as View,
  /** The list the lists page showed last: the menu's entry for it opens that one. */
  list: DEFAULT_LIST as string,
  query: "",
  results: NO_ANSWERS as Answers,
  /** The query `results` answers. */
  resultsFor: "",
  filter: "all" as SectionFilter,
  /** Where the remote was on each page. */
  focus: {} as Record<string, Pos>,
  /** The row of a page of rows the remote was on (rows come and go as things are watched and saved, so a number is not enough). */
  row: {} as Record<string, string>,
  /** The title in that row (tiles come and go as well: the profile's, with friends turned on or off, move along). */
  tile: {} as Record<string, string>,
  /** The page of a show that an episode was started from, and the season it was showing: the library comes back to it, to pick the next one (or another, when that one would not play). */
  detail: null as { page: Focused; season: number | undefined } | null,
};

/** Something else than that show plays: the library comes back to its tile, not to the page. (`link` is the page the video came from.) */
export function keepPageFor(link: string | undefined) {
  const kept = remembered.detail;
  if (kept && (!link || titleLink(link) !== titleLink(kept.page.entry.url))) remembered.detail = null;
}

/** Wait this long on a title before the banner changes to it, so scrolling past many does not flicker through them. */
const BANNER_DELAY_MS = 200;
/** Wait this long after the last key before asking the server, so a word is one question and not one per letter. */
const SEARCH_DELAY_MS = 350;
/** A search the server did not answer is asked again after this long. */
const SEARCH_RETRY_MS = 5000;
/** A page of rows, or a grid, asks the library for what comes next when it is scrolled to within this many of its own heights of its end... */
const NEAR_BOTTOM = 1.5;
/** ...and the remote, which moves a title at a time, when it is this many rows (or, along a row, this many titles) from the end. */
const ROWS_AHEAD = 3;
const TITLES_AHEAD = 6;
const nearBottom = (box: HTMLElement | null): boolean => box !== null && box.clientHeight > 0 && box.scrollHeight - box.clientHeight - box.scrollTop <= box.clientHeight * NEAR_BOTTOM;
const GRID_COLUMNS = 5;
const RESULT_COLUMNS = 3;
/** A phone, a tablet or a narrow window (the same width tv.css lays out for a hand-held screen): grids are as many titles wide as fit, and search is typed on the device's own keyboard. */
const NARROW = "(max-width: 899px)";
/** About how wide a title is on a hand-held screen, with the room around it. */
const NARROW_TILE_PX = 190;
/** A phone held upright shows posters (compact.ts): three across, and two on the narrowest screens, where three would be thumbnails. */
const POSTERS_THREE_FROM_PX = 360;

/** How many titles wide a grid is on a hand-held screen, or 0 when the screen is wide enough for the TV's own layout. */
function useNarrowColumns(): number {
  const read = () => (!matchMedia(NARROW).matches ? 0 : isCompact() ? (innerWidth >= POSTERS_THREE_FROM_PX ? 3 : 2) : Math.max(2, Math.floor(innerWidth / NARROW_TILE_PX)));
  const [columns, setColumns] = useState(read);
  useEffect(() => {
    const update = () => setColumns(read());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return columns;
}
/** What the banner and the picture behind the screen show: the title the remote is on. */
interface Focused {
  entry: Entry;
  label: string;
  source?: string;
}

/**
 * A page over the library: choosing which lists a title is in (it was asked from `back`), or making, renaming, placing and removing a
 * list (`id` null: a new one). A list made from the picker (`from`) takes the title in, and the picker comes back with it ticked.
 * Or rating a title: for a show, the seasons it has (and the one its page showed, with its number of episodes) are what can be rated apart.
 * Or the friends' pages: sending a title to friends, adding a friend, and choosing what is shared.
 */
type PickOverlay = { kind: "pick"; entry: Entry; back: Target; fresh?: boolean };
type RateOverlayState = { kind: "rate"; entry: Entry; back: Target; isShow: boolean; seasons: number[]; shown: number | undefined; episodes: number | undefined };
type Overlay =
  | PickOverlay
  | RateOverlayState
  | { kind: "edit"; id: string | null; back: Target; from?: PickOverlay }
  | { kind: "recommend"; entry: Entry; back: Target }
  | { kind: "addFriend"; back: Target }
  | { kind: "friendSettings"; back: Target }
  | { kind: "unfriend"; id: string; name: string; back: Target }
  | { kind: "friendRequest"; person: Person; back: Target }
  | { kind: "plan"; id: string; back: Target }
  | { kind: "planPick"; friend: string; back: Target }
  | { kind: "chat"; friend: string; back: Target }
  | { kind: "bell"; back: Target };

const CONTENT: Target = { zone: "content", row: -1, col: -1 };
const RAIL: Target = { zone: "rail", row: -1, col: -1 };
/** The first button of a title's own page: Play. */
const DETAIL: Target = { zone: "detail", row: 0, col: 0 };
/** The same target as an object of its own: setting the very object that is already set changes nothing, and so moves nothing. */
const fresh = (target: Target): Target => (target ? { ...target } : target);
/** Where the remote can start on a page, in the order they are tried. */
const CONTENT_ZONES: Zone[] = ["rows", "grid", "keys"];
/** What it can be put back on when a page is returned to ("hero": the profile's page, back from Settings, whose button it was on). */
const RESTORABLE: Zone[] = [...CONTENT_ZONES, "chips", "results", "foot", "hero"];

const find = (root: ParentNode, pos: Pos) => root.querySelector<HTMLElement>(`[data-zone="${pos.zone}"][data-row="${pos.row}"][data-col="${pos.col}"]`);
function posOf(element: Element | null): Pos | null {
  if (!(element instanceof HTMLElement) || !element.dataset.zone) return null;
  return { zone: element.dataset.zone as Zone, row: Number(element.dataset.row), col: Number(element.dataset.col) };
}

/** The buttons over a friend's titles: the way back, then the two halves of the page (the button of the one that is shown is where the remote stands). */
const FRIEND_TABS = ["lists", "ratings"] as const;
const friendChip = (tab: FriendTab | undefined): number => 1 + Math.max(0, FRIEND_TABS.indexOf(tab ?? "lists"));

/** A phone held upright has no menu line for each section (compact.ts): they are a row of buttons over the titles, the first for the whole library. */
const SECTION_CHIPS = [
  { kind: "home", label: "tv.filterAll" },
  { kind: "movies", label: "tv.filterMovies" },
  { kind: "series", label: "tv.filterSeries" },
  { kind: "cartoons", label: "tv.filterCartoons" },
  { kind: "anime", label: "tv.filterAnime" },
] as const;
/** The button of the section a page is for, or -1 for a page that is none of them. */
const sectionChip = (view: View): number => SECTION_CHIPS.findIndex((chip) => chip.kind === view.kind);

/** Where the remote was on this page, with the row of a page of rows found again by name. */
function savedPos(view: View, rows: readonly HomeRow[]): Pos | undefined {
  const key = viewKey(view);
  const saved = remembered.focus[key];
  if (!saved) return undefined;
  if (!hasRows(view) || saved.zone !== "rows") return saved;
  const id = remembered.row[key];
  const row = rows.findIndex((candidate) => candidate.id === id);
  if (row === -1) return undefined;
  // The title is found again by name, wherever it has moved to (a card that was watched moves to the front of "Continue watching"). One
  // that has gone leaves the one that is where it was, or the last.
  const entries = rows[row]!.entries;
  const at = entries.findIndex((entry) => entry.id === remembered.tile[key]);
  return { zone: "rows", row, col: at !== -1 ? at : id === "continue" ? 0 : Math.min(saved.col, Math.max(0, entries.length - 1)) };
}

/** The buttons of a title's own page, the zones its arrow keys walk. */
const PAGE_ZONES: Zone[] = ["detail", "close", "seasons", "episodes"];

/** Moving into a show's seasons lands on the one that is shown, and into its episodes on the one Play leads to (else on the first). */
function landOnPage(next: Target, from: Pos, root: ParentNode): Target {
  if (!next || next.row === -1 || next.zone === from.zone) return next;
  const pick = (selector: string) => root.querySelector<HTMLElement>(selector);
  if (next.zone === "seasons") {
    const shown = pick('[data-zone="seasons"][aria-checked="true"]');
    return shown ? { ...next, col: Number(shown.dataset.col) } : next;
  }
  if (next.zone === "episodes") {
    const target = pick('[data-zone="episodes"][data-target="true"]');
    return target ? { ...next, row: Number(target.dataset.row) } : next;
  }
  return next;
}

/** Scroll `container` just far enough that `element` shows with some room around it (a page that scrolls asks for more). */
function keepInView(container: HTMLElement, element: HTMLElement, room = parseFloat(getComputedStyle(container).fontSize) * 1.5) {
  const box = container.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  if (at.top < box.top + room) container.scrollBy({ top: at.top - box.top - room, behavior: "smooth" });
  else if (at.bottom > box.bottom - room) container.scrollBy({ top: at.bottom - box.bottom + room, behavior: "smooth" });
}

/** The same sideways, for a row of buttons wider than its place: it slides along to keep the one with the focus in view. */
function slideIntoView(button: HTMLElement) {
  const row = button.parentElement;
  if (!row) return;
  const room = parseFloat(getComputedStyle(row).fontSize) * 1.5;
  const box = row.getBoundingClientRect();
  const at = button.getBoundingClientRect();
  if (at.left < box.left + room) row.scrollBy({ left: at.left - box.left - room, behavior: "smooth" });
  else if (at.right > box.right - room) row.scrollBy({ left: at.right - box.right + room, behavior: "smooth" });
}

/**
 * The library on the TV, laid out like a streaming app: a menu down the left (search, home, movies, series, the lists, history, the
 * phone, settings, and the categories), the account button in the corner, and on the pages of rows a banner with Play and the list
 * for the title the remote is on, with the rows under it. The arrow keys walk everything; Left from the first title of any row opens
 * the menu, OK on a title opens its own page (play it, keep it in a list), and Back steps out: of that page, of the menu, then to
 * the home page, and from there into the menu.
 */
export function TvBrowse({ onPlay, onSignIn, onSettings, onConnect, onParty, onJoinParty, onStartTogether, connected, partySize, notice }: BrowseProps) {
  const t = useT();
  const language = useLanguage();
  const { status: accountStatus, me, profile, say } = useAccount();
  const friends = useFriends();
  const bell = useBell();
  const showCat = useCatWanted(); // (the cat's button in the corner: only on a screen that has a cat)
  const { progress, watched, lists, list, ratings, settings } = useProfileData();
  const ratingsOn = settings.ratings ?? true;
  /** Whether this profile is told what friends watch (off until it is turned on: the friends' pages say so while it is). */
  const iGet = friendChoices(settings).friendsGet;
  /** A phone held upright (compact.ts): a bar of four places at the bottom, the sections as buttons over the titles, posters, and no banner. */
  const compact = useCompact();
  const narrowColumns = useNarrowColumns();
  const narrow = narrowColumns > 0;
  const resultColumns = narrowColumns || RESULT_COLUMNS;
  const [library, setLibrary] = useState<Library | null>(remembered.library);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(remembered.library ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [view, setViewState] = useState<View>(remembered.view);
  const [box, setBox] = useState<SearchBox>(() => ({ text: remembered.query, caret: remembered.query.length }));
  const query = box.text;
  const edit = (change: BoxEdit) => setBox((before) => editBox(before, change));
  const [results, setResults] = useState<Answers>(remembered.results);
  const [filter, setFilter] = useState<SectionFilter>(remembered.filter);
  const [searching, setSearching] = useState(false);
  /** The query the server could not answer (it is asked again in a moment), so "nothing matches" is not said of a search that did not happen. */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [searchTry, setSearchTry] = useState(0);
  const searchFailed = failedFor !== null && failedFor === query.trim();
  const [railOpen, setRailOpen] = useState(false);
  /** A phone is for controlling a TV with: the menu's phone entry takes it to the remote instead of showing a code for one. */
  const [phone] = useState(thisIsPhone);
  const [focused, setFocused] = useState<Focused | null>(null);
  /** The title whose own page is open over the library (a show's page again when the library comes back from one of its episodes). */
  const [detail, setDetail] = useState<Focused | null>(() => {
    const kept = remembered.detail;
    return kept && { ...kept.page, entry: resumable(asOpened(kept.page.entry), progress) };
  });
  useEffect(() => {
    remembered.detail = null; // (it is the open page's to keep from here on: see `playEntry`)
  }, []);
  /** What that page lists besides the buttons when the title is a show: its seasons, and the episodes of one. */
  const series = useSeriesPage(detail?.entry, progress, watched, remembered.detail?.season);
  /** The remote is on a row below the first, so the banner makes room for the rows. */
  const [deep, setDeep] = useState(false);
  /** The page over the library, when there is one. */
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  /** Somewhere to put the focus once the next render has put it on screen. */
  const [pending, setPending] = useState<Target>(null);
  const bannerTimer = useRef<number>(0);
  const rootRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    // (Asked again, as after a try at a video that failed or a press on Retry, it is asked past the browser's memory of the last answer.)
    fetch("/api/library", attempt > 0 ? { cache: "reload" } : undefined)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: unknown) => {
        const parsed = LibrarySchema.parse(data);
        if (!live) return;
        remembered.library = parsed;
        feed.setBase(parsed.rows.filter((row) => row.items.length > 0)); // (the rows that come after these, and more of each, are asked for as the page is scrolled: see the feed)
        if (attempt > 0) remembered.resultsFor = ""; // what a search showed is asked for again against the new list
        setLibrary(parsed);
        setStatus("ready");
      })
      .catch(() => {
        if (live && !remembered.library) setStatus("failed");
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  // The library as it has grown: its first rows, the ones brought after them and more of each row (see the feed). A TV that comes back from a film finds it as it was.
  const feeding = useFeed();
  const rows = feeding.data.base;
  const hasTiles = status === "ready" && rows.length > 0;
  // "Because you watched ..." and "Because you loved ...": the library knows titles like the ones this profile watched last or scored high.
  const because = useBecause();
  /** What section the rows of this page are in: Home has all of them. */
  const pageSection = isRowsPage(view) ? sectionOfPage(view.kind) : undefined;
  const pageLibraryRows = useMemo(() => pageRows(feeding.data, pageSection), [feeding.data, pageSection]);
  /** The rows of this page that the library can add titles to as they are scrolled (the ranking of ten, which is not scrolled, is not one). */
  const growing = useMemo(() => new Set(pageLibraryRows.filter((row) => hasMoreTitles(feeding, row.id, row.items.length, ROW_CAP)).map((row) => row.id)), [pageLibraryRows, feeding]);
  // (Every row there is, also for the page of a section: the cards of "Continue watching" are told apart by where the library lists their titles.)
  const everyRow = useMemo(() => allRows(feeding.data), [feeding.data]);
  const data = useMemo<PageData>(() => ({ rows: pageLibraryRows, all: everyRow, progress, lists, list, ratings: ratingsOn ? ratings : [], because }), [pageLibraryRows, everyRow, progress, lists, list, ratings, ratingsOn, because]);

  const rowsPage = hasRows(view);
  // A friend's page shows what they share, asked of the server while the page is open: the lists they keep, or what they rated.
  const friendId = view.kind === "friend" ? view.id : "";
  const friendTab: FriendTab = view.kind === "friend" ? (view.tab ?? "lists") : "lists";
  const friend = friends.state?.friends.find((each) => each.id === friendId);
  /** Where the chat chip is in the row of a friend's page: after the way back, the tabs and (for a friend who takes invitations) the two buttons to watch together. */
  const chatChip = (friend && canAskTogether(friend) ? 3 : 1) + FRIEND_TABS.length;
  const sharedLists = useShared(friendId, Boolean(friendTab === "lists" && friend?.on && friend.lists), askLists, friend?.activity);
  const sharedRatings = useShared(friendId, Boolean(friendTab === "ratings" && friend?.on && friend.ratings), askRatings, friend?.activity);
  // `language` is not read, but the rows' titles and notes are words in it
  /* eslint-disable react-hooks/exhaustive-deps */
  const homeRows = useMemo<HomeRow[]>(() => {
    if (isRowsPage(view)) return rowsOfPage(view.kind, data);
    if (view.kind === "friends") return friendRows(friends.state, Date.now(), iGet);
    if (view.kind !== "profile") return [];
    return profileRows({ name: profile?.name ?? "", signedIn: Boolean(me && profile), ratingsOn, ratings, friendsOn: friends.on, friends: friends.state, unread: friends.attention, watched: progress.length });
  }, [view, data, language, friends.state, friends.on, friends.attention, me, profile, ratingsOn, ratings, progress.length, iGet]);
  const grid = useMemo(() => gridOf(view, data) ?? friendGrid(view, friends.state, sharedLists, sharedRatings, iGet), [view, data, language, friends.state, sharedLists, sharedRatings, iGet]);
  /* eslint-enable react-hooks/exhaustive-deps */
  // (A phone's categories are tiles of words, not pictures: two across, where the posters of the other pages are three.)
  const gridColumns = compact && grid?.layout === "categories" ? 2 : narrowColumns || GRID_COLUMNS;
  // What a search found, as the kind chosen shows it: the titles with every word typed, and under them the closest others.
  const shownAnswers = useMemo(() => onlySection(results, filter), [results, filter]);
  const shownResults = shownAnswers.items;
  /** The rows of the results' grid: those of the exact titles, then (a block of their own, under a heading) those of the closest others. */
  const resultRowsOf = (columns: number) => [...gridRows(shownAnswers.exact, columns), ...gridRows(shownResults.length - shownAnswers.exact, columns)];

  // Where the remote starts on a page of rows: the first title, or on a return from a film, the one it left.
  const homeFocus = rowsPage ? savedPos(view, homeRows) : undefined;
  const startRow = Math.min(homeFocus?.row ?? 0, Math.max(0, homeRows.length - 1));
  const startCol = Math.min(homeFocus?.col ?? 0, Math.max(0, (homeRows[startRow]?.entries.length ?? 1) - 1));
  const start = homeRows[startRow]?.entries[startCol];
  // What the banner says is read from the page as it is now: a tile's own line (how many friends, what is new) changes while the remote rests on it.
  const onNow = focused && rowsPage ? homeRows.find((row) => row.title === focused.label)?.entries.find((entry) => entry.id === focused.entry.id) : undefined;
  const shown: Focused | null = focused
    ? onNow
      ? { ...focused, entry: resumable(onNow, progress) }
      : focused
    : rowsPage && start
      ? { entry: start, label: homeRows[startRow]!.title, ...(homeRows[startRow]!.source ? { source: homeRows[startRow]!.source! } : {}) }
      : null;
  const actions = rowsPage ? heroActions(shown?.entry) : [];
  const saved = useMemo(() => savedKeys(list), [list]);
  const scores = useScores();
  const inList = (entry: Entry, id: string) => saved.has(listKey(entry.url, id));
  /** Whether a title is in any list. */
  const isSaved = (entry: Entry) => lists.some((info) => inList(entry, info.id));
  /** With one list a press puts a title in it or takes it out; with more, a press asks which. */
  const several = lists.length > 1;
  const canAdd = lists.length < MAX_LISTS;
  const shownId = shownList(view, lists).id;
  /** Where the list being changed stands: the first list stays first, so only the others have a place to move to (and need another to change places with). */
  const editedId = overlay?.kind === "edit" ? overlay.id : null;
  const editedAt = editedId ? lists.findIndex((info) => info.id === editedId) : -1;

  // Choosing a page shuts the menu at once. On a page with nothing to stand on (an empty list) the remote stays on the menu's line
  // for it, but the menu itself is closed; an arrow key opens it again.
  const choose = (next: View) => {
    remembered.view = next;
    remembered.detail = null;
    setViewState(next);
    setFocused(null);
    setDetail(null);
    setDeep(false);
    setRailOpen(false);
    setPending(CONTENT);
  };
  /** Another list on the lists page: the buttons keep the remote, only what is below them changes. */
  const selectList = (id: string) => {
    const next: View = { kind: "list", list: id };
    remembered.list = id;
    remembered.view = next;
    setViewState(next);
  };
  /** The other half of a friend's page (their lists, their ratings): the same way. */
  const selectTab = (id: string, tab: FriendTab) => {
    const next: View = { kind: "friend", id, tab };
    remembered.view = next;
    setViewState(next);
  };
  /** Another section on a phone's page of rows: the same way again (the buttons keep the remote), and the titles under them start from their top. */
  const selectSection = (next: View) => {
    remembered.view = next;
    remembered.detail = null;
    setViewState(next);
    setFocused(null);
    setDeep(false);
    rowsRef.current?.scrollTo({ top: 0 });
  };
  /** Closing a page over the library puts the remote back where it was asked from. */
  const closeOverlay = () => {
    setPending(overlay?.back ?? CONTENT);
    setOverlay(null);
  };
  /** Leaving a list's page: back to the picker it was asked from, or to where the remote was. */
  const leaveEdit = () => (overlay?.kind === "edit" && overlay.from ? setOverlay(overlay.from) : closeOverlay());
  /** A title's own page opens over the library, on Play; closing it puts the remote back on the title it came from. */
  const openDetail = (title: Focused) => {
    setDetail(title);
    setPending(DETAIL);
  };
  const closeDetail = () => {
    remembered.detail = null;
    setDetail(null);
    setPending(CONTENT);
  };
  // A phone or a tablet has no Back key: its own Back does what the remote's does, out of a title's page first, then from a page of the library to the
  // one it is a step in from (Home at the end). Home is as far back as the library goes: the site asks there before it is left (see shared/backButton.ts).
  useHandHeldBack(view.kind !== "home" ? () => choose(backOf(view) ?? { kind: "home" }) : undefined);
  useHandHeldBack(detail ? closeDetail : undefined);

  // The menu: the places (search, home, films, shows, the categories, the lists), then what is done from here (the party, a phone). A few lines, so that
  // none has to be scrolled to. Who is watching is not in it: the button in the corner is, and opens the profile, which holds what the profile rated,
  // its friends and History, with the settings in its own corner.
  // A phone held upright (compact.ts) has a bar of four places along the bottom: Home (with its sections as buttons over the titles), Search, the categories and the lists.
  // The party and the phone are not places but things to do, and have a button each on the profile's page, where Settings is.
  const partyPlace: ProfilePlace = { id: "party", label: t("party.rail"), icon: <UsersIcon />, ...(partySize > 1 ? { badge: String(partySize) } : {}), testId: "rail-party", onPress: onParty };
  const phonePlace: ProfilePlace = phone
    ? { id: "connect", label: t("tv.useRemote"), icon: <PhoneIcon />, testId: "rail-connect", onPress: () => switchRole("remote") }
    : { id: "connect", label: t(connected ? "tv.phoneConnected" : "tv.connectPhone"), icon: <PhoneIcon />, ...(connected ? { lit: true } : {}), testId: "rail-connect", onPress: onConnect };
  const entries: RailEntry[] = compact
    ? [
        { id: "home", label: t("tv.home"), icon: <HomeIcon />, current: isRowsPage(view), testId: "rail-home", onPress: () => choose({ kind: "home" }) },
        { id: "search", label: t("tv.search"), icon: <SearchIcon />, current: view.kind === "search", testId: "rail-search", onPress: () => choose({ kind: "search" }) },
        { id: "categories", label: t("tv.categories"), icon: <GridIcon />, current: view.kind === "categories" || view.kind === "category", testId: "rail-categories", onPress: () => choose({ kind: "categories" }) },
        { id: "list", label: t("rows.myList"), icon: <ListIcon />, current: view.kind === "list", testId: "rail-list", onPress: () => choose({ kind: "list", list: remembered.list }) },
      ]
    : [
        { id: "search", label: t("tv.search"), icon: <SearchIcon />, current: view.kind === "search", testId: "rail-search", onPress: () => choose({ kind: "search" }) },
        { id: "home", label: t("tv.home"), icon: <HomeIcon />, current: view.kind === "home", testId: "rail-home", onPress: () => choose({ kind: "home" }) },
        { id: "movies", label: t("tv.movies"), icon: <FilmIcon />, current: view.kind === "movies", testId: "rail-movies", onPress: () => choose({ kind: "movies" }) },
        { id: "series", label: t("tv.series"), icon: <TvIcon />, current: view.kind === "series", testId: "rail-series", onPress: () => choose({ kind: "series" }) },
        { id: "cartoons", label: t("tv.cartoons"), icon: <CartoonIcon />, current: view.kind === "cartoons", testId: "rail-cartoons", onPress: () => choose({ kind: "cartoons" }) },
        { id: "anime", label: t("tv.anime"), icon: <AnimeIcon />, current: view.kind === "anime", testId: "rail-anime", onPress: () => choose({ kind: "anime" }) },
        { id: "categories", label: t("tv.categories"), icon: <GridIcon />, current: view.kind === "categories" || view.kind === "category", testId: "rail-categories", onPress: () => choose({ kind: "categories" }) },
        { id: "list", label: t("rows.myList"), icon: <ListIcon />, current: view.kind === "list", testId: "rail-list", onPress: () => choose({ kind: "list", list: remembered.list }) },
        { ...partyPlace, apart: true },
        phonePlace,
      ];
  const openEntry = entries.findIndex((entry) => entry.current);
  const railIndex = openEntry === -1 ? (compact ? 0 : 1) : openEntry; // a page the menu has no line for belongs to Home

  // What the arrow keys can reach, row by row: the key handler below reads it through a ref.
  const canSignIn = accountStatus === "ready"; // (a server without accounts has nobody to sign in, but its TV has Settings, which the corner button leads to)
  const showAccount = accountStatus !== "loading";
  const showBell = canSignIn && bell.on;
  // The profile's page and the pages under it (what it rated, its friends, History) have the way back in the corner, the first of its buttons: a mouse and a
  // finger have no key for it. (A friend's page has its own, the first button of its row.)
  const wayBack = view.kind !== "friend" && isProfilePage(view) ? backOf(view) : null;
  const lead = wayBack ? 1 : 0;
  const topButtons = lead + (showBell ? 1 : 0) + (showAccount ? 1 : 0) + (showCat ? 1 : 0) + (canFullscreen() ? 1 : 0); // the way back, the bell, the account button, the cat's, then the full screen one
  const signedIn = Boolean(me && profile);
  /** What a phone's bar has no room for, as buttons after Feedback (none on a screen whose menu has a line for each). */
  const places = compact ? [partyPlace, phonePlace] : [];
  /** The profile's page has buttons where the other pages have a banner: Settings and Feedback, and for a guest the way to sign in before them. */
  const profileButtons = view.kind === "profile" ? (signedIn || !canSignIn ? 2 : 3) + places.length : 0;
  /** A phone's pages of rows have their sections as a row of buttons where the others have a banner. */
  const sectionButtons = compact && isRowsPage(view);
  const showRetry = rowsPage && homeRows.length === 0 && status !== "loading";
  // The page of a section (Movies, Series, Cartoons or Anime) of a library that has titles, none of them of that section: not "nothing yet", which Retry could not
  // mend. (While the rows that come after the first ones may still bring some, it is waiting for them; the library says there are none when it has no more to bring.)
  const sectionPage = pageSection !== undefined;
  const sectionWaiting = showRetry && hasTiles && sectionPage && hasMoreShelves(feeding, pageSection);
  const kindEmpty = showRetry && hasTiles && sectionPage && !sectionWaiting;
  const shape: Shape = {
    rail: compact ? [entries.length] : entries.map(() => 1), // (a column of lines, or one row of places: browseNav.ts tells them apart)
    top: topButtons > 0 ? [topButtons] : [],
    ...(rowsPage ? { hero: profileButtons > 0 ? [profileButtons] : !compact && !deep && actions.length > 0 ? [actions.length] : [], rows: showRetry ? [1] : homeRows.map((row) => row.entries.length) } : {}),
    ...(sectionButtons ? { chips: [SECTION_CHIPS.length] } : {}),
    ...(grid ? { grid: gridRows(grid.entries.length, gridColumns) } : {}),
    ...(view.kind === "search" ? { ...(narrow ? {} : { keys: KEYBOARD_SHAPE }), chips: [SECTION_FILTERS.length], results: resultRowsOf(resultColumns) } : {}),
    // The lists page: a button for each list, to make another and to change this one, over its titles.
    ...(view.kind === "list" ? { chips: [lists.length + (canAdd ? 2 : 1)] } : {}),
    // A friend's page: the way back, their lists and their ratings over the titles (and, for a friend who takes invitations, to ask them to watch and to plan it), the chat, and under them the button that takes them off the friends.
    ...(view.kind === "friend" && friend ? { chips: [canAskTogether(friend) ? 6 : 4], foot: [1] } : {}),
    ...(detail
      ? {
          close: [1],
          detail: [overviewActions(detail.entry, ratingsOn, friends.on).length],
          ...(series.seasons.length > 1 ? { seasons: [series.seasons.length] } : {}),
          ...(series.episodes?.length ? { episodes: series.episodes.map(() => 1) } : {}),
        }
      : {}),
  };
  const latest = useRef({ shape, view, query, railIndex, homeRows, detail, overlay, lists, signedIn, pageSection, growing, compact });
  latest.current = { shape, view, query, railIndex, homeRows, detail, overlay, lists, signedIn, pageSection, growing, compact };

  /**
   * Turn "the menu entry for this page" and "the title the remote was last on" into a button that is on screen. `leaving` is the block of buttons
   * the remote is moving out of: Down from the profile's top buttons goes to its cards, not back to the button it was on.
   */
  const resolve = (target: Target, leaving?: Zone): Pos | null => {
    const root = rootRef.current;
    if (!target || !root) return null;
    if (target.row !== -1) return target as Pos;
    // (A phone's menu is one row of places along the bottom, a TV's a column of lines down the left.)
    if (target.zone === "rail") return latest.current.compact ? { zone: "rail", row: 0, col: latest.current.railIndex } : { zone: "rail", row: latest.current.railIndex, col: 0 };
    const at = savedPos(latest.current.view, latest.current.homeRows);
    if (at && at.zone !== leaving && RESTORABLE.includes(at.zone) && find(root, at)) return at;
    // (On the lists page the buttons over the titles are somewhere to stand when the list has none; on a friend's page, the button of the half that is shown, not the way back.
    // The same on a phone's page of rows, where the buttons are the sections: the one that is shown.)
    const page = latest.current.view;
    // (A guest came to the profile's page for one thing: the way to sign in is where the remote starts.)
    const zones: Zone[] =
      page.kind === "list" || page.kind === "friend" || (latest.current.compact && isRowsPage(page))
        ? [...CONTENT_ZONES, "chips"]
        : page.kind === "profile" && !latest.current.signedIn
          ? ["hero", ...CONTENT_ZONES]
          : CONTENT_ZONES;
    const start = (zone: Zone): Pos => ({ zone, row: 0, col: zone === "chips" ? (page.kind === "friend" ? friendChip(page.tab) : Math.max(0, sectionChip(page))) : 0 });
    return zones.filter((zone) => zone !== leaving).map(start).find((pos) => find(root, pos)) ?? null;
  };
  const focusAt = (target: Target, leaving?: Zone) => {
    const pos = resolve(target, leaving);
    if (pos && rootRef.current) find(rootRef.current, pos)?.focus({ preventScroll: true });
  };
  /** Move the focus; the menu is only on screen while it has the focus, so it is opened first and reached after the render. */
  const go = (target: Target, leaving?: Zone) => {
    if (target && target.zone === "rail" && !latest.current.compact) {
      setRailOpen(true);
      setPending(target);
    } else focusAt(target, leaving); // (a phone's bar is always on screen: nothing to open first)
  };

  useEffect(() => {
    if (!pending) return;
    setPending(null);
    focusAt(pending);
  }, [pending]);

  // A title that goes while the remote is on it (friends turned off from another device, a card removed) takes the focus with it, and then
  // nothing answers OK: the remote goes to the title that is where it was.
  const standingOn = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const gone = standingOn.current;
    if (!gone || gone.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
    standingOn.current = null;
    setPending(fresh(latest.current.detail ? DETAIL : CONTENT));
  }, [homeRows, grid]);

  // Keys pressed while it loaded may have landed on the account button, or nowhere; once there is something to see, the remote goes to it.
  // (Also when the list changed under the remote: a title the server stopped offering takes its button with it.)
  // (A phone's page of rows has the buttons of its sections to stand on while the titles are on their way: when they come, the remote goes to the first of them.)
  const hadTiles = useRef(hasTiles);
  useEffect(() => {
    const at = posOf(document.activeElement);
    const came = hasTiles && !hadTiles.current;
    hadTiles.current = hasTiles;
    const waited = came && at?.zone === "chips" && latest.current.compact && isRowsPage(latest.current.view);
    if (waited) delete remembered.focus[viewKey(latest.current.view)]; // (that button was only where the remote waited: it is not where it was left)
    // (A new object each time: on a page with nothing to stand on the target is never taken, and the same one set again would change nothing, so the
    // next page chosen would not move the remote either.)
    if (!at || at.zone === "top" || waited) setPending(fresh(latest.current.detail ? DETAIL : CONTENT));
  }, [hasTiles, status, view.kind, library]);

  // The library is asked for more when a page is scrolled near its end, whatever scrolled it (see the handlers on the rows and the grid), and when the page does not
  // fill the screen yet: an answer, or a question that failed and may be asked again, looks again.
  useEffect(() => {
    if (status !== "ready") return;
    if (isRowsPage(view) && nearBottom(rowsRef.current)) feed.loadShelves(pageSection);
    if (view.kind === "category" && nearBottom(gridRef.current)) feed.loadMore(view.rowId, GRID_CAP);
  }, [feeding, status, view, pageSection, homeRows.length, grid?.entries.length]);
  const askShelves = () => {
    if (status === "ready" && isRowsPage(view) && nearBottom(rowsRef.current)) feed.loadShelves(pageSection);
  };
  const askTitles = () => {
    if (status === "ready" && view.kind === "category" && nearBottom(gridRef.current)) feed.loadMore(view.rowId, GRID_CAP);
  };

  // A video that would not play may take its title off the server's lists: ask for them again.
  useEffect(() => {
    if (notice) setAttempt((n) => n + 1);
  }, [notice]);

  // A category that is gone (the library was refreshed) leaves its page empty: go home. So does the ratings page once ratings are turned off (to the profile's page, where it was).
  useEffect(() => {
    if (view.kind === "category" && status === "ready" && !grid) choose({ kind: "home" });
    else if (view.kind === "ratings" && !ratingsOn) choose({ kind: "profile" });
  }, [view, status, grid, ratingsOn]);

  // The friends' pages are for a profile that has friends on, and a friend who is gone (taken off from the other side) leaves nothing to show.
  useEffect(() => {
    if ((view.kind === "friends" || view.kind === "friend") && !friends.on) choose({ kind: "profile" });
    else if (view.kind === "friend" && friends.state && !friend) choose({ kind: "friends" });
  }, [view.kind, friends.on, friends.state, friend]);
  // The question about taking a friend off is no use once they are gone (the other side took them off while it was open): it closes with the page behind it.
  useEffect(() => {
    if (overlay?.kind === "unfriend" && friends.state && !friends.state.friends.some((each) => each.id === overlay.id)) setOverlay(null);
    // (Likewise a request that was answered on a phone, or taken back, while its question was on the screen.)
    if (overlay?.kind === "friendRequest" && friends.state && !friends.state.requests.some((each) => each.from.id === overlay.person.id)) closeOverlay();
    // (And the plan to watch together with a friend who was taken off the friends meanwhile.)
    if (overlay?.kind === "planPick" && friends.state && !friends.state.friends.some((each) => each.id === overlay.friend)) closeOverlay();
    // (And the bell once friends are turned off from another device: there is nothing left for it to list.)
    if (overlay?.kind === "bell" && !bell.on) closeOverlay();
  }, [overlay, friends.state, bell.on]);
  // The friends page shows how things stand now, and opening it is seeing what is in the inbox.
  useEffect(() => {
    if (view.kind === "friends") void friends.refresh();
  }, [view.kind]);
  useEffect(() => {
    if (view.kind === "friends" && friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [view.kind, friends.unread]);
  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);

  useEffect(() => {
    remembered.query = query;
    remembered.results = results;
    remembered.filter = filter;
  }, [query, results, filter]);

  // Search: what is already loaded answers at once, the server adds what it knows once the typing pauses.
  useEffect(() => {
    if (view.kind !== "search") return;
    const text = query.trim();
    if (text === remembered.resultsFor) return setSearching(false); // coming back to answers already shown
    if (!text) {
      remembered.resultsFor = "";
      setResults(NO_ANSWERS);
      return setSearching(false);
    }
    const local = matchLocal(feed.index, rows, text); // (every title this TV has met, not only the ones on screen)
    setResults((before) => (text.length < 2 ? local : mergeAnswers(local, keepMatching(before, text), text))); // (what the server found for the words a letter ago stays while it is asked again)
    if (text.length < 2) {
      remembered.resultsFor = text;
      return setSearching(false);
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      Promise.resolve() // (encodeURIComponent throws for a lone half of a pair: inside the chain it is a failed search, outside it an error that leaves "searching" on)
        .then(() => fetch(`/api/library/search?q=${encodeURIComponent(text)}`, { signal: controller.signal }))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search answered ${res.status}`))))
        .then((answer: unknown) => {
          const parsed = LibraryItemsSchema.parse(answer);
          feed.learn(parsed.items); // (found next time without asking)
          const merged = mergeAnswers(local, { items: parsed.items, exact: parsed.exact ?? parsed.items.length }, text);
          setResults(merged);
          remembered.results = merged;
          remembered.resultsFor = text;
          setFailedFor(null);
          setSearching(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFailedFor(text);
          setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, view.kind, rows, searchTry]);

  // A search that did not get an answer is asked again every few seconds for as long as it is on screen.
  useEffect(() => {
    if (failedFor === null || view.kind !== "search") return;
    const timer = window.setTimeout(() => setSearchTry((n) => n + 1), SEARCH_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [failedFor, searchTry, view.kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || event.altKey || event.ctrlKey || event.metaKey) return;
      const { shape: now, view: page, query: text, detail: open, overlay: over, lists: all } = latest.current;
      if (over) return; // a page over the library walks its own buttons (see Idle.tsx)

      // A keyboard types into the search box, at the caret (not while a title's page is over it; a small screen's box is a field that takes its keys itself).
      const boxKeys = page.kind === "search" && !open && !(event.target instanceof HTMLInputElement);
      const typed = boxKeys ? typedCharacter(event) : null;
      if (typed !== null) {
        event.preventDefault();
        edit({ kind: "type", char: typed });
        return;
      }
      // ...and Delete takes the character after the caret, Home and End take it to the ends of the text.
      const caretKey: BoxEdit | null = !boxKeys ? null : event.key === "Delete" ? { kind: "delete" } : event.key === "Home" ? { kind: "move", to: "start" } : event.key === "End" ? { kind: "move", to: "end" } : null;
      if (caretKey) {
        event.preventDefault();
        edit(caretKey);
        return;
      }

      const action = actionForKey(event);
      if (action === "back") {
        event.preventDefault();
        if (open) return closeDetail();
        if (event.key === "Backspace" && page.kind === "search") {
          if (text) return edit({ kind: "backspace" }); // (at the very start of the text there is nothing before the caret: nothing goes, and the page is not left either)
          if (event.repeat) return; // (holding it down empties the box and stops there: the repeats must not go on to leave the page)
        }
        const back = backOf(page); // (a page that is a step in from another goes back to that one, the others to Home, also from the menu when the page has no title to go back to)
        if (posOf(document.activeElement)?.zone === "rail" && resolve(CONTENT)) go(CONTENT);
        else if (back) choose(back);
        else go(RAIL); // home is as far back as it goes: the menu is the next step
        return;
      }
      if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return;
      if (event.target instanceof HTMLInputElement && (action === "left" || action === "right")) return; // in the search box of a small screen they move the cursor
      event.preventDefault();

      const at = posOf(document.activeElement);
      if (open) return go(at && PAGE_ZONES.includes(at.zone) ? landOnPage(stepFrom(now, at, action), at, root) : DETAIL); // the page over the library keeps the remote to itself
      if (!at) {
        // Nowhere to stand yet. On a page with titles that is the first one; on an empty page Left reaches the menu and Up the account button.
        if (resolve(CONTENT)) return focusAt(CONTENT);
        return go(action === "left" ? RAIL : action === "up" && now.top?.length ? { zone: "top", row: 0, col: 0 } : null);
      }
      const next = stepFrom(now, at, action);
      // Up from the titles lands on the button of the list (or the half of a friend's page) that is shown, not on the one above whichever title the remote was on.
      const shownChip = page.kind === "friend" ? friendChip(page.tab) : Math.max(0, all.findIndex((info) => info.id === shownList(page, all).id));
      // (Likewise on a phone's page of rows, where the buttons over the titles are the sections: from the titles, and from the account button over them, the one that is shown.)
      const section = sectionChip(page);
      const chip = at.zone === "grid" ? shownChip : section !== -1 && (at.zone === "rows" || at.zone === "top") ? section : null;
      go(next?.zone === "chips" && chip !== null ? { ...next, col: chip } : next, at.zone);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** The remote moved onto a title: keep it in view (the page itself never scrolls) and, after a pause, let the banner say what it is. */
  const arrived = (element: HTMLElement, pos: Pos, now: Focused) => {
    const key = viewKey(latest.current.view);
    remembered.focus[key] = pos;
    standingOn.current = element;
    if (pos.zone === "rows") {
      remembered.row[key] = latest.current.homeRows[pos.row]?.id ?? "";
      remembered.tile[key] = latest.current.homeRows[pos.row]?.entries[pos.col]?.id ?? "";
      setDeep(pos.row > 0);
      const scroller = element.parentElement!;
      const edge = element.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const room = edge.width * 0.7; // keep a title beside it showing, so there is somewhere to go
      if (edge.left < box.left + room) scroller.scrollBy({ left: edge.left - box.left - room, behavior: "smooth" });
      else if (edge.right > box.right - room) scroller.scrollBy({ left: edge.right - box.right + room, behavior: "smooth" });
      rowsRef.current?.scrollTo({ top: scroller.closest<HTMLElement>(".tv-row")!.offsetTop, behavior: "smooth" }); // (the row itself, with its name: not the box round its titles)
      // The remote moves a title at a time and a script scrolls: nothing here is a scroll the page could notice from far off, so the library is asked for more as the remote nears the end,
      // of the page (the rows that come next) and of the row (more of its titles).
      const { homeRows: laid, view: page, pageSection: section, growing: more } = latest.current;
      const row = laid[pos.row];
      if (status === "ready" && isRowsPage(page) && pos.row >= laid.length - ROWS_AHEAD) feed.loadShelves(section);
      if (row && row.layout === "wide" && more.has(row.id) && pos.col >= row.entries.length - TITLES_AHEAD) feed.loadMore(row.id, ROW_CAP);
    } else {
      const container = element.closest<HTMLElement>(".tv-grid");
      if (container) keepInView(container, element);
      const { view: page, shape: laid } = latest.current;
      if (page.kind === "category" && pos.zone === "grid" && pos.row >= (laid.grid?.length ?? 0) - ROWS_AHEAD) feed.loadMore(page.rowId, GRID_CAP);
    }

    window.clearTimeout(bannerTimer.current);
    if (!focused) setFocused(now);
    else bannerTimer.current = window.setTimeout(() => setFocused(now), BANNER_DELAY_MS);
  };

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };
  /** Plays a title, or when it is a show's own page that asks, the episode it leads to (`at`), from where that was left. */
  const playEntry = (entry: Entry, at?: Pick<Start, "url" | "startAt">) => {
    remembered.detail = detail && series.isShow ? { page: detail, season: series.season } : null; // the library comes back to a show's page, to pick the next episode from it
    const startAt = at ? at.startAt : entry.startAt;
    onPlay(new URL(at?.url ?? entry.resumeUrl ?? entry.url, location.href).href, { hint: hintOf(entry), ...(startAt ? { startAt } : {}) });
  };
  /**
   * Asks a friend to watch together: they get a request with a button that starts a party and invites us. `ended` is the invitation to a party
   * that is over, if that is where this was pressed: once the friend is asked it is of no more use.
   */
  const askToWatch = async (friendId: string, ended?: string) => {
    const name = nameOf(friends.state?.friends ?? [], friendId);
    try {
      const answer = await friends.send([friendId], { kind: "together" });
      say(answer.sent.length > 0 ? t("friends.askSent", { name }) : t("friends.declined", { names: name }));
      if (answer.sent.length > 0 && ended) {
        await friends.dismiss(ended);
        setFocused(null); // (the card the remote was on is gone)
        go(CONTENT);
      }
    } catch (error) {
      say(describeError(error));
    }
  };

  // A category opens its page; a title opens its own page, where it is played or kept in a list (the banner's buttons do the same without it).
  // A tile of the friends page may instead join the party it stands for, start one a friend asked for, ask for one, or open a page of its own over the library.
  const press = (title: Focused, from: Target) => {
    const { entry } = title;
    if (entry.action) return setOverlay({ kind: entry.action, back: from });
    if (entry.request) return setOverlay({ kind: "friendRequest", person: entry.request, back: from });
    if (entry.plan) return setOverlay({ kind: "plan", id: entry.plan, back: from });
    if (entry.chat) return setOverlay({ kind: "chat", friend: entry.chat, back: from });
    if (entry.party) return onJoinParty(entry.party);
    if (entry.wants) return onStartTogether(entry.wants);
    if (entry.ask) return void askToWatch(entry.ask, entry.inboxId);
    if (!entry.opens) return openDetail(title);
    // (A category opened from the list of every category goes back to that list, not home.)
    return choose(entry.opens.kind === "category" && view.kind === "categories" ? { ...entry.opens, from: "categories" } : entry.opens);
  };

  /**
   * The small round button in a title's corner, for a mouse (the banner's buttons and a title's own page do the same for the remote):
   * ＋ keeps the title in the first list at once, however many lists there are; × lets it go from the list its row or page is, or clears
   * a card off Continue watching. A category has none.
   */
  const cornerOf = (entry: Entry, listId: string | undefined): Corner | undefined => {
    if (entry.opens || !entry.url) return undefined;
    const sent = entry.inboxId;
    if (sent) {
      // (What a friend sent: the cross sends it away.)
      return {
        kind: "clear",
        label: t("friends.dismiss"),
        run: () => {
          void friends.dismiss(sent).catch(() => undefined);
          if (shown?.entry.inboxId === sent) setFocused(null);
        },
      };
    }
    const key = entry.progressKey;
    if (key) {
      return {
        kind: "clear",
        label: t("rows.remove"),
        run: () => {
          profileStore.removeProgress(key);
          if (shown?.entry.progressKey === key) setFocused(null); // (the banner would go on showing a card that is gone)
        },
      };
    }
    const info = lists.find((each) => each.id === listId) ?? lists[0]!;
    const kept = inList(entry, info.id);
    return { kind: kept ? "kept" : "add", label: t(kept ? "rows.removeFromList" : "library.addToList", { list: listName(info) }), run: () => profileStore.setInList(listEntryOf(entry), !kept, info.id) };
  };

  const tile = (entry: Entry, pos: Pos, label: string, layout: Layout, source?: string, listId?: string) => {
    const title: Focused = { entry: resumable(entry, progress), label, ...(source ? { source } : {}) };
    // The score this profile gave the title shows on its picture wherever the title is in the library. (Not on a friend's page, where a
    // title's own line already says what that friend gave it, and not on the list of ratings, which is all of them.)
    const score = view.kind !== "ratings" && view.kind !== "friend" ? scoreOf(scores, entry.url) : undefined;
    return <Tile key={`${pos.zone}-${entry.id}`} entry={entry} layout={layout} compact={compact} rank={pos.col + 1} pos={pos} corner={cornerOf(entry, listId)} score={score} onArrive={(element) => arrived(element, pos, title)} onPress={() => press(title, pos)} />;
  };

  /** An episode of the show whose page is open. */
  const playEpisode = (episode: PageEpisode) => detail && playEntry(detail.entry, episode);
  /** The remote moved onto a button of the page: the page follows it (back to the top for the title's own buttons), as the rows and grids do. */
  const scrollPage = (event: FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!target.matches(":focus-visible")) return; // a press with the mouse or a finger needs no help, and a page that moved under it would lose the click
    if (target.closest(".tv-detail-hero")) event.currentTarget.scrollTo({ top: 0, behavior: "smooth" });
    else keepInView(event.currentTarget, target, event.currentTarget.clientHeight * 0.22);
  };

  const doAction = (action: HeroAction, entry: Entry | undefined = shown?.entry, from: Target = CONTENT, at?: Start) => {
    if (!entry) return;
    if (action === "play") playEntry(entry, at);
    else if (action === "rate") setOverlay({ kind: "rate", entry, back: from, isShow: series.isShow, seasons: series.seasons, shown: series.season, episodes: series.episodes?.length });
    else if (action === "recommend") setOverlay({ kind: "recommend", entry, back: from });
    else if (action === "join") {
      if (entry.party) onJoinParty(entry.party);
    } else if (action === "start") {
      if (entry.wants) onStartTogether(entry.wants);
    } else if (action === "ask") {
      if (entry.ask) void askToWatch(entry.ask, entry.inboxId);
    } else if (action === "dismiss") {
      if (!entry.inboxId) return;
      void friends.dismiss(entry.inboxId).catch(() => undefined);
      setFocused(null);
      if (detail) closeDetail();
      else go(CONTENT);
    } else if (action === "list") {
      if (several) setOverlay({ kind: "pick", entry, back: from });
      else profileStore.setInList(listEntryOf(entry), !isSaved(entry));
    } else if (entry.progressKey) {
      profileStore.removeProgress(entry.progressKey);
      setFocused(null);
      if (detail) closeDetail();
      else go(CONTENT);
    }
  };

  /** What a button says for a title; a title's own page spells out what the list button does, where the banner has room for the name only. */
  const labelOf = (action: HeroAction, entry: Entry, spelled: boolean): ReactNode => {
    if (action === "play") {
      // A show's own page says which episode: "Play S1:E1", "Resume S2:E5".
      const at = spelled ? series.start : undefined;
      return (
        <>
          <PlayIcon /> {at ? t(at.startAt !== undefined ? "series.resume" : "series.play", { season: at.season, episode: at.episode }) : entry.startAt !== undefined ? t("rows.resume") : t("rows.play")}
        </>
      );
    }
    if (action === "remove") {
      return (
        <>
          <CloseIcon /> {t("rows.remove")}
        </>
      );
    }
    if (action === "rate") {
      const given = ratingFor(ratings, entry.url);
      return (
        <>
          <StarIcon filled={given !== undefined} /> {given ? `${given.score}/10` : t("rating.rate")}
        </>
      );
    }
    if (action === "recommend") {
      return (
        <>
          <UsersIcon /> {t("friends.recommend")}
        </>
      );
    }
    if (action === "dismiss") {
      return (
        <>
          <CloseIcon /> {t("friends.dismiss")}
        </>
      );
    }
    if (action === "join") {
      return (
        <>
          <PlayIcon /> {t("friends.join")}
        </>
      );
    }
    if (action === "ask" || action === "start") {
      return (
        <>
          <UsersIcon /> {t(action === "ask" ? "friends.askTogether" : "friends.startParty")}
        </>
      );
    }
    const kept = isSaved(entry);
    const only = listName(lists[0]!);
    const text = spelled
      ? several
        ? t(kept ? "rows.inLists" : "library.addToAList")
        : t(kept ? "rows.removeFromList" : "library.addToList", { list: only })
      : several
        ? t("rows.myList")
        : only;
    return (
      <>
        {kept ? <CheckIcon /> : <PlusIcon />} {text}
      </>
    );
  };

  return (
    <section className="tv-browse" ref={rootRef} data-testid="tv-browse" data-view={viewKey(view)} data-deep={deep} aria-label={t("tv.library")}>
      {/* (A phone has no banner for a picture to be behind: it does not ask for the big one.) */}
      <Backdrop image={compact ? undefined : (shown?.entry.backdrop ?? shown?.entry.image)} />
      <div className="tv-browse-shade" />

      <Rail open={railOpen} onOpen={setRailOpen} entries={entries} bar={compact} onArrive={(element) => !compact && keepInView(element.closest<HTMLElement>(".tv-rail")!, element)} />

      <header className="tv-browse-top">
        <span className="tv-browse-logo">
          <Logo />
        </span>
        {notice && !detail && (
          <p className="tv-notice" role="alert" data-testid="tv-notice">
            {notice}
          </p>
        )}
        <div className="tv-browse-corner">
          {wayBack && <BackButton onClick={() => choose(wayBack)} testId="tv-page-back" col={0} />}
          {showBell && <BellChip onOpen={() => setOverlay({ kind: "bell", back: { zone: "top", row: 0, col: lead } })} col={lead} />}
          {showAccount && <AccountChip onOpen={() => choose({ kind: "profile" })} current={isProfilePage(view)} zone col={lead + (showBell ? 1 : 0)} />}
          {showCat && <CatChip col={lead + (showBell ? 1 : 0) + (showAccount ? 1 : 0)} />}
          <FullscreenToggle className="tv-corner-button" data={{ "data-zone": "top", "data-row": 0, "data-col": lead + (showBell ? 1 : 0) + (showAccount ? 1 : 0) + (showCat ? 1 : 0) }} />
        </div>
      </header>

      {rowsPage && (
        <>
          {sectionButtons && (
            // (Where the menu of a TV has a line for each section: a row of buttons, the one for the page that is shown lit. Choosing one is like choosing a list: the remote stays on the buttons.)
            <div className="tv-filters tv-sections" role="radiogroup" aria-label={t("tv.sections")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              {SECTION_CHIPS.map((chip, col) => (
                <button
                  key={chip.kind}
                  className="tv-choice"
                  role="radio"
                  aria-checked={view.kind === chip.kind}
                  data-testid={`section-${chip.kind}`}
                  data-zone="chips"
                  data-row={0}
                  data-col={col}
                  onClick={() => selectSection({ kind: chip.kind })}
                  onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col })}
                >
                  {t(chip.label)}
                </button>
              ))}
            </div>
          )}
          <div className={`tv-hero${view.kind === "profile" ? " tv-hero-profile" : ""}`} data-testid="tv-hero">
            {view.kind === "profile" ? (
              <ProfileHead
                name={signedIn && profile ? profile.name : t("profile.guest")}
                avatar={signedIn ? profile?.avatar : undefined}
                line={me ? t("account.signedInAs", { email: me.account.email }) : canSignIn ? t("auth.pitchDetail") : ""}
                signedIn={signedIn}
                canSignIn={canSignIn}
                onSignIn={onSignIn}
                onSettings={onSettings}
                onArrive={(col) => (remembered.focus[viewKey(view)] = { zone: "hero", row: 0, col })}
                places={places}
              />
            ) : shown && !compact ? (
              <div className="tv-hero-text" key={shown.entry.id}>
                <p className="tv-hero-eyebrow" data-testid="tv-hero-eyebrow">{shown.entry.opens?.kind === "category" || shown.entry.opens?.kind === "categories" ? t("tv.byCategory") : shown.label}</p>
                <h1 className="tv-hero-title" data-testid="tv-hero-title">
                  {shown.entry.title}
                </h1>
                <p className="tv-hero-meta">{[shown.entry.year, shown.entry.note, shown.entry.opens ? shown.entry.source : (shown.source ?? undefined)].filter(Boolean).join("  ·  ")}</p>
                {shown.entry.description && <p className="tv-hero-about">{shown.entry.description}</p>}
                <div className="tv-hero-actions">
                  {actions.map((action, col) => (
                    <button
                      key={action}
                      className={`tv-hero-button${action === "play" ? " is-primary" : ""}`}
                      data-testid={`tv-hero-${action}`}
                      data-zone="hero"
                      data-row={0}
                      data-col={col}
                      aria-pressed={action === "list" ? isSaved(shown.entry) : undefined}
                      onClick={() => doAction(action, undefined, { zone: "hero", row: 0, col })}
                    >
                      {labelOf(action, shown.entry, false)}
                    </button>
                  ))}
                </div>
              </div>
            ) : shown ? null /* (a phone has no room for the banner's words: a title is read on its own page, which a tap opens) */ : status === "loading" ? (
              <p className="tv-hero-eyebrow">{t("tv.loadingLibrary")}</p>
            ) : sectionWaiting ? (
              <p className="tv-hero-eyebrow">{t("tv.loadingLibrary")}</p>
            ) : kindEmpty ? (
              <>
                <h1 className="tv-hero-title tv-hero-status">
                  {t(view.kind === "movies" ? "tv.kindEmptyMovies" : view.kind === "series" ? "tv.kindEmptySeries" : view.kind === "cartoons" ? "tv.kindEmptyCartoons" : "tv.kindEmptyAnime")}
                </h1>
                <p className="tv-hero-about">{t("tv.kindEmptyHelp")}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={() => choose({ kind: "home" })} autoFocus data-testid="tv-browse-home" data-zone="rows" data-row={0} data-col={0}>
                    {t("tv.home")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="tv-hero-title tv-hero-status">{status === "failed" ? t("tv.libraryFailed") : t("tv.libraryEmpty")}</h1>
                <p className="tv-hero-about">{status === "failed" ? t("tv.libraryFailedHelp") : t("tv.libraryEmptyHelp")}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={retry} autoFocus data-testid="tv-browse-retry" data-zone="rows" data-row={0} data-col={0}>
                    {t("common.retry")}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="tv-rows" ref={rowsRef} onScroll={askShelves}>
            {homeRows.length > 0
              ? homeRows.map((row, r) => (
                  <section className="tv-row" key={row.id} data-layout={row.layout} aria-label={row.title}>
                    <h2 className="tv-row-title">{row.title}</h2>
                    <RowTiles {...(row.layout === "wide" && growing.has(row.id) ? { onNearEnd: () => feed.loadMore(row.id, ROW_CAP), loading: loadingTitles(feeding, row.id) } : {})}>
                      {row.entries.map((entry, c) => tile(entry, { zone: "rows", row: r, col: c }, row.title, row.layout, row.source, listOfRow(row.id)))}
                    </RowTiles>
                  </section>
                ))
              : status === "loading" && (
                  <section className="tv-row" aria-hidden="true">
                    <h2 className="tv-row-title tv-skeleton-title" />
                    <div className="tv-row-tiles">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div className="tv-tile tv-skeleton" key={i} />
                      ))}
                    </div>
                  </section>
                )}
            {/* Under the last row: empty tiles while the rows that come next are on their way, and a line when they could not be had (they are asked for again in a moment). */}
            {homeRows.length > 0 && isRowsPage(view) && failedShelves(feeding, pageSection) && (
              <p className="tv-rows-note" role="status" data-testid="tv-rows-failed">
                {t("rows.moreFailed")}
              </p>
            )}
            {homeRows.length > 0 && isRowsPage(view) && loadingShelves(feeding, pageSection) && (
              <section className="tv-row tv-row-waiting" aria-hidden="true" data-testid="tv-rows-waiting">
                <h2 className="tv-row-title tv-skeleton-title" />
                <div className="tv-row-tiles">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div className="tv-tile tv-skeleton" key={i} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {grid && (
        <div className="tv-view" data-testid={view.kind === "category" ? "tv-category" : `tv-${view.kind}`}>
          <h1 className="tv-view-title" data-testid="tv-view-title">
            {grid.title}
          </h1>
          {grid.meta && <p className="tv-view-meta">{grid.meta}</p>}
          {grid.hint && (
            <p className="tv-view-hint" data-testid="tv-view-hint">
              {grid.hint}
            </p>
          )}
          {view.kind === "list" && !canAdd && (
            <p className="tv-view-meta" data-testid="lists-full">
              {t("lists.full", { count: MAX_LISTS })}
            </p>
          )}
          {view.kind === "list" && (
            <div className="tv-filters" role="radiogroup" aria-label={t("rows.myList")} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              {lists.map((info, col) => (
                <button
                  key={info.id}
                  className="tv-choice"
                  role="radio"
                  aria-checked={info.id === shownId}
                  data-testid={`list-chip-${info.id}`}
                  data-zone="chips"
                  data-row={0}
                  data-col={col}
                  onClick={() => selectList(info.id)}
                  onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col })}
                >
                  {listName(info)}
                </button>
              ))}
              {canAdd && (
                <button
                  className="tv-choice"
                  data-testid="list-new"
                  data-zone="chips"
                  data-row={0}
                  data-col={lists.length}
                  onClick={() => setOverlay({ kind: "edit", id: null, back: { zone: "chips", row: 0, col: lists.length } })}
                  onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: lists.length })}
                >
                  <PlusIcon /> {t("lists.new")}
                </button>
              )}
              <button
                className="tv-choice"
                data-testid="list-edit"
                data-zone="chips"
                data-row={0}
                data-col={lists.length + (canAdd ? 1 : 0)}
                onClick={() => setOverlay({ kind: "edit", id: shownId, back: { zone: "chips", row: 0, col: lists.length + (canAdd ? 1 : 0) } })}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: lists.length + (canAdd ? 1 : 0) })}
              >
                <PencilIcon /> {t("lists.edit")}
              </button>
            </div>
          )}
          {view.kind === "friend" && friend && (
            <div className="tv-filters tv-filters-friend" role="radiogroup" aria-label={friend.name} onFocus={(event) => slideIntoView(event.target as HTMLElement)}>
              <button
                className="tv-choice"
                data-testid="tv-friend-back"
                data-zone="chips"
                data-row={0}
                data-col={0}
                onClick={() => choose({ kind: "friends" })}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 0 })}
              >
                <ChevronIcon className="flip" /> {t("common.back")}
              </button>
              {FRIEND_TABS.map((value, index) => (
                <button
                  key={value}
                  className="tv-choice"
                  role="radio"
                  aria-checked={friendTab === value}
                  data-testid={`friend-tab-${value}`}
                  data-zone="chips"
                  data-row={0}
                  data-col={1 + index}
                  onClick={() => selectTab(friend.id, value)}
                  onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 1 + index })}
                >
                  {t(value === "lists" ? "friends.tabLists" : "friends.tabRatings")}
                </button>
              ))}
              {canAskTogether(friend) && (
                <>
                  <button
                    className="tv-choice"
                    data-testid="friend-together"
                    data-zone="chips"
                    data-row={0}
                    data-col={1 + FRIEND_TABS.length}
                    onClick={() => void askToWatch(friend.id)}
                    onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 1 + FRIEND_TABS.length })}
                  >
                    <UsersIcon /> {t("friends.askTogether")}
                  </button>
                  <button
                    className="tv-choice"
                    data-testid="friend-plan"
                    data-zone="chips"
                    data-row={0}
                    data-col={2 + FRIEND_TABS.length}
                    onClick={() => setOverlay({ kind: "planPick", friend: friend.id, back: { zone: "chips", row: 0, col: 2 + FRIEND_TABS.length } })}
                    onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: 2 + FRIEND_TABS.length })}
                  >
                    <ClockIcon /> {t("friends.planButton")}
                  </button>
                </>
              )}
              {/* (Last, so that the others keep their places: a friend who does not take invitations still has a chat.) */}
              <button
                className="tv-choice"
                data-testid="friend-chat"
                data-zone="chips"
                data-row={0}
                data-col={chatChip}
                onClick={() => setOverlay({ kind: "chat", friend: friend.id, back: { zone: "chips", row: 0, col: chatChip } })}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "chips", row: 0, col: chatChip })}
              >
                <MessageIcon /> {t("chat.open")}
                {waitingFrom(friends.state, friend.id) > 0 && <small data-testid="friend-chat-unread"> · {waitingFrom(friends.state, friend.id)}</small>}
              </button>
            </div>
          )}
          {grid.entries.length > 0 ? (
            <div className="tv-grid" ref={gridRef} onScroll={askTitles} style={{ "--cols": gridColumns } as CSSProperties}>
              {grid.entries.map((entry, i) => tile(entry, { zone: "grid", row: Math.floor(i / gridColumns), col: i % gridColumns }, grid.title, grid.layout, undefined, view.kind === "list" ? shownId : undefined))}
              {/* (A category goes on with its titles as it is scrolled: empty tiles hold the place of the next ones.) */}
              {view.kind === "category" &&
                loadingTitles(feeding, view.rowId) &&
                Array.from({ length: gridColumns }, (_, i) => <div className="tv-tile tv-skeleton" data-testid="tv-grid-waiting" aria-hidden="true" key={`waiting-${i}`} />)}
            </div>
          ) : (
            <p className="tv-view-empty" data-testid="tv-view-empty">
              {grid.empty}
            </p>
          )}
          {view.kind === "friend" && friend && (
            <div className="tv-view-foot">
              <button
                className="tv-choice tv-choice-danger"
                data-testid="friend-remove"
                data-zone="foot"
                data-row={0}
                data-col={0}
                onClick={() => setOverlay({ kind: "unfriend", id: friend.id, name: friend.name, back: { zone: "foot", row: 0, col: 0 } })}
                onFocus={() => (remembered.focus[viewKey(view)] = { zone: "foot", row: 0, col: 0 })}
              >
                <CloseIcon /> {t("friends.remove")}
              </button>
            </div>
          )}
        </div>
      )}

      {view.kind === "search" && (
        <div className="tv-search" data-testid="tv-search">
          <div className="tv-search-side">
            {narrow ? (
              <input
                className="tv-query"
                data-testid="tv-query"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                placeholder={t("tv.searchHint")}
                aria-label={t("tv.search")}
                value={query}
                onChange={(event) => setBox({ text: event.target.value, caret: event.target.value.length })}
              />
            ) : (
              <>
                <SearchField box={box} hint={t("tv.searchHint")} onPlace={(caret) => edit({ kind: "move", to: caret })} />
                <div className="tv-keys" role="group" aria-label={t("tv.keyboard")}>
                  {KEYBOARD_KEYS.map((key, i) => (
                    <Key key={key} testId={`key-${key}`} pos={{ zone: "keys", row: Math.floor(i / KEYBOARD_COLUMNS), col: i % KEYBOARD_COLUMNS }} onPress={() => edit({ kind: "type", char: key })}>
                      {key}
                    </Key>
                  ))}
                  {/* Under the letters: the caret's two keys, Space (two columns wide), and the two that take letters out (one, and all of them). */}
                  <Key testId="key-left" label={t("tv.caretLeft")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 0 }} onPress={() => edit({ kind: "move", to: "left" })}>
                    <ChevronLeftIcon />
                  </Key>
                  <Key testId="key-right" label={t("tv.caretRight")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 1 }} onPress={() => edit({ kind: "move", to: "right" })}>
                    <ChevronIcon />
                  </Key>
                  <Key testId="key-space" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 2 }} onPress={() => edit({ kind: "type", char: " " })}>
                    {t("tv.space")}
                  </Key>
                  <Key testId="key-delete" label={t("tv.delete")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 3 }} onPress={() => edit({ kind: "backspace" })}>
                    <BackspaceIcon />
                  </Key>
                  <Key testId="key-clear" label={t("tv.clear")} pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 4 }} onPress={() => edit({ kind: "clear" })}>
                    <ClearIcon />
                  </Key>
                </div>
              </>
            )}
          </div>
          <div className="tv-search-main">
            <div className="tv-filters" role="radiogroup" aria-label={t("tv.search")}>
              {SECTION_FILTERS.map((value, col) => {
                const pos: Pos = { zone: "chips", row: 0, col };
                return (
                  <button
                    key={value}
                    className="tv-choice"
                    role="radio"
                    aria-checked={filter === value}
                    data-testid={`filter-${value}`}
                    data-zone={pos.zone}
                    data-row={pos.row}
                    data-col={pos.col}
                    onClick={() => setFilter(value)}
                    onFocus={() => (remembered.focus.search = pos)}
                  >
                    {t(value === "all" ? "tv.filterAll" : value === "movie" ? "tv.filterMovies" : value === "series" ? "tv.filterSeries" : value === "cartoon" ? "tv.filterCartoons" : "tv.filterAnime")}
                  </button>
                );
              })}
            </div>
            <p className="tv-view-meta" data-testid="tv-search-status">
              {!query.trim()
                ? t("tv.typeToSearch")
                : shownResults.length > 0
                  ? `${shownAnswers.exact > 0 ? t("tv.found", { count: shownAnswers.exact, query: query.trim() }) : t("tv.closestOnly", { query: query.trim() })}${searchFailed ? t("tv.searchOffline") : searching ? t("tv.stillLooking") : ""}`
                  : searchFailed
                    ? t("tv.searchFailed")
                    : searching
                      ? t("tv.looking")
                      : t("tv.nothingMatches", { query: query.trim() })}
            </p>
            <div className="tv-grid tv-results" style={{ "--cols": resultColumns } as CSSProperties}>
              {shownResults.map((item, i) => {
                // The titles with every word typed come first; under a heading of their own, the closest others (see `resultRowsOf`).
                const close = i >= shownAnswers.exact;
                const at = close ? i - shownAnswers.exact : i;
                const row = Math.floor(at / resultColumns) + (close ? Math.ceil(shownAnswers.exact / resultColumns) : 0);
                return (
                  <Fragment key={item.id}>
                    {i === shownAnswers.exact && i > 0 && (
                      <h2 className="tv-results-closest" data-testid="tv-closest">
                        {t("tv.closest")}
                      </h2>
                    )}
                    {tile(entryOfItem(item), { zone: "results", row, col: at % resultColumns }, t("tv.search"), "wide")}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {detail && (
        // A tap on the empty part of the page closes it, as Back does.
        <div className="tv-detail" role="dialog" aria-modal="true" aria-label={detail.entry.title} data-testid="tv-detail" data-show={series.isShow} data-art={Boolean(detail.entry.backdrop ?? detail.entry.image)} onClick={(event) => event.target === event.currentTarget && closeDetail()}>
          {!compact && <DetailArt image={detail.entry.backdrop ?? detail.entry.image} />}
          {/* The page scrolls (a show's episodes lie under what a film's page is all of); the picture and the Close button stay. (On a phone held upright the picture is the page's own, at its top, and goes up with it.) */}
          <div className="tv-detail-scroll" onClick={(event) => event.target === event.currentTarget && closeDetail()} onFocus={scrollPage}>
            {compact && <DetailArt image={detail.entry.backdrop ?? detail.entry.image} />}
            <div className="tv-detail-hero" onClick={(event) => event.target === event.currentTarget && closeDetail()}>
              <div className="tv-detail-text">
                <p className="tv-hero-eyebrow">{detail.label}</p>
                <h1 className="tv-detail-title" data-testid="tv-detail-title">
                  {detail.entry.title}
                </h1>
                <p className="tv-hero-meta">{[detail.entry.year, detail.entry.note, detail.source].filter(Boolean).join("  ·  ")}</p>
                {detail.entry.description && <p className="tv-detail-about">{detail.entry.description}</p>}
                <div className="tv-hero-actions">
                  {overviewActions(detail.entry, ratingsOn, friends.on).map((action, col) => (
                    <button
                      key={action}
                      className={`tv-hero-button${action === "play" ? " is-primary" : ""}`}
                      data-testid={`tv-detail-${action}`}
                      data-zone="detail"
                      data-row={0}
                      data-col={col}
                      aria-pressed={action === "list" ? isSaved(detail.entry) : undefined}
                      onClick={() => doAction(action, detail.entry, { zone: "detail", row: 0, col }, series.start)}
                    >
                      {labelOf(action, detail.entry, true)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {series.isShow && <SeriesSection page={series} onPlay={playEpisode} onSlide={slideIntoView} />}
          </div>
          <button className="tv-hero-button tv-detail-close" onClick={closeDetail} data-testid="tv-detail-close" data-zone="close" data-row={0} data-col={0}>
            <CloseIcon /> {t("common.close")}
          </button>
          {notice && (
            // (The library's own line is under this page: an episode that would not play is said here, where the next one is picked.)
            <p className="tv-notice tv-detail-notice" role="alert" data-testid="tv-notice">
              {notice}
            </p>
          )}
        </div>
      )}

      {overlay?.kind === "pick" && (
        <Screen testId="tv-list-picker" compact focus onBack={closeOverlay}>
          <h1 className="tv-headline tv-headline-small">{t("library.addToAList")}</h1>
          <p className="tv-lead">{overlay.entry.title}</p>
          <div className="tv-list-picks" role="group" aria-label={t("library.addToAList")}>
            {lists.map((info) => {
              const has = inList(overlay.entry, info.id);
              return (
                <button key={info.id} className="tv-action" aria-pressed={has} data-nav data-testid={`pick-${info.id}`} onClick={() => profileStore.setInList(listEntryOf(overlay.entry), !has, info.id)}>
                  {has ? <CheckIcon /> : <PlusIcon />} {listName(info)}
                </button>
              );
            })}
            {canAdd && (
              <button className="tv-action tv-action-new" onClick={() => setOverlay({ kind: "edit", id: null, back: overlay.back, from: overlay })} data-nav data-testid="pick-new">
                <PlusIcon /> {t("lists.new")}
              </button>
            )}
          </div>
          {!canAdd && (
            <p className="tv-view-meta" data-testid="lists-full">
              {t("lists.full", { count: MAX_LISTS })}
            </p>
          )}
          <div className="tv-actions">
            {/* (A list just made from here has the title in it: the remote lands on Done.) */}
            <button className="tv-action tv-action-primary" onClick={closeOverlay} data-nav data-testid="pick-done" {...(overlay.fresh ? { "data-autofocus": true } : {})}>
              {t("common.done")}
            </button>
          </div>
        </Screen>
      )}

      {overlay?.kind === "rate" && (
        <RateOverlay entry={overlay.entry} isShow={overlay.isShow} seasons={overlay.seasons} shown={overlay.shown} episodes={overlay.episodes} onClose={closeOverlay} />
      )}

      {overlay?.kind === "recommend" && <FriendPickerTv title={t("friends.sendTitle")} lead={overlay.entry.title} build={() => recommendationOf(overlay.entry)} said="friends.sent" onClose={closeOverlay} />}
      {overlay?.kind === "addFriend" && <AddFriendTv onClose={closeOverlay} />}
      {overlay?.kind === "friendSettings" && <FriendSettingsTv onClose={closeOverlay} />}
      {overlay?.kind === "friendRequest" && <FriendRequestTv person={overlay.person} onClose={closeOverlay} />}
      {overlay?.kind === "plan" && (
        <PlanTv
          id={overlay.id}
          onStartParty={(friendId) => {
            setOverlay(null);
            onStartTogether(friendId);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "planPick" && <PlanPickerTv friendId={overlay.friend} onClose={closeOverlay} />}
      {overlay?.kind === "chat" && <TvChat key={overlay.friend} friendId={overlay.friend} narrow={narrow} onClose={closeOverlay} />}
      {overlay?.kind === "bell" && (
        <NotificationsTv
          onPress={(entry) => {
            // (What a line does is what the same tile of the friends page does; the list is gone behind it, and a request's window or a title's page comes up in its place.)
            setOverlay(null);
            press({ entry: resumable(entry, progress), label: t("bell.title") }, overlay.back);
          }}
          onFriends={() => {
            setOverlay(null);
            choose({ kind: "friends" });
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === "unfriend" && (
        <UnfriendTv
          id={overlay.id}
          name={overlay.name}
          onCancel={closeOverlay}
          onGone={() => {
            setOverlay(null);
            choose({ kind: "friends" });
          }}
        />
      )}

      {overlay?.kind === "edit" && (
        <Screen testId="tv-list-edit" compact focus onBack={leaveEdit}>
          <h1 className="tv-headline tv-headline-small">{t(overlay.id ? "lists.edit" : "lists.new")}</h1>
          <ListEditor
            tv
            list={lists.find((info) => info.id === overlay.id)}
            taken={lists.filter((info) => info.id !== overlay.id).map(listName)}
            onSave={(name) => {
              if (overlay.id) {
                profileStore.renameList(overlay.id, name);
                return closeOverlay();
              }
              const made = profileStore.createList(name);
              if (overlay.from) {
                if (made) profileStore.setInList(listEntryOf(overlay.from.entry), true, made);
                return setOverlay({ ...overlay.from, fresh: true });
              }
              if (!made) return closeOverlay();
              selectList(made); // the new list is the last button
              setOverlay(null);
              setPending({ zone: "chips", row: 0, col: lists.length });
            }}
            onCancel={leaveEdit}
            {...(editedAt > 0 && lists.length > 2
              ? { onMove: (by: -1 | 1) => profileStore.moveList(editedId!, by), canMoveEarlier: editedAt > 1, canMoveLater: editedAt < lists.length - 1 }
              : {})}
            onDelete={
              overlay.id && overlay.id !== DEFAULT_LIST
                ? () => {
                    profileStore.deleteList(overlay.id!);
                    selectList(DEFAULT_LIST);
                    setOverlay(null);
                    setPending({ zone: "chips", row: 0, col: 0 });
                  }
                : undefined
            }
          />
        </Screen>
      )}
    </section>
  );
}

/**
 * The picture behind the banner. A new one is fetched and decoded first, and only then fades in over the one before it, so a slow
 * picture leaves the old one in place and then eases in, instead of fading while still empty and appearing all at once when it
 * arrives. The pictures it covers go once it is fully in. No picture (or one that cannot be had) fades to the plain background.
 */
function Backdrop({ image }: { image: string | undefined }) {
  const [layers, setLayers] = useState<Array<{ id: number; image: string | undefined }>>([]);
  const counter = useRef(0);
  useEffect(() => {
    let live = true;
    const show = (picture: string | undefined) => live && setLayers((now) => (now[now.length - 1]?.image === picture ? now : [...now.slice(-3), { id: ++counter.current, image: picture }]));
    if (!image) show(undefined);
    else {
      const loader = new Image();
      loader.src = image;
      const ready = loader.decode
        ? loader.decode()
        : new Promise<void>((resolve, reject) => {
            loader.onload = () => resolve();
            loader.onerror = reject;
          });
      ready.then(() => show(image), () => show(undefined));
    }
    return () => {
      live = false;
    };
  }, [image]);
  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className="tv-hero-bg"
          {...(layer.image ? { style: { backgroundImage: `url(${JSON.stringify(layer.image)})` } } : {})}
          onAnimationEnd={() => setLayers((now) => now.filter((other) => other.id >= layer.id))}
        />
      ))}
    </>
  );
}

/** The picture of a title's page, and the shade that lets what is written over it be read. */
function DetailArt({ image }: { image: string | undefined }) {
  return (
    <>
      <Backdrop image={image} />
      <div className="tv-browse-shade" />
    </>
  );
}

function Key({ children, pos, wide, label, testId, onPress }: { children: ReactNode; pos: Pos; wide?: boolean; /** What a key that is only a picture does: its name for a screen reader, and for a pointer resting on it. */ label?: string; testId: string; onPress: () => void }) {
  return (
    <button
      className={`tv-key${wide ? " tv-key-wide" : ""}`}
      {...(label ? { "aria-label": label, title: label } : {})}
      data-testid={testId}
      data-zone={pos.zone}
      data-row={pos.row}
      data-col={pos.col}
      onClick={onPress}
      onFocus={() => (remembered.focus.search = pos)}
    >
      {children}
    </button>
  );
}

/** The glyph of each place on the profile's page (a tile of colour and a name was all a place was: now it says what it holds). */
const PLACE_ICON: Record<string, ReactNode> = {
  "profile:ratings": <StarIcon />,
  "profile:friends": <UsersIcon />,
  "profile:history": <ClockIcon />,
};

/** The round button in a title's corner: what it is (its look), what it says, and what it does. */
interface Corner {
  /** ＋ keeps the title (in the first list), × on a kept one lets it go, × on a card clears it off Continue watching. */
  kind: "add" | "kept" | "clear";
  label: string;
  run: () => void;
}

/**
 * One title (or category) of a row, in the shape its row asks for. A phone held upright (`compact`) shows an upright poster for every title but the cards of
 * what is part way through, and has no room for the numbers of a ranking behind them: its titles are named like the others.
 */
function Tile({ entry, layout: asked, compact, rank, pos, corner, score, onArrive, onPress }: { entry: Entry; layout: Layout; compact: boolean; rank: number; pos: Pos; corner: Corner | undefined; score: number | undefined; onArrive: (element: HTMLElement) => void; onPress: () => void }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(entry.id);
  const layout: Layout = compact && asked === "ranked" ? "wide" : asked;
  // A ranking shows the upright poster; everything else is wide, and falls back to the poster when there is no wide picture.
  const picture = layout === "ranked" || (compact && layout === "wide") ? (entry.image ?? entry.backdrop) : (entry.backdrop ?? entry.image);
  const showPicture = picture && !broken;
  const common = {
    "data-zone": pos.zone,
    "data-row": pos.row,
    "data-col": pos.col,
    "data-entry": entry.id,
    // Pressed with the mouse, a title would take the focus at once, and the banner shrinks and the rows climb to make room for it
    // before the button is let go: the click would then come down on something else, and nothing would open. So the press takes
    // nothing, and the click takes the focus, then does what it is for.
    onMouseDown: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    onClick: (event: MouseEvent<HTMLElement>) => {
      // The corner is no button of its own (a button inside a button, and one more stop for the remote): a click on it does its one
      // thing and leaves the title alone, unopened and unfocused, so the next title can be kept at once.
      if (corner && (event.target as Element).closest("[data-corner]")) return corner.run();
      event.currentTarget.focus({ preventScroll: true });
      onPress();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => onArrive(event.currentTarget),
    title: entry.title,
  };

  if (layout === "categories") {
    const place = PLACE_ICON[entry.id];
    return (
      <button className={`tv-tile tv-tile-category${entry.avatar ? " tv-tile-person" : ""}${place ? " tv-tile-place" : ""}`} data-testid="tv-category-tile" {...common} style={{ "--hue": hue } as CSSProperties}>
        {showPicture && <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />}
        {place && (
          <span className="tv-place-icon" aria-hidden="true">
            {place}
          </span>
        )}
        {entry.avatar ? (
          <>
            <span className="tv-person-pic" data-online={entry.online ? "true" : undefined}>
              <Avatar id={entry.avatar} />
            </span>
            <span className="tv-person-text">
              <span className="tv-category-name">{entry.title}</span>
              {entry.note && <span className="tv-category-count">{entry.note}</span>}
            </span>
          </>
        ) : (
          <>
            <span className="tv-category-name">{entry.title}</span>
            {entry.note && <span className="tv-category-count">{entry.note}</span>}
          </>
        )}
      </button>
    );
  }

  const under = entry.note ?? entry.year;
  return (
    <button className={`tv-tile tv-tile-${layout}`} data-testid="tv-browse-tile" aria-label={layout === "ranked" ? entry.title : undefined} {...common}>
      {layout === "ranked" && (
        <span className={`tv-rank${rank > 9 ? " tv-rank-wide" : ""}`} aria-hidden="true">
          <b>{rank}</b>
        </span>
      )}
      <span className="tv-tile-body">
        <span className="tv-tile-art" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
          {showPicture ? (
            <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />
          ) : (
            <span className="tv-tile-initial" aria-hidden="true">
              {entry.title.trim().charAt(0).toUpperCase()}
            </span>
          )}
          {layout === "continue" && (
            <span className="tv-tile-play" aria-hidden="true">
              <PlayIcon />
            </span>
          )}
          {(entry.progress ?? 0) > 0 && (
            <span className="tv-tile-progress" aria-hidden="true">
              <i style={{ width: `${Math.round((entry.progress ?? 0) * 100)}%` }} />
            </span>
          )}
          {score !== undefined && <ScoreBadge score={score} />}
          {corner && (
            <span className="tv-tile-corner" data-corner={corner.kind} data-testid="tv-tile-corner" title={corner.label} aria-hidden="true">
              {corner.kind === "add" ? <PlusIcon /> : <CloseIcon />}
            </span>
          )}
        </span>
        {layout !== "ranked" && <span className="tv-tile-name">{entry.title}</span>}
        {layout !== "ranked" && under && <span className="tv-tile-year">{under}</span>}
      </span>
    </button>
  );
}
