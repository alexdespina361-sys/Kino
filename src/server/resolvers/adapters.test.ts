import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createFilmpireAdapter, resolveVidLinkStream } from "./adapters/filmpire";
import { createSitefilmeAdapter } from "./adapters/sitefilme";

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
}): typeof fetch {
  const card = ({ slug, name }: { slug: string; name: string }) =>
    `<div class='similarimg'><div class='p1'><a href='anime.php?${slug}'><img class='coverimg' src='image.php?${slug}' alt='${name}'></a><div class='similarname c'><a href='anime.php?${slug}' class='c'>${name}</a></div></div></div>`;
  const id = (slug: string, episode: number) => `${slug}${episode}`.replace(/[^0-9a-f]/g, "a").padEnd(32, "0").slice(0, 32);
  return (async (url: string | URL) => {
    const u = new URL(String(url));
    const text = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
    if (u.hostname === "api.themoviedb.org" && u.pathname.endsWith(`/tv/${options.tmdbId}`)) return { ok: true, status: 200, json: async () => options.tmdb };
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
      if (u.pathname.endsWith("/gate.php")) return text(`<video id='vid'><source src='https://cdn.animeheaven.me/episode.mp4?x' type='video/mp4'></video>`);
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

  it("keeps the order of the sources for anime: Buzz, when it has the episode, before the anime site", async () => {
    const get = animeWorld({
      tmdbId: "60572",
      tmdb: { id: 60572, name: "Pokémon", original_language: "ja", genres: [{ id: 16 }], seasons: POKEMON_SEASONS },
      titles: (words) => (/pokemon/i.test(words) ? [{ slug: "pokemonuj", name: "Pokemon Ultimate Journeys: The Series" }] : []),
      episodes: { pokemonuj: [5, 6, 7] },
      buzz: true,
    });
    const res = await createFilmpireAdapter({ fetch: get }).resolve(new URL("https://filmpire.sc/watch/60572?s=25&e=6"));
    expect(res.status).toBe("success");
    if (res.status === "success") expect(res.media.stream.directUrl).toContain("cdn.buzz.test");
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
});
