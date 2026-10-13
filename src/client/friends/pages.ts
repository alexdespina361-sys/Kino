import { activityVerb, canAskTogether, partyOpen, tagLabel, type ActivityItem, type Friend, type FriendLists, type FriendRatings, type FriendRequest, type FriendsState } from "../../shared";
import { listName } from "../account/cards";
import { sortRatings } from "../account/ratingText";
import { ago, formatDay } from "../account/time";
import { getLanguage, t } from "../i18n";
import { formatCode } from "../shared/format";
import { entryOfRating, type Entry, type GridPage, type HomeRow, type View } from "../tv/pages";
import { BELL_WAITING, bellView } from "./bell";
import { entriesOfList, entryOfActivity, entryOfRecommendation, friendLine, listsOf, nameOf, ratedBy, withProgress, type PartyInvitation, type Recommendation, type TogetherRequest } from "./entries";

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

/** Somebody who asked to be friends, as a tile with the picture they chose: pressing it asks whether to say yes. */
const entryOfFriendRequest = (item: FriendRequest): Entry => ({
  id: `request:${item.from.id}`,
  title: tagLabel(item.from.name, item.from.tag),
  url: "",
  request: item.from,
  avatar: item.from.avatar,
  note: t("friends.requestWants"),
});

/** A friend, as a tile that opens their page, with the picture they chose; the line under the name is what they are watching, else that they are online, else since when they are friends. */
const entryOfFriend = (friend: Friend, activity: readonly ActivityItem[], now: number): Entry => ({
  id: `friend:${friend.id}`,
  title: friend.name,
  url: "",
  opens: { kind: "friend", id: friend.id },
  avatar: friend.avatar,
  ...(friend.on && friend.online ? { online: true } : {}),
  note: friendLine(friend, activity, now) || t("friends.since", { day: formatDay(friend.since, getLanguage()) }),
});

/** The last two tiles of the friends row: they open a page of their own over the library. */
const addTile = (): Entry => ({ id: "add-friend", title: t("friends.add"), url: "", action: "addFriend" });
const settingsTile = (): Entry => ({ id: "friend-settings", title: t("friends.settingsTile"), url: "", action: "friendSettings" });

/**
 * The rows of the friends page: the requests to be friends that wait for an answer, invitations to the watch parties that are on (and the
 * ones that are over, from a friend who can be asked for another), requests to watch together, what friends sent, what they watch, and the
 * friends themselves (with the tiles to add one and to choose what is shared). Before the server has answered there are only the last two.
 */
export function friendRows(state: FriendsState | null, now: number): HomeRow[] {
  const friends = state?.friends ?? [];
  const inbox = state?.inbox ?? [];
  const activity = state?.activity ?? [];
  const requests = state?.requests ?? [];
  const rows: HomeRow[] = [];

  if (requests.length > 0) rows.push({ id: "friend-requests", layout: "categories", title: t("friends.requests"), entries: requests.map(entryOfFriendRequest) });

  const parties = inbox.flatMap((item): Entry[] => {
    if (item.kind === "together") return [entryOfRequest(item, nameOf(friends, item.from), now)];
    if (item.kind !== "party") return [];
    if (partyOpen(item, now)) return [entryOfParty(item, nameOf(friends, item.from), now)];
    const from = friends.find((friend) => friend.id === item.from);
    return from && canAskTogether(from) ? [entryOfEndedParty(item, from, now)] : [];
  });
  if (parties.length > 0) rows.push({ id: "friend-parties", layout: "wide", title: t("friends.partiesRow"), entries: parties });

  const sent = inbox.filter((item): item is Recommendation => item.kind === "recommend");
  if (sent.length > 0) rows.push({ id: "friend-sent", layout: "wide", title: t("friends.inbox"), entries: sent.map((item) => ({ ...entryOfRecommendation(item, nameOf(friends, item.from)), inboxId: item.id })) });

  if (activity.length > 0) rows.push({ id: "friend-activity", layout: "wide", title: t("friends.activity"), entries: activity.map((item) => entryOfActivity(item, nameOf(friends, item.friend), now)) });

  rows.push({ id: "friend-people", layout: "categories", title: t("friends.yours"), entries: [...friends.map((friend) => entryOfFriend(friend, activity, now)), addTile(), settingsTile()] });
  return rows;
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
  const waiting = rows.filter((row) => row.id === "friend-requests" || row.id === "friend-parties" || row.id === "friend-sent").flatMap((row) => row.entries);
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
 */
export function friendGrid(view: View, state: FriendsState | null, lists: Asked<FriendLists>, ratings: Asked<FriendRatings>): GridPage | null {
  if (view.kind !== "friend") return null;
  const friend = state?.friends.find((each) => each.id === view.id);
  if (!friend) return null;
  const since = t("friends.since", { day: formatDay(friend.since, getLanguage()) });
  const page = { title: friend.name, meta: friend.on ? (friend.online ? `${t("friends.online")}  ·  ${since}` : since) : t("friends.paused"), layout: "wide" as const };
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
