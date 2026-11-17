import { useEffect, useState, type MouseEvent } from "react";
import { useT } from "../i18n";
import { isTvAgent, thisIsHandHeld } from "../role";
import { readStorage, writeStorage } from "../shared/format";
import { busyHere, filmOnScreen } from "../shared/UpdateHint";
import { inKinoApp } from "./kinoApp";
import "./getTheApp.css";

/**
 * The Android app, offered on a phone's browser (the owner, 17 Nov: "in profile, show a download the app banner (or website wide) for phone screen"): a card
 * on the profile's page (`GetTheApp`), and on the other pages a line under the top that says there is one (`GetTheAppStrip`), until it is put away. Only on
 * Android, in its browser and not in the app, nor in another app's window onto the web, and never on a TV (an Android TV says "Android" too); nothing at all
 * while the site keeps no app (server/push/appRelease.ts: `/api/app/android` is then a 404). The APK is `/app/kino.apk`, which always leads to the newest.
 */

/** What the site says of the newest Android app (`GET /api/app/android`): enough to say which and how big it is. */
export interface AppRelease {
  versionName: string;
  size: number;
}

/**
 * Whether the app is for this screen: a phone or a tablet with Android, in its browser. Not in the app (its `KinoApp`, or its user agent's "KinoApp/": the
 * user agent is there before the page's first line, the bridge a moment after), not in a window onto the web that another app opens (Android's WebView says
 * "; wv)": an APK cannot be installed from there), and no TV.
 */
export const wantsTheApp = (input: { userAgent: string; handHeld: boolean; inApp: boolean }): boolean =>
  input.handHeld &&
  !input.inApp &&
  /\bAndroid\b/i.test(input.userAgent) &&
  !/\bKinoApp\//.test(input.userAgent) &&
  !/;\s*wv\)/.test(input.userAgent) &&
  !isTvAgent(input.userAgent);

const thisWantsTheApp = (): boolean => wantsTheApp({ userAgent: navigator.userAgent, handHeld: thisIsHandHeld(), inApp: inKinoApp() });

let asked: Promise<AppRelease | null> | null = null;
/** The answer, once it came: a page drawn after that has it at its first drawing (no frame without the line, then a jump: the judge, 17 Nov). */
let known: AppRelease | null = null;
/** The newest release, asked for once a page (null: the site keeps no app, or it could not be asked: then it is asked again by the next that wants it). */
export function loadRelease(fetcher: typeof fetch = fetch): Promise<AppRelease | null> {
  asked ??= fetcher("/api/app/android", { cache: "no-store", credentials: "omit" })
    .then(async (answer) => {
      if (!answer.ok) return null;
      const body = (await answer.json()) as Partial<AppRelease> | null;
      const versionName = typeof body?.versionName === "string" ? body.versionName.trim().slice(0, 32) : "";
      const size = typeof body?.size === "number" && Number.isFinite(body.size) && body.size > 0 ? body.size : 0;
      known = versionName && size ? { versionName, size } : null;
      return known;
    })
    .catch(() => {
      asked = null;
      return null;
    });
  return asked;
}

/** Asked for as the site starts, on a screen the app is for (main.tsx): so that the page's first drawing has it, most times, and the line comes in with it. */
export function askEarly(): void {
  if (thisWantsTheApp()) void loadRelease();
}

/** (For the tests: the next `loadRelease` asks again.) */
export const forgetRelease = () => {
  asked = null;
  known = null;
};

