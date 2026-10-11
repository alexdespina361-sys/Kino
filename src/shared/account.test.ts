import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST,
  emptyData,
  fillProgress,
  LIST_NAME_MAX,
  listKey,
  listOf,
  ListNameSchema,
  LoginSchema,
  mergeCollection,
  mergeData,
  nameFromEmail,
  newerOf,
  newListId,
  nextAvatar,
  progressKey,
  RegisterSchema,
  resolveLists,
  resolveSettings,
  savedKeys,
  SyncRequestSchema,
  titleLink,
  watchedKey,
  type ListNameItem,
  type LiveProgress,
  type ProgressItem,
  type SettingItem,
  type SyncItem,
} from "./account";

const DAY = 24 * 3600 * 1000;
const item = (key: string, at: number, extra: Record<string, unknown> = {}) => ({ key, at, ...extra });
const progress = (key: string, at: number, extra: Partial<LiveProgress> = {}): ProgressItem => ({ key, at, title: key, url: `/${key}`, position: 10, duration: 100, ...extra });

describe("newerOf", () => {
  it("takes the later one", () => {
    expect(newerOf(item("a", 1), item("a", 2)).at).toBe(2);
    expect(newerOf(item("a", 2), item("a", 1)).at).toBe(2);
  });

  it("gives the same answer whichever way round the two meet, even at the same moment", () => {
    const live = item("a", 5, { v: "live" });
    const gone = { key: "a", at: 5, deleted: true as const };
    expect(newerOf(live, gone)).toBe(gone);
    expect(newerOf(gone, live)).toBe(gone);
    const x = item("a", 5, { v: "x" });
    const y = item("a", 5, { v: "y" });
    expect(newerOf(x, y)).toBe(newerOf(y, x));
  });
});

describe("mergeCollection", () => {
  const now = 100 * DAY;
  /** A moment shortly before `now`: n seconds before it. */
  const t = (secondsAgo: number) => now - secondsAgo * 1000;

  it("keeps the newer copy of each item and everything only one side has, newest first", () => {
    const merged = mergeCollection([item("a", t(30)), item("b", t(50))], [item("a", t(10)), item("c", t(20))], { limit: 10, now });
    expect(merged.map((m) => [m.key, m.at])).toEqual([["a", t(10)], ["c", t(20)], ["b", t(50)]]);
  });

  it("does not depend on which copy is which, and merging again changes nothing", () => {
    const a: SyncItem[] = [item("a", t(30)), item("b", t(5)), { key: "c", at: t(20), deleted: true }];
    const b: SyncItem[] = [item("a", t(15)), item("c", t(40)), item("d", t(50))];
    const ab = mergeCollection(a, b, { limit: 10, now });
    expect(mergeCollection(b, a, { limit: 10, now })).toEqual(ab);
    expect(mergeCollection(ab, a, { limit: 10, now })).toEqual(ab);
    expect(mergeCollection(ab, b, { limit: 10, now })).toEqual(ab);
    expect(ab.find((m) => m.key === "c")?.deleted).toBe(true);
  });

  it("lets a later removal beat an earlier copy, so a removed item does not come back from a phone that never heard of it", () => {
    const gone: SyncItem = { key: "a", at: t(8), deleted: true };
    const merged = mergeCollection<SyncItem>([item("a", t(50))], [gone], { limit: 10, now });
    expect(merged).toEqual([gone]);
    // ...and watching it again afterwards brings it back
    expect(mergeCollection<SyncItem>(merged, [item("a", t(1))], { limit: 10, now }).map((m) => m.deleted)).toEqual([undefined]);
  });

  it("keeps only the newest items up to the limit, and forgets old removals", () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`k${i}`, now - i * 1000));
    expect(mergeCollection(many, [], { limit: 3, now }).map((m) => m.key)).toEqual(["k0", "k1", "k2"]);
    const old: SyncItem = { key: "old", at: now - 60 * DAY, deleted: true };
    const recent: SyncItem = { key: "recent", at: now - 1 * DAY, deleted: true };
    expect(mergeCollection([old, recent], [], { limit: 3, now }).map((m) => m.key)).toEqual(["recent"]);
  });

  it("lets the winner borrow what only the loser has", () => {
    const withImage = progress("film", t(50), { image: "/poster.jpg", year: 1999 });
    const newer = progress("film", t(10), { position: 50 });
    const merged = mergeCollection<ProgressItem>([withImage], [newer], { limit: 10, now, fill: (w, l) => fillProgress(w as LiveProgress, l as LiveProgress) });
    expect(merged[0]).toMatchObject({ position: 50, image: "/poster.jpg", year: 1999 });
  });
});

