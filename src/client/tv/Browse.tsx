import { useEffect, useRef, useState } from "react";
import { LibrarySchema, type Library, type LibraryItem, type LibraryRow } from "../../shared";
import { Logo } from "../shared/Logo";
import { useDpad } from "./dpad";
import { actionForKey } from "./keys";

interface BrowseProps {
  onPlay: (url: string) => void;
  onClose: () => void;
  /** Said when the title that was just chosen would not play. */
  notice?: string | null;
}

/** What the screen looked like when it was last left, so coming back from a film lands on the same title, at once. */
const remembered: { library: Library | null; row: number; col: number } = { library: null, row: 0, col: 0 };

/** Wait this long on a title before the banner changes to it, so scrolling past many does not flicker through them. */
const BANNER_DELAY_MS = 200;

const tileAt = (root: ParentNode, row: number, col: number) => root.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);

/**
 * The library on the TV, laid out like a streaming app: a banner for the title the remote is on, and rows of titles under it.
 * The arrow keys walk the rows (Up from the first reaches Back), OK plays, and Back leaves.
 */
export function TvBrowse({ onPlay, onClose, notice }: BrowseProps) {
  const [library, setLibrary] = useState<Library | null>(remembered.library);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(remembered.library ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [banner, setBanner] = useState<{ item: LibraryItem; row: LibraryRow } | null>(null);
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

  const rows = (library?.rows ?? []).filter((row) => row.items.length > 0);
  const hasTiles = status === "ready" && rows.length > 0;
  // Where the remote starts: the first title, or on a return from a film, the one it left.
  const startRow = Math.min(remembered.row, Math.max(0, rows.length - 1));
  const startCol = Math.min(remembered.col, Math.max(0, (rows[startRow]?.items.length ?? 1) - 1));
  const startItem = rows[startRow]?.items[startCol];
  const shown = banner ?? (startItem ? { item: startItem, row: rows[startRow]! } : null);

  useEffect(() => {
    // Keys pressed while it loaded may have landed on Back; the titles are what the remote is for.
    if (!hasTiles || !rootRef.current || (document.activeElement as HTMLElement | null)?.dataset.row !== undefined) return;
    tileAt(rootRef.current, startRow, startCol)?.focus({ preventScroll: true });
  }, [hasTiles]);

  useEffect(() => () => window.clearTimeout(bannerTimer.current), []);

  // Arrow keys walk the rows. Without titles (loading, failed) the shared walker takes over for the buttons.
  useDpad(rootRef, !hasTiles);
  useEffect(() => {
    if (!hasTiles) return;
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const action = actionForKey(event);
      if (!root || event.altKey || event.ctrlKey || event.metaKey) return;
      if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return;
      event.preventDefault();

      const at = document.activeElement as HTMLElement | null;
      if (!at || at.dataset.row === undefined) {
        if (at?.matches(".tv-back")) {
          if (action === "down") tileAt(root, Math.min(remembered.row, rows.length - 1), remembered.col)?.focus({ preventScroll: true });        } else {
          tileAt(root, 0, 0)?.focus({ preventScroll: true });
        }
        return;
      }
      const row = Number(at.dataset.row);
      const col = Number(at.dataset.col);
      const inRow = (r: number) => Math.min(col, rows[r]!.items.length - 1);
      if (action === "left" && col > 0) tileAt(root, row, col - 1)?.focus({ preventScroll: true });
      else if (action === "right" && col < rows[row]!.items.length - 1) tileAt(root, row, col + 1)?.focus({ preventScroll: true });
      else if (action === "down" && row < rows.length - 1) tileAt(root, row + 1, inRow(row + 1))?.focus({ preventScroll: true });
      else if (action === "up") {
        if (row > 0) tileAt(root, row - 1, inRow(row - 1))?.focus({ preventScroll: true });
        else root.querySelector<HTMLElement>(".tv-back")?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasTiles, rows]);

  /** The focus moved onto a title: keep it in view (the page itself never scrolls) and, after a pause, let the banner say what it is. */
  const arrived = (tile: HTMLElement, row: number, col: number) => {
    remembered.row = row;
    remembered.col = col;

    const scroller = tile.parentElement!;
    const edge = tile.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const room = edge.width * 0.7; // keep a title beside it showing, so there is somewhere to go
    if (edge.left < view.left + room) scroller.scrollBy({ left: edge.left - view.left - room, behavior: "smooth" });
    else if (edge.right > view.right - room) scroller.scrollBy({ left: edge.right - view.right + room, behavior: "smooth" });
    rowsRef.current?.scrollTo({ top: scroller.parentElement!.offsetTop, behavior: "smooth" });

    window.clearTimeout(bannerTimer.current);
    const next = { item: rows[row]!.items[col]!, row: rows[row]! };
    if (!banner) setBanner(next);
    else bannerTimer.current = window.setTimeout(() => setBanner(next), BANNER_DELAY_MS);
  };

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };

  return (
    <section className="tv-browse" ref={rootRef} data-testid="tv-browse" aria-label="Library">
      {shown?.item.image && <div className="tv-hero-bg" key={shown.item.id} style={{ backgroundImage: `url(${JSON.stringify(shown.item.image)})` }} />}
      <div className="tv-browse-shade" />

      <header className="tv-browse-top">
        <span className="tv-browse-logo">
          <Logo />
        </span>
        {notice && (
          <p className="tv-notice" role="alert" data-testid="tv-notice">
            {notice}
          </p>
        )}
        <button className="tv-back" onClick={onClose} data-testid="tv-browse-close" data-nav>
          Back
        </button>
      </header>

      <div className="tv-hero" data-testid="tv-hero">
        {shown ? (
          <>
            <p className="tv-hero-eyebrow">{shown.row.title}</p>
            <h1 className="tv-hero-title" data-testid="tv-hero-title">
              {shown.item.title}
            </h1>
            <p className="tv-hero-meta">{[shown.item.year, shown.row.source].filter(Boolean).join("  ·  ")}</p>
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
              <button className="tv-action tv-action-primary" onClick={retry} autoFocus data-testid="tv-browse-retry" data-nav>
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
                <div className="tv-row-tiles">
                  {row.items.map((item, c) => (
                    <Tile key={item.id} item={item} row={r} col={c} onArrive={arrived} onPlay={() => onPlay(new URL(item.url, location.href).href)} />
                  ))}
                </div>
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
    </section>
  );
}

/** Pictures this small stay cheap to draw, and a missing one still gets a tile with a colour of its own. */
function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function Tile({ item, row, col, onArrive, onPlay }: { item: LibraryItem; row: number; col: number; onArrive: (tile: HTMLElement, row: number, col: number) => void; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(item.id);
  return (
    <button
      className="tv-tile"
      data-testid="tv-browse-tile"
      data-row={row}
      data-col={col}
      onClick={onPlay}
      onFocus={(event) => onArrive(event.currentTarget, row, col)}
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
