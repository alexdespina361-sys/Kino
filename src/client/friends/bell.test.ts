import { describe, expect, it } from "vitest";
import { PLAN_KEEP_AFTER_MS, type ActivityItem, type Friend, type FriendRequest, type FriendsState, type InboxItem, type PlanItem } from "../../shared";
import { BELL_LATELY, BELL_WAITING, bellView, hasNewActivity } from "./bell";

const NOW = 50_000_000;
const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: true, inbox: true };
const state = (changes: Partial<FriendsState> = {}): FriendsState => ({ friends: [sam], inbox: [], activity: [], invites: [], requests: [], sent: [], ...changes });
const recommendation = (id: string, at: number): InboxItem => ({ kind: "recommend", id, from: "pro_sam", at, read: false, title: "Dune", url: "https://filmpire.sc/watch/1" });
const invitation = (id: string, at: number, endsAt: number): InboxItem => ({ kind: "party", id, from: "pro_sam", at, read: false, code: "482731", endsAt });
const together = (id: string, at: number): InboxItem => ({ kind: "together", id, from: "pro_sam", at, read: false });
const plan = (id: string, at: number, when: number, extra: Partial<PlanItem> = {}): InboxItem => ({ kind: "plan", id, from: "pro_sam", at, read: false, when, ...extra });
const ask = (id: string, at: number): FriendRequest => ({ from: { id, name: id, avatar: "cat", tag: 1 }, at });
const watched = (key: string, at: number, friend = "pro_sam"): ActivityItem => ({ friend, key, title: "Alien", url: "https://filmpire.sc/watch/2", at });

describe("what the bell lists", () => {
  it("is nothing when nothing waits and nothing was watched", () => {
    expect(bellView(state(), NOW)).toEqual({ requests: [], inbox: [], lately: [], more: 0 });
  });

  it("puts an invitation to a party that is on first, then a request to watch together, then titles, then a party that is over, the newest first within each", () => {
    const over = invitation("over", NOW - 10, NOW - 5);
    const live = invitation("live", NOW - 20, NOW + 60_000);
    const view = bellView(state({ inbox: [recommendation("old", NOW - 400), over, recommendation("new", NOW - 30), together("w", NOW - 40), live] }), NOW);
    expect(view.inbox.map((item) => item.id)).toEqual(["live", "w", "new", "old", "over"]);
  });

  it("puts a plan whose time has come with the parties that are on, a plan that asks after a request to watch together, and the news of the others last", () => {
    const due = plan("due", NOW - 90, NOW - 10, { answer: "yes" });
    const asks = plan("asks", NOW - 80, NOW + 3_600_000);
    const agreed = plan("agreed", NOW - 70, NOW + 7_200_000, { answer: "yes" });
    const no = plan("no", NOW - 60, NOW + 3_600_000, { answer: "no" });
    const live = invitation("live", NOW - 20, NOW + 60_000);
    const view = bellView(state({ inbox: [recommendation("title", NOW - 30), asks, together("w", NOW - 40), due, live, no, agreed] }), NOW);
    expect(view.inbox.map((item) => item.id)).toEqual(["live", "due", "w", "asks", "title", "no", "agreed"]);
  });

  it("leaves out a plan that is over: nobody answered by its time, or its time came and went", () => {
    const view = bellView(state({ inbox: [plan("unanswered", NOW - 5, NOW - 1), plan("gone", NOW - 5, NOW - PLAN_KEEP_AFTER_MS - 1, { answer: "yes" }), recommendation("title", NOW - 30)] }), NOW);
    expect(view.inbox.map((item) => item.id)).toEqual(["title"]);
    expect(view.more).toBe(0);
  });

  it("lists the requests to be friends before anything else, the newest first", () => {
    const view = bellView(state({ requests: [ask("old", NOW - 500), ask("new", NOW - 5)], inbox: [recommendation("a", NOW)] }), NOW);
    expect(view.requests.map((request) => request.from.id)).toEqual(["new", "old"]);
    expect(view.inbox).toHaveLength(1);
  });

  it("shows only so many, requests first, and says how many are left for the Friends page", () => {
    const requests = Array.from({ length: 3 }, (_, at) => ask(`r${at}`, NOW - at));
    const inbox = Array.from({ length: BELL_WAITING }, (_, at) => recommendation(`t${at}`, NOW - at));
    const view = bellView(state({ requests, inbox }), NOW);
    expect(view.requests).toHaveLength(3);
    expect(view.inbox).toHaveLength(BELL_WAITING - 3);
    expect(view.more).toBe(3);
    expect(bellView(state({ requests: Array.from({ length: BELL_WAITING + 2 }, (_, at) => ask(`q${at}`, NOW - at)) }), NOW)).toMatchObject({ inbox: [], more: 2 });
  });

  it("lists what friends watched, the newest first, a few of it, and leaves out whoever is not a friend any more", () => {
    const activity = [watched("a", NOW - 300), watched("b", NOW - 100), watched("gone", NOW - 50, "pro_gone"), ...Array.from({ length: BELL_LATELY }, (_, at) => watched(`c${at}`, NOW - 1000 - at))];
    const view = bellView(state({ activity }), NOW);
    expect(view.lately.map((item) => item.key)).toEqual(["b", "a", "c0", "c1"].slice(0, BELL_LATELY));
    expect(view.lately).toHaveLength(BELL_LATELY);
  });
});

describe("whether friends watched something new", () => {
  it("is so when something was watched after the bell was last opened, by a friend this profile still has", () => {
    const seen = NOW - 1000;
    expect(hasNewActivity(state({ activity: [watched("a", NOW - 500)] }), seen)).toBe(true);
    expect(hasNewActivity(state({ activity: [watched("a", NOW - 2000)] }), seen)).toBe(false);
    expect(hasNewActivity(state({ activity: [watched("a", NOW - 500, "pro_gone")] }), seen)).toBe(false);
    expect(hasNewActivity(state(), seen)).toBe(false);
  });
});
