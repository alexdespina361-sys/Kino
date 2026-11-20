import { useEffect, useState } from "react";
import type { ChatTalk } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { useFriends } from "../friends/FriendsProvider";
import { chatApi } from "./api";

export const TALKS_EVERY_MS = 15_000;

export function useTalks(looking: boolean): ChatTalk[] | null {
  const account = useAccount();
  const friends = useFriends();
  const profileId = account.me && account.profile ? account.profile.id : "";
  const [talks, setTalks] = useState<{ of: string; list: ChatTalk[] } | null>(null);
  const mark = (friends.state?.chat ?? []).map((notice) => `${notice.friend}:${notice.count}:${notice.at}`).join(",");
  useEffect(() => {
    if (!looking || !profileId || !friends.on) return;
    let stopped = false;
    const look = () =>
      chatApi.talks(profileId).then(
        (answer) => {
          if (!stopped) setTalks({ of: profileId, list: answer.talks });
        },
        () => undefined,
      );
    void look();
    const every = setInterval(() => {
      if (document.visibilityState === "visible") void look();
    }, TALKS_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(every);
    };
  }, [looking, profileId, friends.on, mark]);
  return talks && talks.of === profileId ? talks.list : null;
}
