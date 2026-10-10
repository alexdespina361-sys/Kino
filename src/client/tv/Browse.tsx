import { useEffect, useRef, useState } from "react";
import { LibrarySchema, type Library as LibraryData, type LibraryItem } from "../../shared";
import { Logo } from "../shared/Logo";

interface BrowseProps {
  onPlay: (url: string) => void;
  onClose: () => void;
}

export function TvBrowse({ onPlay, onClose }: BrowseProps) {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/library")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!live) return;
        const parsed = LibrarySchema.safeParse(data);
        if (parsed.success) setLibrary(parsed.data);
        setLoading(false);
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Keyboard navigation within the browse screen
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Auto-focus the first tile when loaded
    const timer = setTimeout(() => {
      const first = root.querySelector<HTMLElement>(".tv-browse-tile");
      first?.focus();
    }, 100);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack") {
        e.preventDefault();
        onClose();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;

      const currentRow = active.closest<HTMLElement>(".tv-browse-row");
      if (!currentRow) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const tiles = [...currentRow.querySelectorAll<HTMLElement>(".tv-browse-tile")];
        const idx = tiles.indexOf(active);
        if (idx !== -1) {
          const nextIdx = e.key === "ArrowRight" ? Math.min(tiles.length - 1, idx + 1) : Math.max(0, idx - 1);
          const next = tiles[nextIdx];
          if (next && next !== active) {
            e.preventDefault();
            next.focus();
            next.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          }
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const rows = [...root.querySelectorAll<HTMLElement>(".tv-browse-row")];
        const rowIdx = rows.indexOf(currentRow);
        if (rowIdx !== -1) {
          const nextRowIdx = e.key === "ArrowDown" ? rowIdx + 1 : rowIdx - 1;
          if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
            e.preventDefault();
            const targetRow = rows[nextRowIdx]!;
            // Focus tile at roughly matching index or first tile
            const currentTiles = [...currentRow.querySelectorAll<HTMLElement>(".tv-browse-tile")];
            const currentIdx = currentTiles.indexOf(active);
            const targetTiles = [...targetRow.querySelectorAll<HTMLElement>(".tv-browse-tile")];
            const targetTile = targetTiles[Math.min(targetTiles.length - 1, Math.max(0, currentIdx))] ?? targetTiles[0];
            if (targetTile) {
              targetTile.focus();
              targetTile.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }
          } else if (e.key === "ArrowUp" && rowIdx === 0) {
            // Focus close button
            const closeBtn = root.querySelector<HTMLElement>(".tv-browse-close");
            if (closeBtn) {
              e.preventDefault();
              closeBtn.focus();
            }
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [loading, onClose]);

  return (
    <section className="tv-browse" ref={rootRef} data-testid="tv-browse" aria-label="Browse Library">
      <header className="tv-browse-header">
        <div style={{ display: "flex", alignItems: "center", gap: "2em" }}>
          <Logo />
          <h1 className="tv-browse-title">Browse Library</h1>
        </div>
        <button
          className="tv-btn tv-browse-close"
          onClick={onClose}
          data-testid="tv-browse-close"
          aria-label="Back to Player"
        >
          ✕ Back
        </button>
      </header>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "1em", fontSize: "2em", color: "#aaa" }}>
          <span className="spinner tv-spinner" /> Loading library titles…
        </div>
      )}

      {!loading && (!library || library.rows.length === 0) && (
        <p style={{ fontSize: "2em", color: "#aaa" }}>No titles currently available in the library.</p>
      )}

      {library?.rows.map((row) => (
        <div className="tv-browse-row" key={row.id}>
          <h2 className="tv-browse-row-title">{row.title}</h2>
          <div className="tv-browse-scroller">
            {row.items.map((item) => (
              <BrowseTile
                key={item.id}
                item={item}
                onPlay={() => onPlay(new URL(item.url, location.href).href)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function BrowseTile({ item, onPlay }: { item: LibraryItem; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);

  return (
    <button
      className="tv-browse-tile"
      onClick={onPlay}
      data-testid="tv-browse-tile"
      title={item.title}
      tabIndex={0}
      onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })}
    >
      <span className="tv-browse-art">
        {item.image && !broken && (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        )}
      </span>
      <span className="tv-browse-name">{item.title}</span>
      {item.year && <span className="tv-browse-year">{item.year}</span>}
    </button>
  );
}
