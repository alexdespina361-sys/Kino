import { useEffect, useState } from "react";
import { readStorage, writeStorage } from "./format";

/**
 * Full screen for the page itself. A browser lets a page go full screen only right after a key press or click on it, so a page can't
 * open that way: a screen goes full screen at its first press, once, and from then on it is the viewer's call. What they did last is
 * kept in this browser: leave full screen and the next visit stays as it is; go in again and it opens full screen once more.
 */

const LEFT_KEY = "kino.fullscreen.left";

/** Whether the browser has a full screen to give this page (an iPhone's has none). */
export const canFullscreen = (): boolean => Boolean(document.fullscreenEnabled);

export const isFullscreen = (): boolean => document.fullscreenElement !== null;

export function enterFullscreen(): void {
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function toggleFullscreen(): void {
  if (isFullscreen()) document.exitFullscreen().catch(() => {});
  else enterFullscreen();
}

/** Whether the page is full screen right now, kept up to date. */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return on;
}

/** Safari takes no typed letters in a full-screen page (so that a page there can't pose as a sign-in), so it never goes there by itself. */
const takesTyping = (): boolean => !navigator.vendor.startsWith("Apple");

/**
 * Once, as the page starts. Keeps what the viewer chose: every way into and out of full screen (the button, a key, the phone's, the
 * browser's own) ends in the browser's `fullscreenchange`. And, for a page that plays (`byItself`), goes full screen at the first
 * key press or click, unless the viewer left it last time.
 */
export function setUpFullscreen({ byItself }: { byItself: boolean }): void {
  // A page that is going away (reloaded, switched to the remote) leaves full screen without anybody having chosen it.
  let unloading = false;
  addEventListener("pagehide", () => (unloading = true));
  addEventListener("pageshow", () => (unloading = false));
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) writeStorage(LEFT_KEY, null);
    else if (!unloading && document.visibilityState === "visible") writeStorage(LEFT_KEY, "1");
  });

  if (!byItself || !canFullscreen() || !takesTyping() || readStorage(LEFT_KEY) !== undefined) return;
  let asking = false;
  const enter = (event: Event) => {
    if (!event.isTrusted || asking) return;
    asking = true;
    // A key that is no press to a browser (Escape) is refused: the next press is tried instead.
    document.documentElement.requestFullscreen().then(
      () => {
        removeEventListener("keydown", enter, true);
        removeEventListener("click", enter, true);
      },
      () => (asking = false),
    );
  };
  addEventListener("keydown", enter, true);
  addEventListener("click", enter, true);
}
