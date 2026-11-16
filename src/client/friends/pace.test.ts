import { describe, expect, it } from "vitest";
import type { Friend, FriendsState } from "../../shared";
import type { News } from "./news";
import { chatMark, FRIEND_ON_MS, friendOnline, LIVELY_MS, lookPace, QUIET_MS, stirring } from "./pace";

const friend = (id: string, changes: Partial<Friend> = {}): Friend => ({ id, name: id, avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: true, inbox: true, ...changes });
const state = (friends: Friend[], chat?: FriendsState["chat"]): FriendsState => ({ friends, inbox: [], activity: [], invites: [], requests: [], sent: [], ...(chat ? { chat } : {}) });

describe("how often a screen looks at its friends", () => {
  it("is every half minute when nothing goes on, every 15 s while a friend is on the site, every 8 s for a while after something happened", () => {
    expect(lookPace(1000, 0, false)).toBe(QUIET_MS);
    expect(lookPace(1000, 0, true)).toBe(FRIEND_ON_MS);
    expect(lookPace(1000, 5000, false)).toBe(LIVELY_MS);
    expect(lookPace(1000, 5000, true)).toBe(LIVELY_MS);
    expect(lookPace(5000, 5000, false)).toBe(QUIET_MS); // (over once its time has come)
    expect(QUIET_MS).toBe(30_000);
  });

  it("is told that a friend is on the site only by a friend shown online", () => {
    expect(friendOnline(state([friend("sam"), friend("robin")]))).toBe(false);
    expect(friendOnline(state([friend("sam"), friend("robin", { online: true })]))).toBe(true);
  });
});

describe("what makes a screen look often for a while", () => {
  const none = chatMark(state([]));
  const news = (kind: News["kind"]): News => (kind === "activity" ? { kind, name: "Sam", title: "Up", verb: "watching" } : ({ kind, name: "Sam", title: "Up", when: 1 } as News));

  it("is something a friend did for this profile, not what they watch", () => {
    for (const kind of ["party", "together", "request", "plan", "planYes", "planNo", "recommend", "friend"] as const) expect(stirring([news(kind)], none, none)).toBe(true);
    expect(stirring([news("activity")], none, none)).toBe(false);
    expect(stirring([], none, none)).toBe(false);
  });

  it("is a new message in a chat: a newer one, or one more", () => {
    const one = chatMark(state([friend("sam")], [{ friend: "sam", count: 1, at: 100 }]));
    expect(one).toEqual({ newest: 100, count: 1 });
    expect(stirring([], none, one)).toBe(true);
    expect(stirring([], one, one)).toBe(false);
    expect(stirring([], one, chatMark(state([friend("sam")], [{ friend: "sam", count: 2, at: 100 }])))).toBe(true);
    expect(stirring([], one, chatMark(state([friend("sam")], [{ friend: "sam", count: 1, at: 200 }])))).toBe(true);
    expect(stirring([], one, none)).toBe(false); // (read on another screen: nothing new)
  });
});
