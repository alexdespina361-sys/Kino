import { useAccount } from "../account/AccountProvider";
import { GUEST } from "../account/profileStore";
import { useProfileData } from "../account/store";
import { useForAWhile } from "./forAWhile";

export { HOLD_MS } from "./forAWhile";

export function useProfileHold(): boolean {
  const { status, me, profile } = useAccount();
  const { scope, waiting } = useProfileData();
  const expected = me && profile ? profile.id : GUEST;
  return useForAWhile(status === "loading" || scope !== expected || waiting);
}
