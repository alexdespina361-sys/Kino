import { useRef, useState } from "react";
import { checkChatText } from "../../shared";
import { useT } from "../i18n";
import { type SavedPicture, useSavedPictures } from "./saved";
import { stickerSrc } from "./stickers";
import type { ChatSession } from "./useChat";

/**
 * The pictures the profile saved from its chats (saved.ts), at the top of their tab in the chat's panel: "Saved", the one saved last first. A press sends
 * one at once, as the grid under it does (and the panel goes with it). After Edit, a cross on each lets it go; one that cannot be shown any more (KLIPY took
 * the GIF away) is still let go that way. A remote walks it as the grid under it, the crosses too.
 */

/** (As any message: the text as the server will keep it.) */
const send = async (session: ChatSession, picture: SavedPicture): Promise<boolean> => {
  const checked = checkChatText(picture.text);
  return checked.ok ? session.send(checked.text) : false;
};

function SavedButton({ picture, className, nav, editing, waiting, onSend }: { picture: SavedPicture; className: string; nav: boolean; editing: boolean; waiting: boolean; onSend: () => void }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  // (A GIF that does not come any more is not sent: the friend would be sent a picture that is not there.)
  const gone = failed && picture.kind === "gif";
  const label = picture.kind === "gif" ? t(gone ? "chat.gifGone" : "chat.gif") : `${t("chat.sticker")}: ${picture.sticker.emoji}`;
  return (
    <button
      type="button"
      className={className}
      onClick={onSend}
      disabled={waiting || editing || gone}
      aria-label={label}
      {...(nav && !editing && !gone ? { "data-nav": true } : {})}
      data-saved={picture.key}
      data-testid="chat-saved-pick"
    >
      {picture.kind === "gif" ? (
        gone ? (
          <span className="chat-saved-gone" aria-hidden="true">
            GIF
          </span>
        ) : (
          <img src={picture.text} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
        )
      ) : failed ? (
        <span className="chat-sticker-emoji" aria-hidden="true">
          {picture.sticker.emoji}
        </span>
      ) : (
        <img src={stickerSrc(picture.sticker)} width={192} height={192} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />
      )}
    </button>
  );
}

/**
 * The saved GIFs (`kind` "gif") or stickers of the panel, with their heading and Edit; nothing when there are none. `grid` and `className` are the classes of the
 * grid under it and of its buttons, so that the two look alike; `nav`: walked with the arrows.
 */
export function SavedPictures({ kind, session, grid, className, nav, onSent }: { kind: "gif" | "sticker"; session: ChatSession; grid: string; className: string; nav: boolean; onSent: () => void }) {
  const t = useT();
  const saved = useSavedPictures();
  const pictures = kind === "gif" ? saved.gifs : saved.stickers;
  const [editing, setEditing] = useState(false);
  const section = useRef<HTMLElement>(null);
  if (pictures.length === 0) return null;

  // (The keys stay near where they were when one is let go: on the cross that takes its place, else the one before it; when none is left, on the first thing
  // of the pane under the saved ones. They are moved first, while the cross is still there: a cross taken away with the keys on it leaves them nowhere for a
  // moment, and the page under the chat takes them then, as it does when a title goes from under the remote (tv/Browse.tsx). A screen only touched keeps no
  // focus: nothing is moved, which would bring a phone's keyboard up in the GIF search.)
  const letGo = (picture: SavedPicture, at: number, cross: HTMLElement) => {
    if (nav && document.activeElement === cross && section.current) {
      const crosses = [...section.current.querySelectorAll<HTMLElement>("[data-testid='chat-saved-remove']")].filter((each) => each !== cross);
      const after = [...(section.current.parentElement?.querySelectorAll<HTMLElement>("[data-nav]:not(:disabled)") ?? [])].filter((each) => !section.current?.contains(each));
      (crosses[Math.min(at, crosses.length - 1)] ?? after[0])?.focus();
    }
    saved.keep(picture, false);
    if (pictures.length <= 1) setEditing(false);
  };

  return (
    <section className="chat-saved" ref={section} data-testid={`chat-saved-${kind}s`}>
      <div className="chat-stickers-headrow">
        <h2 className="chat-stickers-head">{t("chat.saved")}</h2>
        <button type="button" className="chat-tool" aria-pressed={editing} onClick={() => setEditing(!editing)} {...(nav ? { "data-nav": true } : {})} data-testid="chat-saved-edit">
          {t(editing ? "common.done" : "chat.stickersEdit")}
        </button>
      </div>
      <div className={grid} data-testid="chat-saved-grid">
        {pictures.map((picture, at) => (
          <span className="chat-saved-one" key={picture.key}>
            <SavedButton
              picture={picture}
              className={className}
              nav={nav}
              editing={editing}
              waiting={session.sending}
              onSend={() => {
                if (session.sending || editing) return;
                onSent();
                void send(session, picture);
              }}
            />
            {editing && (
              <button
                type="button"
                className="chat-sticker-remove"
                onClick={(event) => letGo(picture, at, event.currentTarget)}
                aria-label={t("chat.savedRemove")}
                title={t("chat.savedRemove")}
                {...(nav ? { "data-nav": true } : {})}
                data-testid="chat-saved-remove"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}
