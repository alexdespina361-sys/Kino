import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { z } from "zod";
import { LibraryItemSchema, LibrarySchema, type Library, type LibraryItem } from "../../shared";
import { BackspaceIcon, GridIcon, HomeIcon, SearchIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { gridRows, stepFrom, type Pos, type Shape, type Target, type Zone } from "./browseNav";
import { actionForKey } from "./keys";
import { appendTo, KEYBOARD_COLUMNS, KEYBOARD_KEYS, KEYBOARD_SHAPE, matchLocal, mergeItems, typedCharacter } from "./librarySearch";

interface BrowseProps {
  onPlay: (url: string) => void;
  onClose: () => void;
  /** Said when the title that was just chosen would not play. */
  notice?: string | null;
}

/** The page that is open: everything in rows, one category as a grid, or the search. */
type View = { kind: "home" } | { kind: "category"; rowId: string } | { kind: "search" };
const viewKey = (view: View) => (view.kind === "category" ? `category:${view.rowId}` : view.kind);

/** What the screen looked like when it was left, so coming back from a film lands on the same title, at once. */
const remembered = {
  library: null as Library | null,
  view: { kind: "home" } as View,
  query: "",
  results: [] as LibraryItem[],
  /** The query `results` answers. */
  resultsFor: "",
  /** Where the remote was on each page. */
  focus: {} as Record<string, Pos>,
};

/** Wait this long on a title before the banner changes to it, so scrolling past many does not flicker through them. */
const BANNER_DELAY_MS = 200;
/** Wait this long after the last key before asking the server, so a word is one question and not one per letter. */
const SEARCH_DELAY_MS = 350;
const GRID_COLUMNS = 5;
const RESULT_COLUMNS = 3;

const SearchSchema = z.object({ items: z.array(LibraryItemSchema) });

/** What the banner and the picture behind the screen show: the title the remote is on. */
interface Focused {
  item: LibraryItem;
  label: string;
  source?: string;
}

const CONTENT: Target = { zone: "content", row: -1, col: -1 };
const CONTENT_ZONES: Zone[] = ["rows", "grid", "keys"];

const find = (root: ParentNode, pos: Pos) => root.querySelector<HTMLElement>(`[data-zone="${pos.zone}"][data-row="${pos.row}"][data-col="${pos.col}"]`);
function posOf(element: Element | null): Pos | null {
  if (!(element instanceof HTMLElement) || !element.dataset.zone) return null;
  return { zone: element.dataset.zone as Zone, row: Number(element.dataset.row), col: Number(element.dataset.col) };
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
 * The library on the TV, laid out like a streaming app: a menu down the left (search, home, and a page for each category), a
 * banner for the title the remote is on, and rows of titles under it. The arrow keys walk everything; Left from the first title
 * of any row opens the menu, OK plays, and Back steps out: of the menu, then to the home page, then out of the library.
 */
export function TvBrowse({ onPlay, onClose, notice }: BrowseProps) {
  const [library, setLibrary] = useState<Library | null>(remembered.library);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(remembered.library ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [view, setViewState] = useState<View>(remembered.view);
  const [query, setQuery] = useState(remembered.query);
  const [results, setResults] = useState<LibraryItem[]>(remembered.results);
  const [searching, setSearching] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [focused, setFocused] = useState<Focused | null>(null);
  /** Somewhere to put the focus once the next render has put it on screen. */
  const [pending, setPending] = useState<Target>(null);
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

  const rows = useMemo(() => (library?.rows ?? []).filter((row) => row.items.length > 0), [library]);
  const hasTiles = status === "ready" && rows.length > 0;
  const category = view.kind === "category" ? rows.find((row) => row.id === view.rowId) : undefined;

  // Where the remote starts on the home page: the first title, or on a return from a film, the one it left.
  const homeFocus = remembered.focus.home;
  const startRow = Math.min(homeFocus?.row ?? 0, Math.max(0, rows.length - 1));
  const startCol = Math.min(homeFocus?.col ?? 0, Math.max(0, (rows[startRow]?.items.length ?? 1) - 1));
  const start = rows[startRow]?.items[startCol];
  const shown: Focused | null = focused ?? (view.kind === "home" && start ? { item: start, label: rows[startRow]!.title, source: rows[startRow]!.source } : null);

  // What the arrow keys can reach, row by row: the key handler below reads it through a ref.
  const shape: Shape = {
    rail: Array.from({ length: 2 + rows.length }, () => 1),
    top: [1],
    ...(view.kind === "home" ? { rows: hasTiles ? rows.map((row) => row.items.length) : status === "loading" ? [] : [1] } : {}),
    ...(view.kind === "category" && category ? { grid: gridRows(category.items.length, GRID_COLUMNS) } : {}),
    ...(view.kind === "search" ? { keys: KEYBOARD_SHAPE, results: gridRows(results.length, RESULT_COLUMNS) } : {}),
  };
  const railIndex = view.kind === "search" ? 0 : view.kind === "home" ? 1 : 2 + Math.max(0, rows.findIndex((row) => row.id === view.rowId));
  const latest = useRef({ shape, view, query, railIndex });
  latest.current = { shape, view, query, railIndex };
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /** Turn "the menu entry for this page" and "the title the remote was last on" into a button that is on screen. */
  const resolve = (target: Target): Pos | null => {
    const root = rootRef.current;
    if (!target || !root) return null;
    if (target.row !== -1) return target as Pos;
    if (target.zone === "rail") return { zone: "rail", row: latest.current.railIndex, col: 0 };
    const saved = remembered.focus[viewKey(latest.current.view)];
    if (saved && CONTENT_ZONES.concat("results").includes(saved.zone) && find(root, saved)) return saved;
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

  const choose = (next: View) => {
    remembered.view = next;
    setViewState(next);
    setFocused(null);
    setRailOpen(false);
    setPending(CONTENT);
  };

  useEffect(() => {
    if (!pending) return;
    setPending(null);
    focusAt(pending);
  }, [pending]);

  // Keys pressed while it loaded may have landed on Back, or nowhere; once there is something to see, the remote goes to it.
  useEffect(() => {
    const at = posOf(document.activeElement);
    if (!at || at.zone === "top") setPending(CONTENT);
  }, [hasTiles, status, view.kind]);

  // A category that is gone (the library was refreshed) leaves its page empty: go home.
  useEffect(() => {
    if (view.kind === "category" && status === "ready" && !category) choose({ kind: "home" });
  }, [view, status, category]);

  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);

  useEffect(() => {
    remembered.query = query;
    remembered.results = results;
  }, [query, results]);

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
        .then((data: unknown) => {
          const parsed = SearchSchema.safeParse(data);
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
      const { shape: now, view: page, query: text } = latest.current;

      // A keyboard types into the search box.
      const typed = page.kind === "search" ? typedCharacter(event) : null;
      if (typed !== null) {
        event.preventDefault();
        setQuery((before) => appendTo(before, typed));
        return;
      }

      const action = actionForKey(event);
      if (action === "back") {
        event.preventDefault();
        if (event.key === "Backspace" && page.kind === "search" && text) return setQuery(text.slice(0, -1));
        if (posOf(document.activeElement)?.zone === "rail") go(CONTENT);
        else if (page.kind !== "home") choose({ kind: "home" });
        else closeRef.current();
        return;
      }
      if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return;
      event.preventDefault();

      const at = posOf(document.activeElement);
      if (!at) return focusAt(CONTENT);
      go(stepFrom(now, at, action));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** The remote moved onto a title: keep it in view (the page itself never scrolls) and, after a pause, let the banner say what it is. */
  const arrived = (element: HTMLElement, pos: Pos, now: Focused) => {
    remembered.focus[viewKey(latest.current.view)] = pos;
    if (pos.zone === "rows") {
      const scroller = element.parentElement!;
      const edge = element.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const room = edge.width * 0.7; // keep a title beside it showing, so there is somewhere to go
      if (edge.left < box.left + room) scroller.scrollBy({ left: edge.left - box.left - room, behavior: "smooth" });
      else if (edge.right > box.right - room) scroller.scrollBy({ left: edge.right - box.right + room, behavior: "smooth" });
      rowsRef.current?.scrollTo({ top: scroller.parentElement!.offsetTop, behavior: "smooth" });
    } else {
      const grid = element.closest<HTMLElement>(".tv-grid");
      if (grid) keepInView(grid, element);
    }

    window.clearTimeout(bannerTimer.current);
    if (!focused) setFocused(now);
    else bannerTimer.current = window.setTimeout(() => setFocused(now), BANNER_DELAY_MS);
  };

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };
  const play = (item: LibraryItem) => onPlay(new URL(item.url, location.href).href);

  const tile = (item: LibraryItem, pos: Pos, label: string, source?: string) => (
    <Tile key={`${pos.zone}-${item.id}`} item={item} pos={pos} onArrive={(element) => arrived(element, pos, { item, label, ...(source ? { source } : {}) })} onPlay={() => play(item)} />
  );

  return (
    <section className="tv-browse" ref={rootRef} data-testid="tv-browse" data-view={viewKey(view)} aria-label="Library">
      {shown?.item.image && <div className="tv-hero-bg" key={shown.item.id} style={{ backgroundImage: `url(${JSON.stringify(shown.item.image)})` }} />}
      <div className="tv-browse-shade" />

      <Rail
        open={railOpen}
        onOpen={setRailOpen}
        current={railIndex}
        categories={rows}
        onSearch={() => choose({ kind: "search" })}
        onHome={() => choose({ kind: "home" })}
        onCategory={(rowId) => choose({ kind: "category", rowId })}
        onArrive={(element) => keepInView(element.closest<HTMLElement>(".tv-rail")!, element)}
      />

      <header className="tv-browse-top">
        <span className="tv-browse-logo">
          <Logo />
        </span>
        {notice && (
          <p className="tv-notice" role="alert" data-testid="tv-notice">
            {notice}
          </p>
        )}
        <button className="tv-back" onClick={onClose} data-testid="tv-browse-close" data-zone="top" data-row={0} data-col={0}>
          Back
        </button>
      </header>

      {view.kind === "home" && (
        <>
          <div className="tv-hero" data-testid="tv-hero">
            {shown ? (
              <>
                <p className="tv-hero-eyebrow">{shown.label}</p>
                <h1 className="tv-hero-title" data-testid="tv-hero-title">
                  {shown.item.title}
                </h1>
                <p className="tv-hero-meta">{[shown.item.year, shown.source].filter(Boolean).join("  ·  ")}</p>
                {shown.item.description && <p className="tv-hero-about">{shown.item.description}</p>}
                <p className="tv-hero-hint">
                  <kbd>OK</kbd> to play
                </p>
              </>
            ) : status === "loading" ? (
              <p className="tv-hero-eyebrow">Getting the library…</p>
            ) : (
              <>
                <h1 className="tv-hero-title">{status === "failed" ? "The library isn't reachable right now" : "Nothing in the library yet"}</h1>
                <p className="tv-hero-about">{status === "failed" ? "Check the connection, or send a link from your phone." : "It fills in a moment after the server starts."}</p>
                <div className="tv-actions tv-actions-start">
                  <button className="tv-action tv-action-primary" onClick={retry} autoFocus data-testid="tv-browse-retry" data-zone="rows" data-row={0} data-col={0}>
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="tv-rows" ref={rowsRef}>
            {hasTiles
              ? rows.map((row, r) => (
                  <section className="tv-row" key={row.id} aria-label={row.title}>
                    <h2 className="tv-row-title">{row.title}</h2>
                    <div className="tv-row-tiles">{row.items.map((item, c) => tile(item, { zone: "rows", row: r, col: c }, row.title, row.source))}</div>
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

      {view.kind === "category" && category && (
        <div className="tv-view" data-testid="tv-category">
          <h1 className="tv-view-title" data-testid="tv-view-title">
            {category.title}
          </h1>
          <p className="tv-view-meta">
            {category.items.length} titles · {category.source}
          </p>
          <div className="tv-grid" style={{ "--cols": GRID_COLUMNS } as CSSProperties}>
            {category.items.map((item, i) => tile(item, { zone: "grid", row: Math.floor(i / GRID_COLUMNS), col: i % GRID_COLUMNS }, category.title, category.source))}
          </div>
        </div>
      )}

      {view.kind === "search" && (
        <div className="tv-search" data-testid="tv-search">
          <div className="tv-search-side">
            <p className="tv-query" data-testid="tv-query" aria-live="polite">
              {query ? <span>{query}</span> : <span className="tv-query-hint">Search titles</span>}
              <i className="tv-caret" />
            </p>
            <div className="tv-keys" role="group" aria-label="Keyboard">
              {KEYBOARD_KEYS.map((key, i) => (
                <Key key={key} testId={`key-${key}`} pos={{ zone: "keys", row: Math.floor(i / KEYBOARD_COLUMNS), col: i % KEYBOARD_COLUMNS }} onPress={() => setQuery((before) => appendTo(before, key))}>
                  {key}
                </Key>
              ))}
              <Key testId="key-space" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 0 }} onPress={() => setQuery((before) => appendTo(before, " "))}>
                Space
              </Key>
              <Key testId="key-delete" wide pos={{ zone: "keys", row: KEYBOARD_SHAPE.length - 1, col: 1 }} onPress={() => setQuery((before) => before.slice(0, -1))}>
                <BackspaceIcon /> Delete
              </Key>
            </div>
          </div>
          <div className="tv-search-main">
            <p className="tv-view-meta" data-testid="tv-search-status">
              {!query.trim()
                ? "Type a title to search."
                : results.length > 0
                  ? `${results.length} ${results.length === 1 ? "title" : "titles"} for “${query.trim()}”${searching ? " · still looking…" : ""}`
                  : searching
                    ? "Looking…"
                    : `Nothing matches “${query.trim()}”.`}
            </p>
            <div className="tv-grid tv-results" style={{ "--cols": RESULT_COLUMNS } as CSSProperties}>
              {results.map((item, i) => tile(item, { zone: "results", row: Math.floor(i / RESULT_COLUMNS), col: i % RESULT_COLUMNS }, "Search"))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** The menu down the left: a strip of icons that opens into names while the remote is on it. */
function Rail({
  open,
  onOpen,
  current,
  categories,
  onSearch,
  onHome,
  onCategory,
  onArrive,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Which entry is the page that is open (0 search, 1 home, then the categories). */
  current: number;
  categories: Library["rows"];
  onSearch: () => void;
  onHome: () => void;
  onCategory: (rowId: string) => void;
  onArrive: (element: HTMLElement) => void;
}) {
  const entry = (row: number, label: string, onPress: () => void, icon?: ReactNode, testId?: string) => (
    <button
      key={row}
      className={`tv-rail-item${icon ? "" : " tv-rail-category"}`}
      data-zone="rail"
      data-row={row}
      data-col={0}
      data-testid={testId}
      aria-current={current === row ? "page" : undefined}
      onClick={onPress}
      onFocus={(event) => onArrive(event.currentTarget)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <nav
      className="tv-rail"
      data-open={open}
      data-testid="tv-rail"
      aria-label="Library menu"
      onFocus={() => onOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpen(false);
      }}
    >
      {entry(0, "Search", onSearch, <SearchIcon />, "rail-search")}
      {entry(1, "Home", onHome, <HomeIcon />, "rail-home")}
      <p className="tv-rail-group" aria-hidden={!open}>
        <GridIcon />
        <span>Categories</span>
      </p>
      {open && categories.map((row, i) => entry(2 + i, row.title, () => onCategory(row.id), undefined, `rail-category-${i}`))}
    </nav>
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

/** Pictures this small stay cheap to draw, and a missing one still gets a tile with a colour of its own. */
function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function Tile({ item, pos, onArrive, onPlay }: { item: LibraryItem; pos: Pos; onArrive: (element: HTMLElement) => void; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(item.id);
  return (
    <button
      className="tv-tile"
      data-testid="tv-browse-tile"
      data-zone={pos.zone}
      data-row={pos.row}
      data-col={pos.col}
      onClick={onPlay}
      onFocus={(event) => onArrive(event.currentTarget)}
      title={item.title}
    >
      <span className="tv-tile-art" style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
        {item.image && !broken ? (
          <img src={item.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <span className="tv-tile-initial" aria-hidden="true">
            {item.title.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="tv-tile-name">{item.title}</span>
      {item.year && <span className="tv-tile-year">{item.year}</span>}
    </button>
  );
}
