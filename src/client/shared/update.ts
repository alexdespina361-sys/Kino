import { useSyncExternalStore } from "react";
import { buildId } from "../feedback/diagnostics";

/**
 * Whether a new Kino is out while this page is open (the owner's ask, 17 Nov: a page of an older version asks to be reloaded). The page knows its own
 * build (the name of its script, which every build changes); the site says which one it serves now (`/api/build`). It is asked:
 * - every quarter of an hour while the page is open,
 * - when the page is shown again (a phone back from another app, a TV back on Kino), and when the network comes back, at most once a minute,
 * - when a part of the page could not be downloaded (Vite's `vite:preloadError`): a new build takes the old one's files away, so an old page that opens
 *   a part it did not have yet (the chat, the changelog) finds nothing. A network that is down says nothing, and nothing is shown for it.
 * A page made for development (no build) asks nothing. What is shown, and when, is `UpdateHint`'s.
 */
export const CHECK_EVERY_MS = 15 * 60_000;
export const CHECK_AGAIN_MS = 60_000;

export interface UpdateState {
  /** The build the site serves, when it is not this page's. */
  found: string | null;
  /** The build its viewer said Later to: not shown again, until another one is out. */
  later: string | null;
}

let state: UpdateState = { found: null, later: null };
const watchers = new Set<() => void>();
const set = (next: UpdateState) => {
  state = next;
  watchers.forEach((watch) => watch());
};

/** Whether `served`, as the site said it, is another build than `mine`. */
export const isOtherBuild = (mine: string, served: unknown): served is string =>
  mine !== "dev" && typeof served === "string" && /^index-[\w-]{1,80}$/.test(served) && served !== mine;

/** Whether there is a new build to offer: one is out, and it is not the one its viewer put off. */
export const offered = (now: UpdateState): boolean => now.found !== null && now.found !== now.later;

let lastAsked = Number.NEGATIVE_INFINITY;

/** Asks the site which build it serves (not more than once a minute unless `always`). */
export async function checkForUpdate(options: { always?: boolean; mine?: string; fetcher?: typeof fetch; now?: number } = {}): Promise<void> {
  const mine = options.mine ?? buildId();
  if (mine === "dev") return;
  const now = options.now ?? Date.now();
  if (!options.always && now - lastAsked < CHECK_AGAIN_MS) return;
  lastAsked = now;
  try {
    const answer = await (options.fetcher ?? fetch)("/api/build", { cache: "no-store", credentials: "omit" });
    if (!answer.ok) return;
    const { build } = (await answer.json()) as { build?: unknown };
    if (isOtherBuild(mine, build) && build !== state.found) set({ ...state, found: build });
  } catch {
    // (No network, or no answer: nothing is said. The next check asks again.)
  }
}

/** Its viewer put it off: the same build is not offered again. */
export const putOff = (): void => set({ ...state, later: state.found });

/** Starts asking (once, from main.tsx). */
export function watchForUpdates(): void {
  if (buildId() === "dev") return;
  window.setInterval(() => void checkForUpdate({ always: true }), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  window.addEventListener("online", () => void checkForUpdate());
  window.addEventListener("vite:preloadError", () => void checkForUpdate({ always: true }));
}

const watch = (listener: () => void) => {
  watchers.add(listener);
  return () => void watchers.delete(listener);
};
/** What there is to offer now. */
export const updateNow = (): UpdateState => state;

/** ...for the part of the page that offers it. */
export const useUpdate = (): UpdateState => useSyncExternalStore(watch, updateNow, updateNow);

/** (For the tests: as a page that was just opened.) */
export function forgetUpdates(): void {
  lastAsked = Number.NEGATIVE_INFINITY;
  state = { found: null, later: null };
}
