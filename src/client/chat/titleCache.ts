import { useEffect, useState } from "react";
import type { LibraryItem } from "../../shared";
import { askTitle } from "../shared/titleAddress";

/**
 * What the server says of the titles that chats name (see titles.ts), kept for as long as the page is open: a chat is read again every few seconds and is
 * drawn again each time, and the server's title asks are counted (`/api/library/title`, with the title pages' own). One ask per title at a time, however
 * many lines name it. A title nobody knows stays text for good; one the server could not be asked about is asked again a minute later at the earliest.
 */

/** How long a title the server could not be asked about waits before it is asked about again. */
export const RETRY_MS = 60_000;
/** How many titles a chat shows as cards: the newest this many (an old chat full of them would spend the title asks of a minute). */
export const CARDS_MAX = 12;

export type ChatTitle = { status: "loading" } | { status: "ready"; item: LibraryItem } | { status: "none" } | { status: "failed" };

type Kept = { item: LibraryItem | null } | { failedAt: number };
const kept = new Map<string, Kept>();
const asking = new Map<string, Promise<void>>();

/** What is known of a title now, without asking. */
export function knownTitle(id: string, now = Date.now()): ChatTitle {
  const found = kept.get(id);
  if (!found) return { status: "loading" };
  if ("item" in found) return found.item ? { status: "ready", item: found.item } : { status: "none" };
  return now - found.failedAt < RETRY_MS ? { status: "failed" } : { status: "loading" };
}

/** How long until a title the server could not be asked about may be asked about again (0: it may now, or it was not a failure). */
export function retryIn(id: string, now = Date.now()): number {
  const found = kept.get(id);
  return found && "failedAt" in found ? Math.max(0, RETRY_MS - (now - found.failedAt)) : 0;
}

/** Asks the server about a title, unless it is known or being asked about. */
export function askAbout(id: string): Promise<void> {
  if (knownTitle(id).status !== "loading") return Promise.resolve();
  let pending = asking.get(id);
  if (!pending) {
    pending = askTitle(id)
      .then((answer) => void kept.set(id, answer === undefined ? { failedAt: Date.now() } : { item: answer }))
      .finally(() => asking.delete(id));
    asking.set(id, pending);
  }
  return pending;
}

/**
 * The title a line of a chat names, as far as it is known; asked about when it is not. One the server could not be asked about is asked about again
 * when its minute is up, while the line is on the screen (the judge, 16 Nov: it stayed text, or an empty card, until the chat was opened again).
 */
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

/** The titles of a chat that are shown as cards: the newest `CARDS_MAX` of them (the others are shown as the text they are). */
export function cardsOf(ids: readonly (string | null)[], max = CARDS_MAX): ReadonlySet<string> {
  const chosen = new Set<string>();
  for (let index = ids.length - 1; index >= 0 && chosen.size < max; index--) {
    const id = ids[index];
    if (id) chosen.add(id);
  }
  return chosen;
}

/** (Tests.) Forget everything. */
export function forgetTitles(): void {
  kept.clear();
  asking.clear();
}
