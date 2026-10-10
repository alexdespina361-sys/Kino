import { describe, expect, it } from "vitest";
import type { LibraryItem, LibraryRow, LiveListItem, LiveProgress } from "../../shared";
import { t } from "../i18n";
import { freshSimilar, gridOf, heroActions, isRowsPage, KIND_FILTERS, ofKind, rowsOfPage, viewKey, type PageData } from "./pages";

const item = (id: string, kind?: "movie" | "series", extra: Partial<LibraryItem> = {}): LibraryItem => ({ id, title: `Title ${id}`, url: `https://x.example/${id}`, ...(kind ? { kind } : {}), ...extra });
const row = (id: string, kind: "movie" | "series" | undefined, count = 3): LibraryRow => ({
  id,
  title: `Row ${id}`,
  source: "Test",
  ...(kind ? { kind } : {}),
  items: Array.from({ length: count }, (_, i) => item(`${id}-${i}`, kind, { image: `poster-${id}-${i}`, backdrop: `wide-${id}-${i}` })),
});
const card = (key: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key, at: 1, title: `Card ${key}`, url: `https://x.example/${key}`, position: 100, duration: 1000, ...extra });
const saved = (key: string): LiveListItem => ({ key, at: 1, id: key, title: `Saved ${key}`, url: `https://x.example/${key}` });

const data = (overrides: Partial<PageData> = {}): PageData => ({ rows: [], progress: [], list: [], similar: null, ...overrides });
const library = [row("m1", "movie"), row("s1", "series"), row("m2", "movie"), row("s2", "series"), row("m3", "movie"), row("s3", "series")];

describe("viewKey", () => {
  it("names a page, and tells one category or one list of categories from another", () => {
    expect(viewKey({ kind: "home" })).toBe("home");
    expect(viewKey({ kind: "category", rowId: "x" })).toBe("category:x");
    expect(viewKey({ kind: "categories", of: "movie" })).toBe("categories:movie");
    expect(viewKey({ kind: "categories" })).toBe("categories:all");
  });

  it("knows which pages are made of rows", () => {
    expect(["home", "movies", "series"].every((kind) => isRowsPage({ kind } as never))).toBe(true);
    expect(["list", "history", "search", "category", "categories"].some((kind) => isRowsPage({ kind } as never))).toBe(false);
  });
});

describe("rowsOfPage: home", () => {
  it("starts with what is part way through, then titles like the last one watched, then My List, then the library", () => {
    const rows = rowsOfPage(
      "home",
      data({
        rows: library,
        progress: [card("a"), card("b", { done: true })],
        list: [saved("l1")],
        similar: { title: "Card a", items: [item("sim")] },
      }),
    );
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual(["continue", "similar", "list"]);
    expect(rows[0]!.entries.map((e) => e.title)).toEqual(["Card a"]); // the finished one is not part way through
    expect(rows[1]!.title).toBe(t("rows.because", { title: "Card a" }));
    expect(rows.slice(3, 6).map((r) => r.id)).toEqual(["m1", "s1", "m2"]);
  });

  it("leaves out the rows this profile has nothing for", () => {
    const rows = rowsOfPage("home", data({ rows: library }));
    expect(rows[0]!.id).toBe("m1");
    expect(rows.map((r) => r.id)).not.toContain("continue");
    expect(rows.map((r) => r.id)).not.toContain("list");
    expect(rows.map((r) => r.id)).not.toContain("similar");
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

  it("has no My List or similar row of its own: those are on Home", () => {
    const rows = rowsOfPage("movies", data({ rows: many, list: [saved("l")], similar: { title: "x", items: [item("s")] } }));
    expect(rows.map((r) => r.id)).not.toContain("list");
    expect(rows.map((r) => r.id)).not.toContain("similar");
  });

  it("is empty when the library has nothing of that kind (a source that does not say what its titles are)", () => {
    expect(rowsOfPage("movies", data({ rows: [row("x", undefined)] }))).toEqual([]);
  });
});

describe("gridOf", () => {
  it("is My List: the saved titles, newest first as kept", () => {
    const page = gridOf({ kind: "list" }, data({ list: [saved("a"), saved("b")] }))!;
    expect(page.entries.map((e) => e.title)).toEqual(["Saved a", "Saved b"]);
    expect(page.empty).toBe(t("tv.listEmpty"));
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
