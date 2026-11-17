import { useEffect, useRef, useState, type Dispatch, type FocusEvent, type FormEvent, type SetStateAction } from "react";
import { checkChatText, CHAT_TEXT_MAX, type AvatarId, type ChatReaction, type LibraryItem } from "../../shared";
import { Avatar } from "../account/Avatar";
import { useT } from "../i18n";
import { BellIcon, BellOffIcon, ChevronLeftIcon, FilmIcon, GifIcon, HeartIcon, MoreIcon, PlusIcon, SendIcon, ShieldIcon, StickerIcon, TrashIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { BackButton, Screen } from "../tv/Idle";
import { appendTo } from "../tv/librarySearch";
import { NameKeys } from "../tv/NameKeys";
import { ChatLines, type PersonalLines } from "./ChatLines";
import { SAVE_NOTE, usePersonalLines, type SaveNote } from "./personalStickers";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { CHAT_FACTS, lastOwn } from "./state";
import { TitlePickTv } from "./TitlePick";
import { GifPickTv } from "./GifPick";
import { lastTheirs, ReactTv } from "./Reactions";
import { StickerPickTv } from "./StickerPick";
import { afterSent, cutTo, keepTheBox, MessageBox } from "./MessageBox";
import { useGifKey } from "./useGifs";
import { useVisibleArea } from "./visibleArea";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText, quoteOf } from "./words";
import "./chat.css";

/** The marks a message can use besides letters and digits, on keys of the page (six: with the letters of Romanian or Italian they still fit in four rows). */
const MARKS = [".", ",", "!", "?", "'", "-"];

export interface ChatTvProps {
  /** The friend, as friends see them. */
  name: string;
  /** Their picture, and whether they are online now: the top of the chat, as on their page. */
  avatar?: AvatarId | undefined;
  online?: boolean;
  /** What the top of the chat says under their name: "Online", else when they last were ("Last online 5 minutes ago", see `presenceLine`); empty: that it is a chat. */
  presence?: string | undefined;
  /** A computer (`data-fit="desk"`): it has a keyboard, so the chat has a box to type in under the messages, and Enter sends. */
  desk?: boolean;
  session: ChatSession;
  report: ChatReport;
  /** Whether this profile takes messages from friends (the setting "Friends can message me"). When it does not, the friend can't answer, and the page says so. */
  receiving?: boolean;
  /** A hand-held screen (a phone or a tablet showing the TV's pages): it types on its own keyboard, so the page has no keys. */
  narrow?: boolean;
  /** Back from the chat itself. */
  onClose: () => void;
  /** A title a message names was pressed (see titles.ts). */
  onOpenTitle?: ((item: LibraryItem) => void) | undefined;
  /** The time that "today" is measured against (tests give theirs). */
  now?: number;
}

/**
 * The chat with one friend, on the TV: pages over the friend's page. One window: the friend at the top, the messages, and the box to write in at
 * the bottom; what is done less often (take back the last, mute, report) is behind the ⋯ at the top, not a row of buttons beside the box.
 * A computer and a hand-held screen type in the box itself, as any messenger does (the owner, 16 Nov: a phone opened a page of its own to type, "instead of
 * directly making the chat a main chat like messenger/whatsapp"); a TV's box opens a page of its own, where the message is typed with the keys of the page
 * (the way the note of a rating is) and sent with the button. The Back of the remote goes back a page at a time: from the ⋯, a report or the writing to the
 * chat, from the chat to the friend. A report shows what would be sent, and the remote lands on Back there, not on Send.
 */
