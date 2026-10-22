import { describe, expect, it, vi } from "vitest";
import { LibraryRowSchema } from "../../shared";
import { FILMPIRE_CATEGORIES, filmpireSource, MAX_PAGE, type FilmpireCategory } from "./filmpire";
import { sectionOfCategory } from "./shelves";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const mockCategories: FilmpireCategory[] = [
  { id: "test-movies", title: "Test Movies", path: "/movie/popular", type: "movie" },
  { id: "test-tv", title: "Test TV", path: "/tv/popular", type: "tv" },
];

describe("filmpireSource", () => {
  it("creates rows per category with valid watch URLs and images", async () => {
    const movieResults = [
      {
        id: 101,
        title: "Spider-Hero",
        release_date: "2023-12-01",
        poster_path: "/spider.jpg",
        overview: "A hero swinging through the city.",
      },
    ];
    const tvResults = [
      {
        id: 202,
        name: "Avatar Adventure",
        first_air_date: "2024-02-15",
        backdrop_path: "/avatar.jpg",
        overview: "An adventure in a magical world.",
      },
    ];

    const get = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/movie/popular")) {
        return json({ results: movieResults });
      }
      return json({ results: tvResults });
    });

    const source = filmpireSource({ categories: mockCategories, fetch: get as never });
    const rows = await source.load();

    expect(rows.map((r) => [r.id, r.title, r.source, r.kind])).toEqual([
      ["filmpire-test-movies", "Test Movies", "Filmpire", "movie"],
      ["filmpire-test-tv", "Test TV", "Filmpire", "series"],
    ]);

    expect(rows[0]!.items).toEqual([
      {
        id: "filmpire-movie-101",
        title: "Spider-Hero",
        year: 2023,
        image: "https://image.tmdb.org/t/p/w500/spider.jpg",
        description: "A hero swinging through the city.",
        kind: "movie",
        url: "https://filmpire.sc/watch/101",
      },
    ]);

    expect(rows[1]!.items).toEqual([
      {
        id: "filmpire-tv-202",
        title: "Avatar Adventure",
        year: 2024,
        image: "https://image.tmdb.org/t/p/w500/avatar.jpg",
        backdrop: "https://image.tmdb.org/t/p/w1280/avatar.jpg",
        description: "An adventure in a magical world.",
        kind: "series",
        url: "https://filmpire.sc/watch/202?s=1&e=1",
      },
    ]);

    for (const row of rows) {
      expect(LibraryRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it("filters out person entries and items without a title", async () => {
    const mixedResults = [
      { id: 1, media_type: "person", name: "Actor Person" },
      { id: 2, poster_path: "/no-title.jpg" },
      { id: 3, title: "   ", release_date: "2020-01-01" },
      { id: 4, title: "Valid Movie", release_date: "2021-05-10" },
      null,
      "unexpected-string",
    ];

    const get = vi.fn(async () => json({ results: mixedResults }));
    const source = filmpireSource({ categories: [mockCategories[0]!], fetch: get as never });
    const rows = await source.load();

    expect(rows[0]!.items).toHaveLength(1);
    expect(rows[0]!.items[0]!.title).toBe("Valid Movie");
    expect(rows[0]!.items[0]!.id).toBe("filmpire-movie-4");
  });

  it("leaves out titles that have not come out yet, in the rows and in a search; one with no date is kept", async () => {
    const results = [
      { id: 1, media_type: "movie", title: "Out Already", release_date: "2020-01-01" },
      { id: 2, media_type: "movie", title: "Not Yet", release_date: "2999-01-01" },
      { id: 3, media_type: "tv", name: "Show Not Yet", first_air_date: "2999-06-01" },
      { id: 4, media_type: "movie", title: "No Date At All" },
    ];
    const get = vi.fn(async () => json({ results }));
    const source = filmpireSource({ categories: [mockCategories[0]!], fetch: get as never });
    expect((await source.load())[0]!.items.map((item) => item.title)).toEqual(["Out Already", "No Date At All"]);
    expect((await source.search!("anything")).map((item) => item.title)).toEqual(["Out Already", "No Date At All"]);
  });

  it("returns partial rows when one category fails", async () => {
    const get = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/movie/popular")) {
        return json({}, 500);
      }
      return json({ results: [{ id: 202, name: "Show", first_air_date: "2022-01-01" }] });
    });

    const source = filmpireSource({ categories: mockCategories, fetch: get as never });
    const rows = await source.load();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Test TV");
  });

  it("throws when all categories fail so cache is kept", async () => {
    const get = vi.fn(async () => json({}, 503));
    const source = filmpireSource({ categories: mockCategories, fetch: get as never });
    await expect(source.load()).rejects.toThrow(/HTTP 503/);
  });

  it("exports a rich set of movie and series categories", async () => {
    const { FILMPIRE_CATEGORIES } = await import("./filmpire");
    expect(FILMPIRE_CATEGORIES.length).toBeGreaterThanOrEqual(20);
    const movieCats = FILMPIRE_CATEGORIES.filter((c) => c.type === "movie");
    const tvCats = FILMPIRE_CATEGORIES.filter((c) => c.type === "tv");
    expect(movieCats.length).toBeGreaterThanOrEqual(10);
    expect(tvCats.length).toBeGreaterThanOrEqual(8);
  });
});

