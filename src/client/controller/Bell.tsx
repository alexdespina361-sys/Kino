import { useEffect, useState } from "react";
import { activityVerb, type ActivityItem, type ChatNotice, type Friend, type TitleNotice } from "../../shared";
import { Avatar } from "../account/Avatar";
import { ago } from "../account/time";
import { bellView } from "../friends/bell";
import { entryOfActivity } from "../friends/entries";
import { useClearChat } from "../chat/useClearChat";
import { useFriends } from "../friends/FriendsProvider";
import { useBell } from "../friends/useBell";
import { useCleared } from "../friends/useCleared";
import { useLanguage, useT } from "../i18n";
import { BellIcon, CloseIcon, UsersIcon } from "../shared/icons";
import { chatsApart, withoutChat } from "../chat/apart";
import { chatWaiting } from "../chat/notices";
import type { Entry } from "../tv/pages";
import { InboxRow, RequestRow } from "./Friends";
import { Sheet } from "./Sheet";
import { ShownTitle } from "../shared/Shown";
import { useSwipeAway } from "../shared/swipe";
import { BELL_TITLES, entryOfNotice, noticeLine, useTitleNotices } from "../titleNotices/notices";

export function ChatsButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const friends = useFriends();
  if (!friends.on || !chatsApart(friends.state)) return null;
  const count = chatWaiting(friends.state).length;
  return (
    <button className="icon-btn bell-button chats-button" onClick={onClick} aria-label={count > 0 ? t("chats.ariaCount", { count }) : t("chats.title")} data-testid="chats-button">
      <UsersIcon />
      {count > 0 && (
        <b className="bell-badge" data-testid="chats-badge">
          {count > 9 ? "9+" : count}
        </b>
      )}
    </button>
  );
}

export function BellButton({ onClick, chatsApart: apart = false }: { onClick: () => void; chatsApart?: boolean }) {
  const t = useT();
  const bell = useBell(apart);
  if (!bell.on) return null;
  return (
    <button className="icon-btn bell-button" onClick={onClick} aria-label={bell.badge > 0 ? t("bell.ariaCount", { count: bell.badge }) : t("bell.title")} data-testid="bell-button">
      <BellIcon />
      {bell.badge > 0 ? (
        <b className="bell-badge" data-testid="bell-badge">
          {bell.badge > 9 ? "9+" : bell.badge}
        </b>
      ) : (
        bell.fresh && <i className="bell-dot" aria-hidden="true" data-testid="bell-dot" />
      )}
    </button>
  );
}

function LatelyRow({ item, friend, onOpen, onClear }: { item: ActivityItem; friend: Friend; onOpen: (entry: Entry) => void; onClear: () => void }) {
  const t = useT();
  const language = useLanguage();
  const now = Date.now();
  const swipe = useSwipeAway(onClear);
  return (
    <li className="inbox-item" data-testid="bell-lately-item" {...swipe}>
      <button className="bell-lately" onClick={() => onOpen(entryOfActivity(item, friend.name, now))} aria-label={`${t("rows.open")} ${item.title}`}>
        <Avatar id={friend.avatar} className="friend-avatar" />
        <span className="inbox-text">
          <b>{friend.name}</b>
          <small>{`${t(`friends.line.${activityVerb(item, now)}`, { title: item.title })} · ${ago(item.at, now, language)}`}</small>
        </span>
      </button>
      <button className="mini" onClick={onClear} aria-label={t("friends.dismiss")} data-testid="bell-lately-clear">
        <CloseIcon />
      </button>
    </li>
  );
}

function JoinedRow({ friend, onOpen }: { friend: Friend; onOpen: () => void }) {
  const t = useT();
  const language = useLanguage();
  return (
    <li className="inbox-item" data-testid="bell-joined-item" data-friend={friend.id}>
      <button className="bell-lately" onClick={onOpen}>
        <Avatar id={friend.avatar} className="friend-avatar" />
        <span className="inbox-text">
          <b>{friend.name}</b>
          <small>{`${t("bell.nowFriends")} · ${ago(friend.since, Date.now(), language)}`}</small>
        </span>
      </button>
    </li>
  );
}

function ChatRow({ notice, friend, onOpen, onClear }: { notice: ChatNotice; friend: Friend; onOpen: () => void; onClear: () => void }) {
  const t = useT();
  const swipe = useSwipeAway(onClear);
  return (
    <li className="inbox-item" data-testid="bell-chat-item" data-friend={friend.id} {...swipe}>
      <button className="bell-lately" onClick={onOpen} data-testid="bell-chat-open">
        <Avatar id={friend.avatar} className="friend-avatar" />
        <span className="inbox-text">
          <b>{t("chat.unread", { count: notice.count, name: friend.name })}</b>
        </span>
      </button>
      <button className="mini" onClick={onClear} aria-label={t("friends.dismiss")} data-testid="bell-chat-clear">
        <CloseIcon />
      </button>
    </li>
  );
}

function TitleNoticeRow({ notice, onOpen, onClear }: { notice: TitleNotice; onOpen: (entry: Entry) => void; onClear: () => void }) {
  const t = useT();
  const swipe = useSwipeAway(onClear);
  const entry = entryOfNotice(notice);
  return (
    <li className="inbox-item" data-testid="bell-title-item" data-title={notice.id} {...swipe}>
      <button className="bell-lately" onClick={() => onOpen(entry)} data-testid="bell-title-open">
        {notice.image ? <img className="bell-title-poster" src={notice.image} alt="" loading="lazy" /> : <span className="bell-title-poster" aria-hidden="true" />}
        <span className="inbox-text">
          <b>
            <ShownTitle of={entry} />
          </b>
          <small>{noticeLine(notice)}</small>
        </span>
      </button>
      <button className="mini" onClick={onClear} aria-label={t("friends.dismiss")} data-testid="bell-title-clear">
        <CloseIcon />
      </button>
    </li>
  );
}

