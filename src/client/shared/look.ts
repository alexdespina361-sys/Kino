import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./format";

/**
 * Which look the site wears: "classic", the one everybody has had so far, or "polish", the refined one (see docs/ui-polish). The choice is this
 * browser's own, kept in its storage, asked for with `?ui=polish` / `?ui=classic` in the address (`?ui=reset` goes back to the default), and
 * written on <html data-ui>: every rule of the refined look starts with `:root[data-ui="polish"]`, so while the look is "classic" none of them
 * matches and the page is exactly what it was.
 */
export type Look = "classic" | "polish";

export const LOOKS: readonly Look[] = ["classic", "polish"];

/** What a browser that has not chosen gets. */
export const DEFAULT_LOOK: Look = "classic";

export const LOOK_KEY = "kino.ui";

const isLook = (value: string | null | undefined): value is Look => value === "classic" || value === "polish";

/** What an address asks for: a look, "reset" (the default again), or nothing. */
export function lookFromSearch(search: string): Look | "reset" | undefined {
  const asked = new URLSearchParams(search).get("ui");
  if (asked === "reset") return "reset";
  return isLook(asked) ? asked : undefined;
}

/** The look to wear: what the address asks for, else what this browser chose before, else the default. */
export function chooseLook(search: string, stored: string | undefined): Look {
  const asked = lookFromSearch(search);
  if (asked === "reset") return DEFAULT_LOOK;
  if (asked) return asked;
  return isLook(stored) ? stored : DEFAULT_LOOK;
}

let current: Look = DEFAULT_LOOK;
const listeners = new Set<() => void>();

function show(look: Look): void {
  current = look;
  if (typeof document !== "undefined") document.documentElement.dataset.ui = look;
}

/** Called once, before the first render: the look is on the page before anything is drawn. */
export function startLook(search: string = typeof location === "undefined" ? "" : location.search): Look {
  const asked = lookFromSearch(search);
  const look = chooseLook(search, readStorage(LOOK_KEY));
  // (an address that asks is remembered, so the next visit, and every page of this one, keeps it)
  if (asked === "reset") writeStorage(LOOK_KEY, null);
  else if (asked) writeStorage(LOOK_KEY, asked);
  show(look);
  return look;
}

/** The address without its `?ui=`, as a path (what `history.replaceState` takes), or nothing when it did not ask for one. */
export function withoutLookAsk(href: string): string | undefined {
  const url = new URL(href);
  if (!url.searchParams.has("ui")) return undefined;
  url.searchParams.delete("ui");
  return url.pathname + url.search + url.hash;
}

export function setLook(look: Look): void {
  writeStorage(LOOK_KEY, look === DEFAULT_LOOK ? null : look);
  show(look);
  // (an address that still asked for a look would undo the choice at the next reload)
  if (typeof location !== "undefined" && typeof history !== "undefined") {
    try {
      const path = withoutLookAsk(location.href);
      if (path !== undefined) history.replaceState(history.state, "", path);
    } catch {
      /* an address that cannot be rewritten stays as it is */
    }
  }
  listeners.forEach((listener) => listener());
}

export const currentLook = (): Look => current;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // (Another tab of this browser changed it.)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LOOK_KEY && event.key !== null) return;
    show(chooseLook("", readStorage(LOOK_KEY)));
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

/** The look this page wears, and the way to change it. */
export function useLook(): [Look, (look: Look) => void] {
  return [useSyncExternalStore(subscribe, currentLook, () => DEFAULT_LOOK), setLook];
}
