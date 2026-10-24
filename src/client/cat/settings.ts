import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isTvAgent } from "../role";
import { readStorage, writeStorage } from "../shared/format";

/**
 * Whether this screen shows the cat, and how. The host decides first (`/api/features`: off for everyone until it is turned on, and turning it off
 * again takes every cat away at the next load); then this device (`kino.cat` in its own storage: it is the screen's, not the profile's, as a TV and a
 * phone of one person need not agree); then the address (`?cat=on|off|debug`, for trying it without keeping it). This file is all that is in the
 * website's first download: the cat itself is another file, fetched only for a screen that wants one.
 */

/**
 * The two cats a screen can have, and they are all the settings offer: the white and grey ragdoll (the detailed one, a model drawn on the graphics card; on a screen
 * that cannot afford that it is drawn simply, in its colours) and the ginger cartoon cat (flat shapes, light to draw on any screen).
 */
export const CAT_LOOKS = ["ragdoll", "ginger"] as const;
export type CatLook = (typeof CAT_LOOKS)[number];
/** The coats the detailed cat can wear; the settings offer the ragdoll's and the ginger's (the address can ask for the rest, to look at them). */
export const CAT_COATS = ["ragdoll", "ginger", "tuxedo", "grey", "calico"] as const;
export type CatCoat = (typeof CAT_COATS)[number];
/** The coat a look wears. */
export const coatOfLook = (look: CatLook): CatCoat => (look === "ginger" ? "ginger" : "ragdoll");
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
  /** Which cat it is (see `CAT_LOOKS`). */
  look: CatLook;
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

/**
 * The settings as stored (anything that is not understood is the default), for a browser that is a TV's or not. A device that kept its settings before there were
 * two cats to choose between kept "detailed cat: off" for the ginger one and "on" for the ragdoll (with a coat, which the settings do not offer any more).
 */
export function parseCatSettings(raw: string | undefined, tv: boolean): CatSettings {
  const settings: CatSettings = { on: false, quiet: tv, films: true, look: "ragdoll", size: "normal" };
  if (!raw) return settings;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored === "object" && stored !== null) {
      const each = stored as Record<string, unknown>;
      if (typeof each.on === "boolean") settings.on = each.on;
      if (typeof each.quiet === "boolean") settings.quiet = each.quiet;
      if (typeof each.films === "boolean") settings.films = each.films;
      settings.look = CAT_LOOKS.find((look) => look === each.look) ?? (each.detail === false ? "ginger" : settings.look);
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
 * Whether the host offers a cat at all: asked when somebody wants to know (the cat's boot, the library's corner, and the settings page when it is opened,
 * whether or not this device wants a cat: the page must show its row on a host that offers one). A host that says no (or has never heard of cats) offers
 * none for the rest of the load. One that does not answer (a server that is still waking up, a line that dropped, a TV that started before its network was up)
 * is asked again a moment later, twice, and then offers none for now: it is asked afresh the next time somebody wants to know, so that a screen that stays on
 * for days is not left without a cat for a minute's trouble at its start (the cat's boot asks again when the line comes back or the page is looked at again).
 */
let offered: Promise<boolean> | undefined;
let unsure = false;
const RETRY_MS = [1500, 4000];
export function catOffered(): Promise<boolean> {
  if (unsure) {
    // (the last answer was a host that did not answer, not a host that said no)
    unsure = false;
    offered = undefined;
  }
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
      if (wait === undefined) {
        unsure = true;
        return false;
      }
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
 * Whether the viewer has sent the cat to sleep (from its menu, or "send away" in the corner's panel): it is gone from every page and every film until it is woken, and the
 * panel and the settings page then have a button for that. It lasts for this load of the page only: a cat that is switched off and on again, or a page that is loaded
 * again, is awake. The cat's host says it; before there is a cat it is not.
 */
const ASLEEP = "kino:cat-asleep";
let asleep = false;
export function setCatAsleep(value: boolean): void {
  if (asleep === value) return;
  asleep = value;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ASLEEP));
}
const subscribeAsleep = (listener: () => void): (() => void) => {
  window.addEventListener(ASLEEP, listener);
  return () => window.removeEventListener(ASLEEP, listener);
};
export const useCatAsleep = (): boolean => useSyncExternalStore(subscribeAsleep, () => asleep, () => false);

/**
 * Which cat is really drawn on this screen, and, when it is not the one that was chosen, why (for the settings page, so that a viewer who chose the detailed cat
 * and sees the simple one is told why, and can have it tried again): `slow`: the screen could not keep up with it; `graphics`: this browser would not give the
 * graphics it needs; `file`: its file did not come; `lost`: the browser took the picture away. The cat's host says it; before there is a cat it is `none`.
 */
export type CatArt = "solid" | "classic" | "none";
export type CatWhy = "" | "slow" | "graphics" | "file" | "lost";
export interface CatShown {
  art: CatArt;
  why: CatWhy;
}
const SHOWN = "kino:cat-shown";
const NO_CAT: CatShown = { art: "none", why: "" };
let shown: CatShown = NO_CAT;
export function setCatShown(next: CatShown): void {
  if (shown.art === next.art && shown.why === next.why) return;
  shown = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHOWN));
}
const subscribeShown = (listener: () => void): (() => void) => {
  window.addEventListener(SHOWN, listener);
  return () => window.removeEventListener(SHOWN, listener);
};
export const useCatShown = (): CatShown => useSyncExternalStore(subscribeShown, () => shown, () => NO_CAT);

/**
 * For the library's corner: whether the cat's button is to be there. The host is asked only by a screen that wants a cat, so a screen that does not
 * costs the host nothing.
 */
export function useCatWanted(): boolean {
  const raw = useSyncExternalStore(subscribeCatSettings, rawSettings, () => "");
  const away = useSyncExternalStore(subscribeGone, () => gone, () => false);
  const wants = useMemo(() => wantsCat(parseCatSettings(raw || undefined, onTv()), catAsk()), [raw]);
  const [allowed, setAllowed] = useState(false);
  // (a host that did not answer is asked again when the line comes back, so that the button is there with the cat that the boot then starts)
  const [chance, setChance] = useState(0);
  useEffect(() => {
    if (!wants) return;
    const again = () => setChance((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [wants]);
  useEffect(() => {
    if (!wants) return;
    let live = true;
    void catOffered().then((yes) => live && setAllowed(yes));
    return () => {
      live = false;
    };
  }, [wants, chance]);
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
