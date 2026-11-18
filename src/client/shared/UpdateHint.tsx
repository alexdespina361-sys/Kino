import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { roleOfThisPage, thisIsDesk, thisIsHandHeld } from "../role";
import { actionForKey } from "../tv/keys";
import { offered, putOff, useUpdate } from "./update";
import "./updateHint.css";

export const QUIET_MS = 60_000;
export const ARM_MS = 1_000;
const LOOK_MS = 2_000;

export const filmOnScreen = (doc: Document = document): boolean => [...doc.querySelectorAll("video")].some((video) => video.getClientRects().length > 0);

export const busyHere = (doc: Document = document): boolean => {
  const on = doc.activeElement;
  if (on instanceof HTMLElement && (on.isContentEditable || on.tagName === "TEXTAREA" || (on.tagName === "INPUT" && !["button", "checkbox", "radio", "range", "submit"].includes((on as HTMLInputElement).type)))) return true;
  return doc.querySelector("[aria-modal='true']:not([data-testid='update-hint'])") !== null;
};

const keys: { last: number; answer: ((event: KeyboardEvent) => void) | null } = { last: Date.now(), answer: null };
let installed = false;
export function installUpdateKeys(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "keydown",
    (event) => {
      keys.last = Date.now();
      keys.answer?.(event);
    },
    true,
  );
  window.addEventListener("input", () => void (keys.last = Date.now()), true);
}

export function UpdateHint() {
  const t = useT();
  const update = useUpdate();
  const wanted = offered(update);
  const [remoteOnly] = useState(() => roleOfThisPage() === "tv" && !thisIsHandHeld() && !thisIsDesk());
  const [showing, setShowing] = useState(false);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => installUpdateKeys(), []);

  useEffect(() => {
    if (!wanted) {
      setShowing(false);
      return;
    }
    const look = () => {
      if (filmOnScreen()) setShowing(false);
      else if (!remoteOnly) setShowing(true);
      else setShowing((up) => (up ? !busyHere() : Date.now() - keys.last >= QUIET_MS && !busyHere()));
    };
    look();
    const timer = window.setInterval(look, LOOK_MS);
    return () => window.clearInterval(timer);
  }, [wanted, remoteOnly]);

  const reload = () => window.location.reload();
  const later = () => {
    setShowing(false);
    putOff();
  };
  const answers = useRef({ reload, later });
  answers.current = { reload, later };
  const chosen = useRef<"later" | "reload">("later");

  useEffect(() => {
    if (!showing || !remoteOnly) return;
    const before = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    let armedAt: number | null = null;
    chosen.current = "later";
    laterRef.current?.focus({ preventScroll: true });
    keys.answer = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = actionForKey(event);
      if (action === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const now = performance.now();
      const first = armedAt === null;
      if (armedAt === null) armedAt = now + ARM_MS;
      if (action === "left" || action === "right") {
        const next = action === "left" ? "reload" : "later";
        chosen.current = next;
        (next === "later" ? laterRef : reloadRef).current?.focus({ preventScroll: true });
      } else if (action === "select") {
        if (first || now < armedAt) return;
        (chosen.current === "reload" ? answers.current.reload : answers.current.later)();
      } else if (action === "back") answers.current.later();
    };
    return () => {
      keys.answer = null;
      const on = document.activeElement;
      if (on !== null && on !== document.body && on.isConnected) return;
      if (before?.isConnected) before.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-autofocus]:not(:disabled), [data-nav]:not(:disabled)")?.focus({ preventScroll: true });
    };
  }, [showing, remoteOnly]);

  if (!showing) return null;
  return (
    <div className={remoteOnly ? "update-hint on-tv" : "update-hint"} role={remoteOnly ? "alertdialog" : "status"} aria-labelledby="update-hint-words" data-testid="update-hint">
      <p id="update-hint-words">{t("update.ready")}</p>
      <button type="button" ref={reloadRef} className="update-reload" data-testid="update-reload" onClick={reload}>
        {t("update.reload")}
      </button>
      {remoteOnly ? (
        <button type="button" ref={laterRef} className="update-later" data-testid="update-later" onClick={later}>
          {t("update.later")}
        </button>
      ) : (
        <button type="button" ref={laterRef} className="update-close" data-testid="update-later" aria-label={t("update.later")} title={t("update.later")} onClick={later}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
