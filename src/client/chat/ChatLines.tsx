import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatLine, LibraryItem } from "../../shared";
import { useProfileData } from "../account/store";
import { useLanguage, useT } from "../i18n";
import { Poster } from "../shared/Poster";
import { actionForKey } from "../tv/keys";
import { gifOf } from "./gifs";
import { stickerOf, stickerSrc, type Sticker } from "./stickers";
import { dayOf, stampOf, startsDay } from "./state";
import { cardsOf, useChatTitle } from "./titleCache";
import { onlyNames, titleIn, titleLabel, type TitleInText } from "./titles";

export interface ChatLinesProps {
  lines: readonly ChatLine[];
  /** The friend's name: what the list is called, and who wrote a line that is not one's own when writers are shown. */
  name: string;
  /** The time to say "today" against. */
  now: number;
  /** Say who wrote each line (a report shows what would be sent, and whose words they are). */
  showWriter?: boolean;
  /** The phone: a line of one's own can be pressed, and a button to take it back shows under it. Without `onPick` the lines are only read. */
  picked?: number | null;
  onPick?: (id: number | null) => void;
  onTakeBack?: (id: number) => void;
  /** The TV: the list is a place the remote can land on, and Up and Down scroll it while there is more to see that way (and step onto the titles in it). */
  remote?: boolean;
  /** A title a message names was pressed (see titles.ts). Without it the cards are only shown. */
  onOpenTitle?: (item: LibraryItem) => void;
  testId?: string;
}

/** How near the end the list has to be for a new message to keep it there. */
const AT_END = 48;
const CARD = ".chat-card[data-title]";

/**
 * The messages of a chat, oldest first and the newest at the bottom, where the list stays as messages come (unless it was scrolled up to read:
 * then it stays where it was). A message is text (never a link, never markup) in a bubble: one's own on the right, the friend's on the left.
 * A message that names a title by its address on this site (titles.ts) has a card under it, with the poster, which opens the title here; the address
 * is never shown as a link nor followed. A message that is the address of a GIF from KLIPY and nothing else (gifs.ts) is the picture; one that is a sticker's
 * emoji alone (stickers.ts) is the sticker, big and with no bubble. What a report would
 * send (`showWriter`) is the text alone, as it is sent.
 */
export function ChatLines({ lines, name, now, showWriter = false, picked = null, onPick, onTakeBack, remote = false, onOpenTitle, testId = "chat-lines" }: ChatLinesProps) {
  const t = useT();
  const language = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  // (A report shows what it would send: the text as it is, a GIF's address among it.)
  const gifs = useMemo(() => lines.map((line) => (showWriter ? null : gifOf(line.text))), [lines, showWriter]);
  // (A report shows what it would send: a sticker's emoji, as it was sent.)
  const stickers = useMemo(() => lines.map((line) => (showWriter ? null : stickerOf(line.text))), [lines, showWriter]);
  const titles = useMemo(() => lines.map((line, index) => (showWriter || gifs[index] || stickers[index] ? null : titleIn(line.text))), [lines, showWriter, gifs, stickers]);
  const cards = useMemo(() => cardsOf(titles.map((found) => found?.id ?? null)), [titles]);

  // The newest message in view: the first time, for each new one when the person was at the end, and again when what is in the list changes
  // its size by itself (the page's fonts arriving, the box shrinking under a keyboard) so that the end does not slip away.
  useEffect(() => {
    const element = box.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [lines]);
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

  // A card the remote is on can go away under it: taken back by its sender, no longer one of the newest titles, or carried out of view by the messages that
  // came after it. The remote is then given back to the list, not left on nothing (where the next OK would only find a place to stand) nor on a card that
  // cannot be seen (the judge, 16 Nov).
  const onCard = useRef(false);
  useEffect(() => {
    if (!remote || !onCard.current) return;
    const on = document.activeElement;
    if (on === null || on === document.body) {
      onCard.current = false;
      box.current?.focus({ preventScroll: true });
    }
  });
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    onCard.current = event.target instanceof HTMLElement && event.target.matches(CARD);
  };

  const onScroll = () => {
    const element = box.current;
    if (!element) return;
    atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END;
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
      className={`chat-lines${remote ? " chat-lines-remote" : ""}`}
      ref={box}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      role="log"
      aria-label={t("chat.title", { name })}
      {...(remote ? { tabIndex: 0, "data-nav": true } : {})}
      data-testid={testId}
    >
      <ol className="chat-list" ref={content}>
        {lines.map((line, index) => {
          const pressable = line.mine && onPick !== undefined;
          const open = pressable && picked === line.id;
          const found = titles[index] ?? null;
          const gif = gifs[index] ?? null;
          const sticker = stickers[index] ?? null;
          const picture = gif ? " chat-bubble-gif" : sticker ? " chat-bubble-sticker" : "";
          const bubble = (text: ReactNode) => (
            <>
              {showWriter && <span className="chat-writer">{line.mine ? t("chat.you") : name}</span>}
              <span className="chat-text" data-testid="chat-text">
                {text}
              </span>
              <span className="chat-time">{stampOf(line.at, language)}</span>
            </>
          );
          const said = (text: ReactNode, card: ReactNode) => (
            <>
              {pressable ? (
                <button type="button" className={`chat-bubble${picture}${open ? " chat-picked" : ""}`} aria-expanded={open} onClick={() => onPick(open ? null : line.id)} data-testid="chat-bubble">
                  {bubble(text)}
                </button>
              ) : (
                <div className={`chat-bubble${picture}`}>{bubble(text)}</div>
              )}
              {card}
              {open && onTakeBack && (
                <button type="button" className="chat-takeback" onClick={() => onTakeBack(line.id)} data-testid="chat-takeback">
                  {t("chat.takeBack")}
                </button>
              )}
            </>
          );
          return (
            <li key={line.id} className={`chat-line ${line.mine ? "chat-mine" : "chat-theirs"}`} data-testid="chat-line" data-line={line.id} data-mine={line.mine}>
              {startsDay(lines, index) && (
                <span className="chat-day" data-testid="chat-day">
                  {dayOf(line.at, now, language)}
                </span>
              )}
              {gif ? (
                said(<GifPicture url={gif} />, null)
              ) : sticker ? (
                said(<StickerPicture sticker={sticker} />, null)
              ) : (
                <Said line={line} found={found && cards.has(found.id) ? found : null} remote={remote} onOpenTitle={onOpenTitle}>
                  {said}
                </Said>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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
  onOpenTitle?: ((item: LibraryItem) => void) | undefined;
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
function WithTitle({ line, found, remote, onOpenTitle, children }: SaidProps & { found: TitleInText }) {
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
  const inside = (
    <>
      <Poster className="chat-card-art" title={item.title} image={item.image} />
      <span className="chat-card-text">
        <b className="chat-card-name">{item.title}</b>
        {item.year && <small>{item.year}</small>}
        {onOpenTitle && <span className="chat-card-open">{t("rows.open")}</span>}
      </span>
    </>
  );
  const card = onOpenTitle ? (
    <button type="button" className="chat-card" onClick={() => onOpenTitle(item)} tabIndex={remote ? -1 : undefined} aria-label={`${t("rows.open")} ${item.title}`} data-title={item.id} data-testid="chat-card">
      {inside}
    </button>
  ) : (
    <span className="chat-card" data-testid="chat-card">
      {inside}
    </span>
  );
  return <>{children(onlyNames(found.rest, item) ? titleLabel(item) : found.rest, card)}</>;
}
