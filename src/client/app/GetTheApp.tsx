import { useEffect, useState, type MouseEvent } from "react";
import { useT } from "../i18n";
import { isTvAgent, thisIsHandHeld } from "../role";
import { readStorage, writeStorage } from "../shared/format";
import { busyHere, filmOnScreen } from "../shared/UpdateHint";
import { inKinoApp } from "./kinoApp";
import "./getTheApp.css";

export interface AppRelease {
  versionName: string;
  size: number;
}

export const wantsTheApp = (input: { userAgent: string; handHeld: boolean; inApp: boolean }): boolean =>
  input.handHeld &&
  !input.inApp &&
  /\bAndroid\b/i.test(input.userAgent) &&
  !/\bKinoApp\//.test(input.userAgent) &&
  !/;\s*wv\)/.test(input.userAgent) &&
  !isTvAgent(input.userAgent);

const thisWantsTheApp = (): boolean => wantsTheApp({ userAgent: navigator.userAgent, handHeld: thisIsHandHeld(), inApp: inKinoApp() });

let asked: Promise<AppRelease | null> | null = null;
let known: AppRelease | null = null;
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

export function askEarly(): void {
  if (thisWantsTheApp()) void loadRelease();
}

export const forgetRelease = () => {
  asked = null;
  known = null;
};

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

export const megabytes = (size: number): string => `${Math.max(1, Math.round(size / 1_000_000))} MB`;

export const APK = "/app/kino.apk";

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

export const STRIP_KEY = "kino.appStrip";
export const STRIP_QUIET_MS = 2_000;
export const STRIP_GRACE_MS = 500;
const STRIP_AWAY = "kino:app-strip-away";
function putStripAway() {
  writeStorage(STRIP_KEY, "away");
  window.dispatchEvent(new Event(STRIP_AWAY));
}

export const HELD_MAX_MS = 10_000;

export const mayComeIn = (input: { now: number; firstDrawing: boolean; lastTouched: number; drawnAt: number; heldSince: number; busy: boolean }): boolean => {
  if (input.busy || (input.heldSince !== 0 && input.now - input.heldSince < HELD_MAX_MS)) return false;
  if (input.firstDrawing && input.lastTouched === 0) return true;
  return input.now - Math.max(input.lastTouched, input.drawnAt) >= STRIP_QUIET_MS;
};

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
  document.addEventListener("scroll", touched, quietly);
}

const busy = (): boolean => filmOnScreen() || busyHere() || document.querySelector("[data-testid='update-hint']") !== null;

let cameIn: number | null = null;
let drawnAt = 0;

const SIDEWAYS = "(max-height: 499px) and (orientation: landscape)";
const sideways = (): boolean => typeof matchMedia === "function" && matchMedia(SIDEWAYS).matches;

export const forgetStrip = () => {
  cameIn = null;
  drawnAt = 0;
  hands.lastTouched = 0;
  hands.heldSince = 0;
};

export function GetTheAppStrip({ className = "" }: { className?: string }) {
  const t = useT();
  const release = useAppRelease();
  const [away, setAway] = useState(() => readStorage(STRIP_KEY) === "away");
  const [inAt, setInAt] = useState<number | null>(cameIn);
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
