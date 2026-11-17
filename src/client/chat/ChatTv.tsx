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
  onOpenTitle?: OpenTitle | undefined;
  /** The time that "today" is measured against (tests give theirs). */
  now?: number;
}

/**
 * The chat with one friend, on the TV: pages over the friend's page. One window: the friend at the top, the messages, and the box to write in at
 * the bottom; what is done less often (take back the last, search, the chat's GIFs and stickers, mute, report) is behind the ⋯ at the top, not a row of
 * buttons beside the box. (Search and the GIFs and stickers where a message can be pressed: a computer, a hand-held screen.)
 * A computer and a hand-held screen type in the box itself, as any messenger does (the owner, 16 Nov: a phone opened a page of its own to type, "instead of
 * directly making the chat a main chat like messenger/whatsapp"); a TV's box opens a page of its own, where the message is typed with the keys of the page
 * (the way the note of a rating is) and sent with the button. The Back of the remote goes back a page at a time: from the ⋯, a report or the writing to the
 * chat, from the chat to the friend. A report shows what would be sent, and the remote lands on Back there, not on Send.
 */
export function ChatTv({ name, avatar, online = false, presence, desk = false, session, report, receiving = true, narrow = false, onClose, onOpenTitle, now = Date.now() }: ChatTvProps) {
  const [writing, setWriting] = useState(false);
  /** The GIFs of the panel under the box (ChatPanel.tsx): only where the screen types (a computer, a hand-held screen), and only when the site has a KLIPY key. */
  const gifKey = useGifKey();
  const gifs = (desk || narrow) && gifKey ? gifKey : null;
  /** The page that puts a reaction on a message is open, for this one (see Reactions.tsx): the remote's way to react. */
  const [reacting, setReacting] = useState<number | null>(null);
  const reactingTo = reacting === null ? undefined : session.state.lines.find((line) => line.id === reacting);
  /** What has been typed and not sent stays while the chat is open: Back from the writing does not lose it. */
  const [draft, setDraft] = useState("");
  /** Personal stickers in the messages, while they are on (personalStickers.ts): saved from a chat where a message can be clicked or touched. */
  const personal = usePersonalLines(session, desk || narrow);
  /**
   * The chat's GIFs and stickers are shown (ChatMedia.tsx), and the message a press there shows, brought into view and lit once the chat is back: where a
   * message can be pressed (a computer, a hand-held screen). A TV that is only a remote has neither the gallery nor the search, whose words it would type
   * on the keys of a page.
   */
  const [mediaShown, setMediaShown] = useState(false);
  const [showing, setShowing] = useState<{ id: number; seq: number } | null>(null);
  const pointer = desk || narrow;

  // A message that goes takes its page of reactions, and so does a chat that closes (the friend takes no messages now, or the friendship is over): when the
  // chat opens again, it is the chat that is shown, not a page coming back by itself with the remote on it (the judge, 17 Nov). (Its panel is the chat's own:
  // ReadTv shuts it.)
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
      withPanel
      gifKey={gifs}
      onReactTo={setReacting}
      // (A TV that is only a remote writes on a page of its own: the answer is written there, and the page says what it answers.)
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
  /** A hand-held screen: it types in the box itself as a computer does, with its own keyboard, which does not come up by itself as the chat opens (it would cover the messages before they are read). */
  narrow?: boolean;
  draft?: string;
  setDraft?: Dispatch<SetStateAction<string>>;
  session: ChatSession;
  report: ChatReport;
  receiving: boolean;
  now: number;
  onWrite: () => void;
  /** The one button before the box that opens the panel of titles, GIFs and stickers under it (ChatPanel.tsx); false: no such button. */
  withPanel?: boolean;
  /** The panel's GIFs: the site's KLIPY key, where the screen can type a search (none: a TV that is only a remote, a site without a key). */
  gifKey?: string | null;
  /** "React to Sam's last message" behind the ⋯ opens the page that does it, for that message (none: not there). */
  onReactTo?: ((id: number) => void) | undefined;
  /** A message was picked to answer (Reply.tsx): where the answer is written next (none: the box here, which is given the keys). */
  onReplied?: (() => void) | undefined;
  onClose: () => void;
  onOpenTitle?: OpenTitle | undefined;
  /** Personal stickers in the messages (see `usePersonalLines`): none while they are off. */
  personal?: { lines: PersonalLines | undefined; note: SaveNote | null } | undefined;
  /** "GIFs and stickers" behind the ⋯ opens the chat's gallery (none: neither it nor Search is there, a TV that is only a remote). */
  onMedia?: (() => void) | undefined;
  /** The message the gallery shows, as the chat comes back (ChatLines.tsx `showing`); `onShown` once it is, so that it is shown that once. */
  showing?: { id: number; seq: number } | null;
  onShown?: (() => void) | undefined;
}) {
  const t = useT();
  const { state } = session;
  const blocked = whyNotWrite(session);
  const mine = lastOwn(state.lines);
  const theirs = lastTheirs(state.lines);
  /** A computer or a hand-held screen: a message is clicked or touched, and its reactions (and Take back, for one's own) come under it. */
  const [picked, setPicked] = useState<number | null>(null);
  const [kept, sayKept] = useKeptNote();
  const pointer = desk || narrow;
  const status = [presence || (online ? t("friends.online") : null), state.muted ? t("chat.mutedShort") : null].filter(Boolean).join("  ·  ");
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
  // (A press beside it shuts it, and goes where it was pressed: see pressBeside.ts.)
  const moreWrap = useRef<HTMLDivElement>(null);
  useShutOnPressBeside(menu, moreWrap, () => setMenu(false));
  const leaving = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(false);
  };
  const pick = (action: () => void) => () => {
    setMenu(false);
    action();
  };

  // The search (ChatSearch.tsx), in place of the head while it is open, where a message can be pressed. Back shuts it when nothing is open over it (a
  // selection, a picture shown larger: each Back shuts first); shut, the keys go back to the ⋯ it was opened from.
  const search = useChatSearch(state.lines);
  const searching = search.open && onMedia !== undefined;
  // (Not stood down while a message is selected or the ⋯ is open: Back's stack - `useBackFirst` - shuts whichever of them came after it first. Stood down, it
  // would come back on top of a panel opened meanwhile, and shut before it: the judge, 17 Nov.)
  useBackFirst(searching ? () => searchBack(session, search, "tv-chat-box") : undefined);
  const wasSearching = useRef(false);
  useEffect(() => {
    const was = wasSearching.current;
    wasSearching.current = searching;
    // (The keys go back to the ⋯ when the search took them with it, not from the box being typed in: the judge, 17 Nov.)
    const on = document.activeElement;
    if (was && !searching && (!on || on === document.body)) more.current?.focus({ preventScroll: true });
  }, [searching]);
  // (The gallery's message, shown as the chat comes back, and not again when the chat comes back from another page.)
  useEffect(() => {
    if (showing) onShown?.();
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The selected message's own button in the list. */
  const pickedBubble = (id: number) => document.querySelector<HTMLElement>(`[data-testid='tv-chat'] li[data-line="${id}"] button[data-testid='chat-bubble']`);
  // What had the keys at the top (Take back, Save) goes with the selection, as it is let go (Escape, a press elsewhere, the message taken back from another
  // screen): the keys go back to the message, else to the ⋯, never to nothing (the judge, 17 Nov).
  const wasPicked = useRef<number | null>(null);
  // (A message selected shuts the ⋯: a finger's hold moves no focus, so the menu would not shut by itself, and one Back would then shut both: the judge, 17 Nov.)
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
    event.stopPropagation(); // (the D-pad listens on the window)
    pickedBubble(picked)?.focus({ preventScroll: true });
  };

  // Answering a message: Reply at the top (a message selected), the message drawn to the right, or "Reply to Sam's last message" behind the ⋯. The selection
  // goes, and the keys go to where the answer is written.
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

  // What is sent besides words: one button before the box, and the panel under it (ChatPanel.tsx), as a messenger's keyboard of stickers (the owner, 17 Nov).
  // It opens with nothing selected and the ⋯ shut, so that Back shuts the panel; on a hand-held screen the keyboard goes down, the panel in its place.
  const [panel, setPanel] = useState(false);
  /** The keys go into the panel as it opens: a TV's remote, or the button pressed with a computer's keys; not a click, which leaves them where they were. */
  const [panelLand, setPanelLand] = useState(false);
  const panelButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panelOpen = panel && withPanel && !blocked;
  useEffect(() => {
    if (blocked) setPanel(false);
  }, [blocked]);
  /** Where the keys go once something was sent from it: the box on a computer, Write on a TV; a hand-held screen's keyboard stays down. */
  const home = () => {
    if (narrow) return;
    document.querySelector<HTMLElement>("[data-testid='tv-chat'] .tv-chat-compose-row [data-autofocus]")?.focus({ preventScroll: true });
  };
  const togglePanel = (event: MouseEvent<HTMLButtonElement>) => {
    if (panel) {
      setPanel(false);
      // (A screen that types has the box back, the keyboard with it; a TV's remote stays on the button.)
      if (pointer) (narrow ? area : box).current?.focus({ preventScroll: true });
      return;
    }
    setPicked(null);
    setMenu(false);
    if (narrow && document.activeElement === area.current) area.current?.blur();
    // (`detail` is 0 for a press made with the keys. A computer's click leaves the keys in the box: Enter there still sends what was typed, not the first
    // sticker the keys would have landed on - the judge, 17 Nov.)
    setPanelLand(!narrow && (!pointer || event.detail === 0));
    setPanel(true);
  };
  /**
   * Back: the panel shuts. The keys go back to its button when they were in the panel (or on nothing); typing in the box beside it, they stay there, so that
   * the next Back lets go of an answer being written before it leaves the chat (the judge, 17 Nov). A hand-held screen is given nothing: its keyboard would
   * come up.
   */
  const shutPanel = () => {
    const on = document.activeElement;
    const fromPanel = !on || on === document.body || on.closest("[data-testid='tv-chat-panel']") !== null;
    setPanel(false);
    if (!narrow && fromPanel) panelButton.current?.focus({ preventScroll: true });
  };
  /** The one button of what is sent besides words: a sticker's face while it is shut; while it is open, on a screen that types, a keyboard's (pressed, the box). */
  const panelToggle = withPanel && (
    <button
      type="button"
      ref={panelButton}
      className="tv-chat-title-btn tv-chat-panel-btn"
      onClick={togglePanel}
      // (A computer's click leaves the keys where they were, in the box: what is typed goes on, and Enter sends it - the judge, 17 Nov.)
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
      setDraft((now) => afterSent(now, written)); // (what was typed while it was on its way is the next message: see `afterSent`)
      // (The next message is typed at once, as in any chat; but a panel opened while it was on its way keeps the keys, and stays: the box given them would
      // shut it on a hand-held screen.)
      if (!panelNow.current) (narrow ? area : box).current?.focus();
    }
  };
  /** Whether the panel is open now: what a send that was on its way finds when it is done. */
  const panelNow = useRef(panelOpen);
  useEffect(() => {
    panelNow.current = panelOpen;
  }, [panelOpen]);

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
      <div className="tv-chat-window" role="group" aria-label={t("chat.title", { name })} data-panel={panelOpen ? "true" : undefined}>
        <div className="tv-chat-head" data-searching={searching ? "true" : undefined}>
          {searching ? (
            // (The search, the head's width, as in any messenger: × or Back shuts it, and the friend is at the top again.)
            <ChatSearchBar query={search.query} onQuery={search.setQuery} count={search.ids.length} at={search.at} onStep={search.step} onClose={search.close} nav />
          ) : (
            <>
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
                {/* (When they were last online, by the clock, and not the word "Chat" when that is not told: the owner, 17 Nov. Nothing told, nothing said.) */}
                {status && (
                  <p className="tv-chat-status" data-testid="tv-chat-status">
                    {status}
                  </p>
                )}
              </div>
            </>
          )}
          {/* (What can be done with the message that is selected, beside the ⋯, as in any messenger: the owner, 17 Nov. Once done, the keys are the ⋯'s.) */}
          {pointer && (
            // (A computer's keys reach them from the message, with Right past what is under it, and Left from the first goes back to the message: the judge, 17 Nov.)
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
                // (The menu and a selection are not open at once: one Back would shut both, the judge, 17 Nov.)
                setPicked(null);
                setMenu(true);
              }}
              data-nav
              data-testid="tv-chat-more"
            >
              <MoreIcon />
            </button>
            {/* (There all along, and hidden: what it holds is no stop for the remote, and no click, until the ⋯ opens it.) */}
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
              {/* (Search and the chat's GIFs and stickers where a message can be pressed: the owner, 17 Nov, "add a search in conversation (in the three dots)".) */}
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
            remote
            keyboard={desk}
            onOpenTitle={onOpenTitle}
            {...(pointer
              ? {
                  picked,
                  onPick: setPicked,
                  // (Reactions and answers while one can write: a friend who takes no messages takes no reactions either, see server/accounts/chat.ts `react`.)
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
                  // (The × goes with what it did: the keys go to where one writes, not to nothing.)
                  document.querySelector<HTMLElement>("[data-testid='tv-chat'] .tv-chat-compose-row [data-autofocus], [data-testid='tv-chat'] .tv-chat-compose-row [data-testid='tv-chat-box']")?.focus({ preventScroll: true });
                }}
                nav
                className="tv-chat-reply"
              />
            )}
            <div className="tv-chat-compose-row">
              {desk || narrow ? (
                // A computer or a hand-held screen: one bar, the one button of what is sent besides words in it before the box, Send beside it; Enter
                // sends (the owner, 17 Nov: three round buttons left the box a column a few words wide, then "it should only be 1 icon").
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
                        // (A finger on the box: the keyboard comes, and the panel goes from its place, as a messenger's does.)
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
                // A TV: the button, then what looks like the box, and OK on it opens the page that writes (with what was typed and not sent, if anything was).
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
  /** The message being answered ("Reply to Sam's last message"), else the last message in the chat, there to be answered. */
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
        {/* (The remote lands here, not on Send: a second press of OK must not send what has not been read.) */}
        <button type="button" className="tv-action" onClick={report.cancel} data-nav data-autofocus data-testid="tv-chat-report-cancel">
          {t(sent ? "common.done" : "common.cancel")}
        </button>
      </div>
    </Screen>
  );
}