export function ChatTv({ name, avatar, online = false, presence, desk = false, session, report, receiving = true, narrow = false, onClose, onOpenTitle, now = Date.now() }: ChatTvProps) {
  const [writing, setWriting] = useState(false);
  /** The page of titles to send is open (see TitlePick.tsx). */
  const [picking, setPicking] = useState(false);
  /** The page of GIFs is open (see GifPick.tsx): only where the screen types (a computer, a hand-held screen), and only when the site has a KLIPY key. */
  const [gifPicking, setGifPicking] = useState(false);
  const gifKey = useGifKey();
  const gifs = (desk || narrow) && gifKey ? gifKey : null;
  /** The page of stickers is open (see StickerPick.tsx): on every screen, a TV that is only a remote too (they are picked, not typed). */
  const [stickerPicking, setStickerPicking] = useState(false);
  /** The page that puts a reaction on a message is open, for this one (see Reactions.tsx): the remote's way to react. */
  const [reacting, setReacting] = useState<number | null>(null);
  const reactingTo = reacting === null ? undefined : session.state.lines.find((line) => line.id === reacting);
  /** What has been typed and not sent stays while the chat is open: Back from the writing does not lose it. */
  const [draft, setDraft] = useState("");
  /** Personal stickers in the messages, while they are on (personalStickers.ts): saved from a chat where a message can be clicked or touched. */
  const personal = usePersonalLines(session, desk || narrow);

  // A chat that closes (the friend takes no messages now, or the friendship is over) forgets the pages it had open on it, and a message that goes takes its
  // page of reactions: when the chat opens again, it is the chat that is shown, not a page coming back by itself with the remote on it (the judge, 17 Nov).
  const blocked = whyNotWrite(session) !== null;
  const reactingGone = reacting !== null && !reactingTo;
  useEffect(() => {
    if (!blocked && !reactingGone) return;
    setReacting(null);
    if (!blocked) return;
    setPicking(false);
    setGifPicking(false);
    setStickerPicking(false);
  }, [blocked, reactingGone]);

  if (report.stage !== "closed") return <ReportTv name={name} report={report} now={now} personal={personal.lines} />;
  if (picking && !whyNotWrite(session)) return <TitlePickTv name={name} session={session} onBack={() => setPicking(false)} />;
  if (gifPicking && gifs && !whyNotWrite(session)) return <GifPickTv name={name} gifKey={gifs} session={session} narrow={narrow} onBack={() => setGifPicking(false)} />;
  if (stickerPicking && !whyNotWrite(session)) return <StickerPickTv name={name} session={session} narrow={narrow} pointer={desk || narrow} onBack={() => setStickerPicking(false)} />;
  // (A message taken back while its page is open: the page goes, and the chat is shown.)
  if (reactingTo && !whyNotWrite(session)) return <ReactTv name={name} line={reactingTo} session={session} onBack={() => setReacting(null)} />;
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
  return (
    <ReadTv
      name={name}
      avatar={avatar}
      online={online}
      presence={presence}
      desk={desk}
      narrow={narrow}
      draft={draft}
      setDraft={setDraft}
      session={session}
      report={report}
      receiving={receiving}
      now={now}
      onWrite={() => setWriting(true)}
      onPickTitle={() => setPicking(true)}
      {...(gifs ? { onPickGif: () => setGifPicking(true) } : {})}
      onPickSticker={() => setStickerPicking(true)}
      onReactTo={setReacting}
      onClose={onClose}
      onOpenTitle={onOpenTitle}
      personal={personal}
    />
  );
}

