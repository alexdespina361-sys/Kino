import { describe, expect, it } from "vitest";
import { DEFAULT_LIST, type LibraryItem, type LibraryRow, type ListInfo, type LiveListItem, type LiveProgress } from "../../shared";
import { t } from "../i18n";
import { freshSimilar, gridOf, heroActions, isRowsPage, KIND_FILTERS, ofKind, overviewActions, resumable, rowsOfPage, shownList, viewKey, type PageData } from "./pages";

const item = (id: string, kind?: "movie" | "series", extra: Partial<LibraryItem> = {}): LibraryItem => ({ id, title: `Title ${id}`, url: `https://x.example/${id}`, ...(kind ? { kind } : {}), ...extra });
const row = (id: string, kind: "movie" | "series" | undefined, count = 3): LibraryRow => ({
  id,
  title: `Row ${id}`,
  source: "Test",
  ...(kind ? { kind } : {}),
  items: Array.from({ length: count }, (_, i) => item(`${id}-${i}`, kind, { image: `poster-${id}-${i}`, backdrop: `wide-${id}-${i}` })),
});
const card = (key: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key, at: 1, title: `Card ${key}`, url: `https://x.example/${key}`, position: 100, duration: 1000, ...extra });
const saved = (key: string, list?: string): LiveListItem => ({ key, at: 1, id: key, title: `Saved ${key}`, url: `https://x.example/${key}`, ...(list ? { list } : {}) });

const FIRST: ListInfo = { id: DEFAULT_LIST };
const data = (overrides: Partial<PageData> = {}): PageData => ({ rows: [], progress: [], lists: [FIRST], list: [], similar: null, ...overrides });
const library = [row("m1", "movie"), row("s1", "series"), row("m2", "movie"), row("s2", "series"), row("m3", "movie"), row("s3", "series")];

describe("viewKey", () => {
  it("names a page, and tells one category or one list of categories from another", () => {
    expect(viewKey({ kind: "home" })).toBe("home");
    expect(viewKey({ kind: "category", rowId: "x" })).toBe("category:x");
    expect(viewKey({ kind: "categories", of: "movie" })).toBe("categories:movie");
    expect(viewKey({ kind: "categories" })).toBe("categories:all");
  });

  it("tells the lists apart, and keeps the first list's name as it was", () => {
    expect(viewKey({ kind: "list" })).toBe("list");
    expect(viewKey({ kind: "list", list: DEFAULT_LIST })).toBe("list");
    expect(viewKey({ kind: "list", list: "lx" })).toBe("list:lx");
  });

  it("knows which pages are made of rows", () => {
    expect(["home", "movies", "series"].every((kind) => isRowsPage({ kind } as never))).toBe(true);
    expect(["list", "history", "search", "category", "categories"].some((kind) => isRowsPage({ kind } as never))).toBe(false);
  });
});

