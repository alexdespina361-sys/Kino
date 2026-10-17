import { describe, expect, it, vi } from "vitest";
import type { LibraryItem, LiveListItem, LiveProgress, LiveRating } from "../../shared";
import { becauseRows, createLikeThis, LOVED_FROM, MIN_NEXT, seedsOf, type Seed } from "./recommend";

const card = (name: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key: `url:https://x.example/${name}`, at: 1, title: `Card ${name}`, url: `https://x.example/${name}`, position: 100, duration: 6000, ...extra });
const rated = (name: string, score: number, ratedAt: number, extra: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${name}`, at: ratedAt, title: `Rated ${name}`, url: `https://x.example/${name}`, score, ratedAt, ...extra });
const saved = (title: string): LiveListItem => ({ key: `url:${title}`, at: 1, id: title, title, url: `https://x.example/${title}` });
const item = (id: string, title = `Title ${id}`): LibraryItem => ({ id, title, url: `/fixtures/${id}.mp4` });
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, at) => `${prefix}${at}`);

describe("seedsOf", () => {
  it("is the titles watched last, newest first", () => {
    expect(seedsOf([card("a"), card("b"), card("c"), card("d")], []).map((s) => [s.title, s.why])).toEqual([
      ["Card a", "watched"],
      ["Card b", "watched"],
      ["Card c", "watched"],
    ]);
  });

  it("counts every episode of a show as the show", () => {
    const episode = (n: number) => card("show", { url: `https://x.example/show?s=1&e=${n}`, key: `show:Show`, title: "Show", episode: n, season: 1 });
    const seeds = seedsOf([episode(3), card("b"), episode(1)], []);
    expect(seeds.map((s) => s.title)).toEqual(["Show", "Card b"]);
  });

  it("brings in a title that was scored high, in turn with those watched, and says it was loved", () => {
    const seeds = seedsOf([card("a"), card("b"), card("c")], [rated("x", LOVED_FROM, 5), rated("y", LOVED_FROM + 1, 9), rated("z", LOVED_FROM - 1, 10)]);
    // watched a, loved y (the newest score), watched b -- not z (its score is not high), not x (no room)
    expect(seeds.map((s) => [s.title, s.why])).toEqual([
      ["Card a", "watched"],
      ["Rated y", "loved"],
      ["Card b", "watched"],
    ]);
  });

  it("says a title both watched and scored high is loved, and asks about it once", () => {
    const seeds = seedsOf([card("a")], [rated("a", 10, 1, { title: "Card a" })]);
    expect(seeds).toEqual([{ key: "https://x.example/a", title: "Card a", url: "https://x.example/a", why: "loved" }]);
  });

  it("leaves out a score for one season, and has none for a profile that has watched and scored nothing", () => {
    expect(seedsOf([], [rated("x", 10, 1, { season: 2 })])).toEqual([]);
    expect(seedsOf([], [])).toEqual([]);
  });

  it("stops at the most it was asked for", () => {
    expect(seedsOf([card("a"), card("b"), card("c")], [], 1)).toHaveLength(1);
    expect(seedsOf([card("a")], [rated("x", 10, 1), rated("y", 10, 2)], 3).map((s) => s.title)).toEqual(["Card a", "Rated y", "Rated x"]);
  });
});

describe("becauseRows", () => {
  const seed = (name: string, why: Seed["why"] = "watched"): Seed => ({ key: `https://x.example/${name}`, title: `Card ${name}`, url: `https://x.example/${name}`, why });
  const answers = (table: Record<string, LibraryItem[]>) => (key: string) => table[key];

  it("is the titles like each, without anything started, saved, or the title itself", () => {
    const rows = becauseRows(
      [seed("a")],
      answers({ "https://x.example/a": [item("1", "Fresh"), item("2", "Saved One"), item("3", "Card b"), item("4", "Card a")] }),
      [card("b")],
      [saved("Saved One")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.items.map((i) => i.title)).toEqual(["Fresh"]);
    expect(rows[0]).toMatchObject({ key: "https://x.example/a", title: "Card a", why: "watched" });
  });

  it("shows a title in one row only, and a row after the first only when it has enough that are new", () => {
    const first = ids(10, "a").map((id) => item(id));
    const second = [...ids(5, "a").map((id) => item(id)), ...ids(MIN_NEXT, "b").map((id) => item(id))];
    const third = [...ids(10, "a").map((id) => item(id)), ...ids(MIN_NEXT - 1, "c").map((id) => item(id))];
    const rows = becauseRows([seed("a"), seed("b", "loved"), seed("c")], answers({ "https://x.example/a": first, "https://x.example/b": second, "https://x.example/c": third }), [], []);
    expect(rows.map((r) => r.title)).toEqual(["Card a", "Card b"]);
    expect(rows[1]!.items.map((i) => i.id)).toEqual(ids(MIN_NEXT, "b"));
    expect(rows[1]!.why).toBe("loved");
  });

  it("shows the first row however few titles it has, and none for a title nothing is known of", () => {
    expect(becauseRows([seed("a")], answers({ "https://x.example/a": [item("1")] }), [], [])).toHaveLength(1);
    expect(becauseRows([seed("a")], answers({}), [], [])).toEqual([]);
    expect(becauseRows([seed("a")], answers({ "https://x.example/a": [] }), [], [])).toEqual([]);
  });

  it("is a row for the next title when the first has nothing", () => {
    const rows = becauseRows([seed("a"), seed("b")], answers({ "https://x.example/b": [item("1")] }), [], []);
    expect(rows.map((r) => r.title)).toEqual(["Card b"]);
  });
});

describe("createLikeThis", () => {
  const seed: Seed = { key: "k", title: "T", url: "https://x.example/t?s=1&e=2", why: "watched" };
  const settle = async () => {
    for (let at = 0; at < 30; at++) await Promise.resolve();
  };
  const answering = (body: unknown, ok = true) => vi.fn(async (_input: RequestInfo | URL) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

  it("asks the library once for a title, keeps the answer, and tells those who listen", async () => {
    const fetchFake = answering({ items: [item("1")] });
    const learn = vi.fn();
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, learn });
    const heard = vi.fn();
    store.subscribe(heard);
    store.ask(seed);
    store.ask(seed);
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(fetchFake.mock.calls[0]![0]).toBe(`/api/library/similar?url=${encodeURIComponent(seed.url)}`);
    expect(store.get("k")).toEqual([item("1")]);
    expect(learn).toHaveBeenCalledWith([item("1")]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.version()).toBe(1);
    store.ask(seed);
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it("keeps that nothing was found, and asks again after a question that failed", async () => {
    const nothing = answering({ nonsense: true });
    const store = createLikeThis({ fetch: nothing as unknown as typeof fetch });
    store.ask(seed);
    await settle();
    expect(store.get("k")).toEqual([]);
    store.ask(seed);
    await settle();
    expect(nothing).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => {
      throw new Error("down");
    });
    const again = createLikeThis({ fetch: down as unknown as typeof fetch });
    again.ask(seed);
    await settle();
    expect(again.get("k")).toBeUndefined();
    again.ask(seed);
    await settle();
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("treats a refusal as an empty answer", async () => {
    const store = createLikeThis({ fetch: answering({}, false) as unknown as typeof fetch });
    store.ask(seed);
    await settle();
    expect(store.get("k")).toEqual([]);
  });
});
