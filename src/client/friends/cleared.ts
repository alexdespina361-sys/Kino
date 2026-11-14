import type { ActivityItem } from "../../shared";

/**
 * What was cleared from the bell on this device: "Sam watched Dune" is news, not something to answer, so taking it off the list is this device's own
 * fact (like when the bell was last opened) and nothing is told to the server or to the friend. A line is cleared up to the moment it was cleared at:
 * when the friend watches the same title again later, that is news again.
 */
export type Cleared = Readonly<Record<string, number>>;

/** How many cleared lines are remembered: far more than the bell ever lists, and small enough to keep for good. */
const KEEP = 80;

const idOf = (item: Pick<ActivityItem, "friend" | "key">) => `${item.friend}:${item.key}`;

export const isCleared = (cleared: Cleared, item: Pick<ActivityItem, "friend" | "key" | "at">): boolean => (cleared[idOf(item)] ?? 0) >= item.at;

/** The record with these lines cleared too, the oldest forgotten past `KEEP`. */
export function withCleared(cleared: Cleared, items: readonly Pick<ActivityItem, "friend" | "key" | "at">[]): Cleared {
  const next: Record<string, number> = { ...cleared };
  for (const item of items) next[idOf(item)] = Math.max(next[idOf(item)] ?? 0, item.at);
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
}
