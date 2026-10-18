import { describe, expect, it } from "vitest";
import { titleLink, type ActivityItem, type Friend, type FriendLists, type FriendRatings, type FriendsState, type InboxItem } from "../../shared";
import { formatDay } from "../account/time";
import { getLanguage, t } from "../i18n";
import { friendGrid, friendRows } from "./pages";

const NOW = 50_000_000;
const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1_700_000_000_000, on: true, lists: true, ratings: true, activity: true, inbox: true };
const robin: Friend = { ...sam, id: "pro_robin", name: "Robin" };
const recommendation = (id: string, from = "pro_sam", extra: { note?: string } = {}): InboxItem => ({ kind: "recommend", id, from, at: NOW - 60_000, read: false, title: "Dune", url: "https://filmpire.sc/watch/1", ...extra });
const invitation = (id: string, endsAt = NOW + 3_600_000, from = "pro_sam", open?: boolean): InboxItem => ({ kind: "party", id, from, at: NOW - 60_000, read: false, code: "482731", endsAt, ...(open === undefined ? {} : { open }) });
const request = (id: string, from = "pro_sam"): InboxItem => ({ kind: "together", id, from, at: NOW - 120_000, read: false });
const watched = (friend: string, key: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({ friend, key, title: "Alien", url: "https://filmpire.sc/watch/2", at: NOW - 60_000, ...extra });
const state = (changes: Partial<FriendsState> = {}): FriendsState => ({ friends: [sam], inbox: [], activity: [], invites: [], requests: [], sent: [], ...changes });
const since = (friend: Friend) => t("friends.since", { day: formatDay(friend.since, getLanguage()) });

describe("the rows of the friends page", () => {
  it("are only the tiles to add a friend and to choose what is shared, before the server has answered", () => {
    const rows = friendRows(null, NOW);
    expect(rows.map((row) => row.id)).toEqual(["friend-people"]);
    expect(rows[0]?.entries.map((entry) => entry.action)).toEqual(["addFriend", "friendSettings"]);
  });

  it("are, with nothing sent and nothing watched, the friends row alone", () => {
    expect(friendRows(state(), NOW).map((row) => row.id)).toEqual(["friend-people"]);
  });

  it("are the parties, what was sent, what friends watch and the friends, in that order", () => {
    const rows = friendRows(state({ inbox: [recommendation("r"), invitation("p")], activity: [watched("pro_sam", "k")] }), NOW);
    expect(rows.map((row) => row.id)).toEqual(["friend-parties", "friend-sent", "friend-activity", "friend-people"]);
    expect(rows.map((row) => row.layout)).toEqual(["wide", "wide", "wide", "categories"]);
  });

  it("start with the requests to be friends that wait for an answer: a tile for each, with the tag and the picture, that asks yes or no", () => {
    const kim = { id: "pro_kim", name: "Kim", avatar: "cat" as const, tag: 2 };
    const rows = friendRows(state({ requests: [{ from: kim, at: NOW - 1000 }], inbox: [invitation("p")] }), NOW);
    expect(rows.map((row) => row.id)).toEqual(["friend-requests", "friend-parties", "friend-people"]);
    expect(rows[0]).toMatchObject({ layout: "categories", title: t("friends.requests") });
    expect(rows[0]?.entries).toEqual([{ id: "request:pro_kim", title: "Kim#2", url: "", request: kim, avatar: "cat", note: t("friends.requestWants") }]);
    expect(friendRows(state(), NOW).some((row) => row.id === "friend-requests")).toBe(false);
  });

  it("have a tile for each friend that opens their page, before the tiles to add one and to choose what is shared", () => {
    const rows = friendRows(state({ friends: [sam, robin] }), NOW);
    const people = rows.find((row) => row.id === "friend-people");
    expect(people?.entries.map((entry) => entry.title)).toEqual(["Sam", "Robin", t("friends.add"), t("friends.settingsTile")]);
    expect(people?.entries[0]).toMatchObject({ id: "friend:pro_sam", url: "", opens: { kind: "friend", id: "pro_sam" } });
    expect(people?.entries[2]).toMatchObject({ url: "", action: "addFriend" });
    expect(people?.entries[3]).toMatchObject({ url: "", action: "friendSettings" });
  });

  it("say under a friend's name what they are watching, else since when they are friends, else that they turned friends off", () => {
    const people = (changes: Partial<FriendsState>) => friendRows(state(changes), NOW).find((row) => row.id === "friend-people")?.entries ?? [];
    expect(people({ activity: [watched("pro_sam", "k")] })[0]?.note).toBe(t("friends.line.watching", { title: "Alien" }));
    expect(people({ activity: [watched("pro_sam", "k", { done: true })] })[0]?.note).toBe(t("friends.line.finished", { title: "Alien" }));
    expect(people({})[0]?.note).toBe(since(sam));
    expect(people({ friends: [{ ...sam, on: false }], activity: [watched("pro_sam", "k")] })[0]?.note).toBe(t("friends.paused"));
  });

  it("give a friend's tile their picture, and say they are online when they are (a friend who turned friends off is not)", () => {
    const people = (friend: Friend) => friendRows(state({ friends: [friend] }), NOW).find((row) => row.id === "friend-people")?.entries[0];
    expect(people(sam)).toMatchObject({ avatar: "fox" });
    expect(people(sam)?.online).toBeUndefined();
    expect(people({ ...sam, online: true })).toMatchObject({ avatar: "fox", online: true, note: t("friends.online") });
    expect(people({ ...sam, on: false, online: true })?.online).toBeUndefined();
  });

  it("show an invitation to a party that is on as a tile that joins it, with the code to read and who invited", () => {
    const rows = friendRows(state({ inbox: [invitation("p1")] }), NOW);
    const parties = rows.find((row) => row.id === "friend-parties");
    expect(parties?.entries).toHaveLength(1);
    expect(parties?.entries[0]).toMatchObject({ id: "party:p1", title: t("friends.partyOf", { name: "Sam" }), url: "", party: "482731", inboxId: "p1" });
    expect(parties?.entries[0]?.note).toContain("482 731");
  });

  it("turn an invitation to a party that is over into a tile that asks the friend to watch together instead", () => {
    const rows = friendRows(state({ inbox: [invitation("old", NOW - 1), invitation("p2")] }), NOW);
    const entries = rows.find((row) => row.id === "friend-parties")?.entries ?? [];
    expect(entries.map((entry) => entry.inboxId)).toEqual(["old", "p2"]);
    expect(entries[0]).toMatchObject({ id: "party:old", title: t("friends.partyOf", { name: "Sam" }), url: "", ask: "pro_sam", inboxId: "old" });
    expect(entries[0]).not.toHaveProperty("party"); // (there is nothing to join)
    expect(entries[0]?.note).toContain(t("friends.partyOver"));
    expect(entries[1]).toMatchObject({ party: "482731" });
  });

  it("leave out an invitation to a party that is over when the friend cannot be asked: they do not take things, or have turned friends off", () => {
    const over = [invitation("old", NOW - 1)];
    for (const friend of [{ ...sam, inbox: false }, { ...sam, on: false }]) {
      expect(friendRows(state({ friends: [friend], inbox: over }), NOW).map((row) => row.id)).toEqual(["friend-people"]);
    }
    expect(friendRows(state({ friends: [], inbox: over }), NOW).map((row) => row.id)).toEqual(["friend-people"]);
    // (telling what they watch is not needed to be asked: it is off until it is turned on)
    expect(friendRows(state({ friends: [{ ...sam, activity: false }], inbox: over }), NOW).map((row) => row.id)).toEqual(["friend-parties", "friend-people"]);
  });

  it("say, in a tile that opens the settings, that being told what friends watch is off: only while it is off, with a friend to hear from, and nothing to show", () => {
    const row = (changes: Partial<FriendsState>, iGet: boolean) => friendRows(state(changes), NOW, iGet).find((each) => each.id === "friend-activity-off");
    expect(row({}, false)).toMatchObject({ layout: "categories", title: t("friends.activity") });
    expect(row({}, false)?.entries).toEqual([{ id: "activity-off", title: t("friends.turnOn"), url: "", note: t("friends.switchGet"), action: "friendSettings" }]);
    expect(friendRows(state(), NOW, false).map((each) => each.id)).toEqual(["friend-people", "friend-activity-off"]); // (below the friends: the remote starts on them)
    expect(row({}, true)).toBeUndefined(); // (on: as before, the row is there when there is something to show)
    expect(row({ friends: [{ ...sam, on: false }] }, false)).toBeUndefined(); // (nobody who could be heard from)
    expect(row({ friends: [] }, false)).toBeUndefined();
    expect(friendRows(state({ activity: [watched("pro_sam", "k")] }), NOW, false).map((each) => each.id)).toEqual(["friend-activity", "friend-people"]);
  });

  it("go by what the server says of a party, when it says: open is open whatever the clock, and over is over", () => {
    const entries = (item: InboxItem) => friendRows(state({ inbox: [item] }), NOW).find((row) => row.id === "friend-parties")?.entries ?? [];
    expect(entries(invitation("a", NOW - 1, "pro_sam", true))[0]).toMatchObject({ party: "482731" });
    expect(entries(invitation("b", NOW + 3_600_000, "pro_sam", false))[0]).toMatchObject({ ask: "pro_sam" });
    expect(entries(invitation("b", NOW + 3_600_000, "pro_sam", false))[0]).not.toHaveProperty("party");
  });

  it("show a friend's request to watch together as a tile that starts a party for them, with who and when", () => {
    const parties = friendRows(state({ inbox: [request("t1")] }), NOW).find((row) => row.id === "friend-parties");
    expect(parties?.entries).toHaveLength(1);
    expect(parties?.entries[0]).toMatchObject({ id: "together:t1", title: t("friends.togetherOf", { name: "Sam" }), url: "", wants: "pro_sam", inboxId: "t1" });
  });

  it("show a title a friend sent as a card that plays it, says who sent it, and is taken off the row by its item of the inbox", () => {
    const sent = friendRows(state({ inbox: [recommendation("r1", "pro_sam", { note: "Slow but worth it" })] }), NOW).find((row) => row.id === "friend-sent");
    expect(sent?.entries).toHaveLength(1);
    expect(sent?.entries[0]).toMatchObject({ id: "from:r1", title: "Dune", url: "https://filmpire.sc/watch/1", note: t("friends.from", { name: "Sam" }), description: "Slow but worth it", inboxId: "r1" });
  });

  it("show what friends watched as cards that play it, with who and when", () => {
    const activity = friendRows(state({ friends: [sam, robin], activity: [watched("pro_sam", "k1"), watched("pro_robin", "k2", { title: "Heat" })] }), NOW).find((row) => row.id === "friend-activity");
    expect(activity?.entries.map((entry) => entry.title)).toEqual(["Alien", "Heat"]);
    expect(activity?.entries[0]?.url).toBe("https://filmpire.sc/watch/2");
    expect(activity?.entries[0]?.note).toMatch(/^Sam · /);
    expect(activity?.entries[1]?.note).toMatch(/^Robin · /);
  });
});

describe("a friend's page", () => {
  const view = { kind: "friend", id: "pro_sam" } as const;
  const lists = (): FriendLists => ({
    listNames: [{ key: "horror", at: 1, name: "Horror" }],
    list: [
      { key: "k1", at: 1, id: "k1", title: "Alien", url: "https://x.example/alien" },
      { key: "k2", at: 2, list: "horror", id: "k2", title: "It", url: "https://x.example/it", image: "poster-it" },
      { key: "k3", at: 3, deleted: true },
    ],
  });
  const ratings = (): FriendRatings => ({
    ratings: [
      { key: "rate:a", at: 1, title: "Alien", url: "https://x.example/alien", score: 9, ratedAt: 100, kind: "movie" },
      { key: "rate:b", at: 3, title: "Heat", url: "https://x.example/heat", score: 8, ratedAt: 300 },
      { key: "rate:c|s2", at: 2, title: "Dark", url: "https://x.example/dark", score: 7, ratedAt: 200, season: 2, kind: "series" },
      { key: "rate:gone", at: 4, deleted: true },
    ],
  });

  it("is none for anything that is not a friend's page, and for a friend who is gone", () => {
    expect(friendGrid({ kind: "home" }, state(), null, null)).toBeNull();
    expect(friendGrid({ kind: "friend", id: "pro_nobody" }, state(), null, null)).toBeNull();
    expect(friendGrid(view, null, null, null)).toBeNull();
  });

  it("is headed by the friend's name and since when they are friends", () => {
    const grid = friendGrid(view, state(), { data: lists() }, null);
    expect(grid).toMatchObject({ title: "Sam", meta: since(sam), layout: "wide" });
  });

  it("says under the name what the friend is doing: watching, when it is told, else online", () => {
    const doing = state({ activity: [watched("pro_sam", "k")] });
    expect(friendGrid(view, doing, { data: lists() }, null, true, NOW)?.meta).toBe(`${t("friends.line.watching", { title: "Alien" })}  ·  ${since(sam)}`);
    expect(friendGrid(view, { ...doing, friends: [{ ...sam, online: true }] }, { data: lists() }, null, true, NOW)?.meta).toContain(t("friends.line.watching", { title: "Alien" })); // (watching says more than online)
  });

  it("says, when what a friend watches is not shown, why: this profile is not told, else the friend does not tell", () => {
    const quiet = state({ friends: [{ ...sam, activity: false }] });
    expect(friendGrid(view, quiet, { data: lists() }, null, false)?.hint).toBe(t("friends.hintMine", { name: "Sam", switch: t("friends.switchGet") }));
    expect(friendGrid(view, quiet, { data: lists() }, null, true)?.hint).toBe(t("friends.hintTheirs", { name: "Sam" }));
    expect(friendGrid(view, state(), { data: lists() }, null, false)).not.toHaveProperty("hint"); // (it is shown: nothing to explain)
    expect(friendGrid(view, state({ friends: [{ ...sam, on: false, activity: false }] }), null, null, false)).not.toHaveProperty("hint"); // (friends off has a line of its own)
  });

  it("shows the titles in the lists they keep, each marked with its list, and none that were taken out", () => {
    const grid = friendGrid(view, state(), { data: lists() }, null);
    expect(grid?.entries.map((entry) => entry.title)).toEqual(["Alien", "It"]);
    expect(grid?.entries.map((entry) => entry.note)).toEqual([t("list.favourites"), "Horror"]);
    expect(grid?.entries[1]).toMatchObject({ url: "https://x.example/it", image: "poster-it" });
  });

  it("says that the friend is online, and puts how far they got on the titles they kept and rated", () => {
    expect(friendGrid(view, state({ friends: [{ ...sam, online: true }] }), { data: lists() }, null)?.meta).toBe(`${t("friends.online")}  ·  ${since(sam)}`);
    const progress = [{ link: titleLink("https://x.example/alien"), season: 2, episode: 5, percent: 63 }];
    const kept = friendGrid(view, state(), { data: { ...lists(), progress } }, null);
    expect(kept?.entries[0]).toMatchObject({ title: "Alien", progress: 0.63, note: `S2:E5 · 63% · ${t("list.favourites")}` });
    expect(kept?.entries[1]?.progress).toBeUndefined();
    const rated = friendGrid({ ...view, tab: "ratings" }, state(), null, { data: { ...ratings(), progress } });
    expect(rated?.entries.find((entry) => entry.title === "Alien")).toMatchObject({ progress: 0.63, note: "S2:E5 · 63% · 9/10" });
  });

  it("has lists as its first tab, and says there is nothing when they have no titles", () => {
    const grid = friendGrid({ kind: "friend", id: "pro_sam", tab: "lists" }, state(), { data: { listNames: [], list: [] } }, null);
    expect(grid).toMatchObject({ entries: [], empty: t("friends.noLists", { name: "Sam" }) });
  });

  it("shows what they rated, the latest first, with the score (and the season) under each", () => {
    const grid = friendGrid({ ...view, tab: "ratings" }, state(), null, { data: ratings() });
    expect(grid?.entries.map((entry) => entry.title)).toEqual(["Heat", "Dark", "Alien"]);
    expect(grid?.entries.map((entry) => entry.note)).toEqual(["8/10", `${t("player.season", { n: 2 })} · 7/10`, "9/10"]);
    expect(grid?.entries[2]).toMatchObject({ url: "https://x.example/alien", kind: "movie" });
  });

  it("says there is nothing when they have not rated anything", () => {
    const grid = friendGrid({ ...view, tab: "ratings" }, state(), null, { data: { ratings: [] } });
    expect(grid).toMatchObject({ entries: [], empty: t("friends.noRatings", { name: "Sam" }) });
  });

  it("says why there is nothing to see when the friend does not share it", () => {
    const quiet = state({ friends: [{ ...sam, lists: false, ratings: false }] });
    expect(friendGrid(view, quiet, { data: lists() }, null)).toMatchObject({ entries: [], empty: t("friends.notSharingLists", { name: "Sam" }) });
    expect(friendGrid({ ...view, tab: "ratings" }, quiet, null, { data: ratings() })).toMatchObject({ entries: [], empty: t("friends.notSharingRatings", { name: "Sam" }) });
  });

  it("says friends are off for a friend who turned them off, whichever tab is open", () => {
    const off = state({ friends: [{ ...sam, on: false }] });
    const said = { entries: [], empty: t("friends.theirsOff", { name: "Sam" }), meta: t("friends.paused") };
    expect(friendGrid(view, off, { data: lists() }, null)).toMatchObject(said);
    expect(friendGrid({ ...view, tab: "ratings" }, off, null, { data: ratings() })).toMatchObject(said);
  });

  it("says it is loading until the server has answered, and what went wrong if it could not", () => {
    expect(friendGrid(view, state(), null, null)).toMatchObject({ entries: [], empty: t("common.loading") });
    expect(friendGrid(view, state(), { problem: "not_shared" }, null)).toMatchObject({ entries: [], empty: "not_shared" });
    expect(friendGrid({ ...view, tab: "ratings" }, state(), null, null)).toMatchObject({ entries: [], empty: t("common.loading") });
    expect(friendGrid({ ...view, tab: "ratings" }, state(), null, { problem: "offline" })).toMatchObject({ entries: [], empty: "offline" });
  });
});
