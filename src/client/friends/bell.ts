import { partyOpen, type ActivityItem, type ChatNotice, type Friend, type FriendRequest, type FriendsState, type InboxItem } from "../../shared";
import { chatWaiting } from "../chat/notices";
import { isCleared, type Cleared } from "./cleared";
import { madeHere } from "./madeHere";
import { inboxToShow, planStatus } from "./plans";

export const BELL_WAITING = 8;
export const BELL_LATELY = 4;
export const BELL_JOINED = 4;

export interface BellView {
  requests: FriendRequest[];
  inbox: InboxItem[];
  chat: ChatNotice[];
  lately: ActivityItem[];
  joined: Friend[];
  more: number;
}

const joinedSince = (state: FriendsState, seenAt: number, mine: ReadonlySet<string>): Friend[] =>
  seenAt > 0 ? state.friends.filter((friend) => friend.since > seenAt && !mine.has(friend.id)).sort((a, b) => b.since - a.since) : [];

function rank(item: InboxItem, now: number): number {
  if (item.kind === "party") return partyOpen(item, now) ? 0 : 3;
  if (item.kind === "together") return 1;
  if (item.kind !== "plan") return 2;
  const status = planStatus(item, now);
  return status === "due" ? 0 : status === "asks" ? 1 : 3;
}

export function bellView(state: FriendsState, now: number, cleared: Cleared = {}, seenAt = 0, mine: ReadonlySet<string> = madeHere): BellView {
  const requests = [...state.requests].sort((a, b) => b.at - a.at);
  const inbox = inboxToShow(state.inbox, now).sort((a, b) => rank(a, now) - rank(b, now) || b.at - a.at);
  const messages = chatWaiting(state);
  const shownRequests = requests.slice(0, BELL_WAITING);
  const shownInbox = inbox.slice(0, BELL_WAITING - shownRequests.length);
  const shownChat = messages.slice(0, BELL_WAITING - shownRequests.length - shownInbox.length);
  const lately = state.activity
    .filter((item) => state.friends.some((friend) => friend.id === item.friend))
    .sort((a, b) => b.at - a.at)
    .slice(0, BELL_LATELY)
    .filter((item) => !isCleared(cleared, item));
  const shown = shownRequests.length + shownInbox.length + shownChat.length;
  return { requests: shownRequests, inbox: shownInbox, chat: shownChat, lately, joined: joinedSince(state, seenAt, mine).slice(0, BELL_JOINED), more: requests.length + inbox.length + messages.length - shown };
}

export const hasNewActivity = (state: FriendsState, seenAt: number, mine: ReadonlySet<string> = madeHere): boolean =>
  state.activity.some((item) => item.at > seenAt && state.friends.some((friend) => friend.id === item.friend)) || joinedSince(state, seenAt, mine).length > 0;
