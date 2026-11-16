import { entryOfItem, type Entry } from "../tv/pages";
import { ChatPhone } from "./ChatPhone";
import { useHost } from "./useHost";

/** The chat with a friend as a sheet on the phone. A title a message names opens over what the chat was opened from, and the chat closes (as the bell does). */
export function PhoneChat({ friendId, onClose, onOpenTitle }: { friendId: string; onClose: () => void; onOpenTitle?: ((entry: Entry) => void) | undefined }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  const open = onOpenTitle
    ? (item: Parameters<typeof entryOfItem>[0]) => {
        host.close();
        onOpenTitle(entryOfItem(item));
      }
    : undefined;
  return <ChatPhone name={host.friend.name} session={host.session} report={host.report} receiving={host.receiving} onClose={host.close} onOpenTitle={open} />;
}
