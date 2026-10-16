import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronIcon, ChevronLeftIcon } from "../shared/icons";

/** How far one press of an arrow moves a row, of the width the row shows. */
const STEP = 0.8;

/**
 * A row of titles with an arrow at each end that a mouse can press: a wheel scrolls the page, not a row, so a row that runs off the screen
 * has no other way for a pointer to reach what lies past its edge. An arrow shows only on the side that has more, and only while the pointer
 * is over the row (the stylesheet). The remote and the keyboard walk the titles themselves, and the row slides to keep the one they are on
 * in view; they never land on an arrow, and pressing one does not take the focus from the title they are on.
 */
export function RowTiles({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
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
      </div>
      {more.before && arrow("before")}
      {more.after && arrow("after")}
    </div>
  );
}
