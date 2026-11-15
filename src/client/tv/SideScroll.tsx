import { useCallback, useEffect, useRef, useState, type FocusEventHandler, type ReactNode } from "react";
import { ChevronIcon, ChevronLeftIcon } from "../shared/icons";

/** How far one press of an arrow moves the row, of the width the row shows. */
const STEP = 0.8;

/**
 * A sideways row of choices (a show's seasons) with an arrow at each end for a mouse: a wheel scrolls the page, not the row, so a row
 * wider than the screen had no other way for a pointer to reach what lies past its edge. An arrow shows only on the side that has more,
 * and only for a mouse (the stylesheet); a finger swipes the row, and the remote and the keyboard walk the choices, which slide into view.
 * The arrows are never focused, and pressing one does not take the focus from the choice the remote is on.
 */
export function SideScroll({ children, label, onFocus, testId }: { children: ReactNode; label: string; onFocus?: FocusEventHandler<HTMLDivElement>; testId: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
  }, []);

  // (The choices change with the title, and the window changes size: look again each time.)
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
      className="tv-filters-more"
      data-side={side}
      data-testid={`${testId}-${side === "before" ? "back" : "next"}`}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => go(side === "before" ? -1 : 1)}
    >
      {side === "before" ? <ChevronLeftIcon /> : <ChevronIcon />}
    </button>
  );
  return (
    <div className="tv-filters-box" data-more-before={more.before || undefined} data-more-after={more.after || undefined}>
      <div className="tv-filters" ref={scroller} role="radiogroup" aria-label={label} data-testid={testId} onScroll={measure} onFocus={onFocus}>
        {children}
      </div>
      {more.before && arrow("before")}
      {more.after && arrow("after")}
    </div>
  );
}
