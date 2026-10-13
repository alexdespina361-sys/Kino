import { describe, expect, it } from "vitest";
import { DEFAULT_LIST, type LibraryItem, type LibraryRow, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { t } from "../i18n";
import { cardOf, freshSimilar, gridOf, hasRows, heroActions, isProfilePage, isRowsPage, KIND_FILTERS, ofKind, overviewActions, resumable, rowsOfPage, shownList, startOf, viewKey, type PageData } from "./pages";

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

const rated = (key: string, score: number, ratedAt: number, extra: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${key}`, at: ratedAt, title: `Rated ${key}`, url: `https://x.example/${key}`, score, ratedAt, ...extra });

const FIRST: ListInfo = { id: DEFAULT_LIST };
const data = (overrides: Partial<PageData> = {}): PageData => ({ rows: [], progress: [], lists: [FIRST], list: [], ratings: [], similar: null, ...overrides });
const library = [row("m1", "movie"), row("s1", "series"), row("m2", "movie"), row("s2", "series"), row("m3", "movie"), row("s3", "series")];

describe("viewKey", () => {
  it("names a page, and tells one category or one list of categories from another", () => {
    expect(viewKey({ kind: "home" })).toBe("home");
    expect(viewKey({ kind: "category", rowId: "x" })).toBe("category:x");
    expect(viewKey({ kind: "categories", of: "movie" })).toBe("categories:movie");
    expect(viewKey({ kind: "categories" })).toBe("categories:all");
    expect(viewKey({ kind: "ratings" })).toBe("ratings");
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

  it("tells one friend's page from another's, and the lists of a friend from the ratings", () => {
    expect(viewKey({ kind: "friends" })).toBe("friends");
    expect(viewKey({ kind: "friend", id: "f1" })).toBe("friend:f1:lists");
    expect(viewKey({ kind: "friend", id: "f1", tab: "lists" })).toBe("friend:f1:lists");
    expect(viewKey({ kind: "friend", id: "f1", tab: "ratings" })).toBe("friend:f1:ratings");
    expect(viewKey({ kind: "friend", id: "f2", tab: "ratings" })).not.toBe(viewKey({ kind: "friend", id: "f1", tab: "ratings" }));
  });

  it("has rows under a banner for the friends' and the profile's pages, though they are not among the library's rows pages", () => {
    expect(hasRows({ kind: "friends" })).toBe(true);
    expect(hasRows({ kind: "profile" })).toBe(true);
    expect(isRowsPage({ kind: "friends" })).toBe(false);
    expect(isRowsPage({ kind: "profile" })).toBe(false);
    expect(["home", "movies", "series"].every((kind) => hasRows({ kind } as never))).toBe(true);
    expect(["list", "history", "ratings", "search", "category", "categories", "friend"].some((kind) => hasRows({ kind } as never))).toBe(false);
  });

  it("names the profile's page, and counts it and the pages it holds as the profile's", () => {
    expect(viewKey({ kind: "profile" })).toBe("profile");
    expect(["profile", "ratings", "history", "friends", "friend"].every((kind) => isProfilePage({ kind } as never))).toBe(true);
    expect(["home", "movies", "series", "list", "search", "category", "categories"].some((kind) => isProfilePage({ kind } as never))).toBe(false);
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

  it("lists every category with those of films first and then those of shows, each saying which it is", () => {
    const all = gridOf({ kind: "categories" }, data({ rows: library }))!;
    expect(all.title).toBe(t("tv.allCategories"));
    expect(all.entries.map((e) => e.id)).toEqual(["m1", "m2", "m3", "s1", "s2", "s3"]);
    expect(all.entries[0]?.note).toBe(`${t("tv.movies")} · ${t("tv.titles", { count: 3 })}`);
    expect(all.entries[3]?.note).toBe(`${t("tv.series")} · ${t("tv.titles", { count: 3 })}`);
    // (a category of one kind has no need to say it, and one with no kind follows the others)
    const mixed = data({ rows: [row("x1", undefined), row("s1", "series"), row("m1", "movie")] });
    expect(gridOf({ kind: "categories" }, mixed)!.entries.map((e) => [e.id, e.note])).toEqual([
      ["m1", `${t("tv.movies")} · ${t("tv.titles", { count: 3 })}`],
      ["s1", `${t("tv.series")} · ${t("tv.titles", { count: 3 })}`],
      ["x1", t("tv.titles", { count: 3 })],
    ]);
    expect(gridOf({ kind: "categories", of: "movie" }, data({ rows: library }))!.entries[0]?.note).toBe(t("tv.titles", { count: 3 }));
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

  it("is the ratings: every title and season that was scored, the newest rating first, each with its score under it", () => {
    const page = gridOf({ kind: "ratings" }, data({ ratings: [rated("old", 6, 100), rated("new", 9, 300), rated("show", 8, 200, { season: 2, kind: "series" })] }))!;
    expect(page.title).toBe(t("rating.mine"));
    expect(page.entries.map((e) => [e.title, e.note])).toEqual([
      ["Rated new", "9/10"],
      ["Rated show", `${t("player.season", { n: 2 })} · 8/10`],
      ["Rated old", "6/10"],
    ]);
    expect(page.entries[1]).toMatchObject({ kind: "series", url: "https://x.example/show" });
    expect(page.meta).toContain("7.7"); // three ratings, their mean
  });

  it("says what the empty ratings page is for", () => {
    const page = gridOf({ kind: "ratings" }, data())!;
    expect(page.entries).toEqual([]);
    expect(page.empty).toBe(t("rating.empty"));
    expect(page.meta).toBe(t("rating.mineHelp"));
  });

  it("is nothing for the pages that are not one grid", () => {
    expect(gridOf({ kind: "home" }, data())).toBeNull();
    expect(gridOf({ kind: "search" }, data())).toBeNull();
  });
});

describe("cardOf", () => {
  it("finds the card of a title by its link, and of a show by any of its episodes", () => {
    const film = card("film", { url: "https://x.example/watch/7" });
    const episode = card("show:Dark", { url: "https://x.example/watch/9?s=1&e=3", season: 1, episode: 3 });
    expect(cardOf({ id: "m", title: "Film", url: "https://x.example/watch/7" }, [episode, film])).toBe(film);
    expect(cardOf({ id: "d", title: "Dark", url: "https://x.example/watch/9?s=2&e=1" }, [film, episode])).toBe(episode);
    expect(cardOf({ id: "o", title: "Other", url: "https://x.example/watch/8" }, [film, episode])).toBeUndefined();
  });

  it("tells films apart whose links differ only in the query, instead of giving one the watching of another", () => {
    const one = card("one", { url: "https://x.example/play?v=1" });
    const two = card("two", { url: "https://x.example/play?v=2" });
    expect(cardOf({ id: "b", title: "Two", url: "https://x.example/play?v=2" }, [one, two])).toBe(two);
    expect(cardOf({ id: "c", title: "Three", url: "https://x.example/play?v=3" }, [one, two])).toBeUndefined();
  });

  it("still takes the episodes of a show for one title when its links carry more than the season and the episode", () => {
    const episode = card("show:Dark", { url: "https://x.example/watch?id=9&s=1&e=3", season: 1, episode: 3 });
    expect(cardOf({ id: "d", title: "Dark", url: "https://x.example/watch?id=9&e=1&s=2" }, [episode])).toBe(episode);
    expect(cardOf({ id: "o", title: "Other", url: "https://x.example/watch?id=8&s=1&e=1" }, [episode])).toBeUndefined();
  });

  it("finds nothing for a link that is not whole", () => {
    expect(cardOf({ id: "r", title: "Relative", url: "/fixtures/sample.mp4" }, [card("a", { url: "/fixtures/sample.mp4" })])).toBeUndefined();
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

  it("takes a show on to the episode after the one it finished, from its start", () => {
    const next = card("show:Dark", { url: "https://x.example/watch/9?s=1&e=4", season: 1, episode: 4, position: 0, duration: 0 });
    const found = resumable({ id: "d", title: "Dark", url: "https://x.example/watch/9?s=1&e=1" }, [next]);
    expect(found.resumeUrl).toBe("https://x.example/watch/9?s=1&e=4");
    expect(found.startAt).toBeUndefined();
  });

  it("does not mistake a film for a show that has the same number in a place's links", () => {
    const show = card("show:Dark", { url: "https://x.example/watch/9?s=1&e=3", season: 1, episode: 3, position: 200, duration: 600 });
    const film = { id: "f", title: "Film", url: "https://x.example/watch/9", kind: "movie" as const };
    expect(resumable(film, [show])).toBe(film);
  });
});

describe("startOf", () => {
  const show = { id: "d", title: "Dark", url: "https://x.example/watch/9?s=1&e=1", kind: "series" as const };
  const left = card("show:Dark", { url: "https://x.example/watch/9?s=2&e=3", season: 2, episode: 3, position: 200, duration: 600 });

  it("is where the profile left the show, with the place in the episode", () => {
    expect(startOf(show, true, [left])).toEqual({ season: 2, episode: 3, url: "https://x.example/watch/9?s=2&e=3", startAt: 200 });
  });

  it("is the episode after the last finished one, from its start", () => {
    const next = { ...left, episode: 4, url: "https://x.example/watch/9?s=2&e=4", position: 0, duration: 0 };
    expect(startOf(show, true, [next])).toEqual({ season: 2, episode: 4, url: "https://x.example/watch/9?s=2&e=4" });
  });

  it("is the first episode of a show that was not started, which the title's own link plays", () => {
    expect(startOf(show, true, [])).toEqual({ season: 1, episode: 1, url: show.url });
    expect(startOf(show, true, [card("other")])).toEqual({ season: 1, episode: 1, url: show.url });
  });

  it("is nothing for what is not a show", () => {
    expect(startOf({ id: "f", title: "Film", url: "https://x.example/watch/7" }, false, [])).toBeUndefined();
    const film = card("film", { url: "https://x.example/watch/7", position: 300, duration: 1000 });
    expect(startOf({ id: "f", title: "Film", url: "https://x.example/watch/7" }, false, [film])).toBeUndefined();
  });
});

describe("what an entry says it is", () => {
  it("a library title keeps its kind, a card is a show when it has an episode, and a saved title does not say", () => {
    expect(rowsOfPage("movies", data({ rows: [row("m1", "movie")] }))[0]!.entries[0]!.kind).toBe("movie");
    expect(rowsOfPage("series", data({ rows: [row("s1", "series")] }))[0]!.entries[0]!.kind).toBe("series");
    const going = rowsOfPage("home", data({ progress: [card("film"), card("show:Dark", { season: 1, episode: 2 })] }))[0]!.entries;
    expect(going.map((entry) => entry.kind)).toEqual(["movie", "series"]);
    expect(rowsOfPage("home", data({ list: [saved("x")] })).find((each) => each.id === "list:favourites")!.entries[0]!.kind).toBeUndefined();
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

  it("offers Join and Dismiss for an invitation to a watch party, and Dismiss besides for a title a friend sent", () => {
    expect(heroActions({ id: "p", title: "Ann invites you", url: "", party: "123456", inboxId: "i1" })).toEqual(["join", "dismiss"]);
    expect(heroActions({ id: "r", title: "A", url: "u", inboxId: "i2" })).toEqual(["play", "list", "dismiss"]);
  });

  it("offers nothing for a tile that opens a screen over the library", () => {
    expect(heroActions({ id: "add", title: "Add a friend", url: "", action: "addFriend" })).toEqual([]);
    expect(heroActions({ id: "set", title: "Friends settings", url: "", action: "friendSettings" })).toEqual([]);
  });
});

describe("overviewActions", () => {
  it("offers Play, My List and Rate for any title, and Remove besides for a card of Continue watching", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" })).toEqual(["play", "list", "rate"]);
    expect(overviewActions({ id: "a", title: "A", url: "u", progressKey: "k" })).toEqual(["play", "list", "rate", "remove"]);
  });
  it("has no Rate for a profile that turned ratings off", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" }, false)).toEqual(["play", "list"]);
    expect(overviewActions({ id: "a", title: "A", url: "u", progressKey: "k" }, false)).toEqual(["play", "list", "remove"]);
  });
  it("offers Recommend only when friends are on, and only for a title that plays", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" }, true, true)).toEqual(["play", "list", "rate", "recommend"]);
    expect(overviewActions({ id: "a", title: "A", url: "u" }, false, true)).toEqual(["play", "list", "recommend"]);
    expect(overviewActions({ id: "a", title: "A", url: "u" }, true, false)).toEqual(["play", "list", "rate"]);
    expect(overviewActions({ id: "a", title: "A", url: "" }, true, true)).toEqual(["play", "list", "rate"]);
  });
  it("offers Dismiss besides for a title a friend sent", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u", inboxId: "i" }, true, true)).toEqual(["play", "list", "rate", "recommend", "dismiss"]);
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
