import { useEffect, useState, type FormEvent } from "react";
import { checkChatText, CHAT_TEXT_MAX } from "../../shared";
import { useT } from "../i18n";
import { MessageIcon, ShieldIcon, TrashIcon } from "../shared/icons";
import { BackButton, Screen } from "../tv/Idle";
import { appendTo } from "../tv/librarySearch";
import { NameKeys } from "../tv/NameKeys";
import { ChatLines } from "./ChatLines";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { CHAT_FACTS, lastOwn } from "./state";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText } from "./words";
import "./chat.css";

/** The marks a message can use besides letters and digits, on keys of the page (six: with the letters of Romanian or Italian they still fit in four rows). */
const MARKS = [".", ",", "!", "?", "'", "-"];

export interface ChatTvProps {
  /** The friend, as friends see them. */
  name: string;
  session: ChatSession;
  report: ChatReport;
  /** Whether this profile takes messages from friends (the setting "Friends can message me"). When it does not, the friend can't answer, and the page says so. */
  receiving?: boolean;
  /** A hand-held screen (a phone or a tablet showing the TV's pages): it types on its own keyboard, so the page has no keys. */
  narrow?: boolean;
  /** Back from the chat itself. */
  onClose: () => void;
  /** The time that "today" is measured against (tests give theirs). */
  now?: number;
}

/**
 * The chat with one friend, on the TV: pages over the friend's page. The messages and the few things to do with them (Write, Take back the
 * last, Mute, Report); Write is a page of its own, where the message is typed with the keys of the page (the way the note of a rating is)
 * and sent with the button, and the Back of the remote goes back a page at a time: from a report or the writing to the chat, from the chat
 * to the friend. A report shows what would be sent, and the remote lands on Back there, not on Send.
 */
export function ChatTv({ name, session, report, receiving = true, narrow = false, onClose, now = Date.now() }: ChatTvProps) {
  const [writing, setWriting] = useState(false);
  /** What has been typed and not sent stays while the chat is open: Back from the writing does not lose it. */
  const [draft, setDraft] = useState("");

  if (report.stage !== "closed") return <ReportTv name={name} report={report} now={now} />;
  if (writing) {
    return (
      <WriteTv
        name={name}
        session={session}
        draft={draft}
        setDraft={setDraft}
        narrow={narrow}
        onBack={() => setWriting(false)}
        onSent={() => {
          setDraft("");
          setWriting(false);
        }}
      />
    );
  }
  return <ReadTv name={name} session={session} report={report} receiving={receiving} now={now} onWrite={() => setWriting(true)} onClose={onClose} />;
}

export function ReadTv({ name, session, report, receiving, now, onWrite, onClose }: { name: string; session: ChatSession; report: ChatReport; receiving: boolean; now: number; onWrite: () => void; onClose: () => void }) {
  const t = useT();
  const { state } = session;
  const blocked = whyNotWrite(session);
  const mine = lastOwn(state.lines);

  // The page opens before it knows whether the friend takes messages, with the remote on Write; when it finds out that they do not (or that the
  // friendship is over) Write goes, and the remote must not be left on nothing: it stands on Back, unless it had already moved on to another button.
  useEffect(() => {
    if (!blocked) return;
    const on = document.activeElement;
    if (on && on !== document.body && on.closest("[data-testid='tv-chat']")) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat-back']")?.focus();
  }, [blocked]);

  return (
    <Screen key="read" testId="tv-chat" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("chat.title", { name })}</h1>
      {!session.loaded && !session.ended ? (
        <p className="tv-lead" role="status" data-testid="tv-chat-loading">
          {t("common.loading")}
        </p>
      ) : state.lines.length === 0 ? (
        <div className="tv-chat-empty" data-testid="tv-chat-empty">
          <p className="tv-lead">{t("chat.empty", { name })}</p>
          <p className="tv-hint chat-privacy" data-testid="tv-chat-privacy">
            {t("chat.privacy", CHAT_FACTS)}
          </p>
        </div>
      ) : (
        <ChatLines lines={state.lines} name={name} now={now} remote testId="tv-chat-lines" />
      )}
      <ChatNotices name={name} session={session} receiving={receiving} prefix="tv-chat" />
      {blocked && (
        <p className="chat-closed" data-testid={blocked === "ended" ? "tv-chat-ended" : "tv-chat-closed"}>
          {blocked === "ended" && session.ended ? problemText(t, session.ended, name) : t("chat.closed", { name })}
        </p>
      )}
      <div className="tv-actions tv-chat-actions">
        {!blocked && (
          <button type="button" className="tv-action tv-action-primary" onClick={onWrite} data-nav data-autofocus data-testid="tv-chat-write">
            <MessageIcon /> {t("chat.compose")}
          </button>
        )}
        {mine && (
          <button type="button" className="tv-action" onClick={() => void session.takeBack(mine.id)} data-nav data-testid="tv-chat-takeback">
            <TrashIcon /> {t("chat.takeBackLast")}
          </button>
        )}
        <button type="button" className="tv-action" aria-pressed={state.muted} onClick={() => void session.setMuted(!state.muted)} data-nav data-testid="tv-chat-mute">
          {t(state.muted ? "chat.unmute" : "chat.mute")}
        </button>
        <button type="button" className="tv-action" onClick={report.start} data-nav data-testid="tv-chat-report">
          <ShieldIcon /> {t("chat.report")}
        </button>
        <BackButton onClick={onClose} testId="tv-chat-back" {...(blocked ? { autoFocus: true } : {})} />
      </div>
    </Screen>
  );
}

