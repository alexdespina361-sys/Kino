import type { FriendsState } from "../../shared";
import type { News } from "./news";

export const QUIET_MS = 30_000;
export const FRIEND_ON_MS = 15_000;
export const LIVELY_MS = 8_000;
export const LIVELY_FOR_MS = 3 * 60_000;
export const WAKE_GAP_MS = 3_000;

export function lookPace(now: number, livelyUntil: number, friendOnline: boolean): number {
  if (now < livelyUntil) return LIVELY_MS;
  return friendOnline ? FRIEND_ON_MS : QUIET_MS;
}

export interface ChatMark {
  newest: number;
  count: number;
}

export const chatMark = (state: FriendsState): ChatMark => ({
  newest: Math.max(0, ...(state.chat ?? []).map((notice) => notice.at)),
  count: (state.chat ?? []).reduce((sum, notice) => sum + notice.count, 0),
});

export const stirring = (news: readonly News[], before: ChatMark, now: ChatMark): boolean =>
  news.some((item) => item.kind !== "activity") || now.newest > before.newest || now.count > before.count;

export const friendOnline = (state: FriendsState): boolean => state.friends.some((friend) => friend.online === true);
