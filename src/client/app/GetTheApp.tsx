import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { isTvAgent, thisIsHandHeld } from "../role";
import { readStorage, writeStorage } from "../shared/format";
import { busyHere, filmOnScreen } from "../shared/UpdateHint";
import { inKinoApp } from "./kinoApp";
import "./getTheApp.css";

/**
 * The Android app, offered on a phone's browser (the owner, 17 Nov: "in profile, show a download the app banner (or website wide) for phone screen"): a card
 * on the profile's page (`GetTheApp`), and once on the whole site a line at the top that says there is one (`GetTheAppStrip`), until it is put away. Only on
 * Android, in its browser and not in the app, and never on a TV (an Android TV says "Android" too); nothing at all while the site keeps no app
 * (server/push/appRelease.ts: `/api/app/android` is then a 404). The APK is `/app/kino.apk`, which always leads to the newest.
 */

/** What the site says of the newest Android app (`GET /api/app/android`): enough to say which and how big it is. */
export interface AppRelease {
  versionName: string;
  size: number;
}

/** Whether the app is for this screen: a phone or a tablet with Android, in its browser and not in the app, and no TV. */
export const wantsTheApp = (input: { userAgent: string; handHeld: boolean; inApp: boolean }): boolean =>
  input.handHeld && !input.inApp && /\bAndroid\b/i.test(input.userAgent) && !isTvAgent(input.userAgent);

const thisWantsTheApp = (): boolean => wantsTheApp({ userAgent: navigator.userAgent, handHeld: thisIsHandHeld(), inApp: inKinoApp() });

let asked: Promise<AppRelease | null> | null = null;
/** The newest release, asked for once a page (null: the site keeps no app, or it could not be asked: then it is asked again by the next that wants it). */
export function loadRelease(fetcher: typeof fetch = fetch): Promise<AppRelease | null> {
  asked ??= fetcher("/api/app/android", { cache: "no-store", credentials: "omit" })
    .then(async (answer) => {
      if (!answer.ok) return null;
      const body = (await answer.json()) as Partial<AppRelease> | null;
      const versionName = typeof body?.versionName === "string" ? body.versionName.trim().slice(0, 32) : "";
      const size = typeof body?.size === "number" && Number.isFinite(body.size) && body.size > 0 ? body.size : 0;
      return versionName && size ? { versionName, size } : null;
    })
    .catch(() => {
      asked = null;
      return null;
    });
  return asked;
}

/** (For the tests: the next `loadRelease` asks again.) */
export const forgetRelease = () => {
  asked = null;
};

/** The release, on a screen the app is for; null elsewhere, and while it is being asked for. */
export function useAppRelease(): AppRelease | null {
  const [release, setRelease] = useState<AppRelease | null>(null);
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
 * whether the browser may install apps: the card says so, so that the question is no surprise.
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
/** The line waits this long after the page opens: it is not the first thing over a page that is still being drawn. */
export const STRIP_WAIT_MS = 4_000;
const STRIP_AWAY = "kino:app-strip-away";
/** The line is put away for good on this screen, and goes now if it is up (the app was got from the card). */
function putStripAway() {
  writeStorage(STRIP_KEY, "away");
  window.dispatchEvent(new Event(STRIP_AWAY));
}

/** Whether something is on the screen that the line must not cover: a film, something being typed, a window, or "A new Kino is out". */
const busy = (): boolean => filmOnScreen() || busyHere() || document.querySelector("[data-testid='update-hint']") !== null;

/**
 * The site's line: "Kino has an Android app", Download and ×, at the top of a phone's screen (a few seconds after the page opens, and only while no film, no
 * window and no typing is on the screen: it steps aside for them, and comes back after). Either answer puts it away for good on this screen; a page left
 * without an answer shows it again the next time.
 */
export function GetTheAppStrip() {
  const t = useT();
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [aside, setAside] = useState(true);
  const [away, setAway] = useState(() => readStorage(STRIP_KEY) === "away");
  useEffect(() => {
    if (away || !thisWantsTheApp()) return;
    let live = true;
    void loadRelease().then((answer) => {
      if (live) setRelease(answer);
    });
    const look = () => setAside(performance.now() < STRIP_WAIT_MS || busy());
    const timer = window.setInterval(look, 1_000);
    const gone = () => setAway(true);
    window.addEventListener(STRIP_AWAY, gone);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(STRIP_AWAY, gone);
    };
  }, [away]);
  if (away || !release || aside) return null;
  const putAway = putStripAway;
  return (
    <div className="get-app-strip" role="status" data-testid="get-app-strip">
      <img className="get-app-strip-icon" src="/icon-192.png" alt="" width={28} height={28} decoding="async" />
      <p>{t("app.get.strip", { size: megabytes(release.size) })}</p>
      <a className="get-app-strip-get" href={APK} download="kino.apk" onClick={putAway} data-testid="get-app-strip-download">
        {t("app.get.stripButton")}
      </a>
      <button type="button" className="get-app-strip-close" onClick={putAway} aria-label={t("app.get.stripClose")} title={t("app.get.stripClose")} data-testid="get-app-strip-close">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
