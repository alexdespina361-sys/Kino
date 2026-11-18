import { alignerStats, describeAligner } from "../subsync/stats";
import { isEditable } from "../tv/keys";
import { describeSync, syncStats } from "../tv/sync";
import { isHisense } from "./browser";
import { readStorage } from "./format";
import { canFullscreen } from "./fullscreen";
import { findCookie } from "./kept";

const KEY = "kino.debug";
const KEPT_LINES = 12;

export function debugOn(search: string, kept: string | null | undefined): boolean {
  const asked = new URLSearchParams(search).get("debug");
  if (asked === null) return kept === "1";
  return !["0", "off", "false"].includes(asked.toLowerCase());
}

export function describeElement(node: unknown): string {
  const element = node as Element | null | undefined;
  if (!element?.tagName) return "-";
  const name = element.getAttribute?.("data-testid") || element.getAttribute?.("aria-label") || element.id || "";
  return element.tagName.toLowerCase() + (name ? `[${name.slice(0, 28)}]` : "");
}

export function describeKey(type: "keydown" | "keyup", key: { key: string; code: string; keyCode: number; target: EventTarget | null }): string {
  const arrow = type === "keydown" ? "v" : "^";
  const where = describeElement(key.target);
  if (key.key.length === 1 && isEditable(key.target)) return `${arrow} (typing) on ${where}`;
  return `${arrow} ${key.key} ${key.code} #${key.keyCode} on ${where}`;
}

const clip = (text: string, length = 120): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

const yes = (test: () => unknown): string => {
  try {
    return test() ? "Y" : "N";
  } catch {
    return "N";
  }
};

function flexGap(): boolean {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  box.append(document.createElement("div"), document.createElement("div"));
  document.body.append(box);
  const supported = box.scrollHeight === 1;
  box.remove();
  return supported;
}

function keepsStorage(): boolean {
  localStorage.setItem("kino.probe", "1");
  localStorage.removeItem("kino.probe");
  return true;
}

function keptIds(): string {
  const tail = (value: string | undefined) => (value ? value.slice(-4) : "-");
  try {
    return ["tv.deviceId", "controller.id"].map((key) => `${key} storage ${tail(readStorage(key))} cookie ${tail(findCookie(document.cookie, key))}`).join("  |  ");
  } catch {
    return "cookies cannot be read here";
  }
}

function spanOf(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}

export function describeServer(health: unknown): string {
  const { storage, uptime, segments } = (health && typeof health === "object" ? health : {}) as { storage?: unknown; uptime?: unknown; segments?: { hits?: unknown; misses?: unknown } | null };
  const where = typeof storage === "string" ? storage : "unknown";
  const verdict = where === "postgres" ? "kept" : where === "unknown" ? "?" : "lost when it sleeps or restarts";
  const pieces = segments && typeof segments.hits === "number" && typeof segments.misses === "number" ? `  film pieces: ${segments.hits} from memory, ${segments.misses} fetched` : "";
  return `server: storage ${where} (${verdict})  up ${typeof uptime === "number" && uptime >= 0 ? spanOf(uptime) : "?"}${pieces}`;
}