/** The release, on a screen the app is for; null elsewhere, and while it is being asked for. */
export function useAppRelease(): AppRelease | null {
  const [release, setRelease] = useState<AppRelease | null>(() => known);
  useEffect(() => {
    if (!thisWantsTheApp()) return;
    let live = true;
    void loadRelease().then((found) => {
      if (live) setRelease(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return release;
}

/** The size as people read it: "3 MB" (never "0 MB"), the number and the unit on one line. */
export const megabytes = (size: number): string => `${Math.max(1, Math.round(size / 1_000_000))} MB`;

/** Where the newest APK is. */
export const APK = "/app/kino.apk";

/**
 * "Kino for Android", on the profile's page: what the app is, which version and how big, and the one button that downloads it. The first time, Android asks
 * whether the browser may install apps, and Chrome may warn about the file: the card says so, so that neither is a surprise.
 */
export function GetTheApp({ release, className = "" }: { release: AppRelease; className?: string }) {
  const t = useT();
  return (
    <section className={`get-app ${className}`} aria-labelledby="get-app-title" data-testid="get-app">
      <img className="get-app-icon" src="/icon-192.png" alt="" width={48} height={48} decoding="async" />
      <div className="get-app-words">
        <h2 id="get-app-title">{t("app.get.title")}</h2>
        <p>{t("app.get.why")}</p>
        <p className="get-app-small">{t("app.get.note", { version: release.versionName, size: megabytes(release.size) })}</p>
        <a className="get-app-button" href={APK} download="kino.apk" onClick={putStripAway} data-testid="get-app-download">
          {t("app.get.download")}
        </a>
      </div>
    </section>
  );
}

/** A screen that put the line away (or got the app from it, or from the card) is not shown it again. */
export const STRIP_KEY = "kino.appStrip";
/** A page that was touched, scrolled or typed in shows the line only once it has been left alone this long: it pushes the page down, and must not do it under a finger. */
export const STRIP_QUIET_MS = 2_000;
/** A press on the line in this moment after it came in was meant for what was there before it: it does nothing (the judge, 17 Nov). */
export const STRIP_GRACE_MS = 500;
const STRIP_AWAY = "kino:app-strip-away";
/** The line is put away for good on this screen, and goes now if it is up (the app was got from the card). */
function putStripAway() {
  writeStorage(STRIP_KEY, "away");
  window.dispatchEvent(new Event(STRIP_AWAY));
}

/** A finger or a button down this long is let go of all the same: one whose lifting was never heard (a lost pointerup) does not keep the line out for good. */
export const HELD_MAX_MS = 10_000;

/**
 * Whether the line may come in now. With the page's first drawing, when it is known then and nothing was touched yet; else only once nothing moved on the
 * page for a moment - no touch, scroll or key, and not the page's own drawing (the release came late: the page is on the screen, and a finger may be on its
 * way to it) - with no finger or button down, and nothing up it must not come under.
 */
export const mayComeIn = (input: { now: number; firstDrawing: boolean; lastTouched: number; drawnAt: number; heldSince: number; busy: boolean }): boolean => {
  if (input.busy || (input.heldSince !== 0 && input.now - input.heldSince < HELD_MAX_MS)) return false;
  if (input.firstDrawing && input.lastTouched === 0) return true;
  return input.now - Math.max(input.lastTouched, input.drawnAt) >= STRIP_QUIET_MS;
};

/** When the person last touched, scrolled or typed on this page (0: not yet), and since when a finger or a button is down (0: none). */
const hands = { lastTouched: 0, heldSince: 0, watching: false };
function watchHands() {
  if (hands.watching) return;
  hands.watching = true;
  const touched = () => {
    hands.lastTouched = performance.now();
  };
  const down = () => {
    hands.heldSince = performance.now();
    touched();
  };
  const up = () => {
    hands.heldSince = 0;
    touched();
  };
  const quietly = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", down, quietly);
  window.addEventListener("pointerup", up, quietly);
  window.addEventListener("pointercancel", up, quietly);
  window.addEventListener("keydown", touched, quietly);
  window.addEventListener("wheel", touched, quietly);
  // (A list that scrolls says so to itself only; on its way down, the page's document hears it.)
  document.addEventListener("scroll", touched, quietly);
}

/** Something on the screen the line must not come in under: a film, something being typed, a window, or "A new Kino is out". (Once in, it stays: it is in the page.) */
const busy = (): boolean => filmOnScreen() || busyHere() || document.querySelector("[data-testid='update-hint']") !== null;

/** When the line came in on this page (null: not yet). A page that is left and come back to draws it at once, with the page, never as a second jump. */
let cameIn: number | null = null;
/** When the first line was drawn on this page: the page has been on the screen since. */
let drawnAt = 0;

/** A screen held sideways is not high enough for it: the line is not drawn there (getTheApp.css), and does not come in there either (its moment would pass unseen). */
const SIDEWAYS = "(max-height: 499px) and (orientation: landscape)";
const sideways = (): boolean => typeof matchMedia === "function" && matchMedia(SIDEWAYS).matches;

/** (For the tests.) */
export const forgetStrip = () => {
  cameIn = null;
  drawnAt = 0;
  hands.lastTouched = 0;
  hands.heldSince = 0;
};

/**
 * The line under the top of the page: "Kino has an Android app", Get it and No thanks, in the page, which it pushes down (the judge, 17 Nov: over the top it
 * covered its buttons, and came in under the finger that was going for them). It comes in with the page's first drawing, or once the page has been left alone
 * for a moment, and not while a film, a window or typing is up; a press in the moment after it came does nothing. Either answer puts it away for good on this
 * screen; a page left without an answer shows it again the next time. Put on the pages where the card is not (the profile's has the card).
 */
export function GetTheAppStrip({ className = "" }: { className?: string }) {
  const t = useT();
  const release = useAppRelease();
  const [away, setAway] = useState(() => readStorage(STRIP_KEY) === "away");
  const [inAt, setInAt] = useState<number | null>(cameIn);
  /** Whether the release was known at this line's first drawing (then it may come in with the page, not after it). */
  const [withPage] = useState(() => release !== null && drawnAt === 0);
  useEffect(() => {
    if (away || !thisWantsTheApp()) return;
    watchHands();
    if (drawnAt === 0) drawnAt = performance.now();
    const gone = () => setAway(true);
    window.addEventListener(STRIP_AWAY, gone);
    return () => window.removeEventListener(STRIP_AWAY, gone);
  }, [away]);
  useEffect(() => {
    if (away || !release || inAt !== null) return;
    let first = withPage;
    const look = () => {
      const now = performance.now();
      if (cameIn === null && !sideways() && mayComeIn({ now, firstDrawing: first, lastTouched: hands.lastTouched, drawnAt, heldSince: hands.heldSince, busy: busy() })) cameIn = now;
      first = false;
      if (cameIn !== null) setInAt(cameIn);
    };
    look();
    const timer = window.setInterval(look, 250);
    return () => window.clearInterval(timer);
  }, [away, release, inAt, withPage]);
  if (away || !release || inAt === null) return null;
  const answer = (event: MouseEvent<HTMLElement>) => {
    if (performance.now() - inAt < STRIP_GRACE_MS) {
      event.preventDefault();
      return;
    }
    putStripAway();
  };
  return (
    <aside className={`get-app-strip ${className}`} aria-label={t("app.get.title")} data-testid="get-app-strip">
      <img className="get-app-strip-icon" src="/icon-192.png" alt="" width={32} height={32} decoding="async" />
      {/* (What it is, and how big, in two short lines: one sentence was five lines on a narrow phone.) */}
      <p>
        <b>{t("app.get.title")}</b>
        <span>{t("app.get.stripSize", { size: megabytes(release.size) })}</span>
      </p>
      <a className="get-app-strip-get" href={APK} download="kino.apk" onClick={answer} data-testid="get-app-strip-download">
        {t("app.get.stripButton")}
      </a>
      <button type="button" className="get-app-strip-close" onClick={answer} aria-label={t("app.get.stripClose")} title={t("app.get.stripClose")} data-testid="get-app-strip-close">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
  );
}
