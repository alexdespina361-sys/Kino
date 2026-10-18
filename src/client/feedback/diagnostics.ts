import { FEEDBACK_LIMITS, type FeedbackArea, type FeedbackContext } from "../../shared";
import { roleOfThisPage, thisIsHandHeld } from "../role";
import { describeElement } from "../shared/debug";
import { isEditable } from "../tv/keys";

/**
 * What the page can say about itself when somebody sends feedback: the device, the screen, the last things pressed, the errors, the film. It is
 * recorded from the start of the page (installDiagnostics, called by main.tsx) into small rings, and read when the form is opened. Nothing leaves
 * the browser unless the person sends it, the form shows exactly what would go (and lets each part be switched off), and what is recorded leaves
 * out what was typed, links' queries, codes and tokens.
 */

/* ------------------------------ leaving things out ------------------------------ */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URLS = /\b(?:https?|wss?|blob):[^\s"'<>)\]]+/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
/** A long run of letters and digits is a token, an id or a code: what it was is no use to anybody reading a report. */
const LONG = /\b(?=[\w-]*\d)[A-Za-z0-9_-]{24,}\b/g;

/** An address as far as a report needs it: the page of this site (no query, no hash, ids and codes as :id), or only the host of another. */
export function redactUrl(raw: string, base = typeof location === "undefined" ? "http://localhost/" : location.href): string {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return "<link>";
  }
  if (url.protocol === "blob:" || url.protocol === "data:") return `${url.protocol}…`;
  const here = (() => {
    try {
      return new URL(base).host;
    } catch {
      return "";
    }
  })();
  if (url.host !== here) return `${url.host}/…`;
  const path = url.pathname.split("/").map((part) => (/^(?=[\w-]*\d)[A-Za-z0-9_-]{16,}$/.test(part) ? ":id" : part)).join("/");
  return path.length > 100 ? `${path.slice(0, 99)}…` : path;
}

/** A text with the links shortened, and any address, token or IP left out. */
export function redactText(text: string): string {
  return text
    .replace(URLS, (link) => redactUrl(link))
    .replace(EMAIL, "<email>")
    .replace(IPV4, "<ip>")
    .replace(LONG, "<token>");
}

/* ------------------------------ what is recorded ------------------------------ */

interface Note {
  at: number;
  text: string;
}

const trail: Note[] = [];
const errors: Note[] = [];
const failed: Note[] = [];
/** The screens the person has been on, newest last: where a report is about is the last that was not the account's own. */
const screens: Array<{ id: string; area: FeedbackArea | undefined }> = [];
let installed = false;

function push(ring: Note[], text: string, max: number, at = Date.now()): void {
  const last = ring[ring.length - 1];
  if (last && last.text === text && at - last.at < 1000) return; // (the same line twice at once is one)
  ring.push({ at, text: redactText(text).slice(0, 400) });
  if (ring.length > max) ring.splice(0, ring.length - max);
}

/** Lines for the report: "12s ago  tap button[tv-search]". */
export function seconds(ring: Note[], now: number, max: number): string[] {
  return ring.slice(-max).map((note) => `${Math.max(0, Math.round((now - note.at) / 1000))}s ago  ${note.text}`);
}

/* ------------------------------ where the person is ------------------------------ */

/** Screens the page knows by an element it has only there, most particular first. `area` is what a report from that screen is probably about. */
const VIEWS: Array<{ selector: string; id: string; area?: FeedbackArea }> = [
  { selector: '[data-testid="tv"][data-state="error"]', id: "film that would not play", area: "wontplay" },
  { selector: '[data-testid="tv"][data-state="playing"], [data-testid="tv"][data-state="paused"], [data-testid="tv"][data-state="loading"]', id: "film", area: "player" },
  { selector: '[data-testid^="tv-party"]', id: "watching together", area: "party" },
  { selector: '[data-testid="tv-detail"]', id: "title page", area: "title" },
  { selector: '[data-testid="tv-search"]', id: "search", area: "search" },
  { selector: '[data-testid^="tv-friend"]', id: "friends", area: "friends" },
  { selector: '[data-testid="tv-browse"]', id: "library", area: "home" },
  { selector: '[data-testid="tv-welcome"], [data-testid="tv-paired"]', id: "welcome", area: "pairing" },
  { selector: '[data-testid="media-title"]', id: "remote", area: "remote" },
  { selector: '[data-testid="library-search-results"], [data-testid="library-search-input"]', id: "library search", area: "search" },
  { selector: '[data-testid="library"]', id: "library", area: "home" },
  { selector: '[data-testid="code-input"], [data-testid="scan"]', id: "pairing", area: "pairing" },
];

