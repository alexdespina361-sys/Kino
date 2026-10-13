import { activityVerb, isLive, listOf, resolveLists, titleLink, type ActivityItem, type Friend, type FriendLists, type FriendProgress, type FriendRatings, type InboxItem, type ListInfo, type LiveListItem, type LiveRating, type Message } from "../../shared";
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

/** The small line under a friend's name: that they have turned friends off, else what they are watching or last watched, else that they are online. */
export function friendLine(friend: Friend, activity: readonly ActivityItem[], now: number): string {
  if (!friend.on) return t("friends.paused");
  const item = activity.find((each) => each.friend === friend.id);
  if (item) return t(`friends.line.${activityVerb(item, now)}`, { title: item.title });
  return friend.online ? t("friends.online") : "";
}

/** The episode a card is at ("S2:E5"), when it is of a show. */
const episodeOf = (card: { season?: number | undefined; episode?: number | undefined }): string | undefined => (card.season !== undefined && card.episode !== undefined ? `S${card.season}:E${card.episode}` : undefined);

/** How far a friend got in the title at `url`, if they have started it. */
export const progressFor = (progress: readonly FriendProgress[] | undefined, url: string): FriendProgress | undefined => progress?.find((each) => each.link === titleLink(url));

/** How far a friend got in a title, for the line under it: the episode they are at and how far into it ("S2:E5 · 63%"), or that it is watched. */
export function progressNote(progress: Pick<FriendProgress, "season" | "episode" | "percent" | "done">): string | undefined {
  const state = progress.done ? t("card.watched") : progress.percent !== undefined ? `${progress.percent}%` : undefined;
  return [episodeOf(progress), state].filter(Boolean).join(" · ") || undefined;
}

/**
 * The cards of a friend's page with how far the friend got in each: the thin bar over the picture, and the episode and percent first in
 * the line under the title (before what the line said: the list it is in, the score). A title the friend has not started is left as it is.
 */
export function withProgress(entries: readonly Entry[], progress: readonly FriendProgress[] | undefined): Entry[] {
  if (!progress || progress.length === 0) return [...entries];
  const found = new Map(progress.map((each) => [each.link, each]));
  return entries.map((entry) => {
    const got = found.get(titleLink(entry.url));
    if (!got) return entry;
    const how = progressNote(got);
    const fraction = got.done ? 1 : got.percent !== undefined ? got.percent / 100 : undefined;
    const note = [how, entry.note].filter(Boolean).join(" · ");
    return { ...entry, ...(fraction !== undefined ? { progress: fraction } : {}), ...(note ? { note } : {}) };
  });
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

/** Something a friend watched: the line says who, the episode of a show and how long ago; the bar over the picture says how far in. */
export const entryOfActivity = (item: ActivityItem, from: string, now: number): Entry => ({
  id: `watched:${item.friend}:${item.key}`,
  title: item.title,
  url: item.url,
  note: [from, episodeOf(item), ago(item.at, now, getLanguage())].filter(Boolean).join(" · "),
  ...(item.image ? { image: item.image } : {}),
  ...(item.backdrop ? { backdrop: item.backdrop } : {}),
  ...(item.year !== undefined ? { year: item.year } : {}),
  ...(item.season !== undefined ? { kind: "series" as const } : {}),
  ...(item.percent !== undefined ? { progress: item.percent / 100 } : {}),
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
