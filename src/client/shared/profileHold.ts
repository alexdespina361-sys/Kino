import { useEffect, useState } from "react";
import { useAccount } from "../account/AccountProvider";
import { GUEST } from "../account/profileStore";
import { useProfileData } from "../account/store";

/** How long a screen holds what depends on the profile's settings, at most, before it shows what it has: the server may be slow, or down. */
export const HOLD_MS = 5_000;

/** `on`, for `HOLD_MS` at most from the moment it came on. */
function useForAWhile(on: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const timer = setTimeout(() => setLate(true), HOLD_MS);
    return () => clearTimeout(timer);
  }, [on]);
  return on && !late;
}

/**
 * Whether the screen should still hold what depends on the profile's settings (the library's rows and its search, a title's page asked for by a link): a
 * child's profile shows only some titles, and is not known to be one before then. Held while the server has not said who is signed in yet (the page has
 * only the browser's own copy open until it has), while the profile's copy is not the one open yet, and while that copy has never had an answer from
 * the server (a profile new to this screen: see `Snapshot.waiting`); for `HOLD_MS` at most.
 */
export function useProfileHold(): boolean {
  const { status, me, profile } = useAccount();
  const { scope, waiting } = useProfileData();
  const expected = me && profile ? profile.id : GUEST;
  return useForAWhile(status === "loading" || scope !== expected || waiting);
}
