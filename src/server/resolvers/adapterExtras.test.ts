import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilmpireAdapter, type ExtrasAsk, type ExtrasLookup } from "./adapters/filmpire";

/*
 * What the filmpire adapter does around the stream it finds: the extras (the subtitle sites' lists and the Romanian subtitles) are asked for while the
 * stream is being found and do not hold the film up past a moment, and an anime site is asked only about what can be an anime. The sites of the stream
 * are made up here and answer at once; nothing goes anywhere.
 */

const MOVIE = new URL("https://filmpire.sc/movie/603");
const EPISODE = new URL("https://filmpire.sc/watch/1396?s=1&e=1");

/** A fetch for a test: the sites answer as the adapter expects, every address asked is written down, and `over` changes what TMDB says of the title. */
function sites(over: { animated?: boolean } = {}) {
  const asked: URL[] = [];
  const answer = (url: URL): Response => {
    if (url.hostname === "api.themoviedb.org") {
      if (url.pathname.includes("/season/")) return Response.json({ episodes: [] });
      return Response.json({ title: "A Film", name: "A Show", imdb_id: "tt0001", ...(over.animated === undefined ? {} : { genres: [{ id: over.animated ? 16 : 18 }] }) });
    }
    if (url.hostname === "screenfetch4.cyou") return Response.json({ src: "https://container.example/embed/1" });
    if (url.hostname === "container.example") return new Response(JSON.stringify({ playerUrl: "https://player.example/p/1" }));
    if (url.hostname === "player.example") {
      const tv = url.pathname.includes("/p/1") && asked.some((seen) => seen.searchParams.get("type") === "tv");
      const config = tv ? { streamBase: "https://api.player.example/stream?x=1", apiToken: "tok", mediaType: "tv" } : { api: "https://api.player.example/stream?x=1", apiToken: "tok" };
      return new Response(`<script>window.CONFIG = ${JSON.stringify(config)};</script>`);
    }
    if (url.hostname === "api.player.example") {
      if (!url.searchParams.has("stream_urls") && url.searchParams.has("api_token") && asked.some((seen) => seen.searchParams.get("type") === "tv")) {
        return Response.json({ data: { title: "A Show", eps: { "1": [1, 2] } } });
      }
      return Response.json({ data: { stream_urls: ["https://cdn.example/a.m3u8", "https://cdn2.example/b.m3u8"], subtitles: [{ file: "https://player.example/en.vtt", label: "Player English", lang: "en" }] } });
    }
    if (url.pathname === "/generate.php") return new Response("a-token");
    if (url.hostname.endsWith("animeheaven.me")) return new Response("<html></html>");
    return new Response("not found", { status: 404 });
  };
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    asked.push(url);
    return answer(url);
  }) as typeof globalThis.fetch;
  return { fetch, asked, hosts: () => new Set(asked.map((url) => url.hostname)) };
}

