import { useEffect, useMemo } from "react";
import { checkChatText } from "../../shared";
import { useProfileData } from "../account/store";
import { useT } from "../i18n";
import { Poster } from "../shared/Poster";
import type { ChatSession } from "./useChat";
import { messageOf, sendableTitles, type Sendable } from "./titles";

/**
 * Sending a title in the chat: a press on one of the titles this profile watched or saved sends it at once (its name and its address, see titles.ts),
 * through the chat's own send, so what limits a message limits it too, and the friend is told as of any message. What was being typed stays in the box.
 * A title sent by mistake is taken back as any message is.
 */

/** The titles this profile can send (see `sendableTitles`). */
function useSendable(): Sendable[] {
  const { progress, list } = useProfileData();
  return useMemo(() => sendableTitles(progress, list), [progress, list]);
}

/** (As any message: the text as the server will keep it, and nothing that it would refuse.) */
const send = async (session: ChatSession, title: Sendable): Promise<boolean> => {
  const checked = checkChatText(messageOf(title, location.origin));
  return checked.ok ? session.send(checked.text) : false;
};

/**
 * The titles of the chat's panel (ChatPanel.tsx): a poster a title, what this profile watched and saved. A press sends one at once, and the panel goes with it
 * (the chat shows it sent, or why not). `tv`: drawn for the TV's pages; `nav`: walked with the arrows (the remote lands on the first).
 */
export function TitleList({ session, tv, nav, onSent }: { session: ChatSession; tv: boolean; nav: boolean; onSent: () => void }) {
  const t = useT();
  const titles = useSendable();
  const prefix = tv ? "tv-chat" : "chat";
  // (The titles are this profile's, and another screen can change them while the panel is open: the remote, left on nothing when the poster it was on goes, is
  // given the first title, or the panel's tab when there is none any more.)
  useEffect(() => {
    if (!nav) return;
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    (
      document.querySelector<HTMLElement>(`[data-testid='${prefix}-pick']:not(:disabled)`) ??
      document.querySelector<HTMLElement>(`[data-testid='${prefix}-panel-tab'][aria-selected='true']`)
    )?.focus();
  }, [titles, nav, prefix]);
  if (titles.length === 0) {
    return (
      <p className={`${prefix}-pick-none`} data-testid={`${prefix}-pick-none`}>
        {t("chat.noTitles")}
      </p>
    );
  }
  return (
    <div className={`${prefix}-picks`} data-testid={`${prefix}-picks`}>
      {titles.map((title, at) => (
        <button
          type="button"
          key={title.address}
          className={`${prefix}-pick`}
          disabled={session.sending}
          onClick={() => {
            if (session.sending) return;
            onSent();
            void send(session, title);
          }}
          {...(nav ? { "data-nav": true } : {})}
          {...(nav && at === 0 ? { "data-autofocus": true } : {})}
          data-address={title.address}
          data-testid={`${prefix}-pick`}
        >
          <Poster className={`${prefix}-pick-art`} title={title.title} image={title.image} />
          <span className={`${prefix}-pick-name`}>{title.title}</span>
          {title.year && <span className={`${prefix}-pick-year`}>{title.year}</span>}
        </button>
      ))}
    </div>
  );
}
