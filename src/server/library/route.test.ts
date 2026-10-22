import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LibraryMoreSchema, LibraryRowsSchema, LibrarySchema } from "../../shared";
import { buildApp } from "../app";
import type { LibrarySource } from "./library";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const source: LibrarySource = {
  id: "fake",
  name: "Fake",
  load: async () => [{ id: "r", title: "Row", source: "Fake", items: [{ id: "i", title: "Title", url: "https://x.example/i" }] }],
};

describe("GET /api/library", () => {
  it("answers with the rows, which a phone may keep for a few minutes", async () => {
    app = await buildApp({ librarySources: [source] });
    const response = await app.inject({ url: "/api/library" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    const library = LibrarySchema.parse(response.json());
    expect(library.rows[0]?.items[0]?.title).toBe("Title");
    expect(library.updatedAt).toBeGreaterThan(0);
  });

  it("is empty, and reaches nowhere, when no source is given", async () => {
    app = await buildApp();
    expect((await app.inject({ url: "/api/library" })).json()).toEqual({ rows: [], updatedAt: 0 });
  });

  it("tells a browser that already has this very list so in a few bytes, however it words the question", async () => {
    app = await buildApp({ librarySources: [source] });
    const first = await app.inject({ url: "/api/library" });
    const tag = String(first.headers.etag);
    expect(tag).toMatch(/^W\/"[\w-]+"$/);
    for (const asked of [tag, tag.replace("W/", ""), `W/"another", ${tag}`, "*"]) {
      const again = await app.inject({ url: "/api/library", headers: { "if-none-match": asked } });
      expect(again.statusCode, asked).toBe(304);
      expect(again.body, asked).toBe("");
      expect(again.headers["cache-control"], asked).toBe("public, max-age=300");
    }
    const other = await app.inject({ url: "/api/library", headers: { "if-none-match": 'W/"not-this-list"' } });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual(first.json());
  });

  it("has another tag for another list", async () => {
    const another: LibrarySource = { ...source, load: async () => [{ id: "r", title: "Row", source: "Fake", items: [{ id: "i", title: "Another title", url: "https://x.example/i" }] }] };
    app = await buildApp({ librarySources: [source] });
    const tag = (await app.inject({ url: "/api/library" })).headers.etag;
    await app.close();
    app = await buildApp({ librarySources: [another] });
    expect((await app.inject({ url: "/api/library" })).headers.etag).not.toBe(tag);
  });

  it("keeps its tag when the list goes out packed, and the tag still works", async () => {
    const items = Array.from({ length: 40 }, (_, at) => ({ id: `i${at}`, title: `Title ${at}`, description: "A few words about the title, enough that forty of them are more than a packet.", url: `https://x.example/${at}` }));
    const big: LibrarySource = { ...source, load: async () => [{ id: "r", title: "Row", source: "Fake", items }] };
    app = await buildApp({ librarySources: [big] });
    const packed = await app.inject({ url: "/api/library", headers: { "accept-encoding": "gzip" } });
    expect(packed.headers["content-encoding"]).toBe("gzip");
    expect(packed.headers.etag).toBeTruthy();
    const again = await app.inject({ url: "/api/library", headers: { "accept-encoding": "gzip", "if-none-match": String(packed.headers.etag) } });
    expect(again.statusCode).toBe(304);
    // (...and it is the same list whichever way it was asked for.)
    expect((await app.inject({ url: "/api/library" })).headers.etag).toBe(packed.headers.etag);
  });
});

describe("GET /api/library/search", () => {
  it("searches library items across sources", async () => {
    const searchableSource: LibrarySource = {
      id: "searchable",
      name: "Searchable",
      load: async () => [{ id: "r1", title: "Row", source: "Searchable", items: [{ id: "i1", title: "Casablanca", url: "https://x.example/1" }] }],
      search: async (q) => (q.toLowerCase().includes("night") ? [{ id: "i2", title: "A Night to Remember", url: "https://x.example/2" }] : []),
    };
    app = await buildApp({ librarySources: [searchableSource] });
    // First query library to warm cache
    await app.inject({ url: "/api/library" });

    // Local cached match
    const res1 = await app.inject({ url: "/api/library/search?q=casa" });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toEqual({ items: [{ id: "i1", title: "Casablanca", url: "https://x.example/1" }], exact: 1 });

    // Remote source match
    const res2 = await app.inject({ url: "/api/library/search?q=night" });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ items: [{ id: "i2", title: "A Night to Remember", url: "https://x.example/2" }], exact: 1 });
  });
});

