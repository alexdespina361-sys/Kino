import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { ShownTitle } from "../shared/Shown";
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
import { dayOf, stampOf, startsDay, ticksOf, type ChatState } from "./state";
import { cardsOf, useChatTitle } from "./titleCache";
import { onlyNames, titleIn, titleLabel, type OpenTitle, type TitleInText } from "./titles";
import { formatTime } from "../shared/format";

export interface ChatLinesProps {
  lines: readonly ChatLine[];
  name: string;
  now: number;
  showWriter?: boolean;
  picked?: number | null;
  onPick?: (id: number | null) => void;
  onReact?: (id: number, reaction: ChatReaction | null) => void;
  onReply?: (id: number) => void;
  remote?: boolean;
  keyboard?: boolean;
  onOpenTitle?: OpenTitle;
  personal?: PersonalLines | undefined;
  found?: SearchFound | undefined;
  showing?: { id: number; seq: number } | null | undefined;
  testId?: string;
  receipts?: Pick<ChatState, "theirSeen" | "theirGot"> | undefined;
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

const AT_END = 48;
const CARD = ".chat-card[data-title]";
const HOLD_MS = 450;
const HOLD_SLOP = 10;
const SCROLL_REST_MS = 150;
const SWIPE_START = 12;
const SWIPE_REPLY = 56;
const SWIPE_MAX = 84;
const SWIPE_BACK_MS = 200;
const SHOWN_MS = 1400;
const VIEW_SETTLE_MS = 400;

export const canPick = (line: ChatLine, options: { reacts: boolean; saves: boolean; replies?: boolean }): boolean =>
  line.mine || options.reacts || options.replies === true || (line.sticker !== undefined && options.saves);

export function ChatLines({ lines, name, now, showWriter = false, picked = null, onPick, onReact, onReply, remote = false, keyboard = false, onOpenTitle, personal, found: search, showing, testId = "chat-lines", receipts }: ChatLinesProps) {
  const t = useT();
  const language = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  const travel = useRef<{ goal: number; until: number } | null>(null);
  const travelTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(travelTimer.current), []);
  const newest = useRef<number | null>(null);
  const gifs = useMemo(() => lines.map((line) => (showWriter || line.sticker ? null : gifOf(line.text))), [lines, showWriter]);
  const stickers = useMemo(() => lines.map((line) => (showWriter || line.sticker ? null : stickerOf(line.text))), [lines, showWriter]);
  const titles = useMemo(() => lines.map((line, index) => (showWriter || line.sticker || gifs[index] || stickers[index] ? null : titleIn(line.text))), [lines, showWriter, gifs, stickers]);
  const cards = useMemo(() => cardsOf(titles.map((found) => found?.id ?? null)), [titles]);
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const answers = !showWriter && onPick !== undefined && onReply !== undefined;