export function WriteTv({
  name,
  session,
  draft,
  setDraft,
  narrow,
  onBack,
  onSent,
}: {
  name: string;
  session: ChatSession;
  draft: string;
  setDraft: (text: string) => void;
  narrow: boolean;
  onBack: () => void;
  onSent: () => void;
}) {
  const t = useT();
  const checked = checkChatText(draft);
  /** The last message in the chat, there to be answered. */
  const last = session.state.lines[session.state.lines.length - 1];
  const change = (update: (before: string) => string) => {
    setDraft(update(draft).slice(0, CHAT_TEXT_MAX));
    session.settle();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!checked.ok || session.sending) return;
    if (await session.send(checked.text)) onSent();
  };

  return (
    <Screen key="write" testId="tv-chat-compose" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("chat.writeTitle", { name })}</h1>
      {last && (
        <p className="tv-chat-quote" data-testid="tv-chat-quote">
          <b>{last.mine ? t("chat.you") : name}</b> {last.text}
        </p>
      )}
      <form className="profile-editor profile-editor-tv list-editor-tv chat-editor-tv" onSubmit={(event) => void submit(event)} noValidate data-testid="tv-chat-form">
        <label className="auth-field">
          <span>{t("chat.messageLabel")}</span>
          <input
            data-testid="tv-chat-input"
            type="text"
            value={draft}
            maxLength={CHAT_TEXT_MAX}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="send"
            placeholder={t("chat.placeholder")}
            onChange={(event) => change(() => event.target.value)}
            data-nav
          />
        </label>
        {!narrow && (
          <NameKeys
            more={MARKS}
            onKey={(char) => change((before) => appendTo(before, before === "" ? char.toUpperCase() : char, CHAT_TEXT_MAX))}
            onDelete={() => change((before) => before.slice(0, -1))}
            onClear={() => change(() => "")}
          />
        )}
        <ChatNotices name={name} session={session} receiving prefix="tv-chat" />
        <div className="editor-actions">
          <button type="submit" className="tv-action tv-action-primary" disabled={!checked.ok || session.sending} data-nav data-testid="tv-chat-send">
            {t("chat.send")}
          </button>
          <button type="button" className="tv-action" onClick={onBack} data-nav data-testid="tv-chat-cancel">
            {t("common.back")}
          </button>
        </div>
      </form>
    </Screen>
  );
}

export function ReportTv({ name, report, now }: { name: string; report: ChatReport; now: number }) {
  const t = useT();
  const lines = report.preview?.lines ?? [];
  const sent = report.stage === "sent";
  return (
    <Screen key="report" testId="tv-chat-reporting" compact focus onBack={report.cancel}>
      <h1 className="tv-headline tv-headline-small">{t("chat.reportTitle")}</h1>
      {sent ? (
        <p className="tv-lead" role="status" data-testid="tv-chat-report-sent">
          {t("chat.reportSent")}
        </p>
      ) : (
        <>
          <p className="tv-hint tv-chat-lead">{t("chat.reportLead", { name })}</p>
          {report.stage === "loading" ? (
            <p className="tv-lead" role="status" data-testid="tv-chat-report-loading">
              {t("common.loading")}
            </p>
          ) : report.preview && lines.length === 0 ? (
            <p className="tv-lead" data-testid="tv-chat-report-none">
              {t("chat.reportNone")}
            </p>
          ) : (
            lines.length > 0 && <ChatLines lines={lines} name={name} now={now} showWriter remote testId="tv-chat-report-lines" />
          )}
          {report.problem && (
            <p className="chat-problem" role="alert" data-testid="tv-chat-report-problem">
              {problemText(t, report.problem, name, true)}
            </p>
          )}
        </>
      )}
      <div className="tv-actions tv-chat-actions">
        {!sent && (
          <button type="button" className="tv-action tv-action-primary" disabled={report.stage !== "preview" || lines.length === 0} onClick={report.confirm} data-nav data-testid="tv-chat-report-send">
            {t("chat.reportSend")}
          </button>
        )}
        {/* (The remote lands here, not on Send: a second press of OK must not send what has not been read.) */}
        <button type="button" className="tv-action" onClick={report.cancel} data-nav data-autofocus data-testid="tv-chat-report-cancel">
          {t(sent ? "common.done" : "common.cancel")}
        </button>
      </div>
    </Screen>
  );
}
