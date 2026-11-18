import { useEffect, useRef, useState } from "react";
import type { InviteView, TagView } from "../../shared";
import { describeError } from "../account/errors";
import { useFriends, type FriendsValue } from "./FriendsProvider";

function useLookup<T>(key: string, look: (friends: FriendsValue) => Promise<T>): { seen: T | null; problem: string | null } {
  const friends = useFriends();
  const latest = useRef(friends);
  latest.current = friends;
  const [seen, setSeen] = useState<T | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setSeen(null);
    setProblem(null);
    look(latest.current).then(
      (view) => !stopped && setSeen(view),
      (error: unknown) => !stopped && setProblem(describeError(error)),
    );
    return () => {
      stopped = true;
    };
  }, [key]);
  return { seen, problem };
}

export const usePeek = (code: string): { seen: InviteView | null; problem: string | null } => useLookup(code, (friends) => friends.peek(code));

export const useTagPeek = (text: string): { seen: TagView | null; problem: string | null } => useLookup(text, (friends) => friends.peekTag(text));
