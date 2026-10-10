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

    expect(rows.map((r) => [r.id, r.title, r.source])).toEqual([
      ["filmpire-test-movies", "Test Movies", "Filmpire"],
      ["filmpire-test-tv", "Test TV", "Filmpire"],
    ]);

    expect(rows[0]!.items).toEqual([
      {
        id: "filmpire-movie-101",
        title: "Spider-Hero",
        year: 2023,
        image: "https://image.tmdb.org/t/p/w500/spider.jpg",
        description: "A hero swinging through the city.",
        url: "https://filmpire.sc/watch/101",
      },
    ]);

    expect(rows[1]!.items).toEqual([
      {
        id: "filmpire-tv-202",
        title: "Avatar Adventure",
        year: 2024,
        image: "https://image.tmdb.org/t/p/w500/avatar.jpg",
        description: "An adventure in a magical world.",
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
      url: "https://filmpire.sc/watch/10",
    });
    expect(results[1]).toEqual({
      id: "filmpire-tv-20",
      title: "Spider-Man TAS",
      year: 1994,
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
