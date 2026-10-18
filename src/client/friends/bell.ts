import { partyOpen, type ActivityItem, type ChatNotice, type FriendRequest, type FriendsState, type InboxItem } from "../../shared";
import { chatWaiting } from "../chat/notices";
import { inboxToShow, planStatus } from "./plans";

/**
 * What the bell shows: the things that wait for an answer from this profile (requests to be friends, invitations to a watch party, requests to
 * watch together, titles friends sent), the friends who wrote and are not answered yet, and what friends have been watching lately. Pure, so what comes first and what is left for the Friends
 * page can be tested without a screen.
 */

/** How many waiting things the bell lists, and how many of what friends watch: the rest is on the Friends page. */
export const BELL_WAITING = 8;
export const BELL_LATELY = 4;

export interface BellView {
  /** Requests to be friends, the newest first. */
  requests: FriendRequest[];
  /** What friends sent: an invitation to a party that is on first (and a plan whose time has come), then a request to watch together and a plan that asks for an answer, then titles, then news of plans and invitations to parties that are over; the newest first within each. */
  inbox: InboxItem[];
  /** The friends whose messages have not been looked at, the newest first: told after what asks for an answer, in the same few places. */
  chat: ChatNotice[];
  /** What friends watch, the newest first, from friends this profile still has. */
  lately: ActivityItem[];
  /** How many waiting things there are beyond the ones listed. */
  more: number;
}

function rank(item: InboxItem, now: number): number {
  if (item.kind === "party") return partyOpen(item, now) ? 0 : 3;
  if (item.kind === "together") return 1;
  if (item.kind !== "plan") return 2;
  const status = planStatus(item, now);
  return status === "due" ? 0 : status === "asks" ? 1 : 3;
}

export function bellView(state: FriendsState, now: number): BellView {
  const requests = [...state.requests].sort((a, b) => b.at - a.at);
  const inbox = inboxToShow(state.inbox, now).sort((a, b) => rank(a, now) - rank(b, now) || b.at - a.at);
  const messages = chatWaiting(state);
  const shownRequests = requests.slice(0, BELL_WAITING);
  const shownInbox = inbox.slice(0, BELL_WAITING - shownRequests.length);
  const shownChat = messages.slice(0, BELL_WAITING - shownRequests.length - shownInbox.length);
  const lately = state.activity
    .filter((item) => state.friends.some((friend) => friend.id === item.friend))
    .sort((a, b) => b.at - a.at)
    .slice(0, BELL_LATELY);
  const shown = shownRequests.length + shownInbox.length + shownChat.length;
  return { requests: shownRequests, inbox: shownInbox, chat: shownChat, lately, more: requests.length + inbox.length + messages.length - shown };
}

/** Whether a friend has watched something since `seenAt` (the last time the bell was opened here): worth a dot on the bell, though nothing waits for an answer. */
export const hasNewActivity = (state: FriendsState, seenAt: number): boolean => state.activity.some((item) => item.at > seenAt && state.friends.some((friend) => friend.id === item.friend));
