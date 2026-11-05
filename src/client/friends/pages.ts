import { activityVerb, canAskTogether, partyOpen, tagLabel, type ActivityItem, type Friend, type FriendLists, type FriendRatings, type FriendRequest, type FriendsState, type PlanItem } from "../../shared";
import { listName } from "../account/cards";
import { chatWaiting, waitingFrom } from "../chat/notices";
import { sortRatings } from "../account/ratingText";
import { ago, formatDay } from "../account/time";
import { getLanguage, t } from "../i18n";
import { formatCode } from "../shared/format";
import { entryOfRating, type Entry, type GridPage, type HomeRow, type View } from "../tv/pages";
import { BELL_WAITING, bellView } from "./bell";
import { inboxToShow, planLines, planStatus, type PlanStatus } from "./plans";
import { activityHint, entriesOfList, entryOfActivity, entryOfRecommendation, friendLine, listsOf, nameOf, ratedBy, withProgress, type PartyInvitation, type Recommendation, type TogetherRequest } from "./entries";

/**
 * What the TV's friends pages are made of, worked out from what the server says of the friends: pure, like tv/pages.ts, so what
 * appears where can be tested without a screen. Browse.tsx draws it and walks it with the remote.
 */

/** A friend's invitation to a watch party that is on now: pressing it joins. (Its title is short: the banner has room for one line.) */
const entryOfParty = (item: PartyInvitation, from: string, now: number): Entry => ({
  id: `party:${item.id}`,
  title: t("friends.partyOf", { name: from }),
  url: "",
  party: item.code,
  inboxId: item.id,
  note: `${formatCode(item.code)} · ${ago(item.at, now, getLanguage())}`,
});

/** ...one that has ended: pressing it asks the friend to watch together instead (only offered for a friend who tells what they watch). */
const entryOfEndedParty = (item: PartyInvitation, from: Friend, now: number): Entry => ({
  id: `party:${item.id}`,
  title: t("friends.partyOf", { name: from.name }),
  url: "",
  ask: from.id,
  inboxId: item.id,
  note: `${t("friends.partyOver")} · ${ago(item.at, now, getLanguage())}`,
});

/** A friend's request to watch together: pressing it starts a party, and invites them to it. */
const entryOfRequest = (item: TogetherRequest, from: string, now: number): Entry => ({
  id: `together:${item.id}`,
  title: t("friends.togetherOf", { name: from }),
  url: "",
  wants: item.from,
  inboxId: item.id,
  note: ago(item.at, now, getLanguage()),
});

/**
 * A plan to watch together, as a tile: pressing it asks the question (yes or no) or tells the news. One whose time has come starts the party instead,
 * as a friend's request for one does.
 */
const entryOfPlan = (item: PlanItem, from: string, now: number): Entry => {
  const { heading, detail } = planLines(item, from, now);
  return { id: `plan:${item.id}`, title: heading, url: "", note: detail, inboxId: item.id, ...(planStatus(item, now) === "due" ? { wants: item.from } : { plan: item.id }) };
};
/** The plans in the order they matter: the ones whose time has come, the ones that ask, the ones that are on (the soonest first), the news that one was turned down. */
const PLAN_ORDER: Record<PlanStatus, number> = { due: 0, asks: 1, agreed: 2, declined: 3, lapsed: 4 };

/** Somebody who asked to be friends, as a tile with the picture they chose: pressing it asks whether to say yes. */
const entryOfFriendRequest = (item: FriendRequest): Entry => ({
  id: `request:${item.from.id}`,
  title: tagLabel(item.from.name, item.from.tag),
  url: "",
  request: item.from,
  avatar: item.from.avatar,
  note: t("friends.requestWants"),
});

/**
 * A friend, as a tile that opens their page, with the picture they chose; the line under the name is how many messages wait from them (quietly: a line, not a
 * popup), else what they are watching, else that they are online, else since when they are friends.
 */
const entryOfFriend = (friend: Friend, activity: readonly ActivityItem[], now: number, unread = 0): Entry => ({
  id: `friend:${friend.id}`,
  title: friend.name,
  url: "",
  opens: { kind: "friend", id: friend.id },
  avatar: friend.avatar,
  ...(friend.on && friend.online ? { online: true } : {}),
  note: (unread > 0 ? t("chat.unreadShort", { count: unread }) : friendLine(friend, activity, now)) || t("friends.since", { day: formatDay(friend.since, getLanguage()) }),
});

