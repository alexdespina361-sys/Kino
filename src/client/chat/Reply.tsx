import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ChatLine } from "../../shared";
import { useT } from "../i18n";
import { CloseIcon, ReplyIcon } from "../shared/icons";
import { actionForKey } from "../tv/keys";
import { gifOf } from "./gifs";
import { stickerOf, stickerSrc } from "./stickers";
import { useChatTitle } from "./titleCache";
import { onlyNames, titleIn, titleLabel, type TitleInText } from "./titles";
import type { ChatT } from "./words";

/**
 * Answering a message (the owner, 17 Nov: "dragging a message makes it reply to it (the next message)"). A message is answered with Reply, at the top of the
 * chat while it is selected, or by drawing it to the right with a finger (ChatLines.tsx); a strip over the box then says which (`ReplyStrip`), and whatever
 * is sent next - words, a title, a GIF, a sticker - answers it (useChat.ts `replyTo`). The answer shows the message it answers over its bubble (`QuoteBlock`).
 * Only the number of the message is kept with the answer (server/accounts/chat.ts): a message taken back is quoted nowhere, and its answer is a message.
 */

/** A message in a few words, as a quote says it: a GIF is "GIF", a sticker "Sticker" (or "A sticker 🍿"), a title its address's words; else the words. */
export function quoteWords(t: ChatT, line: ChatLine): string {
  if (line.sticker) return t("chat.quoteSticker");
  if (gifOf(line.text)) return t("chat.gifAlt");
  const sticker = stickerOf(line.text);
  if (sticker) return t("chat.stickerSaid", { emoji: sticker.emoji });
  const found = titleIn(line.text);
  return found ? found.rest || found.link : line.text;
}

/** What a quote shows of the message: its words, a title by its name once it is known (a message that only sent one is its address until then). */
function Words({ line }: { line: ChatLine }) {
  const t = useT();
  const found = line.sticker || gifOf(line.text) || stickerOf(line.text) ? null : titleIn(line.text);
  return found ? <TitleWords found={found} /> : <>{quoteWords(t, line)}</>;
}

function TitleWords({ found }: { found: TitleInText }) {
  const title = useChatTitle(found.id);
  if (!("item" in title)) return <>{found.rest || found.link}</>;
  const { item } = title;
  return <>{found.rest && !onlyNames(found.rest, item) ? `${titleLabel(item)} · ${found.rest}` : titleLabel(item)}</>;
}

/** A built-in sticker's picture, small, beside its quote (a picture that does not come is not drawn: the words say it). */
function Thumb({ line }: { line: ChatLine }) {
  const [failed, setFailed] = useState(false);
  const sticker = line.sticker ? null : stickerOf(line.text);
  if (!sticker || failed) return null;
  return <img className="chat-quote-pic" src={stickerSrc(sticker)} alt="" width={192} height={192} decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

/** What a screen reader says of a quote. */
export const quoteLabel = (t: ChatT, quoted: ChatLine, name: string): string => t(quoted.mine ? "chat.inReplyToMine" : "chat.inReplyTo", { name, text: quoteWords(t, quoted) });

/**
 * The message a message answers, over its bubble: who wrote it and a line of what it said. A press shows that message in the list, lit for a moment (`onShow`;
 * without it the quote is only read). One that answers a message that is gone has no quote at all.
 */
export function QuoteBlock({ quoted, name, onShow, focusable = true }: { quoted: ChatLine; name: string; onShow?: (() => void) | undefined; focusable?: boolean }) {
  const t = useT();
  const label = quoteLabel(t, quoted, name);
  const inside = (
    <>
      <Thumb line={quoted} />
      <span className="chat-quote-what">
        <b className="chat-quote-who">{quoted.mine ? t("chat.you") : name}</b>
        <span className="chat-quote-words">
          <Words line={quoted} />
        </span>
      </span>
    </>
  );
  if (!onShow) {
    return (
      <span className="chat-quote" data-of={quoted.mine ? "mine" : "theirs"} role="note" aria-label={label} data-testid="chat-quote">
        {inside}
      </span>
    );
  }
  const show = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation(); // (no press beside the messages: a selection stays)
    onShow();
  };
  return (
    <button type="button" className="chat-quote" data-of={quoted.mine ? "mine" : "theirs"} onClick={show} aria-label={label} title={label} {...(focusable ? {} : { tabIndex: -1 })} data-testid="chat-quote">
      {inside}
    </button>
  );
}

/**
 * Back - Escape on a computer - pressed in the box while a message is being answered lets the answer go, and only that: what is typed stays, and so does the
 * chat (the judge, 17 Nov: it left the chat, and what was typed went with it, where Escape is how any messenger stops answering). Put on what holds the box:
 * the chat's own Back is heard later, on the window, and never hears this one. (What is open over the chat - a selection, the ⋯, a picture - is shut by Back
 * before this, as it is heard on the way down.)
 */
export function backLetsAnswerGo(event: KeyboardEvent<HTMLElement>, answering: boolean, letGo: () => void, box: string): void {
  if (!answering || event.altKey || event.ctrlKey || event.metaKey || actionForKey(event.nativeEvent) !== "back") return;
  if (!(event.target instanceof HTMLElement) || !event.target.matches(`[data-testid='${box}']`)) return;
  event.preventDefault();
  event.stopPropagation();
  letGo();
}

/**
 * Over the box while a message is being answered: "Replying to Sam" and a line of the message, and the × that leaves it unanswered. (Back in the box does
 * too: `backLetsAnswerGo`. Elsewhere, Back shuts what is open over the chat first - a selection, a picture - and then leaves the chat, and the answer with it.)
 */
export function ReplyStrip({ line, name, onCancel, nav = false, className = "" }: { line: ChatLine; name: string; onCancel: () => void; nav?: boolean; className?: string }) {
  const t = useT();
  return (
    <div className={`chat-reply-strip ${className}`} data-testid="chat-reply-strip">
      <span className="chat-reply-icon" aria-hidden="true">
        <ReplyIcon />
      </span>
      <Thumb line={line} />
      <span className="chat-reply-what">
        <b className="chat-reply-who">{t(line.mine ? "chat.replyingToMine" : "chat.replyingTo", { name })}</b>
        <span className="chat-reply-words">
          <Words line={line} />
        </span>
      </span>
      <button
        type="button"
        className="chat-reply-cancel"
        onClick={onCancel}
        // (The box keeps the keyboard: the × is pressed while one writes.)
        onMouseDown={(event) => event.preventDefault()}
        aria-label={t("chat.replyCancel")}
        title={t("chat.replyCancel")}
        {...(nav ? { "data-nav": true } : {})}
        data-testid="chat-reply-cancel"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
