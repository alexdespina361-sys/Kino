import { ChatTv } from "./ChatTv";
import { useHost } from "./useHost";

/** The chat with a friend as pages of the TV's, over whatever the remote was on. `narrow`: a hand-held screen, which has its own keyboard. */
export function TvChat({ friendId, narrow, onClose }: { friendId: string; narrow: boolean; onClose: () => void }) {
  const host = useHost(friendId, onClose);
  if (!host.friend) return null;
  return <ChatTv name={host.friend.name} session={host.session} report={host.report} receiving={host.receiving} narrow={narrow} onClose={host.close} />;
}
