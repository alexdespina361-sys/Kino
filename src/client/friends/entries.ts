import { activityVerb, isLive, listOf, ratingKey, resolveLists, titleLink, type ActivityItem, type Friend, type FriendLists, type FriendProgress, type FriendRatings, type InboxItem, type ListInfo, type LiveListItem, type LiveRating, type Message } from "../../shared";
import { ago, formatDay } from "../account/time";
import { dayOf, stampOf } from "../chat/state";
import { getLanguage, t } from "../i18n";
import { entryOfRating, entryOfSaved, type Entry } from "../tv/pages";

export type Recommendation = Extract<InboxItem, { kind: "recommend" }>;
export type PartyInvitation = Extract<InboxItem, { kind: "party" }>;
export type TogetherRequest = Extract<InboxItem, { kind: "together" }>;

export const nameOf = (friends: readonly Friend[], id: string): string => friends.find((friend) => friend.id === id)?.name ?? "";

const LAST_ONLINE_AGO_MS = 7 * 24 * 3600 * 1000;

export function presenceLine(friend: Friend, now: number): string {
  if (!friend.on) return "";
  if (friend.online) return t("friends.online");
  if (friend.lastOnline === undefined) return "";
  const then = Math.min(friend.lastOnline, now);
  if (now - then < 60_000) return t("friends.lastOnlineNow");
  return now - then < LAST_ONLINE_AGO_MS ? t("friends.lastOnline", { when: ago(then, now, getLanguage()) }) : t("friends.lastOnlineDay", { day: formatDay(then, getLanguage()) });
}

export function presenceInChat(friend: Friend, now: number): string {
  if (!friend.on) return "";
  if (friend.online) return t("friends.online");
  if (friend.lastOnline === undefined) return "";
  const then = Math.min(friend.lastOnline, now);
  if (now - then < 60_000) return t("friends.lastOnlineNow");
  const language = getLanguage();
  const [day, time] = [dayOf(then, now, language), stampOf(then, language)];
  return day && time ? t("chat.lastOnlineAt", { day, time }) : presenceLine(friend, now);
}

export function friendLine(friend: Friend, activity: readonly ActivityItem[], now: number): string {
  if (!friend.on) return t("friends.paused");
  const item = activity.find((each) => each.friend === friend.id);
  if (item) return t(`friends.line.${activityVerb(item, now)}`, { title: item.title });
  return presenceLine(friend, now);
}

export function friendHeadline(friend: Friend, activity: readonly ActivityItem[], now: number): string {
  if (!friend.on) return t("friends.paused");
  const item = activity.find((each) => each.friend === friend.id);
  return [item ? t(`friends.line.${activityVerb(item, now)}`, { title: item.title }) : "", presenceLine(friend, now)].filter(Boolean).join("  ·  ");
}

export function activityHint(friend: Friend, iGet: boolean): string | undefined {
  if (!friend.on || friend.activity) return undefined;
  return iGet ? t("friends.hintTheirs", { name: friend.name }) : t("friends.hintMine", { name: friend.name, switch: t("friends.switchGive") });
}

const episodeOf = (card: { season?: number | undefined; episode?: number | undefined }): string | undefined => (card.season !== undefined && card.episode !== undefined ? `S${card.season}:E${card.episode}` : undefined);

export const progressFor = (progress: readonly FriendProgress[] | undefined, url: string): FriendProgress | undefined => progress?.find((each) => each.link === titleLink(url));

export function progressNote(progress: Pick<FriendProgress, "season" | "episode" | "percent" | "done">): string | undefined {
  const state = progress.done ? t("card.watched") : progress.percent !== undefined ? `${progress.percent}%` : undefined;
  return [episodeOf(progress), state].filter(Boolean).join(" · ") || undefined;
}

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

export interface SharedList {
  info: ListInfo;
  items: LiveListItem[];
}

export function listsOf(shared: FriendLists): SharedList[] {
  const items = shared.list.filter(isLive) as LiveListItem[];
  return resolveLists(shared.listNames)
    .map((info) => ({ info, items: items.filter((item) => listOf(item) === info.id) }))
    .filter((each) => each.items.length > 0);
}

export const entriesOfList = (list: SharedList): Entry[] => list.items.map(entryOfSaved);

export function bothWant(lists: readonly SharedList[], mine: readonly { url: string }[]): LiveListItem[] {
  const ours = new Set(mine.map((item) => titleLink(item.url)));
  const taken = new Set<string>();
  return lists
    .flatMap((list) => list.items)
    .filter((item) => {
      const link = titleLink(item.url);
      if (!ours.has(link) || taken.has(link)) return false;
      taken.add(link);
      return true;
    });
}

export const scoresByTitle = (ratings: readonly Pick<LiveRating, "url" | "season" | "score">[]): ReadonlyMap<string, number> =>
  new Map(ratings.map((rating) => [ratingKey(rating.url, rating.season), rating.score] as const));
export const myScoreFor = (scores: ReadonlyMap<string, number>, rating: Pick<LiveRating, "url" | "season">): number | undefined => scores.get(ratingKey(rating.url, rating.season));

export const ratedBy = (shared: FriendRatings): LiveRating[] => shared.ratings.filter(isLive) as LiveRating[];

export const entriesOfRatings = (ratings: readonly LiveRating[]): Entry[] => ratings.map(entryOfRating);
