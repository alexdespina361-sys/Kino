import { useCallback } from "react";
import { useAccount } from "../account/AccountProvider";
import { useFriends } from "../friends/FriendsProvider";
import { chatApi } from "./api";

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
