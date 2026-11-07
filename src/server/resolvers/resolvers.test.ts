import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResolver } from ".";
import { MAX_ALTERNATES } from "../../shared";
import { alternatesOf, createGenericResolver } from "./generic";
import { MAX_CACHED_BYTES, MAX_CACHED_RESULT_BYTES, MAX_CACHED_RESULTS, ResolverRegistry } from "./registry";
import { SafeFetchError, type FetchedPage, type SafeFetch } from "./safe-fetch";
import { UNSUPPORTED_MESSAGE, type Candidate, type ResolveResult, type SiteAdapter } from "./types";

const page = (url: string, body: string, contentType = "text/html"): FetchedPage => ({
  url: new URL(url),
  status: 200,
  contentType,
  body,
  truncated: false,
});
const fetchReturning = (result: FetchedPage): SafeFetch => async () => result;
const fetchFailing = (error: unknown): SafeFetch => async () => {
  throw error;
};
const resolveWith = (fetch: SafeFetch, url: string) => createGenericResolver({ fetch }).resolve(new URL(url));

describe("generic resolver", () => {
  it("recognises a direct media URL without touching the network", async () => {
    const neverCalled = fetchFailing(new Error("must not fetch"));
    expect(await resolveWith(neverCalled, "https://cdn.example/videos/Big-Buck_Bunny.mp4")).toEqual({
      status: "success",
      resolver: "generic:direct-media",
      media: { title: "Big Buck Bunny", stream: { url: "https://cdn.example/videos/Big-Buck_Bunny.mp4", type: "mp4" } },
    });
    expect(await resolveWith(neverCalled, "https://cdn.example/a/master.m3u8?token=1")).toMatchObject({
      status: "success",
      media: { stream: { type: "hls" } },
    });
  });

  it("finds an HTML5 <video> on a page and takes the page title", async () => {
    const result = await resolveWith(
      fetchReturning(page("https://site.example/watch/1", '<title>My Movie</title><video src="/m/a.mp4"></video>')),
      "https://site.example/watch/1",
    );
    expect(result).toEqual({
      status: "success",
      resolver: "generic:html5-video",
      media: { title: "My Movie", stream: { url: "https://site.example/m/a.mp4", type: "mp4" } },
    });
  });

  it("offers the other streams a page declares as alternates, without repeating the main one", async () => {
    const html = '<title>Two</title><video><source src="/m/a.mp4" type="video/mp4"><source src="/m/b.m3u8"><source src="/m/a.mp4"></video>';
    const result = await resolveWith(fetchReturning(page("https://site.example/watch/2", html)), "https://site.example/watch/2");
    expect(result).toMatchObject({
      status: "success",
      media: {
        stream: { url: "https://site.example/m/a.mp4", type: "mp4" },
        alternates: [{ stream: { url: "https://site.example/m/b.m3u8", type: "hls" } }],
      },
    });
  });

  it("offers at most eight alternates, none twice and not the main stream again, however many the page lists", () => {
    // (Picking them out of a hundred thousand once cost the square of that: 13 seconds of the whole server for one page.)
    const candidate = (n: number): Candidate => ({ url: `https://cdn.example/${n}.mp4`, type: "mp4", strategy: "url-pattern", confidence: 0.5 });
    const candidates = Array.from({ length: 100_000 }, (_, n) => candidate(Math.floor(n / 2))); // every address twice, one after the other
    const started = performance.now();
    const alternates = alternatesOf(candidates, candidates[0]!);
    expect(performance.now() - started).toBeLessThan(500);
    expect(alternates.map((alternate) => alternate.stream.url)).toEqual(Array.from({ length: MAX_ALTERNATES }, (_, n) => `https://cdn.example/${n + 1}.mp4`));
  });

  it("has no alternates key at all when the page declares one stream", async () => {
    const result = await resolveWith(fetchReturning(page("https://site.example/watch/3", '<video src="/m/a.mp4"></video>')), "https://site.example/watch/3");
    expect(result).toMatchObject({ status: "success" });
    expect("alternates" in (result as { media: object }).media).toBe(false);
  });

  it("uses the final URL after redirects to resolve relative media paths", async () => {
    const result = await resolveWith(
      fetchReturning(page("https://cdn.example/final/page", '<video src="a.mp4"></video>')),
      "https://short.example/x",
    );
    expect(result).toMatchObject({ status: "success", media: { stream: { url: "https://cdn.example/final/a.mp4" } } });
  });

  it("treats a URL that serves video directly (no extension) as direct media", async () => {
    const result = await resolveWith(fetchReturning(page("https://cdn.example/stream/42", "", "video/mp4")), "https://cdn.example/stream/42");
    expect(result).toMatchObject({ status: "success", resolver: "generic:direct-media", media: { stream: { type: "mp4" } } });
  });

  it("says 'unsupported' with the friendly message when nothing is found", async () => {
    const result = await resolveWith(fetchReturning(page("https://site.example/", "<h1>No video here</h1>")), "https://site.example/");
    expect(result).toEqual({ status: "unsupported", reason: UNSUPPORTED_MESSAGE });
  });

  it.each<[string, SafeFetchError, ResolveResult["status"]]>([
    ["404 page", new SafeFetchError("bad_status", "HTTP 404", 404), "unsupported"],
    ["login wall", new SafeFetchError("bad_status", "HTTP 403", 403), "unsupported"],
    ["server error", new SafeFetchError("bad_status", "HTTP 503", 503), "temporary_failure"],
    ["rate limit", new SafeFetchError("bad_status", "HTTP 429", 429), "temporary_failure"],
    ["timeout", new SafeFetchError("timeout", "timed out"), "temporary_failure"],
    ["network error", new SafeFetchError("network", "ECONNRESET"), "temporary_failure"],
    ["blocked address", new SafeFetchError("blocked", "address not allowed"), "invalid_url"],
  ])("maps a fetch failure (%s) to the right result state", async (_name, error, expected) => {
    expect((await resolveWith(fetchFailing(error), "https://site.example/x")).status).toBe(expected);
  });

  it("never leaks internals in failure messages", async () => {
    const result = await resolveWith(fetchFailing(new Error("connect ECONNREFUSED 10.1.2.3:5432 /srv/app/secret.ts")), "https://site.example/x");
    expect(JSON.stringify(result)).not.toMatch(/10\.1\.2\.3|secret|ECONNREFUSED/);
  });
});

