import { describe, expect, it } from "vitest";
import type { Friend, FriendsState, LiveRating } from "../../shared";
import { getLanguage, t } from "../i18n";
import { ratingSummary } from "../account/ratingText";
import { profileRows, type ProfileFacts } from "./profile";

const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1_700_000_000_000, on: true, lists: true, ratings: true, activity: true, inbox: true };
const friendsOf = (...people: Friend[]): FriendsState => ({ friends: people, inbox: [], activity: [], invites: [], requests: [], sent: [] });
const rated = (key: string, score: number): LiveRating => ({ key: `rate:${key}`, at: 1, title: key, url: `https://x.example/${key}`, score, ratedAt: 1 });

/** A signed-in profile with everything on and nothing in it yet. */
const facts = (changes: Partial<ProfileFacts> = {}): ProfileFacts => ({ name: "Ann", signedIn: true, ratingsOn: true, ratings: [], friendsOn: true, friends: friendsOf(), unread: 0, watched: 0, ...changes });
const tiles = (changes?: Partial<ProfileFacts>) => profileRows(facts(changes))[0]!.entries;
const ids = (changes?: Partial<ProfileFacts>) => tiles(changes).map((entry) => entry.id);

describe("the profile's page", () => {
  it("is one row of tiles named for the profile in use: what it rated, its friends, History and the settings", () => {
    const rows = profileRows(facts());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "profile", layout: "categories", title: "Ann" });
    expect(ids()).toEqual(["profile:ratings", "profile:friends", "profile:history", "profile:settings"]);
  });

  it("opens the three pages it holds, and the settings through an action of its own", () => {
    const [ratings, friends, history, settings] = tiles();
    expect(ratings).toMatchObject({ url: "", opens: { kind: "ratings" } });
    expect(friends).toMatchObject({ url: "", opens: { kind: "friends" } });
    expect(history).toMatchObject({ url: "", opens: { kind: "history" } });
    expect(settings).toMatchObject({ url: "", action: "settings" });
    expect(settings?.opens).toBeUndefined();
  });

  it("has no tile for ratings once they are off, nor for friends once they are off", () => {
    expect(ids({ ratingsOn: false })).toEqual(["profile:friends", "profile:history", "profile:settings"]);
    expect(ids({ friendsOn: false })).toEqual(["profile:ratings", "profile:history", "profile:settings"]);
    expect(ids({ ratingsOn: false, friendsOn: false })).toEqual(["profile:history", "profile:settings"]);
  });

  it("is, for a guest, History and the settings with a way to sign in between: a guest has no friends", () => {
    const rows = profileRows(facts({ signedIn: false, name: "", friendsOn: false }));
    expect(rows[0]?.title).toBe(t("profile.guest"));
    expect(rows[0]?.entries.map((entry) => entry.id)).toEqual(["profile:ratings", "profile:history", "profile:signin", "profile:settings"]);
    expect(rows[0]?.entries[2]).toMatchObject({ url: "", action: "signIn" });
    // (a name that is left over from a profile that signed out is not shown)
    expect(profileRows(facts({ signedIn: false, name: "Ann" }))[0]?.title).toBe(t("profile.guest"));
    expect(ids({ signedIn: false })).not.toContain("profile:friends");
  });

  it("says under ratings how many there are and their mean, else what the page is for", () => {
    const some = [rated("a", 8), rated("b", 6)];
    expect(tiles({ ratings: some })[0]?.note).toBe(ratingSummary(t, getLanguage(), some));
    expect(tiles()[0]?.note).toBe(t("rating.mineHelp"));
  });

  it("says under friends how many there are and how many things are new", () => {
    const friendsTile = (changes: Partial<ProfileFacts>) => tiles(changes).find((entry) => entry.id === "profile:friends")?.note;
    expect(friendsTile({})).toBe(t("profile.friendsNone"));
    expect(friendsTile({ friends: null })).toBe(t("profile.friendsNone"));
    expect(friendsTile({ friends: friendsOf(sam) })).toBe(t("profile.friendsCount", { count: 1 }));
    expect(friendsTile({ friends: friendsOf(sam, { ...sam, id: "pro_robin" }), unread: 2 })).toBe(`${t("profile.friendsCount", { count: 2 })} · ${t("profile.friendsNew", { count: 2 })}`);
    expect(friendsTile({ unread: 1 })).toBe(`${t("profile.friendsNone")} · ${t("profile.friendsNew", { count: 1 })}`);
  });

  it("says under History how many titles it holds, else what it is", () => {
    const history = (watched: number) => tiles({ watched }).find((entry) => entry.id === "profile:history")?.note;
    expect(history(0)).toBe(t("tv.historyHelp"));
    expect(history(1)).toBe(t("tv.titles", { count: 1 }));
    expect(history(7)).toBe(t("tv.titles", { count: 7 }));
  });
});
