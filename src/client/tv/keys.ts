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

export function actionForKey(event: { key: string; keyCode?: number }): RemoteAction | null {
  return BY_KEY[event.key] ?? (event.keyCode !== undefined ? BY_KEY_CODE[event.keyCode] : undefined) ?? null;
}

/** How far the arrow keys, rewind and fast-forward jump. */
export const SKIP_SECONDS = 10;
