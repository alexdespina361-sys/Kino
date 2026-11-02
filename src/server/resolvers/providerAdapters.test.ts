import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createFilmpireAdapter, getHostToken } from "./adapters/filmpire";
import { sealed, wasmModule } from "./adapters/wasmModule.fixture";
import { createResolver } from "./index";
import { providerFetch } from "./providerFetch";

// (`providerFetch` is the real one unless a test hands out another for the next call: the adapters take theirs from it.)
vi.mock("./providerFetch", async (importOriginal) => {
  const original = await importOriginal<typeof import("./providerFetch")>();
  return { ...original, providerFetch: vi.fn(original.providerFetch) };
});

/*
 * The adapters ask the sites they are made for, and those name the next address to ask. Every question has to go through the one fetch the adapter is given
 * (by default `providerFetch`: public addresses only, a bound on time and size), and what a site names is never a way into this machine's own network.
 * Nothing here goes anywhere: the answers are made up, and the one real server is on this machine and counts the questions it is asked.
 */

const PLAYER = "https://player.example/p/1";

/** A site of the test that answers as the adapter expects, one hop after the other. `over` changes what a hop says. */
interface Hops {
  /** What the first site says the player's container is. */
  container?: string;
  /** What the container says the player's page is. */
  player?: string;
  /** The player's own address for the stream's questions (the `api` of its config). */
  api?: string;
  /** What the stream's answer says (merged into the `data` and top level). */
  streams?: unknown;
  wasm?: string;
  subtitles?: unknown[];
  /** The tracks that the player's page lists itself (read when the stream's answer has none). */
  playerTracks?: unknown[];
  /** The IMDb number TMDB gives the title, and the subtitles the subtitle site then lists for it. */
  imdb?: string;
  strem?: unknown[];
  /** For a series. */
  eps?: Record<string, number[]>;
  token?: (origin: string) => string | undefined;
}
function hops(over: Hops = {}): (url: URL) => Response | undefined {
  return (url) => {
    if (url.hostname === "api.themoviedb.org") return url.pathname.includes("/season/") ? undefined : Response.json({ title: "A Film", name: "A Show", ...(over.imdb ? { imdb_id: over.imdb } : {}) });
    if (url.hostname === "opensubtitles-v3.strem.io") return Response.json({ subtitles: over.strem ?? [] });
    if (url.hostname === "screenfetch4.cyou") return Response.json({ src: over.container ?? "https://container.example/embed/1" });
    if (url.hostname === "container.example") return new Response(JSON.stringify({ playerUrl: over.player ?? PLAYER }));
    if (url.hostname === "player.example") {
      const config = over.eps ? { streamBase: over.api ?? "https://api.player.example/stream?x=1", apiToken: "tok", mediaType: "tv" } : { api: over.api ?? "https://api.player.example/stream?x=1", apiToken: "tok" };
      return new Response(`<script>window.CONFIG = ${JSON.stringify(config)};</script>${over.playerTracks ? `<script>var player = { tracks: ${JSON.stringify(over.playerTracks)} };</script>` : ""}`);
    }
    if (url.hostname === "api.player.example") {
      if (over.eps && !url.searchParams.has("stream_urls")) return Response.json({ data: { title: "A Show", eps: over.eps } });
      return Response.json({
        data: { stream_urls: over.streams ?? ["https://cdn.example/a.m3u8"], ...(over.subtitles ? { subtitles: over.subtitles } : {}) },
        ...(over.wasm ? { vs: { wasm_url: over.wasm } } : {}),
      });
    }
    if (url.pathname === "/generate.php" && url.hostname.endsWith(".example")) {
      const token = over.token?.(url.origin);
      return token ? new Response(token) : new Response("no", { status: 500 });
    }
    return undefined;
  };
}

