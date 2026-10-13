import { partyOpen, type ActivityItem, type FriendRequest, type FriendsState, type InboxItem } from "../../shared";

/**
 * What the bell shows: the things that wait for an answer from this profile (requests to be friends, invitations to a watch party, requests to
 * watch together, titles friends sent), and what friends have been watching lately. Pure, so what comes first and what is left for the Friends
 * page can be tested without a screen.
 */

/** How many waiting things the bell lists, and how many of what friends watch: the rest is on the Friends page. */
export const BELL_WAITING = 8;
export const BELL_LATELY = 4;

export interface BellView {
  /** Requests to be friends, the newest first. */
  requests: FriendRequest[];
  /** What friends sent: an invitation to a party that is on first, then a request to watch together, then titles, then invitations to parties that are over; the newest first within each. */
  inbox: InboxItem[];
  /** What friends watch, the newest first, from friends this profile still has. */
  lately: ActivityItem[];
  /** How many waiting things there are beyond the ones listed. */
  more: number;
}

const rank = (item: InboxItem, now: number): number => (item.kind === "party" ? (partyOpen(item, now) ? 0 : 3) : item.kind === "together" ? 1 : 2);

export function bellView(state: FriendsState, now: number): BellView {
  const requests = [...state.requests].sort((a, b) => b.at - a.at);
  const inbox = [...state.inbox].sort((a, b) => rank(a, now) - rank(b, now) || b.at - a.at);
  const shownRequests = requests.slice(0, BELL_WAITING);
  const shownInbox = inbox.slice(0, BELL_WAITING - shownRequests.length);
  const lately = state.activity
    .filter((item) => state.friends.some((friend) => friend.id === item.friend))
    .sort((a, b) => b.at - a.at)
    .slice(0, BELL_LATELY);
  return { requests: shownRequests, inbox: shownInbox, lately, more: requests.length + inbox.length - shownRequests.length - shownInbox.length };
}

/** Whether a friend has watched something since `seenAt` (the last time the bell was opened here): worth a dot on the bell, though nothing waits for an answer. */
export const hasNewActivity = (state: FriendsState, seenAt: number): boolean => state.activity.some((item) => item.at > seenAt && state.friends.some((friend) => friend.id === item.friend));
