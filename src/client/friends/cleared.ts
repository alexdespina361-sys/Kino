import type { ActivityItem } from "../../shared";

/**
 * What was cleared from the bell on this device: "Sam watched Dune" is news, not something to answer, so taking it off the list is this device's own
 * fact (like when the bell was last opened) and nothing is told to the server or to the friend. A line is cleared up to the moment it was cleared at:
 * when the friend watches the same title again later, that is news again.
 */
export type Cleared = Readonly<Record<string, number>>;

/** How many cleared lines are remembered: far more than the bell ever lists, and small enough to keep for good. */
const KEEP = 80;
/**
 * How long a cleared line stays away. What a friend watched is dated by their last minute of it, which moves on while they watch: a line cleared in
 * the middle of their film would be back a minute later. So it is cleared for the rest of that sitting and a while after; the same title on another
 * day is news again.
 */
export const CLEARED_FOR_MS = 8 * 60 * 60 * 1000;

type Line = Pick<ActivityItem, "friend" | "key" | "at">;
const idOf = (item: Pick<ActivityItem, "friend" | "key">) => `${item.friend}:${item.key}`;

/** Whether a line was cleared, and is not news again yet. (The record says when each line was cleared.) */
export function isCleared(cleared: Cleared, item: Line): boolean {
  const at = cleared[idOf(item)];
  return at !== undefined && item.at <= at + CLEARED_FOR_MS;
}

/** The record with these lines cleared at `now`, the oldest forgotten past `KEEP`. */
export function withCleared(cleared: Cleared, items: readonly Line[], now: number): Cleared {
  const next: Record<string, number> = { ...cleared };
  for (const item of items) next[idOf(item)] = Math.max(now, item.at);
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
}
