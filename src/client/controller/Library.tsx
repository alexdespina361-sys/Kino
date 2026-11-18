import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ShownTitle } from "../shared/Shown";
import { forChildren, isWanted, LibraryItemsSchema, LibrarySchema, sectionOf, wantedSections, type Library as LibraryData, type LibraryItem, type LibraryRow, type LibrarySection, type PlayHint } from "../../shared";
import { listEntryOf } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { scoreOf, useScores } from "../account/ratings";
import { useProfileData } from "../account/store";
import { rowTitle, useT } from "../i18n";
import { useProfileHold } from "../shared/profileHold";
import { failedShelves, feed, hasMoreShelves, hasMoreTitles, loadingShelves, loadingTitles, pageRows, ROW_CAP, useFeed } from "../shared/feed";
import { hueOf, Poster, posterSizes } from "../shared/Poster";
import { titleOfPersonal, useLikes } from "../shared/recommend";
import { personalAfter, personalSlots, seenKeys, withoutSeen, type PersonalRow } from "../shared/taste";
import { useWatching, WATCHING_AFTER, watchingRow } from "../shared/watching";
import { ScoreBadge } from "../shared/ScoreBadge";
import { landscapeRows } from "../shared/shapes";
import { keepMatching, matchLocal, mergeAnswers, onlyForChildren, type Answers } from "../tv/librarySearch";
import { CATEGORIES_AFTER, CATEGORY_TILES, entryOfItem, type Entry } from "../tv/pages";
import { useHold } from "./hold";
import { RowHead } from "./Rows";
import { SavedMark, useListToggle, type ListToggle } from "./Round";
import { Hero } from "./shell/Hero";

/** What the server last listed, so a visit to the home screen after the first shows it at once. (The rows are the feed's, which brings the rest as they are scrolled.) */
let remembered: LibraryData | null = null;
/** When it was listed. The browser keeps the list for five minutes without asking (src/server/app.ts), so a visit to Home or Search within that long would be told what it knows already:
    it is not asked, and the index of the titles met so far (the shelves', the searches') is not made again from the first rows. */
let rememberedAt = 0;
const LIST_FRESH_MS = 5 * 60_000;

type Status = "loading" | "ready" | "failed";
type Filter = "all" | "movies" | "series" | "cartoons" | "anime";
/** The section each of the filters (but All) is for. */
const FILTER_SECTION: Readonly<Record<Exclude<Filter, "all">, LibrarySection>> = { movies: "movie", series: "series", cartoons: "cartoon", anime: "anime" };

/** A search that could not be made is made again this long after. */
const SEARCH_RETRY_MS = 5000;

/** The rows that come next are asked for when the end of the library is within this many screens of the bottom of what can be seen. */
const NEAR_END = 1.5;
/** A row that can have more titles asks for them when its end is within this many widths of the row, and shows this many empty tiles there while they are on their way. */
const ROW_NEAR_END = 1.5;
const WAITING_TILES = 3;

/** The sources whose titles are TMDB's, which asks for a notice wherever they are shown. */
const TMDB_SOURCES = new Set(["Filmpire"]);

/**
 * The search that was open when the search page went away (a video was started from it, and then stopped): the words, the filter, and what
 * the library answered. Coming back is coming back to the same list, not to an empty box. (How far down the page was scrolled is the shell's to
 * keep: shell/useTabs.ts.)
 */
const kept: { query: string; filter: Filter; found: { query: string; answers: Answers } | null } = { query: "", filter: "all", found: null };

/** The titles of the first row, listed under the empty search box: a list worth tapping before a word is typed. */
const SUGGESTED = 10;

/** The title Home opens with is the first of the first row that has a picture, looked for among this many. */
const HERO_FROM = 6;

/** What a section's page says when the library has nothing of it (the TV's words). */
const SECTION_EMPTY = { movie: "tv.kindEmptyMovies", series: "tv.kindEmptySeries", cartoon: "tv.kindEmptyCartoons", anime: "tv.kindEmptyAnime" } as const satisfies Readonly<Record<LibrarySection, string>>;

/** What a row is in: the section its place says, else what its name suggests ("Feature films", "Classic TV"). A row that says nothing and has none of those words is only in All. */
const NAMES: Readonly<Record<LibrarySection, RegExp>> = {
  movie: /movie|film/i,
  series: /series|shows|docuseries|(^|[^a-z])tv([^a-z]|$)/i,
  cartoon: /cartoon|animat/i,
  anime: /anime/i,
};
const isIn = (row: LibraryData["rows"][number], section: LibrarySection) => {
  const said = sectionOf(row);
  return said ? said === section : NAMES[section].test(`${row.id} ${row.title}`);
};

