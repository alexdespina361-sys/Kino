import { useEffect } from "react";
import { request } from "../account/api";
import { t } from "../i18n";

/**
 * The Android app (android/, docs/android-app.md) shows this site in a WebView and gives its pages `window.KinoApp`, only on the site's own addresses. Through it a
 * page learns where Firebase reaches the phone (`pushToken`, empty until Firebase has said), and hands the app the words of its notifications in the language the
 * profile uses (`setStrings`). The app says when the token arrives or changes with a `kinoapp:push-token` event on `window`.
 */
interface KinoAppBridge {
  version(): string;
  pushToken(): string;
  setStrings(json: string): void;
}

declare global {
  interface Window {
    KinoApp?: KinoAppBridge;
  }
}

const bridge = (): KinoAppBridge | undefined => (typeof window === "undefined" ? undefined : window.KinoApp);

/** Whether this page is in the Android app. */
export const inKinoApp = (): boolean => bridge() !== undefined;

/** The app's version name, or nothing outside it. */
export function kinoAppVersion(): string | undefined {
  try {
    return bridge()?.version() || undefined;
  } catch {
    return undefined;
  }
}

/** The keys of the words the app's notifications are made of, by the kind the server says (push/push.ts). */
const PUSH_WORDS = {
  chat: "app.push.chat",
  recommend: "app.push.recommend",
  party: "app.push.party",
  together: "app.push.together",
  plan: "app.push.plan",
  planYes: "app.push.planYes",
  planNo: "app.push.planNo",
  channel: "app.push.channel",
  updateReady: "app.update.ready",
  updateInstall: "app.update.install",
} as const;

/** The words, with `{name}` left for the app to fill in with the friend's. */
export const pushWords = (): Record<keyof typeof PUSH_WORDS, string> =>
  Object.fromEntries(Object.entries(PUSH_WORDS).map(([kind, key]) => [kind, t(key, { name: "{name}" })])) as Record<keyof typeof PUSH_WORDS, string>;

/** What this page last told the server (a token and a profile): told again only when one of them changes, or after signing in again. */
let told = "";

/**
 * In the app: the server is told which profile this phone is on (`PUT /api/push`, kept with this sign-in: signing out forgets it), whenever the profile or the
 * token changes; and the app is given the words of its notifications whenever the language does. Outside the app, nothing.
 */
export function useKinoAppNotifications(profileId: string | null, language: string): void {
  useEffect(() => {
    const app = bridge();
    if (!app) return;
    try {
      app.setStrings(JSON.stringify(pushWords()));
    } catch {
      // (an app that cannot take them keeps its own English ones)
    }
  }, [language]);

  useEffect(() => {
    if (!bridge()) return;
    if (!profileId) {
      told = "";
      return;
    }
    let stopped = false;
    const tell = () => {
      let token = "";
      try {
        token = bridge()?.pushToken() ?? "";
      } catch {
        return;
      }
      const said = `${token}|${profileId}`;
      if (stopped || !token || told === said) return;
      told = said;
      request("PUT", "/api/push", { token, profileId }).catch(() => {
        if (told === said) told = ""; // (tried again at the next change, or the next page)
      });
    };
    tell();
    window.addEventListener("kinoapp:push-token", tell);
    return () => {
      stopped = true;
      window.removeEventListener("kinoapp:push-token", tell);
    };
  }, [profileId]);
}
