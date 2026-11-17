import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { roleOfThisPage, thisIsDesk, thisIsHandHeld } from "../role";
import { actionForKey } from "../tv/keys";
import { offered, putOff, useUpdate } from "./update";
import "./updateHint.css";

/** How long a TV's remote has been put down before the question is asked on it (it takes the remote's keys while it is up). */
export const QUIET_MS = 60_000;
const LOOK_MS = 2_000;

/** Whether a film is on the screen (its picture is there, playing or held): a new Kino is offered only once it has been put away. */
export const filmOnScreen = (doc: Document = document): boolean => [...doc.querySelectorAll("video")].some((video) => video.getClientRects().length > 0);

/**
 * "A new Kino is out" with Reload and Later, once the site serves a build that is not this page's (see update.ts), and never over a film.
 * - A screen that is touched or clicked (a phone, a computer, a hand-held screen showing the TV's pages) has it at the top, to press or to put away (×).
 * - A TV that is only a remote is asked once the remote has been put down for a minute: the question then has the remote's keys (Left and Right
 *   between its two buttons, OK, Back for Later), and gives the focus back to where it was.
 * Later is for this build: the next one is offered again. Reloading loses nothing that is kept (a profile, the lists, what was watched where).
 */
export function UpdateHint() {
  const t = useT();
  const update = useUpdate();
  const wanted = offered(update);
  const [remoteOnly] = useState(() => roleOfThisPage() === "tv" && !thisIsHandHeld() && !thisIsDesk());
  const [showing, setShowing] = useState(false);
  const lastKey = useRef(Date.now());
  const reloadRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);

  // (A TV's remote: when it was last pressed.)
  useEffect(() => {
    if (!remoteOnly) return;
    const pressed = () => void (lastKey.current = Date.now());
    window.addEventListener("keydown", pressed, true);
    return () => window.removeEventListener("keydown", pressed, true);
  }, [remoteOnly]);

  useEffect(() => {
    if (!wanted) {
      setShowing(false);
      return;
    }
    const look = () => {
      if (filmOnScreen()) setShowing(false);
      else if (!remoteOnly) setShowing(true);
      else setShowing((up) => up || Date.now() - lastKey.current >= QUIET_MS); // (once up, it stays up until it is answered: the keys that answer it are presses too)
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

  useEffect(() => {
    if (!showing || !remoteOnly) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reloadRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = actionForKey(event);
      if (action === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "left" || action === "right") (document.activeElement === reloadRef.current ? laterRef : reloadRef).current?.focus();
      else if (action === "select") (document.activeElement === laterRef.current ? answers.current.later : answers.current.reload)();
      else if (action === "back") answers.current.later();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (before?.isConnected) before.focus();
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