/** A fetch for a test: what `answers` has is answered, and every address asked is written down. */
function scripted(answers: (url: URL) => Response | undefined, otherwise?: typeof fetch) {
  const asked: URL[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    asked.push(url);
    return answers(url) ?? (otherwise ? otherwise(input, init) : new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return { fetch: fake, asked };
}

let server: http.Server;
let hits: string[];
let local: string;
beforeEach(async () => {
  hits = [];
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/html" }).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("EDGE_STREAM_PROXY_URL", "");
  vi.stubEnv("EDGE_STREAM_PROXY_KEY", "");
  vi.stubEnv("DIRECT_STREAMING", "");
  vi.stubEnv("PROXY_VIDEO", "");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("the filmpire adapter", () => {
  const MOVIE = new URL("https://filmpire.cc/movie/603");

  it("asks through the fetch it is given and nothing else, hop after hop, and finds the stream", async () => {
    const global = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", global);
    const net = scripted(hops({ token: () => "a-token" }));
    const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
    expect(res.status).toBe("success");
    if (res.status === "success") expect(res.media.stream.directUrl).toBe("https://cdn.example/a.m3u8?token=a-token&bypass_localize=true");
    expect(new Set(net.asked.map((url) => url.hostname))).toEqual(new Set(["api.themoviedb.org", "screenfetch4.cyou", "container.example", "player.example", "api.player.example", "cdn.example"]));
    expect(global).not.toHaveBeenCalled();
  });

  it("leaves out a stream that is not an http(s) address, and asks no more than twelve of the streams it is told of for a token", async () => {
    const streams = ["javascript:alert(1)", "file:///etc/passwd", "data:text/plain,hi", ...Array.from({ length: 30 }, (_, i) => `https://cdn${i}.example/${i}.m3u8`)];
    const net = scripted(hops({ streams }));
    const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toBe("https://cdn0.example/0.m3u8");
      expect((res.media.alternates ?? []).every((one) => one.stream.directUrl?.startsWith("https://cdn"))).toBe(true);
    }
    const askedForToken = new Set(net.asked.filter((url) => url.pathname === "/generate.php").map((url) => url.hostname));
    expect(askedForToken.size).toBe(12);
    expect(askedForToken.has("cdn12.example")).toBe(false);
  });

  it("runs the module that the stream's answer names, and keeps only the http(s) addresses that the module decrypts to", async () => {
    const wasmUrl = "https://player.example/m/decrypt.wasm";
    const text = ["https://dec-a.example/1.m3u8", "", "javascript:alert(1)", "  https://dec-b.example/2.m3u8  ", "file:///etc/passwd", "ftp://x.example/y"].join("\n");
    const answers = hops({ streams: sealed(text).toString("base64"), wasm: wasmUrl });
    const net = scripted((url) => (url.href === wasmUrl ? new Response(wasmModule(), { headers: { "content-type": "application/wasm" } }) : answers(url)));
    const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toBe("https://dec-a.example/1.m3u8");
      expect(res.media.alternates?.map((one) => one.stream.directUrl)).toEqual(["https://dec-b.example/2.m3u8"]);
    }
    expect(net.asked.some((url) => url.href === wasmUrl)).toBe(true);
  });

  it("asks the hosts of the other streams for their tokens through the same fetch, and puts them on the alternates", async () => {
    const global = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", global);
    const net = scripted(hops({ streams: ["https://alt-a.example/a.m3u8", "https://alt-b.example/b.m3u8"], token: (origin) => `token-of-${new URL(origin).hostname}` }));
    const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toBe("https://alt-a.example/a.m3u8?token=token-of-alt-a.example&bypass_localize=true");
      expect(res.media.alternates?.map((one) => one.stream.directUrl)).toEqual(["https://alt-b.example/b.m3u8?token=token-of-alt-b.example&bypass_localize=true"]);
    }
    expect(global).not.toHaveBeenCalled();
  });

  describe("takes no more than forty subtitles", () => {
    const list = (length: number) => Array.from({ length }, (_, i) => ({ file: `https://sub.example/${i}.vtt`, label: `Language ${i}`, kind: "captions" }));

    it("from what the stream's answer lists", async () => {
      const net = scripted(hops({ subtitles: list(100) }));
      const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
      expect(res.status).toBe("success");
      if (res.status === "success") expect(res.media.subtitles).toHaveLength(40);
    });

    it("from what the player's own page lists", async () => {
      const net = scripted(hops({ playerTracks: list(100) }));
      const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
      expect(res.status).toBe("success");
      if (res.status === "success") expect(res.media.subtitles).toHaveLength(40);
    });

    it("from what the subtitle site lists for the title", async () => {
      const strem = Array.from({ length: 100 }, (_, i) => ({ id: String(i), url: `https://sub.example/${i}.srt`, lang: `l${i}` }));
      const net = scripted(hops({ imdb: "tt0133093", strem }));
      const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
      expect(res.status).toBe("success");
      if (res.status === "success") expect(res.media.subtitles).toHaveLength(40);
      expect(net.asked.some((url) => url.hostname === "opensubtitles-v3.strem.io")).toBe(true);
    });
  });

  it("lists no more than four hundred episodes of a series, however many the player says there are", async () => {
    const season = Array.from({ length: 300 }, (_, i) => i + 1);
    const net = scripted(hops({ eps: { "1": season, "2": season, "3": season } }));
    const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(new URL("https://filmpire.cc/watch/1399?s=1&e=1"));
    expect(res.status).toBe("success");
    if (res.status === "success") expect(res.media.series?.episodes).toHaveLength(400);
  });

  describe("an address that the sites name inside this machine's network is never asked", () => {
    /** The fixed sites of the adapter are answered here; whatever else it asks goes the way it does in production: through the check of addresses. */
    const guardedPast = (over: Hops) => scripted(hops(over), providerFetch());
    const none = () => expect(hits).toEqual([]);

    it("the container named by the first site", async () => {
      const net = guardedPast({ container: `${local}/container` });
      const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
      expect(res.status).toBe("temporary_failure");
      expect(net.asked.some((url) => url.href.startsWith(local))).toBe(true); // (it was asked for, and turned away)
      none();
    });

    it("the player named by the container", async () => {
      const net = guardedPast({ player: `${local}/player` });
      expect((await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE)).status).toBe("temporary_failure");
      none();
    });

    it("the address for the stream's questions named by the player", async () => {
      const net = guardedPast({ api: `${local}/stream?x=1` });
      expect((await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE)).status).toBe("temporary_failure");
      none();
    });

    it("the module that decrypts the streams named by the stream's answer", async () => {
      const net = guardedPast({ streams: "c2VhbGVk", wasm: `${local}/module.wasm` });
      expect((await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE)).status).toBe("temporary_failure");
      expect(net.asked.some((url) => url.href.startsWith(local))).toBe(true);
      none();
    });

    it("the host of a stream, asked for its token", async () => {
      const net = guardedPast({ streams: [`${local}/a.m3u8`] });
      const res = await createFilmpireAdapter({ fetch: net.fetch }).resolve(MOVIE);
      expect(res.status).toBe("success"); // (the stream is for the screen to play, not for this server to fetch)
      expect(net.asked.some((url) => url.href === `${local}/generate.php`)).toBe(true);
      none();
    });
  });
});

