import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { checkChatText, CHAT_TEXT_MAX, type ChatReaction } from "../../shared";
import type { OpenTitle } from "./titles";
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
import { KEPT_NOTE, SAVED_MAX, useKeptNote } from "./saved";
import { afterSent, keepTheBox, MessageBox } from "./MessageBox";
import { useGifKey } from "./useGifs";
import { CHAT_FACTS } from "./state";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText } from "./words";
import "./chat.css";

export interface ChatPhoneProps {
  name: string;
  presence?: string | undefined;
  online?: boolean;
  session: ChatSession;
  report: ChatReport;
  receiving?: boolean;
  onClose: () => void;
  onOpenTitle?: OpenTitle | undefined;
  now?: number;
}

export function ChatPhone({ name, presence, online = false, session, report, receiving = true, onClose, onOpenTitle, now = Date.now() }: ChatPhoneProps) {
  const t = useT();
  const { state } = session;
  const [picked, setPicked] = useState<number | null>(null);
  const [panel, setPanel] = useState(false);
  const panelId = useId();
  const gifKey = useGifKey();
  const blocked = whyNotWrite(session);
  const personal = usePersonalLines(session, true);
  const [kept, sayKept] = useKeptNote();
  const [media, setMedia] = useState(false);
  const over = media || report.stage !== "closed";
  useEffect(() => {
    if (!over) return;
    setPicked(null);
    setPanel(false);
  }, [over]);
  useEffect(() => {
    if (blocked) setPanel(false);
  }, [blocked]);
  const openPanel = (open: boolean) => {
    if (open) {
      setPicked(null);
      setMenu(false);
    }
    setPanel(open);
  };
  const reply = (id: number) => {
    setPicked(null);
    session.setReplyTo(id);
    document.querySelector<HTMLElement>("[data-testid='chat-sheet'] [data-testid='chat-input']")?.focus();
  };
  const answering = session.replyTo === null ? undefined : state.lines.find((line) => line.id === session.replyTo);

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
  const search = useChatSearch(state.lines);
  const [showing, setShowing] = useState<{ id: number; seq: number } | null>(null);
  useBackFirst(search.open && !over ? () => searchBack(session, search, "chat-input") : undefined);
  const status = [presence, state.muted ? t("chat.mutedShort") : null].filter(Boolean).join("  ·  ");

  return (
    <>
      <Sheet title={t("chat.title", { name })} onClose={onClose} testId="chat-sheet">
        <div className="chat" data-panel={panel && !blocked ? "true" : undefined} data-testid="chat">
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
                gifs={gifKey !== null}
                onKept={sayKept}
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
              receipts={state}
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
          {kept && (
            <p className="chat-note" role="status" data-testid="chat-saved-note">
              {t(KEPT_NOTE[kept], { max: SAVED_MAX })}
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
              <Composer session={session} panel={panel} panelId={panelId} onPanel={openPanel} />
              {panel && (
                <ChatPanel id={panelId} session={session} tv={false} nav={false} land={false} pointer gifKey={gifKey} onClose={() => setPanel(false)} onSent={() => setPanel(false)} />
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

function Composer({ session, panel, panelId, onPanel }: { session: ChatSession; panel: boolean; panelId: string; onPanel: (open: boolean) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const input = useRef<HTMLDivElement>(null);
  const checked = checkChatText(text);
  useEffect(() => {
    if (session.replyTo !== null) input.current?.focus();
  }, [session.replyTo]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!checked.ok || session.sending) return;
    const written = text;
    if (await session.send(checked.text)) setText((now) => afterSent(now, written));
    if (!panelNow.current) input.current?.focus();
  };
  const panelNow = useRef(panel);
  useEffect(() => {
    panelNow.current = panel;
  }, [panel]);

  const toggle = () => {
    if (panel) {
      onPanel(false);
      input.current?.focus();
      return;
    }
    if (document.activeElement === input.current) input.current?.blur();
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
          aria-label={t("chat.panel")}
          aria-expanded={panel}
          aria-controls={panel ? panelId : undefined}
          title={t("chat.panel")}
          data-testid="chat-panel-btn"
        >
          {panel ? <KeyboardIcon /> : <StickerIcon />}
        </button>
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