export function ReadTv({
  name,
  avatar,
  online = false,
  presence,
  desk = false,
  narrow = false,
  draft = "",
  setDraft = () => {},
  session,
  report,
  receiving,
  now,
  onWrite,
  onPickTitle,
  onPickGif,
  onPickSticker,
  onReactTo,
  onClose,
  onOpenTitle,
  personal,
}: {
  name: string;
  avatar?: AvatarId | undefined;
  online?: boolean;
  presence?: string | undefined;
  desk?: boolean;
  /** A hand-held screen: it types in the box itself as a computer does, with its own keyboard, which does not come up by itself as the chat opens (it would cover the messages before they are read). */
  narrow?: boolean;
  draft?: string;
  setDraft?: Dispatch<SetStateAction<string>>;
  session: ChatSession;
  report: ChatReport;
  receiving: boolean;
  now: number;
  onWrite: () => void;
  /** The button beside the box that sends a title instead (none: no such button). */
  onPickTitle?: (() => void) | undefined;
  /** The button beside it that sends a GIF (none: the site has no KLIPY key, or the screen only has a remote). */
  onPickGif?: (() => void) | undefined;
  /** The button nearest the box, that sends a sticker (none: no such button). */
  onPickSticker?: (() => void) | undefined;
  /** "React to Sam's last message" behind the ⋯ opens the page that does it, for that message (none: not there). */
  onReactTo?: ((id: number) => void) | undefined;
  onClose: () => void;
  onOpenTitle?: ((item: LibraryItem) => void) | undefined;
  /** Personal stickers in the messages (see `usePersonalLines`): none while they are off. */
  personal?: { lines: PersonalLines | undefined; note: SaveNote | null } | undefined;
}) {
  const t = useT();
  const { state } = session;
  const blocked = whyNotWrite(session);
  const mine = lastOwn(state.lines);
  const theirs = lastTheirs(state.lines);
  /** A computer or a hand-held screen: a message is clicked or touched, and its reactions (and Take back, for one's own) come under it. */
  const [picked, setPicked] = useState<number | null>(null);
  const pointer = desk || narrow;
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  /** A hand-held screen's box (MessageBox.tsx): an editable area, so that Chrome's form filler puts no strip of its own over it. */
  const area = useRef<HTMLDivElement>(null);
  const checked = checkChatText(draft);
  useVisibleArea(narrow);

  // The ⋯: Back shuts it (and only it), the remote goes into it when it opens and back to the ⋯ when it shuts; going anywhere else shuts it too.
  const shut = () => {
    setMenu(false);
    more.current?.focus();
  };
  useBackFirst(menu ? shut : undefined);
  useEffect(() => {
    if (menu) document.querySelector<HTMLElement>("[data-testid='tv-chat-menu'] [data-nav]")?.focus();
  }, [menu]);
  const leaving = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(false);
  };
  const pick = (action: () => void) => () => {
    setMenu(false);
    action();
  };

  // (A hand-held screen, while something is typed: the buttons that send something else are one +, until it is pressed; typing on folds them again.)
  const [tools, setTools] = useState(false);
  const folded = narrow && draft !== "" && !tools && (onPickTitle !== undefined || onPickGif !== undefined || onPickSticker !== undefined);
  useEffect(() => {
    if (draft === "") setTools(false);
  }, [draft]);
  const type = (text: string) => {
    setDraft(cutTo(text, CHAT_TEXT_MAX));
    setTools(false);
    session.settle();
  };
  /** The buttons that send something other than words: a title, a GIF, a sticker (the stickers' the nearest the box). */
  const toolButtons = (
    <>
      {onPickTitle && (
        <button type="button" className="tv-chat-title-btn" onClick={onPickTitle} aria-label={t("chat.sendTitle")} title={t("chat.sendTitle")} data-nav data-testid="tv-chat-title-btn">
          <FilmIcon />
        </button>
      )}
      {onPickGif && (
        <button type="button" className="tv-chat-title-btn tv-chat-gif-btn" onClick={onPickGif} aria-label={t("chat.gif")} title={t("chat.gif")} data-nav data-testid="tv-chat-gif-btn">
          <GifIcon />
        </button>
      )}
      {onPickSticker && (
        <button type="button" className="tv-chat-title-btn tv-chat-sticker-btn-open" onClick={onPickSticker} aria-label={t("chat.sticker")} title={t("chat.sticker")} data-nav data-testid="tv-chat-sticker-btn">
          <StickerIcon />
        </button>
      )}
    </>
  );
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!checked.ok || session.sending) return;
    const written = draft;
    if (await session.send(checked.text)) {
      setDraft((now) => afterSent(now, written)); // (what was typed while it was on its way is the next message: see `afterSent`)
      (narrow ? area : box).current?.focus(); // (the next message is typed at once, as in any chat)
    }
  };

  // (The last message taken back takes the list with it, and the remote with it if it was there: left on nothing, it is given Write again.)
  useEffect(() => {
    if (state.lines.length > 0) return;
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat'] [data-autofocus]:not(:disabled)")?.focus();
  }, [state.lines.length]);

  // The page opens before it knows whether the friend takes messages, with the remote on Write; when it finds out that they do not (or that the
  // friendship is over) Write goes, and the remote must not be left on nothing: it stands on Back, unless it had already moved on to another button.
  useEffect(() => {
    if (!blocked) return;
    const on = document.activeElement;
    if (on && on !== document.body && on.closest("[data-testid='tv-chat']")) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat-back']")?.focus();
  }, [blocked]);

  return (
    // (A hand-held screen lands on nothing as the chat opens: the box would bring the keyboard up over the messages, and the arrow at the top would be one
    // stray Enter from closing the chat. A keyboard's first arrow lands on the first thing, as everywhere.)
    <Screen key="read" testId="tv-chat" compact focus={!narrow} onBack={onClose} {...(narrow ? { className: "tv-chat-screen" } : {})}>
      <div className="tv-chat-window" role="group" aria-label={t("chat.title", { name })}>
        <div className="tv-chat-head">
          {/* (A hand-held screen: the chat is the whole screen, and the way back is the arrow at the top of it, as in any messenger.) */}
          {narrow && (
            <button type="button" className="tv-chat-headback" onClick={onClose} aria-label={t("common.back")} title={t("common.back")} data-nav {...(blocked ? { "data-autofocus": true } : {})} data-testid="tv-chat-back">
              <ChevronLeftIcon />
            </button>
          )}
          {avatar && (
            <span className="tv-person-pic tv-chat-pic" data-online={online ? "true" : undefined}>
              <Avatar id={avatar} />
            </span>
          )}
          <div className="tv-chat-who">
            <h1 className="tv-chat-name" data-testid="tv-chat-name">
              {name}
            </h1>
            <p className="tv-chat-status" data-testid="tv-chat-status">
              {[presence || (online ? t("friends.online") : t("chat.open")), state.muted ? t("chat.mutedShort") : null].filter(Boolean).join("  ·  ")}
            </p>
          </div>
          <div className="tv-chat-more-wrap" onBlur={leaving}>
            <button
              type="button"
              className="tv-chat-more"
              ref={more}
              aria-label={t("chat.more")}
              title={t("chat.more")}
              aria-expanded={menu}
              onClick={() => (menu ? shut() : setMenu(true))}
              data-nav
              data-testid="tv-chat-more"
            >
              <MoreIcon />
            </button>
            {/* (There all along, and hidden: what it holds is no stop for the remote, and no click, until the ⋯ opens it.) */}
            <div className="tv-chat-menu" hidden={!menu} data-testid="tv-chat-menu">
              {theirs && onReactTo && !blocked && (
                <button type="button" onClick={pick(() => onReactTo(theirs.id))} data-nav data-testid="tv-chat-react-last">
                  <HeartIcon /> {t("chat.reactLast", { name })}
                </button>
              )}
              {mine && (
                <button type="button" onClick={pick(() => void session.takeBack(mine.id))} data-nav data-testid="tv-chat-takeback">
                  <TrashIcon /> {t("chat.takeBackLast")}
                </button>
              )}
              <button type="button" aria-pressed={state.muted} onClick={pick(() => void session.setMuted(!state.muted))} data-nav data-testid="tv-chat-mute">
                {state.muted ? <BellIcon /> : <BellOffIcon />} {t(state.muted ? "chat.unmute" : "chat.mute")}
              </button>
              <button type="button" onClick={pick(report.start)} data-nav data-testid="tv-chat-report">
                <ShieldIcon /> {t("chat.report")}
              </button>
            </div>
          </div>
        </div>
        {!session.loaded && !session.ended ? (
          <p className="tv-lead tv-chat-middle" role="status" data-testid="tv-chat-loading">
            {t("common.loading")}
          </p>
        ) : state.lines.length === 0 ? (
          <div className="tv-chat-empty tv-chat-middle" data-testid="tv-chat-empty">
            <p className="tv-lead">{t("chat.empty", { name })}</p>
            <p className="tv-hint chat-privacy" data-testid="tv-chat-privacy">
              {t("chat.privacy", CHAT_FACTS)}
            </p>
          </div>
        ) : (
          <ChatLines
            lines={state.lines}
            name={name}
            now={now}
            remote
            keyboard={desk}
            onOpenTitle={onOpenTitle}
            {...(pointer
              ? {
                  picked,
                  onPick: setPicked,
                  onTakeBack: (id: number) => {
                    setPicked(null);
                    void session.takeBack(id);
                  },
                  // (Reactions while one can write: a friend who takes no messages takes no reactions either, see server/accounts/chat.ts `react`.)
                  ...(blocked ? {} : { onReact: (id: number, reaction: ChatReaction | null) => void session.react(id, reaction) }),
                }
              : {})}
            personal={personal?.lines}
            testId="tv-chat-lines"
          />
        )}
        <div className="tv-chat-foot">
          {personal?.note && (
            <p className="chat-note" role="status" data-testid="tv-chat-sticker-note">
              {t(SAVE_NOTE[personal.note])}
            </p>
          )}
          <ChatNotices name={name} session={session} receiving={receiving} prefix="tv-chat" />
          {blocked ? (
            <p className="chat-closed" data-testid={blocked === "ended" ? "tv-chat-ended" : "tv-chat-closed"}>
              {blocked === "ended" && session.ended ? problemText(t, session.ended, name) : t("chat.closed", { name })}
            </p>
          ) : (
            <div className="tv-chat-compose-row">
              {desk || narrow ? (
                // A computer or a hand-held screen: one bar, the buttons that send something else in it before the box, Send beside it; Enter sends. On a
                // hand-held screen the bar is the screen's width, so while something is typed the buttons fold into one + (a press of it brings them back),
                // and the words have the bar to themselves (the owner, 17 Nov: three round buttons left the box a column a few words wide).
                <form className="tv-chat-composer" onSubmit={(event) => void submit(event)} noValidate data-testid="tv-chat-box-form">
                  <div className="tv-chat-pill" data-testid="tv-chat-pill">
                    {folded ? (
                      <button
                        type="button"
                        className="tv-chat-title-btn tv-chat-tools-btn"
                        onClick={() => setTools(true)}
                        onMouseDown={keepTheBox}
                        aria-label={t("chat.moreToSend")}
                        aria-expanded={false}
                        title={t("chat.moreToSend")}
                        data-nav
                        data-testid="tv-chat-tools"
                      >
                        <PlusIcon />
                      </button>
                    ) : (
                      toolButtons
                    )}
                    {narrow ? (
                      <MessageBox
                        ref={area}
                        className="tv-chat-box tv-chat-box-area"
                        value={draft}
                        onChange={type}
                        onSend={() => void submit()}
                        maxLength={CHAT_TEXT_MAX}
                        label={t("chat.messageLabel")}
                        placeholder={t("chat.placeholder")}
                        extra={{ "data-nav": true }}
                        testId="tv-chat-box"
                      />
                    ) : (
                      <input
                        ref={box}
                        className="tv-chat-box"
                        type="text"
                        value={draft}
                        maxLength={CHAT_TEXT_MAX}
                        autoComplete="off"
                        autoCapitalize="sentences"
                        enterKeyHint="send"
                        aria-label={t("chat.messageLabel")}
                        placeholder={t("chat.placeholder")}
                        onChange={(event) => type(event.target.value)}
                        data-nav
                        data-autofocus
                        data-testid="tv-chat-box"
                      />
                    )}
                  </div>
                  <button
                    type="submit"
                    className="tv-chat-send-round"
                    disabled={!checked.ok || session.sending}
                    aria-label={t("chat.send")}
                    title={t("chat.send")}
                    {...(narrow ? { onMouseDown: keepTheBox } : {})}
                    data-nav
                    data-testid="tv-chat-box-send"
                  >
                    <SendIcon />
                  </button>
                </form>
              ) : (
                // A TV: the buttons, then what looks like the box, and OK on it opens the page that writes (with what was typed and not sent, if anything was).
                <>
                  {toolButtons}
                  <button type="button" className="tv-chat-composer tv-chat-fakebox" onClick={onWrite} data-nav data-autofocus data-testid="tv-chat-write">
                    <span className={`tv-chat-fakebox-text${draft ? "" : " is-empty"}`}>{draft || t("chat.placeholder")}</span>
                    <span className="tv-chat-send-round" aria-hidden="true">
                      <SendIcon />
                    </span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {!narrow && <BackButton onClick={onClose} testId="tv-chat-back" {...(blocked ? { autoFocus: true } : {})} />}
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
          <b>{last.mine ? t("chat.you") : name}</b> {quoteOf(t, last.text)}
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

export function ReportTv({ name, report, now, personal }: { name: string; report: ChatReport; now: number; personal?: PersonalLines | undefined }) {
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
            lines.length > 0 && <ChatLines lines={lines} name={name} now={now} showWriter remote personal={personal && { src: personal.src }} testId="tv-chat-report-lines" />
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
