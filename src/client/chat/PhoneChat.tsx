import { ChatPhone } from "./ChatPhone";
import { useHost } from "./useHost";

/** The chat with a friend as a sheet on the phone. */
export function PhoneChat({ friendId, onClose }: { friendId: string; onClose: () => void }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  return <ChatPhone name={host.friend.name} session={host.session} report={host.report} receiving={host.receiving} onClose={host.close} />;
}
