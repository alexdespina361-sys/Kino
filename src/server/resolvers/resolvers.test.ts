import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResolver } from ".";
import { createGenericResolver } from "./generic";
import { ResolverRegistry } from "./registry";
import { SafeFetchError, type FetchedPage, type SafeFetch } from "./safe-fetch";
import { UNSUPPORTED_MESSAGE, type ResolveResult, type SiteAdapter } from "./types";

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