describe("the host token cache", () => {
  it("holds a hundred hosts at most, the oldest going first", async () => {
    let asked = 0;
    const get = (async () => {
      asked++;
      return new Response("a-token");
    }) as unknown as typeof fetch;
    const origin = (i: number) => `https://host${i}.cache.example`;
    for (let i = 0; i < 105; i++) await getHostToken(get, origin(i), PLAYER);
    expect(asked).toBe(105);
    await getHostToken(get, origin(104), PLAYER);
    expect(asked).toBe(105); // (the newest is still kept)
    await getHostToken(get, origin(0), PLAYER);
    expect(asked).toBe(106); // (the oldest is not)
  });

  it("does not keep, or hand out, a token too long to be part of an address", async () => {
    const get = (async () => new Response("t".repeat(5000))) as unknown as typeof fetch;
    expect(await getHostToken(get, "https://long.cache.example", PLAYER)).toBe("");
  });

  it("takes a token of the longest length that can be part of an address, and none longer", async () => {
    const give = (length: number) => (async () => new Response("t".repeat(length))) as unknown as typeof fetch;
    expect(await getHostToken(give(1900), "https://longest.cache.example", PLAYER)).toBe("t".repeat(1900));
    expect(await getHostToken(give(1901), "https://too-long.cache.example", PLAYER)).toBe("");
  });
});

