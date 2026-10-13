import { describe, expect, it } from "vitest";
import {
  ActivityItemSchema,
  FRIEND_DEFAULTS,
  FRIEND_SETTINGS,
  FriendListsSchema,
  FriendRatingsSchema,
  FriendSchema,
  FriendsStateSchema,
  InboxItemSchema,
  KeptFriendsSchema,
  SendSchema,
  WATCHING_NOW_MS,
  activityVerb,
  canAskTogether,
  foreignPicture,
  friendChoices,
  isWellFormedText,
  wellFormedText,
  friendLink,
  partyOpen,
  plainText,
  reachable,
  sharesLists,
  sharesRatings,
  type Friend,
} from "./friends";
import { SETTING_SCHEMAS } from "./account";

const friend = (changes: Partial<Friend> = {}): Friend => ({ id: "pro_1", name: "Sam", avatar: "fox", since: 1, on: true, lists: true, ratings: true, activity: false, inbox: true, ...changes });

describe("the switches", () => {
  it("are all settings of a profile, and are all off or on as the defaults say until they are set", () => {
    for (const key of FRIEND_SETTINGS) expect(SETTING_SCHEMAS[key]).toBeDefined();
    expect(friendChoices({})).toEqual({ friends: false, friendsLists: true, friendsRatings: true, friendsGive: false, friendsGet: false, friendsInbox: true, friendsPresence: true });
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
      friendsPresence: true,
    });
    expect(friendChoices({ friendsPresence: false })).toMatchObject({ friendsPresence: false, friends: false }); // (being seen as online is its own switch, on until it is turned off)
  });

  it("only take true or false", () => {
    for (const key of FRIEND_SETTINGS) {
      expect(SETTING_SCHEMAS[key].safeParse(true).success).toBe(true);
      expect(SETTING_SCHEMAS[key].safeParse(false).success).toBe(true);
      expect(SETTING_SCHEMAS[key].safeParse("yes").success).toBe(false);
      expect(SETTING_SCHEMAS[key].safeParse(1).success).toBe(false);
    }
  });

  it("let lists be looked at only when friends are on and they are shared", () => {
    expect(sharesLists({})).toBe(false);
    expect(sharesLists({ friends: true })).toBe(true);
    expect(sharesLists({ friends: true, friendsLists: false })).toBe(false);
    expect(sharesLists({ friends: false, friendsLists: true })).toBe(false);
  });

  it("let ratings be looked at only when friends are on, they are shared, and ratings are not turned off for the profile itself", () => {
    expect(sharesRatings({})).toBe(false); // (friends are off until they are turned on)
    expect(sharesRatings({ friends: true })).toBe(true);
    expect(sharesRatings({ friends: true, ratings: true })).toBe(true);
    expect(sharesRatings({ friends: true, friendsRatings: false })).toBe(false);
    expect(sharesRatings({ friends: true, ratings: false })).toBe(false); // what was rated stays kept, but it is not shown to anybody
    expect(sharesRatings({ friends: false, friendsRatings: true })).toBe(false);
  });
});

describe("what other people typed", () => {
  it("is made fit to show: nothing that turns text around or hides in it, few marks on a letter, one space for several", () => {
    expect(plainText("  Sam  ‮evil‬  ")).toBe("Sam evil");
    expect(plainText("a​b⁦c⁩d﻿e؜f")).toBe("abcdef"); // (the invisible ones are simply gone)
    expect(plainText("two\nlines\tand\r\n  gaps")).toBe("two lines and gaps");
    expect(plainText("nul\u0000l")).toBe("null");
    expect(plainText("z" + "̀".repeat(40) + "y")).toBe("z" + "̀".repeat(4) + "y");
    expect(plainText("‮​ ⁦")).toBe("");
  });

  it("leaves what is meant alone: accents, other alphabets, emoji (joined ones too)", () => {
    for (const text of ["Ștefan Țepeș", "Zoë", "Ελένη", "山田 太郎", "Café ☕", "👨‍👩‍👧 family", "👍🏽", "é", "क़ख़ग़"]) expect(plainText(text)).toBe(text);
  });

  it("is nothing when nothing that can be seen is left: joiners, hidden fillers and marks on their own", () => {
    for (const text of ["‌".repeat(30), "‍‌", "­", "ㅤ", "ﾠ", "⠀⠀", "ᅟᅠ", "́".repeat(5), " ‌ "]) {
      expect(plainText(text), JSON.stringify(text)).toBe("");
    }
    expect(plainText("می‌خواهم")).toBe("می‌خواهم"); // (a joiner between letters is how Persian is written)
    expect(plainText("Du­ne")).toBe("Dune"); // (a soft hyphen is gone)
  });

  it("has no half of a pair in it, which would make a page throw when it puts the text in an address", () => {
    for (const bad of ["\ud800", "a\ud800", "\ud800b", "\udc00", "x\udc00y", "\udc00\ud800", "\ud83d"]) {
      expect(isWellFormedText(bad), JSON.stringify(bad)).toBe(false);
      expect(isWellFormedText(wellFormedText(bad)), JSON.stringify(bad)).toBe(true);
      expect(() => encodeURIComponent(wellFormedText(bad))).not.toThrow();
      expect(wellFormedText(bad)).toHaveLength(bad.length); // (one for one: never longer)
    }
    for (const good of ["", "plain", "😀", "a😀b", "😀", "👨‍👩‍👧", "é"]) {
      expect(isWellFormedText(good), good).toBe(true);
      expect(wellFormedText(good)).toBe(good);
    }
    expect(wellFormedText("a\ud800b😀")).toBe("a�b😀");
    expect(plainText("Du\ud800ne")).toBe("Du�ne");
    expect(SendSchema.safeParse({ to: ["pro_2"], kind: "recommend", title: "Dune", url: "https://example.com/\ud800" }).success).toBe(false);
  });

  it("never makes a word longer, so what fitted a limit still does", () => {
    for (const text of ["̈́".repeat(16), "क़".repeat(16), "ΩKÅ".repeat(5), "x́".repeat(8)]) expect(plainText(text).length).toBeLessThanOrEqual(text.length);
  });
});

