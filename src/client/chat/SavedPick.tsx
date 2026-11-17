import { useLayoutEffect, useRef, useState } from "react";
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

function SavedButton({
  picture,
  className,
  nav,
  first,
  editing,
  waiting,
  onSend,
  onGone,
}: {
  picture: SavedPicture;
  className: string;
  nav: boolean;
  /** The first of the stickers: where a remote lands when the tab opens (the grid of Kino's under it may be out of sight below, the judge, 17 Nov). */
  first: boolean;
  editing: boolean;
  waiting: boolean;
  onSend: () => void;
  /** It is about to be one that cannot be pressed (the GIF did not come): the keys, if they are on it, are to go elsewhere first. */
  onGone: (button: HTMLButtonElement) => void;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // (A GIF that does not come any more is not sent: the friend would be sent a picture that is not there.)
  const gone = failed && picture.kind === "gif";
  const label = picture.kind === "gif" ? t(gone ? "chat.gifGone" : "chat.gif") : `${t("chat.sticker")}: ${picture.sticker.emoji}`;
  const fail = () => {
    if (picture.kind === "gif" && button.current) onGone(button.current);
    setFailed(true);
  };
  return (
    <button
      type="button"
      ref={button}
      className={className}
      onClick={onSend}
      disabled={waiting || editing || gone}
      aria-label={label}
      {...(nav && !editing && !gone ? { "data-nav": true } : {})}
      {...(nav && first && !editing && !gone ? { "data-autofocus": true } : {})}
      data-saved={picture.key}
      data-testid="chat-saved-pick"
    >
      {picture.kind === "gif" ? (
        gone ? (
          <span className="chat-saved-gone" aria-hidden="true">
            GIF
          </span>
        ) : (
          <img src={picture.text} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={fail} />
        )
      ) : failed ? (
        <span className="chat-sticker-emoji" aria-hidden="true">
          {picture.sticker.emoji}
        </span>
      ) : (
        <img src={stickerSrc(picture.sticker)} width={192} height={192} alt="" decoding="async" draggable={false} onError={fail} />
      )}
    </button>
  );
}

/** What the arrows stop on in `within`, in order. */
const stopsIn = (within: Element | null | undefined): HTMLElement[] => [...(within?.querySelectorAll<HTMLElement>("[data-nav]:not(:disabled)") ?? [])];

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
  /** While the keys are in this section (TV and computer pages): which of its stops they are on, and the pane it is in. */
  const held = useRef<{ at: number; pane: HTMLElement } | null>(null);

  /**
   * The keys go to the stop now at `at` in this section (else the last), or, when none is left, to the first of the pane under it. They are moved before what
   * they were on goes: a stop taken away with the keys on it leaves them nowhere for a moment, and the page under the chat takes them then, as it does when a
   * title goes from under the remote (tv/Browse.tsx). A screen only touched keeps no focus: nothing is moved, which would bring a phone's keyboard up in the
   * GIF search.
   */
  const rescue = (at: number, without: HTMLElement | null, pane: HTMLElement | null | undefined) => {
    const here = stopsIn(section.current).filter((each) => each !== without);
    const after = stopsIn(pane).filter((each) => each !== without && !section.current?.contains(each));
    (here[Math.min(at, here.length - 1)] ?? after[0])?.focus();
  };

  // (Let go here, with the keys on its cross: they go to the cross that takes its place, else the one before it, else under the section.)
  const letGo = (picture: SavedPicture, at: number, cross: HTMLElement) => {
    if (nav && document.activeElement === cross && section.current) {
      const crosses = [...section.current.querySelectorAll<HTMLElement>("[data-testid='chat-saved-remove']")].filter((each) => each !== cross);
      const after = stopsIn(section.current.parentElement).filter((each) => !section.current?.contains(each));
      (crosses[Math.min(at, crosses.length - 1)] ?? after[0])?.focus();
    }
    saved.keep(picture, false);
    if (pictures.length <= 1) setEditing(false);
  };

  // (Let go elsewhere, on another screen of the profile, with the keys on it here: by then it is gone, and they are on nothing. They go where they would have.)
  useLayoutEffect(() => {
    const was = held.current;
    if (!nav || !was) return;
    const on = document.activeElement;
    if (on && on !== document.body && on.isConnected) return;
    held.current = null;
    rescue(was.at, null, was.pane);
  }, [pictures]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pictures.length === 0) return null;

  return (
    <section
      className="chat-saved"
      ref={section}
      data-testid={`chat-saved-${kind}s`}
      onFocus={(event) => {
        const pane = section.current?.parentElement;
        if (nav && pane) held.current = { at: Math.max(0, stopsIn(section.current).indexOf(event.target as HTMLElement)), pane };
      }}
      onBlur={(event) => {
        // (To somewhere else: they are not here. To nothing: perhaps what they were on went; the effect above will know.)
        if (event.relatedTarget instanceof Node && !section.current?.contains(event.relatedTarget)) held.current = null;
      }}
    >
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
              first={kind === "sticker" && at === 0}
              editing={editing}
              waiting={session.sending}
              onSend={() => {
                if (session.sending || editing) return;
                onSent();
                void send(session, picture);
              }}
              onGone={(button) => {
                if (nav && document.activeElement === button) rescue(stopsIn(section.current).indexOf(button), button, section.current?.parentElement);
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
