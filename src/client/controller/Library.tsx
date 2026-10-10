import { useEffect, useMemo, useState } from "react";
import { LibrarySchema, listKey, type Library as LibraryData, type LibraryItem, type PlayHint } from "../../shared";
import { hintOf, listEntryOf } from "../account/cards";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { CheckIcon, PlusIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";

/** What the server last listed, so a visit to the home screen after the first shows it at once. */
let remembered: LibraryData | null = null;

type Status = "loading" | "ready" | "failed";
type Filter = "all" | "movies" | "series";

const isMovies = (row: LibraryData["rows"][number]) => row.id.includes("movie") || row.title.toLowerCase().includes("movie");
const isSeries = (row: LibraryData["rows"][number]) => row.id.includes("tv") || /series|shows|docuseries|anime/i.test(row.title);

/** Rows of titles from the server's library, to scroll through and tap. A title plays like a pasted link. Absent when there is none. */
export function Library({ onPlay }: { onPlay: (url: string, hint: PlayHint) => void }) {
  const t = useT();
  const { list } = useProfileData();
  const saved = useMemo(() => new Set(list.map((entry) => entry.key)), [list]);
  const [library, setLibrary] = useState<LibraryData | null>(remembered);
  const [status, setStatus] = useState<Status>(remembered ? "ready" : "loading");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibraryItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const displayedRows = useMemo(() => {
    if (!library) return [];
    if (filter === "movies") return library.rows.filter(isMovies);
    if (filter === "series") return library.rows.filter(isSeries);
    return library.rows;
  }, [library, filter]);

  useEffect(() => {
    let live = true;
    fetch("/api/library")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const parsed = LibrarySchema.safeParse(body);
        if (!live) return;
        if (parsed.success) {
          remembered = parsed.data;
          setLibrary(parsed.data);
          setStatus("ready");
        } else setStatus((now) => (now === "ready" ? now : "failed"));
      })
      .catch(() => live && setStatus((now) => (now === "ready" ? now : "failed")));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    // 1. Instant local search from loaded rows
    const seen = new Set<string>();
    const localMatches: LibraryItem[] = [];
    if (library) {
      for (const row of library.rows) {
        for (const item of row.items) {
          if (item.title.toLowerCase().includes(q) && !seen.has(item.id)) {
            seen.add(item.id);
            localMatches.push(item);
          }
        }
      }
    }
    setSearchResults(localMatches);
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
            const combined = [...localMatches];
            for (const item of data.items) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                combined.push(item);
              }
            }
            setSearchResults(combined);
          }
        })
        .catch(() => {
          if (live) setSearching(false);
        });
    }, 350);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, library]);

  if (status === "loading") {
    return (
      <p className="muted small" data-testid="library-loading">
        <span className="spinner" /> {t("library.loading")}
      </p>
    );
  }
  if (!library || library.rows.length === 0) return null;

  const tile = (item: LibraryItem) => (
    <Tile
      key={item.id}
      item={item}
      inList={saved.has(listKey(item.url))}
      onPlay={() => onPlay(new URL(item.url, location.href).href, hintOf(item))}
      onToggleList={(add) => profileStore.setInList(listEntryOf(item), add)}
    />
  );

  return (
    <section className="library" data-testid="library" aria-label={t("library.title")}>
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
            {searchResults.length > 0 ? t("library.resultsFor", { query }) : t("library.noMatches", { query })}
            {searching && <span className="spinner" style={{ marginLeft: 8 }} />}
          </h3>
          {searchResults.length > 0 && <div className="lib-scroller">{searchResults.map(tile)}</div>}
        </div>
      ) : (
        displayedRows.map((row) => (
          <div className="lib-row" key={row.id} data-testid="library-row">
            <h3>{row.title}</h3>
            <div className="lib-scroller">{row.items.map(tile)}</div>
          </div>
        ))
      )}
      <p className="muted small">{t("library.credit", { sources: [...new Set(library.rows.map((row) => row.source))].join(", ") })}</p>
    </section>
  );
}

function Tile({ item, inList, onPlay, onToggleList }: { item: LibraryItem; inList: boolean; onPlay: () => void; onToggleList: (add: boolean) => void }) {
  const t = useT();
  return (
    <div className="lib-tile has-remove" data-in-list={inList}>
      <button className="lib-card" data-testid="library-tile" onClick={onPlay} title={item.title}>
        <Poster className="lib-art" title={item.title} image={item.image} seed={item.id} />
        <span className="lib-title">{item.title}</span>
        {item.year && <span className="lib-year">{item.year}</span>}
      </button>
      <button
        className="lib-remove lib-add"
        onClick={() => onToggleList(!inList)}
        aria-pressed={inList}
        aria-label={`${inList ? t("library.inList") : t("library.addToList")}: ${item.title}`}
        data-testid="library-list-toggle"
      >
        {inList ? <CheckIcon /> : <PlusIcon />}
      </button>
    </div>
  );
}
