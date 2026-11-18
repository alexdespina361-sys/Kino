import type { ActivityItem } from "../../shared";

export type Cleared = Readonly<Record<string, number>>;

const KEEP = 80;
export const CLEARED_FOR_MS = 8 * 60 * 60 * 1000;

type Line = Pick<ActivityItem, "friend" | "key" | "at">;
const idOf = (item: Pick<ActivityItem, "friend" | "key">) => `${item.friend}:${item.key}`;

export function isCleared(cleared: Cleared, item: Line): boolean {
  const at = cleared[idOf(item)];
  return at !== undefined && item.at <= at + CLEARED_FOR_MS;
}

export function withCleared(cleared: Cleared, items: readonly Line[], now: number): Cleared {
  const next: Record<string, number> = { ...cleared };
  for (const item of items) next[idOf(item)] = Math.max(now, item.at);
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
}
