import { activityVerb, canAskTogether, partyOpen, tagLabel, type ActivityItem, type Friend, type FriendLists, type FriendRatings, type FriendRequest, type FriendsState, type LiveRating, type PlanItem } from "../../shared";
import { listName } from "../account/cards";
import { chatWaiting, waitingFrom } from "../chat/notices";
import { sortRatings } from "../account/ratingText";
import { ago, formatDay } from "../account/time";
import { getLanguage, t } from "../i18n";
import { formatCode } from "../shared/format";
import { entryOfRating, entryOfSaved, type Entry, type GridPage, type HomeRow, type View } from "../tv/pages";
import { BELL_WAITING, bellView } from "./bell";
import type { Cleared } from "./cleared";
import { inboxToShow, planLines, planStatus, type PlanStatus } from "./plans";
import { activityHint, bothWant, entriesOfList, entryOfActivity, entryOfRecommendation, friendHeadline, friendLine, listsOf, myScoreFor, nameOf, ratedBy, scoresByTitle, withProgress, type PartyInvitation, type Recommendation, type TogetherRequest } from "./entries";

const entryOfParty = (item: PartyInvitation, from: string, now: number): Entry => ({
  id: `party:${item.id}`,
  title: t("friends.partyOf", { name: from }),
  url: "",
  party: item.code,
  inboxId: item.id,
  note: `${formatCode(item.code)} · ${ago(item.at, now, getLanguage())}`,
});

const entryOfEndedParty = (item: PartyInvitation, from: Friend, now: number): Entry => ({
  id: `party:${item.id}`,
  title: t("friends.partyOf", { name: from.name }),
  url: "",
  ask: from.id,
  inboxId: item.id,
  note: `${t("friends.partyOver")} · ${ago(item.at, now, getLanguage())}`,
});

const entryOfRequest = (item: TogetherRequest, from: string, now: number): Entry => ({
  id: `together:${item.id}`,
  title: t("friends.togetherOf", { name: from }),
  url: "",
  wants: item.from,
  inboxId: item.id,
  note: ago(item.at, now, getLanguage()),
});

const entryOfPlan = (item: PlanItem, from: string, now: number): Entry => {
  const { heading, detail } = planLines(item, from, now);
  return { id: `plan:${item.id}`, title: heading, url: "", note: detail, inboxId: item.id, ...(planStatus(item, now) === "due" ? { wants: item.from } : { plan: item.id }) };
};
const PLAN_ORDER: Record<PlanStatus, number> = { due: 0, asks: 1, agreed: 2, declined: 3, lapsed: 4 };

const entryOfFriendRequest = (item: FriendRequest): Entry => ({
  id: `request:${item.from.id}`,
  title: tagLabel(item.from.name, item.from.tag),
  url: "",
  request: item.from,
  avatar: item.from.avatar,
  note: t("friends.requestWants"),
});

const entryOfFriend = (friend: Friend, activity: readonly ActivityItem[], now: number, unread = 0): Entry => ({
  id: `friend:${friend.id}`,
  title: friend.name,
  url: "",
  opens: { kind: "friend", id: friend.id },
  avatar: friend.avatar,
  ...(friend.on && friend.online ? { online: true } : {}),
  note: (unread > 0 ? t("chat.unreadShort", { count: unread }) : friendLine(friend, activity, now)) || t("friends.since", { day: formatDay(friend.since, getLanguage()) }),
});

const entryOfChat = (friend: Friend, count: number): Entry => ({
  id: `chat:${friend.id}`,
  title: t("chat.unread", { count, name: friend.name }),
  url: "",
  chat: friend.id,
  avatar: friend.avatar,
});

const addTile = (): Entry => ({ id: "add-friend", title: t("friends.add"), url: "", action: "addFriend" });
const settingsTile = (): Entry => ({ id: "friend-settings", title: t("friends.settingsTile"), url: "", action: "friendSettings" });
const activityOffTile = (): Entry => ({ id: "activity-off", title: t("friends.turnOn"), url: "", note: t("friends.switchGive"), action: "friendSettings" });

const ASKING_ROWS: readonly string[] = ["friend-requests", "friend-parties", "friend-plans", "friend-sent"];

export const FRIEND_ROWS = 3;
const NO_PLACE = 1_000_000;

