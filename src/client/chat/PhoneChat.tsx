import { presenceInChat } from "../friends/entries";
import { entryOfItem, openedAt, type Entry } from "../tv/pages";
import { ChatPhone } from "./ChatPhone";
import type { OpenTitle } from "./titles";
import { useHost } from "./useHost";

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
