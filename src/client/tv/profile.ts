import type { FriendsState, LiveRating } from "../../shared";
import { ratingSummary } from "../account/ratingText";
import { getLanguage, t } from "../i18n";
import type { Entry, HomeRow } from "./pages";

/**
 * The profile's page: the places that belong to whoever is watching (what they rated, their friends, what they watched), as tiles in one
 * row, each with a line that says how it stands. Who is watching, Settings and (for a guest) signing in are buttons of the page's top,
 * which Browse.tsx draws. Pure, like the other pages, so what appears can be tested without a screen; Browse.tsx draws it and walks it with the remote.
 */
export interface ProfileFacts {
  /** The name the row carries (the profile in use); empty for a guest, whose row says so. */
  name: string;
  /** A profile of an account is signed in: a guest has no friends. */
  signedIn: boolean;
  /** Ratings are on for this profile (off, the page has no tile for them), and what it rated. */
  ratingsOn: boolean;
  ratings: readonly LiveRating[];
  /** Friends are on (off, the page has no tile for them), what the server last said of them, and how many things in the inbox are new. */
  friendsOn: boolean;
  friends: FriendsState | null;
  unread: number;
  /** How many titles History holds. */
  watched: number;
}

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
  return [{ id: "profile", layout: "categories", title: facts.signedIn && facts.name ? facts.name : t("profile.guest"), entries }];
}
