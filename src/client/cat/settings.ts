import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isTvAgent } from "../role";
import { readStorage, writeStorage } from "../shared/format";

/**
 * Whether this screen shows the cat, and how. The host decides first (`/api/features`: off for everyone until it is turned on, and turning it off
 * again takes every cat away at the next load); then this device (`kino.cat` in its own storage: it is the screen's, not the profile's, as a TV and a
 * phone of one person need not agree); then the address (`?cat=on|off|debug`, for trying it without keeping it). This file is all that is in the
 * website's first download: the cat itself is another file, fetched only for a screen that wants one.
 */

/** The coats the detailed cat can wear (the simple drawn cat has the one). */
export const CAT_COATS = ["ginger", "tuxedo", "grey", "calico"] as const;
export type CatCoat = (typeof CAT_COATS)[number];
/** How big the cat is on the screen, against what the screen's size makes of it: smaller where the picture is busy, bigger to see it better. */
export const CAT_SIZES = ["small", "normal", "large"] as const;
export type CatSize = (typeof CAT_SIZES)[number];
export const CAT_SIZE_FACTOR: Record<CatSize, number> = { small: 0.8, normal: 1, large: 1.35 };

export interface CatSettings {
  /** This device shows the cat. */
  on: boolean;
  /** It rests where it is and does not wander about (a TV's browser starts with this on). */
  quiet: boolean;
  /** It keeps the viewer company during a film too (asleep in a corner of the picture, away from the controls and the subtitles). */
  films: boolean;
  /** It is the detailed, solid cat where this screen can do one (off: the simple drawn cat, which costs a screen a tenth as much). */
  detail: boolean;
  /** The detailed cat's coat. */
  coat: CatCoat;
  /** How big the cat is. */
  size: CatSize;
}

export const CAT_KEY = "kino.cat";
const CHANGED = "kino:cat-settings";

export type CatAsk = "on" | "off" | "debug" | undefined;

/** What the address asks for: `?cat=on` shows the cat for this load only, `?cat=off` hides it, `?cat=debug` shows it with its numbers. */
export function catAsk(search: string = typeof location === "undefined" ? "" : location.search): CatAsk {
  const value = new URLSearchParams(search).get("cat");
  if (value === "1" || value === "on" || value === "true") return "on";
  if (value === "0" || value === "off" || value === "false") return "off";
  if (value === "debug") return "debug";
  return undefined;
}

/** What the address asks of the cat's look: `?catart=classic` is the simple cat, `?catart=solid` the detailed one, for this load only. */
export function catLook(search: string = typeof location === "undefined" ? "" : location.search): "solid" | "classic" | undefined {
  const value = new URLSearchParams(search).get("catart");
  return value === "classic" || value === "solid" ? value : undefined;
}

/** What the address asks of the coat (`?catcoat=tuxedo`) and the size (`?catsize=large`), for this load only. */
export function catCoatAsk(search: string = typeof location === "undefined" ? "" : location.search): CatCoat | undefined {
  const value = new URLSearchParams(search).get("catcoat");
  return CAT_COATS.find((coat) => coat === value);
}
export function catSizeAsk(search: string = typeof location === "undefined" ? "" : location.search): CatSize | undefined {
  const value = new URLSearchParams(search).get("catsize");
  return CAT_SIZES.find((size) => size === value);
}

/** The settings as stored (anything that is not understood is the default), for a browser that is a TV's or not. */
export function parseCatSettings(raw: string | undefined, tv: boolean): CatSettings {
  const settings: CatSettings = { on: false, quiet: tv, films: true, detail: true, coat: "ginger", size: "normal" };
  if (!raw) return settings;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored === "object" && stored !== null) {
      const each = stored as Record<string, unknown>;
      if (typeof each.on === "boolean") settings.on = each.on;
      if (typeof each.quiet === "boolean") settings.quiet = each.quiet;
      if (typeof each.films === "boolean") settings.films = each.films;
      if (typeof each.detail === "boolean") settings.detail = each.detail;
      settings.coat = CAT_COATS.find((coat) => coat === each.coat) ?? settings.coat;
      settings.size = CAT_SIZES.find((size) => size === each.size) ?? settings.size;
    }
  } catch {
    /* a value nobody wrote: the defaults */
  }
  return settings;
}

