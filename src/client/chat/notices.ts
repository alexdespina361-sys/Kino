import type { ChatNotice, FriendsState } from "../../shared";

export function chatWaiting(state: FriendsState | null): ChatNotice[] {
  if (!state?.chat) return [];
  const known = new Set(state.friends.map((friend) => friend.id));
  return state.chat.filter((notice) => known.has(notice.friend)).sort((a, b) => b.at - a.at);
}

export const waitingFrom = (state: FriendsState | null, friendId: string): number => chatWaiting(state).find((notice) => notice.friend === friendId)?.count ?? 0;
