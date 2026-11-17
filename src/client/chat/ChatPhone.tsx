import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkChatText, CHAT_TEXT_MAX, type ChatReaction, type LibraryItem } from "../../shared";
import { Sheet } from "../controller/Sheet";
import { useT } from "../i18n";
import { BellIcon, BellOffIcon, ImageIcon, KeyboardIcon, MoreIcon, SearchIcon, SendIcon, ShieldIcon, StickerIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { ChatLines, PickedActions, type PersonalLines } from "./ChatLines";
import { ChatMediaSheet } from "./ChatMedia";
import { ChatPanel } from "./ChatPanel";
import { ChatSearchBar, searchBack, useChatSearch } from "./ChatSearch";
import { useShutOnPressBeside } from "./pressBeside";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { backLetsAnswerGo, ReplyStrip } from "./Reply";
import { SAVE_NOTE, usePersonalLines } from "./personalStickers";
import { afterSent, keepTheBox, MessageBox } from "./MessageBox";
import { useGifKey } from "./useGifs";
import { CHAT_FACTS } from "./state";
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
 * in; on top, when the friend was last online and the ⋮ (Search, the chat's GIFs and stickers, Mute, Report). A message can be pressed: under it come the
 * reactions (Reactions.tsx), and, for one's own, Take back. The sheet closes with the phone's Back, like the others.
 */
export function ChatPhone({ name, presence, online = false, session, report, receiving = true, onClose, onOpenTitle, now = Date.now() }: ChatPhoneProps) {
  const t = useT();
  const { state } = session;
  const [picked, setPicked] = useState<number | null>(null);
  /** The panel of titles, GIFs and stickers is open under the box (ChatPanel.tsx); its GIFs only when the site has a KLIPY key. */
  const [panel, setPanel] = useState(false);
  const gifKey = useGifKey();
  const blocked = whyNotWrite(session);
  const personal = usePersonalLines(session, true);
  // (A sheet over the chat - the gallery, a report - lets the selection go: else Escape would let it go behind the sheet before shutting the sheet, the
  // judge, 17 Nov.)
  /** The sheet of the chat's GIFs and stickers is open (ChatMedia.tsx). */
  const [media, setMedia] = useState(false);
  const over = media || report.stage !== "closed";
  useEffect(() => {
    if (over) setPicked(null);
  }, [over]);
  // (A chat one can no longer write in has no panel to send from, and it does not come back by itself when one can again.)
  useEffect(() => {
    if (blocked) setPanel(false);
  }, [blocked]);
  /** The panel opens with nothing selected and the ⋮ shut (Back then shuts the panel, not those), and the keyboard goes down: the panel is in its place. */
  const openPanel = (open: boolean) => {
    if (open) {
      setPicked(null);
      setMenu(false);
    }
    setPanel(open);
  };
  // (Answering a message: Reply at the top, or the message drawn to the right. The selection goes, and the box is where the answer is written.)
  const reply = (id: number) => {
    setPicked(null);
    session.setReplyTo(id);
    // (The keyboard comes up each time, the same message answered again too, after it went down: the judge, 17 Nov.)
    document.querySelector<HTMLElement>("[data-testid='chat-sheet'] [data-testid='chat-input']")?.focus();
  };
  const answering = session.replyTo === null ? undefined : state.lines.find((line) => line.id === session.replyTo);

  // The ⋮ at the top (the owner, 17 Nov: "the three dots vertical"): Search, the chat's GIFs and stickers, Mute, Report. It shuts with Back, a press beside
  // it, or a choice; a message selected shuts it (one Back would otherwise shut both).
  const [menu, setMenu] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked !== null || over) setMenu(false);
  }, [picked, over]);
  useBackFirst(menu ? () => setMenu(false) : undefined);
  useShutOnPressBeside(menu, moreWrap, () => setMenu(false));
  const choose = (action: () => void) => () => {
    setMenu(false);
    action();
  };
  // The search, in place of the buttons at the top while it is open; the gallery, a sheet over the chat.
  const search = useChatSearch(state.lines);
  const [showing, setShowing] = useState<{ id: number; seq: number } | null>(null);
  // (Back shuts the search when nothing is open over it: a selection, the ⋮, a sheet, or a picture shown larger - each of which Back shuts first.)
  useBackFirst(search.open && picked === null && !menu && !over ? () => searchBack(session, search, "chat-input") : undefined);
  const status = [presence, state.muted ? t("chat.mutedShort") : null].filter(Boolean).join("  ·  ");

  return (
    <>
      <Sheet title={t("chat.title", { name })} onClose={onClose} testId="chat-sheet">
        <div className="chat" data-panel={panel && !blocked ? "true" : undefined} data-testid="chat">
          {/* (One row at the top: when they were last online, or the search while it is open; what can be done with the message selected; the ⋮.) */}
          <div className="chat-tools" data-searching={search.open ? "true" : undefined}>
            {search.open ? (
              <ChatSearchBar query={search.query} onQuery={search.setQuery} count={search.ids.length} at={search.at} onStep={search.step} onClose={search.close} />
            ) : status ? (
              <p className="chat-presence" data-online={online} data-testid="chat-presence">
                {status}
              </p>
            ) : (
              <span className="chat-presence" aria-hidden="true" />
            )}
            {/* (What can be done with the message that is selected, at the top and not under it, as in any messenger: the owner, 17 Nov.) */}
            <span className="chat-tools-picked">
              <PickedActions
                line={picked === null ? undefined : state.lines.find((line) => line.id === picked)}
                personal={personal.lines}
                {...(blocked ? {} : { onReply: reply })}
                onTakeBack={(id) => {
                  setPicked(null);
                  void session.takeBack(id);
                }}
                onSaved={() => setPicked(null)}
                className="chat-tool"
              />
            </span>
            {!search.open && (
            <div
              className="chat-more-wrap"
              ref={moreWrap}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(false);
              }}
            >
              <button
                type="button"
                className="chat-tool chat-more"
                aria-label={t("chat.menu")}
                title={t("chat.menu")}
                aria-expanded={menu}
                aria-haspopup="menu"
                onClick={() => {
                  if (!menu) setPicked(null);
                  setMenu(!menu);
                }}
                data-testid="chat-more"
              >
                <MoreIcon />
              </button>
              {/* (There all along, and hidden: nothing in it is pressed, or reached with Tab, until the ⋮ opens it.) */}
              <div className="chat-menu" role="menu" hidden={!menu} data-testid="chat-menu">
                <button type="button" role="menuitem" onClick={choose(search.start)} data-testid="chat-search-open">
                  <SearchIcon /> {t("chat.search")}
                </button>
                <button type="button" role="menuitem" onClick={choose(() => setMedia(true))} data-testid="chat-media-open">
                  <ImageIcon /> {t("chat.media")}
                </button>
                <button type="button" role="menuitem" aria-pressed={state.muted} onClick={choose(() => void session.setMuted(!state.muted))} data-testid="chat-mute">
                  {state.muted ? <BellIcon /> : <BellOffIcon />} {t(state.muted ? "chat.unmute" : "chat.mute")}
                </button>
                <button type="button" role="menuitem" onClick={choose(report.start)} data-testid="chat-report">
                  <ShieldIcon /> {t("chat.report")}
                </button>
              </div>
            </div>
            )}
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
              {...(blocked ? {} : { onReact: (id: number, reaction: ChatReaction | null) => void session.react(id, reaction), onReply: reply })}
              onOpenTitle={onOpenTitle}
              personal={personal.lines}
              found={search.found}
              showing={showing}
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
            <>
              {answering && <ReplyStrip line={answering} name={name} onCancel={() => session.setReplyTo(null)} />}
              <Composer session={session} panel={panel} onPanel={openPanel} />
              {panel && (
                <ChatPanel session={session} tv={false} nav={false} land={false} pointer gifKey={gifKey} onClose={() => setPanel(false)} onSent={() => setPanel(false)} />
              )}
            </>
          )}
        </div>
      </Sheet>
      {report.stage !== "closed" && <ChatReportSheet name={name} report={report} now={now} personal={personal.lines} />}
      {media && (
        <ChatMediaSheet
          lines={state.lines}
          name={name}
          now={now}
          personal={personal.lines}
          onShow={(id) => setShowing((was) => ({ id, seq: (was?.seq ?? 0) + 1 }))}
          onClose={() => setMedia(false)}
        />
      )}
    </>
  );
}

