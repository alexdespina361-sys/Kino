import { describe, expect, it, vi } from "vitest";
import { LibraryRowSchema } from "../../shared";
import { filmpireSource, type FilmpireCategory } from "./filmpire";

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

  it("gives nothing when TMDB fails", async () => {
    const source = filmpireSource({ fetch: (async () => json({}, 500)) as never });
    expect(await source.similar!("https://filmpire.sc/watch/603")).toEqual([]);
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

  it("gives nothing when TMDB fails or answers with something else", async () => {
    expect(await filmpireSource({ fetch: (async () => json({}, 404)) as never }).episodes!("https://filmpire.sc/watch/1399?s=1&e=1", 1)).toEqual([]);
    expect(await filmpireSource({ fetch: (async () => json({ nope: true })) as never }).episodes!("https://filmpire.sc/watch/1399?s=1&e=1", 1)).toEqual([]);
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
});
