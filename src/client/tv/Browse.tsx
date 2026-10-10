import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";
import { LibraryItemsSchema, LibrarySchema, listKey, type Library, type LibraryItem, type LibraryKind, type PlayHint } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { hintOf, listEntryOf } from "../account/cards";
import { profileStore, useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { BackspaceIcon, CheckIcon, ClockIcon, CloseIcon, FilmIcon, GearIcon, HomeIcon, PhoneIcon, PlayIcon, PlusIcon, SearchIcon, TvIcon, UsersIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { hueOf } from "../shared/Poster";
import { gridRows, stepFrom, type Pos, type Shape, type Target, type Zone } from "./browseNav";
import { AccountChip } from "./Idle";
import { actionForKey } from "./keys";
import { appendTo, KEYBOARD_COLUMNS, KEYBOARD_KEYS, KEYBOARD_SHAPE, matchLocal, mergeItems, typedCharacter } from "./librarySearch";
import { entryOfItem, freshSimilar, gridOf, heroActions, isRowsPage, KIND_FILTERS, ofKind, overviewActions, rowsOfPage, viewKey, type Entry, type HeroAction, type HomeRow, type KindFilter, type Layout, type PageData, type View } from "./pages";
import { Rail, type RailEntry } from "./Rail";

/** What a screen that starts a title can add: where to pick it up, and the picture and year the library already knows for it. */
export interface PlayOptions {
  startAt?: number;
  hint?: PlayHint;
}

interface BrowseProps {
  onPlay: (url: string, options?: PlayOptions) => void;
  /** The account button in the corner: signing in for a guest, the account page for somebody signed in. */
  onAccount: () => void;
  /** The menu's pages that are not the library: the settings, pairing a phone, and the watch party. */
  onSettings: () => void;
  onConnect: () => void;
  onParty: () => void;
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
  query: "",
  results: [] as LibraryItem[],
  /** The query `results` answers. */
  resultsFor: "",
  filter: "all" as KindFilter,
  /** Where the remote was on each page. */
  focus: {} as Record<string, Pos>,
  /** The row of a page of rows the remote was on (rows come and go as things are watched and saved, so a number is not enough). */
  row: {} as Record<string, string>,
  /** The titles like what a card is about, by the card's key. Nothing found is remembered too. */
  similar: {} as Record<string, LibraryItem[]>,
};

/** Wait this long on a title before the banner changes to it, so scrolling past many does not flicker through them. */
const BANNER_DELAY_MS = 200;
/** Wait this long after the last key before asking the server, so a word is one question and not one per letter. */
const SEARCH_DELAY_MS = 350;
const GRID_COLUMNS = 5;
const RESULT_COLUMNS = 3;
/** A phone, a tablet or a narrow window (the same width tv.css lays out for a hand-held screen): grids are as many titles wide as fit, and search is typed on the device's own keyboard. */
const NARROW = "(max-width: 899px)";
/** About how wide a title is on a hand-held screen, with the room around it. */
const NARROW_TILE_PX = 190;

/** How many titles wide a grid is on a hand-held screen, or 0 when the screen is wide enough for the TV's own layout. */
function useNarrowColumns(): number {
  const read = () => (matchMedia(NARROW).matches ? Math.max(2, Math.floor(innerWidth / NARROW_TILE_PX)) : 0);
  const [columns, setColumns] = useState(read);
  useEffect(() => {
    const update = () => setColumns(read());
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  return columns;
}
/** The menu lists this many categories of each kind before "More…". */
const RAIL_CATEGORIES = 4;

/** What the banner and the picture behind the screen show: the title the remote is on. */
interface Focused {
  entry: Entry;
  label: string;
  source?: string;
}

const CONTENT: Target = { zone: "content", row: -1, col: -1 };
const RAIL: Target = { zone: "rail", row: -1, col: -1 };
/** The first button of a title's own page: Play. */
const DETAIL: Target = { zone: "detail", row: 0, col: 0 };
/** Where the remote can start on a page, in the order they are tried. */
const CONTENT_ZONES: Zone[] = ["rows", "grid", "keys"];
/** What it can be put back on when a page is returned to. */
const RESTORABLE: Zone[] = [...CONTENT_ZONES, "chips", "results"];

const find = (root: ParentNode, pos: Pos) => root.querySelector<HTMLElement>(`[data-zone="${pos.zone}"][data-row="${pos.row}"][data-col="${pos.col}"]`);
function posOf(element: Element | null): Pos | null {
  if (!(element instanceof HTMLElement) || !element.dataset.zone) return null;
  return { zone: element.dataset.zone as Zone, row: Number(element.dataset.row), col: Number(element.dataset.col) };
}

/** Where the remote was on this page, with the row of a page of rows found again by name. */
function savedPos(view: View, rows: readonly HomeRow[]): Pos | undefined {
  const key = viewKey(view);
  const saved = remembered.focus[key];
  if (!saved) return undefined;
  if (!isRowsPage(view) || saved.zone !== "rows") return saved;
  const id = remembered.row[key];
  const row = rows.findIndex((candidate) => candidate.id === id);
  // A card that was watched moves to the front of "Continue watching", so its place there is the first.
  return row === -1 ? undefined : { zone: "rows", row, col: id === "continue" ? 0 : saved.col };
}

/** Scroll `container` just far enough that `element` shows with some room around it. */
function keepInView(container: HTMLElement, element: HTMLElement) {
  const room = parseFloat(getComputedStyle(container).fontSize) * 1.5;
  const box = container.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  if (at.top < box.top + room) container.scrollBy({ top: at.top - box.top - room, behavior: "smooth" });
  else if (at.bottom > box.bottom - room) container.scrollBy({ top: at.bottom - box.bottom + room, behavior: "smooth" });
}

/**
 * The library on the TV, laid out like a streaming app: a menu down the left (search, home, movies, series, My List, history, the
 * phone, settings, and the categories), the account button in the corner, and on the pages of rows a banner with Play and My List
 * for the title the remote is on, with the rows under it. The arrow keys walk everything; Left from the first title of any row opens
 * the menu, OK on a title opens its own page (play it, keep it in My List), and Back steps out: of that page, of the menu, then to
 * the home page, and from there into the menu.
 */
export function TvBrowse({ onPlay, onAccount, onSettings, onConnect, onParty, connected, partySize, notice }: BrowseProps) {
  const t = useT();
  const language = useLanguage();
  const { status: accountStatus } = useAccount();
  const { progress, list } = useProfileData();
  const narrowColumns = useNarrowColumns();
  const narrow = narrowColumns > 0;
  const gridColumns = narrowColumns || GRID_COLUMNS;
  const resultColumns = narrowColumns || RESULT_COLUMNS;
  const [library, setLibrary] = useState<Library | null>(remembered.library);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(remembered.library ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [view, setViewState] = useState<View>(remembered.view);
  const [query, setQuery] = useState(remembered.query);
  const [results, setResults] = useState<LibraryItem[]>(remembered.results);
  const [filter, setFilter] = useState<KindFilter>(remembered.filter);
  const [searching, setSearching] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [focused, setFocused] = useState<Focused | null>(null);
  /** The title whose own page is open over the library. */
  const [detail, setDetail] = useState<Focused | null>(null);
  /** The remote is on a row below the first, so the banner makes room for the rows. */
  const [deep, setDeep] = useState(false);
  /** Somewhere to put the focus once the next render has put it on screen. */
  const [pending, setPending] = useState<Target>(null);
  const newest = progress[0];
  const [similarItems, setSimilarItems] = useState<LibraryItem[]>(() => (newest ? (remembered.similar[newest.key] ?? []) : []));
  const bannerTimer = useRef<number>(0);
  const rootRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/library")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: unknown) => {
        const parsed = LibrarySchema.parse(data);
        if (!live) return;
        remembered.library = parsed;
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

  // "Because you watched ...": the server knows titles like the one this profile watched last.
  useEffect(() => {
    if (!newest) return setSimilarItems([]);
    const known = remembered.similar[newest.key];
    if (known) return setSimilarItems(known);
    let live = true;
    fetch(`/api/library/similar?url=${encodeURIComponent(newest.url)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        const parsed = LibraryItemsSchema.safeParse(data);
        const items = parsed.success ? parsed.data.items : [];
        remembered.similar[newest.key] = items;
        if (live) setSimilarItems(items);
      })
      .catch(() => {}); // not remembered, so the next visit asks again
    return () => {
      live = false;
    };
  }, [newest?.key]);

  const rows = useMemo(() => (library?.rows ?? []).filter((row) => row.items.length > 0), [library]);
  const hasTiles = status === "ready" && rows.length > 0;
  const similar = useMemo(() => {
    const items = newest ? freshSimilar(similarItems, progress, list) : [];
    return newest && items.length > 0 ? { title: newest.title, items } : null;
  }, [newest, similarItems, progress, list]);
  const data = useMemo<PageData>(() => ({ rows, progress, list, similar }), [rows, progress, list, similar]);

  const rowsPage = isRowsPage(view);
  // `language` is not read, but the rows' titles and notes are words in it
  /* eslint-disable react-hooks/exhaustive-deps */
  const homeRows = useMemo<HomeRow[]>(() => (isRowsPage(view) ? rowsOfPage(view.kind, data) : []), [view, data, language]);
  const grid = useMemo(() => gridOf(view, data), [view, data, language]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const shownResults = useMemo(() => ofKind(results, filter), [results, filter]);

  // Where the remote starts on a page of rows: the first title, or on a return from a film, the one it left.
  const homeFocus = rowsPage ? savedPos(view, homeRows) : undefined;
  const startRow = Math.min(homeFocus?.row ?? 0, Math.max(0, homeRows.length - 1));
  const startCol = Math.min(homeFocus?.col ?? 0, Math.max(0, (homeRows[startRow]?.entries.length ?? 1) - 1));
  const start = homeRows[startRow]?.entries[startCol];
  const shown: Focused | null = focused ?? (rowsPage && start ? { entry: start, label: homeRows[startRow]!.title, ...(homeRows[startRow]!.source ? { source: homeRows[startRow]!.source! } : {}) } : null);
  const actions = rowsPage ? heroActions(shown?.entry) : [];
  const saved = useMemo(() => new Set(list.map((entry) => entry.key)), [list]);
  const isSaved = (entry: Entry) => saved.has(listKey(entry.url));

  // Choosing a page shuts the menu at once. On a page with nothing to stand on (an empty list) the remote stays on the menu's line
  // for it, but the menu itself is closed; an arrow key opens it again.
  const choose = (next: View) => {
    remembered.view = next;
    setViewState(next);
    setFocused(null);
    setDetail(null);
    setDeep(false);
    setRailOpen(false);
    setPending(CONTENT);
  };
  /** A title's own page opens over the library, on Play; closing it puts the remote back on the title it came from. */
  const openDetail = (title: Focused) => {
    setDetail(title);
    setPending(DETAIL);
  };
  const closeDetail = () => {
    setDetail(null);
    setPending(CONTENT);
  };

  // The menu: the pages first, then the categories in a group each for films and for shows, a few of each with "More…" after them.
  const entries: RailEntry[] = [
    { id: "search", label: t("tv.search"), icon: <SearchIcon />, current: view.kind === "search", testId: "rail-search", onPress: () => choose({ kind: "search" }) },
    { id: "home", label: t("tv.home"), icon: <HomeIcon />, current: view.kind === "home", testId: "rail-home", onPress: () => choose({ kind: "home" }) },
    { id: "movies", label: t("tv.movies"), icon: <FilmIcon />, current: view.kind === "movies", testId: "rail-movies", onPress: () => choose({ kind: "movies" }) },
    { id: "series", label: t("tv.series"), icon: <TvIcon />, current: view.kind === "series", testId: "rail-series", onPress: () => choose({ kind: "series" }) },
    { id: "list", label: t("rows.myList"), icon: <PlusIcon />, current: view.kind === "list", testId: "rail-list", onPress: () => choose({ kind: "list" }) },
    { id: "history", label: t("tv.history"), icon: <ClockIcon />, current: view.kind === "history", testId: "rail-history", onPress: () => choose({ kind: "history" }) },
    { id: "party", label: t("party.rail"), icon: <UsersIcon />, ...(partySize > 1 ? { badge: t("party.size", { count: partySize }) } : {}), testId: "rail-party", onPress: onParty },
    { id: "connect", label: t("tv.connectPhone"), icon: <PhoneIcon />, ...(connected ? { badge: t("tv.phoneConnected") } : {}), testId: "rail-connect", onPress: onConnect },
    { id: "settings", label: t("tv.settings"), icon: <GearIcon />, testId: "rail-settings", onPress: onSettings },
  ];
  const groups: Array<{ kind: LibraryKind | undefined; title: string }> = [
    { kind: "movie", title: t("tv.movieCategories") },
    { kind: "series", title: t("tv.seriesCategories") },
    { kind: undefined, title: t("tv.categories") },
  ];
  for (const { kind, title } of groups) {
    const own = rows.filter((row) => row.kind === kind);
    own.slice(0, RAIL_CATEGORIES).forEach((row, i) =>
      entries.push({
        id: `category:${row.id}`,
        label: row.title,
        ...(i === 0 ? { group: title } : {}),
        current: view.kind === "category" && view.rowId === row.id,
        testId: `rail-category-${row.id}`,
        onPress: () => choose({ kind: "category", rowId: row.id }),
      }),
    );
    if (own.length > RAIL_CATEGORIES) {
      const beyond = view.kind === "category" && own.findIndex((row) => row.id === view.rowId) >= RAIL_CATEGORIES;
      entries.push({
        id: `more:${kind ?? "all"}`,
        label: t("tv.moreCategories"),
        current: beyond || (view.kind === "categories" && view.of === kind),
        testId: `rail-more-${kind ?? "all"}`,
        onPress: () => choose({ kind: "categories", ...(kind ? { of: kind } : {}) }),
      });
    }
  }
  const openEntry = entries.findIndex((entry) => entry.current);
  const railIndex = openEntry === -1 ? 1 : openEntry; // a page the menu has no line for belongs to Home

  // What the arrow keys can reach, row by row: the key handler below reads it through a ref.
  const showAccount = accountStatus === "ready";
  const showRetry = rowsPage && homeRows.length === 0 && status !== "loading";
  const shape: Shape = {
    rail: entries.map(() => 1),
    top: showAccount ? [1] : [],
    ...(rowsPage ? { hero: !deep && actions.length > 0 ? [actions.length] : [], rows: showRetry ? [1] : homeRows.map((row) => row.entries.length) } : {}),
    ...(grid ? { grid: gridRows(grid.entries.length, gridColumns) } : {}),
    ...(view.kind === "search" ? { ...(narrow ? {} : { keys: KEYBOARD_SHAPE }), chips: [KIND_FILTERS.length], results: gridRows(shownResults.length, resultColumns) } : {}),
    ...(detail ? { detail: [overviewActions(detail.entry).length] } : {}),
  };
  const latest = useRef({ shape, view, query, railIndex, homeRows, detail });
  latest.current = { shape, view, query, railIndex, homeRows, detail };

  /** Turn "the menu entry for this page" and "the title the remote was last on" into a button that is on screen. */
  const resolve = (target: Target): Pos | null => {
    const root = rootRef.current;
    if (!target || !root) return null;
    if (target.row !== -1) return target as Pos;
    if (target.zone === "rail") return { zone: "rail", row: latest.current.railIndex, col: 0 };
    const at = savedPos(latest.current.view, latest.current.homeRows);
    if (at && RESTORABLE.includes(at.zone) && find(root, at)) return at;
    return CONTENT_ZONES.map((zone): Pos => ({ zone, row: 0, col: 0 })).find((pos) => find(root, pos)) ?? null;
  };
  const focusAt = (target: Target) => {
    const pos = resolve(target);
    if (pos && rootRef.current) find(rootRef.current, pos)?.focus({ preventScroll: true });
  };
  /** Move the focus; the menu is only on screen while it has the focus, so it is opened first and reached after the render. */
  const go = (target: Target) => {
    if (target && target.zone === "rail") {
      setRailOpen(true);
      setPending(target);
    } else focusAt(target);
  };

  useEffect(() => {
    if (!pending) return;
    setPending(null);
    focusAt(pending);
  }, [pending]);

  // Keys pressed while it loaded may have landed on the account button, or nowhere; once there is something to see, the remote goes to it.
  useEffect(() => {
    const at = posOf(document.activeElement);
    if (!at || at.zone === "top") setPending(CONTENT);
  }, [hasTiles, status, view.kind]);

  // A category that is gone (the library was refreshed) leaves its page empty: go home.
  useEffect(() => {
    if (view.kind === "category" && status === "ready" && !grid) choose({ kind: "home" });
  }, [view, status, grid]);

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
      setResults([]);
      return setSearching(false);
    }
    const local = matchLocal(rows, text);
    setResults(local);
    if (text.length < 2) {
      remembered.resultsFor = text;
      return setSearching(false);
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/library/search?q=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((answer: unknown) => {
          const parsed = LibraryItemsSchema.safeParse(answer);
          if (parsed.success) setResults(mergeItems(local, parsed.data.items));
          remembered.resultsFor = text;
          setSearching(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, view.kind, rows]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || event.altKey || event.ctrlKey || event.metaKey) return;
      const { shape: now, view: page, query: text, detail: open } = latest.current;

      // A keyboard types into the search box (not while a title's page is over it).
      const typed = page.kind === "search" && !open ? typedCharacter(event) : null;
      if (typed !== null) {
        event.preventDefault();
        setQuery((before) => appendTo(before, typed));
        return;
      }

      const action = actionForKey(event);
      if (action === "back") {
        event.preventDefault();
        if (open) return closeDetail();
        if (event.key === "Backspace" && page.kind === "search" && text) return setQuery(text.slice(0, -1));
        if (posOf(document.activeElement)?.zone === "rail" && resolve(CONTENT)) go(CONTENT);
        else if (page.kind !== "home") choose({ kind: "home" }); // (also from the menu, when the page has no title to go back to)
        else go(RAIL); // home is as far back as it goes: the menu is the next step
        return;
      }
      if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return;
      if (event.target instanceof HTMLInputElement && (action === "left" || action === "right")) return; // in the search box of a small screen they move the cursor
      event.preventDefault();

      const at = posOf(document.activeElement);
      if (open) return go(at?.zone === "detail" ? stepFrom(now, at, action) : DETAIL); // the page over the library keeps the remote to itself
      if (!at) {
        // Nowhere to stand yet. On a page with titles that is the first one; on an empty page Left reaches the menu and Up the account button.
        if (resolve(CONTENT)) return focusAt(CONTENT);
        return go(action === "left" ? RAIL : action === "up" && now.top?.length ? { zone: "top", row: 0, col: 0 } : null);
      }
      go(stepFrom(now, at, action));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** The remote moved onto a title: keep it in view (the page itself never scrolls) and, after a pause, let the banner say what it is. */
  const arrived = (element: HTMLElement, pos: Pos, now: Focused) => {
    const key = viewKey(latest.current.view);
    remembered.focus[key] = pos;
    if (pos.zone === "rows") {
      remembered.row[key] = latest.current.homeRows[pos.row]?.id ?? "";
      setDeep(pos.row > 0);
      const scroller = element.parentElement!;
      const edge = element.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const room = edge.width * 0.7; // keep a title beside it showing, so there is somewhere to go
      if (edge.left < box.left + room) scroller.scrollBy({ left: edge.left - box.left - room, behavior: "smooth" });
      else if (edge.right > box.right - room) scroller.scrollBy({ left: edge.right - box.right + room, behavior: "smooth" });
      rowsRef.current?.scrollTo({ top: scroller.parentElement!.offsetTop, behavior: "smooth" });
    } else {
      const container = element.closest<HTMLElement>(".tv-grid");
      if (container) keepInView(container, element);
    }

    window.clearTimeout(bannerTimer.current);
    if (!focused) setFocused(now);
    else bannerTimer.current = window.setTimeout(() => setFocused(now), BANNER_DELAY_MS);
  };

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };
  const playEntry = (entry: Entry) => onPlay(new URL(entry.url, location.href).href, { hint: hintOf(entry), ...(entry.startAt ? { startAt: entry.startAt } : {}) });
  // A category opens its page; a title opens its own page, where it is played or kept in My List (the banner's buttons do the same without it).
  const press = (title: Focused) => (title.entry.opens ? choose(title.entry.opens) : openDetail(title));

  const tile = (entry: Entry, pos: Pos, label: string, layout: Layout, source?: string) => {
    const title: Focused = { entry, label, ...(source ? { source } : {}) };
    return <Tile key={`${pos.zone}-${entry.id}`} entry={entry} layout={layout} rank={pos.col + 1} pos={pos} onArrive={(element) => arrived(element, pos, title)} onPress={() => press(title)} />;
  };

  const doAction = (action: HeroAction, entry: Entry | undefined = shown?.entry) => {
    if (!entry) return;
    if (action === "play") playEntry(entry);
    else if (action === "list") profileStore.setInList(listEntryOf(entry), !isSaved(entry));
    else if (entry.progressKey) {
      profileStore.removeProgress(entry.progressKey);
      setFocused(null);
      if (detail) closeDetail();
      else go(CONTENT);
    }
  };

  /** What a button says for a title; a title's own page spells out what My List does, where the banner has room for the name only. */
  const labelOf = (action: HeroAction, entry: Entry, spelled: boolean): ReactNode => {
    if (action === "play") {
      return (
        <>
          <PlayIcon /> {entry.startAt !== undefined ? t("rows.resume") : t("rows.play")}
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
    const kept = isSaved(entry);
    return (
      <>
        {kept ? <CheckIcon /> : <PlusIcon />} {spelled ? t(kept ? "rows.removeFromList" : "library.addToList") : t("rows.myList")}
      </>
    );
  };

  return (
    <section className="tv-browse" ref={rootRef} data-testid="tv-browse" data-view={viewKey(view)} data-deep={deep} aria-label={t("tv.library")}>
      <Backdrop image={shown?.entry.backdrop ?? shown?.entry.image} />
      <div className="tv-browse-shade" />

      <Rail open={railOpen} onOpen={setRailOpen} entries={entries} onArrive={(element) => keepInView(element.closest<HTMLElement>(".tv-rail")!, element)} />

      <header className="tv-browse-top">
        <span className="tv-browse-logo">
          <Logo />
        </span>
        {notice && (
          <p className="tv-notice" role="alert" data-testid="tv-notice">
            {notice}
          </p>
        )}
        {showAccount && <AccountChip onOpen={onAccount} zone />}
      </header>

      {rowsPage && (
        <>
          <div className="tv-hero" data-testid="tv-hero">
            {shown ? (
              <div className="tv-hero-text" key={shown.entry.id}>
                <p className="tv-hero-eyebrow">{shown.entry.opens ? t("tv.byCategory") : shown.label}</p>
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
                      onClick={() => doAction(action)}
                    >
                      {labelOf(action, shown.entry, false)}
                    </button>
                  ))}
                </div>
              </div>
            ) : status === "loading" ? (
              <p className="tv-hero-eyebrow">{t("tv.loadingLibrary")}</p>
            ) : (
              <>
                <h1 className="tv-hero-title">{status === "failed" ? t("tv.libraryFailed") : t("tv.libraryEmpty")}</h1>
                <p className="tv-hero-about">{status === "failed" ? t("tv.libraryFailedHelp") : t("tv.libraryEmptyHelp")}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={retry} autoFocus data-testid="tv-browse-retry" data-zone="rows" data-row={0} data-col={0}>
                    {t("common.retry")}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="tv-rows" ref={rowsRef}>
            {homeRows.length > 0
              ? homeRows.map((row, r) => (
                  <section className="tv-row" key={row.id} data-layout={row.layout} aria-label={row.title}>
                    <h2 className="tv-row-title">{row.title}</h2>
                    <div className="tv-row-tiles">{row.entries.map((entry, c) => tile(entry, { zone: "rows", row: r, col: c }, row.title, row.layout, row.source))}</div>
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
          </div>
        </>
      )}

      {grid && (
        <div className="tv-view" data-testid={view.kind === "category" ? "tv-category" : `tv-${view.kind}`}>
          <h1 className="tv-view-title" data-testid="tv-view-title">
            {grid.title}
          </h1>
          {grid.meta && <p className="tv-view-meta">{grid.meta}</p>}
          {grid.entries.length > 0 ? (
            <div className="tv-grid" style={{ "--cols": gridColumns } as CSSProperties}>
              {grid.entries.map((entry, i) => tile(entry, { zone: "grid", row: Math.floor(i / gridColumns), col: i % gridColumns }, grid.title, grid.layout))}
            </div>
          ) : (
            <p className="tv-view-empty" data-testid="tv-view-empty">
              {grid.empty}
            </p>
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
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : (
              <>
                <p className="tv-query" data-testid="tv-query" aria-live="polite">
                  {query ? <span>{query}</span> : <span className="tv-query-hint">{t("tv.searchHint")}</span>}
                  <i className="tv-caret" />
                </p>
                <div className="tv-keys" role="group" aria-label={t("tv.keyboard")}>
                  {KEYBOARD_KEYS.map((key, i) => (
                    <Key key={key} testId={`key-${key}`} pos={{ zone: "keys", row: Math.floor(i / KEYBOARD_COLUMNS), col: i % KEYBOARD_COLUMNS }} onPress={() => setQuery((before) => appendTo(before, key))}>
                      {key}
                    </Key>
                  ))}
                  <Key testId="key-space" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 0 }} onPress={() => setQuery((before) => appendTo(before, " "))}>
                    {t("tv.space")}
                  </Key>
                  <Key testId="key-delete" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 1 }} onPress={() => setQuery((before) => before.slice(0, -1))}>
                    <BackspaceIcon /> {t("tv.delete")}
                  </Key>
                </div>
              </>
            )}
          </div>
          <div className="tv-search-main">
            <div className="tv-filters" role="radiogroup" aria-label={t("tv.search")}>
              {KIND_FILTERS.map((value, col) => {
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
                    {t(value === "all" ? "tv.filterAll" : value === "movie" ? "tv.filterMovies" : "tv.filterSeries")}
                  </button>
                );
              })}
            </div>
            <p className="tv-view-meta" data-testid="tv-search-status">
              {!query.trim()
                ? t("tv.typeToSearch")
                : shownResults.length > 0
                  ? `${t("tv.found", { count: shownResults.length, query: query.trim() })}${searching ? t("tv.stillLooking") : ""}`
                  : searching
                    ? t("tv.looking")
                    : t("tv.nothingMatches", { query: query.trim() })}
            </p>
            <div className="tv-grid tv-results" style={{ "--cols": resultColumns } as CSSProperties}>
              {shownResults.map((item, i) => tile(entryOfItem(item), { zone: "results", row: Math.floor(i / resultColumns), col: i % resultColumns }, t("tv.search"), "wide"))}
            </div>
          </div>
        </div>
      )}

      {detail && (
        // A tap on the empty part of the page closes it, as Back does.
        <div className="tv-detail" role="dialog" aria-modal="true" aria-label={detail.entry.title} data-testid="tv-detail" onClick={(event) => event.target === event.currentTarget && closeDetail()}>
          <Backdrop image={detail.entry.backdrop ?? detail.entry.image} />
          <div className="tv-browse-shade" />
          <button className="tv-hero-button tv-detail-close" onClick={closeDetail} data-testid="tv-detail-close">
            <CloseIcon /> {t("common.close")}
          </button>
          <div className="tv-detail-text">
            <p className="tv-hero-eyebrow">{detail.label}</p>
            <h1 className="tv-detail-title" data-testid="tv-detail-title">
              {detail.entry.title}
            </h1>
            <p className="tv-hero-meta">{[detail.entry.year, detail.entry.note, detail.source].filter(Boolean).join("  ·  ")}</p>
            {detail.entry.description && <p className="tv-detail-about">{detail.entry.description}</p>}
            <div className="tv-hero-actions">
              {overviewActions(detail.entry).map((action, col) => (
                <button
                  key={action}
                  className={`tv-hero-button${action === "play" ? " is-primary" : ""}`}
                  data-testid={`tv-detail-${action}`}
                  data-zone="detail"
                  data-row={0}
                  data-col={col}
                  aria-pressed={action === "list" ? isSaved(detail.entry) : undefined}
                  onClick={() => doAction(action, detail.entry)}
                >
                  {labelOf(action, detail.entry, true)}
                </button>
              ))}
            </div>
          </div>
        </div>
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
    const show = (picture: string | undefined) => live && setLayers((now) => (now.at(-1)?.image === picture ? now : [...now.slice(-3), { id: ++counter.current, image: picture }]));
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

function Key({ children, pos, wide, testId, onPress }: { children: ReactNode; pos: Pos; wide?: boolean; testId: string; onPress: () => void }) {
  return (
    <button
      className={`tv-key${wide ? " tv-key-wide" : ""}`}
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

/** One title (or category) of a row, in the shape its row asks for. */
function Tile({ entry, layout, rank, pos, onArrive, onPress }: { entry: Entry; layout: Layout; rank: number; pos: Pos; onArrive: (element: HTMLElement) => void; onPress: () => void }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(entry.id);
  // A ranking shows the upright poster; everything else is wide, and falls back to the poster when there is no wide picture.
  const picture = layout === "ranked" ? (entry.image ?? entry.backdrop) : (entry.backdrop ?? entry.image);
  const showPicture = picture && !broken;
  const common = {
    "data-zone": pos.zone,
    "data-row": pos.row,
    "data-col": pos.col,
    onClick: onPress,
    onFocus: (event: FocusEvent<HTMLElement>) => onArrive(event.currentTarget),
    title: entry.title,
  };

  if (layout === "categories") {
    return (
      <button className="tv-tile tv-tile-category" data-testid="tv-category-tile" {...common} style={{ "--hue": hue } as CSSProperties}>
        {showPicture && <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
        <span className="tv-category-name">{entry.title}</span>
        {entry.note && <span className="tv-category-count">{entry.note}</span>}
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
            <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
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
        </span>
        {layout !== "ranked" && <span className="tv-tile-name">{entry.title}</span>}
        {layout !== "ranked" && under && <span className="tv-tile-year">{under}</span>}
      </span>
    </button>
  );
}
