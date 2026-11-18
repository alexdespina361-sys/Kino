import { useRef, useState, type ChangeEvent } from "react";
import { checkChatText, PERSONAL_STICKER } from "../../shared";
import { useT, type Key } from "../i18n";
import { opensFolder, pickFrom, useKinoApp } from "../app/kinoApp";
import { MessageIcon } from "../shared/icons";
import { ownStickerSrc, useMovingStickersOn, useMyStickers, usePersonalStickersOn, type StickerAddProblem } from "./personalStickers";
import { useSavedPictures } from "./saved";
import { SavedPictures } from "./SavedPick";
import { STICKERS, stickerSrc, type Sticker } from "./stickers";
import type { ChatSession } from "./useChat";

const send = async (session: ChatSession, sticker: Sticker): Promise<boolean> => {
  const checked = checkChatText(sticker.emoji);
  return checked.ok ? session.send(checked.text) : false;
};

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

const ADD_PROBLEM: Record<StickerAddProblem, Key> = {
  not_a_picture: "chat.stickerNotPicture",
  too_big: "chat.stickerTooBig",
  full: "chat.stickerFull",
  too_many: "chat.stickerTooMany",
  site_full: "chat.stickerSiteFull",
  failed: "chat.stickerFailed",
};

function YourStickers({
  session,
  grid,
  className,
  nav,
  pointer,
  onSent,
  headed = false,
}: {
  session: ChatSession;
  grid: string;
  className: string;
  nav: boolean;
  pointer: boolean;
  onSent: () => void;
  headed?: boolean;
}) {
  const t = useT();
  const mine = useMyStickers(session.profileId, true, true);
  const file = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<StickerAddProblem | null>(null);
  const app = useKinoApp();
  const whatsapp = pointer && opensFolder(app, "whatsapp-stickers");
  const moving = useMovingStickersOn();
  const gifs = pointer && moving && opensFolder(app, "whatsapp-gifs");
  const several = app === null || app.folders.length > 0;
  const stickers = mine.stickers ?? [];
  const full = stickers.length >= PERSONAL_STICKER.perProfile;

  const chosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = "";
    if (picked.length === 0) return;
    const room = PERSONAL_STICKER.perProfile - stickers.length;
    setProblem(null);
    setAdding(true);
    try {
      let said: StickerAddProblem | null = null;
      let made = 0;
      let tried = 0;
      for (const one of picked) {
        if (made >= room) break;
        tried++;
        const problem = await mine.add(one, moving);
        if (!problem) made++;
        else said = problem;
        if (problem === "full" || problem === "too_many" || problem === "site_full") break;
      }
      setProblem(said ?? (tried < picked.length ? "full" : null));
    } finally {
      setAdding(false);
    }
  };
  const open = (from: "add" | "whatsapp-stickers" | "whatsapp-gifs") => {
    const input = file.current;
    if (!input) return;
    input.accept = from === "whatsapp-gifs" ? "video/mp4,image/gif" : "image/*";
    if (from === "add") return input.click();
    void pickFrom(from).then(() => input.click());
  };

  if (!pointer && stickers.length === 0 && mine.status !== "failed") return headed ? <h2 className="chat-stickers-head">{t("chat.stickersBuiltIn")}</h2> : null;
  return (
    <>
      <section className="chat-stickers-yours" data-testid="chat-stickers-yours">
        <div className="chat-stickers-headrow">
          <h2 className="chat-stickers-head">{t("chat.stickersYours")}</h2>
          {pointer && stickers.length > 0 && (
            <button type="button" className="chat-tool" aria-pressed={editing} onClick={() => setEditing(!editing)} {...(nav ? { "data-nav": true } : {})} data-testid="chat-stickers-edit">
              {t(editing ? "common.done" : "chat.stickersEdit")}
            </button>
          )}
        </div>
        <div className={grid} data-testid="chat-stickers-mine">
          {pointer && !editing && (
            <button
              type="button"
              className={`${className} chat-sticker-add`}
              onClick={() => open("add")}
              disabled={adding || full}
              {...(nav ? { "data-nav": true } : {})}
              data-testid="chat-sticker-add"
            >
              <span className="chat-sticker-add-plus" aria-hidden="true">
                +
              </span>
              <span>{t(adding ? "chat.stickerAdding" : "chat.stickerAdd")}</span>
            </button>
          )}
          {whatsapp && !editing && (
            <button
              type="button"
              className={`${className} chat-sticker-add`}
              onClick={() => open("whatsapp-stickers")}
              disabled={adding || full}
              {...(nav ? { "data-nav": true } : {})}
              data-testid="chat-sticker-whatsapp"
            >
              <MessageIcon className="chat-sticker-add-icon" aria-hidden="true" />
              <span>{t("chat.stickerFromWhatsApp")}</span>
            </button>
          )}
          {gifs && !editing && (
            <button
              type="button"
              className={`${className} chat-sticker-add`}
              onClick={() => open("whatsapp-gifs")}
              disabled={adding || full}
              {...(nav ? { "data-nav": true } : {})}
              data-testid="chat-sticker-whatsapp-gifs"
            >
              <span className="chat-sticker-add-gif" aria-hidden="true">
                GIF
              </span>
              <span>{t("chat.stickerWhatsAppGifs")}</span>
            </button>
          )}
          {stickers.map((sticker, at) => (
            <span className="chat-sticker-mine" key={sticker.id}>
              <button
                type="button"
                className={className}
                onClick={() => {
                  if (editing) return;
                  if (session.sending) return;
                  onSent();
                  void session.sendSticker(sticker.id);
                }}
                disabled={session.sending || editing}
                aria-label={t(sticker.mine ? "chat.stickerYours" : "chat.stickerSavedOne")}
                {...(nav && !editing ? { "data-nav": true } : {})}
                {...(nav && !editing && at === 0 ? { "data-autofocus": true } : {})}
                data-personal={sticker.id}
                data-testid="chat-sticker-mine"
              >
                <img src={ownStickerSrc(session.profileId, sticker.id)} width={192} height={192} alt="" loading="lazy" decoding="async" draggable={false} />
              </button>
              {editing && (
                <button
                  type="button"
                  className="chat-sticker-remove"
                  onClick={() => void mine.remove(sticker.id).then(() => stickers.length <= 1 && setEditing(false))}
                  aria-label={t("chat.stickerRemove")}
                  title={t("chat.stickerRemove")}
                  {...(nav ? { "data-nav": true } : {})}
                  data-testid="chat-sticker-remove"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {pointer && <input ref={file} type="file" accept="image/*" multiple={several} hidden onChange={(event) => void chosen(event)} data-testid="chat-sticker-file" />}
        {problem ? (
          <p className="chat-note" role="alert" data-testid="chat-sticker-problem">
            {t(ADD_PROBLEM[problem])}
          </p>
        ) : mine.status === "failed" ? (
          <p className="chat-note" role="status">
            {t("chat.stickersFailed")}{" "}
            <button type="button" className="chat-tool" onClick={mine.retry} {...(nav ? { "data-nav": true } : {})}>
              {t("common.retry")}
            </button>
          </p>
        ) : (
          mine.status === "ready" &&
          stickers.length === 0 && (
            <p className="chat-note" data-testid="chat-stickers-none">
              {t("chat.stickersNone")}
            </p>
          )
        )}
        {pointer && <p className="chat-privacy">{t("chat.stickersPrivacy")}</p>}
      </section>
      <h2 className="chat-stickers-head">{t("chat.stickersBuiltIn")}</h2>
    </>
  );
}

export function StickerPane({ session, tv, nav, pointer, onSent }: { session: ChatSession; tv: boolean; nav: boolean; pointer: boolean; onSent: () => void }) {
  const t = useT();
  const personal = usePersonalStickersOn();
  const saved = useSavedPictures().stickers.length > 0;
  const grid = tv ? "tv-chat-stickers" : "chat-stickers";
  const button = tv ? "tv-chat-sticker-btn" : "chat-sticker-btn";
  return (
    <div className={`${tv ? "tv-chat-sticker-list" : "chat-sticker-list"}${personal || saved ? " with-yours" : ""}`} data-testid={tv ? "tv-chat-sticker-list" : "chat-sticker-list"}>
      {saved && <SavedPictures kind="sticker" session={session} grid={grid} className={button} nav={nav} onSent={onSent} />}
      {personal && <YourStickers session={session} grid={grid} className={button} nav={nav} pointer={pointer} onSent={onSent} headed={saved} />}
      {!personal && saved && <h2 className="chat-stickers-head">{t("chat.stickersBuiltIn")}</h2>}
      <div className={grid} data-testid={grid}>
        {STICKERS.map((sticker, at) => (
          <StickerButton
            key={sticker.id}
            sticker={sticker}
            className={button}
            nav={nav}
            first={at === 0}
            waiting={session.sending}
            onSend={() => {
              if (session.sending) return;
              onSent();
              void send(session, sticker);
            }}
          />
        ))}
      </div>
    </div>
  );
}
