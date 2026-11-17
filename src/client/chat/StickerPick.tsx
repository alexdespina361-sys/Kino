import { useState } from "react";
import { checkChatText } from "../../shared";
import { Sheet } from "../controller/Sheet";
import { useT } from "../i18n";
import { ChevronLeftIcon } from "../shared/icons";
import { BackButton, Screen } from "../tv/Idle";
import { STICKERS, stickerSrc, type Sticker } from "./stickers";
import type { ChatSession } from "./useChat";

/**
 * Sending one of the chat's stickers (stickers.ts): the whole set in a grid, this site's own pictures (nobody else is asked anything, and a child's profile has
 * them too). A press sends that one at once, through the chat's own send (so what limits a message limits it too, and it is taken back as any message is), and
 * the grid closes. What was being typed stays in the box. A TV that is only a remote has them as well: the grid is walked with the arrows, OK sends.
 */

/** (As any message: the text as the server will keep it.) */
const send = async (session: ChatSession, sticker: Sticker): Promise<boolean> => {
  const checked = checkChatText(sticker.emoji);
  return checked.ok ? session.send(checked.text) : false;
};

/**
 * One sticker of the grid. While a message is on its way the grid waits (the chat sends one at a time: a press then would have been lost, with the grid shut
 * and nothing said, the judge, 17 Nov). A picture that does not come (the network went, a screen that cannot draw it) is its emoji, big, not an empty square.
 */
function StickerButton({ sticker, className, onSend, nav, first, waiting }: { sticker: Sticker; className: string; onSend: () => void; nav: boolean; first: boolean; waiting: boolean }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={onSend}
      disabled={waiting}
      aria-label={`${t("chat.sticker")}: ${sticker.emoji}`}
      {...(nav ? { "data-nav": true } : {})}
      {...(nav && first ? { "data-autofocus": true } : {})}
      data-sticker={sticker.id}
      data-testid="chat-sticker-pick"
    >
      {failed ? (
        <span className="chat-sticker-emoji" aria-hidden="true">
          {sticker.emoji}
        </span>
      ) : (
        <img src={stickerSrc(sticker)} width={192} height={192} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />
      )}
    </button>
  );
}

/** The phone's: a sheet over the chat. */
export function StickerPickSheet({ name, session, onClose }: { name: string; session: ChatSession; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={t("chat.stickerTo", { name })} onClose={onClose} testId="chat-sticker-sheet">
      <div className="chat-stickers" data-testid="chat-stickers">
        {STICKERS.map((sticker, at) => (
          <StickerButton
            key={sticker.id}
            sticker={sticker}
            className="chat-sticker-btn"
            nav={false}
            first={at === 0}
            waiting={session.sending}
            onSend={() => {
              if (session.sending) return;
              onClose();
              void send(session, sticker);
            }}
          />
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The page of a TV, a computer, or a hand-held screen showing the TV's pages: the grid the arrows walk (the remote lands on the first sticker), OK sends one and
 * goes back to the chat; Back goes back without sending anything. A hand-held screen has it as the whole screen, as the chat and the GIFs are, and lands on
 * nothing (a touch screen has no use for a ring on the first one).
 */
export function StickerPickTv({ name, session, narrow, onBack }: { name: string; session: ChatSession; narrow: boolean; onBack: () => void }) {
  const t = useT();
  const title = t("chat.stickerTo", { name });
  return (
    <Screen key="stickers" testId="tv-chat-stickers-page" compact focus={!narrow} onBack={onBack} {...(narrow ? { className: "tv-chat-screen tv-gif-screen tv-sticker-screen" } : {})}>
      {narrow ? (
        <div className="tv-gif-head">
          <button type="button" className="tv-chat-headback" onClick={onBack} aria-label={t("common.back")} title={t("common.back")} data-nav data-testid="tv-chat-sticker-back">
            <ChevronLeftIcon />
          </button>
          <h1 className="tv-sticker-title">{title}</h1>
        </div>
      ) : (
        <h1 className="tv-headline tv-headline-small">{title}</h1>
      )}
      <div className="tv-chat-sticker-list" data-testid="tv-chat-sticker-list">
        <div className="tv-chat-stickers" data-testid="tv-chat-stickers">
          {STICKERS.map((sticker, at) => (
            <StickerButton
              key={sticker.id}
              sticker={sticker}
              className="tv-chat-sticker-btn"
              nav
              first={at === 0}
              waiting={session.sending}
              onSend={() => {
                if (session.sending) return;
                onBack();
                void send(session, sticker);
              }}
            />
          ))}
        </div>
      </div>
      {!narrow && <BackButton onClick={onBack} testId="tv-chat-sticker-back" />}
    </Screen>
  );
}
