import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIST, titleLink, type ActivityItem, type Friend, type FriendLists, type FriendProgress, type FriendRatings } from "../../shared";
import { t } from "../i18n";
import type { Entry } from "../tv/pages";
import { entriesOfList, entriesOfRatings, entryOfActivity, entryOfRecommendation, friendLine, listsOf, nameOf, progressFor, progressNote, ratedBy, recommendationOf, withProgress, type Recommendation } from "./entries";

const NOW = 50_000_000;
const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1_700_000_000_000, on: true, lists: true, ratings: true, activity: true, inbox: true };
const robin: Friend = { ...sam, id: "pro_robin", name: "Robin" };
const watched = (friend: string, key: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({ friend, key, title: "Alien", url: "https://filmpire.sc/watch/2", at: NOW - 60_000, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe("who a friend is", () => {
  it("is found by id, and nobody when the friend is gone", () => {
    expect(nameOf([sam, robin], "pro_robin")).toBe("Robin");
    expect(nameOf([sam], "pro_robin")).toBe("");
  });
});

describe("the line under a friend's name", () => {
  it("says what they are watching, watched or finished, from the newest of what they did", () => {
    expect(friendLine(sam, [watched("pro_sam", "k")], NOW)).toBe(t("friends.line.watching", { title: "Alien" }));
    expect(friendLine(sam, [watched("pro_sam", "k", { at: NOW - 3_600_000 })], NOW)).toBe(t("friends.line.watched", { title: "Alien" }));
    expect(friendLine(sam, [watched("pro_sam", "k", { done: true })], NOW)).toBe(t("friends.line.finished", { title: "Alien" }));
  });

  it("is about this friend alone", () => {
    expect(friendLine(robin, [watched("pro_sam", "k")], NOW)).toBe("");
    expect(friendLine(sam, [watched("pro_robin", "k1", { title: "Heat" }), watched("pro_sam", "k2")], NOW)).toBe(t("friends.line.watching", { title: "Alien" }));
  });

  it("is that they turned friends off, whatever they watched", () => {
    expect(friendLine({ ...sam, on: false }, [watched("pro_sam", "k")], NOW)).toBe(t("friends.paused"));
  });

  it("is nothing for a friend who watched nothing, and that they are online when they are", () => {
    expect(friendLine(sam, [], NOW)).toBe("");
    expect(friendLine({ ...sam, online: true }, [], NOW)).toBe(t("friends.online"));
    expect(friendLine({ ...sam, online: true }, [watched("pro_sam", "k")], NOW)).toBe(t("friends.line.watching", { title: "Alien" })); // (what they watch says more)
    expect(friendLine({ ...sam, on: false, online: true }, [], NOW)).toBe(t("friends.paused"));
  });
});

describe("how far a friend got", () => {
  const film = "https://films.example/watch/17";
  const got = (extra: Partial<FriendProgress> = {}): FriendProgress => ({ link: titleLink(film), ...extra });
  const entry = (extra: Partial<Entry> = {}): Entry => ({ id: "e", title: "Alpha", url: film, ...extra });

  it("is said as the episode they are at and how far into it, or that it is watched", () => {
    expect(progressNote(got({ season: 2, episode: 5, percent: 63 }))).toBe("S2:E5 · 63%");
    expect(progressNote(got({ percent: 11 }))).toBe("11%");
    expect(progressNote(got({ season: 1, episode: 3, done: true }))).toBe(`S1:E3 · ${t("card.watched")}`);
    expect(progressNote(got())).toBeUndefined();
  });

  it("goes on the cards of the titles they started, as a bar and first in the line under the title, and leaves the others as they are", () => {
    const other = entry({ id: "o", url: "https://films.example/watch/99", note: "Horror" });
    const [started, untouched] = withProgress([entry({ note: "Favourites" }), other], [got({ season: 2, episode: 5, percent: 63 })]);
    expect(started).toMatchObject({ progress: 0.63, note: "S2:E5 · 63% · Favourites" });
    expect(untouched).toBe(other);
    expect(withProgress([entry()], [got({ done: true })])[0]).toMatchObject({ progress: 1, note: t("card.watched") });
    expect(withProgress([entry({ note: "Favourites" })], undefined)[0]).toEqual(entry({ note: "Favourites" }));
  });

  it("is found by the title's link, a show's episodes being one title", () => {
    expect(progressFor([got({ percent: 5 })], film)?.percent).toBe(5);
    expect(progressFor([got({ percent: 5 })], "https://films.example/watch/18")).toBeUndefined();
    expect(progressFor(undefined, film)).toBeUndefined();
  });
});

describe("a title a friend sent", () => {
  const sent = (extra: Partial<Recommendation> = {}): Recommendation => ({ kind: "recommend", id: "r1", from: "pro_sam", at: NOW, read: false, title: "Dune", url: "https://filmpire.sc/watch/1", ...extra });

  it("is a card that plays it, with who sent it under the title", () => {
    expect(entryOfRecommendation(sent(), "Sam")).toEqual({ id: "from:r1", title: "Dune", url: "https://filmpire.sc/watch/1", note: t("friends.from", { name: "Sam" }) });
  });

  it("brings the pictures, the year, whether it is a film or a show, and the friend's note as what the title's page says about it", () => {
    const entry = entryOfRecommendation(sent({ image: "poster", backdrop: "wide", year: 2021, type: "movie", note: "Watch it on the big screen" }), "Sam");
    expect(entry).toMatchObject({ image: "poster", backdrop: "wide", year: 2021, kind: "movie", description: "Watch it on the big screen" });
  });

  it("is not given what the friend did not send", () => {
    const entry = entryOfRecommendation(sent(), "Sam");
    expect(Object.keys(entry).sort()).toEqual(["id", "note", "title", "url"]);
  });
});

describe("what is sent to recommend a title", () => {
  const entry: Entry = { id: "e", title: "Dune", url: "/play?u=abc", image: "poster", backdrop: "wide", year: 2021, kind: "movie" };

  it("is the title with where it plays as a whole address, how it looks, and the note if there is one", () => {
    vi.stubGlobal("location", { href: "https://kino.example/tv?x=1" });
    expect(recommendationOf(entry, "Loved it")).toEqual({ kind: "recommend", title: "Dune", url: "https://kino.example/play?u=abc", image: "poster", backdrop: "wide", year: 2021, type: "movie", note: "Loved it" });
  });

  it("leaves out what the title does not have, and an empty note", () => {
    vi.stubGlobal("location", { href: "https://kino.example/" });
    expect(recommendationOf({ id: "e", title: "Dune", url: "https://filmpire.sc/watch/1" }, "")).toEqual({ kind: "recommend", title: "Dune", url: "https://filmpire.sc/watch/1" });
  });
});

describe("something a friend watched", () => {
  it("is a card that plays it, with who and how long ago under the title", () => {
    const entry = entryOfActivity(watched("pro_sam", "k1"), "Sam", NOW);
    expect(entry).toMatchObject({ id: "watched:pro_sam:k1", title: "Alien", url: "https://filmpire.sc/watch/2" });
    expect(entry.note).toMatch(/^Sam · /);
    expect(entry.kind).toBeUndefined();
  });

  it("is a show when it has a season", () => {
    expect(entryOfActivity(watched("pro_sam", "show", { season: 1, episode: 3, image: "poster", year: 2016 }), "Sam", NOW)).toMatchObject({ kind: "series", image: "poster", year: 2016 });
  });

  it("says the episode in the line and how far in with the bar", () => {
    const entry = entryOfActivity(watched("pro_sam", "show", { season: 2, episode: 5, percent: 63 }), "Sam", NOW);
    expect(entry.note).toMatch(/^Sam · S2:E5 · /);
    expect(entry.progress).toBe(0.63);
    expect(entryOfActivity(watched("pro_sam", "k1"), "Sam", NOW).progress).toBeUndefined();
  });
});

describe("a friend's lists", () => {
  const lists = (): FriendLists => ({
    listNames: [
      { key: "horror", at: 1, name: "Horror" },
      { key: "cosy", at: 2, name: "Cosy", order: 0 },
      { key: "gone", at: 3, deleted: true },
    ],
    list: [
      { key: "k1", at: 1, id: "k1", title: "Alien", url: "https://x.example/alien" },
      { key: "k2", at: 2, list: "horror", id: "k2", title: "It", url: "https://x.example/it" },
      { key: "k3", at: 3, list: "cosy", id: "k3", title: "Paddington", url: "https://x.example/paddington", image: "poster" },
      { key: "k4", at: 4, list: "gone", id: "k4", title: "Lost", url: "https://x.example/lost" },
      { key: "k5", at: 5, list: "horror", deleted: true },
    ],
  });

  it("are the first one, then the others in the order the friend put them, each with its titles", () => {
    expect(listsOf(lists()).map((each) => [each.info.id, each.items.map((item) => item.title)])).toEqual([
      [DEFAULT_LIST, ["Alien"]],
      ["cosy", ["Paddington"]],
      ["horror", ["It"]],
    ]);
  });

  it("leave out a list with nothing in it, and titles that were taken out or are in a list that is gone", () => {
    const some = listsOf({ listNames: lists().listNames, list: [{ key: "k2", at: 2, list: "horror", id: "k2", title: "It", url: "https://x.example/it" }] });
    expect(some.map((each) => each.info.id)).toEqual(["horror"]);
    expect(listsOf({ listNames: [], list: [] })).toEqual([]);
  });

  it("show their titles as cards that play them", () => {
    const [, cosy] = listsOf(lists());
    expect(cosy && entriesOfList(cosy)).toEqual([{ id: "k3", title: "Paddington", url: "https://x.example/paddington", image: "poster" }]);
  });
});

describe("what a friend rated", () => {
  const ratings = (): FriendRatings => ({
    ratings: [
      { key: "rate:a", at: 1, title: "Alien", url: "https://x.example/alien", score: 9, ratedAt: 100, kind: "movie", image: "poster" },
      { key: "rate:b|s2", at: 2, title: "Dark", url: "https://x.example/dark", score: 7, ratedAt: 200, season: 2 },
      { key: "rate:c", at: 3, deleted: true },
    ],
  });

  it("is what they gave a score and did not take back", () => {
    expect(ratedBy(ratings()).map((rating) => rating.title)).toEqual(["Alien", "Dark"]);
  });

  it("shows as cards that play the title, with the score under it (and the season, when it is for one)", () => {
    const entries = entriesOfRatings(ratedBy(ratings()));
    expect(entries.map((entry) => entry.note)).toEqual(["9/10", `${t("player.season", { n: 2 })} · 7/10`]);
    expect(entries[0]).toMatchObject({ id: "rate:a", url: "https://x.example/alien", image: "poster", kind: "movie" });
  });
});
