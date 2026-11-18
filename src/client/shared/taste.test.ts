import { describe, expect, it } from "vitest";
import type { LibraryItem, LiveListItem, LiveProgress, LiveRating } from "../../shared";
import {
  ASKS_AT_ONCE,
  ASKS_MAX,
  BRANCHES,
  DISLIKED_TO,
  DRY_MAX,
  FIRST_ASKS,
  isSeen,
  knownOf,
  LOVED_FROM,
  MIN_NEXT,
  personalAfter,
  personalSlots,
  PICKS_FILL,
  PICKS_MAX,
  PICKS_MIN,
  ROW_KEEPS,
  planRows,
  ROOTS_MAX,
  rootSeeds,
  seenKeys,
  UNSEEN_MIN,
  withoutSeen,
  type Look,
  type PersonalRow,
  type Seed,
} from "./taste";

const link = (name: string) => `https://x.example/${name}`;
const card = (name: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key: `url:${link(name)}`, at: 1, title: `Card ${name}`, url: link(name), position: 100, duration: 6000, ...extra });
const rated = (name: string, score: number, ratedAt = 1, extra: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${name}`, at: ratedAt, title: `Rated ${name}`, url: link(name), score, ratedAt, ...extra });
const saved = (name: string, at = 1): LiveListItem => ({ key: `url:${name}`, at, id: name, title: `Saved ${name}`, url: link(name) });
const item = (id: string, title = `Title ${id}`, extra: Partial<LibraryItem> = {}): LibraryItem => ({ id, title, url: link(id), ...extra });
const seed = (name: string, why: Seed["why"] = "watched"): Seed => ({ key: link(name), title: `Seed ${name}`, url: link(name), why });
const many = (prefix: string, count = 6) => Array.from({ length: count }, (_, at) => item(`${prefix}${at}`));
/** The answers there are, by the name of the title asked about; `null` is one that could not be had. */
const answers =
  (all: Record<string, LibraryItem[] | null>): Look =>
  (key) =>
    all[key.replace(link(""), "")];
const NOTHING = knownOf([], []);
const names = (rows: readonly PersonalRow[]) => rows.map((row) => (row.why === "picks" ? "picks" : row.key.replace(link(""), "")));
const ids = (row: PersonalRow | undefined) => (row?.items ?? []).map((each) => each.id);

describe("what a profile has seen", () => {
  it("is what it played to the end and what it scored, every episode of a show as the show; not what it is part way through", () => {
    const seen = seenKeys([card("done", { done: true }), card("going"), card("show", { url: "https://x.example/show?s=3&e=9", done: true })], [rated("scored", 3)]);
    expect(isSeen(item("done"), seen)).toBe(true);
    expect(isSeen(item("scored"), seen)).toBe(true);
    expect(isSeen({ url: "https://x.example/show?s=1&e=1" }, seen)).toBe(true);
    expect(isSeen(item("going"), seen)).toBe(false);
    expect(isSeen(item("other"), seen)).toBe(false);
  });

  it("is left out of a row while enough is left; a row that would be short is as it was, and so is one with nothing seen in it", () => {
    const row = Array.from({ length: UNSEEN_MIN + 2 }, (_, at) => item(`t${at}`));
    const seen = seenKeys([card("t1", { done: true })], [rated("t4", 9)]);
    expect(withoutSeen(row, seen).map((each) => each.id)).toEqual(["t0", "t2", "t3", "t5", "t6", "t7"]);
    // One more seen: five would be left, which is no row.
    const more = seenKeys([card("t1", { done: true }), card("t2", { done: true })], [rated("t4", 9)]);
    expect(withoutSeen(row, more)).toBe(row);
    expect(withoutSeen(row, seenKeys([card("elsewhere", { done: true })], []))).toBe(row);
    expect(withoutSeen(row, new Set())).toBe(row);
  });
});

describe("the profile's own titles that get a row", () => {
  it("is in turn one it watched (the newest first), one it scored high and one it saved, each once", () => {
    const progress = ["a", "b", "c"].map((name) => card(name));
    const ratings = [rated("x", LOVED_FROM, 5), rated("y", LOVED_FROM + 1, 9), rated("z", LOVED_FROM - 1, 10)];
    const list = [saved("old", 1), saved("new", 9), saved("b", 5)];
    expect(rootSeeds(progress, ratings, list).map((each) => [each.title, each.why])).toEqual([
      ["Card a", "watched"],
      ["Rated y", "loved"], // (the newest high score; "z" is not high)
      ["Saved new", "saved"],
      ["Card b", "watched"],
      ["Rated x", "loved"],
      // (not "b" again, which was watched)
      ["Card c", "watched"],
      ["Saved old", "saved"],
    ]);
  });

  it("counts every episode of a show as the show, and says a title both watched and scored high is loved", () => {
    const episode = (n: number) => card("show", { url: `https://x.example/show?s=1&e=${n}`, key: "show:Show", title: "Show", episode: n, season: 1 });
    expect(rootSeeds([episode(3), card("b"), episode(1)], []).map((each) => each.title)).toEqual(["Show", "Card b"]);
    expect(rootSeeds([card("a")], [rated("a", 10, 1, { title: "Card a" })])).toEqual([{ key: link("a"), title: "Card a", url: link("a"), why: "loved" }]);
  });

  it("has none for a title that was scored low, whether watched or saved; a score for one season says nothing of the show", () => {
    const seeds = rootSeeds([card("bad"), card("fine")], [rated("bad", DISLIKED_TO), rated("hated", 2), rated("season", 1, 1, { url: link("fine"), season: 2 }), rated("part", 10, 1, { season: 2 })], [saved("hated")]);
    expect(seeds.map((each) => each.title)).toEqual(["Card fine"]);
    expect(rootSeeds([], [], [])).toEqual([]);
  });

  it("stops at the most there are rows for", () => {
    const progress = Array.from({ length: 30 }, (_, at) => card(`p${at}`));
    expect(rootSeeds(progress, [], [])).toHaveLength(ROOTS_MAX);
    expect(rootSeeds(progress, [], [], 2).map((each) => each.title)).toEqual(["Card p0", "Card p1"]);
  });
});