describe("GET /api/library/rows and /more", () => {
  const item = (id: string, title: string) => ({ id, title, url: `https://x.example/${id}` });
  const paging: LibrarySource = {
    ...source,
    shelves: async (section, cursor) => ({ rows: [{ id: `shelf-${section ?? "all"}-${cursor}`, title: "Shelf", source: "Fake", items: [item(`a${cursor}`, "Alpha")] }], next: cursor < 5 ? cursor + 5 : null }),
    more: async (rowId, page) => (rowId === "shelf" ? { items: [item(`p${page}`, `Page ${page}`)], last: page >= 3 } : { items: [], last: true }),
  };

  it("brings the next rows of the library from where the last answer said to go on, which a phone may keep for a few minutes", async () => {
    app = await buildApp({ librarySources: [paging] });
    const first = await app.inject({ url: "/api/library/rows" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=300");
    expect(LibraryRowsSchema.parse(first.json())).toEqual({ rows: [{ id: "shelf-all-0", title: "Shelf", source: "Fake", items: [item("a0", "Alpha")] }], next: 5 });

    const films = await app.inject({ url: "/api/library/rows?section=movie&cursor=5" });
    expect(LibraryRowsSchema.parse(films.json())).toMatchObject({ rows: [{ id: "shelf-movie-5" }], next: null });
  });

  it("brings the rows of a page of a section: Movies, Series, Cartoons or Anime", async () => {
    app = await buildApp({ librarySources: [paging] });
    for (const section of ["movie", "series", "cartoon", "anime"]) {
      const answer = await app.inject({ url: `/api/library/rows?section=${section}` });
      expect(LibraryRowsSchema.parse(answer.json()), section).toMatchObject({ rows: [{ id: `shelf-${section}-0` }], next: 5 });
    }
  });

  it("still takes the word a phone that has not been reloaded asks with: a kind, which is a film's or a show's section", async () => {
    app = await buildApp({ librarySources: [paging] });
    expect(LibraryRowsSchema.parse((await app.inject({ url: "/api/library/rows?kind=series" })).json())).toMatchObject({ rows: [{ id: "shelf-series-0" }] });
    expect(LibraryRowsSchema.parse((await app.inject({ url: "/api/library/rows?kind=movie&cursor=5" })).json())).toMatchObject({ rows: [{ id: "shelf-movie-5" }] });
    // (when both are given, the section is the one that counts)
    expect(LibraryRowsSchema.parse((await app.inject({ url: "/api/library/rows?kind=movie&section=anime" })).json())).toMatchObject({ rows: [{ id: "shelf-anime-0" }] });
  });

  it("asks a place for a section's rows apart from another's, and from Home's", async () => {
    const asked: Array<[string | undefined, number]> = [];
    const spying: LibrarySource = { ...paging, shelves: async (section, cursor) => (asked.push([section, cursor]), { rows: [], next: null }) };
    app = await buildApp({ librarySources: [spying] });
    for (const url of ["/api/library/rows", "/api/library/rows?section=cartoon", "/api/library/rows?section=cartoon", "/api/library/rows?section=anime&cursor=5"]) await app.inject({ url });
    // (the same question twice is answered from what was kept)
    expect(asked).toEqual([[undefined, 0], ["cartoon", 0], ["anime", 5]]);
  });

  it("wants a cursor that is a number, a section that is one of the four, and a kind that is one of the two", async () => {
    app = await buildApp({ librarySources: [paging] });
    for (const bad of ["cursor=-1", "cursor=1.5", "cursor=abc", "cursor=100001", "kind=anime", "kind=cartoon", "section=documentary", "section=movies", "section="]) {
      expect((await app.inject({ url: `/api/library/rows?${bad}` })).statusCode, bad).toBe(400);
    }
  });

  it("is empty, and reaches nowhere, when no place has more", async () => {
    app = await buildApp({ librarySources: [source] });
    expect((await app.inject({ url: "/api/library/rows" })).json()).toEqual({ rows: [], next: null });
    expect((await app.inject({ url: "/api/library/more?row=shelf&page=2" })).json()).toEqual({ items: [], last: true });
  });

  it("brings more titles of a row, and says when there are no more", async () => {
    app = await buildApp({ librarySources: [paging] });
    const next = await app.inject({ url: "/api/library/more?row=shelf&page=2" });
    expect(next.statusCode).toBe(200);
    expect(next.headers["cache-control"]).toBe("public, max-age=300");
    expect(LibraryMoreSchema.parse(next.json())).toEqual({ items: [item("p2", "Page 2")], last: false });
    expect((await app.inject({ url: "/api/library/more?row=shelf&page=3" })).json()).toMatchObject({ last: true });
    expect((await app.inject({ url: "/api/library/more?row=other&page=2" })).json()).toEqual({ items: [], last: true });
  });

  it("wants a row, and a page from the second to the hundredth", async () => {
    app = await buildApp({ librarySources: [paging] });
    for (const bad of ["", "row=shelf", "row=shelf&page=1", "row=shelf&page=101", "row=shelf&page=x", "row=shelf&page=2.5", `row=${"x".repeat(101)}&page=2`]) {
      expect((await app.inject({ url: `/api/library/more?${bad}` })).statusCode, bad).toBe(400);
    }
  });

  it("says so, and keeps nothing of it, when the places cannot be reached", async () => {
    const down: LibrarySource = { ...source, shelves: async () => Promise.reject(new Error("down")), more: async () => Promise.reject(new Error("down")) };
    app = await buildApp({ librarySources: [down] });
    const rows = await app.inject({ url: "/api/library/rows" });
    expect(rows.statusCode).toBe(502);
    expect(rows.headers["cache-control"]).toBe("no-store");
    const more = await app.inject({ url: "/api/library/more?row=shelf&page=2" });
    expect(more.statusCode).toBe(502);
    expect(more.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /api/library/similar", () => {
  it("lists the titles a source finds like the one a link plays", async () => {
    const similarSource: LibrarySource = {
      ...source,
      similar: async (link) => (link.endsWith("/1") ? [{ id: "s1", title: "Alike", url: "https://x.example/s1" }] : []),
    };
    app = await buildApp({ librarySources: [similarSource] });

    const found = await app.inject({ url: `/api/library/similar?url=${encodeURIComponent("https://x.example/watch/1")}` });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("public, max-age=3600");
    expect(found.json()).toEqual({ items: [{ id: "s1", title: "Alike", url: "https://x.example/s1" }] });

    const unknown = await app.inject({ url: `/api/library/similar?url=${encodeURIComponent("https://x.example/watch/2")}` });
    expect(unknown.json()).toEqual({ items: [] });
    expect(unknown.headers["cache-control"]).toBe("no-store"); // may be a place that could not be reached just now
  });

  it("wants a link", async () => {
    app = await buildApp({ librarySources: [source] });
    expect((await app.inject({ url: "/api/library/similar" })).statusCode).toBe(400);
  });
});

describe("GET /api/library/episodes", () => {
  it("lists what a source knows of one season of the show a link plays", async () => {
    const episodesSource: LibrarySource = {
      ...source,
      episodes: async (link, season) => (link.endsWith("?s=2&e=1") ? [{ season, episode: 1, title: "Pilot", runtime: 42 }] : []),
    };
    app = await buildApp({ librarySources: [episodesSource] });

    const found = await app.inject({ url: `/api/library/episodes?season=2&url=${encodeURIComponent("https://x.example/watch/1?s=2&e=1")}` });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("public, max-age=3600");
    expect(found.json()).toEqual({ episodes: [{ season: 2, episode: 1, title: "Pilot", runtime: 42 }] });

    const unknown = await app.inject({ url: `/api/library/episodes?season=1&url=${encodeURIComponent("https://x.example/watch/9")}` });
    expect(unknown.json()).toEqual({ episodes: [] });
    expect(unknown.headers["cache-control"]).toBe("no-store");
  });

  it("wants a link and a season that is a number", async () => {
    app = await buildApp({ librarySources: [source] });
    expect((await app.inject({ url: "/api/library/episodes?season=1" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/library/episodes?url=https%3A%2F%2Fx.example%2Fa" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/library/episodes?season=abc&url=https%3A%2F%2Fx.example%2Fa" })).statusCode).toBe(400);
  });
});

describe("GET /api/library/seasons", () => {
  it("lists the seasons a source knows of the show a link plays, which a browser may keep for an hour", async () => {
    const seasonsSource: LibrarySource = { ...source, seasons: async (link) => (link.endsWith("?s=1&e=1") ? [1, 2, 3] : []) };
    app = await buildApp({ librarySources: [seasonsSource] });

    const found = await app.inject({ url: `/api/library/seasons?url=${encodeURIComponent("https://x.example/watch/1?s=1&e=1")}` });
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toBe("public, max-age=3600");
    expect(found.json()).toEqual({ seasons: [1, 2, 3] });
  });

  it("answers none for a link nobody knows, and asks the browser not to keep that", async () => {
    app = await buildApp({ librarySources: [{ ...source, seasons: async () => [] }] });
    const unknown = await app.inject({ url: `/api/library/seasons?url=${encodeURIComponent("https://x.example/watch/9")}` });
    expect(unknown.json()).toEqual({ seasons: [] });
    expect(unknown.headers["cache-control"]).toBe("no-store");
  });

  it("wants a link", async () => {
    app = await buildApp({ librarySources: [source] });
    expect((await app.inject({ url: "/api/library/seasons" })).statusCode).toBe(400);
  });
});