const track = (label: string) => ({ id: 0, url: `/api/proxy?url=${encodeURIComponent(`https://subs.example/${label}.vtt`)}`, label });
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

beforeEach(() => {
  vi.stubEnv("EDGE_STREAM_PROXY_URL", "");
  vi.stubEnv("EDGE_STREAM_PROXY_KEY", "");
  vi.stubEnv("DIRECT_STREAMING", "");
  vi.stubEnv("PROXY_VIDEO", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the extras of a film", () => {
  it("are asked for as soon as TMDB has said which title it is, while the sites of the stream are still being asked", async () => {
    const net = sites();
    let askedWhen: Set<string> | undefined;
    let ask: ExtrasAsk | undefined;
    const extras: ExtrasLookup = (asked) => {
      ask = asked;
      askedWhen = net.hosts();
      return { listed: Promise.resolve([track("Listed")]), romanian: Promise.resolve([track("Română")]), dub: Promise.resolve(undefined) };
    };
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras }).resolve(MOVIE);
    expect(res.status).toBe("success");
    expect(ask).toEqual({ imdbId: "tt0001", tmdbId: "603", title: "A Film", isTv: false });
    expect(askedWhen).toEqual(new Set(["api.themoviedb.org"]));
  });

  it("go with the film by language (English, then Romanian, then the rest), the Romanian sites' own first among the Romanian, numbered from zero", async () => {
    const net = sites();
    // (As the Romanian sites' subtitles come: `RomanianSubtitleManager` names their language, and it is the language that says where a subtitle goes.)
    const romanian = [{ ...track("Română"), lang: "ron" }];
    const listed = [{ ...track("Listed French"), lang: "fre" }, { ...track("Listed English"), lang: "eng" }, { ...track("Listed Romanian"), lang: "rum" }, track("Listed")];
    const extras: ExtrasLookup = () => ({ listed: Promise.resolve(listed), romanian: Promise.resolve(romanian), dub: Promise.resolve(undefined) });
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras }).resolve(MOVIE);
    if (res.status !== "success") throw new Error(res.status);
    expect(res.media.subtitles?.map((sub) => [sub.id, sub.label])).toEqual([
      [0, "Player English"],
      [1, "Listed English"],
      [2, "Română"],
      [3, "Listed Romanian"],
      [4, "Listed French"],
      [5, "Listed"],
    ]);
  });

  it("do not hold the film up: what has not come a moment after the stream is known is left for the next look", async () => {
    const net = sites();
    const extras: ExtrasLookup = () => ({ listed: Promise.resolve([track("Listed")]), romanian: never(), dub: never() });
    const started = Date.now();
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras, extrasGraceMs: 50 }).resolve(MOVIE);
    expect(Date.now() - started).toBeLessThan(2000);
    if (res.status !== "success") throw new Error(res.status);
    expect(res.media.stream.directUrl).toContain("https://cdn.example/a.m3u8");
    expect(res.media.subtitles?.map((sub) => sub.label)).toEqual(["Player English", "Listed"]);
  });

  it("that fail are as if they had found nothing", async () => {
    const net = sites();
    const extras: ExtrasLookup = () => ({ listed: Promise.reject(new Error("down")), romanian: Promise.reject(new Error("down")), dub: Promise.reject(new Error("down")) });
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras }).resolve(MOVIE);
    if (res.status !== "success") throw new Error(res.status);
    expect(res.media.subtitles?.map((sub) => sub.label)).toEqual(["Player English"]);
  });

  it("put a Romanian dubbed source, when the catalogue has one, first among the alternates", async () => {
    const net = sites();
    const dub = { label: "Română (Dublat)", stream: { url: "https://dub.example/a.m3u8", type: "hls" as const } };
    const extras: ExtrasLookup = () => ({ listed: Promise.resolve([]), romanian: Promise.resolve([]), dub: Promise.resolve(dub) });
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras }).resolve(MOVIE);
    if (res.status !== "success") throw new Error(res.status);
    expect(res.media.alternates?.[0]).toEqual(dub);
    expect(res.media.alternates?.[1]?.stream.directUrl).toContain("https://cdn2.example/b.m3u8");
  });

  it("that fail after a look-up that found no stream fail to somebody: nothing is left for the server to trip over", async () => {
    const net = sites();
    // (TMDB knows the title; no site of the stream has it.)
    const nothing = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      return url.hostname === "api.themoviedb.org" ? net.fetch(input) : new Response("not found", { status: 404 });
    }) as typeof globalThis.fetch;
    const unheard: unknown[] = [];
    const hear = (reason: unknown) => void unheard.push(reason);
    process.on("unhandledRejection", hear);
    try {
      let fail: (reason: Error) => void = () => {};
      const later = <T,>() => new Promise<T>((_, reject) => (fail = reject));
      let asked = 0;
      const extras: ExtrasLookup = () => {
        asked += 1;
        return { listed: later(), romanian: Promise.reject(new Error("down")), dub: never() };
      };
      const res = await createFilmpireAdapter({ fetch: nothing, extras }).resolve(MOVIE);
      expect(res.status).not.toBe("success");
      expect(asked).toBe(1);
      fail(new Error("timed out")); // (the list was still on its way when the look-up ended, and is cut off with it)
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unheard).toEqual([]);
    } finally {
      process.off("unhandledRejection", hear);
    }
  });

  it("are asked for an episode with its season and episode", async () => {
    const net = sites();
    let ask: ExtrasAsk | undefined;
    const extras: ExtrasLookup = (asked) => {
      ask = asked;
      return { listed: Promise.resolve([]), romanian: Promise.resolve([]), dub: Promise.resolve(undefined) };
    };
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras }).resolve(EPISODE);
    expect(res.status).toBe("success");
    expect(ask).toEqual({ imdbId: "tt0001", tmdbId: "1396", title: "A Film", isTv: true, season: 1, episode: 1 });
  });
});

describe("the anime site", () => {
  const none: ExtrasLookup = () => ({ listed: Promise.resolve([]), romanian: Promise.resolve([]), dub: Promise.resolve(undefined) });

  it("is not asked about an episode of a show that TMDB says is not animated, even as another server for it", async () => {
    const net = sites({ animated: false });
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras: none }).resolve(EPISODE);
    expect(res.status).toBe("success");
    expect(net.hosts()).not.toContain("animeheaven.me");
  });

  it("is asked about an episode of an animated show, as another server for it", async () => {
    const net = sites({ animated: true });
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras: none }).resolve(EPISODE);
    expect(res.status).toBe("success");
    expect([...net.hosts()].some((host) => host.endsWith("animeheaven.me"))).toBe(true);
  });

  it("is asked when TMDB said nothing of the genres (as before)", async () => {
    const net = sites();
    const res = await createFilmpireAdapter({ fetch: net.fetch, extras: none }).resolve(EPISODE);
    expect(res.status).toBe("success");
    expect([...net.hosts()].some((host) => host.endsWith("animeheaven.me"))).toBe(true);
  });
});
