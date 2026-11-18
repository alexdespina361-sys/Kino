import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronIcon, ChevronLeftIcon } from "../shared/icons";

const STEP = 0.8;
const NEAR_END = 1.5;
const WAITING_TILES = 3;

export function RowTiles({ children, onNearEnd, loading }: { children: ReactNode; onNearEnd?: () => void; loading?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  const wantsMore = useRef(onNearEnd);
  wantsMore.current = onNearEnd;
  const onScreen = useRef(typeof IntersectionObserver === "undefined");

  const measure = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    const before = row.scrollLeft > 2;
    const after = row.scrollLeft < row.scrollWidth - row.clientWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
    if (onScreen.current && row.clientWidth > 0 && row.scrollWidth - row.clientWidth - row.scrollLeft <= row.clientWidth * NEAR_END) wantsMore.current?.();
  }, []);

  useEffect(measure);
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [measure]);
  useEffect(() => {
    const row = scroller.current;
    if (!row || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((seen) => {
      onScreen.current = seen.some((one) => one.isIntersecting);
      if (onScreen.current) measure();
    });
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