describe("filmpireSource shelves and more", () => {
  const movie = (id: number, title: string, extra: object = {}) => ({ id, title, release_date: "1985-01-01", poster_path: "/p.jpg", ...extra });
  const shelf = (id: string, type: "movie" | "tv" = "movie"): FilmpireCategory => ({ id, title: id.toUpperCase(), path: `/discover/${type}?with_genres=1&sort_by=vote_count.desc`, type });
  /** Seven shelves in groups of one each, so that the plan is the order they are given in. */
  const groups = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id) => [shelf(id)]);
  /** TMDB answering a discover question with the titles of the shelf (by the `with_genres` it was asked for), page by page. */
  const answering = (results: (page: number, url: URL) => unknown[] | number, totalPages = 4) => {
    const asked: URL[] = [];
    const get = vi.fn(async (url: string | URL) => {
      const asking = new URL(String(url));
      asked.push(asking);
      const answer = results(Number(asking.searchParams.get("page")), asking);
      return typeof answer === "number" ? json({}, answer) : json({ results: answer, total_pages: totalPages });
    });
    return { asked, get };
  };

  it("brings the shelves five at a time from where the last ones ended, one page of each, and says where the next begin", async () => {
    const { asked, get } = answering(() => [movie(1, "A Title")]);
    const source = filmpireSource({ apiKey: "k", categories: [], shelves: groups, fetch: get as never });

    const first = await source.shelves!(undefined, 0);
    expect(first.rows.map((one) => [one.id, one.title, one.source, one.kind])).toEqual([1, 2, 3, 4, 5].map((n) => [`filmpire-s${n}`, `S${n}`, "Filmpire", "movie"]));
    expect(first.next).toBe(5);
    expect(asked).toHaveLength(5);
    for (const url of asked) {
      expect(url.pathname).toBe("/3/discover/movie");
      expect(url.searchParams.getAll("page")).toEqual(["1"]);
      expect(url.searchParams.get("with_genres")).toBe("1");
      expect(url.searchParams.get("sort_by")).toBe("vote_count.desc");
    }
    for (const one of first.rows) expect(LibraryRowSchema.safeParse(one).success).toBe(true);

    const last = await source.shelves!(undefined, 5);
    expect(last.rows.map((one) => one.id)).toEqual(["filmpire-s6", "filmpire-s7"]);
    expect(last.next).toBeNull();
    expect(await source.shelves!(undefined, 7)).toEqual({ rows: [], next: null });
    expect(asked).toHaveLength(7);
  });

  it("brings only films or only series when asked", async () => {
    const mixed = [[shelf("m1")], [shelf("t1", "tv")], [shelf("m2")], [shelf("t2", "tv")]];
    const { get } = answering(() => [movie(1, "A Title", { first_air_date: "1985-01-01" })]);
    const source = filmpireSource({ categories: [], shelves: mixed, fetch: get as never });
    expect((await source.shelves!("series", 0)).rows.map((one) => one.id)).toEqual(["filmpire-t1", "filmpire-t2"]);
    expect((await source.shelves!("movie", 0)).rows.map((one) => [one.id, one.kind])).toEqual([["filmpire-m1", "movie"], ["filmpire-m2", "movie"]]);
  });

  it("leaves out a shelf that has nothing to show or cannot be had, and fails only when none could", async () => {
    let count = 0;
    const get = vi.fn(async () => {
      count++; // (the five are asked in the order of the shelves)
      if (count === 2) return json({}, 500); // (one that cannot be had)
      if (count === 3) return json({ results: [], total_pages: 0 }); // (one with nothing in it)
      return json({ results: [movie(count, `Fine ${count}`)], total_pages: 3 });
    });
    const source = filmpireSource({ categories: [], shelves: groups, fetch: get as never });
    const answer = await source.shelves!(undefined, 0);
    expect(answer.rows.map((one) => one.id)).toEqual(["filmpire-s1", "filmpire-s4", "filmpire-s5"]);
    expect(answer.next).toBe(5);

    const down = filmpireSource({ categories: [], shelves: groups, fetch: (async () => json({}, 503)) as never });
    await expect(down.shelves!(undefined, 0)).rejects.toThrow(/HTTP 503/);
  });

  it("leaves out rubbish, titles not out yet and what is not a title, in the shelves and in the pages after them", async () => {
    const results = [
      movie(1, "Fine", { vote_count: 900 }),
      { id: 2, title: "Official Podcast", release_date: "1990-01-01", poster_path: "/p.jpg" },
      { id: 3, title: "Stub", release_date: "1990-01-01", vote_count: 0, popularity: 0.1 },
      { id: 4, title: "Future", release_date: "2999-01-01", poster_path: "/p.jpg" },
      { id: 5, media_type: "person", name: "Someone" },
    ];
    const { get } = answering(() => results);
    const source = filmpireSource({ categories: [], shelves: [[shelf("s1")]], fetch: get as never, filterTrash: true });
    expect((await source.shelves!(undefined, 0)).rows[0]!.items.map((one) => one.title)).toEqual(["Fine"]);
    expect((await source.more!("filmpire-s1", 2)).items.map((one) => one.title)).toEqual(["Fine"]);
  });

  it("brings the next pages of a shelf, or of a first category, up to the fifteenth, and says when there are no more", async () => {
    const { asked, get } = answering((page) => [movie(page * 10, `Page ${page}`)], 3);
    const source = filmpireSource({ categories: [{ id: "pop", title: "Pop", path: "/movie/popular?language=en-US&page=1", type: "movie" }], shelves: groups, fetch: get as never });

    expect(await source.more!("filmpire-s1", 2)).toEqual({ items: [expect.objectContaining({ id: "filmpire-movie-20", title: "Page 2" })], last: false });
    expect((await source.more!("filmpire-s1", 3)).last).toBe(true); // (TMDB has three pages of it)
    expect((await source.more!("filmpire-pop", 2)).items.map((one) => one.title)).toEqual(["Page 2"]);
    expect(asked.map((url) => url.searchParams.getAll("page"))).toEqual([["2"], ["3"], ["2"]]); // (once, whatever the path said)
    expect(asked[2]!.pathname).toBe("/3/movie/popular");
    expect(asked[2]!.searchParams.get("language")).toBe("en-US");

    const deep = answering((page) => [movie(page, `Page ${page}`)], 500);
    const wide = filmpireSource({ categories: [], shelves: groups, fetch: deep.get as never });
    expect((await wide.more!("filmpire-s1", MAX_PAGE)).last).toBe(true); // (TMDB would go on; the shelf does not)
    expect(await wide.more!("filmpire-s1", MAX_PAGE + 1)).toEqual({ items: [], last: true });
    expect(deep.asked).toHaveLength(1);
  });

  it("knows nothing of a row it does not have, or of the first page, and asks nobody", async () => {
    const get = vi.fn();
    const source = filmpireSource({ categories: [], shelves: groups, fetch: get as never });
    expect(await source.more!("filmpire-nothing", 2)).toEqual({ items: [], last: true });
    expect(await source.more!("s1", 2)).toEqual({ items: [], last: true }); // (a row's id on the wire has "filmpire-" in front)
    expect(await source.more!("filmpire-s1", 1)).toEqual({ items: [], last: true });
    expect(get).not.toHaveBeenCalled();
  });

  it("fails when a page cannot be had, so that nothing is remembered of it", async () => {
    const source = filmpireSource({ categories: [], shelves: groups, fetch: (async () => json({}, 502)) as never });
    await expect(source.more!("filmpire-s1", 2)).rejects.toThrow(/HTTP 502/);
    const odd = filmpireSource({ categories: [], shelves: groups, fetch: (async () => json({ nope: true })) as never });
    await expect(odd.more!("filmpire-s1", 2)).rejects.toThrow();
  });

  it("asks for the first page of a first category as it always did, with the page once and the key", async () => {
    const { asked, get } = answering(() => [movie(1, "Fine")]);
    const source = filmpireSource({
      apiKey: "k",
      categories: [
        { id: "a", title: "A", path: "/trending/movie/week", type: "movie" },
        { id: "b", title: "B", path: "/movie/popular?language=en-US&page=1", type: "movie" },
        { id: "c", title: "C", path: "/discover/movie?with_genres=28&sort_by=popularity.desc", type: "movie" },
      ],
      fetch: get as never,
    });
    expect((await source.load()).map((one) => one.id)).toEqual(["filmpire-a", "filmpire-b", "filmpire-c"]);
    expect(asked.map((url) => [url.pathname, url.searchParams.getAll("page"), url.searchParams.get("api_key")])).toEqual([
      ["/3/trending/movie/week", ["1"], "k"],
      ["/3/movie/popular", ["1"], "k"],
      ["/3/discover/movie", ["1"], "k"],
    ]);
  });
});

