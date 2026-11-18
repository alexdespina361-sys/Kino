import { useT } from "../i18n";
import type { ChatSession } from "./useChat";
import { problemText } from "./words";

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

export function whyNotWrite(session: ChatSession): "ended" | "closed" | null {
  if (session.ended) return "ended";
  return session.loaded && !session.state.open ? "closed" : null;
}