/** The screen the person is on, as far as the page can tell. */
export function viewNow(doc: Document | undefined = typeof document === "undefined" ? undefined : document): { id: string; area: FeedbackArea | undefined } | undefined {
  if (!doc) return undefined;
  for (const view of VIEWS) {
    try {
      if (doc.querySelector(view.selector)) return { id: view.id, area: view.area };
    } catch {
      // (a selector this browser does not know: the next one)
    }
  }
  return undefined;
}

function sample(): void {
  const view = viewNow();
  if (!view) return;
  const last = screens[screens.length - 1];
  if (last?.id === view.id) return;
  screens.push(view);
  if (screens.length > 8) screens.shift();
  push(trail, `screen: ${view.id}`, FEEDBACK_LIMITS.trail);
}

/** Where a report is probably about: the screen before the feedback was opened (the profile the button is on is not where the trouble was). */
export function guessArea(): FeedbackArea | undefined {
  for (let at = screens.length - 1; at >= 0; at--) if (screens[at]?.area) return screens[at]!.area;
  return undefined;
}

/* ------------------------------ installing ------------------------------ */

const KEYS_NOTED = new Set(["Enter", "Escape", "Backspace", "BrowserBack", "GoBack", "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious"]);

/** Whether this is part of the feedback's own screens (marked data-feedback-skip). */
const inFeedback = (target: EventTarget | null): boolean => target instanceof Element && target.closest("[data-feedback-skip]") !== null;

function labelOf(target: EventTarget | null): string {
  let node = target instanceof Element ? target : null;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    if (node.matches?.("button, a, [role='button'], [role='tab'], [role='option'], [data-testid], input, select, textarea, summary")) return describeElement(node);
  }
  return describeElement(target);
}

function reasonText(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  try {
    return typeof reason === "string" ? reason : JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/** Starts the recording (once). Everything it does is on the page it is in: no ask is made and nothing is kept outside it. */
export function installDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const later = () => void setTimeout(sample, 350);

  document.addEventListener(
    "click",
    (event) => {
      if (inFeedback(event.target)) return; // (what is pressed in the form itself is not the trouble)
      push(trail, `tap ${labelOf(event.target)}`, FEEDBACK_LIMITS.trail);
      later();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      // (What is typed in a field is not recorded, not even which keys: only the keys that press or leave something.)
      if (!KEYS_NOTED.has(event.key) || isEditable(event.target) || inFeedback(event.target)) return;
      push(trail, `key ${event.key} on ${describeElement(document.activeElement)}`, FEEDBACK_LIMITS.trail);
      later();
    },
    true,
  );
  window.addEventListener("popstate", later);
  setTimeout(sample, 1500);

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      // A script or a style sheet of the page that did not load is a broken page; a picture that did not is not worth a line.
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        push(errors, `did not load: ${redactUrl(target instanceof HTMLScriptElement ? target.src : target.href)}`, FEEDBACK_LIMITS.errors);
      } else if (event.message) {
        push(errors, `${event.message} (${String(event.filename).split("/").pop() ?? ""}:${event.lineno})`, FEEDBACK_LIMITS.errors);
      }
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => push(errors, `unhandled rejection: ${reasonText(event.reason)}`, FEEDBACK_LIMITS.errors));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      push(errors, `console.error: ${args.map((each) => (typeof each === "string" ? each : reasonText(each))).join(" ")}`, FEEDBACK_LIMITS.errors);
    } catch {
      // (a line that cannot be made is no reason for the page to stop)
    }
  };

  // The asks the page makes of its own server that fail, which is where a film that will not load or a list that will not show usually shows first.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // (A Request or a URL object as well as a string; written so that a browser without `Request` does not stumble on it.)
    const where = typeof input === "string" ? input : "href" in input ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    try {
      const response = await realFetch(input, init);
      if (!response.ok) noteFailed(method, where, response.status);
      return response;
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") noteFailed(method, where, "no answer");
      throw error;
    }
  };
}

