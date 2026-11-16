import { useEffect, useMemo } from "react";
import { checkChatText } from "../../shared";
import { useProfileData } from "../account/store";
import { Sheet } from "../controller/Sheet";
import { useT } from "../i18n";
import { Poster } from "../shared/Poster";
import { BackButton, Screen } from "../tv/Idle";
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

/** The phone's: a sheet over the chat, a row a title. It goes as soon as one is pressed (and the sheet with it: the chat shows it sent, or why not). */
export function TitlePickSheet({ name, session, onClose }: { name: string; session: ChatSession; onClose: () => void }) {
  const t = useT();
  const titles = useSendable();
  return (
    <Sheet title={t("chat.sendTitleTo", { name })} onClose={onClose} testId="chat-pick-sheet">
      {titles.length === 0 ? (
        <p className="chat-note" data-testid="chat-pick-none">
          {t("chat.noTitles")}
        </p>
      ) : (
        <div className="chat-picks">
          {titles.map((title) => (
            <button
              type="button"
              key={title.address}
              className="chat-pick"
              disabled={session.sending}
              onClick={() => {
                onClose();
                void send(session, title);
              }}
              data-address={title.address}
              data-testid="chat-pick"
            >
              <Poster className="chat-pick-art" title={title.title} image={title.image} />
              <span className="chat-pick-name">{title.title}</span>
              {title.year && <span className="chat-pick-year">{title.year}</span>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** The TV's: a page of posters the remote walks, OK sends one and goes back to the chat. Back goes back to the chat without sending anything. */
export function TitlePickTv({ name, session, onBack }: { name: string; session: ChatSession; onBack: () => void }) {
  const t = useT();
  const titles = useSendable();
  // (The titles are this profile's, and another screen can change them while the page is open: the remote, left on nothing when the poster it was on
  // goes, is given the first title, or Back when there is none any more.)
  useEffect(() => {
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    (document.querySelector<HTMLElement>("[data-testid='tv-chat-pick']:not(:disabled)") ?? document.querySelector<HTMLElement>("[data-testid='tv-chat-pick-back']"))?.focus();
  }, [titles]);
  return (
    <Screen key="pick" testId="tv-chat-picking" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("chat.sendTitleTo", { name })}</h1>
      {titles.length === 0 ? (
        <p className="tv-lead" data-testid="tv-chat-pick-none">
          {t("chat.noTitles")}
        </p>
      ) : (
        <>
          <p className="tv-hint tv-chat-lead">{t("chat.sendTitleHelp")}</p>
          <div className="tv-chat-picks">
            {titles.map((title, at) => (
              <button
                type="button"
                key={title.address}
                className="tv-chat-pick"
                disabled={session.sending}
                onClick={() => {
                  onBack();
                  void send(session, title);
                }}
                data-nav
                {...(at === 0 ? { "data-autofocus": true } : {})}
                data-address={title.address}
                data-testid="tv-chat-pick"
              >
                <Poster className="tv-chat-pick-art" title={title.title} image={title.image} />
                <span className="tv-chat-pick-name">{title.title}</span>
                {title.year && <span className="tv-chat-pick-year">{title.year}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <BackButton onClick={onBack} testId="tv-chat-pick-back" autoFocus={titles.length === 0} />
    </Screen>
  );
}
