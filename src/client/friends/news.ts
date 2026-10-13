import { activityVerb, partyOpen, tagLabel, type ActivityItem, type FriendsState } from "../../shared";
import type { Key, Params } from "../i18n";

/**
 * What is new on the Friends page, so a screen can say so in a line when it looks again: a friend was added, somebody asked to be one, a
 * title or an invitation arrived, a friend watched something. It is worked out from two answers of the server and kept as plain facts,
 * which `describeNews` puts into words.
 */

/** What a screen has been told of already. */
export interface Known {
  friends: ReadonlySet<string>;
  inbox: ReadonlySet<string>;
  activity: ReadonlySet<string>;
  /** The profiles that had asked to be friends. */
  requests: ReadonlySet<string>;
}

/** What a friend watched is the same thing until it is another title or episode, or the end: not each time the minute they are in moves. */
const activityId = (item: ActivityItem): string => `${item.friend}|${item.key}|${item.season ?? ""}x${item.episode ?? ""}|${item.done ? "done" : "on"}`;

export const known = (state: FriendsState): Known => ({
  friends: new Set(state.friends.map((friend) => friend.id)),
  inbox: new Set(state.inbox.map((item) => item.id)),
  activity: new Set(state.activity.map(activityId)),
  requests: new Set(state.requests.map((request) => request.from.id)),
});

export type News =
  | { kind: "party"; name: string }
  | { kind: "together"; name: string }
  | { kind: "request"; name: string }
  | { kind: "recommend"; name: string; title: string }
  | { kind: "friend"; name: string }
  | { kind: "activity"; name: string; title: string; verb: "watching" | "watched" | "finished" };

/** A friend's news is only news for this long: a friend who turns sharing on brings their last two weeks with them, which is not "just now". */
export const NEWS_RECENT_MS = 30 * 60 * 1000;

/**
 * What the new answer has that the screen had not been told, the most important first. Nothing the first time (`before` is null):
 * a page that has just opened says nothing of what was already there.
 */
export function whatsNew(before: Known | null, state: FriendsState, now: number): News[] {
  if (!before) return [];
  const name = (id: string) => state.friends.find((friend) => friend.id === id)?.name ?? "";
  const fresh = state.inbox.filter((item) => !item.read && !before.inbox.has(item.id));
  return [
    // (an invitation to a party that is over is not news: a screen that was asleep for the evening wakes up to it)
    ...fresh.flatMap((item): News[] => (item.kind === "party" && partyOpen(item, now) ? [{ kind: "party", name: name(item.from) }] : [])),
    ...fresh.flatMap((item): News[] => (item.kind === "together" ? [{ kind: "together", name: name(item.from) }] : [])),
    ...state.requests.filter((request) => !before.requests.has(request.from.id)).map((request): News => ({ kind: "request", name: tagLabel(request.from.name, request.from.tag) })),
    ...fresh.flatMap((item): News[] => (item.kind === "recommend" ? [{ kind: "recommend", name: name(item.from), title: item.title }] : [])),
    ...state.friends.filter((friend) => !before.friends.has(friend.id)).map((friend): News => ({ kind: "friend", name: friend.name })),
    ...state.activity
      .filter((item) => !before.activity.has(activityId(item)) && now - item.at < NEWS_RECENT_MS)
      .map((item): News => ({ kind: "activity", name: name(item.friend), title: item.title, verb: activityVerb(item, now) })),
  ];
}

export type Translate = (key: Key, params?: Params) => string;

/** One line for the news: an invitation or a request (for a party, to be friends) if there is one, else the one thing that happened, else how many things. */
export function describeNews(news: readonly News[], t: Translate): string | undefined {
  const asked = (item: News) => item.kind === "party" || item.kind === "together" || item.kind === "request";
  const first = news.find((item) => item.kind === "party") ?? news.find((item) => item.kind === "together") ?? news.find((item) => item.kind === "request") ?? news[0];
  if (!first) return undefined;
  if (!asked(first) && news.length > 1) return t("friends.news.many", { count: news.length });
  switch (first.kind) {
    case "party":
      return t("friends.news.party", { name: first.name });
    case "together":
      return t("friends.news.together", { name: first.name });
    case "request":
      return t("friends.news.request", { name: first.name });
    case "recommend":
      return t("friends.news.recommend", { name: first.name, title: first.title });
    case "friend":
      return t("friends.news.friend", { name: first.name });
    case "activity":
      return t(`friends.${first.verb}`, { name: first.name, title: first.title });
  }
}
