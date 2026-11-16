import { useAccount } from "../account/AccountProvider";
import { GUEST } from "../account/profileStore";
import { useProfileData } from "../account/store";
import { useForAWhile } from "./forAWhile";

export { HOLD_MS } from "./forAWhile";

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
