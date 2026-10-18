import { useRef, useState, type FormEvent } from "react";
import { checkChatText, CHAT_TEXT_MAX } from "../../shared/chat";
import { Sheet } from "../controller/Sheet";
import { SendIcon, ShieldIcon } from "../shared/icons";
import { ChatLines } from "./ChatLines";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { CHAT_FACTS } from "./state";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText, useChatT } from "./words";
import "./chat.css";

export interface ChatPhoneProps {
  /** The friend, as friends see them. */
  name: string;
  session: ChatSession;
  report: ChatReport;
  /** Whether this profile takes messages from friends (the setting "Friends can message me"). When it does not, the friend can't answer, and the page says so. */
  receiving?: boolean;
  onClose: () => void;
  /** The time that "today" is measured against (tests give theirs). */
  now?: number;
}

/**
 * The chat with one friend, on the phone: a sheet over the friend's page. The messages, with a line for who they are from and when; a box to write
 * in; Mute and Report on top. A message of one's own can be pressed, and taken back. The sheet closes with the phone's Back, like the others.
 */
export function ChatPhone({ name, session, report, receiving = true, onClose, now = Date.now() }: ChatPhoneProps) {
  const t = useChatT();
  const { state } = session;
  const [picked, setPicked] = useState<number | null>(null);
  const blocked = whyNotWrite(session);

  return (
    <>
      <Sheet title={t("chat.title", { name })} onClose={onClose} testId="chat-sheet">
        <div className="chat" data-testid="chat">
          <div className="chat-tools">
            <button type="button" className="chat-tool" aria-pressed={state.muted} onClick={() => void session.setMuted(!state.muted)} data-testid="chat-mute">
              {t(state.muted ? "chat.unmute" : "chat.mute")}
            </button>
            <button type="button" className="chat-tool" onClick={report.start} data-testid="chat-report">
              <ShieldIcon /> {t("chat.report")}
            </button>
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
              onTakeBack={(id) => {
                setPicked(null);
                void session.takeBack(id);
              }}
            />
          )}

          <ChatNotices name={name} session={session} receiving={receiving} prefix="chat" />

          {blocked ? (
            <p className="chat-closed" data-testid={blocked === "ended" ? "chat-ended" : "chat-closed"}>
              {blocked === "ended" && session.ended ? problemText(t, session.ended, name) : t("chat.closed", { name })}
            </p>
          ) : (
            <Composer session={session} />
          )}
        </div>
      </Sheet>
      {report.stage !== "closed" && <ChatReportSheet name={name} report={report} now={now} />}
    </>
  );
}

/** The box a message is written in, and the button that sends it. Enter sends too. What is sent is the text as the server will keep it. */
function Composer({ session }: { session: ChatSession }) {
  const t = useChatT();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const checked = checkChatText(text);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!checked.ok || session.sending) return;
    if (await session.send(checked.text)) setText("");
    input.current?.focus(); // (the keyboard stays up: the next message is what comes next)
  };

  return (
    <form className="chat-compose" onSubmit={(event) => void submit(event)} noValidate data-testid="chat-compose">
      <input
        ref={input}
        className="chat-input"
        type="text"
        value={text}
        maxLength={CHAT_TEXT_MAX}
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="send"
        placeholder={t("chat.placeholder")}
        aria-label={t("chat.messageLabel")}
        onChange={(event) => {
          setText(event.target.value);
          session.settle();
        }}
        data-testid="chat-input"
      />
      <button type="submit" className="chat-send" disabled={!checked.ok || session.sending} aria-label={t("chat.send")} data-testid="chat-send">
        <SendIcon />
      </button>
    </form>
  );
}

/** What a report would hold, shown in full, and the one button that sends it. Nothing is sent before the button. */
export function ChatReportSheet({ name, report, now }: { name: string; report: ChatReport; now: number }) {
  const t = useChatT();
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
            lines.length > 0 && <ChatLines lines={lines} name={name} now={now} showWriter testId="chat-report-lines" />
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