describe("filmpireSource sections", () => {
  const film = (id: number, title: string, extra: object = {}) => ({ id, title, release_date: "2001-01-01", poster_path: "/p.jpg", ...extra });
  const show = (id: number, name: string, extra: object = {}) => ({ id, name, first_air_date: "2001-01-01", poster_path: "/p.jpg", ...extra });
  const ANIMATION = 16;
  const live = film(1, "Live Film", { genre_ids: [28], original_language: "en" });
  const toon = film(2, "Toon Film", { genre_ids: [ANIMATION, 35], original_language: "en" });
  const manga = film(3, "Manga Film", { genre_ids: [ANIMATION, 14], original_language: "ja" });
  /** English in its title and its language, but made in Japan: an anime all the same. */
  const madeInJapan = film(4, "Made In Japan", { genre_ids: [ANIMATION], original_language: "en", origin_country: ["JP"] });
  /** Animated, but not Japanese: a cartoon, as a Korean or a French one is. */
  const koreanToon = film(5, "Korean Toon", { genre_ids: [ANIMATION], original_language: "ko", origin_country: ["KR"] });
  /** TMDB gave no genres for it. */
  const unknown = film(6, "No Genres");
  const films = [live, toon, manga, madeInJapan, koreanToon, unknown];
  const liveShow = show(10, "Live Show", { genre_ids: [18], original_language: "en" });
  const toonShow = show(11, "Toon Show", { genre_ids: [ANIMATION, 35], original_language: "en", origin_country: ["US"] });
  const animeShow = show(12, "Anime Show", { genre_ids: [ANIMATION, 10759], original_language: "ja", origin_country: ["JP"] });
  const shows = [liveShow, toonShow, animeShow];
  const titlesOf = (row: { items: Array<{ title: string }> }) => row.items.map((one) => one.title);
  /** TMDB answering a question about a show with the shows and about a film with the films. */
  const tmdb = () => vi.fn(async (url: string | URL) => json({ results: String(url).includes("/tv") ? shows : films, total_pages: 3 }));
  const shelf = (id: string, type: "movie" | "tv", section?: "cartoon" | "anime"): FilmpireCategory => ({ id, title: id.toUpperCase(), path: `/discover/${type}?with_genres=1&sort_by=vote_count.desc`, type, ...(section ? { section } : {}) });

  it("tells a cartoon from an anime and from a film or a show by the genres, the language and the country of a title, saying the section only for the first two", async () => {
    const get = vi.fn(async () => json({ results: [...films, ...shows] }));
    const results = await filmpireSource({ fetch: get as never }).search!("anything");
    expect(results.map((one) => [one.title, one.kind, one.section]).sort()).toEqual(
      [
        ["Live Film", "movie", undefined],
        ["Toon Film", "movie", "cartoon"],
        ["Manga Film", "movie", "anime"],
        ["Made In Japan", "movie", "anime"],
        ["Korean Toon", "movie", "cartoon"],
        ["No Genres", "movie", undefined],
        ["Live Show", "series", undefined],
        ["Toon Show", "series", "cartoon"],
        ["Anime Show", "series", "anime"],
      ].sort(),
    );
  });

  it("puts only the titles of a category's own section in its row: the film that is a cartoon is not among the movies, nor the anime among the cartoons", async () => {
    const categories: FilmpireCategory[] = [
      { id: "pop", title: "Pop", path: "/movie/popular", type: "movie" },
      { id: "toons", title: "Toons", path: "/discover/movie?with_genres=16", type: "movie", section: "cartoon" },
      { id: "manga", title: "Manga", path: "/discover/movie?with_genres=16&with_original_language=ja", type: "movie", section: "anime" },
      { id: "pop-tv", title: "Pop TV", path: "/tv/popular", type: "tv" },
      { id: "toons-tv", title: "Toons TV", path: "/discover/tv?with_genres=16", type: "tv", section: "cartoon" },
      { id: "manga-tv", title: "Manga TV", path: "/discover/tv?with_genres=16&with_original_language=ja", type: "tv", section: "anime" },
    ];
    const rows = await filmpireSource({ categories, fetch: tmdb() as never }).load();
    expect(rows.map((one) => [one.id, one.kind, one.section, titlesOf(one)])).toEqual([
      ["filmpire-pop", "movie", undefined, ["Live Film", "No Genres"]],
      ["filmpire-toons", "movie", "cartoon", ["Toon Film", "Korean Toon"]],
      ["filmpire-manga", "movie", "anime", ["Manga Film", "Made In Japan"]],
      ["filmpire-pop-tv", "series", undefined, ["Live Show"]],
      ["filmpire-toons-tv", "series", "cartoon", ["Toon Show"]],
      ["filmpire-manga-tv", "series", "anime", ["Anime Show"]],
    ]);
    for (const row of rows) expect(LibraryRowSchema.safeParse(row).success, row.id).toBe(true);
    // (a title says its section too, apart from what it is, a film or a show)
    expect(rows[1]!.items[0]).toMatchObject({ kind: "movie", section: "cartoon" });
    expect(rows[5]!.items[0]).toMatchObject({ kind: "series", section: "anime" });
    expect(rows[0]!.items[0]!.section).toBeUndefined();
  });

  it("brings the shelves of one section at a time, each with only the titles of that section, and Home's from all of them", async () => {
    const groups = [[shelf("m1", "movie")], [shelf("t1", "tv")], [shelf("c1", "movie", "cartoon")], [shelf("c2", "tv", "cartoon")], [shelf("a1", "movie", "anime")]];
    const source = filmpireSource({ categories: [], shelves: groups, fetch: tmdb() as never });
    const ofSection = async (section: Parameters<NonNullable<typeof source.shelves>>[0]) => (await source.shelves!(section, 0)).rows.map((one) => [one.id, one.section, titlesOf(one)]);
    expect(await ofSection("movie")).toEqual([["filmpire-m1", undefined, ["Live Film", "No Genres"]]]);
    expect(await ofSection("series")).toEqual([["filmpire-t1", undefined, ["Live Show"]]]);
    expect(await ofSection("cartoon")).toEqual([
      ["filmpire-c1", "cartoon", ["Toon Film", "Korean Toon"]],
      ["filmpire-c2", "cartoon", ["Toon Show"]],
    ]);
    expect(await ofSection("anime")).toEqual([["filmpire-a1", "anime", ["Manga Film", "Made In Japan"]]]);
    expect((await ofSection(undefined)).map(([id]) => id)).toEqual(["filmpire-m1", "filmpire-t1", "filmpire-c1", "filmpire-c2", "filmpire-a1"]);
    // (each section has its own place to go on from)
    expect((await source.shelves!("cartoon", 0)).next).toBeNull();
    expect((await source.shelves!(undefined, 0)).next).toBeNull();
  });

  it("brings the next pages of a shelf with only the titles of its section", async () => {
    const source = filmpireSource({ categories: [], shelves: [[shelf("c1", "movie", "cartoon")], [shelf("a1", "movie", "anime")], [shelf("m1", "movie")]], fetch: tmdb() as never });
    expect(titlesOf(await source.more!("filmpire-c1", 2))).toEqual(["Toon Film", "Korean Toon"]);
    expect(titlesOf(await source.more!("filmpire-a1", 2))).toEqual(["Manga Film", "Made In Japan"]);
    expect(titlesOf(await source.more!("filmpire-m1", 2))).toEqual(["Live Film", "No Genres"]);
  });

  it("leaves a shelf out of its page when TMDB had nothing of its section to show for it", async () => {
    const onlyLive = vi.fn(async () => json({ results: [live, liveShow], total_pages: 3 }));
    const source = filmpireSource({ categories: [], shelves: [[shelf("c1", "movie", "cartoon")], [shelf("m1", "movie")]], fetch: onlyLive as never });
    expect((await source.shelves!(undefined, 0)).rows.map((one) => one.id)).toEqual(["filmpire-m1"]);
  });

  it("lists the first rows of every section, the animated ones asked for animation and the live-action ones for none", () => {
    const params = (cat: FilmpireCategory) => new URLSearchParams(cat.path.split("?")[1]);
    const genres = (value: string | null) => (value ?? "").split(",");
    const of = (section: string) => FILMPIRE_CATEGORIES.filter((cat) => sectionOfCategory(cat) === section);
    expect(of("movie").length).toBeGreaterThanOrEqual(10);
    expect(of("series").length).toBeGreaterThanOrEqual(8);
    expect(of("cartoon").length).toBeGreaterThanOrEqual(4);
    expect(of("anime").length).toBeGreaterThanOrEqual(4);
    expect(of("cartoon").some((cat) => cat.type === "movie") && of("cartoon").some((cat) => cat.type === "tv")).toBe(true);
    expect(of("anime").some((cat) => cat.type === "movie") && of("anime").some((cat) => cat.type === "tv")).toBe(true);
    for (const cat of FILMPIRE_CATEGORIES) {
      const own = sectionOfCategory(cat);
      if (own === "movie" || own === "series") {
        expect(cat.type, cat.id).toBe(own === "movie" ? "movie" : "tv");
        // (the lists TMDB can sort by genre are asked for none of it; its trending, popular and top lists cannot be, and are sifted when they come)
        if (cat.path.startsWith("/discover")) expect(genres(params(cat).get("without_genres")), cat.id).toContain("16");
      } else {
        expect(genres(params(cat).get("with_genres")), cat.id).toContain("16");
        expect(params(cat).get("with_original_language") === "ja", cat.id).toBe(own === "anime");
      }
    }
  });

  it("has no cartoon or anime among the movies, series, trending, popular and top rated lists TMDB cannot sift (they are sifted here)", async () => {
    // a trending list of TMDB with a cartoon among its films: the Movies row leaves it out, the cartoon row (which asked for animation) has it
    const trending: FilmpireCategory[] = [
      { id: "trending-movies", title: "Trending Movies", path: "/trending/movie/week", type: "movie" },
      { id: "cartoon-movies", title: "Cartoon Movies", path: "/discover/movie?with_genres=16", type: "movie", section: "cartoon" },
    ];
    const rows = await filmpireSource({ categories: trending, fetch: tmdb() as never }).load();
    expect(rows.find((one) => one.id === "filmpire-trending-movies")!.items.some((one) => one.section !== undefined)).toBe(false);
    expect(titlesOf(rows.find((one) => one.id === "filmpire-cartoon-movies")!)).toEqual(["Toon Film", "Korean Toon"]);
  });
});

