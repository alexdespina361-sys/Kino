import type { FriendsState } from "../../shared";
import type { News } from "./news";

/**
 * How often a screen looks at its friends (there is no push: each screen asks). Often while something goes on between them, a little more
 * often while a friend is on the site (the only time one can send anything), every half minute else. A screen out of sight asks nothing.
 */

/** Nothing going on, or the server can't be reached. */
export const QUIET_MS = 30_000;
/** A friend is on the site (as far as this profile is shown: one who hides it is not, and is heard at the quiet pace). */
export const FRIEND_ON_MS = 15_000;
/** Something just went on between friends: this screen sent, answered or wrote, or a friend did. */
export const LIVELY_MS = 8_000;
/** ...for this long after the last of it. */
export const LIVELY_FOR_MS = 3 * 60_000;
/** A window focused this soon after a look does not look again (a tab brought back is shown, which looks, and then focused). */
export const WAKE_GAP_MS = 3_000;

/** How long until the next look. */
export function lookPace(now: number, livelyUntil: number, friendOnline: boolean): number {
  if (now < livelyUntil) return LIVELY_MS;
  return friendOnline ? FRIEND_ON_MS : QUIET_MS;
}

/** What waits in the chats, in two numbers: a new message from a friend makes one of them grow. */
export interface ChatMark {
  newest: number;
  count: number;
}

export const chatMark = (state: FriendsState): ChatMark => ({
  newest: Math.max(0, ...(state.chat ?? []).map((notice) => notice.at)),
  count: (state.chat ?? []).reduce((sum, notice) => sum + notice.count, 0),
});

/**
 * Whether a friend just did something for this profile, so that more may come in a moment: anything new but what they watch (a friend in a film
 * is not talking to anybody), or a new message in a chat.
 */
export const stirring = (news: readonly News[], before: ChatMark, now: ChatMark): boolean =>
  news.some((item) => item.kind !== "activity") || now.newest > before.newest || now.count > before.count;

/** Whether a friend is on the site right now, as far as this profile is told. */
export const friendOnline = (state: FriendsState): boolean => state.friends.some((friend) => friend.online === true);
