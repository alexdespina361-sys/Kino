import { useEffect, useMemo, useState } from "react";
import { LibrarySchema, type Library as LibraryData, type LibraryItem } from "../../shared";

/** What the server last listed, so a visit to the home screen after the first shows it at once. */
let remembered: LibraryData | null = null;

type Status = "loading" | "ready" | "failed";

/** Rows of titles from the server's library, to scroll through and tap. A title plays like a pasted link. Absent when there is none. */
export function Library({ onPlay }: { onPlay: (url: string) => void }) {
  const [library, setLibrary] = useState<LibraryData | null>(remembered);
  const [status, setStatus] = useState<Status>(remembered ? "ready" : "loading");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibraryItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<"all" | "movies" | "series">("all");

  const displayedRows = useMemo(() => {
    if (!library) return [];
    if (filter === "movies") {
      return library.rows.filter((r) => r.id.includes("movie") || r.title.toLowerCase().includes("movie"));
    }
    if (filter === "series") {
      return library.rows.filter(
        (r) =>
          r.id.includes("tv") ||
          r.title.toLowerCase().includes("series") ||
          r.title.toLowerCase().includes("shows") ||
          r.title.toLowerCase().includes("docuseries") ||
          r.title.toLowerCase().includes("anime"),
      );
    }
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
        <span className="spinner" /> Loading the library…
      </p>
    );
  }
  if (!library || library.rows.length === 0) return null;

  return (
    <section className="library" data-testid="library" aria-label="Library">
      <div className="field lib-search-field">
        <input
          type="search"
          placeholder="Search movies & shows…"
          aria-label="Search library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="library-search-input"
        />
        {query && (
          <button
            type="button"
            className="field-btn icon"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {searchResults === null && (
        <div className="lib-filter-pills" style={{ display: "flex", gap: "8px", margin: "10px 0 16px" }}>
          <button
            type="button"
            className={`btn btn-sm ${filter === "all" ? "active" : ""}`}
            style={{ borderRadius: "20px", padding: "4px 14px", background: filter === "all" ? "var(--red, #e50914)" : "rgba(255,255,255,0.08)", color: "#fff", border: "none" }}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filter === "movies" ? "active" : ""}`}
            style={{ borderRadius: "20px", padding: "4px 14px", background: filter === "movies" ? "var(--red, #e50914)" : "rgba(255,255,255,0.08)", color: "#fff", border: "none" }}
            onClick={() => setFilter("movies")}
          >
            Movies
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filter === "series" ? "active" : ""}`}
            style={{ borderRadius: "20px", padding: "4px 14px", background: filter === "series" ? "var(--red, #e50914)" : "rgba(255,255,255,0.08)", color: "#fff", border: "none" }}
            onClick={() => setFilter("series")}
          >
            Series
          </button>
        </div>
      )}

      {searchResults !== null ? (
        <div className="lib-row" data-testid="library-search-results">
          <h3>
            {searchResults.length > 0 ? `Results for "${query}"` : `No matches for "${query}"`}
            {searching && <span className="spinner" style={{ marginLeft: 8 }} />}
          </h3>
          {searchResults.length > 0 && (
            <div className="lib-scroller">
              {searchResults.map((item) => (
                <Tile key={item.id} item={item} onPlay={() => onPlay(new URL(item.url, location.href).href)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        displayedRows.map((row) => (
          <div className="lib-row" key={row.id} data-testid="library-row">
            <h3>{row.title}</h3>
            <div className="lib-scroller">
              {row.items.map((item) => (
                <Tile key={item.id} item={item} onPlay={() => onPlay(new URL(item.url, location.href).href)} />
              ))}
            </div>
          </div>
        ))
      )}
      <p className="muted small">
        From {[...new Set(library.rows.map((row) => row.source))].join(", ")}. What is listed, and the terms it comes with, is up to them.
      </p>
    </section>
  );
}

function Tile({ item, onPlay }: { item: LibraryItem; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button className="lib-tile" data-testid="library-tile" onClick={onPlay} title={item.title}>
      <span className="lib-art">
        {item.image && !broken && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      </span>
      <span className="lib-title">{item.title}</span>
      {item.year && <span className="lib-year">{item.year}</span>}
    </button>
  );
}