describe("the profile's rows", () => {
  it("are none while the first titles are being asked about, all of them at once", () => {
    const roots = Array.from({ length: FIRST_ASKS + 2 }, (_, at) => seed(`r${at}`));
    const plan = planRows(roots, answers({ r0: many("a") }), NOTHING, { want: 5 });
    expect(plan.rows).toEqual([]);
    expect(plan.ask.map((each) => each.title)).toEqual(Array.from({ length: FIRST_ASKS - 1 }, (_, at) => `Seed r${at + 1}`));
    // A page with no place for a row, and a profile with nothing of its own, ask nothing.
    expect(planRows(roots, () => undefined, NOTHING, { want: 0 })).toEqual({ rows: [], ask: [] });
    expect(planRows([], () => undefined, NOTHING, { want: 5 })).toEqual({ rows: [], ask: [] });
  });

  it("are a row for each of its titles, in their order, each title in one row only; then the best of each row are asked about for rows of their own", () => {
    const roots = [seed("a"), seed("b", "loved"), seed("c", "saved")];
    const all = { a: many("a"), b: [...many("a", 3), ...many("b", MIN_NEXT)], c: [...many("a", PICKS_MIN - 1), ...many("c", MIN_NEXT - 1)] };
    const plan = planRows(roots, answers(all), NOTHING, { want: 10 });
    expect(names(plan.rows)).toEqual(["a", "b"]); // ("c" has too few that are new: no row)
    expect(plan.rows.map((row) => row.why)).toEqual(["watched", "loved"]);
    expect(ids(plan.rows[1])).toEqual(many("b", MIN_NEXT).map((each) => each.id));
    expect(plan.rows[0]).toMatchObject({ id: `because:${link("a")}`, title: "Seed a" });
    // Next: the first two of the first row, then the first two of the second.
    expect(plan.ask.map((each) => [each.title, each.why])).toEqual([
      ["Title a0", "like"],
      ["Title a1", "like"],
      ["Title b0", "like"],
    ]);
    expect(plan.ask).toHaveLength(ASKS_AT_ONCE);
    expect(BRANCHES).toBe(2);
  });

  it("go on from row to row: three titles watched are many rows, breadth first, and the order is the queue's whatever answer comes first", () => {
    const roots = [seed("a"), seed("b"), seed("c")];
    const all: Record<string, LibraryItem[]> = { a: many("a"), b: many("b"), c: many("c") };
    for (const name of ["a0", "a1", "b0", "b1", "c0", "c1", "a00", "a01"]) all[name] = many(name);
    // (the last asked answers first: "b0" is known before "a1", and has no row before it)
    const early = planRows(roots, answers({ a: all.a!, b: all.b!, c: all.c!, a0: all.a0!, b0: all.b0! }), NOTHING, { want: 20 });
    expect(names(early.rows)).toEqual(["a", "b", "c", "a0"]);
    expect(early.ask.map((each) => each.title)).toEqual(["Title a1", "Title b1", "Title c0"]);
    const plan = planRows(roots, answers(all), NOTHING, { want: 20 });
    expect(names(plan.rows)).toEqual(["a", "b", "c", "a0", "a1", "b0", "b1", "c0", "c1", "a00", "a01"]);
    expect(plan.rows.at(-1)).toMatchObject({ why: "like", title: "Title a01" });
    expect(plan.ask.map((each) => each.title)).toEqual(["Title a10", "Title a11", "Title b00"]);
  });

  it("stay as they are when more answers come: what is laid out never moves (the rows for some answers are the first rows for those and more)", () => {
    // A library of 120 titles, each like a dozen others by a rule of no meaning; the answers come one at a time, the last asked first.
    const title = (n: number) => item(`t${n}`);
    const like = (n: number) => Array.from({ length: 12 }, (_, at) => title((n * 7 + at * 13 + (at % 3) * n + 5) % 120)).filter((each) => each.id !== `t${n}`);
    const roots: Seed[] = [5, 40, 77].map((n) => ({ key: link(`t${n}`), title: `Title t${n}`, url: link(`t${n}`), why: "watched" }));
    const got = new Map<string, LibraryItem[]>();
    const look: Look = (key) => got.get(key);
    const whole: Look = (key) => like(Number(key.replace(link("t"), "")));
    let before: PersonalRow[] = [];
    let asked = 0;
    for (;;) {
      const plan = planRows(roots, look, NOTHING, { want: 30 });
      expect(plan.rows.slice(0, before.length)).toEqual(before);
      before = plan.rows;
      const next = plan.ask.at(-1);
      if (!next) break;
      expect(got.has(next.key)).toBe(false);
      got.set(next.key, like(Number(next.key.replace(link("t"), ""))));
      expect(++asked).toBeLessThanOrEqual(ASKS_MAX);
    }
    expect(before.length).toBeGreaterThan(8);
    // The same rows as when every answer is there from the start, and the first of them for a page with a place for fewer.
    expect(planRows(roots, whole, NOTHING, { want: 30 }).rows).toEqual(before);
    expect(planRows(roots, whole, NOTHING, { want: 4 }).rows).toEqual(before.slice(0, 4));
    // No title is in two rows, and none is one the rows are about.
    const shown = before.flatMap((row) => row.items.map((each) => each.id));
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.filter((id) => ["t5", "t40", "t77"].includes(id))).toEqual([]);
  });

  it("ask for no more than the rows the page has a place for need", () => {
    const roots = [seed("a"), seed("b"), seed("c")];
    const all = { a: many("a"), b: many("b"), c: many("c") };
    const plan = planRows(roots, answers(all), NOTHING, { want: 2 });
    expect(names(plan.rows)).toEqual(["a", "b"]);
    expect(plan.ask).toEqual([]);
    expect(planRows(roots, answers(all), NOTHING, { want: 4 }).ask.map((each) => each.title)).toEqual(["Title a0", "Title a1", "Title b0"]);
  });

  it("go on without a title the library could not answer for, and stop asking when one after another gives no row", () => {
    const roots = [seed("a"), seed("b"), seed("c")];
    const plan = planRows(roots, answers({ a: null, b: many("b"), c: [] }), NOTHING, { want: 5 });
    expect(names(plan.rows)).toEqual(["b"]);
    expect(plan.ask.map((each) => each.title)).toEqual(["Title b0", "Title b1"]);
    // Every title after the first row answers with what is shown already: after a few of them nothing more is asked.
    const same: Look = (key) => (key === link("a") ? many("x", 8) : key.startsWith(link("x")) ? many("x", 8) : undefined);
    const dry = planRows([seed("a")], same, NOTHING, { want: 9 });
    expect(names(dry.rows)).toEqual(["a"]);
    expect(dry.ask).toEqual([]);
    expect(DRY_MAX).toBeGreaterThan(BRANCHES);
  });

  it("never have what the profile started, finished, saved or scored, by link or by name, nor the titles the rows are about", () => {
    const known = knownOf([card("going"), card("done", { done: true })], [saved("kept")], [rated("scored", 2)]);
    const list = [item("going"), item("done"), item("kept"), item("scored"), item("a"), item("named", "seed b"), item("elsewhere", "Card Going"), item("fresh"), item("fresh")];
    const plan = planRows([seed("a"), seed("b")], answers({ a: list, b: [] }), known, { want: 3 });
    expect(ids(plan.rows[0])).toEqual(["fresh"]); // (the first row is shown however few titles it has)
    expect(plan.rows).toHaveLength(1);
  });

  it("are made only of the titles the page shows, and go on from those", () => {
    const film = (id: string) => item(id, `Title ${id}`, { kind: "movie" });
    const show = (id: string) => item(id, `Title ${id}`, { kind: "series" });
    const all = { a: [show("s0"), film("f0"), show("s1"), film("f1"), film("f2"), film("f3")], b: [show("s2"), show("s3"), film("f4")] };
    const plan = planRows([seed("a"), seed("b")], answers(all), NOTHING, { want: 5, keep: (each) => each.kind === "movie" });
    expect(names(plan.rows)).toEqual(["a"]); // ("b" has one film: no row after the first)
    expect(ids(plan.rows[0])).toEqual(["f0", "f1", "f2", "f3"]);
    expect(plan.ask.map((each) => each.title)).toEqual(["Title f0", "Title f1"]);
  });
});