describe("filmpireSource search", () => {
  it("searches TMDB multi and formats movies and series correctly", async () => {
    const searchResults = [
      { id: 10, media_type: "movie", title: "Spider-Man", release_date: "2002-05-03" },
      { id: 20, media_type: "tv", name: "Spider-Man TAS", first_air_date: "1994-11-19" },
      { id: 30, media_type: "person", name: "Tobey Maguire" },
    ];

    const get = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/search/multi");
      expect(String(url)).toContain("query=spider");
      return json({ results: searchResults });
    });

    const source = filmpireSource({ fetch: get as never });
    const results = await source.search!("spider");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "filmpire-movie-10",
      title: "Spider-Man",
      year: 2002,
      kind: "movie",
      url: "https://filmpire.sc/watch/10",
    });
    expect(results[1]).toEqual({
      id: "filmpire-tv-20",
      title: "Spider-Man TAS",
      year: 1994,
      kind: "series",
      url: "https://filmpire.sc/watch/20?s=1&e=1",
    });
  });

  it("returns empty array on blank query or network error", async () => {
    const get = vi.fn(async () => json({}, 500));
    const source = filmpireSource({ fetch: get as never });

    expect(await source.search!("")).toEqual([]);
    expect(await source.search!("   ")).toEqual([]);
    expect(await source.search!("error-trigger")).toEqual([]);
  });

  it("drops unplayable titles (404) and keeps playable ones when verifyPlayback is active", async () => {
    const searchResults = [
      { id: 101, media_type: "movie", title: "Playable Movie", release_date: "2022-01-01", poster_path: "/p1.jpg" },
      { id: 102, media_type: "movie", title: "Unplayable Movie", release_date: "2022-01-01", poster_path: "/p2.jpg" },
      { id: 201, media_type: "tv", name: "Playable Show", first_air_date: "2022-01-01", poster_path: "/p3.jpg" },
    ];

    const getTmdb = vi.fn(async () => json({ results: searchResults }));
    const probe = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("tmdb=101")) {
        return json({ status_code: "200", data: { title: "Playable Movie" } });
      }
      if (urlStr.includes("tmdb=102")) {
        return json({ status_code: 404 });
      }
      if (urlStr.includes("tmdb=201")) {
        return json({ status_code: "200", data: { title: "Playable Show", eps: { "1": ["1", "2"], "2": ["1"] } } });
      }
      return json({}, 404);
    });

    const source = filmpireSource({ fetch: getTmdb as never, probeFetch: probe as never, verifyPlayback: true });
    const results = await source.search!("query");

    expect(results.map((r) => r.title)).toEqual(["Playable Movie", "Playable Show"]);
    expect(probe).toHaveBeenCalledTimes(3);

    // Verify seasons was preloaded from the probe response without querying TMDB!
    const seasons = await source.seasons!("https://filmpire.sc/watch/201?s=1&e=1");
    expect(seasons).toEqual([1, 2]);
    // TMDB was only called once for the search, NOT called for seasons!
    expect(getTmdb).toHaveBeenCalledTimes(1);
  });

  it("filters out trash entries like podcasts and zero-vote posterless stubs", async () => {
    const mixedResults = [
      { id: 1, media_type: "tv", name: "Valid Show", first_air_date: "2022-01-01", poster_path: "/valid.jpg", vote_count: 50 },
      { id: 2, media_type: "tv", name: "Show Official Podcast", first_air_date: "2022-01-01", poster_path: "/pod.jpg" },
      { id: 3, media_type: "movie", title: "Zero Vote Stub", release_date: "2022-01-01", vote_count: 0, popularity: 0.2 },
    ];

    const getTmdb = vi.fn(async () => json({ results: mixedResults }));
    const probe = vi.fn(async () => json({ status_code: "200", data: { title: "Valid" } }));

    const source = filmpireSource({ fetch: getTmdb as never, probeFetch: probe as never, verifyPlayback: true, filterTrash: true });
    const results = await source.search!("query");

    expect(results.map((r) => r.title)).toEqual(["Valid Show"]);
  });

  describe("with more than one page of answers", () => {
    const movie = (id: number, title: string) => ({ id, media_type: "movie", title, release_date: "2020-01-01", poster_path: "/p.jpg" });
    /** TMDB answering `search/multi` page by page, and the pages asked for. */
    const pages = (answers: Record<number, unknown[] | number>, total: number) => {
      const asked: number[] = [];
      const get = vi.fn(async (url: string | URL) => {
        const page = Number(new URL(String(url)).searchParams.get("page"));
        asked.push(page);
        const answer = answers[page];
        return typeof answer === "number" ? json({}, answer) : json({ results: answer ?? [], total_pages: total });
      });
      return { asked, get };
    };

    it("reads the next pages (three at most) when TMDB says there are more, and a title once", async () => {
      const { asked, get } = pages(
        { 1: [movie(1, "Boon"), movie(2, "Boonie Bears")], 2: [movie(2, "Boonie Bears"), movie(3, "The Boondocks")], 3: [movie(4, "Boonville")], 4: [movie(5, "Too Far")] },
        9,
      );
      const results = await filmpireSource({ fetch: get as never }).search!("boon");
      expect(results.map((r) => r.title)).toEqual(["Boon", "Boonie Bears", "The Boondocks", "Boonville"]);
      expect(asked.sort()).toEqual([1, 2, 3]);
    });

    it("asks for no more pages than TMDB has", async () => {
      const { asked, get } = pages({ 1: [movie(1, "Boon")], 2: [movie(2, "Boonie Bears")] }, 2);
      const results = await filmpireSource({ fetch: get as never }).search!("boon");
      expect(results.map((r) => r.title)).toEqual(["Boon", "Boonie Bears"]);
      expect(asked.sort()).toEqual([1, 2]);
    });

    it("leaves out a later page that cannot be had, and answers nothing when the first cannot", async () => {
      const bad = pages({ 1: [movie(1, "Boon")], 2: 500, 3: [movie(3, "The Boondocks")] }, 3);
      expect((await filmpireSource({ fetch: bad.get as never }).search!("boon")).map((r) => r.title)).toEqual(["Boon", "The Boondocks"]);
      const none = pages({ 1: 500, 2: [movie(2, "Boonie Bears")] }, 3);
      expect(await filmpireSource({ fetch: none.get as never }).search!("boon")).toEqual([]);
    });

    it("asks the provider about the first page only, but keeps out what it was already found to lack", async () => {
      const probe = vi.fn(async (url: string | URL) => json(String(url).includes("tmdb=102") ? { status_code: 404 } : { status_code: "200", data: {} }));
      const first = pages({ 1: [movie(102, "Gone")] }, 1);
      const source = filmpireSource({ fetch: first.get as never, probeFetch: probe as never, verifyPlayback: true });
      expect(await source.search!("gone")).toEqual([]);
      expect(probe).toHaveBeenCalledTimes(1);

      // (the same source, a later question: 102 is known to lack a video; 103 was never asked about and is not now)
      first.get.mockImplementation(async (url: string | URL) => {
        const page = Number(new URL(String(url)).searchParams.get("page"));
        return json({ results: page === 1 ? [movie(101, "Here")] : [movie(102, "Gone"), movie(103, "Never Asked")], total_pages: 2 });
      });
      expect((await source.search!("here")).map((r) => r.title)).toEqual(["Here", "Never Asked"]);
      expect(probe).toHaveBeenCalledTimes(2); // (101 only)
    });
  });

  it("fails open when playback probe times out or has a network glitch", async () => {
    const searchResults = [
      { id: 101, media_type: "movie", title: "Glitchy Movie", release_date: "2022-01-01", poster_path: "/p.jpg" },
    ];
    const getTmdb = vi.fn(async () => json({ results: searchResults }));
    const brokenProbe = vi.fn(async () => Promise.reject(new Error("network error")));

    const source = filmpireSource({ fetch: getTmdb as never, probeFetch: brokenProbe as never, verifyPlayback: true });
    const results = await source.search!("query");

    // Fails open: title is preserved
    expect(results.map((r) => r.title)).toEqual(["Glitchy Movie"]);
  });
});

