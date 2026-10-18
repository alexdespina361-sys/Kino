import { useT } from "../i18n";
import type { ChatSession } from "./useChat";
import { problemText } from "./words";

/**
 * The quiet lines of a chat that are the same on the phone and the TV: that the friend is muted, that this profile takes no messages (so the
 * friend can't answer), and what last went wrong. `prefix` is the start of their test ids ("chat" on the phone, "tv-chat" on the TV).
 */
export function ChatNotices({ name, session, receiving, prefix }: { name: string; session: ChatSession; receiving: boolean; prefix: string }) {
  const t = useT();
  return (
    <>
      {session.state.muted && (
        <p className="chat-note" data-testid={`${prefix}-muted`}>
          {t("chat.muted", { name })}
        </p>
      )}
      {!receiving && (
        <p className="chat-note" data-testid={`${prefix}-mine-off`}>
          {t("chat.mineOff", { name })}
        </p>
      )}
      {session.problem && (
        <p className="chat-problem" role="alert" data-testid={`${prefix}-problem`}>
          {problemText(t, session.problem, name)}
        </p>
      )}
    </>
  );
}

/** Why one can't write to the friend, or null: the friend is no friend any more (or friends are off), or has stopped taking messages. */
export function whyNotWrite(session: ChatSession): "ended" | "closed" | null {
  if (session.ended) return "ended";
  return session.loaded && !session.state.open ? "closed" : null;
}
