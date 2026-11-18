import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ShownTitle } from "../shared/Shown";
import { forChildren, isWanted, LibraryItemsSchema, LibrarySchema, sectionOf, wantedSections, type Library as LibraryData, type LibraryItem, type LibraryRow, type LibrarySection, type PlayHint } from "../../shared";
import { listEntryOf, hintOf, listName } from "../account/cards";
import type { ListEntry } from "../account/profileStore";
import { scoreOf, useScores } from "../account/ratings";
import { useProfileData } from "../account/store";
import { rowTitle, useT } from "../i18n";
import { useProfileHold } from "../shared/profileHold";
import { failedShelves, feed, hasMoreShelves, hasMoreTitles, loadingShelves, loadingTitles, pageRows, ROW_CAP, useFeed } from "../shared/feed";
import { hueOf, Poster, posterSizes, sharper } from "../shared/Poster";
import { titleOfPersonal, useLikes } from "../shared/recommend";
import { personalAfter, personalSlots, seenKeys, withoutSeen, type PersonalRow } from "../shared/taste";
import { useWatching, WATCHING_AFTER, watchingRow } from "../shared/watching";
import { ScoreBadge } from "../shared/ScoreBadge";
import { landscapeRows } from "../shared/shapes";
import { keepMatching, matchLocal, mergeAnswers, onlyForChildren, type Answers } from "../tv/librarySearch";
import { CATEGORIES_AFTER, CATEGORY_TILES, entryOfItem, type Entry, resumable } from "../tv/pages";
import { useHold } from "./hold";
import { RowHead } from "./Rows";
import { SavedMark, useListToggle, type ListToggle } from "./Round";
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from "../shared/icons";

function Hero({
  item,
  toggle,
  onOpen,
  onPlay,
}: {
  item: LibraryItem;
  toggle: ListToggle;
  onOpen: (entry: Entry) => void;
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
}) {
  const t = useT();
  const { progress, lists } = useProfileData();
  const entry = resumable(entryOfItem(item), progress);
  const kind = item.kind === "movie" ? t("library.kindMovie") : item.kind === "series" ? t("library.kindSeries") : undefined;
  const meta = [item.year, kind].filter(Boolean).join(" · ");
  const plays = onPlay !== undefined && item.kind === "movie" && entry.url !== "";
  const label = plays ? t(entry.startAt !== undefined ? "rows.resume" : "rows.play") : item.kind === "series" ? t("player.episodes") : t("rows.open");
  const open = () => onOpen(entryOfItem(item));
  const play = () => onPlay?.(new URL(entry.resumeUrl ?? entry.url, location.href).href, entry.startAt, hintOf(entry));
  return (
    <section className="hero" data-testid="home-hero" aria-label={item.title}>
      <button type="button" className="hero-open" onClick={open} aria-label={`${t("rows.open")} ${item.title}`} data-testid="hero-open">
        <Poster className="lib-art hero-art" title={item.title} image={sharper(item.image) ?? item.backdrop} seed={item.id} />
      </button>
      <div className="hero-text">
        <h2 className="hero-title">{item.title}</h2>
        {meta && <p className="hero-meta">{meta}</p>}
        <div className="hero-actions">
          <button type="button" className="btn btn-red hero-play" onClick={plays ? play : open} data-testid="hero-play">
            {plays ? <PlayIcon /> : <InfoIcon />} {label}
          </button>
          <button type="button" className="btn hero-list" onClick={toggle.onClick} aria-pressed={toggle.inList} aria-haspopup={toggle.asks ? "dialog" : undefined} aria-label={`${toggle.label}: ${item.title}`} data-testid="hero-list">
            {toggle.inList ? <CheckIcon /> : <PlusIcon />} {toggle.asks ? t("rows.myList") : listName(lists[0]!)}
          </button>
        </div>
      </div>
    </section>
  );
}

let remembered: LibraryData | null = null;
let rememberedAt = 0;
const LIST_FRESH_MS = 5 * 60_000;

type Status = "loading" | "ready" | "failed";
type Filter = "all" | "movies" | "series" | "cartoons" | "anime";
const FILTER_SECTION: Readonly<Record<Exclude<Filter, "all">, LibrarySection>> = { movies: "movie", series: "series", cartoons: "cartoon", anime: "anime" };

