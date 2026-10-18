import { useCallback, useEffect, useRef, useState } from "react";
import { feedbackClosed, FEEDBACK_LIMITS, FEEDBACK_DETAILS_FOR, type FeedbackSummary, type FeedbackThread } from "../../shared";
import { getLanguage, useT, type Key } from "../i18n";
import { ChevronIcon, CloseIcon, ImageIcon, PaperclipIcon, RefreshIcon, SendIcon } from "../shared/icons";
import { checkReceipts, mineOfAccount, openThread, refreshUnread, sendReply, setUnread, totalUnread, type Who } from "./api";
import { pieceFromFile, release, toAttachments, type Piece } from "./images";
import { readReceipts } from "./receipts";
import { KindIcon, StatusChip, when } from "./ui";

/** A report in the list, and how to open it: by the receipt this browser holds, else by the account that sent it. */
interface Item extends FeedbackSummary {
  who: Who;
}

/** The reports this browser can see: those it holds receipts for, and those of the account that is signed in (once each). */
async function load(signedIn: boolean): Promise<Item[] | null> {
  const receipts = readReceipts();
  const [checked, mine] = await Promise.all([checkReceipts(receipts), signedIn ? mineOfAccount() : Promise.resolve([])]);
  if (checked === null && mine === null) return null;
  const items = new Map<string, Item>();
  for (const each of mine ?? []) items.set(each.id, { ...each, who: { id: each.id } });
  for (const each of checked ?? []) items.set(each.id, { ...each, who: { key: each.key } });
  setUnread(totalUnread(checked ?? [], mine ?? []));
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface MineProps {
  signedIn: boolean;
  onOpen: (who: Who) => void;
  onNew: () => void;
}

/** "Your messages": what was sent from this browser (or this account), where it is, and whether the team has written. */
export function MineScreen({ signedIn, onOpen, onNew }: MineProps) {
  const t = useT();
  const [items, setItems] = useState<Item[] | null | "loading">("loading");
  const run = useCallback(() => {
    setItems("loading");
    void load(signedIn).then(setItems);
  }, [signedIn]);
  useEffect(run, [run]);

  return (
    <div className="fb-body" data-testid="fb-mine-screen">
      {items === "loading" ? (
        <p className="fb-working" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      ) : items === null ? (
        <div className="fb-empty" data-testid="fb-mine-failed">
          <p>{t("feedback.mine.failed")}</p>
          <button type="button" className="fb-secondary" data-nav data-autofocus onClick={run}>
            <RefreshIcon />
            <span>{t("common.retry")}</span>
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="fb-empty" data-testid="fb-mine-empty">
          <p>{t("feedback.mine.empty")}</p>
          <button type="button" className="fb-secondary" data-nav data-autofocus onClick={onNew}>
            {t("feedback.mine.new")}
          </button>
        </div>
      ) : (
        <ul className="fb-rows">
          {items.map((item, index) => (
            <li key={item.id}>
              <button type="button" className="fb-row" data-nav data-autofocus={index === 0 ? "" : undefined} data-testid="fb-row" data-status={item.status} onClick={() => onOpen(item.who)}>
                <span className="fb-row-icon">
                  <KindIcon kind={item.kind} />
                </span>
                <span className="fb-row-main">
                  <strong>{item.title}</strong>
                  <small>
                    <StatusChip status={item.status} />
                    {" "}
                    {when(item.updatedAt, Date.now(), getLanguage())}
                  </small>
                </span>
                {item.unread > 0 ? (
                  <span className="fb-badge" aria-label={t("feedback.unread", { count: item.unread })}>
                    {item.unread}
                  </span>
                ) : null}
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How often an open conversation looks for a new line from the team. */
const POLL_MS = 30_000;
const MAX_REPLY_PICTURES = 2;

export interface ThreadProps {
  who: Who;
  signedIn: boolean;
}

/** One report and what has been said about it, with a box to answer in (unless it is closed). */
export function ThreadScreen({ who, signedIn }: ThreadProps) {
  const t = useT();
  const [thread, setThread] = useState<FeedbackThread | null | "loading">("loading");
  const [text, setText] = useState("");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(pieces);
  latest.current = pieces;

  const reload = useCallback(async () => {
    const next = await openThread(who);
    setThread((now) => (next ?? (now === "loading" ? null : now)));
    if (next) void refreshUnread(signedIn, true); // (it has been read: the count on the button goes down)
  }, [who, signedIn]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => () => latest.current.forEach(release), []);

  const add = async (files: File[]) => {
    setProblem(null);
    for (const file of files) {
      if (latest.current.length >= MAX_REPLY_PICTURES) break;
      const added = await pieceFromFile(file, "screenshot", latest.current);
      if (added.ok) setPieces((all) => [...all, added.piece]);
      else setProblem(t(`feedback.pic.${added.reason}` as Key));
    }
  };

  const reply = async () => {
    if (sending || (text.trim() === "" && pieces.length === 0)) return;
    setSending(true);
    setProblem(null);
    const { attachments } = await toAttachments(pieces);
    const result = await sendReply(who, text.trim(), attachments);
    setSending(false);
    if (!result.ok) {
      setProblem(t(`feedback.error.${result.reason}` as Key, { seconds: 60 }));
      return;
    }
    pieces.forEach(release);
    setPieces([]);
    setText("");
    void reload();
  };

  if (thread === "loading") {
    return (
      <div className="fb-body">
        <p className="fb-working" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      </div>
    );
  }
  if (thread === null) {
    return (
      <div className="fb-body" data-testid="fb-thread-failed">
        <div className="fb-empty">
          <p>{t("feedback.thread.failed")}</p>
          <button type="button" className="fb-secondary" data-nav data-autofocus onClick={() => void reload()}>
            <RefreshIcon />
            <span>{t("common.retry")}</span>
          </button>
        </div>
      </div>
    );
  }

  const closed = feedbackClosed(thread.status);
  const details = FEEDBACK_DETAILS_FOR[thread.kind].filter((key) => thread.details[key]);
  return (
    <>
      <div className="fb-body fb-thread" data-testid="fb-thread" data-status={thread.status}>
        <header className="fb-thread-head">
          <span className="fb-row-icon">
            <KindIcon kind={thread.kind} />
          </span>
          <div>
            <h3>{thread.title}</h3>
            <p>
              <StatusChip status={thread.status} /> <small>{t(`feedback.area.${thread.area}` as Key)}</small>
            </p>
          </div>
        </header>
        {thread.status === "needs_info" ? (
          <p className="fb-ask" role="status" data-testid="fb-needs-info">
            {t("feedback.thread.needsInfo")}
          </p>
        ) : null}
        <ol className="fb-messages">
          <li className="fb-bubble fb-from-you" data-testid="fb-original">
            <small>
              {t("feedback.thread.you")} · {when(thread.createdAt, Date.now(), getLanguage()) || t("feedback.thread.now")}
            </small>
            {thread.message ? <p>{thread.message}</p> : null}
            {details.map((key) => (
              <p key={key}>
                <strong>{t(`feedback.detail.${key}` as Key)}</strong>
                <br />
                {thread.details[key]}
              </p>
            ))}
            {thread.attachments.length > 0 ? (
              <ul className="fb-attached">
                {thread.attachments.map((each) => (
                  <li key={each.id}>
                    {each.mime.startsWith("image/") ? <ImageIcon /> : <PaperclipIcon />}
                    <span>{each.name}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
          {thread.messages.map((line) => (
            <li key={line.id} className={`fb-bubble ${line.from === "team" ? "fb-from-team" : "fb-from-you"}${line.asks ? " fb-asks" : ""}`} data-testid={line.from === "team" ? "fb-team-line" : "fb-your-line"}>
              <small>
                {line.from === "team" ? t("feedback.thread.team") : t("feedback.thread.you")} · {when(line.at, Date.now(), getLanguage()) || t("feedback.thread.now")}
              </small>
              <p>{line.text}</p>
            </li>
          ))}
        </ol>
        {closed ? <p className="fb-note">{t("feedback.thread.closed")}</p> : null}
      </div>
      {closed ? null : (
        <div className="fb-foot fb-reply">
          {problem ? (
            <p className="fb-problem" role="alert" data-testid="fb-reply-problem">
              {problem}
            </p>
          ) : null}
          {pieces.length > 0 ? (
            <ul className="fb-attached">
              {pieces.map((piece) => (
                <li key={piece.id}>
                  <ImageIcon />
                  <span>{piece.name}</span>
                  <button
                    type="button"
                    className="fb-mini fb-mini-quiet"
                    data-nav
                    aria-label={t("feedback.removePiece", { name: piece.name })}
                    onClick={() => {
                      release(piece);
                      setPieces((all) => all.filter((each) => each.id !== piece.id));
                    }}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            className="fb-text"
            rows={3}
            maxLength={FEEDBACK_LIMITS.text}
            value={text}
            placeholder={t("feedback.thread.replyHint")}
            aria-label={t("feedback.thread.reply")}
            data-nav
            data-autofocus
            data-testid="fb-reply-text"
            onChange={(event) => setText(event.target.value)}
          />
          <div className="fb-reply-actions">
            {pieces.length < MAX_REPLY_PICTURES ? (
              <button type="button" className="fb-secondary" data-nav data-testid="fb-reply-picture" onClick={() => picker.current?.click()}>
                <ImageIcon />
                <span>{t("feedback.addPicture")}</span>
              </button>
            ) : null}
            <button type="button" className="fb-send" data-nav data-testid="fb-reply-send" disabled={sending || (text.trim() === "" && pieces.length === 0)} onClick={() => void reply()}>
              {sending ? <span className="spinner" /> : <SendIcon />}
              <span>{t("feedback.thread.send")}</span>
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                void add(files);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