describe("filmpireSource similar", () => {
  it("asks TMDB for the recommendations of the film or show a Filmpire link plays", async () => {
    const asked: string[] = [];
    const get = vi.fn(async (url: string | URL) => {
      asked.push(String(url));
      return json({ results: [{ id: 7, title: "Next Film", release_date: "2020-01-01", backdrop_path: "/b.jpg" }] });
    });
    const source = filmpireSource({ apiKey: "k", fetch: get as never });

    const film = await source.similar!("https://filmpire.sc/watch/603");
    expect(asked[0]).toContain("/movie/603/recommendations");
    expect(film).toEqual([
      { id: "filmpire-movie-7", title: "Next Film", year: 2020, image: "https://image.tmdb.org/t/p/w500/b.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/b.jpg", kind: "movie", url: "https://filmpire.sc/watch/7" },
    ]);

    await source.similar!("https://filmpire.sc/watch/1399?s=2&e=5");
    expect(asked[1]).toContain("/tv/1399/recommendations");
  });

  it("knows nothing about links that are not Filmpire's, and says so without asking anyone", async () => {
    const get = vi.fn();
    const source = filmpireSource({ fetch: get as never });
    expect(await source.similar!("https://other.example/watch/603")).toEqual([]);
    expect(await source.similar!("https://filmpire.sc/somewhere/603")).toEqual([]);
    expect(await source.similar!("not a link")).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("gives nothing for a title TMDB does not know, and fails when TMDB cannot be reached, so that nothing is remembered of it", async () => {
    const link = "https://filmpire.sc/watch/603";
    expect(await filmpireSource({ fetch: (async () => json({}, 404)) as never }).similar!(link)).toEqual([]);
    await expect(filmpireSource({ fetch: (async () => json({}, 500)) as never }).similar!(link)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => json({ nope: true })) as never }).similar!(link)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => Promise.reject(new Error("offline"))) as never }).similar!(link)).rejects.toThrow();
  });
});