function noteFailed(method: string, where: string, status: number | string): void {
  let path: string;
  try {
    const url = new URL(where, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/feedback")) return;
    path = redactUrl(where);
  } catch {
    return;
  }
  push(failed, `${method.toUpperCase()} ${path} -> ${status}`, FEEDBACK_LIMITS.failed);
}

/* ------------------------------ collecting ------------------------------ */

export interface Include {
  /** The device, the app's version, the language and the screen it is on. */
  device: boolean;
  steps: boolean;
  errors: boolean;
  playback: boolean;
}

const text = (selector: string): string | undefined => document.querySelector(selector)?.textContent?.trim() || undefined;

function playbackNow(): NonNullable<FeedbackContext["playback"]> | undefined {
  const tv = document.querySelector<HTMLElement>('[data-testid="tv"]');
  const video = document.querySelector<HTMLVideoElement>("video");
  // (a phone that is the remote of a TV has no video of its own: the line that says how the TV's one is doing has the state and the error)
  const remote = document.querySelector<HTMLElement>('[data-testid="player-state"]');
  const state = tv?.getAttribute("data-state") ?? remote?.getAttribute("data-state") ?? text('[data-testid="player-state"]');
  if (!state && !video) return undefined;
  const result: NonNullable<FeedbackContext["playback"]> = {};
  if (state) result.state = state.slice(0, 20);
  const title = text('[data-testid="tv-title"]') ?? text('[data-testid="media-title"]') ?? text('[data-testid="error-title"]');
  if (title) result.title = redactText(title).slice(0, 160);
  const error = tv?.getAttribute("data-error") ?? remote?.getAttribute("data-error");
  if (error) result.error = redactText(error).slice(0, 300);
  if (video) {
    if (Number.isFinite(video.currentTime)) result.time = Math.round(video.currentTime * 10) / 10;
    if (Number.isFinite(video.duration)) result.duration = Math.round(video.duration);
    result.rate = video.playbackRate;
    result.ready = video.readyState;
    if (video.videoWidth) result.size = `${video.videoWidth}x${video.videoHeight}`;
    const src = video.currentSrc;
    if (src && !src.startsWith("blob:")) result.host = redactUrl(src).slice(0, 120);
    else if (src) result.host = "blob (a stream played through the page)";
    if (video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      result.buffered = `${Math.max(0, Math.round(end - video.currentTime))}s ahead`;
    }
    if (video.error) result.error = `media error ${video.error.code}${video.error.message ? `: ${redactText(video.error.message)}` : ""}`.slice(0, 300);
  }
  return result;
}

function deviceNow(): NonNullable<FeedbackContext["device"]> {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const media = (query: string) => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const device: NonNullable<FeedbackContext["device"]> = {
    ua: navigator.userAgent.slice(0, 400),
    platform: String(navigator.platform ?? "").slice(0, 60),
    screen: [screen.width, screen.height],
    viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    touch: navigator.maxTouchPoints,
    pointer: media("(pointer: coarse)") ? "coarse" : media("(pointer: fine)") ? "fine" : "none",
    online: navigator.onLine,
    fullscreen: Boolean(document.fullscreenElement),
    standalone: media("(display-mode: standalone)") || media("(display-mode: fullscreen)"),
  };
  if (connection) device.connection = [connection.effectiveType, connection.downlink !== undefined ? `${connection.downlink} Mb/s` : "", connection.rtt !== undefined ? `${connection.rtt} ms` : "", connection.saveData ? "data saver" : ""].filter(Boolean).join(" ").slice(0, 80);
  if (navigator.hardwareConcurrency) device.cores = navigator.hardwareConcurrency;
  if (memory) device.memory = memory;
  return device;
}

/** The build of the page: the name of its script, which changes with every build. */
export function buildId(doc: Document | undefined = typeof document === "undefined" ? undefined : document): string {
  const src = [...(doc?.scripts ?? [])].map((script) => script.src).find((each) => /\/assets\/index-[\w-]+\.js/.test(each));
  return /\/assets\/(index-[\w-]+)\.js/.exec(src ?? "")?.[1] ?? "dev";
}

/** What would be sent with a report, for the parts that are on. */
export function collectContext(include: Include, extra: { signedIn?: boolean } = {}): FeedbackContext {
  const now = Date.now();
  const context: FeedbackContext = {};
  if (include.device) {
    context.build = buildId();
    context.role = roleOfThisPage();
    context.handHeld = thisIsHandHeld();
    context.lang = document.documentElement.lang || undefined;
    context.accent = document.documentElement.dataset.accent || undefined;
    context.device = deviceNow();
    // (The focus is in the form while it is open: what had it before is no longer known, so nothing is said.)
    const focus = inFeedback(document.activeElement) ? "-" : describeElement(document.activeElement);
    context.where = { path: redactUrl(location.href), ...(screens[screens.length - 1] ? { view: screens[screens.length - 1]!.id } : {}), ...(focus !== "-" ? { focus } : {}) };
    context.session = {
      ...(extra.signedIn !== undefined ? { signedIn: extra.signedIn } : {}),
      ...(document.querySelector('[data-testid^="tv-party"]') ? { party: "on" } : {}),
    };
  }
  if (include.steps) context.trail = seconds(trail, now, FEEDBACK_LIMITS.trail);
  if (include.errors) {
    context.errors = seconds(errors, now, FEEDBACK_LIMITS.errors);
    context.failed = seconds(failed, now, FEEDBACK_LIMITS.failed);
  }
  if (include.playback) {
    const playback = playbackNow();
    if (playback) context.playback = playback;
  }
  // (Nothing to say for a part is left out, not sent empty.)
  for (const key of ["trail", "errors", "failed"] as const) if (context[key]?.length === 0) delete context[key];
  return context;
}
