import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { RomanianSubtitleManager } from "./romanian";

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
});
