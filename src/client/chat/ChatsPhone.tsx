import { useEffect } from "react";
import { Avatar } from "../account/Avatar";
import { Page } from "../controller/AccountScreen";
import { presenceLine } from "../friends/entries";
import { useFriends, useQuickLooks } from "../friends/FriendsProvider";
import { useLanguage, useT } from "../i18n";
import { chatWaiting } from "./notices";
import { previewOf, talkRows, whenOf, type TalkRow } from "./talks";
import { useTalks } from "./useTalks";

function ChatsRow({ row, now, onOpen }: { row: TalkRow; now: number; onOpen: () => void }) {
  const t = useT();
  const language = useLanguage();
  const { friend, last, unread, muted } = row;
  const line = last ? previewOf(last) : presenceLine(friend, now) || t("chats.none");
  return (
    <li>
      <button type="button" className="chats-row" onClick={onOpen} data-testid="chats-row" data-friend={friend.id} data-unread={unread > 0 ? "true" : undefined}>
        <span className="friend-pic" data-online={friend.on && friend.online ? "true" : undefined}>
          <Avatar id={friend.avatar} className="friend-avatar" />
        </span>
        <span className="chats-text">
          <span className="chats-top">
            <b>{friend.name}</b>
            {last && <small className="chats-when">{whenOf(row.at, now, language)}</small>}
          </span>
          <span className="chats-bottom">
            <small className="chats-said" data-testid="chats-said">
              {line}
            </small>
            {unread > 0 && (
              <b className="chats-count" data-muted={muted ? "true" : undefined} aria-label={t("chat.unreadShort", { count: unread })} data-testid="chats-count">
                {unread > 99 ? "99+" : unread}
              </b>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ChatsPhone({ looking, onClose, onOpenChat }: { looking: boolean; onClose: () => void; onOpenChat: (friendId: string) => void }) {
  const t = useT();
  const friends = useFriends();
  const talks = useTalks(looking);
  useQuickLooks(looking);
  useEffect(() => {
    void friends.refresh();
  }, []);
  const { state } = friends;
  const now = Date.now();
  return (
    <Page title={t("chats.title")} onBack={onClose} testId="chats-page">
      {!state ? (
        friends.status === "offline" ? (
          <p className="auth-error" role="alert">
            {t("friends.offline")}
          </p>
        ) : (
          <p className="muted" role="status">
            <span className="spinner" /> {t("common.loading")}
          </p>
        )
      ) : (
        <ul className="chats-list" data-testid="chats-list" aria-busy={talks === null ? "true" : undefined}>
          {talkRows(state.friends, talks ?? [], chatWaiting(state)).map((row) => (
            <ChatsRow key={row.friend.id} row={row} now={now} onOpen={() => onOpenChat(row.friend.id)} />
          ))}
        </ul>
      )}
    </Page>
  );
}
