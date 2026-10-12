import { useEffect, useRef, useState } from "react";
import type { InviteView } from "../../shared";
import { describeError } from "../account/errors";
import { useFriends } from "./FriendsProvider";

/** Who is behind a friend's code, looked up when the code is complete (and again for another): null while it is asked, and the reason it cannot be used if it cannot. */
export function usePeek(code: string): { seen: InviteView | null; problem: string | null } {
  const friends = useFriends();
  const latest = useRef(friends);
  latest.current = friends;
  const [seen, setSeen] = useState<InviteView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setSeen(null);
    setProblem(null);
    latest.current.peek(code).then(
      (view) => !stopped && setSeen(view),
      (error: unknown) => !stopped && setProblem(describeError(error)),
    );
    return () => {
      stopped = true;
    };
  }, [code]);
  return { seen, problem };
}