const SEARCH_RETRY_MS = 5000;

const NEAR_END = 1.5;
const ROW_NEAR_END = 1.5;
const WAITING_TILES = 3;

const TMDB_SOURCES = new Set(["Filmpire"]);

const kept: { query: string; filter: Filter; found: { query: string; answers: Answers } | null } = { query: "", filter: "all", found: null };

const SUGGESTED = 10;

const HERO_FROM = 6;

const SECTION_EMPTY = { movie: "tv.kindEmptyMovies", series: "tv.kindEmptySeries", cartoon: "tv.kindEmptyCartoons", anime: "tv.kindEmptyAnime" } as const satisfies Readonly<Record<LibrarySection, string>>;

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

const wanted = (query: string) => query.trim().toLowerCase();

function endIsNear(section: HTMLElement): boolean {
  const sheet = section.closest<HTMLElement>(".sheet-body");
  const view = sheet ? sheet.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const height = view.bottom - view.top;
  return height > 0 && section.getBoundingClientRect().bottom - view.bottom <= height * NEAR_END;
}

type LibraryMode = "browse" | "search";

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
  onPlay?: (url: string, startAt: number | undefined, hint: PlayHint) => void;
  onPick: (entry: ListEntry) => void;
  onSeeAll?: (rowId: string) => void;
  failedLookups?: number;
  fallback?: ReactNode;
  mode?: LibraryMode;
}) {
  const t = useT();
  const toggleFor = useListToggle(onPick);
  const scores = useScores();
  const searchPage = mode === "search";
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

  const feeding = useFeed();
  const { settings, progress: watchedCards, ratings: givenScores } = useProfileData();
  const child = settings.child === true;
  const holding = useProfileHold();
  const wantedKey = (settings.sections ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (child ? null : wantedSections(settings)), [child, wantedKey]);
  const filters = useMemo(() => (["all", "movies", "series", "cartoons", "anime"] as const).filter((each) => each === "all" || !mine || mine.has(FILTER_SECTION[each])), [mine]);
  const shownFilter: Filter = filters.includes(filter) ? filter : "all";
  const pageSection = child ? "cartoon" : searchPage || shownFilter === "all" ? undefined : FILTER_SECTION[shownFilter];
  const displayedRows = useMemo(() => {
    const rows = pageRows(feeding.data, pageSection);
    const inSection = pageSection ? rows.filter((row) => isIn(row, pageSection)) : rows.filter((row) => isWanted(mine, row));
    return child ? inSection.map((row) => ({ ...row, items: row.items.filter((item) => forChildren(item, row)) })).filter((row) => row.items.length > 0) : inSection;
  }, [feeding.data, pageSection, child, mine]);
  const wideRows = useMemo(() => landscapeRows(displayedRows), [displayedRows]);
  const keepLike = useMemo<((item: LibraryItem) => boolean) | undefined>(
    () => (child ? (item) => forChildren(item) : pageSection ? (item) => sectionOf(item) === pageSection : mine ? (item) => isWanted(mine, item) : undefined),
    [child, pageSection, mine],
  );
  const personal = useLikes({ want: searchPage ? 0 : personalSlots(displayedRows.length), keep: keepLike, picks: !child, page: pageSection ?? "home" });
  const homeOnly = !child && !searchPage && pageSection === undefined;
  const watchedHere = useWatching(homeOnly);
  const watching = useMemo(() => (homeOnly ? watchingRow(watchedHere, mine) : []), [homeOnly, watchedHere, mine]);
  const seen = useMemo(() => (child ? new Set<string>() : seenKeys(watchedCards, givenScores)), [child, watchedCards, givenScores]);
  const shownAnswers = useMemo(() => (answers && child ? onlyForChildren(answers) : answers), [answers, child]);

  useEffect(() => {
    kept.filter = filter;
  }, [filter]);

  const shown = Boolean(library && library.rows.length > 0);

  useEffect(() => {
    if (failedLookups > 0) setAttempt((n) => n + 1);
  }, [failedLookups]);

  useEffect(() => {
    if (attempt === 0 && remembered && Date.now() - rememberedAt < LIST_FRESH_MS) return;
    let live = true;
    fetch("/api/library", attempt > 0 ? { cache: "reload" } : undefined)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!live) return;
        const parsed = LibrarySchema.safeParse(body);
        if (parsed.success) {
          remembered = parsed.data;
          rememberedAt = Date.now();
          feed.setBase(parsed.data.rows.filter((row) => row.items.length > 0));
          if (attempt > 0) kept.found = null;
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

    if (kept.found?.query === q) {
      setAnswers(kept.found.answers);
      setSearching(false);
      return;
    }

    const local = matchLocal(feed.index, library?.rows ?? [], q);
    setAnswers((before) => (before && q.length >= 2 ? mergeAnswers(local, keepMatching(before, q), q) : local));
    if (q.length < 2) return setSearching(false);
    setSearching(true);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => fetch(`/api/library/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search answered ${res.status}`))))
        .then((body: unknown) => {
          const parsed = LibraryItemsSchema.parse(body);
          feed.learn(parsed.items);
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

  useEffect(() => {
    if (!searchFailed) return;
    const timer = setTimeout(() => setSearchTry((n) => n + 1), SEARCH_RETRY_MS);
    return () => clearTimeout(timer);
  }, [searchFailed, searchTry]);

  const paging = !searchPage && status === "ready" && shown && answers === null;
  const latest = useRef({ paging, pageSection });
  latest.current = { paging, pageSection };
  useEffect(() => {
    const askRows = () => {
      const section = root.current;
      if (section && latest.current.paging && endIsNear(section)) feed.loadShelves(latest.current.pageSection);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && root.current && event.target.contains(root.current)) askRows();
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
    if (!searchPage) return <>{fallback}</>;
    return (
      <p className="muted" role="status" data-testid="library-empty">
        {t("tv.libraryEmpty")}. {t("tv.libraryEmptyHelp")}
      </p>
    );
  }

  const toggleOf = (item: LibraryItem) => toggleFor(listEntryOf(item));
  const open = (item: LibraryItem) => () => onOpen(entryOfItem(item));
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
  const suggested = searchPage && answers === null ? displayedRows.find((row) => row.items.length > 0) : undefined;
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
              {onSeeAll && index === CATEGORIES_AFTER - 1 && displayedRows.length > CATEGORIES_AFTER + 1 && <CategoryRow rows={displayedRows} onOpen={onSeeAll} />}
            </Fragment>
          ))}
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

