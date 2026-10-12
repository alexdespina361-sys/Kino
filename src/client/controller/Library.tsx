import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { itemsOf, LibrarySchema, rankByQuery, searchItems, type Library as LibraryData, type LibraryItem } from "../../shared";
import { listEntryOf } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { rowTitle, useT } from "../i18n";
import { Poster } from "../shared/Poster";
import { entryOfItem, type Entry } from "../tv/pages";
import { useHold } from "./hold";
import { ListButton, useListToggle, type ListToggle } from "./Round";

/** What the server last listed, so a visit to the home screen after the first shows it at once. */
let remembered: LibraryData | null = null;

type Status = "loading" | "ready" | "failed";
type Filter = "all" | "movies" | "series";

/** A search that could not be made is made again this long after. */
const SEARCH_RETRY_MS = 5000;

/**
 * The search that was open when the home screen went away (a video was started from it, and then stopped): the words, the filter, what
 * the library answered, and how far down the list the page was scrolled. Coming back is coming back to the same list, not to an empty box.
 */
const kept: { query: string; filter: Filter; found: { query: string; items: LibraryItem[] } | null; scroll: number | null } = { query: "", filter: "all", found: null, scroll: null };

/** What a row is: what its place says, else what its name suggests ("Feature films", "Classic TV"). Rows that are both, or neither, are only in All. */
const isMovies = (row: LibraryData["rows"][number]) => (row.kind ? row.kind === "movie" : /movie|film/i.test(`${row.id} ${row.title}`));
const isSeries = (row: LibraryData["rows"][number]) => (row.kind ? row.kind === "series" : /series|shows|docuseries|anime|(^|[^a-z])tv([^a-z]|$)/i.test(`${row.id} ${row.title}`));

/** What is typed, as it is looked for. */
const wanted = (query: string) => query.trim().toLowerCase();

/** The titles on the page that have the words in their name (a slip of a letter or an unfinished word included), best first: what a search shows before the library has answered. */
const onThePage = (library: LibraryData | null, q: string): LibraryItem[] => rankByQuery(searchItems(itemsOf(library?.rows ?? []), q), q);

/**
 * Rows of titles from the server's library, to scroll through, and a search that lists what it finds one under another. A tap on a title
 * opens its page (`onOpen`), a hold puts it in a list, and so does the round button on it; with more than one list that asks which
 * (`onPick`). Absent when there is no library, unless there is something (`fallback`) to say instead.
 */
