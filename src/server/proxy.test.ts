import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleStreamProxy, rewriteM3u8, srtToVtt } from "./proxy";
import { SegmentCache } from "./segmentCache";

describe("rewriteM3u8", () => {
  it("rewrites segment URLs relative to the playlist URL", () => {
    const input = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:10",
      "#EXTINF:10.0,",
      "segment1.ts",
      "#EXTINF:10.0,",
      "http://cdn.example/segment2.ts",
    ].join("\n");

    const result = rewriteM3u8(input, "https://media.example/stream/master.m3u8", "https://site.example");

    expect(result).toContain("/api/proxy?url=https%3A%2F%2Fmedia.example%2Fstream%2Fsegment1.ts&referer=https%3A%2F%2Fsite.example");
    expect(result).toContain("/api/proxy?url=http%3A%2F%2Fcdn.example%2Fsegment2.ts&referer=https%3A%2F%2Fsite.example");
  });

  it("rewrites URI in #EXT-X-KEY tags", () => {
    const input = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.php?id=1"',
      "#EXTINF:5.0,",
      "chunk0.ts",
    ].join("\n");

    const result = rewriteM3u8(input, "https://media.example/hls/list.m3u8");
    expect(result).toContain('URI="/api/proxy?url=https%3A%2F%2Fmedia.example%2Fhls%2Fkey.php%3Fid%3D1"');
    expect(result).toContain("/api/proxy?url=https%3A%2F%2Fmedia.example%2Fhls%2Fchunk0.ts");
  });
});

describe("srtToVtt", () => {
  it("converts srt timestamp format to vtt", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello");
  });

  it("preserves already valid vtt content", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello";
    expect(srtToVtt(vtt)).toBe(vtt);
  });
});

/**
 * The proxy against a real server on this machine. Only 127.0.0.2 counts as a place the proxy may go to here, so that 127.0.0.1 and
 * `localhost` (the same machine, by number and by name) stand for the private addresses that a public server must keep out of.
 */