function abilities(): string {
  const video = document.createElement("video");
  const tests: Array<[string, () => unknown]> = [
    ["focus-visible", () => document.querySelector(":focus-visible") || true],
    ["is()", () => document.querySelector(":is(body)") || true],
    ["inset", () => CSS.supports("inset", "0")],
    ["aspect-ratio", () => CSS.supports("aspect-ratio", "1 / 1")],
    ["max()", () => CSS.supports("width", "max(1px, 2px)")],
    ["flex-gap", flexGap],
    ["at()", () => typeof [].at === "function"],
    ["MSE", () => MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028,mp4a.40.2"')],
    ["ws", () => typeof WebSocket === "function"],
    ["storage", keepsStorage],
    ["cookies", () => navigator.cookieEnabled],
    ["hls", () => video.canPlayType("application/vnd.apple.mpegurl")],
    ["mp4", () => video.canPlayType('video/mp4; codecs="avc1.42E01E"')],
  ];
  return tests.map(([name, test]) => `${name}:${yes(test)}`).join(" ");
}

function startDebug(): void {
  const lines: Array<{ text: string }> = [];
  const panel = document.createElement("pre");
  panel.id = "kino-debug";
  panel.setAttribute("data-feedback-skip", "");
  const size = Math.max(11, Math.round(innerWidth / 62));
  panel.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;max-width:64vw;margin:0;padding:.3em .6em;background:rgba(0,0,0,.8);color:#9f9;font:${size}px/1.25 monospace;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;`;
  (document.body ?? document.documentElement).append(panel);

  const now = () => new Date().toTimeString().slice(0, 8);
  const log = (text: string): { text: string } => {
    const line = { text: `${now()} ${clip(text)}` };
    lines.push(line);
    if (lines.length > KEPT_LINES) lines.shift();
    later();
    return line;
  };

  const can = abilities();
  let server = "server: asking…";
  const askServer = () => {
    try {
      fetch("/api/health", { cache: "no-store" })
        .then((response) => response.json())
        .then((health: unknown) => (server = describeServer(health)))
        .catch((error: unknown) => (server = `server: not answering (${String(error)})`))
        .then(later);
    } catch (error) {
      server = `server: cannot ask (${String(error)})`;
    }
  };
  const header = (): string[] => {
    const root = document.querySelector<HTMLElement>("[data-testid='tv']");
    const video = document.querySelector("video");
    const video_ = video
      ? `paused ${video.paused} at ${video.currentTime.toFixed(1)}s ready ${video.readyState} net ${video.networkState} controls ${video.controls} size ${video.videoWidth}x${video.videoHeight} error ${video.error?.code ?? "-"}`
      : "none";
    const sync = describeSync(syncStats);
    const aligner = describeAligner(alignerStats);
    return [
      "KINO DEBUG  (?debug=0 turns it off)",
      `UA ${navigator.userAgent}`,
      `screen ${screen.width}x${screen.height}  window ${innerWidth}x${innerHeight}  dpr ${devicePixelRatio}  touch ${navigator.maxTouchPoints ?? 0}`,
      `fullscreen: enabled ${document.fullscreenEnabled}  now ${describeElement(document.fullscreenElement)}  hisense ${isHisense()}  asked ${canFullscreen()}`,
      can,
      `ids: ${keptIds()}`,
      server,
      `page: ${root ? `tv state ${root.dataset.state} controls ${root.dataset.hud}` : "no TV screen"}  focus ${describeElement(document.activeElement)}`,
      `video: ${video_}`,
      ...(sync ? [sync] : []),
      ...(aligner ? [aligner] : []),
    ];
  };

  let timer = 0;
  const render = () => {
    timer = 0;
    try {
      panel.textContent = [...header(), "", ...lines.map((line) => line.text)].join("\n");
    } catch (error) {
      panel.textContent = `debug panel failed: ${String(error)}`;
    }
  };
  function later(): void {
    if (!timer) timer = window.setTimeout(render, 120);
  }

  for (const type of ["keydown", "keyup"] as const) {
    addEventListener(
      type,
      (event) => {
        const key = event as KeyboardEvent;
        const line = log(describeKey(type, key));
        if (type === "keydown") {
          setTimeout(() => {
            line.text = clip(`${line.text} ${key.defaultPrevented ? "taken" : "free"} -> ${describeElement(document.activeElement)}`, 150);
            later();
          }, 0);
        }
      },
      true,
    );
  }

  addEventListener("pointerdown", (event) => log(`pointer ${event.pointerType} on ${describeElement(event.target)}`), true);
  addEventListener("click", (event) => log(`click on ${describeElement(event.target)} detail ${event.detail}${event.isTrusted ? "" : " untrusted"}`), true);
  let lastMove = 0;
  addEventListener(
    "mousemove",
    (event) => {
      if (Date.now() - lastMove < 1000) return;
      lastMove = Date.now();
      log(`mouse ${event.clientX},${event.clientY}`);
    },
    true,
  );
  addEventListener("focusin", (event) => log(`focus ${describeElement(event.target)}`), true);

  for (const name of ["play", "playing", "pause", "waiting", "stalled", "error", "ended", "webkitbeginfullscreen", "webkitendfullscreen", "enterpictureinpicture"]) {
    document.addEventListener(name, (event) => log(`video ${name}${name === "error" ? ` ${(event.target as HTMLMediaElement).error?.code ?? ""}` : ""}`), true);
  }
  document.addEventListener("fullscreenchange", () => log(`fullscreen now ${describeElement(document.fullscreenElement)}`));
  document.addEventListener("visibilitychange", () => {
    log(`page ${document.visibilityState}`);
    if (document.visibilityState === "visible") askServer();
  });
  addEventListener("resize", later);
  addEventListener("error", (event) => log(`ERROR ${event.message} ${String(event.filename).split("/").pop()}:${event.lineno}`));
  addEventListener("unhandledrejection", (event) => log(`REJECTED ${String(event.reason)}`));
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      log(`console.${level} ${args.map(String).join(" ")}`);
    };
  }

  setInterval(later, 1000);
  askServer();
  log("started");
}

try {
  if (typeof document !== "undefined") {
    const kept = localStorage.getItem(KEY);
    const on = debugOn(location.search, kept);
    if (new URLSearchParams(location.search).has("debug")) {
      if (on) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    }
    if (on) startDebug();
  }
} catch {
}
