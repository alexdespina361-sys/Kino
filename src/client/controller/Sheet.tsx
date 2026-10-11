import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { t, useT } from "../i18n";
import { CloseIcon } from "../shared/icons";

/** The sheets that are open, the one on top last: Escape closes that one, not all of them. */
const open: object[] = [];

/** How far a sheet has to be pulled down, or how fast (pixels per millisecond), for the let-go to close it. */
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.6;
/** How far a finger has to travel before it is a pull (or a scroll) and not a tap. */
const SLOP = 6;

/** The list in the sheet that scrolls under this finger, if there is one. */
function scrollerAt(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== sheet.parentElement; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * Pulling a sheet down closes it, the way a bottom sheet does on a phone: the sheet follows the finger and, let go past a short
 * distance (or with a flick), goes; let go sooner, it springs back. A pull that starts on a list that is scrolled down is the
 * list's own scrolling. Without this a pull down over the sheet is the browser's pull to refresh, which reloads the whole page.
 */
function usePullToClose(backdrop: RefObject<HTMLDivElement | null>, sheet: RefObject<HTMLDivElement | null>, close: RefObject<() => void>) {
  useEffect(() => {
    const shade = backdrop.current;
    const panel = sheet.current;
    if (!shade || !panel) return;
    /** `free`: the finger may pull (it is not on a list that is part way down). `last`: where it was and when, for how fast it is going at the end. */
    let touch: { y: number; x: number; free: boolean; pulling: boolean; last: { y: number; at: number }; speed: number } | null = null;
    let offset = 0;

    const follow = (distance: number) => {
      offset = Math.max(0, distance);
      panel.style.animation = "none";
      panel.style.transition = "none";
      panel.style.transform = `translateY(${offset}px)`;
      shade.style.background = `rgba(0, 0, 0, ${0.62 * (1 - Math.min(1, offset / panel.offsetHeight))})`;
    };
    const settle = (away: boolean) => {
      panel.style.transition = away ? "transform 0.18s ease-in" : "transform 0.2s ease-out";
      panel.style.transform = away ? "translateY(100%)" : "";
      shade.style.transition = "background 0.18s ease";
      shade.style.background = away ? "rgba(0, 0, 0, 0)" : "";
      if (away) window.setTimeout(() => close.current?.(), 170);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return void (touch = null);
      // A finger on a field is the field's (moving the caret, selecting what was typed), not a pull on the sheet.
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return void (touch = null);
      const finger = event.touches[0]!;
      const list = scrollerAt(event.target, panel);
      touch = { y: finger.clientY, x: finger.clientX, free: !list || list.scrollTop <= 0, pulling: false, last: { y: finger.clientY, at: event.timeStamp }, speed: 0 };
      panel.style.transition = "none";
    };
    const onMove = (event: TouchEvent) => {
      if (!touch) return;
      const finger = event.touches[0]!;
      const down = finger.clientY - touch.y;
      if (event.timeStamp - touch.last.at >= 8) {
        touch.speed = (finger.clientY - touch.last.y) / (event.timeStamp - touch.last.at);
        touch.last = { y: finger.clientY, at: event.timeStamp };
      }
      if (!touch.pulling) {
        if (!touch.free) return; // a list that is part way down: the finger scrolls it
        if (Math.abs(finger.clientX - touch.x) > Math.abs(down) && Math.abs(finger.clientX - touch.x) > SLOP) return void (touch = null); // sideways is not a pull
        if (down < -SLOP) return void (touch.free = false); // up scrolls the list (if there is one)
        if (down < SLOP) return;
        touch.pulling = true;
      }
      event.preventDefault(); // (the page under the sheet must not scroll or refresh)
      follow(down - SLOP);
    };
    const onEnd = (event: TouchEvent) => {
      if (!touch?.pulling) return void (touch = null);
      // How fast it was going as it was let go (a finger that rested before it left was going nowhere).
      const speed = event.timeStamp - touch.last.at > 100 ? 0 : touch.speed;
      touch = null;
      // (A touch the browser took over was not let go by the finger: back it goes.)
      settle(event.type === "touchend" && (offset > Math.min(CLOSE_DISTANCE, panel.offsetHeight / 3) || speed > CLOSE_SPEED));
    };

    shade.addEventListener("touchstart", onStart, { passive: true });
    shade.addEventListener("touchmove", onMove, { passive: false }); // not passive: a pull has to stop the page's own scrolling
    shade.addEventListener("touchend", onEnd);
    shade.addEventListener("touchcancel", onEnd);
    return () => {
      shade.removeEventListener("touchstart", onStart);
      shade.removeEventListener("touchmove", onMove);
      shade.removeEventListener("touchend", onEnd);
      shade.removeEventListener("touchcancel", onEnd);
    };
  }, [backdrop, sheet, close]);
}

/** A bottom sheet: the phone's way of showing a short list of choices without leaving the remote. */
export function Sheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  useT();
  const close = useRef(onClose);
  close.current = onClose;
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const me = {};
    open.push(me);
    document.documentElement.classList.add("sheet-open"); // (no pull to refresh behind a sheet, see controller.css)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && open[open.length - 1] === me && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      open.splice(open.indexOf(me), 1);
      if (open.length === 0) document.documentElement.classList.remove("sheet-open");
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  usePullToClose(backdrop, panel, close);

  return (
    <div className="sheet-backdrop" ref={backdrop} onClick={onClose}>
      <div
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} data-testid="sheet-close">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export interface Choice {
  key: string | number;
  label: string;
  active: boolean;
  testId: string;
  pick: () => void;
}

/** One-of-many list inside a sheet. */
export function ChoiceList({ choices }: { choices: Choice[] }) {
  return (
    <div className="choices" role="listbox">
      {choices.map((choice) => (
        <button
          key={choice.key}
          className={`choice ${choice.active ? "active" : ""}`}
          data-testid={choice.testId}
          role="option"
          aria-selected={choice.active}
          onClick={choice.pick}
        >
          <span>{choice.label}</span>
          <span className="choice-dot" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
