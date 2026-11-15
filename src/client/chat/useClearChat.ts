import { useCallback } from "react";
import { useAccount } from "../account/AccountProvider";
import { useFriends } from "../friends/FriendsProvider";
import { chatApi } from "./api";

/**
 * The bell's cross on a line "Sam wrote": the chat is marked read, as opening it does (asking for a chat is having seen it), and the bell looks again.
 * The messages stay in the chat, and nobody else is told: a chat has no "seen".
 */
export function useClearChat(): (friendId: string) => void {
  const account = useAccount();
  const friends = useFriends();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  return useCallback(
    (friendId: string) => {
      if (!profileId) return;
      void chatApi
        .read(profileId, friendId)
        .then(() => friends.refresh())
        .catch(() => undefined);
    },
    [profileId, friends],
  );
}
