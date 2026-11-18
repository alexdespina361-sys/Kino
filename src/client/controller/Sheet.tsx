import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { t, useT } from "../i18n";
import { CloseIcon } from "../shared/icons";
import { useBackToClose } from "../shared/backButton";

const open: object[] = [];

export const sheetIsOpen = () => open.length > 0;

const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.6;
const SLOP = 6;

function scrollerAt(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== sheet.parentElement; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

function usePullToClose(backdrop: RefObject<HTMLDivElement | null>, sheet: RefObject<HTMLDivElement | null>, close: RefObject<() => void>) {
  useEffect(() => {
    const shade = backdrop.current;
    const panel = sheet.current;
    if (!shade || !panel) return;
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
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return void (touch = null);
      if (getComputedStyle(panel).getPropertyValue("--sheet-side").trim() === "1") return void (touch = null);
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
        if (!touch.free) return;
        if (Math.abs(finger.clientX - touch.x) > Math.abs(down) && Math.abs(finger.clientX - touch.x) > SLOP) return void (touch = null);
        if (down < -SLOP) return void (touch.free = false);
        if (down < SLOP) return;
        touch.pulling = true;
      }
      event.preventDefault();
      follow(down - SLOP);
    };
    const onEnd = (event: TouchEvent) => {
      if (!touch?.pulling) return void (touch = null);
      const speed = event.timeStamp - touch.last.at > 100 ? 0 : touch.speed;
      touch = null;
      settle(event.type === "touchend" && (offset > Math.min(CLOSE_DISTANCE, panel.offsetHeight / 3) || speed > CLOSE_SPEED));
    };

    shade.addEventListener("touchstart", onStart, { passive: true });
    shade.addEventListener("touchmove", onMove, { passive: false });
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function keepFocusIn(panel: HTMLElement, event: KeyboardEvent) {
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return void event.preventDefault();
  const at = document.activeElement;
  if (!panel.contains(at) || (event.shiftKey ? at === first || at === panel : at === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

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
    document.documentElement.classList.add("sheet-open");
    const opener = document.activeElement;
    if (panel.current && !panel.current.contains(opener)) panel.current.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== me) return;
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === "Tab" && panel.current) keepFocusIn(panel.current, event);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      open.splice(open.indexOf(me), 1);
      if (open.length === 0) document.documentElement.classList.remove("sheet-open");
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  usePullToClose(backdrop, panel, close);
  useBackToClose(onClose);

  return (
    <div className="sheet-backdrop" ref={backdrop} onClick={onClose}>
      <div
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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

export function ChoiceList({ choices, label }: { choices: Choice[]; label: string }) {
  return (
    <div className="choices" role="listbox" aria-label={label}>
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
