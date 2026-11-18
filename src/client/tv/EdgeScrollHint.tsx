import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronIcon } from "../shared/icons";
import { DWELL_MS, EdgeScroll, type Edge, type EdgeHint, type EdgeWorld, type Page } from "./edgeScroll";

const NOT_A_PAGE = "textarea, input, select, video";
const WORTH_SCROLLING = 12;
const RAIL = ".tv-rail";
const PRESSABLE = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [tabindex]:not([tabindex='-1'])";

function onAFixedControl(target: Element): boolean {
  const control = target.closest(PRESSABLE);
  return control !== null && scrollerFrom(control) === null;
}

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
      const busy = () => event.buttons !== 0 || (event.target instanceof Element && (event.target.closest(RAIL) !== null || onAFixedControl(event.target)));
      if (machine.move({ x: event.clientX, y: event.clientY, height: window.innerHeight, mouse: event.pointerType === "mouse", busy })) run();
    };
    const onOther = () => {
      machine.other();
      run();
    };
    const onStand = () => {
      machine.stand();
      run();
    };
    const onHidden = () => {
      if (document.hidden) onStand();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onOther, { capture: true, passive: true });
    window.addEventListener("keydown", onOther, { passive: true });
    window.addEventListener("wheel", onOther, { passive: true });
    window.addEventListener("blur", onStand);
    document.addEventListener("visibilitychange", onHidden);
    document.documentElement.addEventListener("pointerleave", onStand);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onOther, { capture: true });
      window.removeEventListener("keydown", onOther);
      window.removeEventListener("wheel", onOther);
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
