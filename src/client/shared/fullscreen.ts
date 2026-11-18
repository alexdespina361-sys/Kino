import { useEffect, useState } from "react";
import { isHisense } from "./browser";
import { readStorage, writeStorage } from "./format";

const LEFT_KEY = "kino.fullscreen.left";
const REFUSED_KEY = "kino.fullscreen.refused";

let refused: boolean | undefined;
function refusesFullscreen(): boolean {
  if (refused === undefined) {
    const asked = new URLSearchParams(location.search).get("fullscreen");
    if (asked === "off" || asked === "on") writeStorage(REFUSED_KEY, asked === "off" ? "1" : null);
    refused = isHisense() || readStorage(REFUSED_KEY) === "1";
  }
  return refused;
}

export const canFullscreen = (): boolean => Boolean(document.fullscreenEnabled) && !refusesFullscreen();

export const isFullscreen = (): boolean => document.fullscreenElement !== null;

let asked: Promise<void> | null = null;
function requestFullscreen(): Promise<void> {
  asked ??= document.documentElement.requestFullscreen().finally(() => {
    asked = null;
  });
  return asked;
}

export function enterFullscreen(): void {
  if (canFullscreen() && typeof document.documentElement.requestFullscreen === "function") requestFullscreen().catch(() => {});
}

export function toggleFullscreen(): void {
  if (isFullscreen()) document.exitFullscreen().catch(() => {});
  else enterFullscreen();
}

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

type Orientation = { lock?: (to: "landscape") => Promise<void>; unlock?: () => void };

const canTurn = (): boolean => {
  const orientation = typeof screen === "undefined" ? undefined : (screen.orientation as Orientation | undefined);
  return typeof orientation?.lock === "function" && matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
};

export function useLandscapeWhile(on: boolean): void {
  useEffect(() => {
    if (!on || !canTurn()) return;
    const orientation = screen.orientation as Orientation;
    try {
      orientation.lock!("landscape").catch(() => {});
    } catch {
    }
    return () => {
      try {
        orientation.unlock?.();
      } catch {
      }
    };
  }, [on]);
}

const takesTyping = (): boolean => !navigator.vendor.startsWith("Apple");

const fillsDisplay = (): boolean => isFullscreen() || matchMedia("(display-mode: fullscreen)").matches;

const mayEnterByItself = (): boolean => canFullscreen() && takesTyping() && readStorage(LEFT_KEY) === undefined;

let atFirstPress = false;

export const entersAtFirstPress = (): boolean => atFirstPress && mayEnterByItself() && !fillsDisplay();

export function setUpFullscreen({ byItself }: { byItself: boolean }): void {
  let unloading = false;
  addEventListener("pagehide", () => (unloading = true));
  addEventListener("pageshow", () => (unloading = false));
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) writeStorage(LEFT_KEY, null);
    else if (!unloading && document.visibilityState === "visible") writeStorage(LEFT_KEY, "1");
  });

  atFirstPress = byItself;
  if (!byItself || !mayEnterByItself()) return;
  let asking = false;
  const stop = () => {
    removeEventListener("keydown", enter, true);
    removeEventListener("click", enter, true);
  };
  const enter = (event: Event) => {
    if (!event.isTrusted || asking) return;
    if (fillsDisplay()) return stop();
    asking = true;
    requestFullscreen().then(stop, () => (asking = false));
  };
  addEventListener("keydown", enter, true);
  addEventListener("click", enter, true);
}