describe("a picture from a friend", () => {
  it("is shown only if it is the web address of another site", () => {
    expect(foreignPicture("https://image.tmdb.org/t/p/w342/a.jpg", "kino.example")).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
    expect(foreignPicture("http://archive.org/services/img/x", "kino.example:8080")).toBe("http://archive.org/services/img/x");
    expect(foreignPicture(undefined, "kino.example")).toBeUndefined();
    for (const bad of ["", "/api/profiles/pro_1/friends", "//evil.example/a.gif", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "blob:https://x/1", "ftp://x.example/a.jpg", "not a url"]) {
      expect(foreignPicture(bad, "kino.example"), bad).toBeUndefined();
    }
  });

  it("is not shown if only a private network (or this machine) answers to the address: the browser would knock on its own doors for a friend", () => {
    for (const bad of [
      "http://localhost/a.png", "http://localhost:8791/a.png", "http://127.0.0.1:3000/a.png", "http://127.1/a.png", "http://2130706433/a.png", "http://0x7f.0.0.1/a.png",
      "http://10.0.0.5/a.png", "http://172.16.0.1/a.png", "http://172.31.255.255/a.png", "http://192.168.1.1/a.png", "http://169.254.169.254/a.png", "http://100.64.0.1/a.png",
      "http://0.0.0.0/a.png", "http://[::1]/a.png", "http://[::ffff:192.168.0.1]/a.png", "http://router/a.png", "http://nas.local/a.png", "http://printer.lan./a.png",
      "http://x.home.arpa/a.png", "http://svc.internal/a.png",
    ]) {
      expect(foreignPicture(bad, "kino.example"), bad).toBeUndefined();
    }
    for (const good of ["https://image.tmdb.org/t/p/w342/a.jpg", "http://172.15.0.1/a.png", "http://172.32.0.1/a.png", "http://8.8.8.8/a.png", "https://192.169.1.1/a.png"]) {
      expect(foreignPicture(good, "kino.example"), good).toBe(good);
    }
  });

  it("is not shown if it is an address on this site, whatever the port or the capitals: that would make the browser call the site for a friend", () => {
    for (const own of ["https://kino.example/api/link/ABCD", "https://KINO.example/x.png", "https://kino.example:443/x.png", "http://kino.example:8080/x.png"]) {
      expect(foreignPicture(own, "kino.example"), own).toBeUndefined();
      expect(foreignPicture(own, "Kino.Example:8080"), own).toBeUndefined();
    }
    expect(foreignPicture("https://kino.example.evil.example/x.png", "kino.example")).toBe("https://kino.example.evil.example/x.png");
    expect(foreignPicture("http://localhost:8791/api/health", "localhost:8791")).toBeUndefined();
    // (Not knowing where the look came to is no reason to show less.)
    expect(foreignPicture("https://kino.example/x.png", undefined)).toBe("https://kino.example/x.png");
  });
});

