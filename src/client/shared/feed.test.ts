import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem, LibraryRow } from "../../shared";
import {
  allRows,
  createFeed,
  freshShelves,
  GRID_CAP,
  hasMoreShelves,
  hasMoreTitles,
  loadingShelves,
  loadingTitles,
  MIN_SHELF,
  pageRows,
  ROW_CAP,
  SHELF_CAP,
  withMore,
  type Feed,
} from "./feed";

const item = (id: string): LibraryItem => ({ id, title: `Title ${id}`, url: `/fixtures/${id}.mp4` });
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, at) => `${prefix}${at}`);
const row = (id: string, titles: readonly string[]): LibraryRow => ({ id, title: id, source: "Test", items: titles.map(item) });
const idsOf = (r: LibraryRow) => r.items.map((i) => i.id);

/** A server for a test: it answers what was asked from `answer`, an Error being a failed question. */
function server(answer: (url: string) => unknown) {
  const asked: string[] = [];
  const fake = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const body = answer(url);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  return { fetch: fake as unknown as typeof fetch, asked };
}

/** Let the answers on their way arrive. */
const settle = async () => {
  for (let at = 0; at < 40; at++) await Promise.resolve();
};

describe("withMore", () => {
  it("is the row itself when nothing is added, and the same row again for the same additions", () => {
    const base = row("a", ids(5, "a"));
    expect(withMore(base, undefined, 100)).toBe(base);
    expect(withMore(base, [], 100)).toBe(base);
    const more = ["b0", "b1"].map(item);
    const once = withMore(base, more, 100);
    expect(idsOf(once)).toEqual([...ids(5, "a"), "b0", "b1"]);
    expect(withMore(base, more, 100)).toBe(once);
  });

  it("shows a title once and stops at the cap", () => {
    const base = row("a", ids(5, "a"));
    expect(idsOf(withMore(base, [item("a1"), item("b0"), item("b0"), item("b1")], 100))).toEqual([...ids(5, "a"), "b0", "b1"]);
    expect(withMore(base, ids(50, "b").map(item), 8).items).toHaveLength(8);
    expect(withMore(row("c", ids(12, "c")), undefined, 10).items).toHaveLength(10);
  });
});