export function Library({ onOpen, onPick, failedLookups = 0, fallback }: { onOpen: (entry: Entry) => void; onPick: (entry: ListEntry) => void; failedLookups?: number; fallback?: ReactNode }) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const [library, setLibrary] = useState<LibraryData | null>(remembered);
  const [status, setStatus] = useState<Status>(remembered ? "ready" : "loading");
  const [query, setQuery] = useState(kept.query);
  const [searchResults, setSearchResults] = useState<LibraryItem[] | null>(() => {
    const q = wanted(kept.query);
    return !q ? null : kept.found?.query === q ? kept.found.items : onThePage(remembered, q);
  });
  const [searching, setSearching] = useState(() => Boolean(wanted(kept.query)) && kept.found?.query !== wanted(kept.query));
  const [filter, setFilter] = useState<Filter>(kept.filter);
  const [attempt, setAttempt] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchTry, setSearchTry] = useState(0);
  const root = useRef<HTMLElement>(null);

  const displayedRows = useMemo(() => {
    if (!library) return [];
    if (filter === "movies") return library.rows.filter(isMovies);
    if (filter === "series") return library.rows.filter(isSeries);
    return library.rows;
  }, [library, filter]);

  useEffect(() => {
    kept.filter = filter;
  }, [filter]);

  // Back on the page with a search that was left: the page is where it was (a sheet scrolls on its own). It is the search that is kept in
  // place, not the page: a card that was added above it in the meantime (what was just played) must not push it away.
  const shown = Boolean(library && library.rows.length > 0);
  useLayoutEffect(() => {
    const section = root.current;
    if (!shown || !section || section.closest(".sheet")) return;
    const top = () => section.getBoundingClientRect().top + window.scrollY;
    if (wanted(kept.query) && kept.scroll !== null) window.scrollTo(0, top() + kept.scroll);
    return () => {
      kept.scroll = window.scrollY - top();
    };
  }, [shown]);

  // A video that would not play may have taken its title off the server's lists: ask for them again (the search with them).
  useEffect(() => {
    if (failedLookups > 0) setAttempt((n) => n + 1);
  }, [failedLookups]);

  useEffect(() => {
    let live = true;
    // (Asked again, as after a try that failed or a press on Retry, it is asked past the browser's memory of the last answer.)
    fetch("/api/library", attempt > 0 ? { cache: "reload" } : undefined)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const parsed = LibrarySchema.safeParse(body);
        if (!live) return;
        if (parsed.success) {
          remembered = parsed.data;
          if (attempt > 0) kept.found = null; // what a search found is asked for again against the new list
          setLibrary(parsed.data);
          setStatus("ready");
        } else setStatus((now) => (now === "ready" ? now : "failed"));
      })
      .catch(() => live && setStatus((now) => (now === "ready" ? now : "failed")));
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    kept.query = query;
    const q = wanted(query);
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearchFailed(false);

    // What the library answered to these very words before is still good.
    if (kept.found?.query === q) {
      setSearchResults(kept.found.items);
      setSearching(false);
      return;
    }

    // 1. Instant local search from loaded rows
    const local = onThePage(library, q);
    const seen = new Set(local.map((item) => item.id));
    setSearchResults(local);
    if (q.length < 2) return setSearching(false); // a letter is too little to ask the server about
    setSearching(true);

    // 2. Debounced remote search
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/library/search?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { items?: LibraryItem[] }) => {
          if (!live) return;
          setSearching(false);
          if (Array.isArray(data?.items)) {
            const combined = [...local];
            for (const item of data.items) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                combined.push(item);
              }
            }
            const ranked = rankByQuery(combined, q); // (the likeliest first, whether the page or the library found it)
            kept.found = { query: q, items: ranked };
            setSearchResults(ranked);
          } else setSearchFailed(true);
        })
        .catch(() => {
          if (!live) return;
          setSearching(false);
          setSearchFailed(true);
        });
    }, 350);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, library, searchTry]);

  // A search that did not get an answer is asked again every few seconds for as long as it is on screen.
  useEffect(() => {
    if (!searchFailed) return;
    const timer = setTimeout(() => setSearchTry((n) => n + 1), SEARCH_RETRY_MS);
    return () => clearTimeout(timer);
  }, [searchFailed, searchTry]);

  if (status === "loading") {
    return (
      <p className="muted small" data-testid="library-loading">
        <span className="spinner" /> {t("library.loading")}
      </p>
    );
  }
  if (!library && status === "failed") {
    return (
      <>
        <div className="lib-failed" data-testid="library-failed">
          <p className="muted">{t("tv.libraryFailed")}</p>
          <button
            className="btn"
            data-testid="library-retry"
            onClick={() => {
              setStatus("loading");
              setAttempt((n) => n + 1);
            }}
          >
            {t("common.retry")}
          </button>
        </div>
        {fallback}
      </>
    );
  }
  if (!library || library.rows.length === 0) return <>{fallback}</>;

  const toggleOf = (item: LibraryItem) => toggleFor(listEntryOf(item));
  const open = (item: LibraryItem) => () => onOpen(entryOfItem(item));

  return (
    <section className="library" data-testid="library" aria-label={t("library.title")} ref={root}>
      <div className="field lib-search-field">
        <input
          type="search"
          placeholder={t("library.search")}
          aria-label={t("library.searchLabel")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="library-search-input"
        />
        {query && (
          <button type="button" className="field-btn icon" onClick={() => setQuery("")} aria-label={t("common.clear")}>
            ✕
          </button>
        )}
      </div>

      {searchResults === null && (
        <div className="lib-pills" role="group" aria-label={t("library.filter")}>
          {(["all", "movies", "series"] as const).map((kind) => (
            <button key={kind} type="button" className="lib-pill" aria-pressed={filter === kind} onClick={() => setFilter(kind)} data-testid={`filter-${kind}`}>
              {t(`library.${kind}`)}
            </button>
          ))}
        </div>
      )}

      {searchResults !== null ? (
        <div className="lib-row" data-testid="library-search-results">
          <h3>
            {searchResults.length > 0
              ? t("library.resultsFor", { query }) + (searchFailed ? t("tv.searchOffline") : "")
              : searching
                ? t("tv.looking")
                : searchFailed
                  ? t("tv.searchFailed")
                  : t("library.noMatches", { query })}
            {searching && <span className="spinner" style={{ marginLeft: 8 }} />}
          </h3>
          {searchResults.length > 0 && (
            <ul className="lib-list">
              {searchResults.map((item) => (
                <li key={item.id}>
                  <Result item={item} toggle={toggleOf(item)} onOpen={open(item)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        displayedRows.map((row) => (
          <div className="lib-row" key={row.id} data-testid="library-row">
            <h3>{rowTitle(row)}</h3>
            <div className="lib-scroller">
              {row.items.map((item) => (
                <Tile key={item.id} item={item} toggle={toggleOf(item)} onOpen={open(item)} />
              ))}
            </div>
          </div>
        ))
      )}
      <p className="muted small">{t("library.credit", { sources: [...new Set(library.rows.map((row) => row.source))].join(", ") })}</p>
    </section>
  );
}

/** A title in a row: its picture, the round + on it, and a hold that does what the + does. */
function Tile({ item, toggle, onOpen }: { item: LibraryItem; toggle: ListToggle; onOpen: () => void }) {
  const hold = useHold(toggle.onHold);
  return (
    <div className="lib-tile" data-in-list={toggle.inList}>
      <button className="lib-card" data-testid="library-tile" onClick={hold.tap(onOpen)} {...hold.props} title={item.title}>
        <Poster className="lib-art" title={item.title} image={item.backdrop ?? item.image} seed={item.id} />
        <span className="lib-title">{item.title}</span>
        {item.year && <span className="lib-year">{item.year}</span>}
      </button>
      <span className="lib-corner">
        <ListButton toggle={toggle} title={item.title} />
      </span>
    </div>
  );
}

/** A title found by the search: one line in a list that scrolls with the page. */
function Result({ item, toggle, onOpen }: { item: LibraryItem; toggle: ListToggle; onOpen: () => void }) {
  const t = useT();
  const hold = useHold(toggle.onHold);
  const kind = item.kind === "movie" ? t("library.kindMovie") : item.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [item.year, kind].filter(Boolean).join(" · ");
  return (
    <div className="lib-result" data-in-list={toggle.inList}>
      <button className="lib-result-main" data-testid="library-result" onClick={hold.tap(onOpen)} {...hold.props} title={item.title}>
        <Poster className="lib-result-art" title={item.title} image={item.backdrop ?? item.image} seed={item.id} />
        <span className="lib-result-text">
          <span className="lib-title">{item.title}</span>
          {meta && <span className="lib-year">{meta}</span>}
        </span>
      </button>
      <ListButton toggle={toggle} title={item.title} />
    </div>
  );
}
