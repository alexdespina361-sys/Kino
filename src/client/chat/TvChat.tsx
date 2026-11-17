import { presenceInChat } from "../friends/entries";
import { entryOfItem, openedAt, type Entry } from "../tv/pages";
import { ChatTv } from "./ChatTv";
import type { OpenTitle } from "./titles";
import { useHost } from "./useHost";

/**
 * The chat with a friend as pages of the TV's, over whatever the remote was on. `narrow`: a hand-held screen, which has its own keyboard. A title a message
 * names opens its page, at the episode and the time the message names (if it does), and the chat closes (Back from the title's page goes to what the chat was
 * opened from).
 */
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
