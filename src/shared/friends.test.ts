import { describe, expect, it } from "vitest";
import { FRIEND_DEFAULTS, FRIEND_SETTINGS, FriendsStateSchema, InboxItemSchema, SendSchema, WATCHING_NOW_MS, activityVerb, friendChoices, friendLink, reachable, type Friend } from "./friends";
import { SETTING_SCHEMAS } from "./account";

const friend = (changes: Partial<Friend> = {}): Friend => ({ id: "pro_1", name: "Sam", avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: false, inbox: true, ...changes });

describe("the switches", () => {
  it("are all settings of a profile, and are all off or on as the defaults say until they are set", () => {
    for (const key of FRIEND_SETTINGS) expect(SETTING_SCHEMAS[key]).toBeDefined();
    expect(friendChoices({})).toEqual({ friends: false, friendsLists: true, friendsRatings: true, friendsGive: false, friendsGet: false, friendsInbox: true });
    expect(FRIEND_DEFAULTS.friends).toBe(false);
  });

  it("are what was chosen, one at a time", () => {
    expect(friendChoices({ friends: true, friendsLists: false, friendsGive: true })).toEqual({
      friends: true,
      friendsLists: false,
      friendsRatings: true,
      friendsGive: true,
      friendsGet: false,
      friendsInbox: true,
    });
  });

  it("only take true or false", () => {
    for (const key of FRIEND_SETTINGS) {
      expect(SETTING_SCHEMAS[key].safeParse(true).success).toBe(true);
      expect(SETTING_SCHEMAS[key].safeParse(false).success).toBe(true);
      expect(SETTING_SCHEMAS[key].safeParse("yes").success).toBe(false);
      expect(SETTING_SCHEMAS[key].safeParse(1).success).toBe(false);
    }
  });
});

describe("what is sent", () => {
  const dune = { to: ["pro_2"], kind: "recommend", title: "  Dune ", url: "https://filmpire.sc/watch/438631", year: 2021, note: " loud " };

  it("takes a title with a web address, tidied, and a watch party with its six digits", () => {
    expect(SendSchema.parse(dune)).toMatchObject({ title: "Dune", note: "loud", url: "https://filmpire.sc/watch/438631" });
    expect(SendSchema.parse({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5 })).toEqual({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5 });
  });

  it("does not take a link that is not on the web, a title with no name, a party with no code, nobody to send to or anything else", () => {
    for (const bad of [
      { ...dune, url: "javascript:alert(1)" },
      { ...dune, url: "data:text/html,<script>1</script>" },
      { ...dune, url: "/watch/1" },
      { ...dune, title: "   " },
      { ...dune, note: "x".repeat(201) },
      { ...dune, to: [] },
      { ...dune, to: Array.from({ length: 51 }, (_, i) => `p${i}`) },
      { to: ["pro_2"], kind: "party", code: "48273", endsAt: 5 },
      { to: ["pro_2"], kind: "party", code: "abcdef", endsAt: 5 },
      { to: ["pro_2"], kind: "ad", url: "https://x.example" },
    ]) {
      expect(SendSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("is what an inbox holds, with who sent it, when, and whether it was seen", () => {
    const item = { kind: "recommend", title: "Dune", url: "https://filmpire.sc/watch/1", id: "m_abc", at: 5, from: "pro_1", read: false };
    expect(InboxItemSchema.safeParse(item).success).toBe(true);
    expect(InboxItemSchema.safeParse({ ...item, read: undefined }).success).toBe(false);
    expect(FriendsStateSchema.safeParse({ friends: [friend()], inbox: [item], activity: [], invites: [{ code: "ABCD2345", expiresAt: 9 }] }).success).toBe(true);
  });
});

describe("words about friends", () => {
  it("say a friend is watching when it was minutes ago, has watched when it was longer, and has finished when it ended", () => {
    const now = 10_000_000;
    expect(activityVerb({ at: now - 60_000 }, now)).toBe("watching");
    expect(activityVerb({ at: now - WATCHING_NOW_MS - 1 }, now)).toBe("watched");
    expect(activityVerb({ at: now - 60_000, done: true }, now)).toBe("finished");
    expect(activityVerb({ at: now - 86_400_000, done: false }, now)).toBe("watched");
  });

  it("find the friends something can be sent to: the ones who have friends on and take things", () => {
    const sam = friend();
    const robin = friend({ id: "pro_2", inbox: false });
    const gone = friend({ id: "pro_3", on: false, inbox: false });
    expect(reachable([sam, robin, gone])).toEqual([sam]);
    expect(reachable([])).toEqual([]);
  });

  it("make the address a code is given in", () => {
    expect(friendLink("ABCD2345", "https://kino.example")).toBe("https://kino.example/?friend=ABCD2345");
  });
});
