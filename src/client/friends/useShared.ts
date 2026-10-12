import { useEffect, useRef, useState } from "react";
import type { FriendLists, FriendRatings } from "../../shared";
import { describeError } from "../account/errors";
import { useFriends, type FriendsValue } from "./FriendsProvider";

export const askLists = (friends: FriendsValue, id: string): Promise<FriendLists> => friends.lists(id);
export const askRatings = (friends: FriendsValue, id: string): Promise<FriendRatings> => friends.ratings(id);

/**
 * What a friend shares, asked for when a page opens (and again when they start sharing it, or the page is for another friend):
 * null while it is being asked, and nothing is asked while `allowed` is false.
 */
export function useShared<T>(friendId: string, allowed: boolean, ask: (friends: FriendsValue, id: string) => Promise<T>): { data?: T; problem?: string } | null {
  const friends = useFriends();
  const latest = useRef(friends);
  latest.current = friends;
  const [answer, setAnswer] = useState<{ data?: T; problem?: string } | null>(null);
  useEffect(() => {
    setAnswer(null);
    if (!allowed) return;
    let stopped = false;
    ask(latest.current, friendId).then(
      (data) => !stopped && setAnswer({ data }),
      (error: unknown) => !stopped && setAnswer({ problem: describeError(error) }),
    );
    return () => {
      stopped = true;
    };
  }, [friendId, allowed, ask]);
  return answer;
}
