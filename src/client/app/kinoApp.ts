import { useEffect, useSyncExternalStore } from "react";
import { request } from "../account/api";
import { t } from "../i18n";

/**
 * The Android app (android/, docs/android-app.md) shows this site in a WebView and gives its pages `window.KinoApp`, only on the site's own addresses and only to
 * the page itself, never to a frame in it (android/.../Bridge.java). The page and the app talk by messages: the page says `hello` and is told the app's version,
 * the folders of the phone it can open a file chooser in, whether the app's notifications are on, and where Firebase reaches the phone (only while they are on);
 * after that the app says whenever the last two change (`state`).
 *
 * The page asks for the token while somebody is signed in on a profile (`pushToken`: the phone may ask the person whether the app may notify), tells the server
 * which profile the phone is on (`PUT /api/push`), and has the server forget the phone when its notifications are off (`DELETE /api/push`: nothing is sent through
 * Google for a phone that shows nothing). It gives the app the words of its notifications in the profile's language (`setStrings`), and asks for a folder before
 * it opens a file chooser (`pickFrom`: WhatsApp's stickers, made into personal stickers).
 *
 * The app's first version (0.1.0) had `KinoApp` as an object of methods instead: its version, its token and its words are still asked of it that way, and it has no
 * folders. It updates itself to a newer one.
 */

/** The folders of the phone the app can open a file chooser in: WhatsApp's stickers, and its GIFs (kept as short videos). */
export type AppFolder = "whatsapp-stickers" | "whatsapp-gifs";
const FOLDERS: readonly AppFolder[] = ["whatsapp-stickers", "whatsapp-gifs"];

/** What the app said of itself. */
export interface KinoAppState {
  version: string;
  folders: AppFolder[];
  /** The app's notifications are on (the phone may show them). */
  notify: boolean;
  /** Where Firebase reaches the phone, "" until Firebase has said (and while the notifications are off). */
  token: string;
}

/**
 * The app from 0.2.0: messages (androidx.webkit's `addWebMessageListener`). What Android promises of the object is `postMessage` and an `onmessage` the page
 * sets; `addEventListener` is there in the WebViews of today, but not promised (the judge, 17 Nov): it is used where there is one, else `onmessage`.
 */
interface MessageBridge {
  postMessage(message: string): void;
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}
/** The app's 0.1.0: methods. */
interface MethodBridge {
  version(): string;
  pushToken(): string;
  setStrings(json: string): void;
}

declare global {
  interface Window {
    KinoApp?: Partial<MessageBridge & MethodBridge>;
  }
}

const found = (): Window["KinoApp"] => (typeof window === "undefined" ? undefined : window.KinoApp);
const messages = (): MessageBridge | undefined => {
  const app = found();
  return app && typeof app.postMessage === "function" ? (app as MessageBridge) : undefined;
};
const methods = (): MethodBridge | undefined => {
  const app = found();
  return app && !messages() && typeof app.version === "function" ? (app as MethodBridge) : undefined;
};

/** Whether this page is in the Android app. */
export const inKinoApp = (): boolean => found() !== undefined;

/* ------------------------------ what the app said ------------------------------ */

let state: KinoAppState | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());
/** (What is waiting for the app's answer to `pickFrom`.) */
let picking: ((known: boolean) => void) | undefined;

