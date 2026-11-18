import { describe, expect, it } from "vitest";
import { nameIdOf } from "../../shared";
import { buildApp } from "../app";
import { createNameBook, localNameOf, NAME_TTL_MS } from "./names";

/** The movie database, as far as a name is asked of it: what it says of each title in each language, and how many times it was asked. */
function tmdb(docs: Record<string, unknown>, { fail = new Set<string>(), slow = new Set<string>() } = {}) {
  const asked: string[] = [];
  const get = (async (input: string | URL, init?: { signal?: AbortSignal }) => {
    const url = new URL(String(input));
    const key = `${url.pathname.replace("/3/", "")}|${url.searchParams.get("language")}`;
    asked.push(key);
    if (slow.has(key)) await new Promise((_, no) => init?.signal?.addEventListener("abort", () => no(new Error("aborted"))));
    if (fail.has(key)) return { ok: false, status: 503, json: async () => ({}) };
    const doc = docs[key];
    return doc ? { ok: true, status: 200, json: async () => doc } : { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { get, asked };
}

describe("a title's name in a viewer's language", () => {
  it("is the name the movie database has in that language, with its description", () => {
    expect(localNameOf({ title: "Începutul", original_title: "Inception", original_language: "en", overview: " Un hoț. " }, "ro")).toEqual({ title: "Începutul", description: "Un hoț." });
  });

  it("is none when the movie database only gives the original name back (an anime nobody translated keeps its English name)", () => {
    expect(localNameOf({ name: "チェンソーマン", original_name: "チェンソーマン", original_language: "ja", overview: "" }, "ro")).toEqual({});
    expect(localNameOf({ name: "Breaking Bad", original_name: "Breaking Bad", original_language: "en", overview: "Un profesor." }, "ro")).toEqual({ description: "Un profesor." });
  });

  it("is the original name for a title made in that language", () => {
    expect(localNameOf({ title: "Moromeții", original_title: "Moromeții", original_language: "ro" }, "ro")).toEqual({ title: "Moromeții" });
  });

  it("is none for what is not a title", () => {
    expect(localNameOf(null, "ro")).toEqual({});
    expect(localNameOf({ title: 5 }, "it")).toEqual({});
  });
});

describe("what a title is asked about as", () => {
  it("goes by the tile's id, or by the link that plays it", () => {
    expect(nameIdOf({ id: "filmpire-tv-1399", url: "https://filmpire.sc/watch/1399?s=1&e=1" })).toBe("tv-1399");
    expect(nameIdOf({ url: "https://filmpire.sc/watch/603" })).toBe("movie-603");
    expect(nameIdOf({ url: "https://filmpire.sc/watch/1399?s=3&e=7" })).toBe("tv-1399");
    expect(nameIdOf({ url: "https://filmpire.sc/watch/1399?type=series" })).toBe("tv-1399");
    expect(nameIdOf({ id: "animeheaven-abc", url: "https://animeheaven.me/anime.php?abc" })).toBeNull();
    expect(nameIdOf({ url: "not a link" })).toBeNull();
    expect(nameIdOf({})).toBeNull();
  });
});

describe("the names kept for everyone", () => {
  const docs = {
    "movie/27205|ro-RO": { title: "Începutul", original_title: "Inception", original_language: "en", overview: "Un hoț." },
    "tv/114410|ro-RO": { name: "チェンソーマン", original_name: "チェンソーマン", original_language: "ja" },
    "movie/27205|it-IT": { title: "Inception", original_title: "Inception", original_language: "en", overview: "Un ladro." },
  };

  it("asks the movie database once for a title and a language, and keeps the answer (also that there is no name)", async () => {
    const { get, asked } = tmdb(docs);
    const book = createNameBook({ fetch: get, apiKey: "k" });
    expect(await book.of("ro", ["movie-27205", "tv-114410", "movie-999"])).toEqual({ "movie-27205": { title: "Începutul", description: "Un hoț." }, "tv-114410": {}, "movie-999": {} });
    expect(await book.of("ro", ["movie-27205", "tv-114410", "movie-999"])).toEqual({ "movie-27205": { title: "Începutul", description: "Un hoț." }, "tv-114410": {}, "movie-999": {} });
    expect(asked).toHaveLength(3);
    expect(await book.of("it", ["movie-27205"])).toEqual({ "movie-27205": { description: "Un ladro." } });
    expect(asked).toHaveLength(4);
    expect(book.has("ro", "movie-27205")).toBe(true);
    expect(book.has("it", "tv-114410")).toBe(false);
  });

  it("asks once for a title two pages ask about at the same time", async () => {
    const { get, asked } = tmdb(docs);
    const book = createNameBook({ fetch: get, apiKey: "k" });
    const [one, two] = await Promise.all([book.of("ro", ["movie-27205"]), book.of("ro", ["movie-27205"])]);
    expect(one).toEqual(two);
    expect(asked).toHaveLength(1);
  });

  it("leaves out a title that could not be reached, and asks again the next time", async () => {
    const fail = new Set(["movie/27205|ro-RO"]);
    const { get, asked } = tmdb(docs, { fail });
    const book = createNameBook({ fetch: get, apiKey: "k" });
    expect(await book.of("ro", ["movie-27205", "tv-114410"])).toEqual({ "tv-114410": {} });
    fail.clear();
    expect(await book.of("ro", ["movie-27205"])).toEqual({ "movie-27205": { title: "Începutul", description: "Un hoț." } });
    expect(asked).toHaveLength(3);
  });

  it("does not wait longer than it may for a slow answer, and leaves out what an address may not ask about", async () => {
    const { get } = tmdb(docs, { slow: new Set(["movie/27205|ro-RO"]) });
    const book = createNameBook({ fetch: get, apiKey: "k", waitMs: 30 });
    expect(await book.of("ro", ["movie-27205", "tv-114410"])).toEqual({ "tv-114410": {} });
    const strict = createNameBook({ fetch: tmdb(docs).get, apiKey: "k" });
    expect(await strict.of("ro", ["movie-27205", "tv-114410"], (id) => id === "tv-114410")).toEqual({ "tv-114410": {} });
  });

  it("asks again once a name is a week old", async () => {
    const { get, asked } = tmdb(docs);
    let at = 1_000_000;
    const book = createNameBook({ fetch: get, apiKey: "k", now: () => at });
    await book.of("ro", ["movie-27205"]);
    at += NAME_TTL_MS - 1;
    await book.of("ro", ["movie-27205"]);
    expect(asked).toHaveLength(1);
    at += 2;
    await book.of("ro", ["movie-27205"]);
    expect(asked).toHaveLength(2);
  });

  it("ignores what is not a title's id", async () => {
    const { get, asked } = tmdb(docs);
    expect(await createNameBook({ fetch: get, apiKey: "k" }).of("ro", ["person-1", "movie-", "../etc", "movie-27205"])).toEqual({ "movie-27205": { title: "Începutul", description: "Un hoț." } });
    expect(asked).toHaveLength(1);
  });
});

describe("GET /api/library/names", () => {
  const docs = { "movie/27205|ro-RO": { title: "Începutul", original_title: "Inception", original_language: "en" }, "tv/1|ro-RO": { name: "Unu", original_name: "One", original_language: "en" } };

  it("answers with the names, which a browser may keep for a day when every title is in the answer", async () => {
    const app = await buildApp({ names: createNameBook({ fetch: tmdb(docs).get, apiKey: "k" }) });
    const res = await app.inject({ method: "GET", url: "/api/library/names?lang=ro&ids=movie-27205,tv-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: { "movie-27205": { title: "Începutul" }, "tv-1": { title: "Unu" } } });
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    await app.close();
  });

  it("is not kept when a title is left out, and an address has only so many look-ups", async () => {
    const { get, asked } = tmdb(docs);
    const app = await buildApp({ names: createNameBook({ fetch: get, apiKey: "k" }), nameLookupsPer10Min: 1 });
    const res = await app.inject({ method: "GET", url: "/api/library/names?lang=ro&ids=movie-27205,tv-1" });
    expect(res.json()).toEqual({ names: { "movie-27205": { title: "Începutul" } } });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(asked).toHaveLength(1);
    // (what is kept is answered whatever the allowance)
    const again = await app.inject({ method: "GET", url: "/api/library/names?lang=ro&ids=movie-27205" });
    expect(again.json()).toEqual({ names: { "movie-27205": { title: "Începutul" } } });
    await app.close();
  });

  it("turns down a language it has no names in, too many titles, and what is not a title", async () => {
    const app = await buildApp({ names: createNameBook({ fetch: tmdb(docs).get, apiKey: "k" }) });
    const bad = async (query: string) => (await app.inject({ method: "GET", url: `/api/library/names?${query}` })).statusCode;
    expect(await bad("lang=en&ids=movie-1")).toBe(400);
    expect(await bad("lang=ro")).toBe(400);
    expect(await bad("lang=ro&ids=person-1")).toBe(400);
    expect(await bad(`lang=ro&ids=${Array.from({ length: 41 }, (_, at) => `movie-${at + 1}`).join(",")}`)).toBe(400);
    expect(await bad("lang=ro&ids=movie-1&ids=movie-2")).toBe(400);
    await app.close();
  });

  it("has no names when the server has nowhere to ask", async () => {
    const app = await buildApp({});
    const res = await app.inject({ method: "GET", url: "/api/library/names?lang=ro&ids=movie-27205" });
    expect(res.json()).toEqual({ names: {} });
    expect(res.headers["cache-control"]).toBe("no-store");
    await app.close();
  });
});
