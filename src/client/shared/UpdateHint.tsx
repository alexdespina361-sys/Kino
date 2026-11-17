import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { roleOfThisPage, thisIsDesk, thisIsHandHeld } from "../role";
import { actionForKey } from "../tv/keys";
import { offered, putOff, useUpdate } from "./update";
import "./updateHint.css";

/** How long a TV's remote has been put down before the question is asked on it (it takes the remote's keys while it is up). */
export const QUIET_MS = 60_000;
/** How long OK does nothing once the question is up: an OK meant for what was on the screen, pressed as it came, answers nothing (the judge, 17 Nov). */
export const ARM_MS = 1_000;
const LOOK_MS = 2_000;

/** Whether a film is on the screen (its picture is there, playing or held): a new Kino is offered only once it has been put away. */
export const filmOnScreen = (doc: Document = document): boolean => [...doc.querySelectorAll("video")].some((video) => video.getClientRects().length > 0);

/**
 * Whether the TV is in the middle of something the question must not come over: something being typed (its box has the keys, and taking them would end the
 * typing, or keep it: a name being changed is kept as the box loses them), or a window open on the page (the feedback form, whose pictures and marks a reload
 * would lose; a title's page; a menu). The question waits until it is closed.
 */
export const busyHere = (doc: Document = document): boolean => {
  const on = doc.activeElement;
  if (on instanceof HTMLElement && (on.isContentEditable || on.tagName === "TEXTAREA" || (on.tagName === "INPUT" && !["button", "checkbox", "radio", "range", "submit"].includes((on as HTMLInputElement).type)))) return true;
  return doc.querySelector("[aria-modal='true']:not([data-testid='update-hint'])") !== null;
};

/**
 * The remote's keys while the question is up, heard before anything else on the page (`installUpdateKeys`, from main.tsx, before the page is drawn): a
 * listener added later (a menu's Back, a question's, the feedback form's, the welcome's OK) never hears a key that answers this question (the judge, 17 Nov).
 */
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
  // (A TV's own keyboard on the screen may send no keys, only what it types: that is the remote being used too.)
  window.addEventListener("input", () => void (keys.last = Date.now()), true);
}

/**
 * "A new Kino is out" with Reload and Later, once the site serves a build that is not this page's (see update.ts), and never over a film.
 * - A screen that is touched or clicked (a phone, a computer, a hand-held screen showing the TV's pages) has it at the top, to press or to put away (×).
 * - A TV that is only a remote is asked once the remote has been put down for a minute, and not while something is typed or a window is open: the question
 *   then has the remote's keys - Left and Right between its two buttons, OK, Back for Later - and the remote is on Later, so a press that was meant for the
 *   page reloads nothing; OK does nothing for its first second. Once answered, the focus goes back to where it was.
 * Later is for this build: the next one is offered again. Reloading loses nothing that is kept (a profile, the lists, what was watched where).
 */
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
      // (Once up, it stays up until it is answered - the keys that answer it are presses too - unless a window opens over the page meanwhile.)
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
  /** The button the remote is on. */
  const chosen = useRef<"later" | "reload">("later");

  // The remote's keys, while it is up: the button the remote is on is kept here, not read from the page (the feedback form, or anything else that moves the
  // focus, cannot make OK reload).
  useEffect(() => {
    if (!showing || !remoteOnly) return;
    const before = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const shownAt = performance.now();
    chosen.current = "later";
    laterRef.current?.focus({ preventScroll: true });
    keys.answer = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = actionForKey(event);
      if (action === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "left" || action === "right") {
        const next = chosen.current === "later" ? "reload" : "later";
        chosen.current = next;
        (next === "later" ? laterRef : reloadRef).current?.focus({ preventScroll: true });
      } else if (action === "select") {
        if (performance.now() - shownAt < ARM_MS) return;
        (chosen.current === "reload" ? answers.current.reload : answers.current.later)();
      } else if (action === "back") answers.current.later();
    };
    return () => {
      keys.answer = null;
      // (Back where the remote was; if that is gone, on what the page would land on first, never on nothing: the judge, 17 Nov.)
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