/** A friend who wrote, as a line of the bell: pressing it opens the chat with them. */
const entryOfChat = (friend: Friend, count: number): Entry => ({
  id: `chat:${friend.id}`,
  title: t("chat.unread", { count, name: friend.name }),
  url: "",
  chat: friend.id,
  avatar: friend.avatar,
});

/** The last two tiles of the friends row: they open a page of their own over the library. */
const addTile = (): Entry => ({ id: "add-friend", title: t("friends.add"), url: "", action: "addFriend" });
const settingsTile = (): Entry => ({ id: "friend-settings", title: t("friends.settingsTile"), url: "", action: "friendSettings" });
/** "Turn on: Share what I watch with friends": what is missing from the row of what they watch, and the way to the switch that makes it appear. */
const activityOffTile = (): Entry => ({ id: "activity-off", title: t("friends.turnOn"), url: "", note: t("friends.switchGive"), action: "friendSettings" });

/**
 * The rows of the friends page, the friends first: the friends themselves (with the tiles to add one and to choose what is shared), then what waits for an
 * answer (the requests to be friends, invitations to the watch parties that are on, and the ones that are over from a friend who can be asked for another,
 * requests to watch together, plans to watch together, what friends sent), then a row of its own for what each of the friends who watched most lately
 * watched. Before the server has answered there are only the first row's last two tiles.
 * While this profile does not share what it watches (`iGet`: the one thing that is off until somebody turns it on, and what makes the rows of what friends
 * watch never appear, as a profile hears them while it shares its own) a last row has a tile that says so and opens the settings.
 */
/** The rows of what waits for an answer (the bell lists them too): the page puts them under one heading, "Waiting for you", and the rows after them are what is not waiting. */
const ASKING_ROWS: readonly string[] = ["friend-requests", "friend-parties", "friend-plans", "friend-sent"];

/** How many friends get a row of what they watched: the ones who watched most lately (the others keep the line under their name, and their page). */
export const FRIEND_ROWS = 3;
/** Past every place a friend can have in a list (a friend who has none comes after the ones who do). */
const NO_PLACE = 1_000_000;

/**
 * The friends in the order the pages show them: the ones who wrote first (the newest message first), then the ones who watched something lately (the newest
 * first), then the others by name, and a friend who turned friends off last. Whether somebody is online is a dot and never a place: it flips every minute or
 * so, and the tiles would move under the remote.
 */
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

/** What a friend watched lately, a row to each of the first few (the newest first): their name is in the title, so the tiles need not say it again. */
function watchedRows(friends: readonly Friend[], activity: readonly ActivityItem[], now: number): HomeRow[] {
  const items = new Map<string, ActivityItem[]>();
  for (const item of activity) items.set(item.friend, [...(items.get(item.friend) ?? []), item]);
  return [...items]
    .flatMap(([id, watched]): HomeRow[] => {
      const friend = friends.find((each) => each.id === id);
      return friend ? [{ id: `friend-watched:${id}`, layout: "wide", title: t("friends.watchedBy", { name: friend.name }), entries: watched.map((item) => entryOfActivity(item, "", now)) }] : [];
    })
    .slice(0, FRIEND_ROWS);
}

export function friendRows(state: FriendsState | null, now: number, iGet = true): HomeRow[] {
  const friends = state?.friends ?? [];
  const inbox = state?.inbox ?? [];
  const activity = state?.activity ?? [];
  const requests = state?.requests ?? [];
  // (The friends are the first row, so that the remote starts on them: what waits for an answer is in the bell, and a row's worth of it is the next thing under them.)
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

  // (the last row: it is a reminder, and a friend's page says it again)
  if (activity.length === 0 && !iGet && friends.some((friend) => friend.on)) rows.push({ id: "friend-activity-off", layout: "categories", title: t("friends.activity"), entries: [activityOffTile()] });
  return rows.map((row) => (ASKING_ROWS.includes(row.id) ? { ...row, group: t("bell.waiting") } : row));
}