describe("rowsOfPage: home", () => {
  it("starts with what is part way through, then titles like the last one watched, then its lists, then the library", () => {
    const rows = rowsOfPage(
      "home",
      data({
        rows: library,
        progress: [card("a"), card("b", { done: true })],
        list: [saved("l1")],
        similar: { title: "Card a", items: [item("sim")] },
      }),
    );
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual(["continue", "similar", `list:${DEFAULT_LIST}`]);
    expect(rows[0]!.entries.map((e) => e.title)).toEqual(["Card a"]); // the finished one is not part way through
    expect(rows[1]!.title).toBe(t("rows.because", { title: "Card a" }));
    expect(rows.slice(3, 6).map((r) => r.id)).toEqual(["m1", "s1", "m2"]);
  });

  it("leaves out the rows this profile has nothing for", () => {
    const rows = rowsOfPage("home", data({ rows: library }));
    expect(rows[0]!.id).toBe("m1");
    expect(rows.map((r) => r.id)).not.toContain("continue");
    expect(rows.map((r) => r.id).some((id) => id.startsWith("list:"))).toBe(false);
    expect(rows.map((r) => r.id)).not.toContain("similar");
  });

  it("has a row for each list that has a title in it, named as the list is, and none for an empty one", () => {
    const lists: ListInfo[] = [FIRST, { id: "la", name: "Weekend" }, { id: "lb", name: "Empty" }];
    const rows = rowsOfPage("home", data({ lists, list: [saved("a"), saved("b", "la"), saved("c", "la")] }));
    expect(rows.slice(0, 2).map((r) => [r.id, r.title, r.entries.length])).toEqual([
      [`list:${DEFAULT_LIST}`, t("list.favourites"), 1],
      ["list:la", "Weekend", 2],
    ]);
  });

  it("shows the first library row as a ranking of ten at most, and the rest as wide tiles", () => {
    const rows = rowsOfPage("home", data({ rows: [row("big", "movie", 30), row("next", "movie")] }));
    expect(rows[0]).toMatchObject({ id: "big", layout: "ranked" });
    expect(rows[0]!.entries).toHaveLength(10);
    expect(rows[1]).toMatchObject({ id: "next", layout: "wide" });
  });

  it("puts a row of categories in after the third row, with an All categories tile once there are more than fit", () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`r${i}`, i % 2 ? "series" : "movie"));
    const rows = rowsOfPage("home", data({ rows: many }));
    expect(rows[3]).toMatchObject({ id: "categories", layout: "categories" });
    expect(rows[3]!.entries).toHaveLength(13);
    expect(rows[3]!.entries.at(-1)).toMatchObject({ title: t("tv.allCategories"), opens: { kind: "categories" } });
    expect(rows[3]!.entries[0]).toMatchObject({ title: "Row r0", opens: { kind: "category", rowId: "r0" }, note: t("tv.titles", { count: 3 }), image: "wide-r0-0" });
  });

  it("has no row of categories when the library is only a few rows", () => {
    expect(rowsOfPage("home", data({ rows: library.slice(0, 3) })).map((r) => r.id)).not.toContain("categories");
  });

  it("gives a title both its pictures, so the banner and the tiles can each use theirs", () => {
    const entry = rowsOfPage("home", data({ rows: library }))[0]!.entries[0]!;
    expect(entry).toMatchObject({ image: "poster-m1-0", backdrop: "wide-m1-0", url: "https://x.example/m1-0" });
  });
});

describe("rowsOfPage: movies and series", () => {
  const many = Array.from({ length: 12 }, (_, i) => row(`r${i}`, i % 2 ? "series" : "movie"));

  it("shows only the rows of its kind, the first as the ranking", () => {
    const movies = rowsOfPage("movies", data({ rows: many }));
    expect(movies.filter((r) => r.layout !== "categories").every((r) => r.id.startsWith("r"))).toBe(true);
    expect(movies.filter((r) => r.layout !== "categories").map((r) => r.id)).toEqual(["r0", "r2", "r4", "r6", "r8", "r10"]);
    expect(movies[0]!.layout).toBe("ranked");
    const series = rowsOfPage("series", data({ rows: many }));
    expect(series.filter((r) => r.layout !== "categories").map((r) => r.id)).toEqual(["r1", "r3", "r5", "r7", "r9", "r11"]);
  });

  it("offers only categories of its kind in its row of categories", () => {
    const categories = rowsOfPage("movies", data({ rows: many })).find((r) => r.id === "categories")!;
    expect(categories.entries.map((e) => e.title)).toEqual(["Row r0", "Row r2", "Row r4", "Row r6", "Row r8", "Row r10"]);
  });

  it("keeps what is part way through apart: shows (with an episode) on Series, films on Movies", () => {
    const progress = [card("film"), card("show", { season: 2, episode: 3 })];
    expect(rowsOfPage("movies", data({ rows: many, progress }))[0]!.entries.map((e) => e.title)).toEqual(["Card film"]);
    expect(rowsOfPage("series", data({ rows: many, progress }))[0]!.entries.map((e) => e.title)).toEqual(["Card show"]);
  });

  it("has no list or similar rows of its own: those are on Home", () => {
    const rows = rowsOfPage("movies", data({ rows: many, list: [saved("l")], similar: { title: "x", items: [item("s")] } }));
    expect(rows.map((r) => r.id).some((id) => id.startsWith("list:"))).toBe(false);
    expect(rows.map((r) => r.id)).not.toContain("similar");
  });

  it("is empty when the library has nothing of that kind (a source that does not say what its titles are)", () => {
    expect(rowsOfPage("movies", data({ rows: [row("x", undefined)] }))).toEqual([]);
  });
});

