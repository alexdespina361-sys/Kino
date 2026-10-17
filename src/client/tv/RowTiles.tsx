import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronIcon, ChevronLeftIcon } from "../shared/icons";

/** How far one press of an arrow moves a row, of the width the row shows. */
const STEP = 0.8;
/** A row that can have more titles asks for them when it is scrolled to within this many widths of its end. */
const NEAR_END = 1.5;
/** ...and shows this many empty tiles at its end while they are on their way. */
const WAITING_TILES = 3;

/**
 * A row of titles with an arrow at each end that a mouse can press: a wheel scrolls the page, not a row, so a row that runs off the screen
 * has no other way for a pointer to reach what lies past its edge. An arrow shows only on the side that has more, and only while the pointer
 * is over the row (the stylesheet). The remote and the keyboard walk the titles themselves, and the row slides to keep the one they are on
 * in view; they never land on an arrow, and pressing one does not take the focus from the title they are on.
 *
 * A row the library can add titles to (`onNearEnd`) asks for them as its end comes near, whoever scrolled it: a finger, a wheel, an arrow or the
 * remote's focus. It asks again after each answer while the end is still near (so a row that does not fill the screen fills it), and shows empty tiles
 * at its end while `loading`.
 */
export function RowTiles({ children, onNearEnd, loading }: { children: ReactNode; onNearEnd?: () => void; loading?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  const wantsMore = useRef(onNearEnd);
  wantsMore.current = onNearEnd;

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
    if (row.clientWidth > 0 && row.scrollWidth - row.clientWidth - row.scrollLeft <= row.clientWidth * NEAR_END) wantsMore.current?.();
  }, []);

  // (The titles of a row come and go as the library fills in or a list changes, and the window changes size: look again each time.)
  useEffect(measure);
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [measure]);

  const go = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * STEP, behavior: "smooth" });
  const arrow = (side: "before" | "after") => (
    <button
      type="button"
      className="tv-row-more"
      data-side={side}
      data-testid={side === "before" ? "tv-row-back" : "tv-row-next"}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => go(side === "before" ? -1 : 1)}
    >
      {side === "before" ? <ChevronLeftIcon /> : <ChevronIcon />}
    </button>
  );
  return (
    <div className="tv-row-box">
      <div className="tv-row-tiles" ref={scroller} onScroll={measure}>
        {children}
        {loading && Array.from({ length: WAITING_TILES }, (_, at) => <div className="tv-tile tv-skeleton" data-testid="tv-row-waiting" aria-hidden="true" key={`waiting-${at}`} />)}
      </div>
      {more.before && arrow("before")}
      {more.after && arrow("after")}
    </div>
  );
}
