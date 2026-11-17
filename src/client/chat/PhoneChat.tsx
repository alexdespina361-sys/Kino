import { presenceInChat } from "../friends/entries";
import { entryOfItem, openedAt, type Entry } from "../tv/pages";
import { ChatPhone } from "./ChatPhone";
import type { OpenTitle } from "./titles";
import { useHost } from "./useHost";

/**
 * The chat with a friend as a sheet on the phone. A title a message names opens over what the chat was opened from, at the episode and the time the message
 * names (if it does), and the chat closes (as the bell does).
 */
export function PhoneChat({ friendId, onClose, onOpenTitle }: { friendId: string; onClose: () => void; onOpenTitle?: ((entry: Entry) => void) | undefined }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  const open: OpenTitle | undefined = onOpenTitle
    ? (item, opening) => {
        host.close();
        onOpenTitle(openedAt(entryOfItem(item), opening));
      }
    : undefined;
  return (
    <ChatPhone
      name={host.friend.name}
      presence={presenceInChat(host.friend, Date.now())}
      online={host.friend.on && host.friend.online === true}
      session={host.session}
      report={host.report}
      receiving={host.receiving}
      onClose={host.close}
      onOpenTitle={open}
    />
  );
}