describe("handleStreamProxy", () => {
  const OKAY = "127.0.0.2";
  const allowed = (address: string) => address === OKAY;
  let upstream: http.Server;
  let port: number;
  let app: FastifyInstance;
  /** The same proxy with the cache that screens watching together share. */
  let sharing: FastifyInstance;
  const hits: string[] = [];

  beforeAll(async () => {
    upstream = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://upstream");
      hits.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/hop") {
        response.writeHead(302, { location: url.searchParams.get("to") ?? "/" });
        return void response.end();
      }
      if (url.pathname === "/loop") {
        response.writeHead(302, { location: "/loop" });
        return void response.end();
      }
      if (url.pathname === "/seg.ts") {
        response.writeHead(200, { "content-type": "video/mp2t", "content-length": "13" });
        return void response.end("SEGMENT-BYTES");
      }
      if (url.pathname === "/range.mp4") {
        const range = /^bytes=(\d+)-(\d+)?$/.exec(request.headers.range ?? "");
        if (!range) {
          response.writeHead(200, { "content-type": "video/mp4", "content-length": "10", "accept-ranges": "bytes" });
          return void response.end("0123456789");
        }
        const from = Number(range[1]);
        const to = range[2] ? Number(range[2]) : 9;
        response.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${from}-${to}/10`, "content-length": String(to - from + 1), "accept-ranges": "bytes" });
        return void response.end("0123456789".slice(from, to + 1));
      }
      if (url.pathname === "/list.m3u8") {
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        return void response.end("#EXTM3U\n#EXTINF:4,\nseg.ts\n");
      }
      if (url.pathname === "/p/one.ts") {
        response.writeHead(200, { "content-type": "video/mp2t", "content-length": "9" });
        return void response.end("ONE-BYTES");
      }
      if (url.pathname === "/p/slow.ts") {
        // (Half of it now and half a moment later: a screen that asks in between finds it still arriving.)
        response.writeHead(200, { "content-type": "video/mp2t", "content-length": "10" });
        response.write("HALF1");
        return void setTimeout(() => response.end("HALF2"), 150);
      }
      if (url.pathname === "/p/chunked.ts") {
        response.writeHead(200, { "content-type": "video/mp2t" });
        response.write("A");
        return void response.end("BC");
      }
      if (url.pathname === "/p/cut.ts") {
        response.writeHead(200, { "content-type": "video/mp2t", "content-length": "100" });
        response.write("0123456789");
        return void setTimeout(() => response.destroy(), 30);
      }
      if (url.pathname === "/p/gone.ts") {
        response.writeHead(404, { "content-type": "text/plain", "content-length": "4" });
        return void response.end("gone");
      }
      if (url.pathname === "/p/zipped.ts") {
        // (The length it gives is that of the packed bytes, not of the piece that comes out of them.)
        const packed = gzipSync("ZIPPED-BYTES");
        response.writeHead(200, { "content-type": "video/mp2t", "content-encoding": "gzip", "content-length": String(packed.length) });
        return void response.end(packed);
      }
      if (url.pathname === "/p/part.ts") {
        // (Part of a file, although no part was asked for: it says where in the file it is.)
        response.writeHead(206, { "content-type": "video/mp2t", "content-range": "bytes 0-4/50", "content-length": "5" });
        return void response.end("PART1");
      }
      if (url.pathname === "/p/plain.mp4") {
        response.writeHead(200, { "content-type": "video/mp4", "content-length": "5" });
        return void response.end("plain");
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("nothing here");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "0.0.0.0", resolve));
    port = (upstream.address() as AddressInfo).port;
    app = Fastify();
    app.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) => handleStreamProxy(request, reply, { isAllowedAddress: allowed }));
    await app.ready();
    const segments = new SegmentCache();
    sharing = Fastify();
    sharing.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) =>
      handleStreamProxy(request, reply, { isAllowedAddress: allowed, segments }),
    );
    await sharing.ready();
  });
  afterAll(async () => {
    await sharing.close();
    await app.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });

  const ask = (target: string, headers: Record<string, string> = {}) => app.inject({ url: `/api/proxy?url=${encodeURIComponent(target)}`, headers });
  const at = (host: string, path: string) => `http://${host}:${port}${path}`;

  it("passes a piece of a film through, with the headers a player wants", async () => {
    const answer = await ask(at(OKAY, "/seg.ts"));
    expect(answer.statusCode).toBe(200);
    expect(answer.body).toBe("SEGMENT-BYTES");
    expect(answer.headers["content-type"]).toBe("video/mp2t");
    expect(answer.headers["access-control-allow-origin"]).toBe("*");
  });

  it("passes a request for part of a file on, and the part comes back as one", async () => {
    const answer = await ask(at(OKAY, "/range.mp4"), { range: "bytes=2-5" });
    expect(answer.statusCode).toBe(206);
    expect(answer.body).toBe("2345");
    expect(answer.headers["content-range"]).toBe("bytes 2-5/10");
  });

  it("rewrites a playlist so that its pieces come through here as well", async () => {
    const answer = await ask(at(OKAY, "/list.m3u8"));
    expect(answer.body).toContain(`/api/proxy?url=${encodeURIComponent(at(OKAY, "/seg.ts"))}`);
  });

  it("says what the other end said when it has no such thing, and does not tell the player to keep that", async () => {
    const answer = await ask(at(OKAY, "/missing.ts"));
    expect(answer.statusCode).toBe(404);
    expect(answer.body).toBe("nothing here");
    expect(answer.headers["cache-control"]).toBeUndefined();
    expect((await ask(at(OKAY, "/seg.ts"))).headers["cache-control"]).toBe("public, max-age=86400, immutable");
  });

  it("refuses an address written as numbers that is not one it may go to", async () => {
    hits.length = 0;
    expect((await ask(at("127.0.0.1", "/seg.ts"))).statusCode).toBe(403);
    expect(hits).toEqual([]);
  });

  it("refuses a name that leads to such an address, as it does the numbers", async () => {
    // (A name is no number to look at: where it leads is known only when the connection is made.)
    hits.length = 0;
    const answer = await ask(at("localhost", "/seg.ts"));
    expect(answer.statusCode).toBe(403);
    expect(hits).toEqual([]);
  });

  it("follows a redirect to another place it may go to", async () => {
    const answer = await ask(at(OKAY, `/hop?to=${encodeURIComponent(at(OKAY, "/seg.ts"))}`));
    expect(answer.statusCode).toBe(200);
    expect(answer.body).toBe("SEGMENT-BYTES");
  });

  it("does not follow a redirect to an address it may not go to, written as numbers or as a name", async () => {
    hits.length = 0;
    for (const host of ["127.0.0.1", "localhost"]) {
      const answer = await ask(at(OKAY, `/hop?to=${encodeURIComponent(at(host, "/seg.ts"))}`));
      expect(answer.statusCode).toBe(403);
    }
    expect(hits).toEqual(["GET /hop", "GET /hop"]); // (the redirects were asked for; where they led was not)
  });

  it("gives up on a redirect that leads to itself", async () => {
    const answer = await ask(at(OKAY, "/loop"));
    expect(answer.statusCode).toBe(502);
  });

  describe("with the cache that screens watching together share", () => {
    const askShared = (target: string, headers: Record<string, string> = {}) => sharing.inject({ url: `/api/proxy?url=${encodeURIComponent(target)}`, headers });
    const timesAsked = (path: string) => hits.filter((hit) => hit === `GET ${path}`).length;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it("goes to the place the film comes from once for screens that ask one after another, and gives each the same", async () => {
      hits.length = 0;
      const first = await askShared(at(OKAY, "/p/one.ts"));
      const second = await askShared(at(OKAY, "/p/one.ts"));
      expect([first.statusCode, first.body, second.statusCode, second.body]).toEqual([200, "ONE-BYTES", 200, "ONE-BYTES"]);
      for (const header of ["content-type", "content-length", "cache-control", "access-control-allow-origin"]) expect(second.headers[header]).toBe(first.headers[header]);
      expect(first.headers["content-type"]).toBe("video/mp2t");
      expect(first.headers["content-length"]).toBe("9");
      expect(first.headers["cache-control"]).toBe("public, max-age=86400, immutable");
      expect(timesAsked("/p/one.ts")).toBe(1);
    });

    it("goes there once for screens that ask while the piece is still arriving, and each gets all of it", async () => {
      hits.length = 0;
      const first = askShared(at(OKAY, "/p/slow.ts"));
      await pause(60); // (half of it is here)
      const answers = await Promise.all([first, askShared(at(OKAY, "/p/slow.ts")), askShared(at(OKAY, "/p/slow.ts"))]);
      expect(answers.map((answer) => answer.body)).toEqual(["HALF1HALF2", "HALF1HALF2", "HALF1HALF2"]);
      expect(timesAsked("/p/slow.ts")).toBe(1);
    });

    it("does not share a part of a file asked for with a range", async () => {
      hits.length = 0;
      await askShared(at(OKAY, "/p/one.ts"), { range: "bytes=0-3" });
      await askShared(at(OKAY, "/p/one.ts"), { range: "bytes=0-3" });
      expect(timesAsked("/p/one.ts")).toBe(2);
    });

    it("does not keep an answer that said no, nor tell the player to", async () => {
      hits.length = 0;
      const first = await askShared(at(OKAY, "/p/gone.ts"));
      await askShared(at(OKAY, "/p/gone.ts"));
      expect([first.statusCode, first.body]).toEqual([404, "gone"]);
      expect(first.headers["cache-control"]).toBeUndefined();
      expect(timesAsked("/p/gone.ts")).toBe(2);
    });

    it("passes on without sharing a piece that does not say how long it is", async () => {
      hits.length = 0;
      expect((await askShared(at(OKAY, "/p/chunked.ts"))).body).toBe("ABC");
      expect((await askShared(at(OKAY, "/p/chunked.ts"))).body).toBe("ABC");
      expect(timesAsked("/p/chunked.ts")).toBe(2);
    });

    it("passes on without sharing a piece that is packed on its way", async () => {
      hits.length = 0;
      expect((await askShared(at(OKAY, "/p/zipped.ts"))).body).toBe("ZIPPED-BYTES");
      expect((await askShared(at(OKAY, "/p/zipped.ts"))).body).toBe("ZIPPED-BYTES");
      expect(timesAsked("/p/zipped.ts")).toBe(2);
    });

    it("passes on without sharing an answer that is only part of a file", async () => {
      hits.length = 0;
      const answer = await askShared(at(OKAY, "/p/part.ts"));
      expect([answer.statusCode, answer.body, answer.headers["content-range"]]).toEqual([206, "PART1", "bytes 0-4/50"]);
      await askShared(at(OKAY, "/p/part.ts"));
      expect(timesAsked("/p/part.ts")).toBe(2);
    });

    it("does not keep a piece the other end cut off, and fetches it again the next time", async () => {
      hits.length = 0;
      await askShared(at(OKAY, "/p/cut.ts")).catch(() => undefined); // (what the screen gets is a broken answer)
      await pause(80);
      await askShared(at(OKAY, "/p/cut.ts")).catch(() => undefined);
      expect(timesAsked("/p/cut.ts")).toBe(2);
    });

    it("does not share what is not a piece of a film", async () => {
      hits.length = 0;
      expect((await askShared(at(OKAY, "/p/plain.mp4"))).body).toBe("plain");
      expect((await askShared(at(OKAY, "/p/plain.mp4"))).body).toBe("plain");
      expect(timesAsked("/p/plain.mp4")).toBe(2);
    });

    it("still refuses an address it may not go to, and goes nowhere for it", async () => {
      hits.length = 0;
      expect((await askShared(at("127.0.0.1", "/p/one.ts"))).statusCode).toBe(403);
      expect((await askShared(at("localhost", "/p/one.ts"))).statusCode).toBe(403);
      expect(hits).toEqual([]);
    });
  });
});