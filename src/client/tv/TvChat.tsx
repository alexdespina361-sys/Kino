import { ChatTv } from "../chat/ChatTv";
import type { OpenTitle } from "../chat/titles";
import { useHost } from "../chat/useHost";
import { presenceInChat } from "../friends/entries";
import { entryOfItem, openedAt, type Entry } from "./pages";

export function TvChat({ friendId, narrow, onClose, onOpenTitle }: { friendId: string; narrow: boolean; onClose: () => void; onOpenTitle?: ((entry: Entry) => void) | undefined }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  const open: OpenTitle | undefined = onOpenTitle
    ? (item, opening) => {
        host.close();
        onOpenTitle(openedAt(entryOfItem(item), opening));
      }
    : undefined;
  return (
    <ChatTv
      name={host.friend.name}
      avatar={host.friend.avatar}
      online={host.friend.on && host.friend.online}
      presence={presenceInChat(host.friend, Date.now())}
      session={host.session}
      report={host.report}
      receiving={host.receiving}
      narrow={narrow}
      desk={typeof document !== "undefined" && document.documentElement.dataset.fit === "desk"}
      onClose={host.close}
      onOpenTitle={open}
    />
  );
}