describe("the animeheaven adapter", () => {
  const EPISODE = new URL("https://animeheaven.me/anime.php?pynn3&s=1&e=1&key=6f31e2ab5faa70eb14183e66185b46e3");
  const answers = (sources: string[]) => (url: URL) => {
    if (url.pathname === "/gate.php") return new Response(`<video>${sources.map((src) => `<source src='${src}' type='video/mp4'>`).join("")}</video>`);
    return undefined;
  };

  it("leaves out a stream that is not an http(s) address, and takes no more than twelve", async () => {
    const key = "6f31e2ab5faa70eb14183e66185b46e3";
    // (The ones that are not addresses carry the key as well, which is what the genuine ones are told by.)
    const sources = [`javascript:void(${key})`, `/relative.mp4?${key}`, `data:video/mp4;base64,${key}`, ...Array.from({ length: 40 }, (_, i) => `https://s${i}.animeheaven.me/v.mp4?${key}&${i}`)];
    const net = scripted(answers(sources));
    const res = await createAnimeHeavenAdapter({ fetch: net.fetch }).resolve(EPISODE);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toBe(`https://s0.animeheaven.me/v.mp4?${key}&0`);
      expect(res.media.alternates).toHaveLength(11);
    }
  });
});

describe("what the adapters use when they are not given a fetch", () => {
  const GATE_KEY = "6f31e2ab5faa70eb14183e66185b46e3";
  const ANIME = new URL(`https://animeheaven.me/anime.php?pynn3&s=1&e=1&key=${GATE_KEY}`);
  const animeAnswers = (url: URL) => (url.pathname === "/gate.php" ? new Response(`<source src='https://zz.animeheaven.me/v.mp4?${GATE_KEY}' type='video/mp4'>`) : undefined);
  /** The global fetch must not be asked anything; `providerFetch()` is what hands out the fetch, and the test hands out one of its own. */
  const noGlobalFetch = () => {
    const global = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", global);
    return global;
  };

  it("the filmpire adapter asks through providerFetch(), not the global fetch", async () => {
    const global = noGlobalFetch();
    const net = scripted(hops());
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    const res = await createFilmpireAdapter().resolve(new URL("https://filmpire.cc/movie/603"));
    expect(res.status).toBe("success");
    expect(net.asked.length).toBeGreaterThan(5);
    expect(global).not.toHaveBeenCalled();
  });

  it("the animeheaven adapter asks through providerFetch(), not the global fetch", async () => {
    const global = noGlobalFetch();
    const net = scripted(animeAnswers);
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    const res = await createAnimeHeavenAdapter().resolve(ANIME);
    expect(res.status).toBe("success");
    expect(net.asked.length).toBeGreaterThan(0);
    expect(global).not.toHaveBeenCalled();
  });

  it("the resolver the server is built with gives both the same providerFetch, held to public addresses", async () => {
    const global = noGlobalFetch();
    const net = scripted((url) => hops()(url) ?? animeAnswers(url));
    vi.mocked(providerFetch).mockReturnValueOnce(net.fetch);
    const resolve = createResolver({ log: { info: () => {} } });
    expect((await resolve("https://filmpire.cc/movie/603")).status).toBe("success");
    expect((await resolve(ANIME.href)).status).toBe("success");
    expect(new Set(net.asked.map((url) => url.hostname))).toContain("animeheaven.me");
    expect(new Set(net.asked.map((url) => url.hostname))).toContain("screenfetch4.cyou");
    expect(global).not.toHaveBeenCalled();
    const policy = vi.mocked(providerFetch).mock.calls.at(-1)?.[0]?.isAllowedAddress;
    expect(policy?.("93.184.216.34")).toBe(true);
    for (const private_ of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1"]) expect(policy?.(private_), private_).toBe(false);
  });

  it("the private network is open to it only when the server is set up for that (tests and development)", () => {
    createResolver({ log: { info: () => {} }, allowPrivateNetwork: true });
    expect(vi.mocked(providerFetch).mock.calls.at(-1)?.[0]?.isAllowedAddress?.("127.0.0.1")).toBe(true);
  });
});