export function friendOrder(state: FriendsState | null): Friend[] {
  const wrote = new Map(chatWaiting(state).map((notice, place) => [notice.friend, place]));
  const lately = new Map<string, number>();
  (state?.activity ?? []).forEach((item, place) => {
    if (!lately.has(item.friend)) lately.set(item.friend, place);
  });
  const ranked = (friend: Friend) => ({ paused: friend.on ? 0 : 1, wrote: wrote.get(friend.id) ?? NO_PLACE, lately: lately.get(friend.id) ?? NO_PLACE });
  return [...(state?.friends ?? [])].sort((a, b) => {
    const [x, y] = [ranked(a), ranked(b)];
    return x.paused - y.paused || x.wrote - y.wrote || x.lately - y.lately || a.name.localeCompare(b.name, getLanguage());
  });
}

export function watchedLately(friends: readonly Friend[], activity: readonly ActivityItem[]): Array<{ friend: Friend; items: ActivityItem[] }> {
  const items = new Map<string, ActivityItem[]>();
  for (const item of activity) items.set(item.friend, [...(items.get(item.friend) ?? []), item]);
  return [...items]
    .flatMap(([id, watched]) => {
      const friend = friends.find((each) => each.id === id);
      return friend ? [{ friend, items: watched }] : [];
    })
    .slice(0, FRIEND_ROWS);
}

function watchedRows(friends: readonly Friend[], activity: readonly ActivityItem[], now: number): HomeRow[] {
  return watchedLately(friends, activity).map(({ friend, items }): HomeRow => ({ id: `friend-watched:${friend.id}`, layout: "wide", title: t("friends.watchedBy", { name: friend.name }), entries: items.map((item) => entryOfActivity(item, "", now)) }));
}

export function friendsSummary(state: FriendsState | null): string {
  const friends = state?.friends ?? [];
  if (friends.length === 0) return t("friends.none");
  const online = friends.filter((friend) => friend.on && friend.online).length;
  const count = t("friends.count", { count: friends.length });
  return online > 0 ? `${count}  ·  ${t("friends.onlineCount", { count: online })}` : count;
}

export function friendRows(state: FriendsState | null, now: number, iGet = true): HomeRow[] {
  const friends = state?.friends ?? [];
  const inbox = state?.inbox ?? [];
  const activity = state?.activity ?? [];
  const requests = state?.requests ?? [];
  const rows: HomeRow[] = [{ id: "friend-people", layout: "categories", title: t("friends.yours"), entries: [...friendOrder(state).map((friend) => entryOfFriend(friend, activity, now, waitingFrom(state, friend.id))), addTile(), settingsTile()] }];

  if (requests.length > 0) rows.push({ id: "friend-requests", layout: "categories", title: t("friends.requests"), entries: requests.map(entryOfFriendRequest) });

  const parties = inbox.flatMap((item): Entry[] => {
    if (item.kind === "together") return [entryOfRequest(item, nameOf(friends, item.from), now)];
    if (item.kind !== "party") return [];
    if (partyOpen(item, now)) return [entryOfParty(item, nameOf(friends, item.from), now)];
    const from = friends.find((friend) => friend.id === item.from);
    return from && canAskTogether(from) ? [entryOfEndedParty(item, from, now)] : [];
  });
  if (parties.length > 0) rows.push({ id: "friend-parties", layout: "wide", title: t("friends.partiesRow"), entries: parties });

  const plans = inboxToShow(inbox, now)
    .filter((item): item is PlanItem => item.kind === "plan")
    .sort((a, b) => PLAN_ORDER[planStatus(a, now)] - PLAN_ORDER[planStatus(b, now)] || a.when - b.when);
  if (plans.length > 0) rows.push({ id: "friend-plans", layout: "wide", title: t("friends.plansRow"), entries: plans.map((item) => entryOfPlan(item, nameOf(friends, item.from), now)) });

  const sent = inbox.filter((item): item is Recommendation => item.kind === "recommend");
  if (sent.length > 0) rows.push({ id: "friend-sent", layout: "wide", title: t("friends.inbox"), entries: sent.map((item) => ({ ...entryOfRecommendation(item, nameOf(friends, item.from)), inboxId: item.id })) });

  rows.push(...watchedRows(friends, activity, now));

  if (activity.length === 0 && !iGet && friends.some((friend) => friend.on)) rows.push({ id: "friend-activity-off", layout: "categories", title: t("friends.activity"), entries: [activityOffTile()] });
  return rows.map((row) => (ASKING_ROWS.includes(row.id) ? { ...row, group: t("bell.waiting") } : row));
}

export interface BellRow {
  entry: Entry;
  heading: string;
  detail?: string | undefined;
  avatar?: Entry["avatar"];
  activity?: ActivityItem;
  notice?: string;
}

