import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleStreamProxy } from "./proxy";
import type { SegmentCache } from "./segmentCache";

/*
 * What a proxy request does with an other end that stops, or that goes on for ever a few bytes at a time: the request, and the connection to that end,
 * are not held open by it. The other end is a server on this machine, and so is the only address the proxy is let go to here.
 */
describe("handleStreamProxy: an other end that is too slow", () => {
  const WAIT_MS = 300; // (how long the proxy waits for the other end in these tests)
  const BIG = 24 * 1024 * 1024;
  const allowed = (address: string) => address === "127.0.0.1";
  let upstream: http.Server;
  let upstreamPort: number;
  let app: FastifyInstance;
  let quiet: FastifyInstance;
  let faulty: FastifyInstance;
  let proxy: string;
  /** The paths whose connection from the proxy was closed (by the proxy: the other end does not close any of them itself). */
  const letGo: string[] = [];

  beforeAll(async () => {
    upstream = http.createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://upstream").pathname;
      response.on("close", () => letGo.push(path));
      if (path === "/silent") return; // (never answers)
      if (path === "/stalled.srt" || path === "/stalled.vtt") {
        response.writeHead(200, { "content-type": "text/plain" });
        return void response.write("1\n00:00:01,000 --> 00:00:02,000\nHel"); // (and nothing more)
      }
      if (path === "/stalled.m3u8") {
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        return void response.write("#EXTM3U\n#EXTINF:4,\n");
      }
      if (path === "/stalled-error.srt") {
        response.writeHead(404, { "content-type": "text/plain" });
        return void response.write("not");
      }
      if (path === "/dripped.m3u8") {
        // (A byte every few milliseconds: never silent, and never done.)
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        response.write("#EXTM3U\n");
        const dripping = setInterval(() => response.write("#\n"), 20);
        return void response.on("close", () => clearInterval(dripping));
      }
      if (path === "/slowish.srt") {
        // (Half of it now and half a moment later: well within the time.)
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("1\n00:00:01,000 --> 00:00:02,000\n");
        return void setTimeout(() => response.end("Hello\n"), WAIT_MS / 3);
      }
      if (path === "/stalled.mp4") {
        response.writeHead(200, { "content-type": "video/mp4", "content-length": "1000000" });
        return void response.write(Buffer.alloc(1000, 1)); // (and nothing more)
      }
      if (path === "/big.mp4") {
        response.writeHead(200, { "content-type": "video/mp4", "content-length": String(BIG) });
        return void response.end(Buffer.alloc(BIG, 2));
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("nothing here");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    app = Fastify();
    app.get<{ Querystring: { url?: string } }>("/api/proxy", (request, reply) => handleStreamProxy(request, reply, { isAllowedAddress: allowed, upstreamMs: WAIT_MS }));
    await app.listen({ port: 0, host: "127.0.0.1" });
    proxy = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    // (A server that carries no film: it passes subtitles on and nothing else.)
    quiet = Fastify();
    quiet.get<{ Querystring: { url?: string } }>("/api/proxy", (request, reply) => handleStreamProxy(request, reply, { isAllowedAddress: allowed, video: false, upstreamMs: WAIT_MS }));
    await quiet.ready();

    // (A server whose cache of shared pieces fails: a fault of the proxy's own, nothing to do with an other end.)
    const cache = {
      maxPiece: 1024,
      get: async () => {
        throw new Error("a fault in the cache");
      },
    } as unknown as SegmentCache;
    faulty = Fastify();
    faulty.get<{ Querystring: { url?: string } }>("/api/proxy", (request, reply) =>
      handleStreamProxy(request, reply, { isAllowedAddress: allowed, upstreamMs: WAIT_MS, segments: cache }),
    );
    await faulty.ready();
  });
  afterAll(async () => {
    await faulty.close();
    await quiet.close();
    await app.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });

  const at = (path: string) => `http://127.0.0.1:${upstreamPort}${path}`;
  const through = (lane: FastifyInstance, path: string) => lane.inject({ url: `/api/proxy?url=${encodeURIComponent(at(path))}` });
  const timed = async <T>(promise: Promise<T>): Promise<{ result: T; ms: number }> => {
    const started = Date.now();
    const result = await promise;
    return { result, ms: Date.now() - started };
  };
  /** A screen reading a film from the proxy: what came, and whether it all did. It can stop reading for a while after the first bytes. */
  const read = (path: string, options: { pauseMs?: number } = {}) =>
    new Promise<{ status: number; bytes: number; complete: boolean }>((resolve, reject) => {
      http
        .get(`${proxy}/api/proxy?url=${encodeURIComponent(at(path))}`, (res) => {
          let bytes = 0;
          let paused = false;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (options.pauseMs && !paused) {
              paused = true;
              res.pause();
              setTimeout(() => res.resume(), options.pauseMs);
            }
          });
          res.on("error", () => {}); // (a connection that is cut says so here, and `close` follows)
          res.on("close", () => resolve({ status: res.statusCode ?? 0, bytes, complete: res.complete }));
        })
        .on("error", reject);
    });
  const letGoOf = (path: string) => expect.poll(() => letGo.includes(path), { timeout: 3000 }).toBe(true);

  describe("before it begins to answer", () => {
    it("says 504 within the time, and lets go of the connection", async () => {
      const { result, ms } = await timed(through(app, "/silent"));
      expect(result.statusCode).toBe(504);
      expect(result.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(ms).toBeGreaterThanOrEqual(WAIT_MS - 50);
      expect(ms).toBeLessThan(3000);
      await letGoOf("/silent");
    });
  });

  describe("after it has begun, when a text (a playlist, a subtitle, what it says of a failure) is not all there in time", () => {
    for (const [what, path] of [["a subtitle", "/stalled.srt"], ["a playlist", "/stalled.m3u8"], ["the text of a failure", "/stalled-error.srt"]] as const) {
      it(`says 504 within the time, and lets go of the connection: ${what} that stops`, async () => {
        const { result, ms } = await timed(through(app, path));
        expect(result.statusCode).toBe(504);
        expect(ms).toBeGreaterThanOrEqual(WAIT_MS - 50);
        expect(ms).toBeLessThan(3000);
        await letGoOf(path);
      });
    }

    it("says the same to a server that carries no film, which passes a subtitle on", async () => {
      const { result, ms } = await timed(through(quiet, "/stalled.vtt"));
      expect(result.statusCode).toBe(504);
      expect(ms).toBeLessThan(3000);
      await letGoOf("/stalled.vtt");
    });

    it("counts the time all through, not only the silences: a playlist that comes a few bytes at a time for ever is given up on as well", async () => {
      const { result, ms } = await timed(through(app, "/dripped.m3u8"));
      expect(result.statusCode).toBe(504);
      expect(ms).toBeLessThan(3000);
      await letGoOf("/dripped.m3u8");
    });

    it("passes on a text that takes a while to come, within the time", async () => {
      const answer = await through(app, "/slowish.srt");
      expect(answer.statusCode).toBe(200);
      expect(answer.body).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello");
    });
  });

  describe("a fault of the proxy's own", () => {
    it("is not taken for a slow other end: it is an error, answered as one", async () => {
      const answer = await through(faulty, "/piece.ts");
      expect(answer.statusCode).toBe(500);
    });
  });

  describe("a film that is on its way to a screen", () => {
    it("is cut off when the other end sends nothing for the time, and the connection to it is let go", async () => {
      const { result, ms } = await timed(read("/stalled.mp4"));
      expect(result.status).toBe(200);
      expect(result.complete).toBe(false);
      expect(result.bytes).toBeLessThan(1_000_000);
      expect(ms).toBeLessThan(3000);
      await letGoOf("/stalled.mp4");
    });

    it("is not cut off for the time that a screen takes to read what has come (the wait is for the other end, not for the screen)", async () => {
      const { result } = await timed(read("/big.mp4", { pauseMs: WAIT_MS * 3 }));
      expect(result).toEqual({ status: 200, bytes: BIG, complete: true });
    });
  });
});
