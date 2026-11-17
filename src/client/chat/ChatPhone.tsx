import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkChatText, CHAT_TEXT_MAX, type ChatReaction, type LibraryItem } from "../../shared";
import { Sheet } from "../controller/Sheet";
import { useT } from "../i18n";
import { FilmIcon, GifIcon, PlusIcon, SendIcon, ShieldIcon, StickerIcon } from "../shared/icons";
import { ChatLines, PickedActions, type PersonalLines } from "./ChatLines";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { GifPickSheet } from "./GifPick";
import { SAVE_NOTE, usePersonalLines } from "./personalStickers";
import { StickerPickSheet } from "./StickerPick";
import { afterSent, keepTheBox, MessageBox, useUnfold } from "./MessageBox";
import { useGifKey } from "./useGifs";
import { CHAT_FACTS } from "./state";
import { TitlePickSheet } from "./TitlePick";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText } from "./words";
import "./chat.css";

export interface ChatPhoneProps {
  /** The friend, as friends see them. */
  name: string;
  /** Whether they are online, else when they last were ("Last online 5 minutes ago", see `presenceLine`): a line at the top of the chat. Empty: none. */
  presence?: string | undefined;
  online?: boolean;
  session: ChatSession;
  report: ChatReport;
  /** Whether this profile takes messages from friends (the setting "Friends can message me"). When it does not, the friend can't answer, and the page says so. */
  receiving?: boolean;
  onClose: () => void;
  /** A title a message names was pressed (see titles.ts). */
  onOpenTitle?: ((item: LibraryItem) => void) | undefined;
  /** The time that "today" is measured against (tests give theirs). */
  now?: number;
}

/**
 * The chat with one friend, on the phone: a sheet over the friend's page. The messages, with a line for who they are from and when; a box to write
 * in; Mute and Report on top. A message can be pressed: under it come the six reactions (Reactions.tsx), and, for one's own, Take back. The sheet closes with
 * the phone's Back, like the others.
 */
export function ChatPhone({ name, presence, online = false, session, report, receiving = true, onClose, onOpenTitle, now = Date.now() }: ChatPhoneProps) {
  const t = useT();
  const { state } = session;
  const [picked, setPicked] = useState<number | null>(null);
  /** The sheet of titles to send is open. */
  const [picking, setPicking] = useState(false);
  /** The sheet of GIFs is open (GifPick.tsx): there only when the site has a KLIPY key. */
  const [gifPicking, setGifPicking] = useState(false);
  const gifKey = useGifKey();
  /** The sheet of stickers is open (StickerPick.tsx). */
  const [stickerPicking, setStickerPicking] = useState(false);
  const blocked = whyNotWrite(session);
  const personal = usePersonalLines(session, true);
  // (A sheet over the chat - the titles, the GIFs, the stickers, a report - lets the selection go: else Escape would let it go behind the sheet before
  // shutting the sheet, the judge, 17 Nov.)
  const over = picking || gifPicking || stickerPicking || report.stage !== "closed";
  useEffect(() => {
    if (over) setPicked(null);
  }, [over]);

  return (
    <>
      <Sheet title={t("chat.title", { name })} onClose={onClose} testId="chat-sheet">
        <div className="chat" data-testid="chat">
          {presence && (
            <p className="chat-presence" data-online={online} data-testid="chat-presence">
              {presence}
            </p>
          )}
          <div className="chat-tools">
            <button type="button" className="chat-tool" aria-pressed={state.muted} onClick={() => void session.setMuted(!state.muted)} data-testid="chat-mute">
              {t(state.muted ? "chat.unmute" : "chat.mute")}
            </button>
            <button type="button" className="chat-tool" onClick={report.start} data-testid="chat-report">
              <ShieldIcon /> {t("chat.report")}
            </button>
            {/* (What can be done with the message that is selected, at the top and not under it, as in any messenger: the owner, 17 Nov.) */}
            <span className="chat-tools-picked">
              <PickedActions
                line={picked === null ? undefined : state.lines.find((line) => line.id === picked)}
                personal={personal.lines}
                onTakeBack={(id) => {
                  setPicked(null);
                  void session.takeBack(id);
                }}
                onSaved={() => setPicked(null)}
                className="chat-tool"
              />
            </span>
          </div>

          {!session.loaded && !session.ended ? (
            <p className="chat-note" role="status" data-testid="chat-loading">
              {t("common.loading")}
            </p>
          ) : state.lines.length === 0 ? (
            <div className="chat-empty" data-testid="chat-empty">
              <p>{t("chat.empty", { name })}</p>
              <p className="chat-privacy" data-testid="chat-privacy">
                {t("chat.privacy", CHAT_FACTS)}
              </p>
            </div>
          ) : (
            <ChatLines
              lines={state.lines}
              name={name}
              now={now}
              picked={picked}
              onPick={setPicked}
              {...(blocked ? {} : { onReact: (id: number, reaction: ChatReaction | null) => void session.react(id, reaction) })}
              onOpenTitle={onOpenTitle}
              personal={personal.lines}
            />
          )}
          {personal.note && (
            <p className="chat-note" role="status" data-testid="chat-sticker-note">
              {t(SAVE_NOTE[personal.note])}
            </p>
          )}

          <ChatNotices name={name} session={session} receiving={receiving} prefix="chat" />

          {blocked ? (
            <p className="chat-closed" data-testid={blocked === "ended" ? "chat-ended" : "chat-closed"}>
              {blocked === "ended" && session.ended ? problemText(t, session.ended, name) : t("chat.closed", { name })}
            </p>
          ) : (
            <Composer session={session} onPickTitle={() => setPicking(true)} {...(gifKey ? { onPickGif: () => setGifPicking(true) } : {})} onPickSticker={() => setStickerPicking(true)} />
          )}
        </div>
      </Sheet>
      {picking && !blocked && <TitlePickSheet name={name} session={session} onClose={() => setPicking(false)} />}
      {gifPicking && gifKey && !blocked && <GifPickSheet name={name} gifKey={gifKey} session={session} onClose={() => setGifPicking(false)} />}
      {stickerPicking && !blocked && <StickerPickSheet name={name} session={session} onClose={() => setStickerPicking(false)} />}
      {report.stage !== "closed" && <ChatReportSheet name={name} report={report} now={now} personal={personal.lines} />}
    </>
  );
}

