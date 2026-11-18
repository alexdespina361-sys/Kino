import { describe, expect, it } from "vitest";
import { DEFAULT_LIST, type LibraryItem, type LibraryRow, type LibrarySection, type ListInfo, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { t } from "../i18n";
import { askedTime, asOpened, backOf, cardOf, cardsToLookUp, episodeWindow, EPISODES_AT_ONCE, freshSimilar, gridOf, hasRows, heldStart, heroActions, isProfilePage, isRowsPage, listedWindow, ofSection, openedAt, overviewActions, playLabel, resumable, rowsOfPage, SECTION_FILTERS, sectionOfPage, shownList, startOf, viewKey, type HomeRow, type PageData } from "./pages";
import type { ChildGate } from "../shared/childGate";
import { episodeRows } from "./Episodes";

describe("a long season's episodes, 24 at a time", () => {
  it("lists a season of 24 or fewer whole, wherever Play leads", () => {
    expect(EPISODES_AT_ONCE).toBe(24);
    expect(episodeWindow(10, 7)).toEqual({ from: 0, to: 10 });
    expect(episodeWindow(24, 20)).toEqual({ from: 0, to: 24 });
    expect(episodeWindow(0, -1)).toEqual({ from: 0, to: 0 });
  });

  it("lists a longer one from the episode Play leads to (the one this profile is at, or a friend sent), full 24 when it is among the last; else the first 24", () => {
    expect(episodeWindow(366, -1)).toEqual({ from: 0, to: 24 }); // (nothing begun: the first)
    expect(episodeWindow(366, 0)).toEqual({ from: 0, to: 24 });
    expect(episodeWindow(366, 149)).toEqual({ from: 149, to: 173 }); // (at episode 150 of Bleach's 366: from it)
    expect(episodeWindow(366, 360)).toEqual({ from: 342, to: 366 }); // (near the end: the last 24, it among them)
    expect(episodeWindow(30, 20)).toEqual({ from: 6, to: 30 });
  });

  it("keeps what Show more and Show earlier widened it to while the episode Play leads to is in it, and starts again from it when it is not", () => {
    expect(listedWindow(366, 149, { from: 125, to: 197 })).toEqual({ from: 125, to: 197 });
    expect(listedWindow(366, 149, undefined)).toEqual({ from: 149, to: 173 });
    // (episode 197 was played to its end: Play leads to 198, out of what was listed)
    expect(listedWindow(366, 197, { from: 125, to: 197 })).toEqual({ from: 197, to: 221 });
    // (a season that came back shorter: what is past its end is not listed)
    expect(listedWindow(40, -1, { from: 0, to: 48 })).toEqual({ from: 0, to: 40 });
    expect(listedWindow(10, -1, { from: 24, to: 48 })).toEqual({ from: 0, to: 10 });
    // (the 24 that were listed from episode 40 - the page keeps them as its window - stay when Play moves on to 41: they do not slide by one, the judge, 17 Nov)
    expect(listedWindow(100, 40, { from: 39, to: 63 })).toEqual({ from: 39, to: 63 });
    expect(episodeWindow(100, 40)).toEqual({ from: 40, to: 64 });
  });

  it("is the remote's lines: Show earlier, the episodes so many across, Show more", () => {
    const shown = (count: number) => Array.from({ length: count }, () => ({}) as never);
    expect(episodeRows({ shown: shown(24), earlier: 149, later: 193 }, 2)).toEqual([1, ...Array(12).fill(2), 1]);
    expect(episodeRows({ shown: shown(5), earlier: 0, later: 0 }, 2)).toEqual([2, 2, 1]);
    expect(episodeRows({ shown: shown(24), earlier: 0, later: 342 }, 1)).toEqual([...Array(24).fill(1), 1]);
    expect(episodeRows({ shown: null, earlier: 0, later: 0 }, 2)).toEqual([]);
  });
});

const item = (id: string, kind?: "movie" | "series", extra: Partial<LibraryItem> = {}): LibraryItem => ({ id, title: `Title ${id}`, url: `https://x.example/${id}`, ...(kind ? { kind } : {}), ...extra });
const row = (id: string, kind: "movie" | "series" | undefined, count = 3, section?: "cartoon" | "anime"): LibraryRow => ({
  id,
  title: `Row ${id}`,
  source: "Test",
  ...(kind ? { kind } : {}),
  ...(section ? { section } : {}),
  items: Array.from({ length: count }, (_, i) => item(`${id}-${i}`, kind, { image: `poster-${id}-${i}`, backdrop: `wide-${id}-${i}`, ...(section ? { section } : {}) })),
});
const card = (key: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key, at: 1, title: `Card ${key}`, url: `https://x.example/${key}`, position: 100, duration: 1000, ...extra });
const saved = (key: string, list?: string): LiveListItem => ({ key, at: 1, id: key, title: `Saved ${key}`, url: `https://x.example/${key}`, ...(list ? { list } : {}) });

