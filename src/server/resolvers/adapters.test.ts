import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnimeHeavenAdapter } from "./adapters/animeheaven";
import { createFilmpireAdapter } from "./adapters/filmpire";
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
});
