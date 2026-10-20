import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isTvAgent } from "../role";
import { readStorage, writeStorage } from "../shared/format";

/**
 * Whether this screen shows the cat, and how. The host decides first (`/api/features`: off for everyone until it is turned on, and turning it off
 * again takes every cat away at the next load); then this device (`kino.cat` in its own storage: it is the screen's, not the profile's, as a TV and a
 * phone of one person need not agree); then the address (`?cat=on|off|debug`, for trying it without keeping it). This file is all that is in the
 * website's first download: the cat itself is another file, fetched only for a screen that wants one.
 */

export interface CatSettings {
  /** This device shows the cat. */
  on: boolean;
  /** It rests where it is and does not wander about (a TV's browser starts with this on). */
  quiet: boolean;
  /** It keeps the viewer company during a film too (asleep in a corner of the picture, away from the controls and the subtitles). */
  films: boolean;
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

/** The settings as stored (anything that is not understood is the default), for a browser that is a TV's or not. */
export function parseCatSettings(raw: string | undefined, tv: boolean): CatSettings {
  const settings: CatSettings = { on: false, quiet: tv, films: true };
  if (!raw) return settings;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored === "object" && stored !== null) {
      const each = stored as Record<string, unknown>;
      if (typeof each.on === "boolean") settings.on = each.on;
      if (typeof each.quiet === "boolean") settings.quiet = each.quiet;
      if (typeof each.films === "boolean") settings.films = each.films;
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

/** Whether the host offers a cat at all: asked once per load, and only when somebody wants to know. A host that does not answer offers none. */
let offered: Promise<boolean> | undefined;
export function catOffered(): Promise<boolean> {
  offered ??= fetch("/api/features", { cache: "no-store" })
    .then((answer) => (answer.ok ? (answer.json() as Promise<{ cat?: unknown }>) : { cat: false }))
    .then((body) => body.cat === true)
    .catch(() => false);
  return offered;
}

/**
 * For the library's corner: whether the cat's button is to be there. The host is asked only by a screen that wants a cat, so a screen that does not
 * costs the host nothing.
 */
export function useCatWanted(): boolean {
  const raw = useSyncExternalStore(subscribeCatSettings, rawSettings, () => "");
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
  return wants && allowed;
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