export function NotificationsSheet({
  onClose,
  onOpenTitle,
  onStartParty,
  onOpenFriends,
  onOpenChat,
  chatsApart: apart = false,
}: {
  onClose: () => void;
  onOpenTitle: (entry: Entry) => void;
  onStartParty?: (friendId: string) => void;
  onOpenFriends: () => void;
  onOpenChat: (friendId: string) => void;
  chatsApart?: boolean;
}) {
  const t = useT();
  const friends = useFriends();
  const { markSeen, seen } = useBell();
  const [seenBefore] = useState(seen);
  const { cleared, clear } = useCleared();
  const clearChat = useClearChat();
  const { state } = friends;

  useEffect(() => {
    void friends.refresh();
    markSeen();
  }, []);
  useEffect(() => {
    if (friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [friends.unread]);
  const titles = useTitleNotices();
  const fresh = titles.items.slice(0, BELL_TITLES);
  useEffect(() => {
    if (titles.unread > 0) titles.seen();
  }, [titles.unread]);

  const view = state ? bellView(apart ? withoutChat(state) : state, Date.now(), cleared, seenBefore) : friends.on ? null : { requests: [], inbox: [], chat: [], lately: [], joined: [], more: 0 };
  const people = state?.friends ?? [];
  const waiting = view !== null && view.requests.length + view.inbox.length + view.chat.length > 0;
  return (
    <Sheet title={t("bell.title")} onClose={onClose} testId="bell-sheet">
      {!view ? (
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
        <>
          {!waiting && fresh.length === 0 && view.joined.length === 0 && view.lately.length === 0 && (
            <div className="bell-empty" data-testid="bell-empty">
              <span className="bell-empty-icon" aria-hidden="true">
                <BellIcon />
              </span>
              <b>{t("bell.emptyTitle")}</b>
              <p className="muted">{t("bell.empty")}</p>
            </div>
          )}
          {fresh.length > 0 && (
            <>
              <h3 className="sheet-section">{t("bell.newTitles")}</h3>
              <ul className="inbox-list" data-testid="bell-titles">
                {fresh.map((notice) => (
                  <TitleNoticeRow
                    key={notice.id}
                    notice={notice}
                    onOpen={(entry) => {
                      onClose();
                      onOpenTitle(entry);
                    }}
                    onClear={() => titles.dismiss(notice.id)}
                  />
                ))}
              </ul>
            </>
          )}
          {waiting && (
            <>
              <h3 className="sheet-section">{t("bell.waiting")}</h3>
              <ul className="inbox-list" data-testid="bell-waiting">
                {view.requests.map((request) => (
                  <RequestRow key={`request:${request.from.id}`} request={request} />
                ))}
                {view.inbox.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    friend={people.find((each) => each.id === item.from)}
                    onOpenTitle={(entry) => {
                      onClose();
                      onOpenTitle(entry);
                    }}
                    onStartParty={
                      onStartParty
                        ? (friendId) => {
                            onClose();
                            onStartParty(friendId);
                          }
                        : undefined
                    }
                    onDismiss={() => void friends.dismiss(item.id).catch(() => undefined)}
                  />
                ))}
                {view.chat.map((notice) => (
                  <ChatRow
                    key={`chat:${notice.friend}`}
                    notice={notice}
                    friend={people.find((each) => each.id === notice.friend)!}
                    onOpen={() => {
                      onClose();
                      onOpenChat(notice.friend);
                    }}
                    onClear={() => clearChat(notice.friend)}
                  />
                ))}
              </ul>
              {view.more > 0 && (
                <p className="muted small" data-testid="bell-more">
                  {t("bell.more", { count: view.more })}
                </p>
              )}
            </>
          )}
          {view.joined.length > 0 && (
            <>
              <h3 className="sheet-section">{t("bell.joined")}</h3>
              <ul className="inbox-list" data-testid="bell-joined">
                {view.joined.map((friend) => (
                  <JoinedRow
                    key={friend.id}
                    friend={friend}
                    onOpen={() => {
                      onClose();
                      onOpenFriends();
                    }}
                  />
                ))}
              </ul>
            </>
          )}
          {view.lately.length > 0 && (
            <>
              <h3 className="sheet-section sheet-section-with-action">
                {t("friends.activity")}
                <button className="sheet-clear" onClick={() => clear(view.lately)} data-testid="bell-lately-clear-all">
                  {t("common.clear")}
                </button>
              </h3>
              <ul className="inbox-list" data-testid="bell-lately">
                {view.lately.map((item) => (
                  <LatelyRow
                    key={`${item.friend}:${item.key}`}
                    item={item}
                    friend={people.find((each) => each.id === item.friend)!}
                    onOpen={(entry) => {
                      onClose();
                      onOpenTitle(entry);
                    }}
                    onClear={() => clear([item])}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {friends.on && (
        <button
          className="btn btn-block"
          onClick={() => {
            onClose();
            onOpenFriends();
          }}
          data-testid="bell-open-friends"
        >
          {t("bell.openFriends")}
        </button>
      )}
    </Sheet>
  );
}
