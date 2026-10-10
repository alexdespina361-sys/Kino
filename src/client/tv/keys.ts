/** What a press on the TV remote (or a keyboard, when testing on a PC) means. */
export type RemoteAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "select" // OK / Enter: plays or pauses, or presses whatever button has focus
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
  | "mute" // M: this screen's own sound off and on
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
};

/** Android TV style key codes, for browsers that report no usable `key` for the remote's buttons. */
const BY_KEY_CODE: Record<number, RemoteAction> = {
  4: "back", // KEYCODE_BACK
  8: "back",
  13: "select",
  27: "back",
  37: "left",
  38: "up",
  39: "right",
  40: "down",
  85: "playpause", // KEYCODE_MEDIA_PLAY_PAUSE
  86: "stop",
  87: "next",
  89: "rewind",
  90: "forward",
  176: "next",
  177: "previous",
  178: "stop",
  179: "playpause",
};

/** The input types that are pressed, not typed into. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "file", "image", "color"]);

/** A text field has the keyboard: letters, Space, Backspace and the sideways arrows are for typing in it, not for the remote. */
export function isEditable(target: { tagName?: string; type?: string; isContentEditable?: boolean } | EventTarget | null | undefined): boolean {
  const element = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined;
  if (!element?.tagName) return false;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && !NOT_TEXT.has((element.type ?? "text").toLowerCase());
}

/** What still works with the cursor in a text field: moving between fields, OK, and leaving (but not Backspace, which deletes). */
const WHILE_TYPING = new Set<RemoteAction>(["up", "down", "select", "back"]);

export function actionForKey(event: { key: string; keyCode?: number; target?: EventTarget | null }): RemoteAction | null {
  const action = BY_KEY[event.key] ?? (event.keyCode !== undefined ? BY_KEY_CODE[event.keyCode] : undefined) ?? null;
  if (action && isEditable(event.target) && (!WHILE_TYPING.has(action) || event.key === "Backspace" || event.keyCode === 8)) return null;
  return action;
}

/** How far the arrow keys, rewind and fast-forward jump. */
export const SKIP_SECONDS = 10;
