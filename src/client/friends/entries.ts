import { activityVerb, isLive, listOf, resolveLists, type ActivityItem, type Friend, type FriendLists, type FriendRatings, type InboxItem, type ListInfo, type LiveListItem, type LiveRating, type Message } from "../../shared";
import { ago } from "../account/time";
import { getLanguage, t } from "../i18n";
import { entryOfRating, entryOfSaved, type Entry } from "../tv/pages";

/**
 * Titles that come from friends, as the cards both screens know how to show and open: what a friend recommended, what they
 * watched, what is in their lists and what they rated. Pure; the name of the friend is for the line under the title.
 */

export type Recommendation = Extract<InboxItem, { kind: "recommend" }>;
export type PartyInvitation = Extract<InboxItem, { kind: "party" }>;

/** The name to show for a friend id: the friend's, else nothing. */
export const nameOf = (friends: readonly Friend[], id: string): string => friends.find((friend) => friend.id === id)?.name ?? "";

/** The small line under a friend's name: what they are watching, or last watched, else that they have turned friends off. */
export function friendLine(friend: Friend, activity: readonly ActivityItem[], now: number): string {
  if (!friend.on) return t("friends.paused");
  const item = activity.find((each) => each.friend === friend.id);
  return item ? t(`friends.line.${activityVerb(item, now)}`, { title: item.title }) : "";
}

/** A title a friend sent. Its note, if there is one, is what the page of the title says about it. */
export const entryOfRecommendation = (item: Recommendation, from: string): Entry => ({
  id: `from:${item.id}`,
  title: item.title,
  url: item.url,
  note: t("friends.from", { name: from }),
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year !== undefined ? { year: item.year } : {}),
  ...(item.type ? { kind: item.type } : {}),
  ...(item.note ? { description: item.note } : {}),
});

/** What is sent to a friend to recommend a title: where it plays and how it looks (a note of why, if there is one, goes with it). */
export const recommendationOf = (entry: Entry, note?: string): Message => ({
  kind: "recommend",
  title: entry.title,
  url: new URL(entry.url, location.href).href,
  ...(entry.image ? { image: entry.image } : {}),
  ...(entry.backdrop ? { backdrop: entry.backdrop } : {}),
  ...(entry.year ? { year: entry.year } : {}),
  ...(entry.kind ? { type: entry.kind } : {}),
  ...(note ? { note } : {}),
});

/** Something a friend watched: the line says who and how long ago. */
export const entryOfActivity = (item: ActivityItem, from: string, now: number): Entry => ({
  id: `watched:${item.friend}:${item.key}`,
  title: item.title,
  url: item.url,
  note: `${from} · ${ago(item.at, now, getLanguage())}`,
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year !== undefined ? { year: item.year } : {}),
  ...(item.season !== undefined ? { kind: "series" as const } : {}),
});

/** One of a friend's lists with the titles in it. */
export interface SharedList {
  info: ListInfo;
  items: LiveListItem[];
}

/** A friend's lists as they keep them: the first always (when it has titles), then the others in their order; a list with nothing in it is left out. */
export function listsOf(shared: FriendLists): SharedList[] {
  const items = shared.list.filter(isLive) as LiveListItem[];
  return resolveLists(shared.listNames)
    .map((info) => ({ info, items: items.filter((item) => listOf(item) === info.id) }))
    .filter((each) => each.items.length > 0);
}

export const entriesOfList = (list: SharedList): Entry[] => list.items.map(entryOfSaved);

/** What a friend rated (the ones that were not taken back). */
export const ratedBy = (shared: FriendRatings): LiveRating[] => shared.ratings.filter(isLive) as LiveRating[];

export const entriesOfRatings = (ratings: readonly LiveRating[]): Entry[] => ratings.map(entryOfRating);
