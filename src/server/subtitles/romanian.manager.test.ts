import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES, MAX_FILE_BYTES, MAX_KEPT_TITLES, RomanianSubtitleManager, episodeId, extractSrtFromZip, isListedFile, siteFetch } from "./romanian";

/*
 * The manager asks the Romanian subtitle sites, which send whole archives. These tests are about how it asks: the archives of a site at once rather than one
 * after the other, the two sites at once, and a title asked about twice in the same moment asked of the sites once. The sites are made up; nothing goes anywhere.
 */

/** A zip archive of one .srt file, as `extractSrtFromZip` reads it. */
function zipOf(name: string, srt: string): Buffer {
  const deflated = zlib.deflateRawSync(Buffer.from(srt, "utf8"));
  const fnBuf = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(deflated.length, 18);
  header.writeUInt32LE(Buffer.byteLength(srt), 22);
  header.writeUInt16LE(fnBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, fnBuf, deflated]);
}
const srt = (line: string) => `1\n00:00:01,000 --> 00:00:02,000\n${line}\n\n2\n00:00:03,000 --> 00:00:04,000\n${line} ${line} ${line} ${line} ${line} ${line} ${line} ${line} ${line} ${line}\n`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The sites of the test: Subs.ro lists two archives, Subtitrari-Noi one; every archive takes `archiveMs` to come. */
function sitesOf(archiveMs: number) {
  const asked: string[] = [];
  let underway = 0;
  let mostUnderway = 0;
  const archive = async (name: string, line: string) => {
    underway += 1;
    mostUnderway = Math.max(mostUnderway, underway);
    await sleep(archiveMs);
    underway -= 1;
    return new Response(new Uint8Array(zipOf(name, srt(line))), { headers: { "content-type": "application/zip" } });
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://subs.ro/cautare") return new Response('<input name="antispam" value="x">', { headers: { "set-cookie": "s=1" } });
    if (url === "https://subs.ro/ajax/search") return new Response('<a href="https://subs.ro/subtitrare/a-film/11">a</a><a href="https://subs.ro/subtitrare/a-film-too/12">b</a>');
    if (url.startsWith("https://subs.ro/subtitrare/descarca/a-film/11")) return archive("a.srt", "Unu");
    if (url.startsWith("https://subs.ro/subtitrare/descarca/a-film-too/12")) return archive("b.srt", "Doi");
    if (url === "https://www.subtitrari-noi.ro/paginare_filme.php") return new Response('<a href="https://subtitrari-noi.ro/Arhive/c.zip">c</a>');
    if (url === "https://subtitrari-noi.ro/Arhive/c.zip") return archive("c.srt", "Trei");
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked, mostUnderway: () => mostUnderway };
}