describe("freshShelves", () => {
  it("leaves out the titles already shown above, and a row with too few left", () => {
    const shown = [row("first", ids(20, "t"))];
    const shelves = [
      row("same", ids(20, "t")),
      row("mostly", [...ids(10, "t"), ...ids(MIN_SHELF, "new")]),
      row("fresh", ids(15, "x")),
      row("thin", [...ids(MIN_SHELF - 1, "y"), "t0"]),
    ];
    const out = freshShelves(shown, shelves);
    expect(out.map((r) => r.id)).toEqual(["mostly", "fresh"]);
    expect(idsOf(out[0]!)).toEqual(ids(MIN_SHELF, "new"));
    // a row nothing was taken from is the same row
    expect(out[1]).toBe(shelves[2]);
  });

  it("shows a title once across the rows brought, too", () => {
    const out = freshShelves([], [row("a", ids(12, "t")), row("b", [...ids(12, "t"), ...ids(10, "u")])]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(idsOf(out[1]!)).toEqual(ids(10, "u"));
  });
});

describe("the rows of a page", () => {
  const data = (over: Partial<ReturnType<Feed["getSnapshot"]>["data"]> = {}) => ({
    base: [row("one", ids(20, "a")), row("empty", [])],
    shelves: { all: { rows: [row("s1", ids(20, "b"))], cursor: 1 }, movie: { rows: [row("m1", ids(20, "c"))], cursor: 1 }, series: { rows: [], cursor: 0 } },
    more: {},
    ...over,
  });

  it("is the first rows, then the ones brought for that page", () => {
    expect(pageRows(data(), undefined).map((r) => r.id)).toEqual(["one", "s1"]);
    expect(pageRows(data(), "movie").map((r) => r.id)).toEqual(["one", "m1"]);
    expect(pageRows(data(), "series").map((r) => r.id)).toEqual(["one"]);
  });

  it("grows a row with what was received for it", () => {
    const rows = pageRows(data({ more: { one: { items: ids(30, "z").map(item), next: 3, last: false } } }), undefined);
    expect(rows[0]!.items).toHaveLength(50);
    expect(rows[1]!.items).toHaveLength(20);
  });

  it("gives every row once for the pages of the categories", () => {
    const all = allRows(data({ shelves: { all: { rows: [row("s1", ids(20, "b")), row("one", ids(20, "a"))], cursor: 1 }, movie: { rows: [row("s1", ids(20, "b"))], cursor: 1 }, series: { rows: [], cursor: 0 } } }));
    expect(all.map((r) => r.id)).toEqual(["one", "s1"]);
    expect(all.every((r) => r.items.length <= GRID_CAP)).toBe(true);
  });
});

describe("the feed", () => {
  let feed: Feed;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("searches every title it was given, from the first rows and from anywhere else", () => {
    feed = createFeed({ fetch: server(() => ({})).fetch });
    feed.setBase([row("one", ["alpha", "beta"])]);
    feed.learn([{ id: "x", title: "Casablanca", url: "/x" }]);
    expect(feed.index.size).toBe(3);
    expect(feed.index.find("casablanca", "strict").map((t) => t.id)).toEqual(["x"]);
  });

  it("asks for the next rows from the start, keeps them, and moves on", async () => {
    const wire = server((url) => (url.endsWith("cursor=0") ? { rows: [row("s1", ids(20, "b"))], next: 5 } : { rows: [row("s2", ids(20, "c"))], next: null }));
    feed = createFeed({ fetch: wire.fetch });
    feed.loadShelves();
    expect(loadingShelves(feed.getSnapshot(), undefined)).toBe(true);
    await settle();
    expect(loadingShelves(feed.getSnapshot(), undefined)).toBe(false);
    expect(wire.asked).toEqual(["/api/library/rows?cursor=0"]);
    expect(feed.getSnapshot().data.shelves.all).toMatchObject({ cursor: 5 });
    expect(hasMoreShelves(feed.getSnapshot(), undefined)).toBe(true);
    feed.loadShelves();
    await settle();
    expect(wire.asked).toEqual(["/api/library/rows?cursor=0", "/api/library/rows?cursor=5"]);
    expect(feed.getSnapshot().data.shelves.all.rows.map((r) => r.id)).toEqual(["s1", "s2"]);
    // that was the last: nothing more is asked
    expect(hasMoreShelves(feed.getSnapshot(), undefined)).toBe(false);
    feed.loadShelves();
    await settle();
    expect(wire.asked).toHaveLength(2);
    // the titles went into the index
    expect(feed.index.size).toBe(40);
  });

  it("asks for a kind of its own, and keeps the three runs apart", async () => {
    const wire = server(() => ({ rows: [row("m", ids(20, "m"))], next: 1 }));
    feed = createFeed({ fetch: wire.fetch });
    feed.loadShelves("movie");
    await settle();
    expect(wire.asked).toEqual(["/api/library/rows?cursor=0&kind=movie"]);
    expect(feed.getSnapshot().data.shelves.movie.cursor).toBe(1);
    expect(feed.getSnapshot().data.shelves.all.cursor).toBe(0);
    expect(feed.getSnapshot().data.shelves.series.cursor).toBe(0);
  });

  it("does not ask again while it is being asked, or for a row it already has", async () => {
    const wire = server(() => ({ rows: [row("s1", ids(20, "b")), row("dup", [])], next: 1 }));
    feed = createFeed({ fetch: wire.fetch });
    feed.setBase([row("s1", ids(20, "a"))]);
    feed.loadShelves();
    feed.loadShelves();
    feed.loadShelves();
    await settle();
    expect(wire.asked).toHaveLength(1);
    // s1 is a first row already and "dup" has no titles
    expect(feed.getSnapshot().data.shelves.all.rows).toEqual([]);
  });

  it("stops when it has as many rows as a page may have", async () => {
    let calls = 0;
    const wire = server(() => {
      const call = calls++;
      return { rows: Array.from({ length: 20 }, (_, at) => row(`r${call}-${at}`, ids(10, `r${call}-${at}-`))), next: call + 1 };
    });
    feed = createFeed({ fetch: wire.fetch });
    for (let at = 0; at < 5; at++) {
      feed.loadShelves();
      await settle();
    }
    expect(wire.asked).toHaveLength(SHELF_CAP / 20);
    expect(feed.getSnapshot().data.shelves.all.rows).toHaveLength(SHELF_CAP);
    expect(hasMoreShelves(feed.getSnapshot(), undefined)).toBe(false);
  });

  it("leaves out the repeats of a row it has", async () => {
    const wire = server(() => ({ rows: [row("same", ids(20, "b"))], next: 1 }));
    feed = createFeed({ fetch: wire.fetch });
    feed.loadShelves();
    await settle();
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().data.shelves.all.rows).toHaveLength(1);
  });

  it("marks a failed question, asks it again after a wait that grows, and clears the mark when it works", async () => {
    let fail = true;
    const wire = server(() => (fail ? new Error("down") : { rows: [row("s1", ids(20, "b"))], next: null }));
    feed = createFeed({ fetch: wire.fetch, retryMs: 1000 });
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
    expect(loadingShelves(feed.getSnapshot(), undefined)).toBe(false);
    // asking while it is marked does nothing
    feed.loadShelves();
    await settle();
    expect(wire.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBeUndefined();
    // the second failure waits twice as long
    feed.loadShelves();
    await settle();
    expect(wire.asked).toHaveLength(2);
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBeUndefined();
    fail = false;
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().data.shelves.all.rows.map((r) => r.id)).toEqual(["s1"]);
    expect(feed.getSnapshot().status.failed).toEqual({});
  });

  it("treats an answer that is not what was promised as a failure", async () => {
    feed = createFeed({ fetch: server(() => ({ rows: "nope" })).fetch, retryMs: 1000 });
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
    expect(feed.getSnapshot().data.shelves.all.rows).toEqual([]);
  });

  it("treats a refusal from the server as a failure", async () => {
    const fake = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }) as unknown as Response);
    feed = createFeed({ fetch: fake as unknown as typeof fetch, retryMs: 1000 });
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().status.failed["shelves:all"]).toBe(true);
  });

  it("asks for the pages of a row one after the other, each title once", async () => {
    const wire = server((url) => {
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      return { items: [item("a0"), ...ids(5, `p${page}-`).map(item)], last: page === 4 };
    });
    feed = createFeed({ fetch: wire.fetch });
    feed.setBase([row("a", ids(20, "a"))]);
    for (let at = 0; at < 5; at++) {
      feed.loadMore("a");
      await settle();
    }
    expect(wire.asked).toEqual([2, 3, 4].map((page) => `/api/library/more?row=a&page=${page}`));
    const have = feed.getSnapshot().data.more.a!;
    expect(have.items).toHaveLength(15);
    expect(have.items.some((i) => i.id === "a0")).toBe(false);
    expect(have.last).toBe(true);
    expect(hasMoreTitles(feed.getSnapshot(), "a", 35)).toBe(false);
    expect(pageRows(feed.getSnapshot().data, undefined)[0]!.items).toHaveLength(35);
  });

  it("does not ask for more of a row it does not have, or one that is full", async () => {
    const wire = server(() => ({ items: ids(20, "q").map(item), last: false }));
    feed = createFeed({ fetch: wire.fetch });
    feed.loadMore("nobody");
    await settle();
    expect(wire.asked).toEqual([]);
    feed.setBase([row("a", ids(20, "a"))]);
    feed.loadMore("a", 30);
    await settle();
    expect(wire.asked).toHaveLength(1);
    // 20 + 20 titles are more than the cap of 30
    feed.loadMore("a", 30);
    await settle();
    expect(wire.asked).toHaveLength(1);
    expect(hasMoreTitles(feed.getSnapshot(), "a", 30, 30)).toBe(false);
    expect(hasMoreTitles(feed.getSnapshot(), "a", 20, ROW_CAP)).toBe(true);
  });

  it("asks for the pages of a row that was brought, too, and says when it is being asked", async () => {
    const wire = server((url) => (url.startsWith("/api/library/rows") ? { rows: [row("s1", ids(20, "b"))], next: null } : { items: ids(10, "c").map(item), last: false }));
    feed = createFeed({ fetch: wire.fetch });
    feed.loadShelves();
    await settle();
    feed.loadMore("s1");
    expect(loadingTitles(feed.getSnapshot(), "s1")).toBe(true);
    await settle();
    expect(loadingTitles(feed.getSnapshot(), "s1")).toBe(false);
    expect(wire.asked[1]).toBe("/api/library/more?row=s1&page=2");
    expect(allRows(feed.getSnapshot().data)[0]!.items).toHaveLength(30);
  });

  it("gives a new snapshot only when something changed, and tells those who listen", async () => {
    feed = createFeed({ fetch: server(() => ({ rows: [row("s1", ids(20, "b"))], next: null })).fetch });
    const heard = vi.fn();
    const stop = feed.subscribe(heard);
    const first = feed.getSnapshot();
    expect(feed.getSnapshot()).toBe(first);
    feed.loadShelves();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).not.toBe(first);
    await settle();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    feed.setBase([row("a", ids(3, "a"))]);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("does not change the first rows when the same ones are set again", () => {
    feed = createFeed({ fetch: server(() => ({})).fetch });
    const rows = [row("a", ids(3, "a"))];
    feed.setBase(rows);
    const after = feed.getSnapshot();
    feed.setBase(rows);
    expect(feed.getSnapshot()).toBe(after);
  });

  it("forgets everything on a reset, and leaves out what was still on its way", async () => {
    const wire = server(() => ({ rows: [row("late", ids(20, "b"))], next: null }));
    feed = createFeed({ fetch: wire.fetch });
    feed.setBase([row("a", ids(3, "a"))]);
    feed.loadShelves();
    feed.reset();
    await settle();
    expect(feed.getSnapshot().data.base).toEqual([]);
    expect(feed.getSnapshot().data.shelves.all.rows).toEqual([]);
    expect(feed.getSnapshot().status.busy).toEqual({});
    expect(feed.index.size).toBe(0);
    // and it can be asked again
    feed.loadShelves();
    await settle();
    expect(feed.getSnapshot().data.shelves.all.rows.map((r) => r.id)).toEqual(["late"]);
  });
});
