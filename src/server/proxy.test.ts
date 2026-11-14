import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { gzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaylistTooLong, exemptHostsFrom, handleStreamProxy, isExemptHost, rewriteM3u8, srtToVtt } from "./proxy";
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

  describe("what a playlist may come to", () => {
    const base = "https://media.example/stream/list.m3u8";
    const pieces = (count: number) => `#EXTM3U\n${Array.from({ length: count }, (_, n) => `#EXTINF:4,\nseg${n}.ts\n`).join("")}`;
    /** Every address of the playlist gets it written in again: the longest text a request can make of it (each `%` comes out as three characters). */
    const referer = "%".repeat(2048);

    it("rewrites a playlist of 20,000 pieces whole, and refuses one of 20,001", () => {
      const addresses = (text: string) => text.split("\n").filter((line) => line.startsWith("/api/proxy?url=")).length;
      expect(addresses(rewriteM3u8(pieces(20_000), base))).toBe(20_000);
      expect(() => rewriteM3u8(pieces(20_001), base)).toThrow(PlaylistTooLong);
    });

    it("rewrites a playlist that comes out at 11 MB whole, with the weight of each address counted once", () => {
      const text = rewriteM3u8(pieces(10_000), base, "https://site.example/".padEnd(1000, "a"));
      expect(text.length).toBeGreaterThan(8 * 1024 * 1024);
      expect(text.length).toBeLessThan(16 * 1024 * 1024);
    });

    it("counts the addresses in the tags as well, however many a line holds", () => {
      const keys = `#EXTM3U\n#EXT-X-SESSION-KEY:${'URI="k.key",'.repeat(20_001)}\n`;
      expect(() => rewriteM3u8(keys, base)).toThrow(PlaylistTooLong);
    });

    it("refuses a playlist that comes out larger than 16 MiB, from lines of a few bytes and a long referer", () => {
      // (5,000 of them: well under the count above, 30 MB as they come out.)
      expect(() => rewriteM3u8(`#EXTM3U\n${"a\n".repeat(5_000)}`, base, referer)).toThrow(PlaylistTooLong);
    });

    it("counts what comes out as each address of a line does, not when the line is done", () => {
      // (10,000 addresses in one line: 60 MB with the referer in each.)
      const keys = `#EXTM3U\n#EXT-X-SESSION-KEY:${'URI="k.key",'.repeat(10_000)}\n`;
      expect(() => rewriteM3u8(keys, base, referer)).toThrow(PlaylistTooLong);
    });
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
  let endlessLetGo = false;

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
      if (url.pathname === "/many.m3u8") {
        // (More pieces than any film has, each of them a few bytes.)
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        return void response.end(`#EXTM3U\n${"a.ts\n".repeat(30_000)}`);
      }
      if (url.pathname === "/hls/playlist") {
        // (Many servers write the type like this, and the address says nothing.)
        response.writeHead(200, { "content-type": "application/x-mpegURL" });
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
      if (url.pathname === "/sub.srt" || url.pathname === "/sub-without-a-suffix") {
        response.writeHead(200, { "content-type": "text/plain" });
        return void response.end("1\n00:00:01,000 --> 00:00:02,000\nHello\n");
      }
      if (url.pathname === "/long.srt" || url.pathname === "/big.bin") {
        const bytes = Buffer.alloc(3 * 1024 * 1024, "a");
        response.writeHead(200, { "content-type": url.pathname === "/big.bin" ? "application/octet-stream" : "text/plain", "content-length": String(bytes.length) });
        return void response.end(bytes);
      }
      if (url.pathname === "/long-chunked.srt") {
        // (No length given: how long it is is known only when it has all come.)
        response.writeHead(200, { "content-type": "text/plain" });
        for (let part = 0; part < 3; part++) response.write(Buffer.alloc(1024 * 1024 + 1, "a"));
        return void response.end();
      }
      if (url.pathname === "/stacked.mp4") {
        // (More content codings than a client takes, and the connection dropped before the body: an advisory for undici 8.11 (GHSA-xjj6-f33q-929c) says that took the whole process down.)
        response.writeHead(200, { "content-type": "video/mp4", "content-encoding": "gzip, gzip, gzip, gzip, gzip, gzip", "content-length": "100" });
        response.flushHeaders();
        return void setTimeout(() => response.socket?.destroy(), 20);
      }
      // (Pages and pictures under the names of films and subtitles: what a browser must never be told is a page when it comes from here.)
      if (url.pathname === "/page.vtt" || url.pathname === "/error-without-a-suffix") {
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        return void response.end("<p>an error page</p>");
      }
      if (url.pathname === "/page.m3u8" || url.pathname === "/page.html") {
        response.writeHead(200, { "content-type": "text/html" });
        return void response.end("<p>a page</p>");
      }
      if (url.pathname === "/picture.ts" || url.pathname === "/picture.svg") {
        const picture = "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
        response.writeHead(200, { "content-type": "image/svg+xml", "content-length": String(Buffer.byteLength(picture)) });
        return void response.end(picture);
      }
      if (url.pathname === "/sound.mp3") {
        response.writeHead(200, { "content-type": "audio/mpeg", "content-length": "5" });
        return void response.end("sound");
      }
      if (url.pathname.startsWith("/typed/")) {
        // (Whatever it is told to call itself, in as many Content-Type headers as it is told: `?t=["video/mp4;, text/html"]`.)
        const types = JSON.parse(url.searchParams.get("t") ?? "[]") as string[];
        response.writeHead(200, ["content-length", "5", ...types.flatMap((type) => ["content-type", type])]);
        return void response.end("12345");
      }
      if (url.pathname === "/endless") {
        // (Says it is sixteen megabytes and goes on writing for as long as anyone listens.)
        response.writeHead(200, { "content-type": "video/mp4", "content-length": String(16 * 1024 * 1024) });
        const writing = setInterval(() => response.write(Buffer.alloc(64 * 1024)), 5);
        return void response.on("close", () => {
          clearInterval(writing);
          endlessLetGo = true;
        });
      }
      if (url.pathname === "/status600.vtt") {
        response.writeHead(600, { "content-type": "text/plain" });
        return void response.end("odd");
      }
      if (url.pathname === "/huge.m3u8" || url.pathname === "/packed-huge.m3u8") {
        // (Nine megabytes of playlist; the second is nine megabytes once it is unpacked, from some kilobytes.)
        const text = Buffer.concat([Buffer.from("#EXTM3U\n"), Buffer.alloc(9 * 1024 * 1024, "#")]);
        if (url.pathname === "/huge.m3u8") {
          response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "content-length": String(text.length) });
          return void response.end(text);
        }
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl", "content-encoding": "gzip" });
        return void response.end(gzipSync(text));
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

  it("turns away a playlist with more pieces than any film has, and goes on serving", async () => {
    const answer = await ask(at(OKAY, "/many.m3u8"));
    expect(answer.statusCode).toBe(502);
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(answer.body).toBe("The playlist is too long");
    expect((await ask(at(OKAY, "/seg.ts"))).statusCode).toBe(200);
  });

  it("takes a referer as long as the address of a page may be, and no longer", async () => {
    const through = (referer: string) => app.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/list.m3u8"))}&referer=${encodeURIComponent(referer)}` });
    const page = (length: number) => "https://site.example/".padEnd(length, "a");
    expect((await through(page(2048))).statusCode).toBe(200);
    expect((await through(page(2049))).statusCode).toBe(400);
  });

  it("knows a playlist by the type the other end gives it, in whatever case, when the address does not say so", async () => {
    const answer = await ask(at(OKAY, "/hls/playlist"));
    expect(answer.headers["content-type"]).toBe("application/vnd.apple.mpegurl");
    expect(answer.body).toContain(`/api/proxy?url=${encodeURIComponent(at(OKAY, "/hls/seg.ts"))}`);
  });

  it("counts the bytes it sends on and the requests it answers: pieces, parts of a file, playlists, and a piece that screens share", async () => {
    const stats = { bytes: 0, requests: 0, refused: 0 };
    const counting = Fastify();
    counting.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) =>
      handleStreamProxy(request, reply, { isAllowedAddress: allowed, stats, segments: new SegmentCache() }),
    );
    await counting.ready();
    try {
      const through = (target: string, headers: Record<string, string> = {}) => counting.inject({ url: `/api/proxy?url=${encodeURIComponent(target)}`, headers });
      await through(at(OKAY, "/seg.ts")); // 13 bytes (and shared)
      await through(at(OKAY, "/seg.ts")); // 13 more, from memory this time: it is sent all the same
      await through(at(OKAY, "/range.mp4"), { range: "bytes=2-5" }); // 4
      const playlist = await through(at(OKAY, "/list.m3u8")); // as it was rewritten
      expect(stats).toEqual({ bytes: 13 + 13 + 4 + Buffer.byteLength(playlist.body), requests: 4, refused: 0 });
      expect((await through(at("127.0.0.1", "/seg.ts"))).statusCode).toBe(403);
      expect(stats.requests).toBe(4); // (a refusal sends nothing on)
    } finally {
      await counting.close();
    }
  });

  describe("when it is not to carry film (a host that charges for what it sends)", () => {
    const stats = { bytes: 0, requests: 0, refused: 0 };
    let quiet: FastifyInstance;
    beforeAll(async () => {
      quiet = Fastify();
      quiet.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) =>
        handleStreamProxy(request, reply, { isAllowedAddress: allowed, video: false, stats, segments: new SegmentCache() }),
      );
      await quiet.ready();
    });
    afterAll(async () => {
      await quiet.close();
    });
    const through = (path: string, more = "") => quiet.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, path))}${more}` });

    it("turns away a piece of a film without so much as asking for it, and says so in a way a player can read", async () => {
      hits.length = 0;
      const before = stats.refused;
      const answer = await through("/seg.ts");
      expect(answer.statusCode).toBe(403);
      expect(answer.json()).toEqual({ error: "VIDEO_NOT_CARRIED" });
      expect(hits).toEqual([]);
      expect(stats.refused).toBe(before + 1);
    });

    it("turns away a playlist, a file and anything else that is not a subtitle, and sends none of it on", async () => {
      const before = { ...stats };
      for (const path of ["/list.m3u8", "/p/plain.mp4", "/big.bin", "/missing"]) {
        const answer = await through(path);
        expect(answer.statusCode, path).toBe(403);
        expect(answer.json(), path).toEqual({ error: "VIDEO_NOT_CARRIED" });
      }
      expect(stats.bytes).toBe(before.bytes);
      expect(stats.refused).toBe(before.refused + 4);
      // (A range, a piece's other names and a plain "this is a subtitle" on the address make no difference to what it is.)
      expect((await quiet.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/range.mp4"))}`, headers: { range: "bytes=0-3" } })).statusCode).toBe(403);
      expect((await through("/list.m3u8", "&format=vtt")).statusCode).toBe(403);
    });

    it("carries film from a host it was set up to carry from and from no other: a name under `.space` or `.cyou` is not carried for being one", async () => {
      // (As it used to be: a piece of a film at any such name went through, whatever `video` said.)
      hits.length = 0;
      for (const host of ["cdn.example.space", "anything.cyou"]) {
        const answer = await quiet.inject({ url: `/api/proxy?url=${encodeURIComponent(`https://${host}/hls/seg.ts`)}` });
        expect(answer.statusCode, host).toBe(403);
        expect(answer.json(), host).toEqual({ error: "VIDEO_NOT_CARRIED" });
      }
      expect(hits).toEqual([]);

      const lines: Array<{ msg?: string; host?: string }> = [];
      const exempt = Fastify({ logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as { msg?: string; host?: string }) } } });
      exempt.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) =>
        handleStreamProxy(request, reply, { isAllowedAddress: allowed, video: false, exemptHosts: exemptHostsFrom(` ${OKAY}, .not-this.example `), segments: new SegmentCache() }),
      );
      await exempt.ready();
      try {
        const piece = await exempt.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/seg.ts"))}` });
        expect(piece.statusCode).toBe(200);
        expect(piece.body).toBe("SEGMENT-BYTES");
        expect((await exempt.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/list.m3u8"))}` })).statusCode).toBe(200);
        // (A host that is not named is turned away as before, and the log says which it was, without the link.)
        const other = await exempt.inject({ url: `/api/proxy?url=${encodeURIComponent("https://cdn.example.space/hls/seg.ts?token=SECRET")}` });
        expect(other.statusCode).toBe(403);
        expect(lines.filter((line) => line.msg === "proxy-refused").map((line) => line.host)).toEqual(["cdn.example.space"]);
        expect(JSON.stringify(lines.filter((line) => line.msg === "proxy-refused"))).not.toContain("SECRET");
      } finally {
        await exempt.close();
      }
    });

    it("reads the list of hosts to carry from as names and the ends of names, and nothing else", () => {
      expect(exemptHostsFrom(undefined)).toEqual([]);
      expect(exemptHostsFrom("")).toEqual([]);
      expect(exemptHostsFrom(".space, *.cyou cdn.Example.com.")).toEqual(["space", "cyou", "cdn.example.com"]);
      expect(exemptHostsFrom("https://x.example/, a b/c, -x, ok.example")).toEqual(["a", "ok.example"]);
      expect(isExemptHost("a.b.space", ["space"])).toBe(true);
      expect(isExemptHost("SPACE", ["space"])).toBe(true);
      expect(isExemptHost("myspace", ["space"])).toBe(false);
      expect(isExemptHost("space.example", ["space"])).toBe(false);
      expect(isExemptHost("cdn.example.com", ["example.com"])).toBe(true);
      expect(isExemptHost("notexample.com", ["example.com"])).toBe(false);
      expect(isExemptHost("a.b.space", [])).toBe(false);
      expect(isExemptHost("a.b.space", undefined)).toBe(false);
    });

    it("still passes a subtitle on, as WebVTT, which is what a screen has it for", async () => {
      for (const [path, more] of [["/sub.srt", ""], ["/sub-without-a-suffix", "&format=vtt"]] as const) {
        const answer = await through(path, more);
        expect(answer.statusCode, path).toBe(200);
        expect(answer.headers["content-type"], path).toContain("text/vtt");
        expect(answer.body, path).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello");
      }
    });

    it("does not pass a long text on as a subtitle, nor a file that is only called one", async () => {
      const before = { ...stats };
      for (const [path, more] of [["/long.srt", ""], ["/long-chunked.srt", ""], ["/big.bin", "&format=vtt"]] as const) {
        const answer = await through(path, more);
        expect(answer.statusCode, path).toBe(403);
      }
      expect(stats.bytes).toBe(before.bytes);
    });

    it("is what a proxy that is not told otherwise is not: that one carries a long text as well", async () => {
      expect((await ask(at(OKAY, "/long.srt"))).statusCode).toBe(200);
      expect((await ask(at(OKAY, "/seg.ts"))).statusCode).toBe(200);
    });
  });

  describe("what a browser is told about what comes through (it all goes out under this site's own address)", () => {
    let production: FastifyInstance;
    beforeAll(async () => {
      production = Fastify();
      production.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) =>
        handleStreamProxy(request, reply, { isAllowedAddress: allowed, video: false, segments: new SegmentCache() }),
      );
      await production.ready();
    });
    afterAll(async () => {
      await production.close();
    });
    type Answer = Awaited<ReturnType<typeof ask>>;
    /** The type a browser takes an answer for: what the Fetch standard makes of the header (it reads a list and keeps the last type), not what the header looks like. */
    const typeSeen = async (answer: Answer) => (await new Response("", { headers: { "content-type": String(answer.headers["content-type"]) } }).blob()).type.split(";")[0];
    const KINDS = /^(text\/plain|text\/vtt|application\/(json|octet-stream|vnd\.apple\.mpegurl)|(video|audio)\/[a-z0-9.-]+)$/;
    /** Not a page by its type, not one by guessing, and not able to run if it were taken for one. */
    const inert = async (answer: Answer, name: string) => {
      expect(await typeSeen(answer), name).toMatch(KINDS);
      expect(answer.headers["x-content-type-options"], name).toBe("nosniff");
      expect(answer.headers["content-security-policy"], name).toBe("default-src 'none'; sandbox");
    };
    const shared = (target: string) => sharing.inject({ url: `/api/proxy?url=${encodeURIComponent(target)}` });

    it("does not call the other end's error page a page, whether the address says it is a subtitle or the asker does (that is what gets past a server that carries no film)", async () => {
      for (const [path, more] of [["/page.vtt", ""], ["/error-without-a-suffix", "&format=vtt"]] as const) {
        for (const [name, lane] of [["carrying no film", production], ["carrying film", app]] as const) {
          const answer = await lane.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, path))}${more}` });
          expect(answer.statusCode, `${name} ${path}`).toBe(404);
          expect(answer.body, `${name} ${path}`).toBe("<p>an error page</p>");
          expect(answer.headers["content-type"], `${name} ${path}`).toBe("text/plain; charset=utf-8");
          await inert(answer, `${name} ${path}`);
        }
      }
    });

    it("does not call a page that is said to be a playlist a page, nor any other page or picture", async () => {
      expect((await ask(at(OKAY, "/page.m3u8"))).headers["content-type"]).toBe("text/plain; charset=utf-8");
      for (const path of ["/page.m3u8", "/page.html", "/picture.svg"]) {
        const answer = await ask(at(OKAY, path));
        expect(answer.statusCode, path).toBe(200);
        await inert(answer, path);
      }
      expect((await ask(at(OKAY, "/page.html"))).headers["content-type"]).toBe("application/octet-stream");
    });

    it("tells a picture that is called a piece of a film that it is video, whether the screens share it or not", async () => {
      for (const [name, answer] of [["alone", await ask(at(OKAY, "/picture.ts"))], ["shared", await shared(at(OKAY, "/picture.ts"))]] as const) {
        expect(answer.headers["content-type"], name).toBe("video/mp2t");
        await inert(answer, name);
      }
    });

    it("passes on the type of video or audio and nothing the other end wrote after it: a browser reads `video/mp4;, text/html` as a list, and takes the last", async () => {
      // [what the other end calls it (one header each), what a piece of a film is called, what any other file is called]
      const cases: [string[], string, string][] = [
        [["video/mp4;, text/html"], "video/mp4", "video/mp4"],
        [["video/mp4; codecs=avc1", "text/html"], "video/mp4", "video/mp4"],
        [["video/mp2t;, image/svg+xml"], "video/mp2t", "video/mp2t"],
        [["video/mp4;, text/javascript"], "video/mp4", "video/mp4"],
        [["text/html, video/mp4"], "video/mp2t", "application/octet-stream"],
        [["video/x+xml"], "video/mp2t", "application/octet-stream"],
        [["audio/x+json"], "video/mp2t", "application/octet-stream"],
        [["VIDEO/MP4"], "video/mp4", "video/mp4"],
        [['video/mp4; codecs="avc1.64001F, mp4a.40.2"'], "video/mp4", "video/mp4"],
        [["audio/mpeg"], "audio/mpeg", "audio/mpeg"],
      ];
      for (const [types, piece, file] of cases) {
        const query = `?t=${encodeURIComponent(JSON.stringify(types))}`;
        for (const [name, answer, expected] of [
          ["a piece, alone", await ask(at(OKAY, `/typed/piece.ts${query}`)), piece],
          ["a piece, shared", await shared(at(OKAY, `/typed/piece.ts${query}`)), piece],
          ["a file", await ask(at(OKAY, `/typed/file.bin${query}`)), file],
        ] as const) {
          const why = `${name} ${JSON.stringify(types)}`;
          expect(answer.headers["content-type"], why).toBe(expected);
          expect(await typeSeen(answer), why).toBe(expected);
          await inert(answer, why);
        }
      }
    });

    it("gives no other website leave to read what comes through: not a piece, a playlist, a subtitle, a file, a refusal or a failure", async () => {
      // (This site's own pages ask from this site; a page of another one that could read these would be using the server to fetch for it.)
      const kinds: [string, FastifyInstance, string][] = [
        ["a piece", app, at(OKAY, "/seg.ts")],
        ["a piece that screens share", sharing, at(OKAY, "/seg.ts")],
        ["a part of a file", app, at(OKAY, "/range.mp4")],
        ["a playlist", app, at(OKAY, "/list.m3u8")],
        ["a subtitle, from a server that carries no film", production, at(OKAY, "/sub.srt")],
        ["a piece, from a server that carries no film", production, at(OKAY, "/seg.ts")],
        ["a file, from a server that carries no film", production, at(OKAY, "/p/plain.mp4")],
        ["a failure of the other end", app, at(OKAY, "/missing.ts")],
        ["a place it may not go to", app, at("127.0.0.1", "/seg.ts")],
      ];
      for (const [name, lane, target] of kinds) {
        const answer = await lane.inject({ url: `/api/proxy?url=${encodeURIComponent(target)}` });
        expect(Object.keys(answer.headers).filter((header) => header.startsWith("access-control-")), name).toEqual([]);
      }
    });

    it("tells every answer, a refusal or a failure included, not to be guessed at and not to be run", async () => {
      const target = (path: string) => encodeURIComponent(at(OKAY, path));
      const asks: [string, FastifyInstance, string][] = [
        ["no address", app, "/api/proxy"],
        ["an address that is none", app, "/api/proxy?url=not%20an%20address"],
        ["a place it may not go to", app, `/api/proxy?url=${encodeURIComponent(at("127.0.0.1", "/seg.ts"))}`],
        ["a redirect to a place it may not go to", app, `/api/proxy?url=${target(`/hop?to=${encodeURIComponent(at("127.0.0.1", "/seg.ts"))}`)}`],
        ["a 'referer' that is none", app, `/api/proxy?url=${target("/seg.ts")}&referer=none`],
        ["a piece, from a server that carries no film", production, `/api/proxy?url=${target("/seg.ts")}`],
        ["a file, from a server that carries no film", production, `/api/proxy?url=${target("/page.html")}&format=vtt`],
        ["a place that does not answer", app, `/api/proxy?url=${encodeURIComponent(`http://${OKAY}:1/seg.ts`)}`],
        ["a status of the other end's own invention", production, `/api/proxy?url=${target("/status600.vtt")}`],
        ["a failure of the other end", app, `/api/proxy?url=${target("/missing.ts")}`],
      ];
      for (const [name, lane, url] of asks) await inert(await lane.inject({ url }), name);
    });

    it("answers for a status the other end invented with one of its own, instead of failing on it", async () => {
      for (const [name, lane] of [["carrying no film", production], ["carrying film", app]] as const) {
        const answer = await lane.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/status600.vtt"))}` });
        expect(answer.statusCode, name).toBe(502);
        expect(answer.body, name).toBe("odd");
      }
    });

    it("sends the headers alone to whoever asks for those, and lets the other end go instead of reading the film to its end for nothing", async () => {
      endlessLetGo = false;
      const answer = await app.inject({ method: "HEAD", url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/endless"))}` });
      expect(answer.statusCode).toBe(200);
      expect(answer.headers["content-type"]).toBe("video/mp4");
      expect(answer.body).toBe("");
      for (let waited = 0; !endlessLetGo && waited < 2000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(endlessLetGo).toBe(true);
    });

    it("does not pass on the length of what was packed when what it passes on is what came out of the packing", async () => {
      const answer = await ask(at(OKAY, "/p/zipped.ts"));
      expect(answer.body).toBe("ZIPPED-BYTES");
      expect(answer.headers["content-length"] ?? "12").toBe("12");
    });

    it("does not read a playlist beyond a size no film needs, nor one that is that long only once it is unpacked", async () => {
      for (const path of ["/huge.m3u8", "/packed-huge.m3u8"]) {
        const answer = await ask(at(OKAY, path));
        expect(answer.statusCode, path).toBe(502);
        expect(answer.body.length, path).toBeLessThan(100);
        await inert(answer, path);
      }
    });

    it("keeps the type of video and audio, and tells every answer, a refusal included, not to be guessed at", async () => {
      expect((await ask(at(OKAY, "/seg.ts"))).headers["content-type"]).toBe("video/mp2t");
      expect((await ask(at(OKAY, "/range.mp4"))).headers["content-type"]).toBe("video/mp4");
      const sound = await ask(at(OKAY, "/sound.mp3"));
      expect(sound.headers["content-type"]).toBe("audio/mpeg");
      expect(sound.headers["x-content-type-options"]).toBe("nosniff");
      const refused = await ask(at("127.0.0.1", "/seg.ts"));
      expect(refused.statusCode).toBe(403);
      expect(refused.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("turns away a 'referer' that is not an address, instead of failing on it", async () => {
      const answer = await app.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/seg.ts"))}&referer=not%20an%20address` });
      expect(answer.statusCode).toBe(400);
      expect((await app.inject({ url: `/api/proxy?url=${encodeURIComponent(at(OKAY, "/seg.ts"))}&referer=${encodeURIComponent("https://player.example/embed")}` })).statusCode).toBe(200);
    });

    it("turns away a 'url' or a 'referer' that is given twice, instead of taking the two as one text", async () => {
      // (A name given twice reaches a handler as a list, and a list of two addresses reads as one address with a comma in it: the second of two referers
      // would also have been as long as it liked.)
      const piece = encodeURIComponent(at(OKAY, "/seg.ts"));
      const page = encodeURIComponent("https://player.example/embed");
      const asks = [`url=${piece}&url=${piece}`, `url=${piece}&referer=${page}&referer=${page}`, `url=${piece}&referer=${page}&referer=${encodeURIComponent("x".repeat(5000))}`];
      for (const ask of asks) expect((await app.inject({ url: `/api/proxy?${ask}` })).statusCode, ask.slice(0, 60)).toBe(400);
    });
  });

  it("answers with a failure, and goes on serving, when the other end stacks more content codings than a client takes and drops the connection", async () => {
    // (Any visitor can send the proxy to a server of their own: a library that fell over on that one answer would take every screen down with it. What the
    // old one did was throw from a socket that nobody listens to, which ends the whole process, so the test listens for exactly that.)
    const thrown: unknown[] = [];
    const note = (error: unknown) => void thrown.push(error);
    process.on("uncaughtException", note);
    try {
      const answer = await ask(at(OKAY, "/stacked.mp4"));
      expect(answer.statusCode).toBeGreaterThanOrEqual(500);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await ask(at(OKAY, "/seg.ts"))).statusCode).toBe(200);
    } finally {
      process.off("uncaughtException", note);
    }
    expect(thrown).toEqual([]);
  });

  it("says what the other end said when it has no such thing, and does not tell the player to keep that", async () => {
    const answer = await ask(at(OKAY, "/missing.ts"));
    expect(answer.statusCode).toBe(404);
    expect(answer.body).toBe("nothing here");
    expect(answer.headers["cache-control"]).toBe("no-store");
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

  it("leaves nothing behind on the connection for each piece it passes on (a browser asks for hundreds over one)", async () => {
    const live = Fastify();
    live.get<{ Querystring: { url?: string; referer?: string; format?: string } }>("/api/proxy", (request, reply) => handleStreamProxy(request, reply, { isAllowedAddress: allowed }));
    const sockets: Socket[] = [];
    live.server.on("connection", (socket) => sockets.push(socket));
    await live.listen({ port: 0, host: "127.0.0.1" });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const target = encodeURIComponent(at(OKAY, "/seg.ts"));
    try {
      for (let piece = 0; piece < 15; piece++) {
        await new Promise<void>((resolve, reject) => {
          http
            .get({ host: "127.0.0.1", port: (live.server.address() as AddressInfo).port, path: `/api/proxy?url=${target}`, agent }, (response) => {
              response.resume();
              response.on("end", resolve);
            })
            .on("error", reject);
        });
      }
      expect(sockets).toHaveLength(1); // (one connection carried all fifteen)
      expect(sockets[0]!.listenerCount("close")).toBeLessThan(6); // (it was fifteen more than the server's own, and Node warns of a leak from eleven)
    } finally {
      agent.destroy();
      await live.close();
    }
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
      for (const header of ["content-type", "content-length", "cache-control"]) expect(second.headers[header]).toBe(first.headers[header]);
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
