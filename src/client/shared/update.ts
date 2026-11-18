import { useSyncExternalStore } from "react";
import { buildId } from "../feedback/diagnostics";

export const CHECK_EVERY_MS = 15 * 60_000;
export const CHECK_AGAIN_MS = 60_000;

export interface UpdateState {
  found: string | null;
  later: string | null;
}

let state: UpdateState = { found: null, later: null };
const watchers = new Set<() => void>();
const set = (next: UpdateState) => {
  state = next;
  watchers.forEach((watch) => watch());
};

export const isOtherBuild = (mine: string, served: unknown): served is string =>
  mine !== "dev" && typeof served === "string" && /^index-[\w-]{1,80}$/.test(served) && served !== mine;

export const offered = (now: UpdateState): boolean => now.found !== null && now.found !== now.later;

let lastAsked = Number.NEGATIVE_INFINITY;

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
  }
}

export const putOff = (): void => set({ ...state, later: state.found });

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
export const updateNow = (): UpdateState => state;

export const useUpdate = (): UpdateState => useSyncExternalStore(watch, updateNow, updateNow);

export function forgetUpdates(): void {
  lastAsked = Number.NEGATIVE_INFINITY;
  state = { found: null, later: null };
}