/** Whether this screen should have a cat, once the host allows one. */
export const wantsCat = (settings: CatSettings, ask: CatAsk): boolean => (ask === "off" ? false : ask === "on" || ask === "debug" ? true : settings.on);

const onTv = (): boolean => typeof navigator !== "undefined" && isTvAgent(navigator.userAgent);

/** What storage could not keep (private windows): the settings still hold until the page is closed. */
let kept: string | undefined;
const rawSettings = (): string => readStorage(CAT_KEY) ?? kept ?? "";

export const readCatSettings = (): CatSettings => parseCatSettings(rawSettings() || undefined, onTv());

export function writeCatSettings(patch: Partial<CatSettings>): void {
  const next = { ...readCatSettings(), ...patch };
  kept = JSON.stringify(next);
  writeStorage(CAT_KEY, kept);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function subscribeCatSettings(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => event.key === CAT_KEY && listener();
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Whether the host offers a cat at all: asked once per load, and only when somebody wants to know. A host that says no (or has never heard of cats) offers
 * none for the rest of the load; one that does not answer (a server that is still waking up, a line that dropped) is asked again a moment later, twice,
 * and then offers none for this load.
 */
let offered: Promise<boolean> | undefined;
const RETRY_MS = [1500, 4000];
export function catOffered(): Promise<boolean> {
  offered ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const answer = await fetch("/api/features", { cache: "no-store" });
        if (answer.ok) return ((await answer.json()) as { cat?: unknown }).cat === true;
        if (answer.status === 404) return false;
      } catch {
        /* no answer: the same as a server that is not ready */
      }
      const wait = RETRY_MS[attempt];
      if (wait === undefined) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
  })();
  return offered;
}

/**
 * Whether the cat is gone from this page although it was wanted: its file did not come, it could not start, or the screen could not afford it. The
 * library's corner button only opens the cat's panel, so it is taken away then rather than left to do nothing. Turning the cat off and on again, or
 * loading the page again, gives it another try.
 */
const GONE = "kino:cat-gone";
let gone = false;
export function setCatGone(value: boolean): void {
  if (gone === value) return;
  gone = value;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GONE));
}
const subscribeGone = (listener: () => void): (() => void) => {
  window.addEventListener(GONE, listener);
  return () => window.removeEventListener(GONE, listener);
};

/**
 * For the library's corner: whether the cat's button is to be there. The host is asked only by a screen that wants a cat, so a screen that does not
 * costs the host nothing.
 */
export function useCatWanted(): boolean {
  const raw = useSyncExternalStore(subscribeCatSettings, rawSettings, () => "");
  const away = useSyncExternalStore(subscribeGone, () => gone, () => false);
  const wants = useMemo(() => wantsCat(parseCatSettings(raw || undefined, onTv()), catAsk()), [raw]);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!wants) return;
    let live = true;
    void catOffered().then((yes) => live && setAllowed(yes));
    return () => {
      live = false;
    };
  }, [wants]);
  return wants && allowed && !away;
}

/** For the settings page: whether the switches are to be shown, what they say, and how to change them. */
export function useCatSettings(): { offered: boolean; settings: CatSettings; set: (patch: Partial<CatSettings>) => void } {
  const raw = useSyncExternalStore(subscribeCatSettings, rawSettings, () => "");
  const settings = useMemo(() => parseCatSettings(raw || undefined, onTv()), [raw]);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void catOffered().then((yes) => live && setAllowed(yes));
    return () => {
      live = false;
    };
  }, []);
  return { offered: allowed, settings, set: writeCatSettings };
}