const rated = (key: string, score: number, ratedAt: number, extra: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${key}`, at: ratedAt, title: `Rated ${key}`, url: `https://x.example/${key}`, score, ratedAt, ...extra });

const FIRST: ListInfo = { id: DEFAULT_LIST };
const data = (overrides: Partial<PageData> = {}): PageData => ({ rows: [], all: overrides.rows ?? [], progress: [], lists: [FIRST], list: [], ratings: [], because: [], ...overrides });
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
    expect(["home", "movies", "series", "cartoons", "anime"].every((kind) => isRowsPage({ kind } as never))).toBe(true);
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
    expect(["home", "movies", "series", "cartoons", "anime"].every((kind) => hasRows({ kind } as never))).toBe(true);
    expect(["list", "history", "ratings", "search", "category", "categories", "friend"].some((kind) => hasRows({ kind } as never))).toBe(false);
  });

  it("names the profile's page, and counts it and the pages it holds as the profile's", () => {
    expect(viewKey({ kind: "profile" })).toBe("profile");
    expect(["profile", "ratings", "history", "friends", "friend"].every((kind) => isProfilePage({ kind } as never))).toBe(true);
    expect(["home", "movies", "series", "cartoons", "anime", "list", "search", "category", "categories"].some((kind) => isProfilePage({ kind } as never))).toBe(false);
  });

  it("says where Back goes from each page: one step out for the pages that are a step in, Home for the rest, nowhere from Home", () => {
    expect(backOf({ kind: "ratings" })).toEqual({ kind: "profile" });
    expect(backOf({ kind: "history" })).toEqual({ kind: "profile" });
    expect(backOf({ kind: "friends" })).toEqual({ kind: "profile" });
    expect(backOf({ kind: "friend", id: "f1" })).toEqual({ kind: "friends" });
    expect(backOf({ kind: "profile" })).toEqual({ kind: "home" });
    expect(backOf({ kind: "category", rowId: "r1", from: "categories" })).toEqual({ kind: "categories" });
    expect(backOf({ kind: "category", rowId: "r1" })).toEqual({ kind: "home" });
    for (const kind of ["movies", "series", "cartoons", "anime", "list", "search", "categories"] as const) expect(backOf({ kind })).toEqual({ kind: "home" });
    expect(backOf({ kind: "home" })).toBeNull();
  });
});

