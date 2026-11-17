import { useEffect, useRef, useState } from "react";
import { CHAT_ALL_REACTIONS, CHAT_MORE_REACTIONS, CHAT_REACTIONS, isChatReaction, type ChatLine, type ChatReaction } from "../../shared";
import { useT } from "../i18n";
import { PlusIcon } from "../shared/icons";
import { BackButton, Screen } from "../tv/Idle";
import { stickerOf, stickerSrc } from "./stickers";
import type { ChatSession } from "./useChat";
import { quoteOf } from "./words";

/**
 * Reactions on a message (shared/chat.ts `CHAT_REACTIONS`): each of the two can put one on any message, change it or take it away, and both see both under
 * the message. They are drawn with the chat's stickers of the same emoji (all six are in the set); a picture that does not come is the emoji.
 *
 * Where they are put: a phone, a computer or a hand-held screen presses the message and picks from the bar under it (pressing the one that is on takes it
 * away); a TV that is only a remote has "React to Sam's last message" behind the ⋯, a page of six big buttons.
 */

/** One reaction's picture, small or big as its place makes it. */
export function ReactionPicture({ reaction }: { reaction: ChatReaction }) {
  const [failed, setFailed] = useState(false);
  const sticker = stickerOf(reaction);
  if (!sticker || failed) {
    return (
      <span className="chat-reaction-emoji" aria-hidden="true">
        {reaction}
      </span>
    );
  }
  return <img className="chat-reaction-picture" src={stickerSrc(sticker)} alt="" width={192} height={192} decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

/** What is on a message: the friend's reaction and one's own, under it, on the side the message is on. Nothing when there is none. */
export function Reactions({ line, name }: { line: ChatLine; name: string }) {
  const t = useT();
  const shown = ([
    ["theirs", line.theirReaction],
    ["mine", line.myReaction],
  ] as const).filter((each): each is readonly ["theirs" | "mine", ChatReaction] => isChatReaction(each[1]));
  if (shown.length === 0) return null;
  return (
    <span className="chat-reactions" data-testid="chat-reactions">
      {shown.map(([who, reaction]) => (
        <span key={who} className="chat-reaction" role="img" aria-label={who === "mine" ? t("chat.reactedMine", { emoji: reaction }) : t("chat.reacted", { name, emoji: reaction })} title={who === "mine" ? t("chat.you") : name} data-who={who} data-reaction={reaction} data-testid="chat-reaction">
          <ReactionPicture reaction={reaction} />
        </span>
      ))}
    </span>
  );
}

/** Whether a reaction is one of those behind the + (`CHAT_MORE_REACTIONS`): a message that has one opens with them all shown. */
const isMore = (reaction: string | undefined): boolean => reaction !== undefined && (CHAT_MORE_REACTIONS as readonly string[]).includes(reaction);

/**
 * The reactions, and a + after them that brings the sixteen more (the owner, 17 Nov: "more reaction options like that +"). The keys that pressed the + go on
 * to the first of the sixteen, which are where it was.
 */
function useMore(current: string | undefined) {
  const [all, setAll] = useState(() => isMore(current));
  const first = useRef<HTMLButtonElement>(null);
  const keys = useRef(false);
  useEffect(() => {
    if (all && keys.current) first.current?.focus({ preventScroll: true });
    keys.current = false;
  }, [all]);
  const open = (event: { detail: number; currentTarget: HTMLElement }) => {
    keys.current = event.detail === 0 || document.activeElement === event.currentTarget;
    setAll(true);
  };
  return { shown: all ? CHAT_ALL_REACTIONS : CHAT_REACTIONS, all, first, open };
}

/** The bar under a message that was pressed: the six and the +, the one that is on shown as on; pressing it takes it away. */
export function ReactBar({ current, onReact }: { current?: string | undefined; onReact: (reaction: ChatReaction | null) => void }) {
  const t = useT();
  const more = useMore(current);
  return (
    <div className={`chat-react-bar${more.all ? " is-all" : ""}`} role="group" aria-label={t("chat.react")} data-testid="chat-react-bar">
      {more.shown.map((reaction, at) => {
        const on = current === reaction;
        return (
          <button
            type="button"
            key={reaction}
            ref={at === CHAT_REACTIONS.length ? more.first : undefined}
            className={`chat-react${on ? " is-on" : ""}`}
            aria-pressed={on}
            aria-label={reaction}
            onClick={() => onReact(on ? null : reaction)}
            data-reaction={reaction}
            data-testid="chat-react"
          >
            <ReactionPicture reaction={reaction} />
          </button>
        );
      })}
      {!more.all && (
        <button type="button" className="chat-react chat-react-more" aria-label={t("chat.reactMore")} title={t("chat.reactMore")} aria-expanded={false} onClick={more.open} data-testid="chat-react-more">
          <PlusIcon />
        </button>
      )}
    </div>
  );
}

/** The friend's newest message: what "React to Sam's last message" is about. */
export const lastTheirs = (lines: readonly ChatLine[]): ChatLine | undefined => [...lines].reverse().find((line) => !line.mine);

/**
 * The TV's page: the message quoted, then the six as big buttons the remote walks (it lands on the one that is on, else the first), and "Take away my reaction"
 * when there is one. OK puts it on and goes back to the chat; Back goes back without changing anything.
 */
export function ReactTv({ name, line, session, onBack }: { name: string; line: ChatLine; session: ChatSession; onBack: () => void }) {
  const t = useT();
  const current = isChatReaction(line.myReaction) ? line.myReaction : undefined;
  const more = useMore(current);
  const choose = (reaction: ChatReaction | null) => {
    onBack();
    void session.react(line.id, reaction);
  };
  return (
    <Screen key="react" testId="tv-chat-react-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("chat.reactTitle", { name })}</h1>
      <p className="tv-chat-quote" data-testid="tv-chat-react-quote">
        <b>{line.mine ? t("chat.you") : name}</b> {quoteOf(t, line.text)}
      </p>
      <div className={`tv-chat-reacts${more.all ? " is-all" : ""}`} data-testid="tv-chat-reacts">
        {more.shown.map((reaction, at) => {
          const on = current === reaction;
          return (
            <button
              type="button"
              key={reaction}
              ref={at === CHAT_REACTIONS.length ? more.first : undefined}
              className={`tv-chat-react${on ? " is-on" : ""}`}
              aria-pressed={on}
              aria-label={reaction}
              onClick={() => choose(reaction)}
              data-nav
              {...(on || (current === undefined && at === 0) ? { "data-autofocus": true } : {})}
              data-reaction={reaction}
              data-testid="tv-chat-react"
            >
              <ReactionPicture reaction={reaction} />
            </button>
          );
        })}
        {!more.all && (
          <button type="button" className="tv-chat-react tv-chat-react-more" aria-label={t("chat.reactMore")} title={t("chat.reactMore")} aria-expanded={false} onClick={more.open} data-nav data-testid="tv-chat-react-more">
            <PlusIcon />
          </button>
        )}
      </div>
      {current && (
        <button type="button" className="tv-action" onClick={() => choose(null)} data-nav data-testid="tv-chat-react-remove">
          {t("chat.reactRemove")}
        </button>
      )}
      <BackButton onClick={onBack} testId="tv-chat-react-back" />
    </Screen>
  );
}