const send = (message: Record<string, unknown>): boolean => {
  const app = messages();
  if (!app) return false;
  try {
    app.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

function heard(data: unknown): void {
  let said: Record<string, unknown>;
  try {
    said = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : {};
  } catch {
    return;
  }
  const notify = said.notify === true;
  const token = typeof said.token === "string" && /^[A-Za-z0-9:_-]{20,4096}$/.test(said.token) ? said.token : "";
  if (said.kind === "hello") {
    const folders = Array.isArray(said.folders) ? FOLDERS.filter((folder) => (said.folders as unknown[]).includes(folder)) : [];
    state = { version: typeof said.version === "string" ? said.version.slice(0, 32) : "", folders, notify, token };
    tell();
  } else if (said.kind === "state" && state) {
    state = { ...state, notify, token };
    tell();
  } else if (said.kind === "picking") {
    picking?.(said.known === true);
    picking = undefined;
  }
}

let started = false;
/** The page says hello to the app (once a page; the app answers in a moment). */
function start(): void {
  if (started) return;
  started = true;
  const app = messages();
  if (app) {
    const listener = (event: { data: unknown }) => heard(event.data);
    try {
      if (typeof app.addEventListener === "function") app.addEventListener("message", listener);
      else app.onmessage = listener;
    } catch {
      app.onmessage = listener;
    }
    send({ call: "hello" });
    return;
  }
  const old = methods();
  if (!old) return;
  try {
    state = { version: String(old.version() || "").slice(0, 32), folders: [], notify: true, token: "" };
  } catch {
    state = null;
  }
}
if (typeof window !== "undefined") start();

/** What the app said of itself (null outside the app, and for a moment as a page opens). */
export function useKinoApp(): KinoAppState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => null,
  );
}

/** Whether the app can open a file chooser in `folder` (a page outside the app, and an app older than 0.2.0, cannot). */
export const opensFolder = (app: KinoAppState | null, folder: AppFolder): boolean => app?.folders.includes(folder) ?? false;

/**
 * The next file chooser opens in `folder`: asked just before the page opens one (a button's press), and answered in a moment; the page opens its chooser then
 * (after a second at most, whatever the answer). False when the app cannot, and the chooser opens where it would have. Android takes the folder as a hint: on a
 * phone without it, the chooser opens where Android chooses.
 */
export function pickFrom(folder: AppFolder): Promise<boolean> {
  if (!opensFolder(state, folder)) return Promise.resolve(false);
  picking?.(false);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (picking === done) picking = undefined;
      resolve(false);
    }, 1000);
    const done = (known: boolean) => {
      window.clearTimeout(timer);
      resolve(known);
    };
    picking = done;
    if (!send({ call: "pickFrom", folder })) done(false);
  });
}

/* ------------------------------ notifications ------------------------------ */

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

/** What this page last told the server: a token and a profile, "off" (it was told to forget the phone), or nothing yet. */
let told = "";
/** The profile whose token the app was asked for on this page. */
let asked = "";

/**
 * In the app: the server is told which profile this phone is on (`PUT /api/push`, kept with this sign-in: signing out forgets it), whenever the profile or the
 * token changes, and to forget the phone while its notifications are off; the app is given the words of its notifications whenever the language changes.
 * Outside the app, nothing.
 */
export function useKinoAppNotifications(profileId: string | null, language: string): void {
  const app = useKinoApp();

  useEffect(() => {
    const json = JSON.stringify(pushWords());
    if (send({ call: "setStrings", json })) return;
    try {
      methods()?.setStrings(json);
    } catch {
      // (an app that cannot take them keeps its own English ones)
    }
  }, [language, app !== null]);

  useEffect(() => {
    if (!app) return;
    if (!profileId) {
      told = "";
      asked = "";
      return;
    }
    let stopped = false;
    const old = methods();
    if (asked !== profileId) {
      asked = profileId;
      send({ call: "pushToken" });
    }
    const say = (token: string) => {
      if (stopped) return;
      if (!token) {
        // (The notifications are off: the server forgets this phone, once a page. An app of 0.1.0 does not say; it keeps what it was told.)
        if (old || app.notify || told === "off") return;
        told = "off";
        request("DELETE", "/api/push").catch(() => {
          if (told === "off") told = "";
        });
        return;
      }
      const said = `${token}|${profileId}`;
      if (told === said) return;
      told = said;
      request("PUT", "/api/push", { token, profileId }).catch(() => {
        if (told === said) told = ""; // (tried again at the next change, or the next page)
      });
    };
    if (!old) {
      say(app.notify ? app.token : "");
      return () => {
        stopped = true;
      };
    }
    const fromOld = () => {
      try {
        say(old.pushToken() || "");
      } catch {
        // (nothing this time)
      }
    };
    fromOld();
    window.addEventListener("kinoapp:push-token", fromOld);
    return () => {
      stopped = true;
      window.removeEventListener("kinoapp:push-token", fromOld);
    };
  }, [profileId, app]);
}
