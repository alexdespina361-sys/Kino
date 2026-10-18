import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ChatLine } from "../../shared";
import { useLanguage, useT } from "../i18n";
import { actionForKey } from "../tv/keys";
import { dayOf, stampOf, startsDay } from "./state";

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
  /** The TV: the list is a place the remote can land on, and Up and Down scroll it while there is more to see that way. */
  remote?: boolean;
  testId?: string;
}

/** How near the end the list has to be for a new message to keep it there. */
const AT_END = 48;

/**
 * The messages of a chat, oldest first and the newest at the bottom, where the list stays as messages come (unless it was scrolled up to read:
 * then it stays where it was). A message is text (never a link, never markup) in a bubble: one's own on the right, the friend's on the left.
 */
export function ChatLines({ lines, name, now, showWriter = false, picked = null, onPick, onTakeBack, remote = false, testId = "chat-lines" }: ChatLinesProps) {
  const t = useT();
  const language = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);

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

  const onScroll = () => {
    const element = box.current;
    if (element) atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END;
  };

  // On the TV the list is walked with the remote: Up and Down move it while it has more that way, and only then leave it for the next thing.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!remote || !element || event.altKey || event.ctrlKey || event.metaKey) return;
    const action = actionForKey(event.nativeEvent);
    if (action !== "up" && action !== "down") return;
    const room = action === "down" ? element.scrollHeight - element.scrollTop - element.clientHeight : element.scrollTop;
    if (room <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    element.scrollBy({ top: (action === "down" ? 1 : -1) * Math.max(40, element.clientHeight * 0.6) });
  };

  return (
    <div
      className={`chat-lines${remote ? " chat-lines-remote" : ""}`}
      ref={box}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      role="log"
      aria-label={t("chat.title", { name })}
      {...(remote ? { tabIndex: 0, "data-nav": true } : {})}
      data-testid={testId}
    >
      <ol className="chat-list" ref={content}>
        {lines.map((line, index) => {
          const pressable = line.mine && onPick !== undefined;
          const open = pressable && picked === line.id;
          const bubble = (
            <>
              {showWriter && <span className="chat-writer">{line.mine ? t("chat.you") : name}</span>}
              <span className="chat-text" data-testid="chat-text">
                {line.text}
              </span>
              <span className="chat-time">{stampOf(line.at, language)}</span>
            </>
          );
          return (
            <li key={line.id} className={`chat-line ${line.mine ? "chat-mine" : "chat-theirs"}`} data-testid="chat-line" data-line={line.id} data-mine={line.mine}>
              {startsDay(lines, index) && (
                <span className="chat-day" data-testid="chat-day">
                  {dayOf(line.at, now, language)}
                </span>
              )}
              {pressable ? (
                <button type="button" className={`chat-bubble${open ? " chat-picked" : ""}`} aria-expanded={open} onClick={() => onPick(open ? null : line.id)} data-testid="chat-bubble">
                  {bubble}
                </button>
              ) : (
                <div className="chat-bubble">{bubble}</div>
              )}
              {open && onTakeBack && (
                <button type="button" className="chat-takeback" onClick={() => onTakeBack(line.id)} data-testid="chat-takeback">
                  {t("chat.takeBack")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