describe("gridOf", () => {
  it("is a list: its saved titles, newest first as kept, under the name it has", () => {
    const lists: ListInfo[] = [FIRST, { id: "la", name: "Weekend" }];
    const all = data({ lists, list: [saved("a"), saved("b", "la"), saved("c")] });
    const first = gridOf({ kind: "list" }, all)!;
    expect(first.title).toBe(t("list.favourites"));
    expect(first.entries.map((e) => e.title)).toEqual(["Saved a", "Saved c"]);
    expect(first.empty).toBe(t("tv.listEmpty"));
    const second = gridOf({ kind: "list", list: "la" }, all)!;
    expect(second.title).toBe("Weekend");
    expect(second.entries.map((e) => e.title)).toEqual(["Saved b"]);
  });

  it("shows the first list when the list it names is gone", () => {
    const lists: ListInfo[] = [FIRST, { id: "la", name: "Weekend" }];
    expect(shownList({ kind: "list", list: "gone" }, lists)).toBe(lists[0]);
    expect(shownList({ kind: "list", list: "la" }, lists)).toBe(lists[1]);
    expect(shownList({ kind: "home" }, lists)).toBe(lists[0]);
    expect(gridOf({ kind: "list", list: "gone" }, data({ lists }))!.title).toBe(t("list.favourites"));
  });

  it("is History: every card, finished ones marked as watched, unfinished ones resumable", () => {
    const page = gridOf({ kind: "history" }, data({ progress: [card("a"), card("b", { done: true, position: 1000 })] }))!;
    expect(page.entries.map((e) => e.title)).toEqual(["Card a", "Card b"]);
    expect(page.entries[0]).toMatchObject({ startAt: 100, progress: 0.1 });
    expect(page.entries[1]).toMatchObject({ note: t("card.watched") });
    expect(page.entries[1]!.startAt).toBeUndefined();
    expect(page.empty).toBe(t("tv.historyEmpty"));
  });

  it("is one category: its titles, and nothing when the library no longer has it", () => {
    const page = gridOf({ kind: "category", rowId: "m1" }, data({ rows: library }))!;
    expect(page.title).toBe("Row m1");
    expect(page.entries).toHaveLength(3);
    expect(gridOf({ kind: "category", rowId: "gone" }, data({ rows: library }))).toBeNull();
  });

  it("says which source a row is from only when the library has more than one", () => {
    const one = data({ rows: library });
    expect(rowsOfPage("home", one).every((each) => each.source === undefined)).toBe(true);
    expect(gridOf({ kind: "category", rowId: "m1" }, one)!.meta).toBe(t("tv.titles", { count: 3 }));
    expect(gridOf({ kind: "categories" }, one)!.entries.every((each) => each.source === undefined)).toBe(true);

    const two = data({ rows: [...library.slice(0, 5), { ...library[5]!, source: "Archive" }] });
    expect(rowsOfPage("home", two).find((each) => each.id === "s3")?.source).toBe("Archive");
    expect(gridOf({ kind: "category", rowId: "s3" }, two)!.meta).toBe(`${t("tv.titles", { count: 3 })} · Archive`);
    expect(gridOf({ kind: "categories" }, two)!.entries.map((each) => each.source)).toEqual(["Test", "Test", "Test", "Test", "Test", "Archive"]);
  });

  it("lists the categories, all of them or those of one kind", () => {
    expect(gridOf({ kind: "categories" }, data({ rows: library }))!.entries).toHaveLength(6);
    const movies = gridOf({ kind: "categories", of: "movie" }, data({ rows: library }))!;
    expect(movies.title).toBe(t("tv.movieCategories"));
    expect(movies.layout).toBe("categories");
    expect(movies.entries.map((e) => e.opens)).toEqual([
      { kind: "category", rowId: "m1" },
      { kind: "category", rowId: "m2" },
      { kind: "category", rowId: "m3" },
    ]);
    expect(gridOf({ kind: "categories", of: "series" }, data({ rows: library }))!.title).toBe(t("tv.seriesCategories"));
  });

  it("is nothing for the pages that are not one grid", () => {
    expect(gridOf({ kind: "home" }, data())).toBeNull();
    expect(gridOf({ kind: "search" }, data())).toBeNull();
  });
});

