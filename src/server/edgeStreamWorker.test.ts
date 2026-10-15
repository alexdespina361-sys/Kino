import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../scripts/edge-stream-worker.js";

interface Asked {
  url: string;
  method: string;
  headers: Headers;
}

/** The film's own place, which the worker asks (through `fetch`): `answer` is what it says; what it was asked comes back in the list. */
function theOtherEnd(answer: (asked: Asked) => Response | Promise<Response>): Asked[] {
  const list: Asked[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const asked = { url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers) };
    list.push(asked);
    return answer(asked);
  });
  return list;
}

const relay = "https://kino-edge.example.workers.dev";
const page = "https://player.example/embed/1";
const ask = (target: string, more = "", init: RequestInit = {}) => worker.fetch(new Request(`${relay}/?url=${encodeURIComponent(target)}${more}`, init), {}, {});
const through = (target: string, from = page) => `${relay}/?url=${encodeURIComponent(target)}&referer=${encodeURIComponent(from)}`;

afterEach(() => vi.unstubAllGlobals());

describe("the edge stream worker", () => {
  it("asks the film's own place as a player of its own would: the address it is told to show, no Origin, and the part that was asked for", async () => {
    const asked = theOtherEnd(() => new Response("BYTES", { status: 200, headers: { "content-type": "video/mp2t" } }));
    const answer = await ask("https://cdn.example/a/seg1.ts", `&referer=${encodeURIComponent(page)}`, { headers: { origin: "https://kino.example", range: "bytes=0-9" } });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe("https://cdn.example/a/seg1.ts");
    expect(asked[0]!.headers.get("referer")).toBe(page);
    expect(asked[0]!.headers.has("origin")).toBe(false);
    expect(asked[0]!.headers.get("range")).toBe("bytes=0-9");
    expect(asked[0]!.headers.get("user-agent")).toMatch(/Mozilla/);
    expect(await answer.text()).toBe("BYTES");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(answer.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("shows the film's own address when it is told none, as the server's proxy does", async () => {
    const asked = theOtherEnd(() => new Response("BYTES"));
    await ask("https://cdn.example/a/seg1.ts?token=x");
    expect(asked[0]!.headers.get("referer")).toBe("https://cdn.example/");
  });

  it("rewrites a playlist so that everything in it comes through the worker as well, with the address to show", async () => {
    theOtherEnd(
      () =>
        new Response(
          ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-MAP:URI="init.mp4"', '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1"', "#EXTINF:4,", "seg_000.m4s", "#EXTINF:4,", "/abs/seg_001.m4s", "#EXT-X-ENDLIST", ""].join("\n"),
          { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } },
        ),
    );
    const answer = await ask("https://cdn.example/v/stream.m3u8?token=t", `&referer=${encodeURIComponent(page)}`);
    const body = await answer.text();
    expect(body).toContain(`URI="${through("https://cdn.example/v/init.mp4")}"`);
    expect(body).toContain(`URI="${through("https://keys.example/k1")}"`);
    expect(body).toContain(`\n${through("https://cdn.example/v/seg_000.m4s")}\n`);
    expect(body).toContain(`\n${through("https://cdn.example/abs/seg_001.m4s")}\n`);
    expect(body.startsWith("#EXTM3U\n#EXT-X-VERSION:7\n")).toBe(true);
    expect(answer.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("knows a playlist by what the other end says it is, when its address does not say so", async () => {
    theOtherEnd(() => new Response("#EXTM3U\n#EXTINF:4,\npiece-1\n", { status: 200, headers: { "content-type": "application/x-mpegURL" } }));
    const body = await (await ask("https://cdn.example/hls/playlist", `&referer=${encodeURIComponent(page)}`)).text();
    expect(body).toContain(through("https://cdn.example/hls/piece-1"));
  });

  it("passes a piece on as video whatever the other end calls it, and leaves a type it knows alone", async () => {
    for (const [said, expected] of [["text/html", "video/mp2t"], ["application/octet-stream", "video/mp2t"], ["", "video/mp2t"], ["video/iso.segment", "video/iso.segment"]] as const) {
      theOtherEnd(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: said ? { "content-type": said } : {} }));
      const answer = await ask("https://cdn.example/a/seg1.m4s");
      expect(answer.headers.get("content-type"), said || "(none)").toBe(expected);
    }
  });

  it("does not have a player keep an answer that said no, and says it in a way the player can read", async () => {
    theOtherEnd(() => new Response("<html>blocked</html>", { status: 403, headers: { "content-type": "text/html" } }));
    const answer = await ask("https://cdn.example/a/seg1.ts");
    expect(answer.status).toBe(403);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("says so, readably, when the other end cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const answer = await ask("https://cdn.example/a/seg1.ts");
    expect(answer.status).toBe(502);
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(answer.headers.get("cache-control")).toBe("no-store");
  });

  it("turns away a request that has no address to go to, or none that is a web address, without asking anyone", async () => {
    const asked = theOtherEnd(() => new Response("BYTES"));
    expect((await worker.fetch(new Request(`${relay}/`), {}, {})).status).toBe(400);
    expect((await ask("not an address")).status).toBe(400);
    expect((await ask("file:///etc/passwd")).status).toBe(400);
    expect((await ask("ftp://cdn.example/a")).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("answers a browser's question about what it may ask", async () => {
    const answer = await worker.fetch(new Request(`${relay}/?url=x`, { method: "OPTIONS" }), {}, {});
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(answer.headers.get("access-control-allow-methods")).toContain("GET");
    expect(answer.headers.get("access-control-allow-headers")).toBe("*");
  });
});
