import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronIcon } from "../shared/icons";
import { DWELL_MS, EdgeScroll, type Edge, type EdgeHint, type EdgeWorld, type Page } from "./edgeScroll";

/**
 * Scrolling the TV's pages with nothing but a pointer: resting it against the top or the bottom edge of the screen for a second scrolls the page
 * that way (the rule is in edgeScroll.ts; this is the page it scrolls, what is shown while it waits, and the events that end it).
 * A key, a press or a touch ends it, a wheel ends it for good, and nothing that is not a mouse starts it.
 */

/** What scrolls by itself and is no page: a text box, a list box, the picture. */
const NOT_A_PAGE = "textarea, input, select, video";
/** A box with less than this to scroll is a row going sideways, or a rounding, not a page. */
const WORTH_SCROLLING = 12;
/** The menu rail opens under a pointer that rests on it, so a pointer there is not waiting for a page. */
const RAIL = ".tv-rail";

/** The nearest box, from `start` outwards, that scrolls up and down. */
function scrollerFrom(start: Element | null): HTMLElement | null {
  for (let el = start; el; el = el.parentElement) {
    if (!(el instanceof HTMLElement) || el.matches(NOT_A_PAGE)) continue;
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && el.scrollHeight - el.clientHeight > WORTH_SCROLLING) return el;
  }
  return null;
}

function pageOf(el: HTMLElement): Page {
  return {
    room: (edge) => el.isConnected && (edge === "bottom" ? el.scrollHeight - el.clientHeight - el.scrollTop > 1 : el.scrollTop > 1),
    shown: () => el.clientHeight,
    by: (pixels) => {
      el.scrollTop += pixels;
    },
  };
}

/**
 * The page a pointer against `edge` at `x` moves: the one under the pointer, or (where the pointer is over something that is no part of the page:
 * the rail, a corner button) the one in the middle of the screen. One that is at its end hands over to the one around it.
 */
const world: EdgeWorld = {
  pageFor(edge: Edge, x: number): Page | null {
    const { innerWidth: w, innerHeight: h } = window;
    const probes: Array<[number, number]> = [[x, h - 3], [w / 2, h - 3], [w / 2, h / 2]];
    for (const [px, py] of probes) {
      for (let el = scrollerFrom(document.elementFromPoint(px, py)); el; el = scrollerFrom(el.parentElement)) {
        const page = pageOf(el);
        if (page.room(edge)) return page;
      }
    }
    return null;
  },
};

export function EdgeScrollHint() {
  const [hint, setHint] = useState<EdgeHint | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pointerX = useRef(0);

  useEffect(() => {
    const machine = new EdgeScroll(world, setHint);
    let timer = 0;
    let frame = 0;
    const run = () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      const next = machine.frame(performance.now());
      if (next === null) return;
      if (next === 0) frame = window.requestAnimationFrame(run);
      else timer = window.setTimeout(run, next);
    };
    const onMove = (event: PointerEvent) => {
      pointerX.current = event.clientX;
      root.current?.style.setProperty("--tv-edge-x", `${event.clientX}px`);
      const busy = () => event.buttons !== 0 || (event.target instanceof Element && event.target.closest(RAIL) !== null);
      if (machine.move({ x: event.clientX, y: event.clientY, height: window.innerHeight, mouse: event.pointerType === "mouse", busy })) run();
    };
    const onOther = () => {
      machine.other();
      run();
    };
    // (A screen that turns a wheel, or a trackpad, can scroll: it is not offered this again.)
    const onWheel = () => {
      machine.retire();
      run();
    };
    const onStand = () => {
      machine.stand();
      run();
    };
    const onHidden = () => {
      if (document.hidden) onStand();
    };
    // (None of them asks for the event: a wheel and a key go on as they would, and nothing here stops a page from scrolling or a click from landing.)
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onOther, { capture: true, passive: true });
    window.addEventListener("keydown", onOther, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("blur", onStand);
    document.addEventListener("visibilitychange", onHidden);
    document.documentElement.addEventListener("pointerleave", onStand);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onOther, { capture: true });
      window.removeEventListener("keydown", onOther);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onStand);
      document.removeEventListener("visibilitychange", onHidden);
      document.documentElement.removeEventListener("pointerleave", onStand);
      machine.stand();
    };
  }, []);

  if (!hint) return null;
  return (
    <div
      className="tv-edge"
      ref={root}
      data-testid="tv-edge-scroll"
      data-edge={hint.edge}
      data-phase={hint.moving ? "moving" : "waiting"}
      style={{ "--tv-edge-x": `${pointerX.current}px`, "--tv-edge-dwell": `${DWELL_MS}ms` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="tv-edge-puck">
        <svg className="tv-edge-ring" viewBox="0 0 36 36">
          <circle className="track" cx="18" cy="18" r="16" />
          <circle className="fill" cx="18" cy="18" r="16" pathLength="100" />
        </svg>
        <ChevronIcon className="tv-edge-chevron" />
      </span>
    </div>
  );
}
