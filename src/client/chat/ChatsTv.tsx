import { useEffect, useState, type CSSProperties, type FocusEvent } from "react";
import { Avatar } from "../account/Avatar";
import { presenceLine } from "../friends/entries";
import { useFriends, useQuickLooks } from "../friends/FriendsProvider";
import { useLanguage, useT } from "../i18n";
import { BackButton, Screen } from "../tv/Idle";
import { chatWaiting } from "./notices";
import { previewOf, talkRows, whenOf, type TalkRow } from "./talks";
import { useTalks } from "./useTalks";

const keyLit = (element: Element): boolean => {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
};

function ChatsLine({ row, at, now, onOpen }: { row: TalkRow; at: number; now: number; onOpen: () => void }) {
  const t = useT();
  const language = useLanguage();
  const [lit, setLit] = useState(false);
  const { friend, last, unread, muted } = row;
  const line = last ? previewOf(last) : presenceLine(friend, now) || t("chats.none");
  return (
    <li className="tv-bell-row" data-lit={lit ? "line" : undefined} style={{ "--i": at } as CSSProperties}>
      <button
        type="button"
        className="tv-bell-line tv-chats-line"
        onClick={onOpen}
        onFocus={(event: FocusEvent<HTMLElement>) => setLit(keyLit(event.currentTarget))}
        onBlur={() => setLit(false)}
        data-nav
        {...(at === 0 ? { "data-autofocus": true } : {})}
        data-testid="tv-chats-row"
        data-friend={friend.id}
        data-unread={unread > 0 ? "true" : undefined}
      >
        <span className="tv-bell-icon tv-chats-pic" data-online={friend.on && friend.online ? "true" : undefined}>
          <Avatar id={friend.avatar} className="tv-bell-avatar" />
        </span>
        <span className="tv-bell-text">
          <b>{friend.name}</b>
          <small data-testid="tv-chats-said">{line}</small>
        </span>
        <span className="tv-chats-side">
          {last && <small className="tv-chats-when">{whenOf(row.at, now, language)}</small>}
          {unread > 0 && (
            <b className="tv-chats-count" data-muted={muted ? "true" : undefined} aria-label={t("chat.unreadShort", { count: unread })} data-testid="tv-chats-count">
              {unread > 99 ? "99+" : unread}
            </b>
          )}
        </span>
      </button>
    </li>
  );
}

export function ChatsTv({ onOpen, onClose }: { onOpen: (friendId: string) => void; onClose: () => void }) {
  const t = useT();
  const friends = useFriends();
  const talks = useTalks(true);
  useQuickLooks(true);
  useEffect(() => {
    void friends.refresh();
  }, []);
  const { state } = friends;
  const now = Date.now();
  return (
    <Screen testId="tv-chats-page" compact focus={state !== null} onBack={onClose} className="tv-chats-screen">
      <h1 className="tv-headline tv-headline-small">{t("chats.title")}</h1>
      {!state ? (
        <p className="tv-lead" role="status">
          <span className="spinner" /> {friends.status === "offline" ? t("friends.offline") : t("common.loading")}
        </p>
      ) : (
        <ul className="tv-bell-list tv-chats-list" data-testid="tv-chats-list" aria-busy={talks === null ? "true" : undefined}>
          {talkRows(state.friends, talks ?? [], chatWaiting(state)).map((row, at) => (
            <ChatsLine key={row.friend.id} row={row} at={at} now={now} onOpen={() => onOpen(row.friend.id)} />
          ))}
        </ul>
      )}
      <BackButton onClick={onClose} testId="tv-chats-back" />
    </Screen>
  );
}
