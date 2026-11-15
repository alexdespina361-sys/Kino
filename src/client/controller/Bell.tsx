import { useEffect } from "react";
import { activityVerb, type ActivityItem, type ChatNotice, type Friend } from "../../shared";
import { Avatar } from "../account/Avatar";
import { ago } from "../account/time";
import { bellView } from "../friends/bell";
import { entryOfActivity } from "../friends/entries";
import { useClearChat } from "../chat/useClearChat";
import { useFriends } from "../friends/FriendsProvider";
import { useBell } from "../friends/useBell";
import { useCleared } from "../friends/useCleared";
import { useLanguage, useT } from "../i18n";
import { BellIcon, CloseIcon } from "../shared/icons";
import type { Entry } from "../tv/pages";
import { InboxRow, RequestRow } from "./Friends";
import { Sheet } from "./Sheet";
import { useSwipeAway } from "./swipe";

/** The bell beside the profile's picture: how many things wait for an answer, or a quiet dot when friends only watched something. Not there while friends are off. */
export function BellButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const bell = useBell();
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

/** Something a friend watched, as a row that opens the title. The cross, or a swipe to the side, takes it off the list on this device. */
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

/**
 * A friend who wrote, as a row that opens the chat with them (their messages are not read here: the bell only says how many wait). The cross, or a
 * swipe to the side, marks the chat read without opening it: the messages stay in the chat.
 */
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

/**
 * What the bell opens: what waits for an answer from this profile (requests to be friends, invitations, requests to watch together, titles
 * friends sent, each with its buttons), the friends who wrote (a row each, that opens the chat) and what friends watch lately, with a way on to
 * the Friends page for the rest. Opening it is looking.
 */
export function NotificationsSheet({
  onClose,
  onOpenTitle,
  onStartParty,
  onOpenFriends,
  onOpenChat,
}: {
  onClose: () => void;
  onOpenTitle: (entry: Entry) => void;
  /** Not given on a phone that has no TV to host a party on. */
  onStartParty?: (friendId: string) => void;
  onOpenFriends: () => void;
  /** A row of a friend who wrote was pressed: the chat with them is opened, over whatever the bell was over. */
  onOpenChat: (friendId: string) => void;
}) {
  const t = useT();
  const friends = useFriends();
  const { markSeen } = useBell();
  const { cleared, clear } = useCleared();
  const clearChat = useClearChat();
  const { state } = friends;

  // Opening it is seeing what is in the inbox, and how things stand now.
  useEffect(() => {
    void friends.refresh();
    markSeen();
  }, []);
  useEffect(() => {
    if (friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [friends.unread]);

  const view = state ? bellView(state, Date.now(), cleared) : null;
  const waiting = view !== null && view.requests.length + view.inbox.length + view.chat.length > 0;
  return (
    <Sheet title={t("bell.title")} onClose={onClose} testId="bell-sheet">
      {!state || !view ? (
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
          {!waiting && view.lately.length === 0 && (
            <p className="muted" data-testid="bell-empty">
              {t("bell.empty")}
            </p>
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
                    friend={state.friends.find((each) => each.id === item.from)}
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
                    friend={state.friends.find((each) => each.id === notice.friend)!}
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
                    friend={state.friends.find((each) => each.id === item.friend)!}
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
    </Sheet>
  );
}
