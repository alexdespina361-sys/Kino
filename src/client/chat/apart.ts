import type { FriendsState } from "../../shared";

export const CHATS_FROM = 2;

export const chatsApart = (state: FriendsState | null): boolean => (state?.friends.length ?? 0) >= CHATS_FROM;

export const withoutChat = (state: FriendsState): FriendsState => {
  const { chat: _chat, ...rest } = state;
  return rest;
};
