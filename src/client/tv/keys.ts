import type { PartyCommand } from "../../shared";

export type RemoteAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "select"
  | "back"
  | "playpause"
  | "play"
  | "pause"
  | "stop"
  | "rewind"
  | "forward"
  | "next"
  | "previous"
  | "captions"
  | "fullscreen"
  | "mute"
  | "browse";

const BY_KEY: Record<string, RemoteAction> = {
  b: "browse",
  B: "browse",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "select",
  NumpadEnter: "select",
  " ": "playpause",
  Spacebar: "playpause",
  MediaPlayPause: "playpause",
  MediaPlay: "play",
  MediaPause: "pause",
  MediaStop: "stop",
  MediaRewind: "rewind",
  MediaFastForward: "forward",
  MediaTrackNext: "next",
  MediaTrackPrevious: "previous",
  Escape: "back",
  Backspace: "back",
  BrowserBack: "back",
  GoBack: "back",
  c: "captions",
  C: "captions",
  f: "fullscreen",
  F: "fullscreen",
  m: "mute",
  M: "mute",
  n: "next",
  N: "next",
  p: "previous",
  P: "previous",
  s: "stop",
  S: "stop",
  j: "rewind",
  J: "rewind",
  k: "playpause",
  K: "playpause",
  l: "forward",
  L: "forward",
};

const BY_KEY_CODE: Record<number, RemoteAction> = {
  4: "back",
  8: "back",
  13: "select",
  19: "pause",
  27: "back",
  37: "left",
  38: "up",
  39: "right",
  40: "down",
  85: "playpause",
  86: "stop",
  87: "next",
  89: "rewind",
  90: "forward",
  176: "next",
  177: "previous",
  178: "stop",
  179: "playpause",
  412: "rewind",
  413: "stop",
  415: "play",
  417: "forward",
  461: "back",
  10009: "back",
  10252: "playpause",
};

const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "file", "image", "color"]);

export function isEditable(target: { tagName?: string; type?: string; isContentEditable?: boolean } | EventTarget | null | undefined): boolean {
  const element = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined;
  if (!element?.tagName) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && !NOT_TEXT.has((element.type ?? "text").toLowerCase());
}

const WHILE_TYPING = new Set<RemoteAction>(["up", "down", "select", "back"]);

export function actionForKey(event: { key: string; keyCode?: number; target?: EventTarget | null }): RemoteAction | null {
  const action = BY_KEY[event.key] ?? (event.keyCode !== undefined ? BY_KEY_CODE[event.keyCode] : undefined) ?? null;
  if (action && isEditable(event.target) && (!WHILE_TYPING.has(action) || event.key === "Backspace" || event.keyCode === 8)) return null;
  return action;
}

export const SKIP_SECONDS = 10;

export function partyCommandForKey(action: RemoteAction, playing: boolean, hasNext: boolean): PartyCommand | null {
  switch (action) {
    case "select":
    case "playpause":
      return { type: playing ? "PAUSE" : "PLAY" };
    case "play":
      return { type: "PLAY" };
    case "pause":
      return { type: "PAUSE" };
    case "left":
    case "rewind":
      return { type: "SKIP", seconds: -SKIP_SECONDS };
    case "right":
    case "forward":
      return { type: "SKIP", seconds: SKIP_SECONDS };
    case "next":
      return hasNext ? { type: "NEXT_EPISODE" } : null;
    case "stop":
      return { type: "STOP" };
    default:
      return null;
  }
}