/** The box a message is written in, and the button that sends it. Enter sends too. What is sent is the text as the server will keep it. Beside the box, the button that sends a title instead (see TitlePick.tsx). */
function Composer({ session, onPickTitle, onPickGif, onPickSticker }: { session: ChatSession; onPickTitle: () => void; onPickGif?: () => void; onPickSticker: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  /** Whether the buttons that send something else are shown while something is typed (the + was pressed). */
  const [tools, setTools] = useState(false);
  useEffect(() => {
    if (text === "") setTools(false);
  }, [text]);
  const unfold = useUnfold(tools, () => setTools(true));
  const input = useRef<HTMLDivElement>(null);
  const checked = checkChatText(text);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!checked.ok || session.sending) return;
    const written = text;
    // (Only what was sent leaves the box: what was typed while the message was on its way is the next one. A slow connection is seconds of typing.)
    if (await session.send(checked.text)) setText((now) => afterSent(now, written));
    input.current?.focus(); // (the keyboard stays up: the next message is what comes next)
  };

  // (One bar: the buttons that send something else are in it, before the box. While something is typed they fold into one +, and the words have the bar
  // to themselves; a press of the + brings them back, and typing on folds them again. The owner, 17 Nov: three round buttons left the box a few words wide.)
  const folded = text !== "" && !tools;
  return (
    <form className="chat-compose" onSubmit={(event) => void submit(event)} noValidate data-testid="chat-compose">
      <div className="chat-pill" ref={unfold.bar} data-testid="chat-pill">
        {folded ? (
          <button
            type="button"
            className="chat-title-btn"
            onClick={unfold.press}
            onMouseDown={keepTheBox}
            aria-label={t("chat.moreToSend")}
            aria-expanded={false}
            title={t("chat.moreToSend")}
            data-testid="chat-tools"
          >
            <PlusIcon />
          </button>
        ) : (
          <>
            <button type="button" className="chat-title-btn" onClick={onPickTitle} aria-label={t("chat.sendTitle")} title={t("chat.sendTitle")} data-testid="chat-title-btn">
              <FilmIcon />
            </button>
            {onPickGif && (
              <button type="button" className="chat-title-btn chat-gif-btn" onClick={onPickGif} aria-label={t("chat.gif")} title={t("chat.gif")} data-testid="chat-gif-btn">
                <GifIcon />
              </button>
            )}
            <button type="button" className="chat-title-btn chat-sticker-open" onClick={onPickSticker} aria-label={t("chat.sticker")} title={t("chat.sticker")} data-testid="chat-sticker-btn">
              <StickerIcon />
            </button>
          </>
        )}
        {/* (An editable area, not a form field: Chrome on a phone puts the strip of its form filler over a form field, see MessageBox.tsx.) */}
        <MessageBox
          ref={input}
          className="chat-input"
          value={text}
          onChange={(now) => {
            setText(now);
            setTools(false);
            session.settle();
          }}
          onSend={() => void submit()}
          maxLength={CHAT_TEXT_MAX}
          placeholder={t("chat.placeholder")}
          label={t("chat.messageLabel")}
          testId="chat-input"
        />
      </div>
      <button type="submit" className="chat-send" disabled={!checked.ok || session.sending} aria-label={t("chat.send")} onMouseDown={keepTheBox} data-testid="chat-send">
        <SendIcon />
      </button>
    </form>
  );
}

/** What a report would hold, shown in full, and the one button that sends it. Nothing is sent before the button. */
export function ChatReportSheet({ name, report, now, personal }: { name: string; report: ChatReport; now: number; personal?: PersonalLines | undefined }) {
  const t = useT();
  const lines = report.preview?.lines ?? [];
  const sent = report.stage === "sent";
  return (
    <Sheet title={t("chat.reportTitle")} onClose={report.cancel} testId="chat-report-sheet">
      {sent ? (
        <>
          <p className="chat-note" role="status" data-testid="chat-report-sent">
            {t("chat.reportSent")}
          </p>
          <button type="button" className="btn btn-red btn-block" onClick={report.cancel} data-testid="chat-report-done">
            {t("common.done")}
          </button>
        </>
      ) : (
        <>
          <p className="muted">{t("chat.reportLead", { name })}</p>
          {report.stage === "loading" ? (
            <p className="chat-note" role="status" data-testid="chat-report-loading">
              {t("common.loading")}
            </p>
          ) : report.preview && lines.length === 0 ? (
            <p className="chat-note" data-testid="chat-report-none">
              {t("chat.reportNone")}
            </p>
          ) : (
            lines.length > 0 && <ChatLines lines={lines} name={name} now={now} showWriter personal={personal && { src: personal.src }} testId="chat-report-lines" />
          )}
          {report.problem && (
            <p className="chat-problem" role="alert" data-testid="chat-report-problem">
              {problemText(t, report.problem, name, true)}
            </p>
          )}
          <button type="button" className="btn btn-red btn-block" disabled={report.stage !== "preview" || lines.length === 0} onClick={report.confirm} data-testid="chat-report-send">
            {t("chat.reportSend")}
          </button>
        </>
      )}
    </Sheet>
  );
}
