import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildStreamRelay } from "./app";
import { signedRelayUrl } from "./links";
import { streamAddress } from "../resolvers/adapters/streamAddress";

const key = "test-relay-key-with-at-least-32-characters";
const referer = "https://player.example/embed/movie/1";
const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ip_cidr: "127.0.0.0/24" })).toString("base64url")}.signature`;
let issuedToken = token;
let tokenStatus = 200;
let upstream: http.Server;
let origin: string;
let relay: ReturnType<typeof buildStreamRelay>;
const asked: Array<{ path: string; token: string | null; origin?: string; referer?: string }> = [];
const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://provider");
    asked.push({ path: url.pathname, token: url.searchParams.get("token"), origin: request.headers.origin, referer: request.headers.referer });
    if (url.pathname === "/generate.php") {
      response.statusCode = tokenStatus;
      response.setHeader("content-type", "application/json");
      return void response.end(JSON.stringify({ token: issuedToken }));
    }
    if (request.headers.origin || request.headers.referer !== referer) {
      response.writeHead(403);
      return void response.end("Wrong request context");
    }
    if (url.pathname.endsWith(".m3u8")) {
      if (url.searchParams.get("token") !== issuedToken) {
        response.writeHead(403);
        return void response.end("Wrong IP-bound token");
      }
      response.setHeader("content-type", "application/vnd.apple.mpegurl");
      return void response.end(url.pathname.includes("master")
        ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nlevel.m3u8\n'
        : '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=1,URI="part.m4s"\n#EXTINF:4,\nseg.m4s\n#EXT-X-ENDLIST\n');
    }
    if (url.pathname === "/blocked.vtt") {
      response.writeHead(403, { "content-type": "text/html" });
      return void response.end("Blocked by provider");
    }
    if (request.headers.range) {
      response.writeHead(206, { "content-type": "video/mp4", "content-range": "bytes 0-3/8", "content-length": "4", "accept-ranges": "bytes" });
      return void response.end(bytes.subarray(0, 4));
    }
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterEach(async () => { await relay?.close(); asked.length = 0; tokenStatus = 200; issuedToken = token; vi.restoreAllMocks(); });
afterAll(async () => { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); });

const signed = (path: string, hostToken = false, expires = Date.now() + 3600_000) => {
  const url = new URL(signedRelayUrl("https://streams.example/api/proxy", { url: `${origin}${path}`, referer, hostToken, expires }, key));
  return url.pathname + url.search;
};
const start = () => relay = buildStreamRelay({ key, isAllowedAddress: () => true });

describe("a separate streaming relay", () => {
  it("obtains the token on the media-serving machine, deduplicates concurrent requests, and keeps every HLS resource on the signed relay", async () => {
    start();
    const masters = await Promise.all(Array.from({ length: 3 }, () => relay.inject(signed("/pl/master.m3u8?token=website-ip-token", true))));
    expect(masters.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(asked.filter((r) => r.path === "/generate.php")).toHaveLength(1);
    expect(asked.filter((r) => r.path.endsWith(".m3u8")).every((r) => r.token === token)).toBe(true);
    const child = masters[0]!.body.split("\n").find((line) => line.startsWith("/api/proxy"))!;
    const playlist = await relay.inject(child);
    expect(playlist.statusCode).toBe(200);
    expect(playlist.headers["access-control-allow-origin"]).toBe("*");
    expect(playlist.headers["cache-control"]).toBe("no-store");
    const resources = [...playlist.body.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!);
    resources.push(playlist.body.split("\n").find((line) => line.startsWith("/api/proxy"))!);
    expect(resources).toHaveLength(4);
    for (const resource of resources) {
      expect(resource).toMatch(/^\/api\/proxy\?/);
      const answer = await relay.inject(resource);
      expect(answer.statusCode).toBe(200);
      expect(answer.rawPayload).toEqual(bytes);
    }
    expect(asked.every((r) => !r.origin && r.referer === referer)).toBe(true);
    expect(asked.filter((r) => r.path === "/generate.php")).toHaveLength(1);
  });

  it("refuses unsigned, changed and expired links before contacting any provider", async () => {
    start();
    expect((await relay.inject(`/api/proxy?url=${encodeURIComponent(origin)}`)).statusCode).toBe(403);
    expect((await relay.inject(signed("/pl/master.m3u8", true).replace("hostToken=1", "hostToken=0"))).statusCode).toBe(403);
    expect((await relay.inject(signed("/pl/master.m3u8", true, Date.now() - 1))).statusCode).toBe(403);
    expect(asked).toHaveLength(0);
  });

  it("refuses private addresses in production even when a link is signed", async () => {
    relay = buildStreamRelay({ key });
    expect((await relay.inject(signed("/seg.m4s"))).statusCode).toBe(403);
    expect(asked).toHaveLength(0);
  });

  it("passes byte ranges through with their 206 status and exposes the headers to the browser", async () => {
    start();
    const answer = await relay.inject({ url: signed("/film.mp4"), headers: { range: "bytes=0-3" } });
    expect(answer.statusCode).toBe(206);
    expect(answer.rawPayload).toEqual(bytes.subarray(0, 4));
    expect(answer.headers["content-range"]).toBe("bytes 0-3/8");
    expect(answer.headers["access-control-expose-headers"]).toContain("Content-Range");
  });

  it("preserves provider errors, including subtitles, rather than caching them or returning successful media", async () => {
    start();
    const answer = await relay.inject(signed("/blocked.vtt"));
    expect(answer.statusCode).toBe(403);
    expect(answer.headers["content-type"]).toContain("text/html");
    expect(answer.headers["cache-control"]).toBe("no-store");
  });

  it("accepts links signed by the website adapter without exposing its signing key", async () => {
    start();
    const result = streamAddress(`${origin}/pl/master.m3u8`, referer, { EDGE_STREAM_PROXY_URL: "https://streams.example/api/proxy", EDGE_STREAM_PROXY_KEY: key }, true);
    expect(result).not.toContain(key);
    const url = new URL(result);
    expect((await relay.inject(url.pathname + url.search)).statusCode).toBe(200);
  });

  it("refreshes a token before it expires instead of falling back to an old cached credential", async () => {
    start();
    expect((await relay.inject(signed("/pl/master.m3u8", true))).statusCode).toBe(200);
    const later = Date.now() + 3580_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    issuedToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(later / 1000) + 3600 })).toString("base64url")}.signature`;
    expect((await relay.inject(signed("/pl/master.m3u8", true))).statusCode).toBe(200);
    expect(asked.filter((r) => r.path === "/generate.php")).toHaveLength(2);
    expect(asked.at(-1)!.token).toBe(issuedToken);
  });

  it("reports a blocked token endpoint without making an unauthorized media request", async () => {
    start();
    tokenStatus = 403;
    const response = await relay.inject(signed("/pl/master.m3u8", true));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "UPSTREAM_TOKEN_FAILED" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(asked.map((r) => r.path)).toEqual(["/generate.php"]);
  });
});