describe("resumable", () => {
  const started = card("film", { url: "https://x.example/watch/7", position: 300, duration: 1000 });
  const episode = card("show:Dark", { url: "https://x.example/watch/9?s=1&e=3", position: 200, duration: 600 });

  it("picks a title up where it was left, wherever it is shown", () => {
    const found = resumable({ id: "m", title: "Film", url: "https://x.example/watch/7" }, [started]);
    expect(found.startAt).toBe(300);
    expect(found.resumeUrl).toBe("https://x.example/watch/7");
  });

  it("picks a show up at the episode it was left on, though the title's own link is the first one", () => {
    const found = resumable({ id: "d", title: "Dark", url: "https://x.example/watch/9?s=1&e=1" }, [started, episode]);
    expect(found.startAt).toBe(200);
    expect(found.resumeUrl).toBe("https://x.example/watch/9?s=1&e=3");
    expect(found.url).toBe("https://x.example/watch/9?s=1&e=1");
  });

  it("leaves alone what was not started, what was finished, another title, a category, and a card that already resumes", () => {
    const plain = { id: "m", title: "Film", url: "https://x.example/watch/7" };
    expect(resumable(plain, [])).toBe(plain);
    expect(resumable(plain, [card("a", { url: plain.url, position: 2 })])).toBe(plain); // barely begun
    expect(resumable(plain, [card("a", { url: plain.url, done: true })])).toBe(plain);
    expect(resumable(plain, [episode])).toBe(plain);
    const category = { id: "c", title: "C", url: "", opens: { kind: "home" } as const };
    expect(resumable(category, [started])).toBe(category);
    const resuming = { ...plain, startAt: 50 };
    expect(resumable(resuming, [started])).toBe(resuming);
  });
});

describe("freshSimilar", () => {
  it("leaves out what was already started or saved, whatever the case of its name", () => {
    const items = [item("a", undefined, { title: "Alpha" }), item("b", undefined, { title: "Beta" }), item("c", undefined, { title: "Gamma" })];
    const fresh = freshSimilar(items, [card("x", { title: "ALPHA" })], [{ ...saved("y"), title: "beta" }]);
    expect(fresh.map((i) => i.title)).toEqual(["Gamma"]);
  });
});

describe("heroActions", () => {
  it("offers Play and My List for a title, Play and Remove for a card of Continue watching, and nothing for a category", () => {
    expect(heroActions({ id: "a", title: "A", url: "u" })).toEqual(["play", "list"]);
    expect(heroActions({ id: "a", title: "A", url: "u", progressKey: "k" })).toEqual(["play", "remove"]);
    expect(heroActions({ id: "a", title: "A", url: "", opens: { kind: "home" } })).toEqual([]);
    expect(heroActions(undefined)).toEqual([]);
  });
});

describe("overviewActions", () => {
  it("offers Play and My List for any title, and Remove besides for a card of Continue watching", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" })).toEqual(["play", "list"]);
    expect(overviewActions({ id: "a", title: "A", url: "u", progressKey: "k" })).toEqual(["play", "list", "remove"]);
  });
});

describe("ofKind", () => {
  const items = [item("m", "movie"), item("s", "series"), item("u")];
  it("keeps everything for All, and only what says it is of that kind otherwise", () => {
    expect(ofKind(items, "all").map((i) => i.id)).toEqual(["m", "s", "u"]);
    expect(ofKind(items, "movie").map((i) => i.id)).toEqual(["m"]);
    expect(ofKind(items, "series").map((i) => i.id)).toEqual(["s"]);
  });
  it("has a filter for each", () => {
    expect(KIND_FILTERS).toEqual(["all", "movie", "series"]);
  });
});