/**
 * The box a message is written in, and the button that sends it. Enter sends too. What is sent is the text as the server will keep it. Before the box in its
 * bar, the one button of what is sent besides words (ChatPanel.tsx): pressed, the keyboard goes down and the panel comes in its place, and the button is a
 * keyboard; pressed again (or the box pressed), the keyboard is back and the panel goes.
 */
function Composer({ session, panel, onPanel }: { session: ChatSession; panel: boolean; onPanel: (open: boolean) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const input = useRef<HTMLDivElement>(null);
  const checked = checkChatText(text);
  // (A message to answer was picked: the answer is written in the box, which has the keyboard at once, as in any messenger.)
  useEffect(() => {
    if (session.replyTo !== null) input.current?.focus();
  }, [session.replyTo]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!checked.ok || session.sending) return;
    const written = text;
    // (Only what was sent leaves the box: what was typed while the message was on its way is the next one. A slow connection is seconds of typing.)
    if (await session.send(checked.text)) setText((now) => afterSent(now, written));
    // (The keyboard stays up: the next message is what comes next. But a panel opened while it was on its way stays: the box given the keyboard would
    // shut it.)
    if (!panelNow.current) input.current?.focus();
  };
  /** Whether the panel is open now: what a send that was on its way finds when it is done. */
  const panelNow = useRef(panel);
  useEffect(() => {
    panelNow.current = panel;
  }, [panel]);

  // (One bar, the one button in it before the box: the words have the rest of the bar. The owner, 17 Nov: three round buttons left the box a few words wide,
  // and then "instead of three distinct buttons in the chat, it should only be 1 icon".)
  const toggle = () => {
    if (panel) {
      onPanel(false);
      input.current?.focus(); // (the keyboard comes back in the panel's place)
      return;
    }
    if (document.activeElement === input.current) input.current?.blur(); // (the keyboard goes down: the panel is in its place)
    onPanel(true);
  };
  return (
    <form
      className="chat-compose"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => backLetsAnswerGo(event, session.replyTo !== null, () => session.setReplyTo(null), "chat-input")}
      noValidate
      data-testid="chat-compose"
    >
      <div className="chat-pill" data-testid="chat-pill">
        <button
          type="button"
          className="chat-title-btn chat-panel-btn"
          onClick={toggle}
          aria-label={t(panel ? "chat.panelKeyboard" : "chat.panel")}
          aria-expanded={panel}
          title={t(panel ? "chat.panelKeyboard" : "chat.panel")}
          data-testid="chat-panel-btn"
        >
          {panel ? <KeyboardIcon /> : <StickerIcon />}
        </button>
        {/* (An editable area, not a form field: Chrome on a phone puts the strip of its form filler over a form field, see MessageBox.tsx.) */}
        <MessageBox
          ref={input}
          className="chat-input"
          value={text}
          onChange={(now) => {
            setText(now);
            session.settle();
          }}
          onSend={() => void submit()}
          maxLength={CHAT_TEXT_MAX}
          placeholder={t("chat.placeholder")}
          label={t("chat.messageLabel")}
          testId="chat-input"
          onFocused={() => onPanel(false)}
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
