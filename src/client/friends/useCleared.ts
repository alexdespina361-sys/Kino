import { useCallback, useSyncExternalStore } from "react";
import type { ActivityItem } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { withCleared, type Cleared } from "./cleared";

const key = (profileId: string) => `kino.bellCleared.${profileId}`;
const NONE: Cleared = {};

function read(profileId: string): Cleared {
  try {
    const found: unknown = JSON.parse(localStorage.getItem(key(profileId)) ?? "{}");
    if (!found || typeof found !== "object" || Array.isArray(found)) return NONE;
    return Object.fromEntries(Object.entries(found).filter((pair): pair is [string, number] => typeof pair[1] === "number"));
  } catch {
    return NONE;
  }
}

// (The bell's button and the list it opens are on screen together: they share one record.)
const known = new Map<string, Cleared>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const of = (profileId: string): Cleared => {
  if (!known.has(profileId)) known.set(profileId, read(profileId));
  return known.get(profileId)!;
};

/** What this profile cleared from the bell on this device, and the way to clear more. */
export function useCleared(): { cleared: Cleared; clear: (items: readonly Pick<ActivityItem, "friend" | "key" | "at">[]) => void } {
  const account = useAccount();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const cleared = useSyncExternalStore(subscribe, () => (profileId ? of(profileId) : NONE));
  const clear = useCallback(
    (items: readonly Pick<ActivityItem, "friend" | "key" | "at">[]) => {
      if (!profileId || items.length === 0) return;
      const next = withCleared(of(profileId), items, Date.now());
      known.set(profileId, next);
      try {
        localStorage.setItem(key(profileId), JSON.stringify(next));
      } catch {
        // (a browser that keeps nothing: the lines are back when the page is opened again, which is all it costs)
      }
      listeners.forEach((listener) => listener());
    },
    [profileId],
  );
  return { cleared, clear };
}