export function bellRows(state: FriendsState | null, now: number, cleared: Cleared = {}, seenAt = 0): { waiting: BellRow[]; joined: BellRow[]; lately: BellRow[]; more: number } {
  if (!state) return { waiting: [], joined: [], lately: [], more: 0 };
  const rows = friendRows(state, now);
  const asking = rows.filter((row) => ASKING_ROWS.includes(row.id)).flatMap((row) => row.entries);
  const wrote = chatWaiting(state).flatMap(({ friend: id, count }) => {
    const friend = state.friends.find((each) => each.id === id);
    return friend ? [entryOfChat(friend, count)] : [];
  });
  const waiting = [...asking, ...wrote];
  const view = bellView(state, now, cleared, seenAt);
  const joined = view.joined.map((friend): BellRow => ({ entry: entryOfFriend(friend, state.activity, now), heading: friend.name, detail: `${t("bell.nowFriends")} · ${ago(friend.since, now, getLanguage())}`, avatar: friend.avatar }));
  const lately = view.lately.flatMap((item): BellRow[] => {
    const friend = state.friends.find((each) => each.id === item.friend);
    if (!friend) return [];
    return [{ entry: entryOfActivity(item, friend.name, now), heading: friend.name, detail: `${t(`friends.line.${activityVerb(item, now)}`, { title: item.title })} · ${ago(item.at, now, getLanguage())}`, avatar: friend.avatar, activity: item }];
  });
  return {
    waiting: waiting.slice(0, BELL_WAITING).map((entry) => ({ entry, heading: entry.title, detail: entry.note, ...(entry.avatar ? { avatar: entry.avatar } : {}) })),
    joined,
    lately,
    more: Math.max(0, waiting.length - BELL_WAITING),
  };
}

export type Asked<T> = { data?: T; problem?: string } | null;

export interface Mine {
  list: readonly { url: string }[];
  ratings: readonly Pick<LiveRating, "url" | "season" | "score">[];
}
const NOTHING_MINE: Mine = { list: [], ratings: [] };

export function friendGrid(view: View, state: FriendsState | null, lists: Asked<FriendLists>, ratings: Asked<FriendRatings>, iGet = true, now = Date.now(), mine: Mine = NOTHING_MINE): GridPage | null {
  if (view.kind !== "friend") return null;
  const friend = state?.friends.find((each) => each.id === view.id);
  if (!friend) return null;
  const since = t("friends.since", { day: formatDay(friend.since, getLanguage()) });
  const hint = activityHint(friend, iGet);
  const doing = friend.on ? friendHeadline(friend, state?.activity ?? [], now) : "";
  const page = { title: friend.name, meta: friend.on ? [doing, since].filter(Boolean).join("  ·  ") : t("friends.paused"), layout: "wide" as const, ...(hint ? { hint } : {}) };
  const none = (empty: string): GridPage => ({ ...page, entries: [], empty });
  if (!friend.on) return none(t("friends.theirsOff", { name: friend.name }));

  if ((view.tab ?? "lists") === "lists") {
    if (!friend.lists) return none(t("friends.notSharingLists", { name: friend.name }));
    if (!lists) return none(t("common.loading"));
    if (!lists.data) return none(lists.problem ?? t("common.loading"));
    const theirs = listsOf(lists.data);
    const both = bothWant(theirs, mine.list);
    const shown = [
      ...(both.length > 0 ? [{ title: t("friends.bothWant"), entries: both.map((item): Entry => ({ ...entryOfSaved(item), id: `both:${item.id}` })) }] : []),
      ...theirs.map((list) => ({ title: listName(list.info), entries: entriesOfList(list).map((entry): Entry => ({ ...entry, id: `${list.info.id}:${entry.id}` })) })),
    ];
    return {
      ...page,
      entries: withProgress(shown.flatMap((section) => section.entries), lists.data.progress),
      sections: shown.map((section) => ({ title: section.title, count: section.entries.length })),
      empty: t("friends.noLists", { name: friend.name }),
    };
  }

  if (!friend.ratings) return none(t("friends.notSharingRatings", { name: friend.name }));
  if (!ratings) return none(t("common.loading"));
  if (!ratings.data) return none(ratings.problem ?? t("common.loading"));
  const scores = scoresByTitle(mine.ratings);
  const rated = sortRatings(ratedBy(ratings.data), "new").map((rating): Entry => {
    const entry = entryOfRating(rating);
    const yours = myScoreFor(scores, rating);
    return yours === undefined ? entry : { ...entry, note: [entry.note, t("friends.yourScore", { score: yours })].filter(Boolean).join(" · ") };
  });
  return { ...page, entries: withProgress(rated, ratings.data.progress), empty: t("friends.noRatings", { name: friend.name }) };
}