/** A line of the TV's bell: the entry that pressing it acts on (the friends page's own), and what the line says. */
export interface BellRow {
  entry: Entry;
  heading: string;
  detail?: string | undefined;
  /** The picture of the friend it is about, where there is one. */
  avatar?: Entry["avatar"];
}

/**
 * What the bell lists on a TV: what waits for an answer (the friends page's own entries for requests to be friends, invitations, requests to watch
 * together and titles friends sent, a few of them) and what friends watch lately, with how many waiting things are left for the friends page.
 */
export function bellRows(state: FriendsState | null, now: number): { waiting: BellRow[]; lately: BellRow[]; more: number } {
  if (!state) return { waiting: [], lately: [], more: 0 };
  const rows = friendRows(state, now);
  const asking = rows.filter((row) => ASKING_ROWS.includes(row.id)).flatMap((row) => row.entries);
  // (The friends who wrote come after what asks for an answer, with the same few places: see `bellView`.)
  const wrote = chatWaiting(state).flatMap(({ friend: id, count }) => {
    const friend = state.friends.find((each) => each.id === id);
    return friend ? [entryOfChat(friend, count)] : [];
  });
  const waiting = [...asking, ...wrote];
  const lately = bellView(state, now).lately.flatMap((item): BellRow[] => {
    const friend = state.friends.find((each) => each.id === item.friend);
    if (!friend) return [];
    return [{ entry: entryOfActivity(item, friend.name, now), heading: friend.name, detail: `${t(`friends.line.${activityVerb(item, now)}`, { title: item.title })} · ${ago(item.at, now, getLanguage())}`, avatar: friend.avatar }];
  });
  return {
    waiting: waiting.slice(0, BELL_WAITING).map((entry) => ({ entry, heading: entry.title, detail: entry.note, ...(entry.avatar ? { avatar: entry.avatar } : {}) })),
    lately,
    more: Math.max(0, waiting.length - BELL_WAITING),
  };
}

/** What was asked of the server for a friend's page: nothing yet (null), the answer, or why there is none. */
export type Asked<T> = { data?: T; problem?: string } | null;

/**
 * A friend's page: the titles in the lists they keep (the list each is in under it) or the ones they rated, the newest first.
 * Null for a friend who is gone. When there is nothing to show, `empty` says why: not shared, turned off, still asked, or nothing yet.
 * Under the name: what they are doing (watching, else online) and since when they are friends; and, when what they watch is not shown, the line that says why.
 */
export function friendGrid(view: View, state: FriendsState | null, lists: Asked<FriendLists>, ratings: Asked<FriendRatings>, iGet = true, now = Date.now()): GridPage | null {
  if (view.kind !== "friend") return null;
  const friend = state?.friends.find((each) => each.id === view.id);
  if (!friend) return null;
  const since = t("friends.since", { day: formatDay(friend.since, getLanguage()) });
  const hint = activityHint(friend, iGet);
  const doing = friend.on ? friendLine(friend, state?.activity ?? [], now) : "";
  const page = { title: friend.name, meta: friend.on ? [doing, since].filter(Boolean).join("  ·  ") : t("friends.paused"), layout: "wide" as const, ...(hint ? { hint } : {}) };
  const none = (empty: string): GridPage => ({ ...page, entries: [], empty });
  if (!friend.on) return none(t("friends.theirsOff", { name: friend.name }));

  if ((view.tab ?? "lists") === "lists") {
    if (!friend.lists) return none(t("friends.notSharingLists", { name: friend.name }));
    if (!lists) return none(t("common.loading"));
    if (!lists.data) return none(lists.problem ?? t("common.loading"));
    const entries = listsOf(lists.data).flatMap((list) => entriesOfList(list).map((entry): Entry => ({ ...entry, note: listName(list.info) })));
    return { ...page, entries: withProgress(entries, lists.data.progress), empty: t("friends.noLists", { name: friend.name }) };
  }

  if (!friend.ratings) return none(t("friends.notSharingRatings", { name: friend.name }));
  if (!ratings) return none(t("common.loading"));
  if (!ratings.data) return none(ratings.problem ?? t("common.loading"));
  return { ...page, entries: withProgress(sortRatings(ratedBy(ratings.data), "new").map(entryOfRating), ratings.data.progress), empty: t("friends.noRatings", { name: friend.name }) };
}