describe("ResolverRegistry", () => {
  const events: Record<string, unknown>[] = [];
  const log = { info: (o: Record<string, unknown>) => void events.push(o) };
  const adapter = (id: string, domains: string[], result: ResolveResult | Error): SiteAdapter => ({
    id,
    domains,
    resolve: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const ok = (resolver: string): ResolveResult => ({ status: "success", resolver, media: { stream: { url: "https://x/a.mp4", type: "mp4" } } });
  const genericOk: SiteAdapter = adapter("generic", [], ok("generic:test"));

  beforeEach(() => void (events.length = 0));

  it("routes to the adapter that owns the domain (exact and subdomain), else to generic", async () => {
    const registry = new ResolverRegistry([adapter("site-a", ["a.example"], ok("site-a"))], genericOk, log);
    expect(await registry.resolve("https://a.example/watch/1")).toMatchObject({ resolver: "site-a" });
    expect(await registry.resolve("https://www.a.example/watch/1")).toMatchObject({ resolver: "site-a" });
    expect(await registry.resolve("https://nota.example/watch/1")).toMatchObject({ resolver: "generic:test" });
    expect(await registry.resolve("https://a.example.evil.com/")).toMatchObject({ resolver: "generic:test" });
  });

  it("says which page the video came from, so it can be played again later", async () => {
    const registry = new ResolverRegistry([], genericOk, log);
    expect(await registry.resolve("https://a.example/watch/1")).toMatchObject({ media: { page: "https://a.example/watch/1" } });
  });

  it("rejects non-http(s) and malformed input as invalid_url", async () => {
    const registry = new ResolverRegistry([], genericOk, log);
    for (const bad of ["", "not a url", "file:///etc/passwd", "javascript:alert(1)", "ftp://x/y"]) {
      expect(await registry.resolve(bad), bad).toEqual({ status: "invalid_url" });
    }
  });

  it("turns an adapter crash into temporary_failure instead of throwing", async () => {
    const registry = new ResolverRegistry([adapter("bad", ["bad.example"], new Error("boom: /srv/x"))], genericOk, log);
    expect(await registry.resolve("https://bad.example/x")).toEqual({
      status: "temporary_failure",
      reason: "Something went wrong while looking for the video.",
    });
  });

  it("logs a structured event with domain/resolver/outcome/duration and no URL path or query", async () => {
    let t = 1000;
    const registry = new ResolverRegistry([], genericOk, log, () => (t += 25));
    await registry.resolve("https://secret.example/watch/1?token=abc123");
    await new ResolverRegistry([], adapter("generic", [], { status: "unsupported", reason: "x" }), log, () => (t += 7)).resolve("https://other.example/p");
    expect(events[0]).toEqual({ domain: "secret.example", resolver: "generic:test", success: true, durationMs: 25 });
    expect(events[1]).toEqual({ domain: "other.example", resolver: "generic", success: false, reason: "UNSUPPORTED", durationMs: 7 });
    expect(JSON.stringify(events)).not.toMatch(/abc123|token/);
  });

  it("keeps the answers to the last few hundred addresses, not to every address it was ever asked about", async () => {
    let asked = 0;
    const counting: SiteAdapter = { id: "counting", domains: [], resolve: async () => (asked++, ok("counting")) };
    const registry = new ResolverRegistry([], counting, log);
    for (let n = 0; n < MAX_CACHED_RESULTS + 5; n++) await registry.resolve(`https://a.example/${n}.mp4`);
    expect(asked).toBe(MAX_CACHED_RESULTS + 5);
    await registry.resolve(`https://a.example/${MAX_CACHED_RESULTS + 4}.mp4`); // the newest is still there
    expect(asked).toBe(MAX_CACHED_RESULTS + 5);
    await registry.resolve("https://a.example/0.mp4"); // the oldest is not
    expect(asked).toBe(MAX_CACHED_RESULTS + 6);
  });

  describe("a look that is to be made afresh", () => {
    /** Each look finds another link (as a stream's token is another each time). */
    const tokens = () => {
      let asked = 0;
      const adapterOfTokens: SiteAdapter = { id: "tokens", domains: [], resolve: async () => ((asked += 1), { status: "success", resolver: "tokens", media: { stream: { url: `https://x/a.m3u8?token=${asked}`, type: "hls" } } }) };
      return { adapterOfTokens, asked: () => asked };
    };
    const linkOf = (result: ResolveResult) => (result.status === "success" ? result.media.stream.url : undefined);

    it("keeps a link that carries the site's token for 45 seconds, and one that carries none for ten minutes", async () => {
      let now = 1_000_000;
      const { adapterOfTokens, asked } = tokens();
      let plain = 0;
      const adapterOfPlain: SiteAdapter = { id: "plain", domains: ["plain.example"], resolve: async () => ((plain += 1), { status: "success", resolver: "plain", media: { stream: { url: `https://x/${plain}/master.m3u8`, type: "hls" } } }) };
      const registry = new ResolverRegistry([adapterOfPlain], adapterOfTokens, log, () => now);
      await registry.resolve("https://a.example/1");
      await registry.resolve("https://plain.example/1");
      now += 46_000;
      await registry.resolve("https://a.example/1");
      await registry.resolve("https://plain.example/1");
      expect(asked()).toBe(2); // (asked again: the token it came with is about to run out)
      expect(plain).toBe(1); // (kept: nothing in it runs out)
      now += 600_000;
      await registry.resolve("https://plain.example/1");
      expect(plain).toBe(2);
    });

    it("skips what was kept for the address, asks again, and keeps the new answer", async () => {
      const { adapterOfTokens, asked } = tokens();
      const registry = new ResolverRegistry([], adapterOfTokens, log);
      expect(linkOf(await registry.resolve("https://a.example/1"))).toContain("token=1");
      expect(linkOf(await registry.resolve("https://a.example/1"))).toContain("token=1"); // (kept)
      expect(linkOf(await registry.resolve("https://a.example/1", false, true))).toContain("token=2");
      expect(asked()).toBe(2);
      expect(linkOf(await registry.resolve("https://a.example/1"))).toContain("token=2"); // (and the new one is what is kept)
      expect(asked()).toBe(2);
    });

    it("does not touch what is kept for other addresses", async () => {
      const { adapterOfTokens, asked } = tokens();
      const registry = new ResolverRegistry([], adapterOfTokens, log);
      await registry.resolve("https://a.example/1");
      await registry.resolve("https://a.example/2");
      await registry.resolve("https://a.example/1", false, true);
      await registry.resolve("https://a.example/2");
      expect(asked()).toBe(3);
    });

    it("lets the old answer go even when the new look fails, so that the link that did not play is not given again", async () => {
      let asked = 0;
      const flaky: SiteAdapter = { id: "flaky", domains: [], resolve: async () => (++asked === 2 ? { status: "temporary_failure", reason: "x" } : ok("flaky")) };
      const registry = new ResolverRegistry([], flaky, log);
      await registry.resolve("https://a.example/1");
      expect(await registry.resolve("https://a.example/1", false, true)).toMatchObject({ status: "temporary_failure" });
      expect(await registry.resolve("https://a.example/1")).toMatchObject({ status: "success" }); // (asked again, not read from the old answer)
      expect(asked).toBe(3);
    });
  });

  describe("weighing what it keeps", () => {
    // An answer with the most subtitle tracks a page is given (40 of about 2 KB each), about 85 KB: a page decides how heavy its answer is.
    const withSubtitles = (n: number): ResolveResult => ({
      status: "success",
      resolver: "heavy",
      media: {
        stream: { url: "https://x/a.mp4", type: "mp4" },
        subtitles: Array.from({ length: 40 }, (_, track) => ({ id: track, label: "English", url: `https://x/${"s".repeat(2000)}${n}/${track}` })),
      },
    });
    const weight = JSON.stringify(withSubtitles(0)).length;

    it("keeps the answers to as many addresses as weigh 16 MiB together, the oldest going first", async () => {
      let asked = 0;
      const heavy: SiteAdapter = { id: "heavy", domains: [], resolve: async () => (asked++, withSubtitles(asked)) };
      const registry = new ResolverRegistry([], heavy, log);
      const fit = Math.floor(MAX_CACHED_BYTES / weight);
      expect(fit).toBeLessThan(MAX_CACHED_RESULTS); // (it is the weight that holds them back here, not their number)
      const total = fit + 30;
      for (let n = 0; n < total; n++) await registry.resolve(`https://a.example/${n}`);
      expect(asked).toBe(total);
      await registry.resolve(`https://a.example/${total - 1}`); // the newest is still there
      expect(asked).toBe(total);
      await registry.resolve("https://a.example/0"); // the oldest is not
      expect(asked).toBe(total + 1);
    });

    it("gives an answer that weighs more than a megabyte and does not keep it", async () => {
      let asked = 0;
      const huge: SiteAdapter = {
        id: "huge",
        domains: [],
        resolve: async () => (asked++, { status: "success", resolver: "huge", media: { stream: { url: "https://x/a.mp4", type: "mp4" }, title: "t".repeat(MAX_CACHED_RESULT_BYTES) } }),
      };
      const registry = new ResolverRegistry([], huge, log);
      expect(await registry.resolve("https://a.example/1")).toMatchObject({ status: "success" });
      await registry.resolve("https://a.example/1");
      expect(asked).toBe(2);
    });

    it("counts what an address weighs once, however often its answer is renewed", async () => {
      let asked = 0;
      let t = 0;
      const heavy: SiteAdapter = { id: "heavy", domains: [], resolve: async () => (asked++, withSubtitles(0)) };
      const registry = new ResolverRegistry([], heavy, log, () => t);
      for (let n = 0; n < Math.ceil((MAX_CACHED_BYTES * 2) / weight); n++) {
        t += 700_000; // (past the ten minutes: it is asked again, and the answer it had goes)
        await registry.resolve("https://a.example/same");
      }
      const before = asked;
      await registry.resolve("https://a.example/same");
      expect(asked).toBe(before); // (still kept)
    });
  });

  it("logs how many episodes a series came with, and nothing for a plain video", async () => {
    const episode = (n: number) => ({ season: 1, episode: n, url: `https://x/${n}` });
    const series = (episodes?: ReturnType<typeof episode>[]): ResolveResult => ({
      status: "success",
      resolver: "s",
      media: { stream: { url: "https://x/a.mp4", type: "mp4" }, series: { season: 1, episode: 1, ...(episodes && { episodes }) } },
    });
    await new ResolverRegistry([], adapter("g", [], series([episode(1), episode(2), episode(3)])), log).resolve("https://a.example/1");
    await new ResolverRegistry([], adapter("g", [], series()), log).resolve("https://b.example/1");
    await new ResolverRegistry([], genericOk, log).resolve("https://c.example/1");
    expect(events.map((e) => e.episodes)).toEqual([3, 0, undefined]);
  });
});

describe("createResolver (real fetch against a local page server)", () => {
  let server: http.Server;
  let base: string;
  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/video") return void res.writeHead(200, { "content-type": "text/html" }).end('<video src="/m.mp4"></video>');
      res.writeHead(200, { "content-type": "text/html" }).end("<p>nothing</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => void server.close());

  it("refuses loopback pages by default (SSRF guard)", async () => {
    const resolve = createResolver({ log: { info() {} } });
    expect(await resolve(`${base}/video`)).toEqual({ status: "invalid_url" });
    expect(await resolve("http://localhost/")).toEqual({ status: "invalid_url" });
    expect(await resolve("http://169.254.169.254/latest/meta-data/")).toEqual({ status: "invalid_url" });
  });

  it("resolves a page end to end once private networks are explicitly allowed (test/dev flag)", async () => {
    const resolve = createResolver({ log: { info() {} }, allowPrivateNetwork: true });
    expect(await resolve(`${base}/video`)).toMatchObject({ status: "success", media: { stream: { url: `${base}/m.mp4`, type: "mp4" } } });
    expect((await resolve(`${base}/empty`)).status).toBe("unsupported");
  });
});