describe("rowsOfPage: home", () => {
  it("starts with what is part way through, then titles like the ones watched last or loved, then its lists, then the library", () => {
    const rows = rowsOfPage(
      "home",
      data({
        rows: library,
        progress: [card("a"), card("b", { done: true })],
        list: [saved("l1")],
        because: [
          { key: "https://x.example/a", title: "Card a", why: "watched", items: [item("sim")] },
          { key: "https://x.example/z", title: "Rated z", why: "loved", items: [item("sim2")] },
        ],
      }),
    );
    expect(rows.slice(0, 4).map((r) => r.id)).toEqual(["continue", "because:https://x.example/a", "because:https://x.example/z", `list:${DEFAULT_LIST}`]);
    expect(rows[0]!.entries.map((e) => e.title)).toEqual(["Card a"]); // the finished one is not part way through
    expect(rows[1]!.title).toBe(t("rows.because", { title: "Card a" }));
    expect(rows[2]!.title).toBe(t("rows.loved", { title: "Rated z" }));
    expect(rows.slice(4, 7).map((r) => r.id)).toEqual(["m1", "s1", "m2"]);
  });

  it("leaves out the rows this profile has nothing for", () => {
    const rows = rowsOfPage("home", data({ rows: library, because: [{ key: "k", title: "T", why: "watched", items: [] }] }));
    expect(rows[0]!.id).toBe("m1");
    expect(rows.map((r) => r.id)).not.toContain("continue");
    expect(rows.map((r) => r.id).some((id) => id.startsWith("list:"))).toBe(false);
    expect(rows.map((r) => r.id).some((id) => id.startsWith("because:"))).toBe(false);
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

  it("draws the second library row and every third after it as wide cards, with the categories still after the third, and nothing else", () => {
    const many = Array.from({ length: 8 }, (_, i) => row(`r${i}`, "movie", 20));
    const rows = rowsOfPage("home", data({ rows: many, progress: [], because: [{ key: "k", title: "T", why: "watched", items: [item("b")] }] }));
    expect(rows.map((each) => `${each.id}${each.shape ? "=" + each.shape : ""}`)).toEqual(["because:k", "r0", "r1=landscape", "r2", "categories", "r3", "r4=landscape", "r5", "r6", "r7=landscape"]);
    // (Its layout stays "wide": that is what a row that grows sideways is.)
    expect(rows.find((each) => each.id === "r1")!.layout).toBe("wide");
    // A section's page counts its own rows.
    expect(rowsOfPage("movies", data({ rows: many })).filter((each) => each.shape).map((each) => each.id)).toEqual(["r1", "r4", "r7"]);
  });

  it("puts a row of categories in after the third row, with an All categories tile once there are more than fit", () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`r${i}`, i % 2 ? "series" : "movie"));
    const rows = rowsOfPage("home", data({ rows: many }));
    expect(rows[3]).toMatchObject({ id: "categories", layout: "categories" });
    expect(rows[3]!.entries).toHaveLength(13);
    expect(rows[3]!.entries.at(-1)).toMatchObject({ title: t("tv.allCategories"), opens: { kind: "categories" } });
    expect(rows[3]!.entries[0]).toMatchObject({ title: "Row r0", opens: { kind: "category", rowId: "r0" }, image: "wide-r0-0" });
    expect(rows[3]!.entries[0]!.note).toBeUndefined(); // (no count of titles: a category goes on as it is scrolled, so the number was only what had come so far)
    // What is in a category is shown, not counted: the posters of its first three titles (a category of five still shows three), and the "All categories" tile says no number either.
    expect(rows[3]!.entries[0]!.posters).toEqual(["poster-r0-0", "poster-r0-1", "poster-r0-2"]);
    const five = rowsOfPage("home", data({ rows: Array.from({ length: 20 }, (_, i) => row(`r${i}`, "movie", 5)) }))[3]!;
    expect(five.entries[0]!.posters).toHaveLength(3);
    expect(five.entries.at(-1)!.note).toBeUndefined();
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

  it("has no list or because rows of its own: those are on Home", () => {
    const rows = rowsOfPage("movies", data({ rows: many, list: [saved("l")], because: [{ key: "k", title: "x", why: "watched", items: [item("s")] }] }));
    expect(rows.map((r) => r.id).some((id) => id.startsWith("list:"))).toBe(false);
    expect(rows.map((r) => r.id).some((id) => id.startsWith("because:"))).toBe(false);
  });

  it("is empty when the library has nothing of that kind (a source that does not say what its titles are)", () => {
    expect(rowsOfPage("movies", data({ rows: [row("x", undefined)] }))).toEqual([]);
  });
});

describe("rowsOfPage: the four sections", () => {
  const plain = Array.from({ length: 6 }, (_, i) => row(`r${i}`, i % 2 ? "series" : "movie"));
  // (a cartoon or an anime can be a film or a show: its section is said apart from its kind)
  const cartoons = Array.from({ length: 6 }, (_, i) => row(`c${i}`, i % 2 ? "series" : "movie", 3, "cartoon"));
  const anime = Array.from({ length: 6 }, (_, i) => row(`a${i}`, i % 2 ? "series" : "movie", 3, "anime"));
  const everything = [...plain, ...cartoons, ...anime];
  const titles = (page: Parameters<typeof rowsOfPage>[0], over: Partial<PageData> = {}) => rowsOfPage(page, data({ rows: everything, ...over }));
  const ids = (rows: ReturnType<typeof rowsOfPage>) => rows.filter((r) => r.layout !== "categories").map((r) => r.id);

  it("names the section each page is for, and none for Home", () => {
    expect(sectionOfPage("home")).toBeUndefined();
    expect(sectionOfPage("movies")).toBe("movie");
    expect(sectionOfPage("series")).toBe("series");
    expect(sectionOfPage("cartoons")).toBe("cartoon");
    expect(sectionOfPage("anime")).toBe("anime");
  });

  it("gives each page the rows of its own section only: a cartoon film is not on Movies, nor an anime show on Series", () => {
    expect(ids(titles("movies"))).toEqual(["r0", "r2", "r4"]);
    expect(ids(titles("series"))).toEqual(["r1", "r3", "r5"]);
    expect(ids(titles("cartoons"))).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    expect(ids(titles("anime"))).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
    // Home has them all
    expect(ids(titles("home"))).toEqual(everything.map((r) => r.id));
  });

  it("keeps what each title is (a film or a show) on its card, whichever section it is in", () => {
    const entries = titles("cartoons").filter((r) => r.layout !== "categories");
    expect(entries.find((r) => r.id === "c0")!.entries[0]!.kind).toBe("movie");
    expect(entries.find((r) => r.id === "c1")!.entries[0]!.kind).toBe("series");
  });

  it("offers only the categories of its section in its row of categories", () => {
    const categories = titles("anime").find((r) => r.id === "categories")!;
    expect(categories.entries.map((e) => e.title)).toEqual(["Row a0", "Row a1", "Row a2", "Row a3", "Row a4", "Row a5"]);
    expect(titles("cartoons").find((r) => r.id === "categories")!.entries.map((e) => e.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
  });

  it("puts what is part way through in the section the library lists its title in, whether it is a film or a show", () => {
    const progress = [
      card("c1-0", { season: 2, episode: 4, url: "https://x.example/c1-0?s=2&e=4&key=abc" }), // a cartoon show, its link carrying the marks of the episode
      card("c0-2"), // a cartoon film
      card("a1-2", { season: 1, episode: 1 }), // an anime show
      card("a0-0"), // an anime film
      card("r0-0"), // a film
      card("r1-1", { season: 3, episode: 1 }), // a show
      card("lost-film"), // not listed any more: a film is in Movies
      card("lost-show", { season: 1, episode: 1 }), // not listed any more: a show is in Series
    ];
    const going = (page: Parameters<typeof rowsOfPage>[0]) => {
      const first = titles(page, { progress })[0]!;
      return first.id === "continue" ? first.entries.map((e) => e.title).sort() : [];
    };
    expect(going("cartoons")).toEqual(["Card c0-2", "Card c1-0"]);
    expect(going("anime")).toEqual(["Card a0-0", "Card a1-2"]);
    expect(going("movies")).toEqual(["Card lost-film", "Card r0-0"]);
    expect(going("series")).toEqual(["Card lost-show", "Card r1-1"]);
    expect(going("home")).toHaveLength(8);
  });

  it("puts a card the rows do not list where the server said its title is, or where the one place it plays from has all its titles (anime was in Series: the owner's report of 15 Nov)", () => {
    const naruto = card("naruto", { season: 1, episode: 3, url: "https://filmpire.sc/watch/46260?s=1&e=3" });
    const unknown = card("mystery", { season: 1, episode: 1, url: "https://filmpire.sc/watch/999?s=1&e=1" });
    const heaven = card("heaven", { season: 1, episode: 2, url: "https://anime.example/watch/abc?ep=2" });
    const listed = card("listed", { url: "https://filmpire.sc/watch/555" });
    const animePlace: LibraryRow = { ...row("ah", "series", 1, "anime"), items: [item("ah-0", "series", { url: "https://anime.example/watch/zzz" })] };
    const films: LibraryRow = { ...row("fp", "movie", 1), items: [item("filmpire-movie-555", "movie", { url: "https://filmpire.sc/watch/555" })] };
    const rows = [...everything, animePlace, films];
    const progress = [naruto, unknown, heaven, listed];
    const looked = new Map<string, LibrarySection>([["tv-46260", "anime"]]);
    const going = (page: Parameters<typeof rowsOfPage>[0], over: Partial<PageData> = {}) => {
      const first = rowsOfPage(page, data({ rows, progress, ...over }))[0]!;
      return first.id === "continue" ? first.entries.map((e) => e.title).sort() : [];
    };
    // Before the server is asked: a show nobody lists is in Series (as it was), but one from a place of anime only is in Anime.
    expect(going("series")).toEqual(["Card mystery", "Card naruto"]);
    expect(going("anime")).toEqual(["Card heaven"]);
    expect(going("movies")).toEqual(["Card listed"]);
    // What the server said of it puts it where it belongs.
    expect(going("series", { looked })).toEqual(["Card mystery"]);
    expect(going("anime", { looked })).toEqual(["Card heaven", "Card naruto"]);
    // Only the titles nothing places yet are asked about, by their address, once.
    expect(cardsToLookUp(progress, rows, new Map())).toEqual(["tv-46260", "tv-999"]);
    expect(cardsToLookUp(progress, rows, looked)).toEqual(["tv-999"]);
    expect(cardsToLookUp([{ ...naruto, done: true }], rows, new Map())).toEqual([]); // (a finished one is in no row of the page)
  });

  it("has no list or because rows of its own, as Movies and Series have none: those are on Home", () => {
    for (const page of ["cartoons", "anime"] as const) {
      const rows = titles(page, { list: [saved("l")], because: [{ key: "k", title: "x", why: "watched", items: [item("s")] }] });
      expect(rows.map((r) => r.id).some((id) => id.startsWith("list:") || id.startsWith("because:")), page).toBe(false);
    }
  });

  it("is empty when the library has nothing of that section", () => {
    expect(rowsOfPage("cartoons", data({ rows: plain }))).toEqual([]);
    expect(rowsOfPage("anime", data({ rows: [...plain, ...cartoons] }))).toEqual([]);
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
    expect(gridOf({ kind: "category", rowId: "m1" }, one)!.meta).toBe(t("tv.movies")); // (a category's page says its section, never the catalog's name)
    expect(gridOf({ kind: "categories" }, one)!.entries.every((each) => each.source === undefined)).toBe(true);

    const two = data({ rows: [...library.slice(0, 5), { ...library[5]!, source: "Archive" }] });
    expect(rowsOfPage("home", two).find((each) => each.id === "s3")?.source).toBe("Archive");
    expect(gridOf({ kind: "category", rowId: "s3" }, two)!.meta).toBe(t("tv.series"));
    expect(gridOf({ kind: "categories" }, two)!.entries.map((each) => each.source)).toEqual(["Test", "Test", "Test", "Test", "Test", "Archive"]);
  });

  it("lists every category with those of films first and then those of shows, with no second line on a tile", () => {
    const all = gridOf({ kind: "categories" }, data({ rows: library }))!;
    expect(all.title).toBe(t("tv.allCategories"));
    expect(all.entries.map((e) => e.id)).toEqual(["m1", "m2", "m3", "s1", "s2", "s3"]);
    // (the owner, 18 Nov: only a few tiles had their section under their name, which read as a leftover; none has now)
    expect(all.entries.map((e) => e.note)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    // (one with no kind follows the others)
    const mixed = data({ rows: [row("x1", undefined), row("s1", "series"), row("m1", "movie")] });
    expect(gridOf({ kind: "categories" }, mixed)!.entries.map((e) => [e.id, e.note])).toEqual([
      ["m1", undefined],
      ["s1", undefined],
      ["x1", undefined],
    ]);
    expect(gridOf({ kind: "categories", of: "movie" }, data({ rows: library }))!.entries[0]?.note).toBeUndefined(); // (no count: a category goes on as it is scrolled)
  });

  it("does not say a category's section when its name says it, and gives each category a picture the ones before it do not have", () => {
    // (The judge, 16 Nov: "Trending Movies / Movies", and most film categories with the same week's hit for their picture.)
    const hit = item("hit", "movie", { image: "poster-hit", backdrop: "wide-hit" });
    const withHit = (id: string, title: string): LibraryRow => ({ ...row(id, "movie"), title, items: [hit, ...row(id, "movie").items] });
    const rows = [withHit("m1", `Trending ${t("tv.movies")}`), withHit("m2", "Action"), withHit("m3", "Drama"), row("s1", "series")];
    const all = gridOf({ kind: "categories" }, data({ rows }))!;
    expect(all.entries.map((e) => [e.id, e.note])).toEqual([
      ["m1", undefined],
      ["m2", undefined],
      ["m3", undefined],
      ["s1", undefined],
    ]);
    expect(gridOf({ kind: "category", rowId: "m2" }, data({ rows }))!.meta).toBe(t("tv.movies")); // (its own page still says)
    expect(all.entries.map((e) => e.image)).toEqual(["wide-hit", "wide-m2-0", "wide-m3-0", "wide-s1-0"]);
    expect(gridOf({ kind: "category", rowId: "m1" }, data({ rows }))!.meta).toBe("");
    const home = rowsOfPage("home", data({ rows: [...rows, ...library] })).find((each) => each.id === "categories")!;
    expect(new Set(home.entries.filter((e) => e.image).map((e) => e.image)).size).toBe(home.entries.filter((e) => e.image).length);
  });

  it("lists the categories of the cartoons and of the anime after those of films and shows, each saying which it is", () => {
    const rows = [row("a1", "series", 3, "anime"), row("c1", "movie", 3, "cartoon"), row("x1", undefined), row("s1", "series"), row("c2", "series", 3, "cartoon"), row("m1", "movie")];
    const all = gridOf({ kind: "categories" }, data({ rows }))!;
    expect(all.entries.map((e) => [e.id, e.note])).toEqual([
      ["m1", undefined],
      ["s1", undefined],
      ["c1", undefined],
      ["c2", undefined],
      ["a1", undefined],
      ["x1", undefined],
    ]);
    const cartoons = gridOf({ kind: "categories", of: "cartoon" }, data({ rows }))!;
    expect(cartoons.title).toBe(t("tv.cartoonCategories"));
    expect(cartoons.entries.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(cartoons.entries[0]?.note).toBeUndefined();
    const anime = gridOf({ kind: "categories", of: "anime" }, data({ rows }))!;
    expect(anime.title).toBe(t("tv.animeCategories"));
    expect(anime.entries.map((e) => e.id)).toEqual(["a1"]);
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

  it("is the ratings of one section or of one score when the page says so, a cartoon or an anime told by the rating or by where the library lists it", () => {
    const cartoon = { id: "c1", title: "Toons", url: "https://x.example/toon", kind: "movie" as const, section: "cartoon" as const };
    const rows = [{ id: "c", title: "Cartoons", source: "Test", kind: "movie" as const, section: "cartoon" as const, items: [cartoon] }];
    const ratings = [rated("film", 9, 100, { kind: "movie" }), rated("toon", 7, 200, { kind: "movie" }), rated("akira", 9, 300, { kind: "movie", section: "anime" }), rated("dark", 8, 400, { kind: "series" })];
    const of = (view: { kind: "ratings"; section?: "movie" | "series" | "cartoon" | "anime"; score?: number }) => gridOf(view, data({ rows, ratings }))!.entries.map((e) => e.title);
    expect(of({ kind: "ratings" })).toEqual(["Rated dark", "Rated akira", "Rated toon", "Rated film"]);
    expect(of({ kind: "ratings", section: "cartoon" })).toEqual(["Rated toon"]); // (the library lists its link as a cartoon's)
    expect(of({ kind: "ratings", section: "movie" })).toEqual(["Rated film"]);
    expect(of({ kind: "ratings", score: 9 })).toEqual(["Rated akira", "Rated film"]);
    expect(of({ kind: "ratings", section: "series", score: 9 })).toEqual(["Rated dark"]); // (no series was given a 9: the score is let go)
    expect(gridOf({ kind: "ratings", score: 9 }, data({ rows, ratings }))!.meta).toContain("9"); // (the count and the average are of what is shown)
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

describe("a title opened at what a link or a friend's message asks for", () => {
  const film = { id: "f", title: "Film", url: "https://x.example/watch/7", kind: "movie" as const };
  const show = { id: "d", title: "Dark", url: "https://x.example/watch/9?s=1&e=1", kind: "series" as const };
  const started = card("film", { url: "https://x.example/watch/7", position: 300, duration: 1000 });

  it("is a film from the time asked for, which no card of this profile's takes the place of; Play says so", () => {
    const opened = openedAt(film, { at: 754 });
    expect(opened).toEqual({ ...film, asked: { at: 754 }, startAt: 754 });
    expect(resumable(opened, [started])).toBe(opened);
    expect(askedTime(opened)).toBe(754);
    expect(playLabel(opened, undefined)).toBe(t("rows.playFrom", { time: "12:34" }));
    expect(playLabel(resumable(film, [started]), undefined)).toBe(t("rows.resume")); // (not asked: where it was left)
    expect(playLabel(film, undefined)).toBe(t("rows.play"));
  });

  it("is a show at the episode asked for, and the time in it; asks for nothing that is not there", () => {
    expect(openedAt(show, { season: 2, episode: 5, at: 61 })).toEqual({ ...show, asked: { season: 2, episode: 5, at: 61 } });
    expect(openedAt(show, { season: 2, episode: 5 })).toEqual({ ...show, asked: { season: 2, episode: 5 } });
    expect(openedAt(show, { at: 61 })).toBe(show); // (a time in a whole show is in nothing)
    expect(openedAt(film, { season: 2, episode: 5 })).toBe(film); // (a film has no episodes)
    expect(openedAt(film, {})).toBe(film);
    expect(openedAt(film, undefined)).toBe(film);
  });

  it("says the episode while it is looked up, and is forgotten when the page is opened again", () => {
    const opened = openedAt(show, { season: 2, episode: 5, at: 61 });
    expect(heldStart(opened)).toEqual({ season: 2, episode: 5, url: "", startAt: 61, asked: true });
    expect(playLabel(opened, heldStart(opened))).toBe(t("series.playFrom", { season: 2, episode: 5, time: "1:01" }));
    expect(playLabel(opened, { season: 2, episode: 5, url: "x" })).toBe(t("series.play", { season: 2, episode: 5 }));
    expect(playLabel(opened, { season: 2, episode: 5, url: "x", startAt: 61 })).toBe(t("series.resume", { season: 2, episode: 5 })); // (where this profile left it)
    expect(heldStart(show)).toBeUndefined();
    expect(asOpened(opened)).toEqual(show);
    expect(asOpened(openedAt(film, { at: 754 }))).toEqual(film);
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

  it("offers Ask to watch together for an invitation to a party that is over, and Start a party for a friend's request", () => {
    expect(heroActions({ id: "p", title: "Ann's party", url: "", ask: "pro_ann", inboxId: "i1" })).toEqual(["ask", "dismiss"]);
    expect(heroActions({ id: "t", title: "Ann wants to watch together", url: "", wants: "pro_ann", inboxId: "i3" })).toEqual(["start", "dismiss"]);
    // A plan to watch together is no film and has no buttons under the banner (pressing the tile asks yes or no); once its time has come it starts the party like a request.
    expect(heroActions({ id: "plan:i4", title: "Ann proposes to watch together", url: "", plan: "i4", inboxId: "i4" })).toEqual([]);
    expect(heroActions({ id: "plan:i5", title: "Time to watch with Ann", url: "", wants: "pro_ann", inboxId: "i5" })).toEqual(["start", "dismiss"]);
  });

  it("offers nothing for a tile that opens a screen over the library", () => {
    expect(heroActions({ id: "add", title: "Add a friend", url: "", action: "addFriend" })).toEqual([]);
    expect(heroActions({ id: "set", title: "Friends settings", url: "", action: "friendSettings" })).toEqual([]);
  });

  it("offers nothing for somebody who asks to be friends: they are no film to play or keep, and pressing the tile answers", () => {
    expect(heroActions({ id: "request:pro_bob", title: "Bob#1", url: "", request: { id: "pro_bob", name: "Bob", avatar: "cat", tag: 1 } })).toEqual([]);
  });
});

describe("overviewActions", () => {
  it("offers Play, My List and Rate for any title, and Remove besides for a card of Continue watching", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" })).toEqual(["play", "list", "rate"]);
    expect(overviewActions({ id: "a", title: "A", url: "u", progressKey: "k" })).toEqual(["play", "list", "rate", "remove"]);
  });
  it("has Other lists after My List when there are several lists, whatever lists the title is in", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u" }, true, false, false, true)).toEqual(["play", "list", "lists", "rate"]);
    expect(overviewActions({ id: "a", title: "A", url: "u" }, true, false, true, true)).toEqual(["play", "tv", "list", "lists", "rate"]);
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
    // (a phone or a tablet that is the screen can send the title to the TV instead, beside Play; not a title with nothing to send)
    expect(overviewActions({ id: "a", title: "A", url: "u" }, true, false, true)).toEqual(["play", "tv", "list", "rate"]);
    expect(overviewActions({ id: "a", title: "A", url: "" }, true, false, true)).toEqual(["play", "list", "rate"]);
  });
  it("offers Dismiss besides for a title a friend sent", () => {
    expect(overviewActions({ id: "a", title: "A", url: "u", inboxId: "i" }, true, true)).toEqual(["play", "list", "rate", "recommend", "dismiss"]);
  });
});

describe("ofSection", () => {
  const items = [item("m", "movie"), item("s", "series"), item("u"), item("cf", "movie", { section: "cartoon" }), item("cs", "series", { section: "cartoon" }), item("an", "series", { section: "anime" })];
  it("keeps everything for All, and only what says it is of that section otherwise", () => {
    expect(ofSection(items, "all").map((i) => i.id)).toEqual(["m", "s", "u", "cf", "cs", "an"]);
    expect(ofSection(items, "movie").map((i) => i.id)).toEqual(["m"]);
    expect(ofSection(items, "series").map((i) => i.id)).toEqual(["s"]);
    expect(ofSection(items, "cartoon").map((i) => i.id)).toEqual(["cf", "cs"]);
    expect(ofSection(items, "anime").map((i) => i.id)).toEqual(["an"]);
  });
  it("has a filter for each", () => {
    expect(SECTION_FILTERS).toEqual(["all", "movie", "series", "cartoon", "anime"]);
  });
});

describe("a child's profile (`PageData.child`)", () => {
  const gate = (allowed: readonly string[]): ChildGate => ({ allows: (entry) => allowed.includes(entry.id) });
  const cartoons: LibraryRow = { id: "c1", title: "Row c1", source: "Test", section: "cartoon", items: [item("kid", "movie", { section: "cartoon", kids: true }), item("grown", "movie", { section: "cartoon" })] };
  const anime: LibraryRow = { id: "a1", title: "Row a1", source: "Test", section: "anime", items: [item("anime-kid", "series", { section: "anime", kids: true })] };
  const grownOnly: LibraryRow = { id: "c2", title: "Row c2", source: "Test", section: "cartoon", items: [item("grown-2", "series", { section: "cartoon" })] };
  const movies = row("m1", "movie");
  const shelves = [movies, cartoons, anime, grownOnly];
  const ids = (rows: HomeRow[]) => rows.flatMap((each) => each.entries.map((entry) => entry.id));

  it("has the cartoons for children on every page of rows, Home too, and drops a row left with nothing", () => {
    for (const page of ["home", "movies", "series", "cartoons", "anime"] as const) {
      const rows = rowsOfPage(page, data({ rows: shelves, child: gate([]) }));
      expect(ids(rows), page).toEqual(["kid"]);
    }
    // (Any other profile is as it was.)
    expect(ids(rowsOfPage("home", data({ rows: shelves })))).toContain("grown");
  });

  it("shows of its own cards, saved titles, history and ratings only what its gate lets through", () => {
    const progress = [card("kid-card"), card("grown-card")];
    const allowed = gate(["kid-card", "kid-saved", "rate:kid-rated"]);
    const home = rowsOfPage("home", data({ rows: shelves, progress, child: allowed }));
    expect(home.find((each) => each.id === "continue")?.entries.map((entry) => entry.title)).toEqual(["Card kid-card"]);
    const all = { rows: shelves, all: shelves, progress, list: [saved("kid-saved"), saved("grown-saved")], ratings: [rated("kid-rated", 8, 2), rated("grown-rated", 9, 3)], child: allowed };
    expect(gridOf({ kind: "list" }, data(all))?.entries.map((entry) => entry.title)).toEqual(["Saved kid-saved"]);
    expect(gridOf({ kind: "history" }, data(all))?.entries.map((entry) => entry.title)).toEqual(["Card kid-card"]);
    expect(gridOf({ kind: "ratings" }, data(all))?.entries.map((entry) => entry.title)).toEqual(["Rated kid-rated"]);
  });

  it("has the Cartoons' categories only, and no other category however it is reached", () => {
    const all = data({ rows: shelves, all: shelves, child: gate([]) });
    const categories = gridOf({ kind: "categories", of: "movie" }, all);
    expect(categories?.title).toBe(t("tv.cartoonCategories"));
    expect(categories?.entries.map((entry) => entry.opens)).toEqual([{ kind: "category", rowId: "c1" }]);
    expect(gridOf({ kind: "category", rowId: "m1" }, all)).toBeNull();
    expect(gridOf({ kind: "category", rowId: "c2" }, all)).toBeNull(); // (a row of cartoons with none for children)
    expect(gridOf({ kind: "category", rowId: "c1" }, all)?.entries.map((entry) => entry.id)).toEqual(["kid"]);
  });
});