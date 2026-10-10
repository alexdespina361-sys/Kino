import { describe, expect, it } from "vitest";
import {
  emptyData,
  fillProgress,
  listKey,
  mergeCollection,
  mergeData,
  nameFromEmail,
  newerOf,
  nextAvatar,
  progressKey,
  RegisterSchema,
  resolveSettings,
  SyncRequestSchema,
  watchedKey,
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
  it("tidies an e-mail address and asks for a real password", () => {
    expect(RegisterSchema.parse({ email: "  Alex@Example.COM ", password: "longenough" }).email).toBe("alex@example.com");
    expect(RegisterSchema.safeParse({ email: "nope", password: "longenough" }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(false);
  });

  it("names a first profile from the address, and picks the first picture not in use", () => {
    expect(nameFromEmail("alex.popescu@x.com")).toBe("Alex");
    expect(nameFromEmail("ioana_m@x.com")).toBe("Ioana");
    expect(nameFromEmail("@x.com")).toBe("Me");
    expect(nextAvatar([])).toBe("fox");
    expect(nextAvatar(["fox", "cat"])).toBe("panda");
  });

  it("accepts a sync with nothing to send", () => {
    expect(SyncRequestSchema.parse({ since: 0 })).toEqual({ since: 0, progress: [], watched: [], list: [], settings: [] });
  });
});
