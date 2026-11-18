import { useEffect, useId, useRef, useState, type Dispatch, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type SetStateAction } from "react";
import { checkChatText, CHAT_TEXT_MAX, type AvatarId, type ChatReaction } from "../../shared";
import type { OpenTitle } from "./titles";
import { Avatar } from "../account/Avatar";
import { useT } from "../i18n";
import { BellIcon, BellOffIcon, ChevronLeftIcon, HeartIcon, ImageIcon, KeyboardIcon, MoreIcon, ReplyIcon, SearchIcon, SendIcon, ShieldIcon, StickerIcon, TrashIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { actionForKey } from "../tv/keys";
import { BackButton, Screen } from "../tv/Idle";
import { appendTo } from "../tv/librarySearch";
import { NameKeys } from "../tv/NameKeys";
import { ChatLines, PickedActions, type PersonalLines } from "./ChatLines";
import { ChatMediaTv } from "./ChatMedia";
import { ChatPanel } from "./ChatPanel";
import { ChatSearchBar, searchBack, useChatSearch } from "./ChatSearch";
import { useShutOnPressBeside } from "./pressBeside";
import { SAVE_NOTE, usePersonalLines, type SaveNote } from "./personalStickers";
import { KEPT_NOTE, SAVED_MAX, useKeptNote } from "./saved";
import { ChatNotices, whyNotWrite } from "./ChatNotices";
import { CHAT_FACTS, lastOwn } from "./state";
import { lastTheirs, ReactTv } from "./Reactions";
import { backLetsAnswerGo, quoteWords, ReplyStrip } from "./Reply";
import { afterSent, cutTo, keepTheBox, MessageBox } from "./MessageBox";
import { useGifKey } from "./useGifs";
import { useVisibleArea } from "./visibleArea";
import type { ChatReport, ChatSession } from "./useChat";
import { problemText, quoteOf } from "./words";
import "./chat.css";

const MARKS = [".", ",", "!", "?", "'", "-"];

export interface ChatTvProps {
  name: string;
  avatar?: AvatarId | undefined;
  online?: boolean;
  presence?: string | undefined;
  desk?: boolean;
  session: ChatSession;
  report: ChatReport;
  receiving?: boolean;
  narrow?: boolean;
  onClose: () => void;
  onOpenTitle?: OpenTitle | undefined;
  now?: number;
}

export function ChatTv({ name, avatar, online = false, presence, desk = false, session, report, receiving = true, narrow = false, onClose, onOpenTitle, now = Date.now() }: ChatTvProps) {
  const [writing, setWriting] = useState(false);
  const gifKey = useGifKey();
  const gifs = (desk || narrow) && gifKey ? gifKey : null;
  const [reacting, setReacting] = useState<number | null>(null);
  const reactingTo = reacting === null ? undefined : session.state.lines.find((line) => line.id === reacting);
  const [draft, setDraft] = useState("");
  const personal = usePersonalLines(session, desk || narrow);
  const [mediaShown, setMediaShown] = useState(false);
  const [showing, setShowing] = useState<{ id: number; seq: number } | null>(null);
  const pointer = desk || narrow;

  const blocked = whyNotWrite(session) !== null;
  const reactingGone = reacting !== null && !reactingTo;
  useEffect(() => {
    if (blocked || reactingGone) setReacting(null);
  }, [blocked, reactingGone]);

  if (report.stage !== "closed") return <ReportTv name={name} report={report} now={now} personal={personal.lines} />;
  if (mediaShown && pointer) {
    return (
      <ChatMediaTv
        lines={session.state.lines}
        name={name}
        now={now}
        personal={personal.lines}
        narrow={narrow}
        onShow={(id) => setShowing((was) => ({ id, seq: (was?.seq ?? 0) + 1 }))}
        onBack={() => setMediaShown(false)}
      />
    );
  }
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
      withPanel
      gifKey={gifs}
      onReactTo={setReacting}
      onReplied={desk || narrow ? undefined : () => setWriting(true)}
      onClose={onClose}
      onOpenTitle={onOpenTitle}
      personal={personal}
      {...(pointer ? { onMedia: () => setMediaShown(true), showing, onShown: () => setShowing(null) } : {})}
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
  withPanel = false,
  gifKey = null,
  onReactTo,
  onReplied,
  onClose,
  onOpenTitle,
  personal,
  onMedia,
  showing = null,
  onShown,
}: {
  name: string;
  avatar?: AvatarId | undefined;
  online?: boolean;
  presence?: string | undefined;
  desk?: boolean;
  narrow?: boolean;
  draft?: string;
  setDraft?: Dispatch<SetStateAction<string>>;
  session: ChatSession;
  report: ChatReport;
  receiving: boolean;
  now: number;
  onWrite: () => void;
  withPanel?: boolean;
  gifKey?: string | null;
  onReactTo?: ((id: number) => void) | undefined;
  onReplied?: (() => void) | undefined;
  onClose: () => void;
  onOpenTitle?: OpenTitle | undefined;
  personal?: { lines: PersonalLines | undefined; note: SaveNote | null } | undefined;
  onMedia?: (() => void) | undefined;
  showing?: { id: number; seq: number } | null;
  onShown?: (() => void) | undefined;
}) {
  const t = useT();
  const { state } = session;
  const blocked = whyNotWrite(session);
  const mine = lastOwn(state.lines);
  const theirs = lastTheirs(state.lines);
  const [picked, setPicked] = useState<number | null>(null);
  const [kept, sayKept] = useKeptNote();
  const pointer = desk || narrow;
  const status = [presence || (online ? t("friends.online") : null), state.muted ? t("chat.mutedShort") : null].filter(Boolean).join("  ·  ");
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const checked = checkChatText(draft);
  useVisibleArea(narrow);

  const shut = () => {
    setMenu(false);
    more.current?.focus();
  };
  useBackFirst(menu ? shut : undefined);
  useEffect(() => {
    if (menu) document.querySelector<HTMLElement>("[data-testid='tv-chat-menu'] [data-nav]")?.focus();
  }, [menu]);
  const moreWrap = useRef<HTMLDivElement>(null);
  useShutOnPressBeside(menu, moreWrap, () => setMenu(false));
  const leaving = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(false);
  };
  const pick = (action: () => void) => () => {
    setMenu(false);
    action();
  };

  const search = useChatSearch(state.lines);
  const searching = search.open && onMedia !== undefined;
  useBackFirst(searching ? () => searchBack(session, search, "tv-chat-box") : undefined);
  const wasSearching = useRef(false);
  useEffect(() => {
    const was = wasSearching.current;
    wasSearching.current = searching;
    const on = document.activeElement;
    if (was && !searching && (!on || on === document.body)) more.current?.focus({ preventScroll: true });
  }, [searching]);
  useEffect(() => {
    if (showing) onShown?.();
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedBubble = (id: number) => document.querySelector<HTMLElement>(`[data-testid='tv-chat'] li[data-line="${id}"] button[data-testid='chat-bubble']`);
  const wasPicked = useRef<number | null>(null);
  useEffect(() => {
    if (picked !== null) setMenu(false);
  }, [picked]);
  useEffect(() => {
    const was = wasPicked.current;
    wasPicked.current = picked;
    if (picked !== null || was === null) return;
    const on = document.activeElement;
    if (on && on !== document.body) return;
    (pickedBubble(was) ?? more.current)?.focus({ preventScroll: true });
  }, [picked]);
  const backToPicked = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!desk || picked === null || event.altKey || event.ctrlKey || event.metaKey || actionForKey(event.nativeEvent) !== "left") return;
    if (event.target !== event.currentTarget.querySelector(".chat-act:not(:disabled)")) return;
    event.preventDefault();
    event.stopPropagation();
    pickedBubble(picked)?.focus({ preventScroll: true });
  };

  const reply = (id: number) => {
    setPicked(null);
    session.setReplyTo(id);
    if (onReplied) return onReplied();
    (narrow ? area : box).current?.focus({ preventScroll: true });
  };
  const answering = session.replyTo === null ? undefined : state.lines.find((line) => line.id === session.replyTo);

  const type = (text: string) => {
    setDraft(cutTo(text, CHAT_TEXT_MAX));
    session.settle();
  };

  const [panel, setPanel] = useState(false);
  const [panelLand, setPanelLand] = useState(false);
  const panelButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panelOpen = panel && withPanel && !blocked;
  useEffect(() => {
    if (blocked) setPanel(false);
  }, [blocked]);
  const home = () => {
    if (narrow) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat'] .tv-chat-compose-row [data-autofocus]")?.focus({ preventScroll: true });
  };
  const togglePanel = (event: MouseEvent<HTMLButtonElement>) => {
    if (panel) {
      setPanel(false);
      if (pointer) (narrow ? area : box).current?.focus({ preventScroll: true });
      return;
    }
    setPicked(null);
    setMenu(false);
    if (narrow && document.activeElement === area.current) area.current?.blur();
    setPanelLand(!narrow && (!pointer || event.detail === 0));
    setPanel(true);
  };
  const shutPanel = () => {
    const on = document.activeElement;
    const fromPanel = !on || on === document.body || on.closest("[data-testid='tv-chat-panel']") !== null;
    setPanel(false);
    if (!narrow && fromPanel) panelButton.current?.focus({ preventScroll: true });
  };
  const panelToggle = withPanel && (
    <button
      type="button"
      ref={panelButton}
      className="tv-chat-title-btn tv-chat-panel-btn"
      onClick={togglePanel}
      {...(pointer && !narrow ? { onMouseDown: keepTheBox } : {})}
      aria-label={t("chat.panel")}
      aria-expanded={panelOpen}
      aria-controls={panelOpen ? panelId : undefined}
      title={t("chat.panel")}
      data-nav
      data-testid="tv-chat-panel-btn"
    >
      {panelOpen && pointer ? <KeyboardIcon /> : <StickerIcon />}
    </button>
  );
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!checked.ok || session.sending) return;
    const written = draft;
    if (await session.send(checked.text)) {
      setDraft((now) => afterSent(now, written));
      if (!panelNow.current) (narrow ? area : box).current?.focus();
    }
  };
  const panelNow = useRef(panelOpen);
  useEffect(() => {
    panelNow.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    if (state.lines.length > 0) return;
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat'] [data-autofocus]:not(:disabled)")?.focus();
  }, [state.lines.length]);

  useEffect(() => {
    if (!blocked) return;
    const on = document.activeElement;
    if (on && on !== document.body && on.closest("[data-testid='tv-chat']")) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat-back']")?.focus();
  }, [blocked]);

  return (
    <Screen key="read" testId="tv-chat" compact focus={!narrow} onBack={onClose} {...(narrow ? { className: "tv-chat-screen" } : {})}>
      <div className="tv-chat-window" role="group" aria-label={t("chat.title", { name })} data-panel={panelOpen ? "true" : undefined}>
        <div className="tv-chat-head" data-searching={searching ? "true" : undefined}>
          {searching ? (
            <ChatSearchBar query={search.query} onQuery={search.setQuery} count={search.ids.length} at={search.at} onStep={search.step} onClose={search.close} nav />
          ) : (
            <>
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
                {status && (
                  <p className="tv-chat-status" data-testid="tv-chat-status">
                    {status}
                  </p>
                )}
              </div>
            </>
          )}
          {pointer && (
            <span className="tv-chat-picked" onKeyDown={backToPicked}>
              <PickedActions
                line={picked === null ? undefined : state.lines.find((line) => line.id === picked)}
                personal={personal?.lines}
                {...(blocked ? {} : { onReply: reply })}
                onTakeBack={(id) => {
                  setPicked(null);
                  more.current?.focus({ preventScroll: true });
                  void session.takeBack(id);
                }}
                onSaved={() => {
                  setPicked(null);
                  more.current?.focus({ preventScroll: true });
                }}
                gifs={gifKey !== null}
                {...(withPanel ? { onKept: sayKept } : {})}
                className="tv-chat-more"
                nav
              />
            </span>
          )}
          {!searching && (
          <div className="tv-chat-more-wrap" ref={moreWrap} onBlur={leaving}>
            <button
              type="button"
              className="tv-chat-more"
              ref={more}
              aria-label={t("chat.more")}
              title={t("chat.more")}
              aria-expanded={menu}
              onClick={() => {
                if (menu) return shut();
                setPicked(null);
                setMenu(true);
              }}
              data-nav
              data-testid="tv-chat-more"
            >
              <MoreIcon />
            </button>
            <div className="tv-chat-menu" hidden={!menu} data-testid="tv-chat-menu">
              {theirs && !blocked && (
                <button type="button" onClick={pick(() => reply(theirs.id))} data-nav data-testid="tv-chat-reply-last">
                  <ReplyIcon /> {t("chat.replyLast", { name })}
                </button>
              )}
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
              {onMedia && (
                <button type="button" onClick={pick(search.start)} data-nav data-testid="tv-chat-search-open">
                  <SearchIcon /> {t("chat.search")}
                </button>
              )}
              {onMedia && (
                <button type="button" onClick={pick(onMedia)} data-nav data-testid="tv-chat-media-open">
                  <ImageIcon /> {t("chat.media")}
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
          )}
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
            receipts={state}
            remote
            keyboard={desk}
            onOpenTitle={onOpenTitle}
            {...(pointer
              ? {
                  picked,
                  onPick: setPicked,
                  ...(blocked ? {} : { onReact: (id: number, reaction: ChatReaction | null) => void session.react(id, reaction), onReply: reply }),
                }
              : {})}
            personal={personal?.lines}
            found={searching ? search.found : undefined}
            showing={showing}
            testId="tv-chat-lines"
          />
        )}
        <div className="tv-chat-foot">
          {personal?.note && (
            <p className="chat-note" role="status" data-testid="tv-chat-sticker-note">
              {t(SAVE_NOTE[personal.note])}
            </p>
          )}
          {kept && (
            <p className="chat-note" role="status" data-testid="tv-chat-saved-note">
              {t(KEPT_NOTE[kept], { max: SAVED_MAX })}
            </p>
          )}
          <ChatNotices name={name} session={session} receiving={receiving} prefix="tv-chat" />
          {blocked ? (
            <p className="chat-closed" data-testid={blocked === "ended" ? "tv-chat-ended" : "tv-chat-closed"}>
              {blocked === "ended" && session.ended ? problemText(t, session.ended, name) : t("chat.closed", { name })}
            </p>
          ) : (
            <>
            {answering && (
              <ReplyStrip
                line={answering}
                name={name}
                onCancel={() => {
                  session.setReplyTo(null);
                  document.querySelector<HTMLElement>("[data-testid='tv-chat'] .tv-chat-compose-row [data-autofocus], [data-testid='tv-chat'] .tv-chat-compose-row [data-testid='tv-chat-box']")?.focus({ preventScroll: true });
                }}
                nav
                className="tv-chat-reply"
              />
            )}
            <div className="tv-chat-compose-row">
              {desk || narrow ? (
                <form className="tv-chat-composer" onSubmit={(event) => void submit(event)} noValidate data-testid="tv-chat-box-form">
                  <div
                    className="tv-chat-pill"
                    onKeyDown={(event) => backLetsAnswerGo(event, session.replyTo !== null, () => session.setReplyTo(null), "tv-chat-box")}
                    data-testid="tv-chat-pill"
                  >
                    {panelToggle}
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
                        onFocused={() => setPanel(false)}
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
                <>
                  {panelToggle}
                  <button type="button" className="tv-chat-composer tv-chat-fakebox" onClick={onWrite} data-nav data-autofocus data-testid="tv-chat-write">
                    <span className={`tv-chat-fakebox-text${draft ? "" : " is-empty"}`}>{draft || t("chat.placeholder")}</span>
                    <span className="tv-chat-send-round" aria-hidden="true">
                      <SendIcon />
                    </span>
                  </button>
                </>
              )}
            </div>
            {panelOpen && (
              <ChatPanel
                id={panelId}
                session={session}
                tv
                nav
                land={panelLand}
                pointer={pointer}
                gifKey={gifKey}
                onClose={shutPanel}
                onSent={() => {
                  setPanel(false);
                  home();
                }}
              />
            )}
            </>
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
  const answering = session.replyTo === null ? undefined : session.state.lines.find((line) => line.id === session.replyTo);
  const last = answering ?? session.state.lines[session.state.lines.length - 1];
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
        <p className="tv-chat-quote" data-replying={answering ? "true" : undefined} data-testid="tv-chat-quote">
          {answering ? (
            <>
              <span className="tv-chat-quote-lead">{t(answering.mine ? "chat.replyingToMine" : "chat.replyingTo", { name })}</span> {quoteWords(t, answering)}
            </>
          ) : (
            <>
              <b>{last.mine ? t("chat.you") : name}</b> {quoteOf(t, last.text)}
            </>
          )}
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
        <button type="button" className="tv-action" onClick={report.cancel} data-nav data-autofocus data-testid="tv-chat-report-cancel">
          {t(sent ? "common.done" : "common.cancel")}
        </button>
      </div>
    </Screen>
  );
}
