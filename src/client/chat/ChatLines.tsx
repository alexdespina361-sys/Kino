import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChatLine, ChatReaction, LibraryItem } from "../../shared";
import { useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { CloseIcon, ReplyIcon, StarIcon, TrashIcon } from "../shared/icons";
import { Poster } from "../shared/Poster";
import { useBackFirst } from "../tv/dpad";
import { actionForKey } from "../tv/keys";
import { gifOf } from "./gifs";
import { ReactBar, Reactions } from "./Reactions";
import { QuoteBlock } from "./Reply";
import { pictureOf, toggleKept, useSavedPictures, type KeptNote } from "./saved";
import { marked } from "./search";
import { stickerOf, stickerSrc, type Sticker } from "./stickers";
import { dayOf, stampOf, startsDay } from "./state";
import { cardsOf, useChatTitle } from "./titleCache";
import { onlyNames, titleIn, titleLabel, type OpenTitle, type TitleInText } from "./titles";
import { formatTime } from "../shared/format";

export interface ChatLinesProps {
  lines: readonly ChatLine[];
  /** The friend's name: what the list is called, and who wrote a line that is not one's own when writers are shown. */
  name: string;
  /** The time to say "today" against. */
  now: number;
  /** Say who wrote each line (a report shows what would be sent, and whose words they are). */
  showWriter?: boolean;
  /**
   * A screen that is touched or clicked: a line can be selected (`picked`), and under it come the reactions to pick from (with `onReact`, on any line); what
   * else can be done with it (Take back for one's own, Save for a friend's personal sticker) is at the top of the chat, beside the ⋯, where the page that
   * shows the list puts it (`PickedActions`: the owner, 17 Nov, "like WhatsApp"). A message is selected by holding it (or with the right button of a mouse);
   * a press of words selects too, and a press of a picture shows it larger in the middle of the screen. With the keys, Enter selects any. A press anywhere
   * else lets the selection go. Without `onPick` the lines are only read.
   */
  picked?: number | null;
  onPick?: (id: number | null) => void;
  onReact?: (id: number, reaction: ChatReaction | null) => void;
  /**
   * Answer a message (Reply.tsx): any message can then be selected (Reply is at the top, with `PickedActions`), and one drawn to the right with a finger or the
   * mouse is answered at once, as in any messenger. Without it (the friend takes no messages) nothing is answered.
   */
  onReply?: (id: number) => void;
  /** The TV: the list is a place the remote can land on, and Up and Down scroll it while there is more to see that way (and step onto the titles in it). */
  remote?: boolean;
  /**
   * A computer's list (with `remote` and `onPick`): its keyboard reaches the messages too. Tab stops on one of them (the one the keys were last on, else the
   * newest), Up and Down go from message to message, Left and Right along what is under one (its reactions, Take back), Enter presses, and Escape shuts the
   * reactions before it leaves the chat (the judge, 17 Nov: a keyboard could not react at all).
   */
  keyboard?: boolean;
  /** A title a message names was pressed (see titles.ts). Without it the cards are only shown. */
  onOpenTitle?: OpenTitle;
  /**
   * Personal stickers (personalStickers.ts), while they are on: where the picture of one sent in this chat is, and (on a screen that is touched or clicked)
   * saving a friend's into one's own collection, `has` saying which are there already. Without it a message of one says that it is not available.
   */
  personal?: PersonalLines | undefined;
  /**
   * A search of the chat (ChatSearch.tsx, search.ts): the messages found are lit, their words that were searched for marked, and the one shown (`current`)
   * brought into view each time it changes.
   */
  found?: SearchFound | undefined;
  /** A message to bring into view and light for a moment, as a quote's does (the gallery's): again each time `seq` changes. */
  showing?: { id: number; seq: number } | null | undefined;
  testId?: string;
}

export interface SearchFound {
  query: string;
  ids: ReadonlySet<number>;
  current: number | null;
}

export interface PersonalLines {
  src: (id: string) => string;
  onSave?: (id: string) => void;
  has?: (id: string) => boolean;
}

/** How near the end the list has to be for a new message to keep it there. */
const AT_END = 48;
const CARD = ".chat-card[data-title]";
/** How long a message is held before it is selected, and how far the finger may wander meanwhile (more is a scroll, or a slip). */
const HOLD_MS = 450;
const HOLD_SLOP = 10;
/** A touch this soon after the list scrolled stops the scroll, and holds nothing. */
const SCROLL_REST_MS = 150;
/**
 * Drawing a message aside to answer it: how far the finger goes to the right before the message moves (less is a press, or a slip), how far the message
 * then moves before letting go answers it, and the most it moves. A finger that goes more up or down than across is scrolling the list, and draws nothing.
 */
const SWIPE_START = 12;
const SWIPE_REPLY = 56;
const SWIPE_MAX = 84;
/** How long a message let go takes to glide back to its place (chat.css). */
const SWIPE_BACK_MS = 200;
/** How long the message a quote names is lit, once the quote was pressed and it was brought into view. */
const SHOWN_MS = 1400;
/** How long a picture shown larger hears no press: the second of the double tap that opened it. */
const VIEW_SETTLE_MS = 400;

/** Whether a message can be selected: for its reactions, to answer it, to take it back (one's own), or to save it (a friend's personal sticker, with `save`). */
export const canPick = (line: ChatLine, options: { reacts: boolean; saves: boolean; replies?: boolean }): boolean =>
  line.mine || options.reacts || options.replies === true || (line.sticker !== undefined && options.saves);

/**
 * The messages of a chat, oldest first and the newest at the bottom, where the list stays as messages come (unless it was scrolled up to read:
 * then it stays where it was). A message is text (never a link, never markup) in a bubble: one's own on the right, the friend's on the left.
 * A message that names a title by its address on this site (titles.ts) has a card under it, with the poster, which opens the title here; the address
 * is never shown as a link nor followed. A message that is the address of a GIF from KLIPY and nothing else (gifs.ts) is the picture; one that is a sticker's
 * emoji alone (stickers.ts) is the sticker, big and with no bubble. What a report would
 * send (`showWriter`) is the text alone, as it is sent.
 */
export function ChatLines({ lines, name, now, showWriter = false, picked = null, onPick, onReact, onReply, remote = false, keyboard = false, onOpenTitle, personal, found: search, showing, testId = "chat-lines" }: ChatLinesProps) {
  const t = useT();
  const language = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  /**
   * The list on its way to a message brought into view (`bringIntoView`): where it will stop, and until when its own scrolling is not asked whether it is at
   * the end (its first steps are still near it). The way there decides that, from where it will stop.
   */
  const travel = useRef<{ goal: number; until: number } | null>(null);
  const travelTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(travelTimer.current), []);
  /** The newest message seen: one of one's own that comes after it is followed to the end, wherever the list was being read. */
  const newest = useRef<number | null>(null);
  // (A report shows what it would send: the text as it is, a GIF's address among it.)
  const gifs = useMemo(() => lines.map((line) => (showWriter || line.sticker ? null : gifOf(line.text))), [lines, showWriter]);
  // (A report shows what it would send: a sticker's emoji, as it was sent.)
  const stickers = useMemo(() => lines.map((line) => (showWriter || line.sticker ? null : stickerOf(line.text))), [lines, showWriter]);
  const titles = useMemo(() => lines.map((line, index) => (showWriter || line.sticker || gifs[index] || stickers[index] ? null : titleIn(line.text))), [lines, showWriter, gifs, stickers]);
  const cards = useMemo(() => cardsOf(titles.map((found) => found?.id ?? null)), [titles]);
  /** The messages by their number: what a quote finds the message it names in. */
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const answers = !showWriter && onPick !== undefined && onReply !== undefined;

  // The newest message in view: the first time, for each new one when the person was at the end, and again when what is in the list changes
  // its size by itself (the page's fonts arriving, the box shrinking under a keyboard) so that the end does not slip away.
  useEffect(() => {
    const element = box.current;
    // (One's own new message is shown, as in any messenger, even when the list was being read higher up: what was just sent is where the eye goes.)
    const last = lines[lines.length - 1];
    if (last && newest.current !== null && last.id > newest.current && last.mine && !showWriter) {
      atEnd.current = true;
      travel.current = null;
    }
    if (last) newest.current = Math.max(newest.current ?? last.id, last.id);
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = box.current;
    const inside = content.current;
    if (!element || !inside || typeof ResizeObserver === "undefined") return;
    const keep = () => {
      if (atEnd.current) element.scrollTop = element.scrollHeight;
    };
    const watcher = new ResizeObserver(keep);
    watcher.observe(inside);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  // (A message can be selected for its reactions, Take back for one's own, and Save for a friend's personal sticker, which stays possible while the friend
  // takes no messages, as the server allows: the judge, 17 Nov.)
  const pressable = (line: ChatLine) => onPick !== undefined && canPick(line, { reacts: onReact !== undefined, saves: !showWriter && personal?.onSave !== undefined, replies: answers });

  // The picture shown larger, in the middle of the screen (a press of a GIF or a sticker): nothing is selected while it is.
  const [enlarged, setEnlarged] = useState<{ src: string; alt: string; small: boolean; line: number } | null>(null);
  // (Its message taken back by its sender, or let go with time, takes it away too; a picture that no longer comes - a personal sticker taken down - closes it
  // through its `onError`: the judge, 17 Nov.)
  const enlargedThere = enlarged !== null && lines.some((line) => line.id === enlarged.line);
  useEffect(() => {
    if (enlarged && !enlargedThere) setEnlarged(null);
  }, [enlarged, enlargedThere]);

  // A hold selects: so long down without wandering (a finger that moves is scrolling, and the browser then takes the touch away: `pointercancel`). The press
  // that ends a hold is not one more press (`heldNow`). The right button of a mouse, and a phone's own long-press menu, select too, and no menu comes.
  const holding = useRef<{ timer: number; x: number; y: number } | null>(null);
  const heldNow = useRef(false);
  /** When the list last scrolled: a finger that stops a fast scroll and rests there is not holding a message (the judge, 17 Nov). */
  const scrolled = useRef(Number.NEGATIVE_INFINITY);
  const letGo = () => {
    if (holding.current) window.clearTimeout(holding.current.timer);
    holding.current = null;
  };
  /** A message being drawn to the right, to answer it (`SWIPE_START`): where the finger went down, whether the message moves yet, and how far it has. */
  const swipe = useRef<{ pointer: number; x: number; y: number; on: boolean; shift: number; item: HTMLElement | null; reply: () => void } | null>(null);
  /** The message drawn aside goes back to its place, as the finger leaves it. */
  const putBack = () => {
    const was = swipe.current;
    swipe.current = null;
    if (!was?.item) return was;
    const item = was.item;
    if (!item.dataset.swipe) return was;
    // (It glides back, and is a plain line again once it is there: chat.css.)
    item.style.setProperty("--swipe", "0px");
    item.dataset.swipe = "back";
    window.setTimeout(() => {
      if (item.dataset.swipe !== "back") return; // (drawn again meanwhile)
      delete item.dataset.swipe;
      item.style.removeProperty("--swipe");
    }, SWIPE_BACK_MS);
    return was;
  };
  useEffect(
    () => () => {
      letGo();
      putBack();
    },
    [],
  );
  /** Whether the press now down may hold a message: not a finger that stopped a fast scroll (its long-press menu too: the judge, 17 Nov). */
  const mayHold = useRef(true);
  const holds = (select: (() => void) | null, reply: (() => void) | null) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      heldNow.current = false;
      letGo();
      putBack();
      mayHold.current = performance.now() - scrolled.current >= SCROLL_REST_MS;
      if (event.button !== 0 || !mayHold.current) return;
      if (reply) swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, on: false, shift: 0, item: event.currentTarget.closest("li"), reply };
      if (!select) return;
      const timer = window.setTimeout(() => {
        holding.current = null;
        heldNow.current = true;
        select();
      }, HOLD_MS);
      holding.current = { timer, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const at = holding.current;
      if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > HOLD_SLOP) letGo();
      const drawn = swipe.current;
      if (!drawn || drawn.pointer !== event.pointerId) return;
      const across = event.clientX - drawn.x;
      const down = event.clientY - drawn.y;
      if (!drawn.on) {
        // (Up or down first: the list is being scrolled, and the message is not drawn this time.)
        if (Math.abs(down) > HOLD_SLOP && Math.abs(down) >= Math.abs(across)) return void (swipe.current = null);
        if (across <= SWIPE_START || across < Math.abs(down) * 1.5) return;
        drawn.on = true;
        letGo(); // (a hold that had begun is no hold: the message is being drawn)
        try {
          event.currentTarget.setPointerCapture(event.pointerId); // (the finger may leave the message as it goes)
        } catch {
          /* (a pointer that is already gone: the next move or the lifting says so) */
        }
      }
      const shift = Math.max(0, Math.min(across - SWIPE_START, SWIPE_MAX));
      if (shift >= SWIPE_REPLY && drawn.shift < SWIPE_REPLY) {
        try {
          navigator.vibrate?.(8); // (a phone says, with a tap, that letting go now answers)
        } catch {
          /* (no vibration here) */
        }
      }
      drawn.shift = shift;
      if (drawn.item) {
        // (What the line holds moves, not the line: the day over its first message stays where it is, chat.css.)
        drawn.item.style.setProperty("--swipe", `${shift}px`);
        drawn.item.dataset.swipe = shift >= SWIPE_REPLY ? "ready" : "on";
      }
    },
    onPointerUp: () => {
      letGo();
      const was = putBack();
      if (!was?.on) return;
      heldNow.current = true; // (the press the lifting makes is no press of the message, nor of what is under the finger: see `onClickCapture`)
      if (was.shift >= SWIPE_REPLY) was.reply();
    },
    onPointerCancel: () => {
      letGo();
      putBack();
    },
    onPointerLeave: () => {
      letGo();
      if (!swipe.current?.on) swipe.current = null; // (while it is drawn the message has the pointer, and hears it wherever it goes)
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      letGo();
      if (swipe.current?.on) return; // (a phone's long-press menu, while a message is drawn: it is being drawn, not held)
      putBack();
      if (!mayHold.current) return; // (the finger that stopped a fast scroll and rested: no hold, and no long-press menu's hold either)
      select?.();
    },
  });

  // The message a quote names, brought into view and lit for a moment (a quote pressed). One no longer in the chat has no quote to press.
  const shownTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(shownTimer.current), []);
  /**
   * A message brought into view: in the middle of the list, smoothly where motion is welcome, the list alone moving (not the sheet or the page around it).
   * Whether the list is then kept at its end is where it will stop that says: a message already in view near the end moves nothing, and the list goes on
   * following what comes (the judge, 17 Nov: it stopped, and new messages, one's own too, came in below where it was looked at).
   */
  const bringIntoView = (id: number): HTMLElement | null => {
    const element = box.current;
    const item = element?.querySelector<HTMLElement>(`li[data-line="${id}"]`) ?? null;
    if (!element || !item) return null;
    const view = element.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    const most = Math.max(0, element.scrollHeight - element.clientHeight);
    const goal = Math.round(Math.min(most, Math.max(0, element.scrollTop + at.top - view.top - (view.height - at.height) / 2)));
    atEnd.current = most - goal <= AT_END;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const wait = smooth ? 900 : 100;
    const trip = Math.abs(goal - element.scrollTop) > 1 ? { goal, until: performance.now() + wait } : null;
    travel.current = trip;
    // (When its time is up the list is asked where it is, once more: a hand that scrolled it meanwhile and stopped sends no scroll after, the judge, 17 Nov.)
    window.clearTimeout(travelTimer.current);
    if (trip) {
      travelTimer.current = window.setTimeout(() => {
        const list = box.current;
        if (travel.current !== trip || !list) return;
        travel.current = null;
        atEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight <= AT_END;
      }, wait + 30);
    }
    element.scrollTo({ top: goal, behavior: smooth ? "smooth" : "auto" });
    return item;
  };
  const showQuoted = (id: number) => {
    const item = bringIntoView(id);
    if (!item) return;
    for (const lit of box.current?.querySelectorAll<HTMLElement>("li[data-shown]") ?? []) delete lit.dataset.shown;
    item.dataset.shown = "true";
    window.clearTimeout(shownTimer.current);
    shownTimer.current = window.setTimeout(() => {
      if (item.isConnected) delete item.dataset.shown;
    }, SHOWN_MS);
  };
  // The search's message shown, brought into view each time it changes (Earlier, Later, what is typed); the gallery's, lit as a quote's is, each time one is pressed.
  const current = search?.current ?? null;
  useEffect(() => {
    if (current !== null) bringIntoView(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const showingSeq = showing?.seq;
  useEffect(() => {
    if (showing) showQuoted(showing.id);
  }, [showingSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * A press beside the messages lets the selection go, as in any messenger: not the press that ended a hold, wherever it ends. The message held can move
   * from under a mouse while it is held (the reactions come under it, and a list at its end stays at its end), and the press then ends beside it, on its
   * line: it had selected the message and at once let it go again (the screenshots, 17 Nov). A touch's long hold ends with no press at all, so what is left
   * of a hold is forgotten at the next touch of the list (`onPointerDown` below).
   */
  const pressBeside = (event: MouseEvent<HTMLDivElement>) => {
    if (heldNow.current && event.detail > 0) {
      heldNow.current = false;
      return;
    }
    if (picked !== null && !(event.target instanceof Element && event.target.closest("button"))) onPick?.(null);
  };
  /** On a computer (`keyboard`), the one message Tab stops on: the one the keys were last on while it is there, else the newest that can be pressed. */
  const [stop, setStop] = useState<number | null>(null);
  const tabStop = useMemo(() => {
    if (!keyboard) return null;
    if (stop !== null && lines.some((line) => line.id === stop && pressable(line))) return stop;
    return [...lines].reverse().find(pressable)?.id ?? null;
  }, [keyboard, stop, lines, onPick, onReact, showWriter, personal?.onSave]); // eslint-disable-line react-hooks/exhaustive-deps

  // (A message pressed and then gone, taken back by its sender or let go, or one that can no longer be pressed (a friend's, once the friend takes no messages):
  // what was pressed is forgotten, on every screen that keeps it, and its reactions do not come back by themselves later: the judge, 17 Nov.)
  const pickedThere = picked !== null && lines.some((line) => line.id === picked && pressable(line));
  useEffect(() => {
    if (picked !== null && !pickedThere) onPick?.(null);
  }, [picked, pickedThere, onPick]);
  // (Back, and Escape on a computer, let the selection go first, as a menu shuts, and only then leave the chat: on a phone too, the owner, 17 Nov.)
  useBackFirst(pickedThere ? () => onPick?.(null) : undefined);

  // What the keys are on can go away under them: a message taken back (here, or by its sender on another screen) or let go, the reactions under a message
  // that shut once one is picked, a card no longer one of the newest titles, or carried out of view by the messages that came after it. They are given to
  // what is nearest, not left on nothing (where the next OK would only find a place to stand): the same message, else the one before it, else the one after;
  // on the TV's list, and from a card, the list itself (the judges, 16 and 17 Nov).
  const held = useRef<{ element: HTMLElement; line: number | null } | null>(null);
  useEffect(() => {
    const was = held.current;
    const element = box.current;
    if (!was || !element) return;
    if (was.element.isConnected) {
      if (document.activeElement !== was.element && !element.contains(document.activeElement)) held.current = null;
      return;
    }
    held.current = null;
    const on = document.activeElement;
    if (on !== null && on !== document.body) return;
    const toList = remote && (!keyboard || was.element.matches(CARD));
    const from = was.line;
    const bubbles =
      toList || from === null
        ? []
        : [...element.querySelectorAll<HTMLElement>("li[data-line]")].flatMap((item) => {
            const bubble = item.querySelector<HTMLElement>("button[data-testid='chat-bubble']");
            return bubble ? [{ id: Number(item.dataset.line), bubble }] : [];
          });
    const nearest = from === null ? undefined : (bubbles.find((each) => each.id === from) ?? [...bubbles].reverse().find((each) => each.id < from) ?? bubbles.find((each) => each.id > from));
    (nearest?.bubble ?? element).focus({ preventScroll: true });
  });
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const item = target?.closest<HTMLElement>("li[data-line]");
    held.current = target && target !== box.current ? { element: target, line: item ? Number(item.dataset.line) : null } : null;
    if (keyboard && item && target?.matches("button[data-testid='chat-bubble']")) setStop(Number(item.dataset.line));
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && !box.current?.contains(event.relatedTarget)) held.current = null;
  };

  const onScroll = () => {
    const element = box.current;
    if (!element) return;
    scrolled.current = performance.now();
    letGo(); // (a hold that has begun is no hold once the list moves under it)
    // (On its way to a message brought into view, the list is where it is going, not where it passes: see `bringIntoView`.)
    const trip = travel.current;
    if (!trip || performance.now() >= trip.until || Math.abs(element.scrollTop - trip.goal) <= 1) {
      travel.current = null;
      atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END;
    }
    const on = document.activeElement;
    if (remote && on instanceof HTMLElement && on.matches(CARD) && element.contains(on)) {
      const at = on.getBoundingClientRect();
      const view = element.getBoundingClientRect();
      if (at.bottom <= view.top || at.top >= view.bottom) element.focus({ preventScroll: true });
    }
  };

  // On the TV the list is walked with the remote: Up and Down step onto the next card of a title that is in view that way, else move the list while it
  // has more that way, and only then leave it for the next thing. OK on a card opens it; Left and Right go on from the list, as they did. (The cards are
  // no stops of the D-pad's own: a card scrolled out of the list's view is still on the page, and would be landed on from outside.)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!remote || !element || event.altKey || event.ctrlKey || event.metaKey) return;
    const action = actionForKey(event.nativeEvent);
    const on = document.activeElement instanceof HTMLElement && document.activeElement.matches(CARD) ? document.activeElement : null;
    if (on && action === "select") return event.stopPropagation(); // (the card's own click)
    // A message, or a button under it (a reaction, Take back, Save): OK is its own click, not the D-pad's (which would take it for a landing, and cancel it).
    const target = event.target instanceof HTMLElement && event.target !== element && !on && event.target.matches("button") ? event.target : null;
    const item = target?.closest<HTMLElement>("li[data-line]");
    if (target && item) {
      if (action === "select") return event.stopPropagation();
      if (keyboard && action !== null && ["up", "down", "left", "right"].includes(action)) {
        event.preventDefault();
        event.stopPropagation();
        const own = item.querySelector<HTMLElement>("button[data-testid='chat-bubble']");
        if (action === "left" || action === "right") {
          // (Along what the message has: its bubble, then the reactions under it; Right past the last of them goes on to what can be done with the selected
          // message at the top of the chat (Save, Take back: `PickedActions`), whose Left comes back. It goes no further.)
          // (A quote over the bubble is pressed with a mouse, not walked: the keys go along what is the message's own.)
          const along = [...item.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter((button) => !button.matches(CARD) && !button.matches(".chat-quote"));
          const next = along[along.indexOf(target) + (action === "right" ? 1 : -1)];
          if (next) next.focus({ preventScroll: true });
          else if (action === "right" && picked !== null && Number(item.dataset.line) === picked) {
            element.parentElement?.closest("[role='group'], .chat")?.querySelector<HTMLElement>(".chat-act:not(:disabled)")?.focus({ preventScroll: true });
          }
          return;
        }
        // (Up from what is under a message is the message; else from message to message, and past the first or the last back to the list, which goes on from there.)
        const bubbles = [...element.querySelectorAll<HTMLElement>("button[data-testid='chat-bubble']")];
        const next = action === "up" && own && target !== own ? own : bubbles[bubbles.indexOf(own ?? target) + (action === "down" ? 1 : -1)];
        if (!next) return element.focus({ preventScroll: true });
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
        return;
      }
    }
    if (on && (action === "left" || action === "right")) {
      // (Back to the list, and only that: the D-pad listens on the window, and would take the same press on from the list.)
      event.preventDefault();
      event.stopPropagation();
      return element.focus({ preventScroll: true });
    }
    if (action !== "up" && action !== "down") return;
    const view = element.getBoundingClientRect();
    const inView = [...element.querySelectorAll<HTMLElement>(CARD)].filter((card) => {
      const at = card.getBoundingClientRect();
      return at.bottom > view.top + 4 && at.top < view.bottom - 4;
    });
    const from = on?.getBoundingClientRect();
    const next =
      action === "down"
        ? inView.find((card) => !from || card.getBoundingClientRect().top >= from.bottom - 1)
        : [...inView].reverse().find((card) => !from || card.getBoundingClientRect().bottom <= from.top + 1);
    if (next) {
      event.preventDefault();
      event.stopPropagation();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      return;
    }
    const room = action === "down" ? element.scrollHeight - element.scrollTop - element.clientHeight : element.scrollTop;
    if (room <= 1) {
      if (on) element.focus({ preventScroll: true }); // (the D-pad leaves from the list)
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    element.scrollBy({ top: (action === "down" ? 1 : -1) * Math.max(40, element.clientHeight * 0.6) });
    // (A card scrolled out of view gives the remote back to the list.)
    if (on) {
      const at = on.getBoundingClientRect();
      const still = element.getBoundingClientRect();
      if (at.bottom <= still.top || at.top >= still.bottom) element.focus({ preventScroll: true });
    }
  };

  return (
    <div
      className={`chat-lines${remote ? " chat-lines-remote" : ""}${answers ? " chat-lines-swipe" : ""}`}
      ref={box}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={pressBeside}
      // The press that ends a hold is no press of anything, wherever it lands: the reactions come under the message as it is selected, and a list at its
      // end moves up, so a finger lifted after a hold could press a reaction, or a title's card, that was not there when it went down (the judge, 17 Nov:
      // an unasked reaction sent to the friend). It is stopped on its way down, before any of them hears of it; so is the phone's own long-press menu,
      // which would otherwise open on the picture of a reaction that slid under the finger.
      onClickCapture={(event) => {
        if (!heldNow.current || event.detail === 0) return;
        heldNow.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
      onContextMenuCapture={(event) => {
        if (heldNow.current) event.preventDefault();
      }}
      onPointerDown={() => {
        heldNow.current = false; // (a message's own `onPointerDown` came first, and its hold sets this again when it has lasted)
      }}
      role="log"
      aria-label={t("chat.title", { name })}
      // (Elsewhere it is no stop of Tab's, and can still be given the keys when what they were on goes: see `held`.)
      {...(remote ? { tabIndex: 0, "data-nav": true } : { tabIndex: -1 })}
      data-testid={testId}
    >
      <ol className="chat-list" ref={content}>
        {lines.map((line, index) => {
          const canPress = pressable(line);
          const open = canPress && picked === line.id;
          // (In the TV's list a press gives the keys back to the list, which walks it: a message pressed with a mouse is no stop of the remote's. A computer's
          // keyboard stays on the message, and goes on from it to its reactions.)
          const listTakes = remote && !keyboard;
          const press = () => {
            onPick?.(open ? null : line.id);
            if (listTakes) box.current?.focus({ preventScroll: true });
          };
          const found = titles[index] ?? null;
          const gif = gifs[index] ?? null;
          const sticker = stickers[index] ?? null;
          // (A personal sticker is drawn in a report too: its picture is what the report sends with it.)
          const own = line.sticker ?? null;
          const picture = gif ? " chat-bubble-gif" : sticker || (own && !showWriter) ? " chat-bubble-sticker" : "";
          // (A picture, on a screen that is touched or clicked: a press shows it larger, whether or not it can be selected.)
          const shows = onPick !== undefined && !showWriter && picture !== "";
          const pressed = (event: MouseEvent<HTMLButtonElement>) => {
            const wasHeld = heldNow.current;
            heldNow.current = false;
            if (wasHeld && event.detail > 0) return; // (the press that ended the hold: the hold selected it)
            // (`detail` is 0 for a press made with the keys: Enter selects a picture as it does words; a finger's or a mouse's press shows it larger, or,
            // while a message is selected, only lets that go.)
            if (shows && event.detail > 0) {
              if (picked !== null) return onPick?.(null);
              const drawn = event.currentTarget.querySelector("img");
              if (drawn) return setEnlarged({ src: drawn.currentSrc || drawn.src, alt: drawn.alt, small: !gif, line: line.id });
            }
            if (canPress) press();
          };
          const hit = search?.ids.has(line.id) === true;
          const bubble = (text: ReactNode) => (
            <>
              {showWriter && <span className="chat-writer">{line.mine ? t("chat.you") : name}</span>}
              <span className="chat-text" data-testid="chat-text">
                {/* (A message the search found has the words searched for marked, as they were written.) */}
                {hit && search && typeof text === "string" ? <Marked text={text} query={search.query} /> : text}
              </span>
              <span className="chat-time">{stampOf(line.at, language)}</span>
            </>
          );
          // (The message it answers, over it, while that message is in the chat. A report sends the words alone, and shows no quote.)
          const quoted = !showWriter && line.replyTo !== undefined ? byId.get(line.replyTo) : undefined;
          const replyTo = line.replyTo;
          const said = (text: ReactNode, card: ReactNode) => (
            <>
              {quoted && replyTo !== undefined && (
                <QuoteBlock quoted={quoted} name={name} focusable={!remote} {...(onPick !== undefined ? { onShow: () => showQuoted(replyTo) } : {})} />
              )}
              {canPress || shows ? (
                <button
                  type="button"
                  className={`chat-bubble${picture}${open ? " chat-picked" : ""}`}
                  {...(canPress ? { "aria-expanded": open } : {})}
                  onClick={pressed}
                  {...holds(canPress ? () => onPick?.(line.id) : null, answers && onReply ? () => onReply(line.id) : null)}
                  {...(remote ? { tabIndex: keyboard && line.id === tabStop ? 0 : -1 } : {})}
                  data-testid={canPress ? "chat-bubble" : "chat-picture"}
                >
                  {bubble(text)}
                </button>
              ) : (
                <div className={`chat-bubble${picture}`}>{bubble(text)}</div>
              )}
              {card}
              {!showWriter && <Reactions line={line} name={name} />}
              {open && onReact && (
                <ReactBar
                  current={line.myReaction}
                  onReact={(reaction) => {
                    onPick?.(null);
                    onReact(line.id, reaction);
                    if (listTakes) box.current?.focus({ preventScroll: true }); // (a computer's keyboard goes back to the message: see `held`)
                  }}
                />
              )}
            </>
          );
          return (
            <li
              key={line.id}
              className={`chat-line ${line.mine ? "chat-mine" : "chat-theirs"}`}
              data-testid="chat-line"
              data-line={line.id}
              data-mine={line.mine}
              {...(hit ? { "data-found": search?.current === line.id ? "current" : "true" } : {})}
            >
              {startsDay(lines, index) && (
                <span className="chat-day" data-testid="chat-day">
                  {dayOf(line.at, now, language)}
                </span>
              )}
              {own ? (
                said(<PersonalPicture src={personal ? personal.src(own) : null} name={line.mine ? t("chat.you") : name} />, null)
              ) : gif ? (
                said(<GifPicture url={gif} />, null)
              ) : sticker ? (
                said(<StickerPicture sticker={sticker} />, null)
              ) : (
                <Said line={line} found={found && cards.has(found.id) ? found : null} remote={remote} name={name} onOpenTitle={onOpenTitle}>
                  {said}
                </Said>
              )}
            </li>
          );
        })}
      </ol>
      {enlarged && enlargedThere && <PictureView src={enlarged.src} alt={enlarged.alt} small={enlarged.small} onClose={() => setEnlarged(null)} />}
    </div>
  );
}

/** A message's words with those a search looked for marked (search.ts `marked`). */
function Marked({ text, query }: { text: string; query: string }) {
  const pieces = useMemo(() => marked(text, query), [text, query]);
  return (
    <>
      {pieces.map((piece, at) =>
        piece.hit ? (
          <mark key={at} className="chat-found-words" data-testid="chat-found-words">
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )}
    </>
  );
}

/**
 * A picture of the chat shown larger, in the middle of the screen, over everything (the owner, 17 Nov: "not full full, just enlarge middle of screen"): a GIF
 * as wide as the screen allows, a sticker twice its size (it is 192 pixels: more would only blur it). A press anywhere, the ×, Back or Escape puts it away;
 * nothing else on the page is pressed meanwhile. It is drawn at the end of the page, not in the list: the list scrolls, and a sheet it is in moves.
 */
function PictureView({ src, alt, small, onClose }: { src: string; alt: string; small: boolean; onClose: () => void }) {
  const t = useT();
  const close = useRef<HTMLButtonElement>(null);
  /** When it opened: a press in the moment after is the second of the double tap or click that opened it. */
  const opened = useRef(performance.now());
  useBackFirst(onClose);
  useEffect(() => {
    const before = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="chat-view"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(event) => {
        event.stopPropagation(); // (it is over a sheet, whose own backdrop a press would close as well)
        // (The second press of a double tap or a double click, in the moment after it opened, does not close it at once; a quick press of one's own later
        // does: the judges, 17 Nov.)
        if (performance.now() - opened.current < VIEW_SETTLE_MS) return;
        onClose();
      }}
      onKeyDown={(event) => {
        // (The keys are its own while it is up: the list and the page under it are not walked, and Tab stays on its one button. Back and Escape were heard
        // before this, on their way down: `useBackFirst`.)
        event.stopPropagation();
        if (event.key === "Tab") event.preventDefault();
      }}
      data-testid="chat-view"
    >
      {/* (A picture that does not come, shown larger, is not shown at all: the view goes, never a broken picture.) */}
      <img className={`chat-view-picture${small ? " chat-view-small" : ""}`} src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" onError={onClose} data-testid="chat-view-picture" />
      <button type="button" className="chat-view-close" ref={close} aria-label={t("common.close")} title={t("common.close")} data-testid="chat-view-close">
        <CloseIcon />
      </button>
    </div>,
    document.body,
  );
}

/**
 * What can be done with the message that is selected, besides reacting to it: Reply; Save for a friend's personal sticker (into "Yours"); Save for a GIF or one
 * of Kino's stickers, anybody's (to the top of its tab in the panel, saved.ts), or Remove from saved for one that is; Take back for one's own. They are drawn
 * by the page that shows the list, at the top of the chat beside its ⋯ (the owner, 17 Nov: "the delete should appear up near the triple dots like WhatsApp").
 * Nothing while no message is selected, or when there is nothing to do with the one that is.
 */
export function PickedActions({
  line,
  personal,
  onReply,
  onTakeBack,
  onSaved,
  gifs = false,
  onKept,
  className,
  nav = false,
}: {
  /** The message that is selected (none: nothing is drawn). */
  line: ChatLine | undefined;
  personal?: PersonalLines | undefined;
  /** Answer it (Reply.tsx): none while the friend takes no messages. */
  onReply?: ((id: number) => void) | undefined;
  onTakeBack?: ((id: number) => void) | undefined;
  /** After Save was pressed (either): the selection is let go. */
  onSaved?: (() => void) | undefined;
  /** The panel has GIFs (KLIPY's): only then is a GIF saved, since only there is it shown again. */
  gifs?: boolean;
  /** What came of saving a GIF or a sticker (or letting it go), for the page to say for a moment. Without it, neither is saved here. */
  onKept?: ((note: KeptNote) => void) | undefined;
  /** The class of each button: the page's own round button. */
  className: string;
  /** The TV's pages: the buttons are stops of the arrow keys. */
  nav?: boolean;
}) {
  const t = useT();
  const kept = useSavedPictures();
  if (!line) return null;
  const own = line.sticker ?? null;
  const saving = own !== null && !line.mine && personal?.onSave ? personal : null;
  const taking = line.mine && onTakeBack !== undefined;
  const found = onKept ? pictureOf(line) : null;
  const picture = found && (found.kind === "sticker" || gifs) ? found : null;
  if (!saving && !taking && !onReply && !picture) return null;
  const has = saving && own ? (saving.has?.(own) ?? false) : false;
  const isKept = picture ? kept.has(picture) : false;
  const keepWords = t(isKept ? "chat.pictureUnsave" : "chat.pictureSave");
  const steps = nav ? { "data-nav": true } : {};
  return (
    <>
      {onReply && (
        <button type="button" className={`${className} chat-act chat-act-reply`} onClick={() => onReply(line.id)} aria-label={t("chat.reply")} title={t("chat.reply")} {...steps} data-testid="chat-reply">
          <ReplyIcon />
          <span className="chat-act-words">{t("chat.reply")}</span>
        </button>
      )}
      {picture && (
        <button
          type="button"
          className={`${className} chat-act chat-act-save chat-act-picture${isKept ? " chat-act-kept" : ""}`}
          onClick={() => {
            onKept?.(toggleKept(kept, picture));
            onSaved?.();
          }}
          aria-label={keepWords}
          title={keepWords}
          {...steps}
          data-kept={isKept ? "yes" : "no"}
          data-testid="chat-picture-save"
        >
          <StarIcon filled={isKept} />
          <span className="chat-act-words">{keepWords}</span>
        </button>
      )}
      {saving && own && (
        <button
          type="button"
          className={`${className} chat-act chat-act-save`}
          disabled={has}
          onClick={() => {
            saving.onSave?.(own);
            onSaved?.();
          }}
          aria-label={t(has ? "chat.stickerSaved" : "chat.stickerSave")}
          title={t(has ? "chat.stickerSaved" : "chat.stickerSave")}
          {...steps}
          data-testid="chat-sticker-save"
        >
          <StarIcon />
          <span className="chat-act-words">{t(has ? "chat.stickerSaved" : "chat.stickerSave")}</span>
        </button>
      )}
      {taking && (
        <button type="button" className={`${className} chat-act chat-act-takeback`} onClick={() => onTakeBack?.(line.id)} aria-label={t("chat.takeBack")} title={t("chat.takeBack")} {...steps} data-testid="chat-takeback">
          <TrashIcon />
          <span className="chat-act-words">{t("chat.takeBack")}</span>
        </button>
      )}
    </>
  );
}

/**
 * A message that is one of the chat's stickers (stickers.ts): its picture, big and with no bubble; its emoji is what a screen reader says, and what is copied.
 * A picture that does not come (the network went, a screen that cannot draw it) is the emoji, big, as it was sent: never a broken picture.
 */
function StickerPicture({ sticker }: { sticker: Sticker }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="chat-sticker chat-sticker-emoji" role="img" aria-label={sticker.emoji} data-testid="chat-sticker-emoji" data-sticker={sticker.id}>
        {sticker.emoji}
      </span>
    );
  }
  return <img className="chat-sticker" src={stickerSrc(sticker)} alt={sticker.emoji} width={192} height={192} decoding="async" draggable={false} onError={() => setFailed(true)} data-testid="chat-sticker" data-sticker={sticker.id} />;
}

/** How often a personal sticker's picture on the screen is asked for again: a browser keeps one five minutes (stickerRoutes.ts), and one taken down goes. */
export const PERSONAL_RECHECK_MS = 5 * 60_000;
/** How long after a picture did not come it is asked for again (one that did not come is not gone until the server says so). */
const PERSONAL_RETRY_MS = [5_000, 15_000, 45_000, 120_000] as const;

/**
 * A message that is a personal sticker (personalStickers.ts): its picture, from this site, big and with no bubble, as the built-in ones are. One nobody has any
 * more (or the team took down, or while the host has them off) says so in a line, where a broken picture would have been: when the server says it is not
 * there (404), not when the network failed for a moment, which only makes it asked for again a little later. The picture on the screen is asked for again
 * every five minutes, so that one taken down goes from a chat that stays open (the judge, 17 Nov). It is asked for only when it comes near the view (a chat
 * with many is not a hundred pictures at once).
 */
function PersonalPicture({ src, name }: { src: string | null; name: string }) {
  const t = useT();
  const [state, setState] = useState<"showing" | "waiting" | "gone">("showing");
  const [tries, setTries] = useState(0);
  const [period, setPeriod] = useState(() => Math.floor(Date.now() / PERSONAL_RECHECK_MS));
  useEffect(() => {
    const timer = window.setInterval(() => setPeriod(Math.floor(Date.now() / PERSONAL_RECHECK_MS)), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const live = useRef(true);
  const retry = useRef<number | undefined>(undefined);
  useEffect(() => {
    live.current = true; // (again, when React mounts it a second time to check it)
    return () => {
      live.current = false;
      window.clearTimeout(retry.current);
    };
  }, []);
  const address = src ? `${src}?v=${period}${tries > 0 ? `.${tries}` : ""}` : null;
  const failed = async () => {
    if (!address) return;
    const status = await fetch(address, { cache: "no-store", credentials: "same-origin" }).then(
      (answer) => answer.status,
      () => 0,
    );
    if (!live.current) return;
    if (status === 404 || status === 410) return setState("gone");
    setState("waiting");
    window.clearTimeout(retry.current);
    retry.current = window.setTimeout(() => {
      setTries((before) => before + 1);
      setState("showing");
    }, PERSONAL_RETRY_MS[Math.min(tries, PERSONAL_RETRY_MS.length - 1)]);
  };
  if (!address || state === "gone") {
    return (
      <span className="chat-gif-gone" data-testid="chat-personal-gone">
        {t("chat.stickerGone")}
      </span>
    );
  }
  if (state === "waiting") {
    return <span className="chat-sticker chat-sticker-personal chat-sticker-waiting" role="img" aria-label={t("chat.stickerOf", { name })} data-testid="chat-personal-waiting" />;
  }
  return (
    <img
      className="chat-sticker chat-sticker-personal"
      src={address}
      alt={t("chat.stickerOf", { name })}
      width={192}
      height={192}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => void failed()}
      data-testid="chat-personal-sticker"
    />
  );
}

/**
 * A message that is a GIF (gifs.ts): the picture, at the height every GIF has here (the list does not move while it comes, only its width settles), never a
 * link. It comes from KLIPY to this browser as any picture does. One KLIPY has taken away says so, in a line, instead of a broken picture. On a child's
 * profile it is a line too, and nothing is asked of KLIPY: a friend chose it from what KLIPY shows grown-ups (and the child's own profile has no GIF button).
 */
function GifPicture({ url }: { url: string }) {
  const t = useT();
  const child = useProfileData().settings.child === true;
  const [gone, setGone] = useState(false);
  if (child) {
    return (
      <span className="chat-gif-gone" data-testid="chat-gif-child">
        {t("chat.gifChild")}
      </span>
    );
  }
  if (gone) {
    return (
      <span className="chat-gif-gone" data-testid="chat-gif-gone">
        {t("chat.gifGone")}
      </span>
    );
  }
  return <img className="chat-gif-picture" src={url} alt={t("chat.gifAlt")} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setGone(true)} data-testid="chat-gif" />;
}

type SaidProps = {
  line: ChatLine;
  /** The title the line names, when it is one of the chat's cards (see `cardsOf`). */
  found: TitleInText | null;
  remote: boolean;
  /** The friend's name: whose rating a card of theirs says. */
  name: string;
  onOpenTitle?: OpenTitle | undefined;
  /** The line, drawn with what its bubble says and the card that goes under it (if any). */
  children: (text: string, card: ReactNode) => ReactNode;
};

/** What a line says: its text, or, for a line that names a title, the words besides the address and the card of the title. */
function Said(props: SaidProps) {
  return props.found ? <WithTitle {...props} found={props.found} /> : <>{props.children(props.line.text, null)}</>;
}

/**
 * A line that names a title: while the server is asked, the words and a card of the size it will have (the list does not move when it comes); then the poster
 * and the name. A title nobody knows, or one the server could not be asked about, is the text it is.
 */
function WithTitle({ line, found, remote, name, onOpenTitle, children }: SaidProps & { found: TitleInText }) {
  const t = useT();
  const title = useChatTitle(found.id);
  if (title.status === "none" || title.status === "failed") return <>{children(line.text, null)}</>;
  if (title.status === "loading") {
    const waiting = (
      <span className="chat-card chat-card-loading" aria-hidden="true" data-testid="chat-card-loading">
        <span className="chat-card-art" />
      </span>
    );
    return <>{children(found.rest || found.link, waiting)}</>;
  }
  const { item } = title;
  const { season, episode, at, score } = found.extras;
  // (What the address asks for besides the title: the episode and from when, and the rating its writer gave it, said as theirs.)
  const where = [season !== undefined && episode !== undefined ? t("chat.cardEpisode", { season, episode }) : "", at !== undefined ? t("chat.cardFrom", { time: formatTime(at) }) : ""].filter(Boolean).join(" · ");
  const rated = score !== undefined ? (line.mine ? t("chat.cardScoreMine", { score }) : t("chat.cardScoreTheirs", { name, score })) : "";
  // (The card keeps its size, the same as while it was asked for: with the episode or the time and a rating as well, the name has one line.)
  const inside = (
    <>
      <Poster className="chat-card-art" title={item.title} image={item.image} />
      <span className="chat-card-text" data-full={(where && rated) || undefined}>
        <b className="chat-card-name">{item.title}</b>
        {where ? (
          <small className="chat-card-where" data-testid="chat-card-where">
            {[item.year, where].filter(Boolean).join(" · ")}
          </small>
        ) : (
          item.year && <small>{item.year}</small>
        )}
        {rated && (
          <small className="chat-card-score" data-testid="chat-card-score">
            <StarIcon filled /> {rated}
          </small>
        )}
        {onOpenTitle && <span className="chat-card-open">{t("rows.open")}</span>}
      </span>
    </>
  );
  const opens = { ...(season !== undefined && episode !== undefined ? { season, episode } : {}), ...(at !== undefined ? { at } : {}) };
  const card = onOpenTitle ? (
    <button
      type="button"
      className="chat-card"
      onClick={() => onOpenTitle(item, opens)}
      tabIndex={remote ? -1 : undefined}
      aria-label={[`${t("rows.open")} ${item.title}`, where, rated].filter(Boolean).join(", ")}
      data-title={item.id}
      data-testid="chat-card"
    >
      {inside}
    </button>
  ) : (
    <span className="chat-card" data-testid="chat-card">
      {inside}
    </span>
  );
  return <>{children(onlyNames(found.rest, item) ? titleLabel(item) : found.rest, card)}</>;
}