describe("filmpireSource episodes", () => {
  it("asks TMDB for one season of the show a Filmpire link plays, and keeps what is known of each episode", async () => {
    const asked: string[] = [];
    const get = vi.fn(async (url: string | URL) => {
      asked.push(String(url));
      return json({
        episodes: [
          { season_number: 2, episode_number: 1, name: "  Pilot ", overview: "It begins.", still_path: "/s1.jpg", runtime: 47 },
          { season_number: 2, episode_number: 2, name: "", overview: "", still_path: null, runtime: null },
        ],
      });
    });
    const source = filmpireSource({ apiKey: "k", fetch: get as never });

    const season = await source.episodes!("https://filmpire.sc/watch/1399?s=2&e=5", 2);
    expect(asked[0]).toContain("/tv/1399/season/2?");
    expect(season).toEqual([
      { season: 2, episode: 1, title: "Pilot", overview: "It begins.", still: "https://image.tmdb.org/t/p/w300/s1.jpg", runtime: 47, url: "https://filmpire.sc/watch/1399?s=2&e=1" },
      { season: 2, episode: 2, url: "https://filmpire.sc/watch/1399?s=2&e=2" },
    ]);
  });

  it("leaves out the episodes that have not come out yet", async () => {
    const get = vi.fn(async () =>
      json({
        episodes: [
          { episode_number: 1, air_date: "2001-01-01" },
          { episode_number: 2, air_date: null },
          { episode_number: 3, air_date: "2999-01-01" },
        ],
      }),
    );
    const season = await filmpireSource({ fetch: get as never }).episodes!("https://filmpire.sc/watch/1399?s=1&e=1", 1);
    expect(season.map((episode) => episode.episode)).toEqual([1, 2]);
  });

  it("knows nothing of films or of other places' links, and says so without asking anyone", async () => {
    const get = vi.fn();
    const source = filmpireSource({ fetch: get as never });
    expect(await source.episodes!("https://filmpire.sc/watch/603", 1)).toEqual([]); // a film has no seasons
    expect(await source.episodes!("https://other.example/watch/1399?s=1&e=1", 1)).toEqual([]);
    expect(await source.episodes!("not a link", 1)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("gives nothing for a season TMDB does not know, and fails when TMDB cannot be reached or answers with something else, so that nothing is remembered of it", async () => {
    const link = "https://filmpire.sc/watch/1399?s=1&e=1";
    expect(await filmpireSource({ fetch: (async () => json({}, 404)) as never }).episodes!(link, 1)).toEqual([]);
    await expect(filmpireSource({ fetch: (async () => json({}, 500)) as never }).episodes!(link, 1)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => json({ nope: true })) as never }).episodes!(link, 1)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => Promise.reject(new Error("offline"))) as never }).episodes!(link, 1)).rejects.toThrow();
  });
});

