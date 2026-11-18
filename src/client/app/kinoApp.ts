import { useEffect, useSyncExternalStore } from "react";
import { request } from "../account/api";
import { t } from "../i18n";

export type AppFolder = "whatsapp-stickers" | "whatsapp-gifs";
const FOLDERS: readonly AppFolder[] = ["whatsapp-stickers", "whatsapp-gifs"];

export interface KinoAppState {
  version: string;
  folders: AppFolder[];
  notify: boolean;
  token: string;
}

interface MessageBridge {
  postMessage(message: string): void;
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}
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

export const inKinoApp = (): boolean => found() !== undefined;

let state: KinoAppState | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());
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

export function noPinchZoom(doc: Document = document): void {
  const viewport = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport && !/user-scalable/.test(viewport.content)) viewport.content = `${viewport.content}, maximum-scale=1, user-scalable=no`;
  doc.documentElement.style.touchAction = "pan-x pan-y";
}

let started = false;
function start(): void {
  if (started) return;
  started = true;
  if (inKinoApp()) noPinchZoom();
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

export const opensFolder = (app: KinoAppState | null, folder: AppFolder): boolean => app?.folders.includes(folder) ?? false;

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

const PUSH_WORDS = {
  chat: "app.push.chat",
  recommend: "app.push.recommend",
  party: "app.push.party",
  together: "app.push.together",
  plan: "app.push.plan",
  planYes: "app.push.planYes",
  planNo: "app.push.planNo",
  title: "app.push.title",
  channel: "app.push.channel",
  updateReady: "app.update.ready",
  updateInstall: "app.update.install",
} as const;

export const pushWords = (): Record<keyof typeof PUSH_WORDS, string> =>
  Object.fromEntries(Object.entries(PUSH_WORDS).map(([kind, key]) => [kind, t(key, { name: "{name}" })])) as Record<keyof typeof PUSH_WORDS, string>;

let told = "";
let asked = "";

export function useKinoAppNotifications(profileId: string | null, language: string): void {
  const app = useKinoApp();

  useEffect(() => {
    const json = JSON.stringify(pushWords());
    if (send({ call: "setStrings", json })) return;
    try {
      methods()?.setStrings(json);
    } catch {
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
        if (told === said) told = "";
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
