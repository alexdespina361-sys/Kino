import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LibrarySchema } from "../../shared";
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
    expect(res1.json()).toEqual({ items: [{ id: "i1", title: "Casablanca", url: "https://x.example/1" }] });

    // Remote source match
    const res2 = await app.inject({ url: "/api/library/search?q=night" });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ items: [{ id: "i2", title: "A Night to Remember", url: "https://x.example/2" }] });
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
  });

  it("wants a link and a season that is a number", async () => {
    app = await buildApp({ librarySources: [source] });
    expect((await app.inject({ url: "/api/library/episodes?season=1" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/library/episodes?url=https%3A%2F%2Fx.example%2Fa" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/library/episodes?season=abc&url=https%3A%2F%2Fx.example%2Fa" })).statusCode).toBe(400);
  });
});