describe("what is sent", () => {
  const dune = { to: ["pro_2"], kind: "recommend", title: "  Dune ", url: "https://filmpire.sc/watch/438631", year: 2021, note: " loud " };

  it("takes a title with a web address, tidied, and a watch party with its six digits", () => {
    expect(SendSchema.parse(dune)).toMatchObject({ title: "Dune", note: "loud", url: "https://filmpire.sc/watch/438631" });
    expect(SendSchema.parse({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5 })).toEqual({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5 });
  });

  it("cleans the words of a title and a note before they are measured: nothing that turns them around, and no more than a few marks on a letter", () => {
    const sent = SendSchema.parse({ ...dune, title: "‮enuD‬\n", note: `${"x".repeat(150)}${"́".repeat(100)}${"​".repeat(500)}` });
    expect(sent).toMatchObject({ title: "enuD", note: `${"x".repeat(150)}${"́".repeat(4)}` });
  });

  it("does not take a link that is not on the web, a title with no name, a party with no code, nobody to send to or anything else", () => {
    for (const bad of [
      { ...dune, url: "javascript:alert(1)" },
      { ...dune, url: "data:text/html,<script>1</script>" },
      { ...dune, url: "/watch/1" },
      { ...dune, image: "/api/profiles/pro_1/friends/invites/AAAAAAAA" }, // (a picture is loaded by the browser of whoever it is sent to: never a path on this site)
      { ...dune, backdrop: "//evil.example/a.gif" },
      { ...dune, image: "javascript:alert(1)" },
      { ...dune, title: "   " },
      { ...dune, title: "‮​⁦" }, // (nothing is left of it)
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

  it("takes a request to watch together, which is nothing but who it is for, and holds it in an inbox", () => {
    expect(SendSchema.parse({ to: ["pro_2"], kind: "together" })).toEqual({ to: ["pro_2"], kind: "together" });
    expect(SendSchema.parse({ to: ["pro_2"], kind: "together", code: "482731", host: "tv_x" })).toEqual({ to: ["pro_2"], kind: "together" }); // (nothing else gets through)
    expect(InboxItemSchema.safeParse({ kind: "together", id: "m_abc", at: 5, from: "pro_1", read: false }).success).toBe(true);
  });

  it("takes an invitation to a party as the server answers it: whether the party is open, but never which screen hosts it, and never as a thing to send", () => {
    const invitation = { kind: "party", code: "482731", endsAt: 5, id: "m_abc", at: 5, from: "pro_1", read: false };
    expect(InboxItemSchema.parse({ ...invitation, open: false })).toMatchObject({ open: false });
    expect(InboxItemSchema.parse(invitation)).not.toHaveProperty("open");
    expect(InboxItemSchema.parse({ ...invitation, host: "tv_x" })).not.toHaveProperty("host");
    expect(SendSchema.parse({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5, open: true, host: "tv_x" })).toEqual({ to: ["pro_2"], kind: "party", code: "482731", endsAt: 5 });
  });

  it("says a party can be joined by the server's word, else by the clock", () => {
    expect(partyOpen({ endsAt: 10 }, 9)).toBe(true);
    expect(partyOpen({ endsAt: 10 }, 10)).toBe(false);
    expect(partyOpen({ endsAt: 10, open: true }, 99)).toBe(true);
    expect(partyOpen({ endsAt: 10, open: false }, 9)).toBe(false);
  });

  it("offers asking to watch together to a friend who takes things and tells what they watch, and no other", () => {
    expect(canAskTogether(friend({ activity: true }))).toBe(true);
    expect(canAskTogether(friend())).toBe(false); // (they do not tell what they watch)
    expect(canAskTogether(friend({ activity: true, inbox: false }))).toBe(false);
    expect(canAskTogether(friend({ activity: true, on: false }))).toBe(false);
  });
});

describe("how far a friend got", () => {
  const watched = { friend: "pro_1", key: "url:x", title: "Dune", url: "https://filmpire.sc/watch/1", at: 5 };
  const progress = [{ link: "https://shows.example/watch/7?s=1&e=1", season: 2, episode: 5, percent: 63 }, { link: "https://filmpire.sc/watch/1", percent: 100, done: true }];

  it("is a whole number of percent on something a friend watched, and nothing when the length is not known", () => {
    expect(ActivityItemSchema.safeParse({ ...watched, percent: 63 }).success).toBe(true);
    expect(ActivityItemSchema.safeParse(watched).success).toBe(true);
    for (const bad of [-1, 101, 62.5, "63"]) expect(ActivityItemSchema.safeParse({ ...watched, percent: bad }).success, String(bad)).toBe(false);
  });

  it("comes with the lists and the ratings of a friend who tells what they watch, and may be left out", () => {
    expect(FriendListsSchema.safeParse({ listNames: [], list: [], progress }).success).toBe(true);
    expect(FriendListsSchema.safeParse({ listNames: [], list: [] }).success).toBe(true);
    expect(FriendRatingsSchema.safeParse({ ratings: [], progress }).success).toBe(true);
    expect(FriendRatingsSchema.safeParse({ ratings: [] }).success).toBe(true);
    expect(FriendRatingsSchema.safeParse({ ratings: [], progress: [{ link: "x", percent: 101 }] }).success).toBe(false);
  });

  it("is shown as online only when the answer says so", () => {
    expect(FriendSchema.parse(friend()).online).toBeUndefined();
    expect(FriendSchema.parse(friend({ online: true })).online).toBe(true);
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

  it("keep for a profile with friends turned off only who the friends are, whatever else is sent along", () => {
    const answer = KeptFriendsSchema.parse({ friends: [friend({ lists: false, activity: true })] });
    expect(answer).toEqual({ friends: [{ id: "pro_1", name: "Sam", avatar: "fox", since: 1 }] });
    expect(KeptFriendsSchema.safeParse({ friends: [{ id: "pro_1", name: "Sam" }] }).success).toBe(false);
  });

  it("make the address a code is given in", () => {
    expect(friendLink("ABCD2345", "https://kino.example")).toBe("https://kino.example/?friend=ABCD2345");
  });
});
