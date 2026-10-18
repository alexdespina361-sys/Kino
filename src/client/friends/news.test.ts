import { describe, expect, it } from "vitest";
import type { ActivityItem, Friend, FriendsState, InboxItem, PlanItem } from "../../shared";
import { NEWS_RECENT_MS, describeNews, isUrgent, known, whatsNew, type News, type Translate } from "./news";

const NOW = 50_000_000;
const sam: Friend = { id: "pro_sam", name: "Sam", avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: true, inbox: true };
const robin: Friend = { ...sam, id: "pro_robin", name: "Robin" };
const recommendation = (id: string, from = "pro_sam", read = false): InboxItem => ({ kind: "recommend", id, from, at: NOW, read, title: "Dune", url: "https://filmpire.sc/watch/1" });
const invitation = (id: string, from = "pro_sam", endsAt = NOW + 1): InboxItem => ({ kind: "party", id, from, at: NOW, read: false, code: "482731", endsAt });
const plan = (id: string, when: number, extra: Partial<PlanItem> = {}, from = "pro_sam"): InboxItem => ({ kind: "plan", id, from, at: NOW, read: false, when, ...extra });
const watched = (friend: string, key: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({ friend, key, title: "Alien", url: "https://filmpire.sc/watch/2", at: NOW - 60_000, ...extra });
const state = (changes: Partial<FriendsState> = {}): FriendsState => ({ friends: [sam], inbox: [], activity: [], invites: [], requests: [], sent: [], ...changes });

describe("what is new", () => {
  it("is nothing the first time a screen looks, whatever there is", () => {
    expect(whatsNew(null, state({ inbox: [recommendation("a")], activity: [watched("pro_sam", "k")] }), NOW)).toEqual([]);
  });

  it("is nothing when nothing changed", () => {
    const before = state({ inbox: [recommendation("a")], activity: [watched("pro_sam", "k")] });
    expect(whatsNew(known(before), before, NOW)).toEqual([]);
  });

  it("is a title or an invitation that arrived and has not been seen, with who sent it, the invitation first", () => {
    const before = known(state());
    const news = whatsNew(before, state({ inbox: [recommendation("a"), invitation("b"), recommendation("seen", "pro_sam", true)] }), NOW);
    expect(news).toEqual([
      { kind: "party", name: "Sam" },
      { kind: "recommend", name: "Sam", title: "Dune" },
    ]);
  });

  it("leaves out an invitation to a party that is over by the time the screen looks, by the server's word or else by the clock", () => {
    expect(whatsNew(known(state()), state({ inbox: [invitation("late", "pro_sam", NOW), recommendation("a")] }), NOW)).toEqual([{ kind: "recommend", name: "Sam", title: "Dune" }]);
    expect(whatsNew(known(state()), state({ inbox: [{ ...invitation("over", "pro_sam", NOW + 1_000_000), open: false } as InboxItem] }), NOW)).toEqual([]);
    expect(whatsNew(known(state()), state({ inbox: [{ ...invitation("on", "pro_sam", NOW - 1), open: true } as InboxItem] }), NOW)).toEqual([{ kind: "party", name: "Sam" }]);
  });

  it("is a friend's request to watch together, after an invitation and before the rest", () => {
    const ask: InboxItem = { kind: "together", id: "w", from: "pro_sam", at: NOW, read: false };
    expect(whatsNew(known(state()), state({ inbox: [recommendation("a"), ask] }), NOW)).toEqual([
      { kind: "together", name: "Sam" },
      { kind: "recommend", name: "Sam", title: "Dune" },
    ]);
  });

  it("is a plan a friend proposes, with when, after a request to watch together and before a request to be friends", () => {
    const together: InboxItem = { kind: "together", id: "w", from: "pro_sam", at: NOW, read: false };
    const kim = { from: { id: "pro_kim", name: "Kim", avatar: "cat" as const, tag: 2 }, at: NOW };
    const news = whatsNew(known(state()), state({ inbox: [recommendation("a"), plan("p", NOW + 3_600_000), together], requests: [kim] }), NOW);
    expect(news).toEqual([
      { kind: "together", name: "Sam" },
      { kind: "plan", name: "Sam", when: NOW + 3_600_000 },
      { kind: "request", name: "Kim#2" },
      { kind: "recommend", name: "Sam", title: "Dune" },
    ]);
  });

  it("is a friend's answer to a plan of ours, yes or no, with the time we proposed", () => {
    const news = whatsNew(known(state()), state({ inbox: [plan("y", NOW + 3_600_000, { answer: "yes" }), plan("n", NOW + 7_200_000, { answer: "no" })] }), NOW);
    expect(news).toEqual([
      { kind: "planYes", name: "Sam", when: NOW + 3_600_000 },
      { kind: "planNo", name: "Sam", when: NOW + 7_200_000 },
    ]);
  });

  it("is not a plan that is over, one already read, or one that was there before", () => {
    const seen = plan("old", NOW + 3_600_000);
    expect(whatsNew(known(state({ inbox: [seen] })), state({ inbox: [seen] }), NOW)).toEqual([]);
    expect(whatsNew(known(state()), state({ inbox: [plan("late", NOW)] }), NOW)).toEqual([]); // (no answer by its time: nothing to say yes to)
    expect(whatsNew(known(state()), state({ inbox: [plan("read", NOW + 3_600_000, { read: true })] }), NOW)).toEqual([]);
  });

  it("is somebody who asked to be friends and has not been told of before, by their tag, after a request for a party and before the rest", () => {
    const ask = (id: string, tag: number) => ({ from: { id, name: "Kim", avatar: "cat" as const, tag }, at: NOW });
    const before = known(state({ requests: [ask("pro_old", 1)] }));
    expect(before.requests.has("pro_old")).toBe(true);
    expect(whatsNew(before, state({ requests: [ask("pro_old", 1), ask("pro_kim", 2)], inbox: [recommendation("a")] }), NOW)).toEqual([
      { kind: "request", name: "Kim#2" },
      { kind: "recommend", name: "Sam", title: "Dune" },
    ]);
  });

  it("is a new friend, whoever added whom", () => {
    expect(whatsNew(known(state()), state({ friends: [sam, robin] }), NOW)).toEqual([{ kind: "friend", name: "Robin" }]);
  });

  it("is something a friend watched just now, and only just now", () => {
    const before = known(state());
    const news = whatsNew(before, state({ activity: [watched("pro_sam", "k1"), watched("pro_sam", "k2", { at: NOW - NEWS_RECENT_MS - 1 })] }), NOW);
    expect(news).toEqual([{ kind: "activity", name: "Sam", title: "Alien", verb: "watching" }]);
  });

  it("is not said again as the minute a friend is in moves, but is when they finish it, or go on to the next episode", () => {
    const first = state({ activity: [watched("pro_sam", "show:x", { season: 1, episode: 1 })] });
    const later = state({ activity: [watched("pro_sam", "show:x", { season: 1, episode: 1, at: NOW - 1000 })] });
    expect(whatsNew(known(first), later, NOW)).toEqual([]);
    const finished = state({ activity: [watched("pro_sam", "show:x", { season: 1, episode: 1, done: true })] });
    expect(whatsNew(known(first), finished, NOW)).toMatchObject([{ kind: "activity", verb: "finished" }]);
    const next = state({ activity: [watched("pro_sam", "show:x", { season: 1, episode: 2 })] });
    expect(whatsNew(known(first), next, NOW)).toMatchObject([{ kind: "activity", verb: "watching" }]);
  });
});

describe("saying it", () => {
  const t: Translate = (key, params) => `${key}${params ? ` ${JSON.stringify(params)}` : ""}`;

  it("says nothing when there is nothing", () => {
    expect(describeNews([], t)).toBeUndefined();
  });

  it("says the one thing that happened", () => {
    expect(describeNews([{ kind: "recommend", name: "Sam", title: "Dune" }], t)).toBe('friends.news.recommend {"name":"Sam","title":"Dune"}');
    expect(describeNews([{ kind: "friend", name: "Robin" }], t)).toBe('friends.news.friend {"name":"Robin"}');
    expect(describeNews([{ kind: "activity", name: "Sam", title: "Alien", verb: "finished" }], t)).toBe('friends.finished {"name":"Sam","title":"Alien"}');
  });

  it("says a plan with its time, put into words by the screen", () => {
    const when = (at: number) => `at ${at}`;
    expect(describeNews([{ kind: "plan", name: "Sam", when: 5 }], t, when)).toBe('friends.news.plan {"name":"Sam","when":"at 5"}');
    expect(describeNews([{ kind: "planYes", name: "Sam", when: 5 }], t, when)).toBe('friends.news.planYes {"name":"Sam","when":"at 5"}');
    expect(describeNews([{ kind: "planNo", name: "Sam", when: 5 }], t, when)).toBe('friends.news.planNo {"name":"Sam","when":"at 5"}');
  });

  it("says a plan that asks among other news, after an invitation and a request to watch together, before a request to be friends", () => {
    const news: News[] = [
      { kind: "recommend", name: "Sam", title: "Dune" },
      { kind: "friend", name: "Robin" },
    ];
    const proposal: News = { kind: "plan", name: "Sam", when: 5 };
    expect(describeNews([...news, proposal], t)).toBe('friends.news.plan {"name":"Sam","when":""}');
    expect(describeNews([{ kind: "request", name: "Kim#2" }, proposal], t)).toBe('friends.news.plan {"name":"Sam","when":""}');
    expect(describeNews([proposal, { kind: "together", name: "Robin" }], t)).toBe('friends.news.together {"name":"Robin"}');
    expect(describeNews([proposal, { kind: "party", name: "Robin" }], t)).toBe('friends.news.party {"name":"Robin"}');
    // (an answer is no question: with other news it counts among the rest)
    expect(describeNews([...news, { kind: "planYes", name: "Sam", when: 5 }], t)).toBe('friends.news.many {"count":3}');
  });

  it("says how many when there are several, except that an invitation to a party is always said", () => {
    const news: News[] = [
      { kind: "recommend", name: "Sam", title: "Dune" },
      { kind: "friend", name: "Robin" },
    ];
    expect(describeNews(news, t)).toBe('friends.news.many {"count":2}');
    expect(describeNews([...news, { kind: "party", name: "Sam" }], t)).toBe('friends.news.party {"name":"Sam"}');
    expect(describeNews([...news, { kind: "together", name: "Sam" }], t)).toBe('friends.news.together {"name":"Sam"}'); // (a request for a party too, but an invitation first)
    expect(describeNews([{ kind: "together", name: "Sam" }, { kind: "party", name: "Robin" }], t)).toBe('friends.news.party {"name":"Robin"}');
    // A request to be friends is always said too, after the two above.
    expect(describeNews([...news, { kind: "request", name: "Kim#2" }], t)).toBe('friends.news.request {"name":"Kim#2"}');
    expect(describeNews([{ kind: "request", name: "Kim#2" }, { kind: "together", name: "Sam" }], t)).toBe('friends.news.together {"name":"Sam"}');
  });
});

describe("what is let over a film", () => {
  const t: Translate = (key) => key;
  const quiet: News[] = [
    { kind: "recommend", name: "Sam", title: "Dune" },
    { kind: "friend", name: "Robin" },
    { kind: "request", name: "Kim#2" },
    { kind: "plan", name: "Sam", when: 5 },
    { kind: "planYes", name: "Sam", when: 5 },
    { kind: "planNo", name: "Sam", when: 5 },
    { kind: "activity", name: "Sam", title: "Alien", verb: "watching" },
  ];

  it("is an invitation to something going on, or a friend asking to watch together, and nothing else", () => {
    expect(isUrgent([{ kind: "party", name: "Sam" }])).toBe(true);
    expect(isUrgent([{ kind: "together", name: "Sam" }])).toBe(true);
    expect(isUrgent([])).toBe(false);
    for (const item of quiet) expect(isUrgent([item])).toBe(false);
    expect(isUrgent(quiet)).toBe(false);
  });

  it("is so when an invitation is among other news, and the line that is said is then the invitation", () => {
    for (const urgent of [{ kind: "party", name: "Sam" }, { kind: "together", name: "Sam" }] as const) {
      expect(isUrgent([...quiet, urgent])).toBe(true);
      expect(describeNews([...quiet, urgent], t)).toBe(urgent.kind === "party" ? "friends.news.party" : "friends.news.together");
    }
  });

  it("never lets through a line that is not about an invitation, and never holds back one that is", () => {
    const every: News[][] = [[], ...quiet.map((item) => [item]), quiet, [{ kind: "party", name: "A" }], [{ kind: "together", name: "A" }], [...quiet, { kind: "together", name: "A" }], [{ kind: "together", name: "A" }, { kind: "party", name: "B" }]];
    for (const news of every) expect(isUrgent(news)).toBe(/^friends\.news\.(party|together)$/.test(describeNews(news, t) ?? ""));
  });
});
