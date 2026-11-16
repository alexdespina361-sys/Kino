import { useEffect } from "react";
import { friendChoices } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { useSettings } from "../account/settings";
import { useFriends } from "../friends/FriendsProvider";
import { useChat, useChatReport } from "./useChat";

/**
 * What a place a chat is opened from needs (PhoneChat.tsx and TvChat.tsx): the one chat it shows (the messages kept up to date while it is up,
 * and the report), the friend, and whether this profile takes messages. It looks at the friends again when the chat is closed (so that what waited
 * from the friend is not told of any more), and goes when the friend does: taken off from the other side or from another screen, or friends turned
 * off. One host is one chat: a page that can show another friend's gives it a `key`.
 */
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
  // (A message that went: the friend's answer is looked for every few seconds for a while, so the bell has it soon after the chat is closed.)
  const send = async (text: string) => {
    const went = await session.send(text);
    if (went) friends.stir();
    return went;
  };
  return { friend, session: { ...session, send }, report, receiving: friendChoices(settings).friendsMessages, close };
}