function Scroller({ children, onNearEnd, loading }: { children: ReactNode; onNearEnd?: () => void; loading?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const wantsMore = useRef(onNearEnd);
  wantsMore.current = onNearEnd;
  const measure = () => {
    const row = box.current;
    if (row && row.clientWidth > 0 && row.scrollWidth - row.clientWidth - row.scrollLeft <= row.clientWidth * ROW_NEAR_END) wantsMore.current?.();
  };
  useEffect(measure);
  return (
    <div className="lib-scroller" ref={box} onScroll={measure}>
      {children}
      {loading && Array.from({ length: WAITING_TILES }, (_, at) => <div className="lib-tile lib-waiting" aria-hidden="true" data-testid="library-waiting" key={`waiting-${at}`}><span className="lib-art" /></div>)}
    </div>
  );
}

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

export function Tile({ item, score, toggle, onOpen, wide }: { item: LibraryItem; score: number | undefined; toggle: ListToggle; onOpen: () => void; wide?: boolean }) {
  const hold = useHold(toggle.onHold);
  return (
    <div className="lib-tile" data-in-list={toggle.inList}>
      <button className="lib-card" data-testid="library-tile" onClick={hold.tap(onOpen)} {...hold.props} title={item.title}>
        <Poster className="lib-art" title={item.title} image={wide ? (item.backdrop ?? item.image) : (item.image ?? item.backdrop)} seed={item.id}>
          {score !== undefined && <ScoreBadge score={score} />}
          {toggle.inList && <SavedMark />}
        </Poster>
        <span className="lib-title"><ShownTitle of={item} /></span>
      </button>
    </div>
  );
}

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