describe("mergeData", () => {
  it("combines every list of a profile", () => {
    const a = { ...emptyData(), progress: [progress("x", 1)], list: [{ key: "u", at: 1, id: "1", title: "T", url: "/t" }] };
    const b = { ...emptyData(), progress: [progress("y", 2)] };
    const merged = mergeData(a, b, 5);
    expect(merged.progress.map((p) => p.key)).toEqual(["y", "x"]);
    expect(merged.list).toHaveLength(1);
  });
});

describe("keys", () => {
  it("makes one card for a whole show and one for each other link", () => {
    expect(progressKey({ show: "Dark", url: "https://s/watch/1?s=1&e=2" })).toBe("show:Dark");
    expect(progressKey({ url: "https://s/watch/9#top" })).toBe("url:https://s/watch/9");
    expect(watchedKey({ show: "Dark", season: 2, episode: 3 })).toBe("Dark|2x3");
    expect(listKey("https://s/watch/9#x")).toBe("url:https://s/watch/9");
  });

  it("makes a show one title in a list whichever of its episodes it was found by, and leaves every other link as it is", () => {
    expect(titleLink("https://s/watch/1399?s=3&e=5")).toBe("https://s/watch/1399?s=1&e=1");
    expect(titleLink("https://s/watch/1399?s=1&e=1#x")).toBe("https://s/watch/1399?s=1&e=1");
    expect(titleLink("https://s/watch/1399?x=1&s=12&e=104&y=2")).toBe("https://s/watch/1399?x=1&s=1&e=1&y=2");
    expect(listKey("https://s/watch/1399?s=3&e=5")).toBe(listKey("https://s/watch/1399?s=1&e=1"));
    expect(listKey("https://s/watch/1399?s=3&e=5", "l1abc")).toBe("l1abc|url:https://s/watch/1399?s=1&e=1");
    for (const other of ["https://s/watch/603", "https://s/watch/1399?s=3", "https://s/watch/1399?e=5&s=3", "https://s/watch/1399?ss=3&e=5", "https://archive.org/details/film"]) expect(titleLink(other)).toBe(other);
  });

  it("works out from the links which titles are saved, so a show saved under an episode's link still counts", () => {
    const saved = savedKeys([{ url: "https://s/watch/1399?s=3&e=5" }, { url: "https://s/watch/603", list: "l1abc" }]);
    expect(saved.has(listKey("https://s/watch/1399?s=1&e=1"))).toBe(true);
    expect(saved.has(listKey("https://s/watch/1399?s=1&e=1", "l1abc"))).toBe(false);
    expect(saved.has(listKey("https://s/watch/603", "l1abc"))).toBe(true);
    expect(saved.has(listKey("https://s/watch/603"))).toBe(false);
  });
});

describe("lists", () => {
  it("keeps what was saved before there were lists in the first list, and tells one title in two lists apart", () => {
    expect(listKey("https://s/watch/9", DEFAULT_LIST)).toBe("url:https://s/watch/9");
    expect(listKey("https://s/watch/9#x", "l1abc")).toBe("l1abc|url:https://s/watch/9");
    expect(listOf({})).toBe(DEFAULT_LIST);
    expect(listOf({ list: "l1abc" })).toBe("l1abc");
  });

  it("always has the first list, then the others in the order they were made, and leaves out the removed", () => {
    const names: ListNameItem[] = [
      { key: "lb", at: 5, name: "Kids" },
      { key: "la", at: 9, name: "Weekend" },
      { key: "lc", at: 9, deleted: true },
    ];
    expect(resolveLists([])).toEqual([{ id: DEFAULT_LIST }]);
    expect(resolveLists(names)).toEqual([{ id: DEFAULT_LIST }, { id: "la", name: "Weekend" }, { id: "lb", name: "Kids" }]);
    expect(resolveLists([...names, { key: DEFAULT_LIST, at: 1, name: "Watchlist" }])[0]).toEqual({ id: DEFAULT_LIST, name: "Watchlist" });
    expect(resolveLists([{ key: DEFAULT_LIST, at: 1, deleted: true }])).toEqual([{ id: DEFAULT_LIST }]);
  });

  it("puts the lists someone placed in the order they placed them, and the ones never placed after, in the order they were made", () => {
    const names: ListNameItem[] = [
      { key: "la", at: 1, name: "First made" },
      { key: "lb", at: 1, name: "Second made", order: 1 },
      { key: "lc", at: 1, name: "Third made", order: 0 },
      { key: "ld", at: 1, name: "Fourth made" },
    ];
    expect(resolveLists(names).map((list) => list.id)).toEqual([DEFAULT_LIST, "lc", "lb", "la", "ld"]);
    expect(resolveLists([{ key: "lb", at: 1, name: "B", order: 3 }, { key: "la", at: 1, name: "A", order: 3 }]).map((list) => list.id)).toEqual([DEFAULT_LIST, "la", "lb"]);
  });

  it("gives a new list an id that sorts after the lists made before it", () => {
    expect(newListId(1_800_000_000_000) < newListId(1_800_000_001_000)).toBe(true);
  });

  it("takes a short name, trimmed, and refuses an empty one or a long one", () => {
    expect(ListNameSchema.parse("  Date night ")).toBe("Date night");
    expect(ListNameSchema.safeParse("   ").success).toBe(false);
    expect(ListNameSchema.safeParse("x".repeat(LIST_NAME_MAX + 1)).success).toBe(false);
  });

  it("combines two copies of the names like everything else: the newer name wins, and a removal stays removed", () => {
    const a = { ...emptyData(), listNames: [{ key: "la", at: 1, name: "Old" }, { key: "lb", at: 1, name: "Kids" }] };
    const b = { ...emptyData(), listNames: [{ key: "la", at: 2, name: "New" }, { key: "lb", at: 2, deleted: true as const }] };
    const merged = mergeData(a, b, 5).listNames;
    expect(merged).toEqual([{ key: "la", at: 2, name: "New" }, { key: "lb", at: 2, deleted: true }]);
  });
});

