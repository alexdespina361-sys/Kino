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

export function quoteWords(t: ChatT, line: ChatLine): string {
  if (line.sticker) return t("chat.quoteSticker");
  if (gifOf(line.text)) return t("chat.gifAlt");
  const sticker = stickerOf(line.text);
  if (sticker) return t("chat.stickerSaid", { emoji: sticker.emoji });
  const found = titleIn(line.text);
  return found ? found.rest || found.link : line.text;
}

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

function Thumb({ line }: { line: ChatLine }) {
  const [failed, setFailed] = useState(false);
  const sticker = line.sticker ? null : stickerOf(line.text);
  if (!sticker || failed) return null;
  return <img className="chat-quote-pic" src={stickerSrc(sticker)} alt="" width={192} height={192} decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

export const quoteLabel = (t: ChatT, quoted: ChatLine, name: string): string => t(quoted.mine ? "chat.inReplyToMine" : "chat.inReplyTo", { name, text: quoteWords(t, quoted) });

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
    event.stopPropagation();
    onShow();
  };
  return (
    <button type="button" className="chat-quote" data-of={quoted.mine ? "mine" : "theirs"} onClick={show} aria-label={label} title={label} {...(focusable ? {} : { tabIndex: -1 })} data-testid="chat-quote">
      {inside}
    </button>
  );
}

export function backLetsAnswerGo(event: KeyboardEvent<HTMLElement>, answering: boolean, letGo: () => void, box: string): void {
  if (!answering || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || actionForKey(event.nativeEvent) !== "back") return;
  if (!(event.target instanceof HTMLElement) || !event.target.matches(`[data-testid='${box}']`)) return;
  event.preventDefault();
  event.stopPropagation();
  letGo();
}

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
