import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createHiAnimeAdapter } from "./adapters/hianime";
import { createFilmpireAdapter, resolveVidLinkStream, resolveVixSrcStream } from "./adapters/filmpire";
import { createSitefilmeAdapter } from "./adapters/sitefilme";
import { rememberPlayerSeasons } from "../library/filmpire";

describe("adapters streaming proxy configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("routes stream through /api/proxy by default", async () => {
    delete process.env.EDGE_STREAM_PROXY_URL;
    delete process.env.DIRECT_STREAMING;

    // Mock safeFetch and extractMedia
    vi.doMock("./safe-fetch", () => ({
      safeFetch: async () => ({
        url: new URL("https://sitefilme.com/movie-1"),
        body: '<video src="https://stf05.vip/video.m3u8"></video>',
        status: 200,
        contentType: "text/html",
        truncated: false,
      }),
    }));

    const adapter = createSitefilmeAdapter();
    const res = await adapter.resolve(new URL("https://sitefilme.com/movie-1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.url).toMatch(/^\/api\/proxy\?url=/);
    }
  });

  it("routes stream through EDGE_STREAM_PROXY_URL when set", async () => {
    process.env.EDGE_STREAM_PROXY_URL = "https://kino-edge.workers.dev";
    delete process.env.DIRECT_STREAMING;

    vi.doMock("./safe-fetch", () => ({
      safeFetch: async () => ({
        url: new URL("https://sitefilme.com/movie-1"),
        body: '<video src="https://stf05.vip/video.m3u8"></video>',
        status: 200,
        contentType: "text/html",
        truncated: false,
      }),
    }));

    const adapter = createSitefilmeAdapter();
    const res = await adapter.resolve(new URL("https://sitefilme.com/movie-1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.url).toMatch(/^https:\/\/kino-edge\.workers\.dev\?url=/);
    }
  });

  it("returns raw stream URL directly when DIRECT_STREAMING=true", async () => {
    delete process.env.EDGE_STREAM_PROXY_URL;
    process.env.DIRECT_STREAMING = "true";

    vi.doMock("./safe-fetch", () => ({
      safeFetch: async () => ({
        url: new URL("https://sitefilme.com/movie-1"),
        body: '<video src="https://stf05.vip/video.m3u8"></video>',
        status: 200,
        contentType: "text/html",
        truncated: false,
      }),
    }));

    const adapter = createSitefilmeAdapter();
    const res = await adapter.resolve(new URL("https://sitefilme.com/movie-1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.url).toBe("https://stf05.vip/video.m3u8");
    }
  });

  it("prefers the relay to the provider's own address when both are set, which a browser would be turned away from", async () => {
    process.env.EDGE_STREAM_PROXY_URL = "https://kino-edge.workers.dev";
    process.env.DIRECT_STREAMING = "true";

    vi.doMock("./safe-fetch", () => ({
      safeFetch: async () => ({
        url: new URL("https://sitefilme.com/movie-1"),
        body: '<video src="https://stf05.vip/video.m3u8"></video>',
        status: 200,
        contentType: "text/html",
        truncated: false,
      }),
    }));

    const adapter = createSitefilmeAdapter();
    const res = await adapter.resolve(new URL("https://sitefilme.com/movie-1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.url).toMatch(/^https:\/\/kino-edge\.workers\.dev\?url=/);
    }
  });
});

describe("createFilmpireAdapter", () => {
  it("includes filmpire.cc and www.filmpire.cc in supported domains", () => {
    const adapter = createFilmpireAdapter();
    expect(adapter.domains).toContain("filmpire.cc");
    expect(adapter.domains).toContain("www.filmpire.cc");
    expect(adapter.domains).toContain("filmpire.sc");
  });

  it("returns invalid_url when TMDB ID is absent", async () => {
    const adapter = createFilmpireAdapter();
    const res = await adapter.resolve(new URL("https://filmpire.cc/browse"));
    expect(res.status).toBe("invalid_url");
  });

  it("asks TMDB with the key the site is set up with (TMDB_API_KEY)", async () => {
    vi.stubEnv("TMDB_API_KEY", "configured-test-key");
    vi.resetModules();
    const asked: string[] = [];
    // (A fake network: nothing is sent anywhere, and every answer is a failure, so the adapter gives up after its first questions.)
    const fake = (async (input: unknown) => {
      asked.push(String(input));
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    try {
      const { createFilmpireAdapter: fresh } = await import("./adapters/filmpire");
      await fresh({ fetch: fake }).resolve(new URL("https://filmpire.cc/movie/603"));
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
    const toTmdb = asked.map((url) => new URL(url)).filter((url) => url.hostname === "api.themoviedb.org");
    expect(toTmdb.map((url) => url.searchParams.get("api_key"))).toEqual(["configured-test-key"]);
  });

  it("has no key written into it, in either of the two places it asks TMDB", async () => {
    // (The second place is reached only after the answers of the player's site, which a test does not make up: the source is looked at instead.)
    const source = await readFile(new URL("./adapters/filmpire.ts", import.meta.url), "utf8");
    expect((source.match(/api_key=[0-9a-f]{32}/gi) ?? []).length).toBe(0);
    expect((source.match(/api\.themoviedb\.org[^`]*api_key=\$\{FILMPIRE_TMDB_API_KEY\}/g) ?? []).length).toBe(2);
  });
});

describe("createAnimeHeavenAdapter", () => {
  it("includes animeheaven.me in supported domains", () => {
    const adapter = createAnimeHeavenAdapter();
    expect(adapter.domains).toContain("animeheaven.me");
    expect(adapter.domains).toContain("www.animeheaven.me");
  });

  it("resolves direct mp4 streams and filters sponsor video", async () => {
    const fakeAnimeHtml = `
      <div class='infotitle c'>Dragon Ball Super: Beerus</div>
      <a class='c' id="6f31e2ab5faa70eb14183e66185b46e3" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>1</div>
      </a>
      <a class='c' id="fdf3cd8f7a34be5bb5cbb095841aed93" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>2</div>
      </a>
    `;

    const fakeGateHtml = `
      <video id='vid'>
        <source src='https://sponsor.animeheaven.me/video.mp4?ad12345' type='video/mp4'>
        <source src='https://zz.animeheaven.me/video.mp4?6f31e2ab5faa70eb14183e66185b46e3&hash1' type='video/mp4'>
        <source src='https://ct.animeheaven.me/video.mp4?6f31e2ab5faa70eb14183e66185b46e3&hash2' type='video/mp4'>
      </video>
    `;

    const fake = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("anime.php")) {
        return { ok: true, status: 200, text: async () => fakeAnimeHtml };
      }
      if (u.includes("gate.php")) {
        return { ok: true, status: 200, text: async () => fakeGateHtml };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createAnimeHeavenAdapter({ fetch: fake });
    const res = await adapter.resolve(new URL("https://animeheaven.me/anime.php?pynn3&s=1&e=1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.title).toBe("Dragon Ball Super: Beerus · Episode 1");
      expect(res.media.stream.type).toBe("mp4");
      // Must use the real episode stream, not the sponsor ad
      expect(res.media.stream.directUrl).toContain("zz.animeheaven.me");
      expect(res.media.stream.directUrl).toContain("6f31e2ab5faa70eb14183e66185b46e3");
      expect(res.media.alternates).toHaveLength(1);
      expect(res.media.alternates?.[0]?.stream.directUrl).toContain("ct.animeheaven.me");
      expect(res.media.series?.next?.episode).toBe(2);
    }
  });
  it("routes anime and cartoons via fast-path without stalling through slow upstream", async () => {
    let screenfetchCalled = false;
    let animeHeavenCalled = false;

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 99999,
            name: "Test Anime Series",
            original_language: "ja",
            genres: [{ id: 16 }],
          }),
        };
      }
      if (u.includes("vidlink.pro/api/b/tv/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stream: {
              type: "file",
              qualities: {
                "1080": { url: "https://bcdn.hakunaymatata.com/1080.mp4", type: "mp4" },
                "720": { url: "https://bcdn.hakunaymatata.com/720.mp4", type: "mp4" },
                "480": { url: "https://bcdn.hakunaymatata.com/480.mp4", type: "mp4" },
              },
            },
          }),
        };
      }
      if (u.includes("screenfetch4.cyou") || u.includes("vidsrc.me")) {
        screenfetchCalled = true;
        return { ok: false, status: 504 };
      }
      if (u.includes("animeheaven.me")) {
        animeHeavenCalled = true;
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    const res = await adapter.resolve(new URL("https://filmpire.sc/watch/99999?s=1&e=1&section=anime"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.type).toBe("mp4");
      expect(res.media.stream.directUrl).toBe("https://bcdn.hakunaymatata.com/1080.mp4");
      // Fast path took VidLink immediately, skipping slow upstream retries
      expect(screenfetchCalled).toBe(false);
      // Multiple VidLink qualities mean AnimeHeaven was not needed
      expect(animeHeavenCalled).toBe(false);
    }
  });

  it("skips AnimeHeaven fallback for Western animation with English original language", async () => {
    let animeHeavenCalled = false;

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 88888,
            name: "Western Cartoon Show",
            original_language: "en",
            genres: [{ id: 16 }],
          }),
        };
      }
      if (u.includes("vidlink.pro/api/b/tv/")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("vidsrc.buzz")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("animeheaven.me")) {
        animeHeavenCalled = true;
        return { ok: true, status: 200, text: async () => "<html></html>" };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    await adapter.resolve(new URL("https://filmpire.sc/watch/88888?s=1&e=1"));
    expect(animeHeavenCalled).toBe(false);
  });

  it("normalizes bcdn numbered subdomains to canonical bcdn.hakunaymatata.com in VidLink resolver", async () => {
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("vidlink.pro/api/b/movie/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            stream: {
              type: "file",
              playlist: "https://bcdn4.hakunaymatata.com/live/playlist.m3u8?sign=123",
              qualities: {
                "1080": { url: "https://bcdn4.hakunaymatata.com/extto/test1080.mp4?sign=abc&t=123", type: "mp4" },
                "720": { url: "https://bcdn2.hakunaymatata.com/resource/test720.mp4?sign=def&t=123", type: "mp4" },
              },
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const res = await resolveVidLinkStream(fakeFetch, "12345", false);
    expect(res).not.toBeNull();
    expect(res?.streamUrl).toBe("https://bcdn.hakunaymatata.com/live/playlist.m3u8?sign=123");
    expect(res?.qualities[0]?.url).toBe("https://bcdn.hakunaymatata.com/live/playlist.m3u8?sign=123");
    expect(res?.qualities[1]?.url).toBe("https://bcdn.hakunaymatata.com/extto/test1080.mp4?sign=abc&t=123");
    expect(res?.qualities[2]?.url).toBe("https://bcdn.hakunaymatata.com/resource/test720.mp4?sign=def&t=123");
  });

  it("resolves long-running anime with named seasons via AnimeHeaven fallback (e.g. Pokemon S25 E6 Ultimate Journeys)", async () => {
    const fakeSearchHtml = `
      <div class='boldtext'>
        <div class='info3 bc1'>
          <div class='similarimg'>
            <div class='p1'>
              <a href='anime.php?pk999'>
                <img class='coverimg' src='image.php?pkimg' alt='Pokemon Ultimate Journeys: The Series'>
              </a>
              <div class='similarname c'>
                <a href='anime.php?pk999' class='c'>Pokemon Ultimate Journeys: The Series</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const fakeEpisodesHtml = `
      <div class='infotitle c'>Pokemon Ultimate Journeys: The Series</div>
      <a class='c' id="55555555555555555555555555555555" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>5</div>
      </a>
      <a class='c' id="66666666666666666666666666666666" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>6</div>
      </a>
      <a class='c' id="77777777777777777777777777777777" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>7</div>
      </a>
    `;

    const fakeGateHtml = `
      <video id='vid'>
        <source src='https://cdn.animeheaven.me/pokemon-s25-e6.mp4?66666666666666666666666666666666' type='video/mp4'>
      </video>
    `;

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org/3/tv/60572")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 60572,
            name: "Pokémon",
            original_language: "ja",
            genres: [{ id: 16 }],
            seasons: [
              { season_number: 1, name: "Indigo League", episode_count: 82 },
              { season_number: 24, name: "Master Journeys", episode_count: 42 },
              { season_number: 25, name: "Ultimate Journeys", episode_count: 57 },
              { season_number: 26, name: "Horizons", episode_count: 45 },
            ],
          }),
        };
      }
      if (u.includes("vidlink.pro")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("vidsrc.buzz") || u.includes("screenfetch4.cyou") || u.includes("vidsrc.me")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("animeheaven.me/search.php")) {
        return { ok: true, status: 200, text: async () => fakeSearchHtml };
      }
      if (u.includes("animeheaven.me/anime.php")) {
        return { ok: true, status: 200, text: async () => fakeEpisodesHtml };
      }
      if (u.includes("animeheaven.me/gate.php")) {
        return { ok: true, status: 200, text: async () => fakeGateHtml };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    const res = await adapter.resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.title).toBe("Pokémon · S25 E6");
      expect(res.media.stream.type).toBe("mp4");
      expect(res.media.stream.directUrl).toContain("pokemon-s25-e6.mp4");
      expect(res.media.series?.season).toBe(25);
      expect(res.media.series?.episode).toBe(6);
    }
  });

  it("resolves continuous/absolute-numbered anime via AnimeHeaven fallback (e.g. Detective Conan S2 E5 -> Ep 47)", async () => {
    const fakeSearchHtml = `
      <div class='boldtext'>
        <div class='info3 bc1'>
          <div class='similarimg'>
            <div class='p1'>
              <a href='anime.php?conan123'>
                <img class='coverimg' src='image.php?conanimg' alt='Detective Conan'>
              </a>
              <div class='similarname c'>
                <a href='anime.php?conan123' class='c'>Detective Conan</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const fakeEpisodesHtml = `
      <div class='infotitle c'>Detective Conan</div>
      <a class='c' id="11111111111111111111111111111111" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>1</div>
      </a>
      <a class='c' id="47474747474747474747474747474747" href='gate.php'>
        <div class='watch1'>Episode</div>
        <div class='watch2'>47</div>
      </a>
    `;

    const fakeGateHtml = `
      <video id='vid'>
        <source src='https://cdn.animeheaven.me/conan-ep-47.mp4?47474747474747474747474747474747' type='video/mp4'>
      </video>
    `;

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org/3/tv/235")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 235,
            name: "Detective Conan",
            original_language: "ja",
            genres: [{ id: 16 }],
            seasons: [
              { season_number: 1, name: "Season 1", episode_count: 42 },
              { season_number: 2, name: "Season 2", episode_count: 43 },
            ],
          }),
        };
      }
      if (u.includes("vidlink.pro")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("vidsrc.buzz") || u.includes("screenfetch4.cyou") || u.includes("vidsrc.me")) {
        return { ok: false, status: 404 };
      }
      if (u.includes("animeheaven.me/search.php")) {
        return { ok: true, status: 200, text: async () => fakeSearchHtml };
      }
      if (u.includes("animeheaven.me/anime.php")) {
        return { ok: true, status: 200, text: async () => fakeEpisodesHtml };
      }
      if (u.includes("animeheaven.me/gate.php")) {
        return { ok: true, status: 200, text: async () => fakeGateHtml };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    const res = await adapter.resolve(new URL("https://filmpire.sc/watch/235?s=2&e=5"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.title).toBe("Detective Conan · S2 E5");
      expect(res.media.stream.type).toBe("mp4");
      expect(res.media.stream.directUrl).toContain("conan-ep-47.mp4");
      expect(res.media.series?.season).toBe(2);
      expect(res.media.series?.episode).toBe(5);
    }
  });
});
/**
 * TMDB, VidLink, Buzz and the anime site as a test has them (all made up here: nothing is asked of the real ones). The site's search answers by the
 * words asked (`titles`), and each of its titles lists the episodes in `episodes`. Buzz has the episode when `buzz` is set.
 */
function animeWorld(options: {
  tmdbId: string;
  tmdb: Record<string, unknown>;
  titles: (words: string) => Array<{ slug: string; name: string }>;
  episodes: Record<string, number[]>;
  buzz?: boolean;
  /** "hang": VidLink answers nothing until it is given up on (as it does for a title it does not have). */
  vidlink?: boolean | "hang";
}): typeof fetch {
  const card = ({ slug, name }: { slug: string; name: string }) =>
    `<div class='similarimg'><div class='p1'><a href='anime.php?${slug}'><img class='coverimg' src='image.php?${slug}' alt='${name}'></a><div class='similarname c'><a href='anime.php?${slug}' class='c'>${name}</a></div></div></div>`;
  const id = (slug: string, episode: number) => `${slug}${episode}`.replace(/[^0-9a-f]/g, "a").padEnd(32, "0").slice(0, 32);
  return (async (url: string | URL, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const u = new URL(String(url));
    const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
    if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith(`/tv/${options.tmdbId}`)) return { ok: true, status: 200, json: async () => options.tmdb };
    if (u.hostname === "vidlink.pro" && options.vidlink === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError"))));
    }
    if (u.hostname === "vidlink.pro" && options.vidlink) {
      return text(JSON.stringify({ stream: { playlist: "https://cdn.vidlink.test/master.m3u8" } }));
    }
    if (u.hostname.endsWith("vidsrc.buzz") && options.buzz) {
      if (u.pathname.startsWith("/embed/")) return text(`<script>var Q = {"t":"tok","ssr":{"servers":[{"ref":"r1","name":"One"}]}};</script>`);
      if (u.pathname.startsWith("/pl/")) return text(JSON.stringify({ url: "https://cdn.buzz.test/episode/master.m3u8", type: "hls" }));
    }
    if (u.hostname.endsWith("animeheaven.me")) {
      if (u.pathname.endsWith("/search.php")) return text(`<div class='boldtext'><div class='info3 bc1'>${options.titles(u.searchParams.get("s") ?? "").map(card).join("")}</div></div>`);
      if (u.pathname.endsWith("/anime.php")) {
        const slug = u.search.slice(1);
        const name = Object.keys(options.episodes).includes(slug) ? slug : "";
        return text(`<div class='infotitle c'>${name}</div>${(options.episodes[slug] ?? []).map((n) => `<a class='c' id="${id(slug, n)}" href='gate.php'><div class='watch1'>Episode</div><div class='watch2'>${n}</div></a>`).join("")}`);
      }
      // (The episode's file is named after the title it is from, which the gate is asked from: so a test can tell which title played.)
      if (u.pathname.endsWith("/gate.php")) {
        const from = /anime\.php\?([a-z0-9]+)/i.exec(init?.headers?.Referer ?? "")?.[1] ?? "episode";
        return text(`<video id='vid'><source src='https://cdn.animeheaven.me/${from}.mp4?x' type='video/mp4'></video>`);
      }
    }
    return { ok: false, status: 404 };
  }) as unknown as typeof fetch;
}

const POKEMON_SEASONS = Array.from({ length: 26 }, (_, i) => ({ season_number: i + 1, name: i === 24 ? "Ultimate Journeys" : `Series ${i + 1}`, episode_count: 40 }));

describe("the anime site for a show TMDB keeps as one with many seasons", () => {
  it("plays no episode of another series when the season is not found and the count from the first episode is not there either", async () => {
    // (The site has only the first series, "Pokemon", episodes 1 to 10: season 25 is not on it, and episode 966 of the first series is not either. Episode 6 of
    // the first series is not season 25's episode 6.)
    const get = animeWorld({
      tmdbId: "60572",
      tmdb: { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons: POKEMON_SEASONS },
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemon", name: "Pokemon" }] : []),
      episodes: { pokemon: Array.from({ length: 10 }, (_, i) => i + 1) },
    });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).not.toBe("success");
  });

  it("keeps the order of the sources for anime: VidLink, when it has the episode, before the anime site", async () => {
    const get = animeWorld({
      tmdbId: "60572",
      tmdb: { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons: POKEMON_SEASONS },
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemonuj", name: "Pokemon Ultimate Journeys: The Series" }] : []),
      episodes: { pokemonuj: [5, 6, 7] },
      vidlink: true,
    });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).toBe("success");
    if (res.status === "success") expect(res.media.stream.directUrl).toContain("cdn.vidlink.test");
  });

  it("does not take another show's title that has the season's name in it", async () => {
    // (A search with the season's name finds another show's "Ultimate Journeys", as a site's loose search can; the show's own name finds nothing of season 25.)
    const get = animeWorld({
      tmdbId: "60572",
      tmdb: { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons: POKEMON_SEASONS.map((season) => ({ ...season, episode_count: undefined })) },
      titles: (words) => (/ultimate journeys/i.test(words) ? [{ slug: "digimonuj", name: "Digimon Ultimate Journeys" }] : /pokemon/i.test(words) ? [{ slug: "pokemon", name: "Pokemon" }] : []),
      episodes: { pokemon: [1, 2, 3], digimonuj: [5, 6, 7] },
    });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).not.toBe("success");
  });

  it("looks for the numbering from the first episode in the show itself, not in another show the search found", async () => {
    // (Naruto's season 2 episode 5 is its 40th; "Boruto: Naruto Next Generations", which the search finds first, has a 40th episode too.)
    const get = animeWorld({
      tmdbId: "46260",
      tmdb: { id: 46260, name: "Naruto", original_language: "ja", genres: [{ id: 16 }], seasons: [{ season_number: 1, name: "Season 1", episode_count: 35 }, { season_number: 2, name: "Season 2", episode_count: 48 }] },
      titles: (words) => (/naruto/i.test(words) ? [{ slug: "boruto", name: "Boruto: Naruto Next Generations" }] : []),
      episodes: { boruto: Array.from({ length: 60 }, (_, i) => i + 1) },
    });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/46260?s=2&e=5"));
    expect(res.status).not.toBe("success");
  });

  it("does not take a sequel or spin-off whose title begins with the show's name for the numbering from the first episode", async () => {
    const naruto = { id: 46260, name: "Naruto", original_language: "ja", genres: [{ id: 16 }], seasons: [{ season_number: 1, name: "Season 1", episode_count: 35 }, { season_number: 2, name: "Season 2", episode_count: 48 }] };
    const spinOff = animeWorld({
      tmdbId: "46260",
      tmdb: naruto,
      titles: (words) => (/naruto/i.test(words) ? [{ slug: "shippuden", name: "Naruto Shippuden" }] : []),
      episodes: { shippuden: Array.from({ length: 60 }, (_, i) => i + 1) },
    });
    expect((await createFilmpireAdapter({ fetch: spinOff }).resolve(new URL("https://filmpire.sc/watch/46260?s=2&e=5"))).status).not.toBe("success");
    // (The show itself under a name with only a "(TV)" or a year after it is still the show.)
    const itself = animeWorld({
      tmdbId: "46260",
      tmdb: naruto,
      titles: (words) => (/naruto/i.test(words) ? [{ slug: "narutotv", name: "Naruto (TV)" }] : []),
      episodes: { narutotv: Array.from({ length: 60 }, (_, i) => i + 1) },
    });
    expect((await createFilmpireAdapter({ fetch: itself }).resolve(new URL("https://filmpire.sc/watch/46260?s=2&e=5"))).status).toBe("success");
  });
});

describe("the anime site: a season is never another season's title", () => {
  // (TMDB keeps Pokémon as one show; its seasons have the names of the series. None of these is on the site but the ones a test lists.)
  const NAMES: Record<number, string> = { 1: "Indigo League", 23: "Journeys", 24: "Master Journeys", 25: "Ultimate Journeys" };
  const seasons = Array.from({ length: 25 }, (_, i) => ({ season_number: i + 1, name: NAMES[i + 1] ?? `Series ${i + 1}`, episode_count: 40 }));
  const pokemon = { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons };
  const resolve = (titles: Array<{ slug: string; name: string }>, s: number, e: number) =>
    createFilmpireAdapter({ fetch: animeWorld({ tmdbId: "60572", tmdb: pokemon, titles: (words) => (/pokemon/i.test(words) ? titles : []), episodes: Object.fromEntries(titles.map((title) => [title.slug, Array.from({ length: 12 }, (_, i) => i + 1)])) }) }).resolve(
      new URL(`https://filmpire.sc/watch/60572?s=${s}&e=${e}`),
    );

  it("plays no later series for the first season: Pokémon S1 E1 is not Pokémon Horizons' first episode", async () => {
    expect((await resolve([{ slug: "horizons", name: "Pokemon Horizons: The Series" }], 1, 1)).status).not.toBe("success");
  });

  it("tells a season from one whose name has it in it: Journeys (23) is not Ultimate Journeys (25)", async () => {
    expect((await resolve([{ slug: "ultimate", name: "Pokemon Ultimate Journeys: The Series" }], 23, 3)).status).not.toBe("success");
    const both = await resolve(
      [
        { slug: "ultimate", name: "Pokemon Ultimate Journeys: The Series" },
        { slug: "journeys", name: "Pokemon Journeys: The Series" },
      ],
      23,
      3,
    );
    expect(both.status).toBe("success");
    expect(JSON.stringify(both)).toContain("journeys.mp4");
    const later = await resolve(
      [
        { slug: "journeys", name: "Pokemon Journeys: The Series" },
        { slug: "ultimate", name: "Pokemon Ultimate Journeys: The Series" },
      ],
      25,
      6,
    );
    expect(JSON.stringify(later)).toContain("ultimate.mp4");
  });

  it("still finds a first season by the show's own name, or by a name of the site's own", async () => {
    const own = await resolve([{ slug: "horizons", name: "Pokemon Horizons: The Series" }, { slug: "pokemon", name: "Pokemon" }], 1, 1);
    expect(JSON.stringify(own)).toContain("pokemon.mp4");
    // (A show the site knows by another name: TMDB's "Frieren: Beyond Journey's End" is "Sousou no Frieren" there.)
    const frieren = { id: 209867, name: "Frieren: Beyond Journey's End", original_language: "ja", genres: [{ id: 16 }], seasons: [{ season_number: 1, name: "Season 1", episode_count: 28 }] };
    const get = animeWorld({ tmdbId: "209867", tmdb: frieren, titles: () => [{ slug: "sousou", name: "Sousou no Frieren" }], episodes: { sousou: [1, 2, 3] } });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/209867?s=1&e=2"));
    expect(JSON.stringify(res)).toContain("sousou.mp4");
  });

  it("keeps the order of sources: VidLink before AnimeHeaven", async () => {
    // When VidLink has the episode, it is preferred over AnimeHeaven
    const getWithVidlink = animeWorld({
      tmdbId: "60572",
      tmdb: pokemon,
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemonuj", name: "Pokemon Ultimate Journeys: The Series" }] : []),
      episodes: { pokemonuj: [5, 6, 7] },
      vidlink: true,
    });
    const resVl = await createFilmpireAdapter({ fetch: getWithVidlink }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(resVl.status).toBe("success");
    if (resVl.status === "success") expect(resVl.media.stream.directUrl).toContain("cdn.vidlink.test");

    // When VidLink is absent, AnimeHeaven is taken
    const getWithAh = animeWorld({
      tmdbId: "60572",
      tmdb: pokemon,
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemonuj", name: "Pokemon Ultimate Journeys: The Series" }] : []),
      episodes: { pokemonuj: [5, 6, 7] },
      vidlink: false,
    });
    const resAh = await createFilmpireAdapter({ fetch: getWithAh }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(resAh.status).toBe("success");
    if (resAh.status === "success") expect(resAh.media.stream.directUrl).toContain("pokemonuj.mp4");
  });

  it("VidLink aborts promptly within the configured timeout when an episode hangs", async () => {
    let aborted = false;
    const hangingFetch = ((_url: string | URL, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const res = await resolveVidLinkStream(hangingFetch, "60572", true, "25", "6", 50);
    expect(res).toBeNull();
    expect(aborted).toBe(true);
  });

  it("an anime episode VidLink does not answer for is played from AnimeHeaven after 2.5 s, not after VidLink's usual 6", { timeout: 20_000 }, async () => {
    const get = animeWorld({
      tmdbId: "60572",
      tmdb: pokemon,
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemonuj", name: "Pokemon Ultimate Journeys: The Series" }] : []),
      episodes: { pokemonuj: [5, 6, 7] },
      vidlink: "hang",
    });
    const started = Date.now();
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    const took = Date.now() - started;
    expect(res.status).toBe("success");
    if (res.status === "success") expect(res.media.stream.directUrl).toContain("pokemonuj.mp4");
    expect(took).toBeGreaterThanOrEqual(2_400);
    expect(took).toBeLessThan(5_000);
  });

  it("an anime request with no sources returns unsupported without querying fallback streams twice", async () => {
    const queriedHosts: string[] = [];
    const trackingFetch = (async (url: string | URL, init?: { headers?: Record<string, string> }) => {
      const u = new URL(String(url));
      queriedHosts.push(u.hostname);
      return animeWorld({
        tmdbId: "60572",
        tmdb: pokemon,
        titles: () => [],
        episodes: {},
        buzz: false,
        vidlink: false,
      })(url, init);
    }) as unknown as typeof fetch;

    const res = await createFilmpireAdapter({ fetch: trackingFetch }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).not.toBe("success");

    // VidLink was queried exactly once (never twice even when upstream containerUrl lookups fail)
    const vidlinkQueries = queriedHosts.filter((h) => h === "vidlink.pro");
    expect(vidlinkQueries.length).toBe(1);
  });
});

describe("HiAnime provider and multi-season anime fallback", () => {
  const NAMES: Record<number, string> = {
    1: "Indigo League",
    23: "Pokémon Journeys: The Series",
    24: "Pokémon Master Journeys: The Series",
    25: "Pokémon Ultimate Journeys: The Series",
  };
  const seasons = Array.from({ length: 25 }, (_, i) => ({
    season_number: i + 1,
    name: NAMES[i + 1] ?? `Series ${i + 1}`,
    episode_count: i === 22 ? 48 : i === 23 ? 42 : i === 24 ? 46 : 40,
  }));
  const pokemonTmdb = { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons };

  function makeZokoBlob(json: object): string {
    const jsonStr = JSON.stringify(json);
    const buf = Buffer.from(jsonStr, "utf8");
    const keyBuf = Buffer.from("otaku-embed-v1", "utf8");
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
      out[i] = buf[i]! ^ keyBuf[i % keyBuf.length]!;
    }
    return out.toString("base64");
  }

  function mockAnimeWorldWithHiAnime(options: {
    tmdbId?: string;
    tmdb?: Record<string, unknown>;
    hiEpisodes?: number[];
  }): typeof fetch {
    const requestedEpisodes = options.hiEpisodes ?? Array.from({ length: 146 }, (_, i) => i + 1);

    return (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith(`/tv/${options.tmdbId ?? "60572"}`)) {
        return { ok: true, status: 200, json: async () => options.tmdb ?? pokemonTmdb };
      }

      // AnimeHeaven only has Horizons
      if (u.hostname.endsWith("animeheaven.me")) {
        if (u.pathname.endsWith("/search.php")) {
          return text("<div class='boldtext'><div class='info3 bc1'><div class='similarimg'><div class='p1'><a href='anime.php?horizons'><img class='coverimg' src='image.php?horizons' alt='Pokemon Horizons'></a><div class='similarname c'><a href='anime.php?horizons' class='c'>Pokemon Horizons: The Series</a></div></div></div></div></div>");
        }
        if (u.pathname.endsWith("/anime.php")) {
          return text("<div class='infotitle c'>Pokemon Horizons: The Series</div><a class='c' id='horizons1' href='gate.php'><div class='watch1'>Episode</div><div class='watch2'>1</div></a>");
        }
      }

      // HiAnime mock
      if (u.hostname.endsWith("hianime.at")) {
        if (u.pathname === "/search") {
          return text(`
            <div class="film-detail">
              <h3 class="film-name"><a href="/pokemon-journeys-the-series-1879" title="Pokemon Journeys: The Series">Pokemon Journeys</a></h3>
            </div>
            <div class="film-detail">
              <h3 class="film-name"><a href="/pokemon-7102" title="Pokémon">Pokémon</a></h3>
            </div>
          `);
        }
        if (u.pathname.startsWith("/api/theme/episode/list/")) {
          const epHtml = requestedEpisodes.map((n) => `<a class="ep-item" data-id="${10000 + n}" data-number="${n}" title="Episode ${n}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.startsWith("/api/theme/episode/servers")) {
          const epId = u.searchParams.get("episodeId") || "10001";
          const subEmbed = `https://zokoanime.video/stream/mal/40351/${epId}/sub`;
          return text(JSON.stringify({
            status: true,
            html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>`,
          }));
        }
      }

      // ZokoAnime mock
      if (u.hostname === "zokoanime.video") {
        const match = u.pathname.match(/\/stream\/mal\/40351\/(\d+)\/sub/);
        const epNum = match ? match[1] : "1";
        const blob = makeZokoBlob({
          src: `https://cdn.hianime.test/pokemon/${epNum}/master.m3u8`,
          subtitles: [{ lang: "en", label: "English", src: `https://cdn.hianime.test/pokemon/${epNum}/sub.vtt`, default: true }],
        });
        return text(`<html><script>window.__P="${blob}";</script></html>`);
      }

      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;
  }

  it("resolves Pokémon S23 E3 via HiAnime when VidLink, Buzz, and AnimeHeaven do not have it", async () => {
    const fetcher = mockAnimeWorldWithHiAnime({});
    const res = await createFilmpireAdapter({ fetch: fetcher }).resolve(new URL("https://filmpire.sc/watch/60572?s=23&e=3"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toContain("cdn.hianime.test/pokemon/10003/master.m3u8");
      expect(res.media.subtitles?.[0]?.lang).toBe("en");
    }
  });

  it("resolves Pokémon S25 E6 via HiAnime by calculating umbrella episode offset 96", async () => {
    const fetcher = mockAnimeWorldWithHiAnime({});
    const res = await createFilmpireAdapter({ fetch: fetcher }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      // S23 (48) + S24 (42) + 6 = 96 -> internal ID 10096
      expect(res.media.stream.directUrl).toContain("cdn.hianime.test/pokemon/10096/master.m3u8");
      expect(res.media.subtitles?.[0]?.lang).toBe("en");
    }
  });

  it("resolves Yu Yu Hakusho S1 E1 to Ghost Files and never matches One Piece from search results", async () => {
    const yuyuTmdb = {
      id: 30669,
      name: "Yu Yu Hakusho",
      original_name: "幽☆遊☆白書",
      original_language: "ja",
      genres: [{ id: 16 }],
      seasons: [
        { season_number: 1, name: "The Spirit Detective", episode_count: 25 },
        { season_number: 2, name: "The Dark Tournament", episode_count: 41 },
      ],
    };

    const fetcher = (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/tv/30669")) {
        return { ok: true, status: 200, json: async () => yuyuTmdb };
      }

      if (u.hostname.endsWith("hianime.at")) {
        if (u.pathname === "/search") {
          return text(`
            <div class="film_list-wrap">
              <div class="film-detail">
                <h3 class="film-name"><a href="/yu-yu-hakusho-ghost-files-906" title="Yu Yu Hakusho: Ghost Files">Yu Yu Hakusho: Ghost Files</a></h3>
              </div>
            </div>
            <div id="main-sidebar">
              <div class="film-detail">
                <h3 class="film-name"><a href="/one-piece-1" title="One Piece">One Piece</a></h3>
              </div>
            </div>
          `);
        }
        if (u.pathname.startsWith("/api/theme/episode/list/906")) {
          const epHtml = Array.from({ length: 112 }, (_, i) => `<a class="ep-item" data-id="${15000 + i + 1}" data-number="${i + 1}" title="Episode ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.startsWith("/api/theme/episode/servers")) {
          const epId = u.searchParams.get("episodeId") || "15001";
          const subEmbed = `https://zokoanime.video/stream/mal/392/${epId}/sub`;
          return text(JSON.stringify({
            status: true,
            html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>`,
          }));
        }
      }

      if (u.hostname === "zokoanime.video") {
        const blob = makeZokoBlob({
          src: "https://cdn.hianime.test/yuyu/1/master.m3u8",
          subtitles: [{ lang: "en", label: "English", src: "https://cdn.hianime.test/yuyu/1/sub.vtt", default: true }],
        });
        return text(`<html><script>window.__P="${blob}";</script></html>`);
      }

      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const res = await createFilmpireAdapter({ fetch: fetcher }).resolve(new URL("https://filmpire.sc/watch/30669?s=1&e=1"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toContain("cdn.hianime.test/yuyu/1/master.m3u8");
      expect(res.media.title).toBe("Yu Yu Hakusho · S1 E1");
    }
  });

  it("walks multi-cour HiAnime entries for a named TMDB season (e.g. Bleach S2 E14 -> The Separation E1, skipping recaps and duplicates)", async () => {
    const bleachTmdb = {
      id: 30984,
      name: "Bleach",
      original_language: "ja",
      genres: [{ id: 16 }],
      seasons: [
        { season_number: 1, name: "Bleach", episode_count: 366 },
        { season_number: 2, name: "Thousand-Year Blood War", episode_count: 50 },
      ],
    };

    const fetcher = (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/tv/30984")) {
        return { ok: true, status: 200, json: async () => bleachTmdb };
      }

      if (u.hostname.endsWith("hianime.at")) {
        if (u.pathname === "/search") {
          return text(`
            <div class="film_list-wrap">
              <h3 class="film-name"><a href="/bleach-1369" title="Bleach">Bleach</a></h3>
              <h3 class="film-name"><a href="/bleach-tybw-1234" title="Bleach: Thousand-Year Blood War Arc">TYBW 1</a></h3>
              <h3 class="film-name"><a href="/bleach-tybw-recap-3863" title="Bleach: Thousand-Year Blood War - The Separation Recap">Recap</a></h3>
              <h3 class="film-name"><a href="/bleach-tybw-sep-1009" title="Bleach: Thousand-Year Blood War - The Separation">TYBW 2</a></h3>
              <h3 class="film-name"><a href="/bleach-tybw-sep-dup-9999" title="BLEACH: Thousand-Year Blood War - The Separation">TYBW 2 Dup</a></h3>
              <h3 class="film-name"><a href="/bleach-tybw-conf-3859" title="Bleach: Thousand-Year Blood War - The Conflict">TYBW 3</a></h3>
            </div>
          `);
        }
        if (u.pathname.endsWith("/api/theme/episode/list/1234")) {
          const epHtml = Array.from({ length: 13 }, (_, i) => `<a class="ep-item" data-id="${21000 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.endsWith("/api/theme/episode/list/1009")) {
          const epHtml = Array.from({ length: 13 }, (_, i) => `<a class="ep-item" data-id="${22000 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.endsWith("/api/theme/episode/list/3859")) {
          const epHtml = Array.from({ length: 14 }, (_, i) => `<a class="ep-item" data-id="${23000 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.startsWith("/api/theme/episode/servers")) {
          const epId = u.searchParams.get("episodeId") || "0";
          const subEmbed = `https://zokoanime.video/stream/mal/bleach/${epId}/sub`;
          return text(JSON.stringify({
            status: true,
            html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>`,
          }));
        }
      }

      if (u.hostname === "zokoanime.video") {
        const epId = u.pathname.split("/")[4] || "0";
        const blob = makeZokoBlob({
          src: `https://cdn.hianime.test/bleach/${epId}/master.m3u8`,
          subtitles: [{ lang: "en", label: "English", src: `https://cdn.hianime.test/bleach/${epId}/sub.vtt`, default: true }],
        });
        return text(`<html><script>window.__P="${blob}";</script></html>`);
      }

      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fetcher });

    // S2 E14 -> Cour 2 (1009) Ep 1 -> data-id 22001
    const ep14 = await adapter.resolve(new URL("https://filmpire.sc/watch/30984?s=2&e=14"));
    expect(ep14.status).toBe("success");
    if (ep14.status === "success") {
      expect(ep14.media.stream.directUrl).toContain("cdn.hianime.test/bleach/22001/master.m3u8");
    }

    // S2 E27 -> Cour 3 (3859) Ep 1 -> data-id 23001
    const ep27 = await adapter.resolve(new URL("https://filmpire.sc/watch/30984?s=2&e=27"));
    expect(ep27.status).toBe("success");
    if (ep27.status === "success") {
      expect(ep27.media.stream.directUrl).toContain("cdn.hianime.test/bleach/23001/master.m3u8");
    }
  });

  it("sorts multi-cour entries by air date and aborts instead of shifting when an earlier cour fails", async () => {
    const tmdbShow = {
      id: 88801,
      name: "Chronicle Blade",
      original_language: "ja",
      genres: [{ id: 16 }],
      seasons: [
        { season_number: 1, name: "Season 1", episode_count: 12 },
        { season_number: 2, name: "Eclipse War", episode_count: 26 },
      ],
    };

    const makeFetcher = (failFirstCour: boolean) =>
      (async (url: string | URL) => {
        const u = new URL(String(url));
        const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

        if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/tv/88801")) {
          return { ok: true, status: 200, json: async () => tmdbShow };
        }
        if (u.hostname.endsWith("hianime.at")) {
          // Deliberately returned in REVERSE air order in search results!
          if (u.pathname === "/search") {
            return text(`
              <div class="film_list-wrap">
                <h3 class="film-name"><a href="/chronicle-blade-eclipse-war-b-8802" title="Chronicle Blade: Eclipse War - Act Two">Act Two</a></h3>
                <h3 class="film-name"><a href="/chronicle-blade-eclipse-war-a-8801" title="Chronicle Blade: Eclipse War - Act One">Act One</a></h3>
              </div>
            `);
          }
          if (u.pathname === "/chronicle-blade-eclipse-war-b-8802") {
            return text(`<span class="item-head">Aired:</span> <span class="name">Jul 8, 2023 to Sep 30, 2023</span>`);
          }
          if (u.pathname === "/chronicle-blade-eclipse-war-a-8801") {
            return text(`<span class="item-head">Aired:</span> <span class="name">Oct 10, 2022 to Dec 27, 2022</span>`);
          }
          if (u.pathname.endsWith("/api/theme/episode/list/8801")) {
            if (failFirstCour) return { ok: false, status: 500 };
            const epHtml = Array.from({ length: 13 }, (_, i) => `<a class="ep-item" data-id="${88100 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
            return text(JSON.stringify({ status: true, html: epHtml }));
          }
          if (u.pathname.endsWith("/api/theme/episode/list/8802")) {
            const epHtml = Array.from({ length: 13 }, (_, i) => `<a class="ep-item" data-id="${88200 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
            return text(JSON.stringify({ status: true, html: epHtml }));
          }
          if (u.pathname.startsWith("/api/theme/episode/servers")) {
            const epId = u.searchParams.get("episodeId") || "0";
            const subEmbed = `https://zokoanime.video/stream/mal/88801/${epId}/sub`;
            return text(JSON.stringify({
              status: true,
              html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>`,
            }));
          }
        }
        if (u.hostname === "zokoanime.video") {
          const epId = u.pathname.split("/")[4] || "0";
          const blob = makeZokoBlob({ src: `https://cdn.hianime.test/chronicle/${epId}/master.m3u8`, subtitles: [] });
          return text(`<html><script>window.__P="${blob}";</script></html>`);
        }
        return { ok: false, status: 404 };
      }) as unknown as typeof fetch;

    // 1. If the earlier cour fails, must NOT shift and play Act Two for S2 E14 (must return not-success)!
    const failed = await createFilmpireAdapter({ fetch: makeFetcher(true) }).resolve(new URL("https://filmpire.sc/watch/88801?s=2&e=14"));
    expect(failed.status).not.toBe("success");

    // 2. When both cours load, air-date sort puts Act One (Oct 2022) before Act Two (Jul 2023),
    //    so S2 E1 plays Act One (88101) and S2 E14 plays Act Two (88201)!
    const okAdapter = createFilmpireAdapter({ fetch: makeFetcher(false) });
    const ep1 = await okAdapter.resolve(new URL("https://filmpire.sc/watch/88801?s=2&e=1"));
    expect(ep1.status).toBe("success");
    if (ep1.status === "success") expect(ep1.media.stream.directUrl).toContain("cdn.hianime.test/chronicle/88101/master.m3u8");

    const ep14 = await okAdapter.resolve(new URL("https://filmpire.sc/watch/88801?s=2&e=14"));
    expect(ep14.status).toBe("success");
    if (ep14.status === "success") expect(ep14.media.stream.directUrl).toContain("cdn.hianime.test/chronicle/88201/master.m3u8");
  });

  it("never plays One Piece, earlier movies, or the TV series for an unreleased anime movie (Walpurgisnacht: Rising)", async () => {
    const madokaMovie = {
      id: 822653,
      title: "Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-",
      original_language: "ja",
      genres: [{ id: 16 }],
    };

    const fetcher = (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/movie/822653")) {
        return { ok: true, status: 200, json: async () => madokaMovie };
      }
      if (u.hostname.endsWith("hianime.at") && u.pathname === "/search") {
        return text(`
          <div class="film_list-wrap">
            <h3 class="film-name"><a href="/puella-magi-madoka-magica-100" title="Puella Magi Madoka Magica">TV</a></h3>
            <h3 class="film-name"><a href="/puella-magi-madoka-magica-rebellion-2688" title="Puella Magi Madoka Magica the Movie 3: Rebellion">Rebellion</a></h3>
          </div>
          <div id="main-sidebar">
            <h3 class="film-name"><a href="/one-piece-1" title="One Piece">One Piece</a></h3>
          </div>
        `);
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const res = await createFilmpireAdapter({ fetch: fetcher }).resolve(new URL("https://filmpire.sc/watch/822653"));
    expect(res.status).not.toBe("success");
  });

  it("maps single-season TMDB shows cut into parts back to the part's absolute episode (not whole S1 count)", async () => {
    const singleSeasonShow = {
      id: 88802,
      name: "Long Single Season Show",
      original_language: "ja",
      genres: [{ id: 16 }],
      seasons: [{ season_number: 1, name: "Season 1", episode_count: 59 }],
    };

    const fetcher = (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/tv/88802")) {
        return { ok: true, status: 200, json: async () => singleSeasonShow };
      }
      if (u.hostname === "data.vidsrc.sh") {
        // Probe says S1=24, S2=23 (like JJK)
        return text(JSON.stringify({
          status_code: "200",
          data: { eps: { "1": Array(24).fill("1"), "2": Array(23).fill("1") } },
        }));
      }
      if (u.hostname.endsWith("hianime.at")) {
        if (u.pathname === "/search") {
          return text(`
            <div class="film_list-wrap">
              <h3 class="film-name"><a href="/long-single-season-show-8882" title="Long Single Season Show">Long Single Season Show</a></h3>
            </div>
          `);
        }
        if (u.pathname.endsWith("/api/theme/episode/list/8882")) {
          const epHtml = Array.from({ length: 59 }, (_, i) => `<a class="ep-item" data-id="${88500 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.startsWith("/api/theme/episode/servers")) {
          const epId = u.searchParams.get("episodeId") || "0";
          const subEmbed = `https://zokoanime.video/stream/mal/88802/${epId}/sub`;
          return text(JSON.stringify({
            status: true,
            html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>`,
          }));
        }
      }
      if (u.hostname === "zokoanime.video") {
        const epId = u.pathname.split("/")[4] || "0";
        const blob = makeZokoBlob({ src: `https://cdn.hianime.test/single/${epId}/master.m3u8`, subtitles: [] });
        return text(`<html><script>window.__P="${blob}";</script></html>`);
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fetcher });
    // Part 2 E3 -> 24 + 3 = 27 (data-id 88527), NOT 59 + 3 = 62!
    const p2e3 = await adapter.resolve(new URL("https://filmpire.sc/watch/88802?s=2&e=3"));
    expect(p2e3.status).toBe("success");
    if (p2e3.status === "success") {
      expect(p2e3.media.stream.directUrl).toContain("cdn.hianime.test/single/88527/master.m3u8");
    }
    // Part 3 E1 -> 24 + 23 + 1 = 48 (data-id 88548)
    const p3e1 = await adapter.resolve(new URL("https://filmpire.sc/watch/88802?s=3&e=1"));
    expect(p3e1.status).toBe("success");
    if (p3e1.status === "success") {
      expect(p3e1.media.stream.directUrl).toContain("cdn.hianime.test/single/88548/master.m3u8");
    }
  });

  it("with no answer from its own video check in time, a part is played as the library's last check cut it", async () => {
    // The list was cut by the players' seasons of 20 and 23 (the library's check, remembered); the look-up's own check fails now.
    rememberPlayerSeasons(88803, { 1: 20, 2: 23 });
    const show = { id: 88803, name: "Another Long Show", original_language: "ja", genres: [{ id: 16 }], seasons: [{ season_number: 1, name: "Season 1", episode_count: 59 }] };
    const fetcher = (async (url: string | URL) => {
      const u = new URL(String(url));
      const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
      if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith("/tv/88803")) return { ok: true, status: 200, json: async () => show };
      if (u.hostname === "data.vidsrc.sh") return { ok: false, status: 503, text: async () => "" };
      if (u.hostname.endsWith("hianime.at")) {
        if (u.pathname === "/search") {
          return text(`<div class="film_list-wrap"><h3 class="film-name"><a href="/another-long-show-8883" title="Another Long Show">Another Long Show</a></h3></div>`);
        }
        if (u.pathname.endsWith("/api/theme/episode/list/8883")) {
          const epHtml = Array.from({ length: 59 }, (_, i) => `<a class="ep-item" data-id="${88600 + i + 1}" data-number="${i + 1}" title="Ep ${i + 1}"></a>`).join("");
          return text(JSON.stringify({ status: true, html: epHtml }));
        }
        if (u.pathname.startsWith("/api/theme/episode/servers")) {
          const epId = u.searchParams.get("episodeId") || "0";
          const subEmbed = `https://zokoanime.video/stream/mal/88803/${epId}/sub`;
          return text(JSON.stringify({ status: true, html: `<div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>` }));
        }
      }
      if (u.hostname === "zokoanime.video") {
        const epId = u.pathname.split("/")[4] || "0";
        return text(`<html><script>window.__P="${makeZokoBlob({ src: `https://cdn.hianime.test/single/${epId}/master.m3u8`, subtitles: [] })}";</script></html>`);
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fetcher });
    // Part 2 E3 -> 20 + 3 = 23 (data-id 88623), not 24 + 3 = 27
    const p2e3 = await adapter.resolve(new URL("https://filmpire.sc/watch/88803?s=2&e=3"));
    expect(p2e3.status).toBe("success");
    if (p2e3.status === "success") expect(p2e3.media.stream.directUrl).toContain("cdn.hianime.test/single/88623/master.m3u8");
  });

  it("resolves direct ZokoAnime and HiAnime URLs via createHiAnimeAdapter", async () => {
    const subEmbed = "https://zokoanime.video/stream/mal/40351/1/sub";
    const blob = makeZokoBlob({
      src: "https://cdn.hianime.test/pokemon/1/master.m3u8",
      subtitles: [{ lang: "en", label: "English", src: "https://cdn.hianime.test/pokemon/1/sub.vtt", default: true }],
    });

    const directFetcher = (async (url: string | URL) => {
      const u = String(url);
      if (u === subEmbed) {
        return { ok: true, status: 200, text: async () => `<html><script>window.__P="${blob}";</script></html>` };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createHiAnimeAdapter({ fetch: directFetcher });
    const res = await adapter.resolve(new URL(subEmbed));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.stream.directUrl).toBe("https://cdn.hianime.test/pokemon/1/master.m3u8");
      expect(res.media.stream.type).toBe("hls");
      expect(res.media.subtitles).toHaveLength(1);
    }
  });
});

describe("VixSrc provider and Western content fallback", () => {
  it("resolves stream and parses subtitles via resolveVixSrcStream", async () => {
    const mockM3u8 = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="https://vixsrc.to/sub/en.vtt"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Romanian",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="ro",URI="https://vixsrc.to/sub/ro.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
https://vixsrc.to/720p.m3u8`;

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("vixsrc.to/api/movie/671")) {
        return { ok: true, status: 200, json: async () => ({ src: "https://vixsrc.to/embed/movie/671" }) };
      }
      if (u.includes("vixsrc.to/embed/movie/671")) {
        return {
          ok: true,
          status: 200,
          text: async () => `<html><script>window.masterPlaylist = { url: "https://vixsrc.to/playlist/671", token: "tok123", expires: "999999" };</script></html>`,
        };
      }
      if (u.includes("vixsrc.to/playlist/671")) {
        return { ok: true, status: 200, text: async () => mockM3u8 };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const res = await resolveVixSrcStream(fakeFetch, "671", false);
    expect(res).not.toBeNull();
    expect(res?.streamUrl).toBe("https://vixsrc.to/playlist/671?ub=1&token=tok123&expires=999999&h=1");
    expect(res?.type).toBe("hls");
    expect(res?.subtitles).toHaveLength(2);
    expect(res?.subtitles[0]?.lang).toBe("en");
    expect(res?.subtitles[1]?.lang).toBe("ro");
  });

  it("filmpireAdapter falls back to VixSrc when VidLink has no stream", async () => {
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org/3/movie/671")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: "Harry Potter and the Philosopher's Stone",
            original_language: "en",
            genres: [{ id: 12 }, { id: 14 }], // Adventure, Fantasy (not animated)
          }),
        };
      }
      // VidLink returns 404
      if (u.includes("vidlink.pro")) {
        return { ok: false, status: 404 };
      }
      // VixSrc succeeds
      if (u.includes("vixsrc.to/api/movie/671")) {
        return { ok: true, status: 200, json: async () => ({ src: "https://vixsrc.to/embed/movie/671" }) };
      }
      if (u.includes("vixsrc.to/embed/movie/671")) {
        return {
          ok: true,
          status: 200,
          text: async () => `<html><script>window.masterPlaylist = { url: "https://vixsrc.to/playlist/671", token: "tok456", expires: "999999" };</script></html>`,
        };
      }
      if (u.includes("vixsrc.to/playlist/671")) {
        return {
          ok: true,
          status: 200,
          text: async () => `#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="https://vixsrc.to/sub/en.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://vixsrc.to/720.m3u8`,
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    const res = await adapter.resolve(new URL("https://filmpire.sc/watch/671"));
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.media.title).toBe("Harry Potter and the Philosopher's Stone");
      expect(res.media.stream.directUrl).toContain("vixsrc.to/playlist/671");
      expect(res.media.stream.type).toBe("hls");
    }
  });

  it("filmpireAdapter handles when both VidLink and VixSrc miss", async () => {
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.themoviedb.org/3/movie/999999")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: "Missing Film",
            original_language: "en",
            genres: [{ id: 18 }],
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const adapter = createFilmpireAdapter({ fetch: fakeFetch });
    const res = await adapter.resolve(new URL("https://filmpire.sc/watch/999999"));
    expect(res.status).toBe("temporary_failure");
  });
});