describe("what a profile might like", () => {
  const roots = [seed("a"), seed("b", "loved"), seed("c", "saved")];
  const both = many("both", PICKS_MIN);
  const all = { a: [item("one"), ...both, ...many("a")], b: [item("fond"), ...both, ...many("b")], c: [item("fond"), item("one"), ...many("c")] };

  it("is the titles that several of its first titles led to, first of the rows; a loved one counts for more, and they are in no other row", () => {
    const plan = planRows(roots, answers(all), NOTHING, { want: 9 });
    expect(names(plan.rows)).toEqual(["picks", "a", "b", "c"]);
    // "fond" and the five came of the one that was loved and one other (2.5 each), "fond" nearer the front of an answer; "one" of two that were not loved (2).
    expect(ids(plan.rows[0])).toEqual(["fond", ...both.map((each) => each.id), "one"]);
    expect(plan.rows[0]).toMatchObject({ id: "picks", why: "picks" });
    expect(ids(plan.rows[1])).toEqual(many("a").map((each) => each.id));
  });

  it("is no row with too few titles, or for a page that wants none; and is no longer than a row", () => {
    const few = { a: [item("one"), ...many("a")], b: [item("one"), ...many("b")], c: many("c") };
    expect(names(planRows(roots, answers(few), NOTHING, { want: 9 }).rows)).toEqual(["a", "b", "c"]);
    expect(ids(planRows(roots, answers(few), NOTHING, { want: 9 }).rows[0])).toContain("one");
    const without = planRows(roots, answers(all), NOTHING, { want: 9, picks: false });
    expect(names(without.rows)).toEqual(["a", "b", "c"]);
    // Titles with nothing in common: the row is of each in turn, from past the start of its own row, which keeps that start.
    const apart = planRows([seed("a"), seed("b", "loved")], answers({ a: many("a", ROW_KEEPS + 4), b: many("b", ROW_KEEPS + 2) }), NOTHING, { want: 9 });
    expect(names(apart.rows)).toEqual(["picks", "a", "b"]);
    expect(ids(apart.rows[0])).toEqual(["a6", "b6", "a7", "b7", "a8", "a9"]);
    expect(ids(apart.rows[1])).toEqual(many("a", ROW_KEEPS).map((each) => each.id));
    // (one title alone has its own row, which is the same thing)
    expect(names(planRows([seed("a")], answers({ a: many("a", 30) }), NOTHING, { want: 9 }).rows)).toEqual(["a"]);
    expect(PICKS_FILL).toBeLessThanOrEqual(PICKS_MAX);
    const long = many("long", 60);
    const plan = planRows([seed("a"), seed("b")], answers({ a: long, b: long }), NOTHING, { want: 9 });
    expect(plan.rows[0]!.items).toHaveLength(PICKS_MAX);
    expect(LOVED_FROM).toBeGreaterThan(DISLIKED_TO);
  });
});

describe("where the profile's rows stand", () => {
  it("is one under the library's first row and one under every second row after it, in their order, as many as the page has a place for", () => {
    for (const count of [0, 1, 2, 3, 6, 7, 40]) {
      const under = Array.from({ length: count }, (_, index) => personalAfter(index)).filter((each) => each !== undefined);
      expect(under, String(count)).toEqual(Array.from({ length: under.length }, (_, at) => at));
      expect(personalSlots(count), String(count)).toBe(under.length);
    }
    expect(personalAfter(0)).toBe(0);
    expect(personalAfter(1)).toBeUndefined();
    expect(personalAfter(2)).toBe(1);
  });
});