  useEffect(() => {
    const element = box.current;
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

  const pressable = (line: ChatLine) => onPick !== undefined && canPick(line, { reacts: onReact !== undefined, saves: !showWriter && personal?.onSave !== undefined, replies: answers });

  const [enlarged, setEnlarged] = useState<{ src: string; alt: string; small: boolean; line: number } | null>(null);
  const enlargedThere = enlarged !== null && lines.some((line) => line.id === enlarged.line);
  useEffect(() => {
    if (enlarged && !enlargedThere) setEnlarged(null);
  }, [enlarged, enlargedThere]);

  const holding = useRef<{ timer: number; x: number; y: number } | null>(null);
  const heldNow = useRef(false);
  const scrolled = useRef(Number.NEGATIVE_INFINITY);
  const letGo = () => {
    if (holding.current) window.clearTimeout(holding.current.timer);
    holding.current = null;
  };
  const swipe = useRef<{ pointer: number; x: number; y: number; on: boolean; shift: number; item: HTMLElement | null; reply: () => void } | null>(null);
  const putBack = () => {
    const was = swipe.current;
    swipe.current = null;
    if (!was?.item) return was;
    const item = was.item;
    if (!item.dataset.swipe) return was;
    item.style.setProperty("--swipe", "0px");
    item.dataset.swipe = "back";
    window.setTimeout(() => {
      if (item.dataset.swipe !== "back") return;
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
        if (Math.abs(down) > HOLD_SLOP && Math.abs(down) >= Math.abs(across)) return void (swipe.current = null);
        if (across <= SWIPE_START || across < Math.abs(down) * 1.5) return;
        drawn.on = true;
        letGo();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      const shift = Math.max(0, Math.min(across - SWIPE_START, SWIPE_MAX));
      if (shift >= SWIPE_REPLY && drawn.shift < SWIPE_REPLY) {
        try {
          navigator.vibrate?.(8);
        } catch {
        }
      }
      drawn.shift = shift;
      if (drawn.item) {
        drawn.item.style.setProperty("--swipe", `${shift}px`);
        drawn.item.dataset.swipe = shift >= SWIPE_REPLY ? "ready" : "on";
      }
    },
    onPointerUp: () => {
      letGo();
      const was = putBack();
      if (!was?.on) return;
      heldNow.current = true;
      if (was.shift >= SWIPE_REPLY) was.reply();
    },
    onPointerCancel: () => {
      letGo();
      putBack();
    },
    onPointerLeave: () => {
      letGo();
      if (!swipe.current?.on) swipe.current = null;
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      letGo();
      if (swipe.current?.on) return;
      putBack();
      if (!mayHold.current) return;
      select?.();
    },
  });

  const shownTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(shownTimer.current), []);
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
  const current = search?.current ?? null;
  useEffect(() => {
    if (current !== null) bringIntoView(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const showingSeq = showing?.seq;
  useEffect(() => {
    if (showing) showQuoted(showing.id);
  }, [showingSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const pressBeside = (event: MouseEvent<HTMLDivElement>) => {
    if (heldNow.current && event.detail > 0) {
      heldNow.current = false;
      return;
    }
    if (picked !== null && !(event.target instanceof Element && event.target.closest("button"))) onPick?.(null);
  };
  const [stop, setStop] = useState<number | null>(null);
  const tabStop = useMemo(() => {
    if (!keyboard) return null;
    if (stop !== null && lines.some((line) => line.id === stop && pressable(line))) return stop;
    return [...lines].reverse().find(pressable)?.id ?? null;
  }, [keyboard, stop, lines, onPick, onReact, showWriter, personal?.onSave]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickedThere = picked !== null && lines.some((line) => line.id === picked && pressable(line));
  useEffect(() => {
    if (picked !== null && !pickedThere) onPick?.(null);
  }, [picked, pickedThere, onPick]);
  useBackFirst(pickedThere ? () => onPick?.(null) : undefined);

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
    letGo();
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!remote || !element || event.altKey || event.ctrlKey || event.metaKey) return;
    const action = actionForKey(event.nativeEvent);
    const on = document.activeElement instanceof HTMLElement && document.activeElement.matches(CARD) ? document.activeElement : null;
    if (on && action === "select") return event.stopPropagation();
    const target = event.target instanceof HTMLElement && event.target !== element && !on && event.target.matches("button") ? event.target : null;
    const item = target?.closest<HTMLElement>("li[data-line]");
    if (target && item) {
      if (action === "select") return event.stopPropagation();
      if (keyboard && action !== null && ["up", "down", "left", "right"].includes(action)) {
        event.preventDefault();
        event.stopPropagation();
        const own = item.querySelector<HTMLElement>("button[data-testid='chat-bubble']");
        if (action === "left" || action === "right") {
          const along = [...item.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter((button) => !button.matches(CARD) && !button.matches(".chat-quote"));
          const next = along[along.indexOf(target) + (action === "right" ? 1 : -1)];
          if (next) next.focus({ preventScroll: true });
          else if (action === "right" && picked !== null && Number(item.dataset.line) === picked) {
            element.parentElement?.closest("[role='group'], .chat")?.querySelector<HTMLElement>(".chat-act:not(:disabled)")?.focus({ preventScroll: true });
          }
          return;
        }
        const bubbles = [...element.querySelectorAll<HTMLElement>("button[data-testid='chat-bubble']")];
        const next = action === "up" && own && target !== own ? own : bubbles[bubbles.indexOf(own ?? target) + (action === "down" ? 1 : -1)];
        if (!next) return element.focus({ preventScroll: true });
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
        return;
      }
    }
    if (on && (action === "left" || action === "right")) {
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
      if (on) element.focus({ preventScroll: true });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    element.scrollBy({ top: (action === "down" ? 1 : -1) * Math.max(40, element.clientHeight * 0.6) });
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
        heldNow.current = false;
      }}
      role="log"
      aria-label={t("chat.title", { name })}
      {...(remote ? { tabIndex: 0, "data-nav": true } : { tabIndex: -1 })}
      data-testid={testId}
    >
      <ol className="chat-list" ref={content}>
        {lines.map((line, index) => {
          const canPress = pressable(line);
          const open = canPress && picked === line.id;
          const listTakes = remote && !keyboard;
          const press = () => {
            onPick?.(open ? null : line.id);
            if (listTakes) box.current?.focus({ preventScroll: true });
          };
          const found = titles[index] ?? null;
          const gif = gifs[index] ?? null;
          const sticker = stickers[index] ?? null;
          const own = line.sticker ?? null;
          const picture = gif ? " chat-bubble-gif" : sticker || (own && !showWriter) ? " chat-bubble-sticker" : "";
          const shows = onPick !== undefined && !showWriter && picture !== "";
          const pressed = (event: MouseEvent<HTMLButtonElement>) => {
            const wasHeld = heldNow.current;
            heldNow.current = false;
            if (wasHeld && event.detail > 0) return;
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
                {hit && search && typeof text === "string" ? <Marked text={text} query={search.query} /> : text}
              </span>
              {line.mine && receipts && !showWriter ? (
                <span className="chat-time chat-time-ticked">
                  <span className="chat-stamp">{stampOf(line.at, language)}</span>
                  <Ticks count={ticksOf(receipts, line.id)} />
                </span>
              ) : (
                <span className="chat-time">{stampOf(line.at, language)}</span>
              )}
            </>
          );
          const quoted = !showWriter && line.replyTo !== undefined ? byId.get(line.replyTo) : undefined;
          const replyTo = line.replyTo;
          const held = holds(canPress ? () => onPick?.(line.id) : null, answers && onReply ? () => onReply(line.id) : null);
          const heldCard = (card: ReactNode) => (isValidElement<Record<string, unknown>>(card) ? cloneElement(card, held) : card);
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
                  {...held}
                  {...(remote ? { tabIndex: keyboard && line.id === tabStop ? 0 : -1 } : {})}
                  data-testid={canPress ? "chat-bubble" : "chat-picture"}
                >
                  {bubble(text)}
                </button>
              ) : (
                <div className={`chat-bubble${picture}`}>{bubble(text)}</div>
              )}
              {heldCard(card)}
              {!showWriter && <Reactions line={line} name={name} />}
              {open && onReact && (
                <ReactBar
                  current={line.myReaction}
                  onReact={(reaction) => {
                    onPick?.(null);
                    onReact(line.id, reaction);
                    if (listTakes) box.current?.focus({ preventScroll: true });
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

function Ticks({ count }: { count: 0 | 1 | 2 }) {
  const t = useT();
  if (count === 0) return null;
  const label = t(count === 2 ? "chat.seen" : "chat.received");
  return (
    <span className={`chat-ticks${count === 2 ? " chat-ticks-seen" : ""}`} role="img" aria-label={label} title={label} data-testid="chat-ticks" data-ticks={count}>
      <svg viewBox={count === 2 ? "0 0 22 12" : "0 0 16 12"} aria-hidden="true" focusable="false">
        <path d="M1.5 6.5l3.6 3.6L13.5 1.6" />
        {count === 2 && <path d="M9.3 9.4l0.7 0.7L19.5 1.6" />}
      </svg>
    </span>
  );
}

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

function PictureView({ src, alt, small, onClose }: { src: string; alt: string; small: boolean; onClose: () => void }) {
  const t = useT();
  const close = useRef<HTMLButtonElement>(null);
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
        event.stopPropagation();
        if (performance.now() - opened.current < VIEW_SETTLE_MS) return;
        onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") event.preventDefault();
      }}
      data-testid="chat-view"
    >
      <img className={`chat-view-picture${small ? " chat-view-small" : ""}`} src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" onError={onClose} data-testid="chat-view-picture" />
      <button type="button" className="chat-view-close" ref={close} aria-label={t("common.close")} title={t("common.close")} data-testid="chat-view-close">
        <CloseIcon />
      </button>
    </div>,
    document.body,
  );
}

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
  line: ChatLine | undefined;
  personal?: PersonalLines | undefined;
  onReply?: ((id: number) => void) | undefined;
  onTakeBack?: ((id: number) => void) | undefined;
  onSaved?: (() => void) | undefined;
  gifs?: boolean;
  onKept?: ((note: KeptNote) => void) | undefined;
  className: string;
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

export const PERSONAL_RECHECK_MS = 5 * 60_000;
const PERSONAL_RETRY_MS = [5_000, 15_000, 45_000, 120_000] as const;

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
    live.current = true;
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
  found: TitleInText | null;
  remote: boolean;
  name: string;
  onOpenTitle?: OpenTitle | undefined;
  children: (text: string, card: ReactNode) => ReactNode;
};

function Said(props: SaidProps) {
  return props.found ? <WithTitle {...props} found={props.found} /> : <>{props.children(props.line.text, null)}</>;
}

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
  const where = [season !== undefined && episode !== undefined ? t("chat.cardEpisode", { season, episode }) : "", at !== undefined ? t("chat.cardFrom", { time: formatTime(at) }) : ""].filter(Boolean).join(" · ");
  const rated = score !== undefined ? (line.mine ? t("chat.cardScoreMine", { score }) : t("chat.cardScoreTheirs", { name, score })) : "";
  const inside = (
    <>
      <Poster className="chat-card-art" title={item.title} image={item.image} />
      <span className="chat-card-text" data-full={(where && rated) || undefined}>
        <b className="chat-card-name"><ShownTitle of={item} /></b>
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
