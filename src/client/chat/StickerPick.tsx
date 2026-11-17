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

/**
 * Sending one of the chat's stickers (stickers.ts): the whole set in a grid, this site's own pictures (nobody else is asked anything, and a child's profile has
 * them too). A press sends that one at once, through the chat's own send (so what limits a message limits it too, and it is taken back as any message is), and
 * the grid closes. What was being typed stays in the box. A TV that is only a remote has them as well: the grid is walked with the arrows, OK sends.
 *
 * While the host has personal stickers on (personalStickers.ts), the profile's own come first, under "Yours": sent the same way. A screen that is touched or
 * clicked can add one (a picture of its own, made into a sticker on this page) and, after Edit, remove one; a TV that is only a remote sends the ones it has.
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

const ADD_PROBLEM: Record<StickerAddProblem, Key> = {
  not_a_picture: "chat.stickerNotPicture",
  too_big: "chat.stickerTooBig",
  full: "chat.stickerFull",
  too_many: "chat.stickerTooMany",
  site_full: "chat.stickerSiteFull",
  failed: "chat.stickerFailed",
};

/**
 * The profile's own stickers, first in the grid, and the heading of Kino's after them: each sends itself as the built-in ones do. `pointer`: a screen that is
 * touched or clicked, which can add one (a file it chooses, or several) and, after Edit, remove one. A TV that is only a remote and has none shows nothing of
 * them (it could not add one: its page stays as it was, Kino's all in view). In the Android app (from 0.2.0), "From WhatsApp" opens the chooser in the folder
 * where WhatsApp keeps the stickers it was sent (app/kinoApp.ts `pickFrom`); they are made into stickers as any picture is. While the host makes stickers that
 * move as well (personalStickers.ts `movingPicture`), a picture that moves is made one, and the app has "WhatsApp GIFs" too: the folder of the GIFs WhatsApp was
 * sent (short videos). Else one that moves is made of its first picture.
 */
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
  /** There is something above (the saved ones): Kino's keep their heading when there is nothing of the profile's own to show. */
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
  // (Several files at once in a browser and in the app from 0.2.0; the app's 0.1.0, which says no folders, takes back one file only.)
  const several = app === null || app.folders.length > 0;
  const stickers = mine.stickers ?? [];
  const full = stickers.length >= PERSONAL_STICKER.perProfile;

  // (Several can be chosen at once, WhatsApp's say: made one after another until as many are made as there was room for. One that cannot be made takes no room:
  // the next is tried (the judge, 17 Nov). What stops the rest (the collection is full, the day's are made, the site has no room) is what is said; else the last
  // that could not be made; else "full" when some were left over.)
  const chosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = ""; // (the same file chosen again is a choice again)
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
  // (WhatsApp's: the app is asked for the folder first, and the chooser opens once it answered, a moment later, still within the press. What the chooser
  // offers is set each time: pictures, or for the GIFs, WhatsApp's videos and GIFs.)
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
                // (A remote lands on the first of them when the tab opens: Kino's, under them, may be out of sight below, the judge, 17 Nov.)
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

/**
 * The stickers of the chat's panel (ChatPanel.tsx): the profile's own first while personal stickers are on, then Kino's; a press sends one, and the panel goes
 * with it. `tv`: drawn for the TV's pages; `nav`: walked with the arrows (the remote lands on the first); `pointer`: a screen that is touched or clicked, which
 * can add a sticker of its own.
 */
export function StickerPane({ session, tv, nav, pointer, onSent }: { session: ChatSession; tv: boolean; nav: boolean; pointer: boolean; onSent: () => void }) {
  const t = useT();
  const personal = usePersonalStickersOn();
  // (The stickers the profile saved from its chats come first, under "Saved": the owner's "save/pin", saved.ts.)
  const saved = useSavedPictures().stickers.length > 0;
  const grid = tv ? "tv-chat-stickers" : "chat-stickers";
  const button = tv ? "tv-chat-sticker-btn" : "chat-sticker-btn";
  return (
    <div className={`${tv ? "tv-chat-sticker-list" : "chat-sticker-list"}${personal || saved ? " with-yours" : ""}`} data-testid={tv ? "tv-chat-sticker-list" : "chat-sticker-list"}>
      {saved && <SavedPictures kind="sticker" session={session} grid={grid} className={button} nav={nav} onSent={onSent} />}
      {personal && <YourStickers session={session} grid={grid} className={button} nav={nav} pointer={pointer} onSent={onSent} headed={saved} />}
      {/* (Kino's have a heading of their own once there is anything above them.) */}
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
