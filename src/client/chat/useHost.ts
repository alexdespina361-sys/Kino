import { useEffect } from "react";
import { friendChoices } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { useSettings } from "../account/settings";
import { useFriends } from "../friends/FriendsProvider";
import { useChat, useChatReport } from "./useChat";

export function useHost(friendId: string, onClose: () => void) {
  const account = useAccount();
  const friends = useFriends();
  const { settings } = useSettings();
  const profileId = account.profile?.id ?? "";
  const friend = friends.state?.friends.find((each) => each.id === friendId);
  const session = useChat(profileId, friendId);
  const report = useChatReport(profileId, friendId);
  const gone = !friends.on || (friends.state !== null && !friend);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  const close = () => {
    void friends.refresh();
    onClose();
  };
  const send = async (text: string) => {
    const went = await session.send(text);
    if (went) friends.stir();
    return went;
  };
  return { friend, session: { ...session, send }, report, receiving: friendChoices(settings).friendsMessages, close };
}
