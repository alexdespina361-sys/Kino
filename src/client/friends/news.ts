import { activityVerb, partyOpen, planAsks, tagLabel, type ActivityItem, type FriendsState } from "../../shared";
import type { Key, Params } from "../i18n";

export interface Known {
  friends: ReadonlySet<string>;
  inbox: ReadonlySet<string>;
  activity: ReadonlySet<string>;
  requests: ReadonlySet<string>;
}

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
  | { kind: "plan"; name: string; when: number }
  | { kind: "planYes"; name: string; when: number }
  | { kind: "planNo"; name: string; when: number }
  | { kind: "recommend"; name: string; title: string }
  | { kind: "friend"; name: string }
  | { kind: "activity"; name: string; title: string; verb: "watching" | "watched" | "finished" };

export const NEWS_RECENT_MS = 30 * 60 * 1000;

export function whatsNew(before: Known | null, state: FriendsState, now: number): News[] {
  if (!before) return [];
  const name = (id: string) => state.friends.find((friend) => friend.id === id)?.name ?? "";
  const fresh = state.inbox.filter((item) => !item.read && !before.inbox.has(item.id));
  return [
    ...fresh.flatMap((item): News[] => (item.kind === "party" && partyOpen(item, now) ? [{ kind: "party", name: name(item.from) }] : [])),
    ...fresh.flatMap((item): News[] => (item.kind === "together" ? [{ kind: "together", name: name(item.from) }] : [])),
    ...fresh.flatMap((item): News[] => {
      if (item.kind !== "plan") return [];
      if (item.answer === undefined) return planAsks(item, now) ? [{ kind: "plan", name: name(item.from), when: item.when }] : [];
      return [{ kind: item.answer === "yes" ? "planYes" : "planNo", name: name(item.from), when: item.when }];
    }),
    ...state.requests.filter((request) => !before.requests.has(request.from.id)).map((request): News => ({ kind: "request", name: tagLabel(request.from.name, request.from.tag) })),
    ...fresh.flatMap((item): News[] => (item.kind === "recommend" ? [{ kind: "recommend", name: name(item.from), title: item.title }] : [])),
    ...state.friends.filter((friend) => !before.friends.has(friend.id)).map((friend): News => ({ kind: "friend", name: friend.name })),
    ...state.activity
      .filter((item) => !before.activity.has(activityId(item)) && now - item.at < NEWS_RECENT_MS)
      .map((item): News => ({ kind: "activity", name: name(item.friend), title: item.title, verb: activityVerb(item, now) })),
  ];
}

export const isUrgent = (news: readonly News[]): boolean => news.some((item) => item.kind === "party" || item.kind === "together");

export type Translate = (key: Key, params?: Params) => string;

export function describeNews(news: readonly News[], t: Translate, when: (at: number) => string = () => ""): string | undefined {
  const asked = (item: News) => item.kind === "party" || item.kind === "together" || item.kind === "plan" || item.kind === "request";
  const first = news.find((item) => item.kind === "party") ?? news.find((item) => item.kind === "together") ?? news.find((item) => item.kind === "plan") ?? news.find((item) => item.kind === "request") ?? news[0];
  if (!first) return undefined;
  if (!asked(first) && news.length > 1) return t("friends.news.many", { count: news.length });
  switch (first.kind) {
    case "party":
      return t("friends.news.party", { name: first.name });
    case "together":
      return t("friends.news.together", { name: first.name });
    case "plan":
      return t("friends.news.plan", { name: first.name, when: when(first.when) });
    case "planYes":
      return t("friends.news.planYes", { name: first.name, when: when(first.when) });
    case "planNo":
      return t("friends.news.planNo", { name: first.name, when: when(first.when) });
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
