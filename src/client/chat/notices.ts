import type { ChatNotice, FriendsState } from "../../shared";

/**
 * What waits in the chats, as the friends page and the bell tell it: how many messages are there from each friend that was not looked at (see
 * `ChatNotice`). Pure, so what shows where can be tested without a screen. A chat is told of quietly: a number and a line, never a popup.
 */

/** What waits, from the friends this profile still has, the newest first. */
export function chatWaiting(state: FriendsState | null): ChatNotice[] {
  if (!state?.chat) return [];
  const known = new Set(state.friends.map((friend) => friend.id));
  return state.chat.filter((notice) => known.has(notice.friend)).sort((a, b) => b.at - a.at);
}

/** How many messages wait from this friend. */
export const waitingFrom = (state: FriendsState | null, friendId: string): number => chatWaiting(state).find((notice) => notice.friend === friendId)?.count ?? 0;
