import { describe, expect, it } from "vitest";
import type { Friend, FriendsState } from "../../shared";
import { withoutOnline } from "./stale";

const friend = (id: string, changes: Partial<Friend> = {}): Friend => ({ id, name: id, avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: true, inbox: true, ...changes });
const state = (...friends: Friend[]): FriendsState => ({ friends, inbox: [], activity: [], invites: [] });

describe("what is kept of the friends when the server has not answered for a while", () => {
  it("is the same, but with nobody online", () => {
    const kept = state(friend("sam", { online: true }), friend("robin"), friend("kim", { online: true, activity: false }));
    const stale = withoutOnline(kept);
    expect(stale.friends.map((each) => each.online)).toEqual([undefined, undefined, undefined]);
    expect(stale.friends.map((each) => each.id)).toEqual(["sam", "robin", "kim"]);
    expect(stale.friends[2]).toMatchObject({ activity: false });
    expect(kept.friends[0]).toMatchObject({ online: true }); // (what was kept is not changed)
  });

  it("is the very same answer when nobody was online", () => {
    const kept = state(friend("sam"), friend("robin"));
    expect(withoutOnline(kept)).toBe(kept);
  });
});