describe("RomanianSubtitleManager", () => {
  it("fetches the archives of both sites at once, and lists Subs.ro's first", async () => {
    const sites = sitesOf(40);
    const manager = new RomanianSubtitleManager(undefined, sites.fetch);
    const started = Date.now();
    const subs = await manager.getSubtitles({ imdbId: "tt0001", title: "A Film" });
    expect(Date.now() - started).toBeLessThan(40 * 3); // (three archives of 40 ms: at once, not one after the other)
    expect(sites.mostUnderway()).toBe(3);
    expect(subs.map((sub) => sub.label)).toEqual(["Romanian (Subs.ro) · a", "Romanian (Subs.ro) · b", "Romanian (Retail / Subtitrari-Noi) · c"]);
    expect(subs.map((sub) => sub.id)).toEqual([9000, 9001, 9002]);
    for (const sub of subs) expect(manager.getVtt(sub.url.replace("/api/subtitles/ro/", "").replace(".vtt", ""))).toContain("WEBVTT");
  });

  it("asks the sites once about a title asked about twice in the same moment, and not again after", async () => {
    const sites = sitesOf(10);
    const manager = new RomanianSubtitleManager(undefined, sites.fetch);
    const [first, second] = await Promise.all([manager.getSubtitles({ imdbId: "tt0001", title: "A Film" }), manager.getSubtitles({ imdbId: "tt0001", title: "A Film" })]);
    expect(first).toEqual(second);
    expect(sites.asked.filter((ask) => ask.endsWith("subs.ro/cautare"))).toHaveLength(1);
    const before = sites.asked.length;
    await manager.getSubtitles({ imdbId: "tt0001", title: "A Film" });
    expect(sites.asked.length).toBe(before);
  });

  it("gives what the other site has when one of them fails", async () => {
    const sites = sitesOf(10);
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("subs.ro")) throw new Error("down");
      return sites.fetch(input, init);
    }) as typeof globalThis.fetch;
    const manager = new RomanianSubtitleManager(undefined, failing);
    const subs = await manager.getSubtitles({ imdbId: "tt0001", title: "A Film" });
    expect(subs.map((sub) => sub.label)).toEqual(["Romanian (Retail / Subtitrari-Noi) · c"]);
  });

  it("gives each episode of a season's pack a subtitle of its own name", async () => {
    // (One archive holds the season; the files of every episode used to be numbered from one, so two episodes shared a name and the later look-up answered for both.)
    const pack = Buffer.concat([zipOf("Show.S01E01.srt", srt("Primul")), zipOf("Show.S01E02.srt", srt("Al doilea"))]);
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://subs.ro/cautare") return new Response('<input name="antispam" value="x">');
      if (url === "https://subs.ro/ajax/search") return new Response('<a href="https://subs.ro/subtitrare/show-sezonul-1/77">a</a>');
      if (url.startsWith("https://subs.ro/subtitrare/descarca/")) return new Response(new Uint8Array(pack));
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    const manager = new RomanianSubtitleManager(undefined, fetch);
    const [first] = await manager.getSubtitles({ imdbId: "tt0002", season: 1, episode: 1 });
    const [second] = await manager.getSubtitles({ imdbId: "tt0002", season: 1, episode: 2 });
    expect(first!.url).not.toBe(second!.url);
    const kept = (track: { url: string }) => manager.getVtt(track.url.replace("/api/subtitles/ro/", "").replace(".vtt", ""));
    expect(kept(first!)).toContain("Primul");
    expect(kept(second!)).toContain("Al doilea");
    expect(episodeId("subsro_77_1", 1, 2)).toBe("subsro_77_1_s1e2");
    expect(episodeId("subsro_77_1_s1e2", 1, 2)).toBe("subsro_77_1_s1e2"); // (what was kept under the new name is not renamed again)
    expect(episodeId("subsro_77_1", undefined, undefined)).toBe("subsro_77_1");
  });

  it("does not read an archive that is larger than a pack is, whether it says so or not", async () => {
    let sent = 0;
    let cancelled = false;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1024 * 1024;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      });
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://subs.ro/cautare") return new Response('<input name="antispam" value="x">');
      if (url === "https://subs.ro/ajax/search") return new Response('<a href="https://subs.ro/subtitrare/a-film/11">a</a><a href="https://subs.ro/subtitrare/a-film-too/12">b</a>');
      if (url.includes("/descarca/a-film/11")) return new Response(endless()); // (never ends, and does not say how long it is)
      if (url.includes("/descarca/a-film-too/12")) return new Response(new Uint8Array(zipOf("b.srt", srt("Doi"))), { headers: { "content-length": String(MAX_ARCHIVE_BYTES + 1) } });
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    const manager = new RomanianSubtitleManager(undefined, fetch);
    expect(await manager.getSubtitles({ imdbId: "tt0003", title: "A Film" })).toEqual([]);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(MAX_ARCHIVE_BYTES + 4 * 1024 * 1024);
  });

  it("leaves out a file that unpacks to more than a subtitle is, and stops at the number of files a pack has", () => {
    const bomb = zipOf("bomb.srt", "0".repeat(MAX_FILE_BYTES + 1));
    expect(bomb.length).toBeLessThan(64 * 1024); // (a few kilobytes that unpack to megabytes)
    const found = extractSrtFromZip(Buffer.concat([bomb, zipOf("good.srt", srt("Bun"))]));
    expect(found.map((file) => file.name)).toEqual(["good.srt"]);
    const many = Buffer.concat(Array.from({ length: MAX_ARCHIVE_FILES + 5 }, (_, n) => zipOf(`${n}.srt`, srt("Unu"))));
    expect(extractSrtFromZip(many)).toHaveLength(MAX_ARCHIVE_FILES);
    // (An archive cut short in the middle of a header is read as far as it goes, not past its end.)
    expect(extractSrtFromZip(Buffer.concat([zipOf("good.srt", srt("Bun")), zipOf("cut.srt", srt("Rupt")).subarray(0, 12)]))).toHaveLength(1);
  });

  it("fetches a listed file only from the subtitle site's own place", async () => {
    expect(isListedFile("https://subs5.strem.io/en/download/file/1")).toBe(true);
    expect(isListedFile("https://strem.io/file/1")).toBe(true);
    for (const elsewhere of ["http://subs5.strem.io/file/1", "https://strem.io.example.com/file/1", "https://notstrem.io/file/1", "https://user:pass@subs5.strem.io/file/1", "https://169.254.169.254/latest", "http://localhost:8787/api/health", "file:///etc/passwd", "not a link"]) {
      expect(isListedFile(elsewhere), elsewhere).toBe(false);
    }
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith("https://opensubtitles-v3.strem.io/")) {
        return Response.json({
          subtitles: [
            { id: "1", url: "http://127.0.0.1:8787/api/health", lang: "ron" },
            { id: "2/../x?y", url: "https://subs5.strem.io/file/2", lang: "ron", subtitleFileName: "Film.srt" },
          ],
        });
      }
      if (url === "https://subs5.strem.io/file/2") return new Response(srt("Salut"));
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    const manager = new RomanianSubtitleManager(undefined, fetch);
    const subs = await manager.getSubtitles({ imdbId: "tt0004" });
    expect(asked.some((url) => url.includes("127.0.0.1"))).toBe(false);
    expect(subs.map((sub) => sub.url)).toEqual(["/api/subtitles/ro/os_2xy.vtt"]); // (the site's name for the file, without what is not a letter, a digit, `_` or `-`)
  });

  it("lets the titles asked about longest ago go when it keeps too many, and asks the sites again when one of them is wanted", async () => {
    const asked: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://subs.ro/cautare") return new Response('<input name="antispam" value="x">');
      if (url === "https://subs.ro/ajax/search") {
        const title = new URLSearchParams(String(init?.body)).get("external_id")!;
        asked.push(title);
        return new Response(`<a href="https://subs.ro/subtitrare/film/${title.replace("tt", "")}">a</a>`);
      }
      const archive = /\/descarca\/film\/(\d+)$/.exec(url);
      if (archive) return new Response(new Uint8Array(zipOf("a.srt", srt(`Film ${archive[1]}`))));
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    const manager = new RomanianSubtitleManager(undefined, fetch);
    const id = (track: { url: string }) => track.url.replace("/api/subtitles/ro/", "").replace(".vtt", "");
    const [oldest] = await manager.getSubtitles({ imdbId: "tt1000" });
    const [second] = await manager.getSubtitles({ imdbId: "tt1001" });
    await manager.getSubtitles({ imdbId: "tt1000" }); // (asked about again: now the second is the one asked about longest ago)
    for (let n = 2; n <= MAX_KEPT_TITLES; n++) await manager.getSubtitles({ imdbId: `tt${1000 + n}` });
    expect(manager.getVtt(id(second!))).toBeUndefined();
    expect(manager.getVtt(id(oldest!))).toContain("Film 1000");
    expect(asked.filter((title) => title === "tt1001")).toHaveLength(1);
    await manager.getSubtitles({ imdbId: "tt1001" });
    expect(asked.filter((title) => title === "tt1001")).toHaveLength(2);
    expect(manager.getVtt(id(second!))).toContain("Film 1001");
  });
});