describe("filmpireSource seasons", () => {
  it("lists the seasons of a show that can be watched, in order, without its specials, empty seasons or seasons not out yet", async () => {
    const asked: string[] = [];
    const get = vi.fn(async (url: string | URL) => {
      asked.push(String(url));
      return json({
        seasons: [
          { season_number: 2, episode_count: 13, air_date: "2009-03-01" },
          { season_number: 0, episode_count: 5, air_date: "2008-01-01" },
          { season_number: 1, episode_count: 7, air_date: "2008-01-20" },
          { season_number: 3, episode_count: 0, air_date: "2010-03-21" },
          { season_number: 4, episode_count: 13, air_date: "2999-01-01" },
          { season_number: 5, episode_count: 8, air_date: null },
        ],
      });
    });
    const source = filmpireSource({ apiKey: "k", fetch: get as never });

    expect(await source.seasons!("https://filmpire.sc/watch/1396?s=3&e=2")).toEqual([1, 2, 5]);
    expect(asked[0]).toContain("/tv/1396?");
  });

  it("knows nothing of films or of other places' links, and says so without asking anyone", async () => {
    const get = vi.fn();
    const source = filmpireSource({ fetch: get as never });
    expect(await source.seasons!("https://filmpire.sc/watch/603")).toEqual([]);
    expect(await source.seasons!("https://other.example/watch/1396?s=1&e=1")).toEqual([]);
    expect(await source.seasons!("not a link")).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("fails when TMDB cannot be reached or answers with something else, so that nothing is remembered of it", async () => {
    const link = "https://filmpire.sc/watch/1396?s=1&e=1";
    await expect(filmpireSource({ fetch: (async () => json({}, 500)) as never }).seasons!(link)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => json({ nope: true })) as never }).seasons!(link)).rejects.toThrow();
    await expect(filmpireSource({ fetch: (async () => Promise.reject(new Error("offline"))) as never }).seasons!(link)).rejects.toThrow();
  });

  it("recognises filmpire.cc links and type=series query parameters", async () => {
    const get = vi.fn(async () => json({ seasons: [{ season_number: 1, episode_count: 10 }] }));
    const source = filmpireSource({ fetch: get as never });
    const seasons = await source.seasons!("https://filmpire.cc/watch/1396?type=series");
    expect(seasons).toEqual([1]);
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("/tv/1396?"),
      expect.anything(),
    );
  });
});
