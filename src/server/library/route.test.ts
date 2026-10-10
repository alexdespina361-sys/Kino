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