/** What is typed, as it is looked for. */
const wanted = (query: string) => query.trim().toLowerCase();

/** Whether the end of the library is within `NEAR_END` screens of the bottom of what can be seen: the window, or the sheet the library is in. */
function endIsNear(section: HTMLElement): boolean {
  const sheet = section.closest<HTMLElement>(".sheet-body");
  const view = sheet ? sheet.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const height = view.bottom - view.top;
  return height > 0 && section.getBoundingClientRect().bottom - view.bottom <= height * NEAR_END;
}

/** `browse`: the rows to scroll through (the Home tab). `search`: the box, what it finds, and a list to tap before anything is typed (the Search tab). */
type LibraryMode = "browse" | "search";

/**
 * Rows of titles from the server's library, to scroll through (sideways for more of a row, down for more rows: both go on for as long as the
 * library has any), rows of titles like the ones this profile watched or loved, and a search that lists what it finds one under another (the two
 * are two pages of the phone, `mode`). A tap on a title opens its page (`onOpen`), a hold puts it in a list, and so does the round button on it; with more than one list that asks which
 * (`onPick`). Absent when there is no library, unless there is something (`fallback`) to say instead.
 */
export function Library({
  onOpen,
  onPlay,
  onPick,
  onSeeAll,
  failedLookups = 0,
  fallback,
  mode = "browse",
}: {
  onOpen: (entry: Entry) => void;
  /** Start a film from the title that opens Home (see `Hero`). Absent on a phone with no TV: that title only opens its page. */
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
  onPick: (entry: ListEntry) => void;
  /** A row's heading ends with "See all", which opens the whole row (by its id) one title under the next. */
  onSeeAll?: (rowId: string) => void;
  failedLookups?: number;
  fallback?: ReactNode;
  mode?: LibraryMode;
}) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const scores = useScores();
  const searchPage = mode === "search";
  /** What was typed on the search page (the rows page has no box, and what it is never looking for is not kept from it). */
  const startQuery = searchPage ? kept.query : "";
  const [library, setLibrary] = useState<LibraryData | null>(remembered);
  const [status, setStatus] = useState<Status>(remembered ? "ready" : "loading");
  const [query, setQuery] = useState(startQuery);
  const [answers, setAnswers] = useState<Answers | null>(() => {
    const q = wanted(startQuery);
    return !q ? null : kept.found?.query === q ? kept.found.answers : matchLocal(feed.index, remembered?.rows ?? [], q);
  });
  const [searching, setSearching] = useState(() => Boolean(wanted(startQuery)) && kept.found?.query !== wanted(startQuery));
  const [filter, setFilter] = useState<Filter>(kept.filter);
  const [attempt, setAttempt] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchTry, setSearchTry] = useState(0);
  const root = useRef<HTMLElement>(null);

  // The library as it has grown: its first rows, the ones brought after them as the page is scrolled, and more of each row (see the feed).
  const feeding = useFeed();
  /** A child's profile (see the TV's Browse): the Cartoons for children are all it has, on Home and in the search, and it has no filters. */
  const { settings, progress: watchedCards, ratings: givenScores } = useProfileData();
  const child = settings.child === true;
  const holding = useProfileHold();
  /** The sections the profile watches (its `sections` setting; null: all): the others have no filter and no rows, as on the TV. */
  const wantedKey = (settings.sections ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (child ? null : wantedSections(settings)), [child, wantedKey]);
  const filters = useMemo(() => (["all", "movies", "series", "cartoons", "anime"] as const).filter((each) => each === "all" || !mine || mine.has(FILTER_SECTION[each])), [mine]);
  // (The filter of a section the profile does not watch - kept from another profile - is All.)
  const shownFilter: Filter = filters.includes(filter) ? filter : "all";
  const pageSection = child ? "cartoon" : searchPage || shownFilter === "all" ? undefined : FILTER_SECTION[shownFilter];
  const displayedRows = useMemo(() => {
    const rows = pageRows(feeding.data, pageSection);
    const inSection = pageSection ? rows.filter((row) => isIn(row, pageSection)) : rows.filter((row) => isWanted(mine, row));
    return child ? inSection.map((row) => ({ ...row, items: row.items.filter((item) => forChildren(item, row)) })).filter((row) => row.items.length > 0) : inSection;
  }, [feeding.data, pageSection, child, mine]);
  // (Some rows are wide cards, by the same rule as on the TV: see shared/shapes.ts.)
  const wideRows = useMemo(() => landscapeRows(displayedRows), [displayedRows]);
  // The profile's own rows ("Because you watched ...", "More like ...", "You might like"; shared/taste.ts), of the titles this page shows: among the
  // library's rows, the first under the first of them and then one under every second row, as many as the page has a place for (more are asked for as it
  // grows under the scrolling). A child's profile has them of the titles for children, without the row of what it might like.
  const keepLike = useMemo<((item: LibraryItem) => boolean) | undefined>(
    () => (child ? (item) => forChildren(item) : pageSection ? (item) => sectionOf(item) === pageSection : mine ? (item) => isWanted(mine, item) : undefined),
    [child, pageSection, mine],
  );
  const personal = useLikes({ want: searchPage ? 0 : personalSlots(displayedRows.length), keep: keepLike, picks: !child, page: pageSection ?? "home" });
  // What people watch on Kino: a row of Home (All), not of the search, a section nor a child's profile, as on the TV (shared/watching.ts).
  const homeOnly = !child && !searchPage && pageSection === undefined;
  const watchedHere = useWatching(homeOnly);
  const watching = useMemo(() => (homeOnly ? watchingRow(watchedHere, mine) : []), [homeOnly, watchedHere, mine]);
  // (What the profile has seen is left out of the library's rows after the first; not for a child's profile.)
  const seen = useMemo(() => (child ? new Set<string>() : seenKeys(watchedCards, givenScores)), [child, watchedCards, givenScores]);
  const shownAnswers = useMemo(() => (answers && child ? onlyForChildren(answers) : answers), [answers, child]);

  useEffect(() => {
    kept.filter = filter;
  }, [filter]);

  const shown = Boolean(library && library.rows.length > 0);

  // A video that would not play may have taken its title off the server's lists: ask for them again (the search with them).
  useEffect(() => {
    if (failedLookups > 0) setAttempt((n) => n + 1);
  }, [failedLookups]);

  useEffect(() => {
    if (attempt === 0 && remembered && Date.now() - rememberedAt < LIST_FRESH_MS) return; // (this page was made from it: `library` and `status` start as it)
    let live = true;
    // (Asked again, as after a try that failed or a press on Retry, it is asked past the browser's memory of the last answer.)
    fetch("/api/library", attempt > 0 ? { cache: "reload" } : undefined)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!live) return;
        const parsed = LibrarySchema.safeParse(body);
        if (parsed.success) {
          remembered = parsed.data;
          rememberedAt = Date.now();
          feed.setBase(parsed.data.rows.filter((row) => row.items.length > 0)); // (the rows that come after these, and more of each, are asked for as the page is scrolled: see the feed)
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
    if (searchPage) kept.query = query;
    const q = wanted(query);
    if (!q) {
      setAnswers(null);
      setSearching(false);
      return;
    }
    setSearchFailed(false);

    // What the library answered to these very words before is still good.
    if (kept.found?.query === q) {
      setAnswers(kept.found.answers);
      setSearching(false);
      return;
    }

    // 1. Instant local search among every title this phone has met, not only the ones on the page. (What the server found for the words a letter ago stays while it is asked again.)
    const local = matchLocal(feed.index, library?.rows ?? [], q);
    setAnswers((before) => (before && q.length >= 2 ? mergeAnswers(local, keepMatching(before, q), q) : local));
    if (q.length < 2) return setSearching(false); // a letter is too little to ask the server about
    setSearching(true);

    // 2. Debounced remote search
    const controller = new AbortController();
    const timer = setTimeout(() => {
      Promise.resolve() // (encodeURIComponent throws for a lone half of a pair: inside the chain it is a failed search)
        .then(() => fetch(`/api/library/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search answered ${res.status}`))))
        .then((body: unknown) => {
          const parsed = LibraryItemsSchema.parse(body);
          feed.learn(parsed.items); // (found next time without asking)
          const found = mergeAnswers(local, { items: parsed.items, exact: parsed.exact ?? parsed.items.length }, q);
          kept.found = { query: q, answers: found };
          setAnswers(found);
          setSearching(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearching(false);
          setSearchFailed(true);
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, library, searchTry]);

  // A search that did not get an answer is asked again every few seconds for as long as it is on screen.
  useEffect(() => {
    if (!searchFailed) return;
    const timer = setTimeout(() => setSearchTry((n) => n + 1), SEARCH_RETRY_MS);
    return () => clearTimeout(timer);
  }, [searchFailed, searchTry]);

  // The rows that come next are asked for when the page is scrolled near its end, whatever scrolled it (the window, or the sheet the library is in), and when the
  // page does not fill the screen yet: an answer, or a question that failed and may be asked again, looks again. A search is a list of its own and is not paged.
  const paging = !searchPage && status === "ready" && shown && answers === null;
  const latest = useRef({ paging, pageSection });
  latest.current = { paging, pageSection };
  useEffect(() => {
    const askRows = () => {
      const section = root.current;
      if (section && latest.current.paging && endIsNear(section)) feed.loadShelves(latest.current.pageSection);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && root.current && event.target.contains(root.current)) askRows(); // (a row scrolled sideways says nothing about the page)
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", askRows);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", askRows);
    };
  }, []);
  useEffect(() => {
    if (paging && root.current && endIsNear(root.current)) feed.loadShelves(pageSection);
  }, [feeding, paging, pageSection, displayedRows.length]);

  // (While the profile's settings are not known yet, the library is still loading: see `useProfileHold`.)
  if (status === "loading" || holding) {
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
  if (!library || library.rows.length === 0) {
    // (The search page is never blank: it says what is the matter, where the rows page has the box for pasting a link instead.)
    if (!searchPage) return <>{fallback}</>;
    return (
      <p className="muted" role="status" data-testid="library-empty">
        {t("tv.libraryEmpty")}. {t("tv.libraryEmptyHelp")}
      </p>
    );
  }

  const toggleOf = (item: LibraryItem) => toggleFor(listEntryOf(item));
  const open = (item: LibraryItem) => () => onOpen(entryOfItem(item));
  /** One of the profile's own rows (none: nothing). */
  const own = (row: PersonalRow | undefined) =>
    row && (
      <div className="lib-row" key={row.id} data-testid={row.why === "picks" ? "library-picks" : "library-because"} data-why={row.why}>
        <h3>{titleOfPersonal(row)}</h3>
        <Scroller>
          {row.items.map((item) => (
            <Tile key={item.id} item={item} score={scoreOf(scores, item.url)} toggle={toggleOf(item)} onOpen={open(item)} />
          ))}
        </Scroller>
      </div>
    );
  /** The first row that has titles: what the search page lists until something is typed. */
  const suggested = searchPage && answers === null ? displayedRows.find((row) => row.items.length > 0) : undefined;
  /** What Home opens with (the rows page only; the filter's first row when a kind is chosen). */
  const heroItem = searchPage || answers !== null ? undefined : displayedRows[0]?.items.slice(0, HERO_FROM).find((item) => item.image ?? item.backdrop);

  return (
    <section className="library" data-testid="library" aria-label={t("library.title")} ref={root}>
      {searchPage && (
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
      )}

      {!searchPage && !child && answers === null && (
        <div className="lib-pills" role="group" aria-label={t("library.filter")}>
          {filters.map((each) => (
            <button key={each} type="button" className="lib-pill" aria-pressed={shownFilter === each} onClick={() => setFilter(each)} data-testid={`filter-${each}`}>
              {t(`library.${each}`)}
            </button>
          ))}
        </div>
      )}

      {shownAnswers !== null ? (
        <div className="lib-row" data-testid="library-search-results">
          <h3>
            {shownAnswers.items.length > 0
              ? (shownAnswers.exact > 0 ? t("library.resultsFor", { query: query.trim() }) : t("tv.closestOnly", { query: query.trim() })) + (searchFailed ? t("tv.searchOffline") : "")
              : searching
                ? t("tv.looking")
                : searchFailed
                  ? t("tv.searchFailed")
                  : t("library.noMatches", { query: query.trim() })}
            {searching && <span className="spinner" style={{ marginLeft: 8 }} />}
          </h3>
          {shownAnswers.items.length > 0 && (
            <ul className="poster-grid">
              {shownAnswers.items.map((item, at) => (
                <Fragment key={item.id}>
                  {at === shownAnswers.exact && at > 0 && (
                    <li className="lib-closest-row">
                      <h4 className="lib-closest" data-testid="library-closest">
                        {t("tv.closest")}
                      </h4>
                    </li>
                  )}
                  <li>
                    <Result item={item} score={scoreOf(scores, item.url)} toggle={toggleOf(item)} onOpen={open(item)} />
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
        </div>
      ) : searchPage ? (
        suggested && (
          <div className="lib-row" data-testid="library-suggested">
            <h3>{rowTitle(suggested)}</h3>
            <ul className="poster-grid">
              {suggested.items.slice(0, SUGGESTED).map((item) => (
                <li key={item.id}>
                  <Result item={item} score={scoreOf(scores, item.url)} toggle={toggleOf(item)} onOpen={open(item)} />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <>
          {heroItem && <Hero item={heroItem} toggle={toggleOf(heroItem)} onOpen={onOpen} {...(onPlay ? { onPlay } : {})} />}
          {displayedRows.map((row, index) => (
            <Fragment key={row.id}>
              <div className={`lib-row${wideRows.has(row.id) ? " is-wide is-landscape" : ""}`} data-testid="library-row" data-shape={wideRows.has(row.id) ? "landscape" : undefined}>
                <RowHead
                  title={rowTitle(row)}
                  aside={
                    onSeeAll && (
                      <button type="button" className="row-link" data-testid="row-see-all" aria-label={`${t("rows.seeAll")}: ${rowTitle(row)}`} onClick={() => onSeeAll(row.id)}>
                        {t("rows.seeAll")}
                      </button>
                    )
                  }
                />
                <Scroller {...(hasMoreTitles(feeding, row.id, row.items.length, ROW_CAP) ? { onNearEnd: () => feed.loadMore(row.id, ROW_CAP), loading: loadingTitles(feeding, row.id) } : {})}>
                  {(index === 0 ? row.items : withoutSeen(row.items, seen)).map((item) => (
                    <Tile key={item.id} item={item} score={scoreOf(scores, item.url)} toggle={toggleOf(item)} onOpen={open(item)} wide={wideRows.has(row.id)} />
                  ))}
                </Scroller>
              </div>
              {/* (Under the first row and every second one after it, as on the TV: the next of the profile's own rows.) */}
              {own(personal[personalAfter(index) ?? -1])}
              {index === WATCHING_AFTER && watching.length > 0 && (
                <div className="lib-row" data-testid="library-watching">
                  <h3>{t("rows.watching")}</h3>
                  <Scroller>
                    {watching.map((item) => (
                      <Tile key={item.id} item={item} score={scoreOf(scores, item.url)} toggle={toggleOf(item)} onOpen={open(item)} />
                    ))}
                  </Scroller>
                </div>
              )}
              {/* (After the third row, as on the TV: a row of the page's categories, each a card that opens the whole row.) */}
              {onSeeAll && index === CATEGORIES_AFTER - 1 && displayedRows.length > CATEGORIES_AFTER + 1 && <CategoryRow rows={displayedRows} onOpen={onSeeAll} />}
            </Fragment>
          ))}
          {/* Under the last row: empty tiles while the rows that come next are on their way, and a line when they could not be had (they are asked for again in a moment). */}
          {pageSection && displayedRows.length === 0 && !loadingShelves(feeding, pageSection) && !failedShelves(feeding, pageSection) && !hasMoreShelves(feeding, pageSection) && (
            <p className="muted small" role="status" data-testid="library-section-empty">
              {t(SECTION_EMPTY[pageSection])}
            </p>
          )}
          {failedShelves(feeding, pageSection) && (
            <p className="muted small" role="status" data-testid="library-rows-failed">
              {t("rows.moreFailed")}
            </p>
          )}
          {loadingShelves(feeding, pageSection) && (
            <div className="lib-row" aria-hidden="true" data-testid="library-rows-waiting">
              <span className="lib-waiting-title" />
              <div className="lib-scroller">
                {Array.from({ length: WAITING_TILES + 1 }, (_, at) => (
                  <div className="lib-tile lib-waiting" key={at}>
                    <span className="lib-art" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <p className="muted small">
        {t("library.credit", { sources: [...new Set(library.rows.map((row) => row.source))].join(", ") })}
        {library.rows.some((row) => TMDB_SOURCES.has(row.source)) && ` ${t("library.tmdb")}`}
      </p>
    </section>
  );
}

/**
 * A row's tiles, to scroll sideways. A row the library can add titles to (`onNearEnd`) asks for them as its end comes near, whoever scrolled it (a finger, or the
 * page growing under it), and asks again after each answer while the end is still near (so a row that does not fill the screen fills it). `loading` shows empty tiles at its end.
 */
function Scroller({ children, onNearEnd, loading }: { children: ReactNode; onNearEnd?: () => void; loading?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const wantsMore = useRef(onNearEnd);
  wantsMore.current = onNearEnd;
  const measure = () => {
    const row = box.current;
    if (row && row.clientWidth > 0 && row.scrollWidth - row.clientWidth - row.scrollLeft <= row.clientWidth * ROW_NEAR_END) wantsMore.current?.();
  };
  // (The titles of a row come as the library fills in, and the window changes size: look again each time.)
  useEffect(measure);
  return (
    <div className="lib-scroller" ref={box} onScroll={measure}>
      {children}
      {loading && Array.from({ length: WAITING_TILES }, (_, at) => <div className="lib-tile lib-waiting" aria-hidden="true" data-testid="library-waiting" key={`waiting-${at}`}><span className="lib-art" /></div>)}
    </div>
  );
}

/**
 * The row of categories (the TV has it as well): a card for each row of the page, with its name and the posters of its first titles fanned at its end, that
 * opens the whole row. It is a third shape among the rows, with the posters and the wide cards (the owner, 15 Nov: "Mix the row shapes ... on the phone too").
 */
function CategoryRow({ rows, onOpen }: { rows: readonly LibraryRow[]; onOpen: (rowId: string) => void }) {
  const t = useT();
  return (
    <section className="lib-row is-categories" data-testid="library-categories" aria-label={t("tv.byCategory")}>
      <h3>{t("tv.byCategory")}</h3>
      <div className="lib-scroller">
        {rows.slice(0, CATEGORY_TILES).map((row) => {
          const posters = row.items.flatMap((item) => (item.image ? [item.image] : [])).slice(0, 3);
          return (
            <button key={row.id} type="button" className="lib-cat" style={{ "--hue": hueOf(row.id) } as CSSProperties} onClick={() => onOpen(row.id)} data-testid="library-category">
              <span className="lib-cat-name">{rowTitle(row)}</span>
              <span className="lib-cat-fan" aria-hidden="true">
                {posters.map((poster, at) => (
                  <img key={poster} loading="lazy" {...posterSizes(poster)} src={poster} alt="" decoding="async" referrerPolicy="no-referrer" style={{ "--at": at } as CSSProperties} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A title in a row (or on the page of a whole row): its poster with its name under it, the score this profile gave it (top left) and a tick if it is in a list
 * (top right). There is no button on it for the lists: a hold does that (`toggle.onHold`), and so does the button of the title's page.
 */
export function Tile({ item, score, toggle, onOpen, wide }: { item: LibraryItem; score: number | undefined; toggle: ListToggle; onOpen: () => void; wide?: boolean }) {
  const hold = useHold(toggle.onHold);
  return (
    <div className="lib-tile" data-in-list={toggle.inList}>
      <button className="lib-card" data-testid="library-tile" onClick={hold.tap(onOpen)} {...hold.props} title={item.title}>
        {/* (A row of wide cards shows a still of each title: see shared/shapes.ts.) */}
        <Poster className="lib-art" title={item.title} image={wide ? (item.backdrop ?? item.image) : (item.image ?? item.backdrop)} seed={item.id}>
          {score !== undefined && <ScoreBadge score={score} />}
          {toggle.inList && <SavedMark />}
        </Poster>
        <span className="lib-title"><ShownTitle of={item} /></span>
      </button>
    </div>
  );
}

/** A title found by the search: a poster in the grid of what it found, with its name, and its year and kind under that (a search is where they tell titles apart). */
function Result({ item, score, toggle, onOpen }: { item: LibraryItem; score: number | undefined; toggle: ListToggle; onOpen: () => void }) {
  const t = useT();
  const hold = useHold(toggle.onHold);
  const kind = item.kind === "movie" ? t("library.kindMovie") : item.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [item.year, kind].filter(Boolean).join(" · ");
  return (
    <div className="lib-tile" data-in-list={toggle.inList}>
      <button className="lib-card" data-testid="library-result" onClick={hold.tap(onOpen)} {...hold.props} title={item.title}>
        <Poster className="lib-art" title={item.title} image={item.image ?? item.backdrop} seed={item.id}>
          {score !== undefined && <ScoreBadge score={score} />}
          {toggle.inList && <SavedMark />}
        </Poster>
        <span className="lib-title"><ShownTitle of={item} /></span>
        {meta && <span className="lib-year">{meta}</span>}
      </button>
    </div>
  );
}