describe("resolveSettings", () => {
  it("reads the settings that are set and ignores removed ones and values that are not a real choice", () => {
    const items: SettingItem[] = [
      { key: "lang", at: 1, value: "ro" },
      { key: "accent", at: 1, value: "chartreuse" },
      { key: "autoplayNext", at: 1, value: false },
      { key: "subtitleLanguages", at: 1, deleted: true },
      { key: "onlySubtitleLanguages", at: 1, value: true },
    ];
    expect(resolveSettings(items)).toEqual({ lang: "ro", autoplayNext: false, onlySubtitleLanguages: true });
  });
});

describe("what people type", () => {
  it("tidies the name an account signs in with, which can be an address or anything else", () => {
    expect(RegisterSchema.parse({ email: "  Alex@Example.COM ", password: "longenough" }).email).toBe("alex@example.com");
    expect(RegisterSchema.parse({ email: " Robert ", password: "1" }).email).toBe("robert");
    expect(RegisterSchema.parse({ email: "Ana Maria 7!", password: "1" }).email).toBe("ana maria 7!");
    expect(RegisterSchema.parse({ email: "Ștefan", password: "1" }).email).toBe("ștefan");
    expect(LoginSchema.parse({ email: "ROBERT", password: "1" }).email).toBe("robert"); // signing in finds the same account whatever the capitals
  });

  it("asks for a name and a password, and for nothing about how long or how clever", () => {
    expect(RegisterSchema.safeParse({ email: "", password: "1" }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: "   ", password: "1" }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: "a\nb", password: "1" }).success).toBe(false); // no line breaks or other invisible characters
    expect(RegisterSchema.safeParse({ email: "x".repeat(255), password: "1" }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: "robert", password: "" }).success).toBe(false);
    for (const password of ["1", "a", "  ", "password", "🙂", "x".repeat(200)]) expect(RegisterSchema.safeParse({ email: "robert", password }).success).toBe(true);
    expect(RegisterSchema.safeParse({ email: "robert", password: "x".repeat(201) }).success).toBe(false);
  });

  it("names a first profile from the account's name, and picks the first picture not in use", () => {
    expect(nameFromEmail("alex.popescu@x.com")).toBe("Alex");
    expect(nameFromEmail("ioana_m@x.com")).toBe("Ioana");
    expect(nameFromEmail("@x.com")).toBe("Me");
    expect(nameFromEmail("robert")).toBe("Robert");
    expect(nameFromEmail("my tv 2")).toBe("My tv 2");
    expect(nameFromEmail("###")).toBe("Me");
    expect(nameFromEmail("a very long name for a profile")).toBe("A very long name");
    expect(nextAvatar([])).toBe("fox");
    expect(nextAvatar(["fox", "cat"])).toBe("panda");
  });

  it("accepts a sync with nothing to send", () => {
    expect(SyncRequestSchema.parse({ since: 0 })).toEqual({ since: 0, progress: [], watched: [], list: [], listNames: [], settings: [] });
  });
});
