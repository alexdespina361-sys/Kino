import { describe, expect, it } from "vitest";
import type { Friend, FriendsState, LiveRating } from "../../shared";
import { getLanguage, t } from "../i18n";
import { ratingSummary } from "../account/ratingText";
import { profileRows, type ProfileFacts } from "./profile";

const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1_700_000_000_000, on: true, lists: true, ratings: true, activity: true, inbox: true };
const friendsOf = (...people: Friend[]): FriendsState => ({ friends: people, inbox: [], activity: [], invites: [], requests: [], sent: [] });
const rated = (key: string, score: number): LiveRating => ({ key: `rate:${key}`, at: 1, title: key, url: `https://x.example/${key}`, score, ratedAt: 1 });

const facts = (changes: Partial<ProfileFacts> = {}): ProfileFacts => ({ name: "Ann", signedIn: true, ratingsOn: true, ratings: [], friendsOn: true, friends: friendsOf(), unread: 0, watched: 0, progress: [], ...changes });
const tiles = (changes?: Partial<ProfileFacts>) => profileRows(facts(changes))[0]!.entries;
const ids = (changes?: Partial<ProfileFacts>) => tiles(changes).map((entry) => entry.id);

describe("the profile's page", () => {
  it("is one row of tiles named for the profile in use: what it rated, its friends and History (Settings is a button of the page's top, not a tile)", () => {
    const rows = profileRows(facts());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "profile", layout: "categories", title: "Ann" });
    expect(ids()).toEqual(["profile:ratings", "profile:friends", "profile:history"]);
  });

  it("ends with What's new when given: the newest version and its day, or New while it is news to this screen (last, so the others keep their places)", () => {
    const news = { version: "0.4.2", day: "17 Nov", fresh: false };
    expect(ids({ news })).toEqual(["profile:ratings", "profile:friends", "profile:history", "profile:news"]);
    expect(ids({ news, signedIn: false })).toEqual(["profile:ratings", "profile:history", "profile:news"]);
    expect(tiles({ news }).at(-1)).toEqual({ id: "profile:news", title: t("news.title"), url: "", note: t("news.tile", { version: "0.4.2", day: "17 Nov" }), action: "news" });
    expect(tiles({ news: { ...news, fresh: true } }).at(-1)?.note).toBe(t("news.tileFresh", { version: "0.4.2" }));
  });

  it("has under the places what was watched last and what was liked best, a look at a dozen of each, where there is any", () => {
    const card = (n: number) => ({ key: `url:https://x.example/${n}`, at: 100 - n, title: `Seen ${n}`, url: `https://x.example/${n}`, position: 600, duration: 6000 });
    const progress = Array.from({ length: 14 }, (_, n) => card(n));
    const ratings = [rated("ok", 6), rated("best", 10), rated("good", 8)];
    const rows = profileRows(facts({ progress, ratings, watched: progress.length }));
    expect(rows.map((row) => [row.id, row.layout, row.title])).toEqual([
      ["profile", "categories", "Ann"],
      ["profile:recent", "continue", t("profile.recent")],
      ["profile:best", "wide", t("profile.best")],
    ]);
    expect(rows[1]!.entries.map((entry) => entry.title)).toEqual(progress.slice(0, 12).map((each) => each.title));
    expect(rows[2]!.entries.map((entry) => [entry.title, entry.note])).toEqual([
      ["best", "10/10"],
      ["good", "8/10"],
      ["ok", "6/10"],
    ]);
    expect(profileRows(facts({ progress, ratings, ratingsOn: false })).map((row) => row.id)).toEqual(["profile", "profile:recent"]);
  });

  it("opens the three pages it holds", () => {
    const [ratings, friends, history] = tiles();
    expect(ratings).toMatchObject({ url: "", opens: { kind: "ratings" } });
    expect(friends).toMatchObject({ url: "", opens: { kind: "friends" } });
    expect(history).toMatchObject({ url: "", opens: { kind: "history" } });
  });

  it("has no tile for ratings once they are off, nor for friends once they are off", () => {
    expect(ids({ ratingsOn: false })).toEqual(["profile:friends", "profile:history"]);
    expect(ids({ friendsOn: false })).toEqual(["profile:ratings", "profile:history"]);
    expect(ids({ ratingsOn: false, friendsOn: false })).toEqual(["profile:history"]);
  });

  it("is, for a guest, what it rated and History: a guest has no friends (and the way to sign in is a button of the page's top)", () => {
    const rows = profileRows(facts({ signedIn: false, name: "", friendsOn: false }));
    expect(rows[0]?.title).toBe(t("profile.guest"));
    expect(rows[0]?.entries.map((entry) => entry.id)).toEqual(["profile:ratings", "profile:history"]);
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
