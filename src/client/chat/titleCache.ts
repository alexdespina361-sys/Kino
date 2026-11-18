import { useEffect, useState, useSyncExternalStore } from "react";
import type { LibraryItem } from "../../shared";
import { askTitle } from "../shared/titleAddress";

export const RETRY_MS = 60_000;
export const CARDS_MAX = 12;

export type ChatTitle = { status: "loading" } | { status: "ready"; item: LibraryItem } | { status: "none" } | { status: "failed" };

type Kept = { item: LibraryItem | null } | { failedAt: number };
const kept = new Map<string, Kept>();
const asking = new Map<string, Promise<void>>();
let learned = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useTitlesLearned(): number {
  return useSyncExternalStore(subscribe, () => learned, () => learned);
}

export function knownTitle(id: string, now = Date.now()): ChatTitle {
  const found = kept.get(id);
  if (!found) return { status: "loading" };
  if ("item" in found) return found.item ? { status: "ready", item: found.item } : { status: "none" };
  return now - found.failedAt < RETRY_MS ? { status: "failed" } : { status: "loading" };
}

export function retryIn(id: string, now = Date.now()): number {
  const found = kept.get(id);
  return found && "failedAt" in found ? Math.max(0, RETRY_MS - (now - found.failedAt)) : 0;
}

export function askAbout(id: string): Promise<void> {
  if (knownTitle(id).status !== "loading") return Promise.resolve();
  let pending = asking.get(id);
  if (!pending) {
    pending = askTitle(id)
      .then((answer) => void kept.set(id, answer === undefined ? { failedAt: Date.now() } : { item: answer }))
      .finally(() => {
        asking.delete(id);
        learned++;
        for (const listener of listeners) listener();
      });
    asking.set(id, pending);
  }
  return pending;
}

export function useChatTitle(id: string): ChatTitle {
  const [, redraw] = useState(0);
  const now = knownTitle(id);
  useEffect(() => {
    let live = true;
    const again = () => live && redraw((n) => n + 1);
    if (now.status === "loading") void askAbout(id).then(again);
    const timer = now.status === "failed" ? setTimeout(again, retryIn(id) + 50) : undefined;
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, now.status]);
  return now;
}

export function cardsOf(ids: readonly (string | null)[], max = CARDS_MAX): ReadonlySet<string> {
  const chosen = new Set<string>();
  for (let index = ids.length - 1; index >= 0 && chosen.size < max; index--) {
    const id = ids[index];
    if (id) chosen.add(id);
  }
  return chosen;
}

export function forgetTitles(): void {
  kept.clear();
  asking.clear();
}
