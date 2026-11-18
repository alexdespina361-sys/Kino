import type { FriendsState, LiveProgress, LiveRating } from "../../shared";
import { ratingSummary, sortRatings } from "../account/ratingText";
import { getLanguage, t } from "../i18n";
import { entryOfProgress, entryOfRating, type Entry, type HomeRow } from "./pages";

export interface ProfileFacts {
  name: string;
  signedIn: boolean;
  ratingsOn: boolean;
  ratings: readonly LiveRating[];
  friendsOn: boolean;
  friends: FriendsState | null;
  unread: number;
  watched: number;
  progress: readonly LiveProgress[];
  news?: { version: string; day: string; fresh: boolean } | undefined;
}

export const PROFILE_PEEK = 12;

const tile = (id: string, title: string, note: string, rest: Pick<Entry, "opens" | "action">): Entry => ({ id: `profile:${id}`, title, url: "", note, ...rest });

export function profileRows(facts: ProfileFacts): HomeRow[] {
  const entries: Entry[] = [];
  if (facts.ratingsOn) {
    entries.push(tile("ratings", t("rating.mine"), ratingSummary(t, getLanguage(), facts.ratings) || t("rating.mineHelp"), { opens: { kind: "ratings" } }));
  }
  if (facts.signedIn && facts.friendsOn) {
    const count = facts.friends?.friends.length ?? 0;
    const note = [count > 0 ? t("profile.friendsCount", { count }) : t("profile.friendsNone"), facts.unread > 0 ? t("profile.friendsNew", { count: facts.unread }) : ""].filter(Boolean).join(" · ");
    entries.push(tile("friends", t("friends.title"), note, { opens: { kind: "friends" } }));
  }
  entries.push(tile("history", t("tv.history"), facts.watched > 0 ? t("tv.titles", { count: facts.watched }) : t("tv.historyHelp"), { opens: { kind: "history" } }));
  if (facts.news) {
    const { version, day, fresh } = facts.news;
    entries.push(tile("news", t("news.title"), fresh ? t("news.tileFresh", { version }) : t("news.tile", { version, day }), { action: "news" }));
  }
  const rows: HomeRow[] = [{ id: "profile", layout: "categories", title: facts.signedIn && facts.name ? facts.name : t("profile.guest"), entries }];
  if (facts.progress.length > 0) rows.push({ id: "profile:recent", layout: "continue", title: t("profile.recent"), entries: facts.progress.slice(0, PROFILE_PEEK).map(entryOfProgress) });
  const best = facts.ratingsOn ? sortRatings(facts.ratings, "high").slice(0, PROFILE_PEEK) : [];
  if (best.length > 0) rows.push({ id: "profile:best", layout: "wide", title: t("profile.best"), entries: best.map(entryOfRating) });
  return rows;
}