describe("siteFetch", () => {
  const publicOnly = (address: string) => address === "203.0.113.7" || address === "203.0.113.8";
  const sites = (answers: Record<string, () => Response>) => {
    const asked: Array<{ url: string; method: string; cookie: string | null }> = [];
    const send = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(input), method: init?.method ?? "GET", cookie: new Headers(init?.headers).get("cookie") });
      expect(init?.redirect).toBe("manual");
      return answers[String(input)]?.() ?? new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    return { asked, send };
  };
  const to = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });

  it("follows a redirect to a public address, without the cookie when it leads to another origin", async () => {
    const { asked, send } = sites({ "https://203.0.113.7/a": to("https://203.0.113.8/b"), "https://203.0.113.8/b": () => new Response("here") });
    const res = await siteFetch(send, publicOnly)("https://203.0.113.7/a", { method: "POST", body: "x=1", headers: { cookie: "s=1", "content-type": "application/x-www-form-urlencoded" } });
    expect(await res.text()).toBe("here");
    expect(asked).toEqual([
      { url: "https://203.0.113.7/a", method: "POST", cookie: "s=1" },
      { url: "https://203.0.113.8/b", method: "GET", cookie: null },
    ]);
  });

  it("does not follow a redirect to this machine or the network it stands in, by address or by name", async () => {
    for (const inside of ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1:8787/api/health", "http://localhost:8787/api/health", "http://[::1]/", "file:///etc/passwd"]) {
      const { asked, send } = sites({ "https://203.0.113.7/a": to(inside) });
      await expect(siteFetch(send, (address) => publicOnly(address))("https://203.0.113.7/a"), inside).rejects.toThrow();
      expect(asked.map((ask) => ask.url), inside).toEqual(["https://203.0.113.7/a"]);
    }
  });

  it("really fetches: what is posted to one server and sent on to another arrives there as a GET without the cookie, and the answer is the last one's", async () => {
    // (Two servers of this machine, so with every address allowed: the rest of these tests never leave the function.)
    const seen: string[] = [];
    const second = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} cookie=${req.headers.cookie ?? "-"} type=${req.headers["content-type"] ?? "-"}`);
      res.writeHead(200, { "content-type": "text/plain" }).end("the archive");
    });
    const first = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} cookie=${req.headers.cookie ?? "-"}`);
      if (req.url === "/page") return void res.writeHead(200, { "set-cookie": "s=1; Path=/" }).end("a page");
      req.resume();
      res.writeHead(302, { location: `http://127.0.0.1:${(second.address() as AddressInfo).port}/file` }).end();
    });
    await Promise.all([new Promise<void>((done) => first.listen(0, "127.0.0.1", done)), new Promise<void>((done) => second.listen(0, "127.0.0.1", done))]);
    try {
      const at = `http://127.0.0.1:${(first.address() as AddressInfo).port}`;
      const get = siteFetch(undefined, () => true);
      const page = await get(`${at}/page`);
      expect(page.headers.get("set-cookie")).toContain("s=1"); // (the cookie a site sets is still there to be sent back)
      expect(await page.text()).toBe("a page");
      const res = await get(`${at}/search`, { method: "POST", body: "x=1", headers: { cookie: "s=1", "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(5_000) });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("the archive");
      expect(seen).toEqual(["GET /page cookie=-", "POST /search cookie=s=1", "GET /file cookie=- type=-"]);
      // (And with the usual rule, this machine is not asked at all.)
      await expect(siteFetch()(`${at}/page`)).rejects.toThrow("address not allowed");
      expect(seen).toHaveLength(3);
    } finally {
      first.close();
      second.close();
    }
  });

  it("does not ask an address that is not public in the first place, and gives up on redirects that go round", async () => {
    const { asked, send } = sites({ "https://203.0.113.7/a": to("https://203.0.113.7/a") });
    await expect(siteFetch(send)("http://10.0.0.5/a")).rejects.toThrow("address not allowed");
    await expect(siteFetch(send)("http://169.254.169.254/latest")).rejects.toThrow("address not allowed");
    expect(asked).toEqual([]);
    await expect(siteFetch(send, publicOnly)("https://203.0.113.7/a")).rejects.toThrow("too many redirects");
    expect(asked).toHaveLength(6);
  });
});
