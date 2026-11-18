import { useCallback, useEffect, useRef, useState, type FocusEventHandler, type ReactNode } from "react";
import { ChevronIcon, ChevronLeftIcon } from "../shared/icons";

const STEP = 0.8;

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
