import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  FallbackSubtitleManager,
  normalizeSearchTitle,
  normalizeTvSubtitlesLang,
  srtToVtt,
} from "./fallbackSubtitles";

function makeZip(files: Array<{ name: string; content: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const rawData = Buffer.from(f.content, "utf8");
    const compData = zlib.deflateRawSync(rawData);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(compData.length, 18);
    header.writeUInt32LE(rawData.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    parts.push(header, nameBuf, compData);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  parts.push(eocd);
  return Buffer.concat(parts);
}

describe("fallbackSubtitles", () => {
  it("converts srt timestamps to webvtt", () => {
    const srt = "1\n00:01:23,456 --> 00:01:25,789\nHello!";
    const vtt = srtToVtt(srt);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:01:23.456 --> 00:01:25.789");
  });

  it("normalizes search titles", () => {
    expect(normalizeSearchTitle("Sakamoto Days (Season 1)")).toBe("sakamoto days");
    expect(normalizeSearchTitle("Breaking Bad: Season 2")).toBe("breaking bad");
  });

  it("normalizes tvsubtitles language codes", () => {
    expect(normalizeTvSubtitlesLang("br")).toBe("pt");
    expect(normalizeTvSubtitlesLang("ua")).toBe("uk");
    expect(normalizeTvSubtitlesLang("en")).toBe("en");
  });

  it("searches, downloads zip, unzips season, and caches all episodes", async () => {
    const fakeZip = makeZip([
      {
        name: "Sakamoto Days - 1x01 - The Legendary Hit Man.WEB.NF.en.srt",
        content: "1\n00:00:01,000 --> 00:00:03,000\nEpisode 1",
      },
      {
        name: "Sakamoto Days - 1x02 - Vs Son Hee.WEB.NF.en.srt",
        content: "1\n00:00:01,000 --> 00:00:03,000\nEpisode 2",
      },
    ]);

    let networkCalls = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      networkCalls++;
      const url = String(input);

      if (url.includes("search2.php")) {
        return new Response('<a href="/tvshow-3593.html">Sakamoto Days (2025-2026)</a>', { status: 200 });
      }
      if (url.includes("tvshow-3593-1.html")) {
        return new Response('<a href="subtitle-3593-1-en.html">', { status: 200 });
      }
      if (url.includes("subtitle-3593-1-en.html")) {
        return new Response('<b>filename:</b></td><td>Sakamoto_Days - season 1.en.zip</td>', { status: 200 });
      }
      if (url.includes("Sakamoto_Days%20-%20season%201.en.zip")) {
        return new Response(new Uint8Array(fakeZip), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const manager = new FallbackSubtitleManager(undefined, fakeFetch);

    const ep1Subs = await manager.getSubtitles({ title: "Sakamoto Days", season: 1, episode: 1 });
    expect(ep1Subs).toHaveLength(1);
    expect(ep1Subs[0]!.url).toMatch(/^\/api\/subtitles\/fallback\/tvs_3593_s1e1_/);
    expect(ep1Subs[0]!.label).toContain("TVSubtitles");

    const subId = ep1Subs[0]!.url.replace("/api/subtitles/fallback/", "").replace(".vtt", "");
    const vtt = manager.getVtt(subId);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("Episode 1");

    const callsAfterFirst = networkCalls;
    expect(callsAfterFirst).toBe(4);

    const ep2Subs = await manager.getSubtitles({ title: "Sakamoto Days", season: 1, episode: 2 });
    expect(ep2Subs).toHaveLength(1);
    expect(ep2Subs[0]!.url).toMatch(/^\/api\/subtitles\/fallback\/tvs_3593_s1e2_/);
    expect(networkCalls).toBe(callsAfterFirst);

    const subId2 = ep2Subs[0]!.url.replace("/api/subtitles/fallback/", "").replace(".vtt", "");
    const vtt2 = manager.getVtt(subId2);
    expect(vtt2).toContain("Episode 2");
  });
  function siteWith(files: Array<{ name: string; content: string }>) {
    const zip = makeZip(files);
    const asked: string[] = [];
    const get: typeof fetch = async (input) => {
      const url = String(input);
      asked.push(url);
      if (url.includes("search2.php")) return new Response('<a href="/tvshow-7.html">Some Show</a>', { status: 200 });
      if (url.includes("tvshow-7-")) return new Response('<a href="subtitle-7-1-en.html">', { status: 200 });
      if (url.includes("subtitle-7-1-en.html")) return new Response("<b>filename:</b></td><td>Some_Show - season 1.en.zip</td>", { status: 200 });
      if (url.includes(".zip")) return new Response(new Uint8Array(zip), { status: 200 });
      return new Response("Not Found", { status: 404 });
    };
    return { get, asked };
  }
  const line = (text: string) => `1\n00:00:01,000 --> 00:00:03,000\n${text}`;

  it("asks nothing for a film: only an episode of a series has a season pack", async () => {
    const { get, asked } = siteWith([{ name: "Some Show - 1x01.srt", content: line("one") }]);
    const manager = new FallbackSubtitleManager(undefined, get);
    expect(await manager.getSubtitles({ title: "Some Show" })).toEqual([]);
    expect(await manager.getSubtitles({ title: "Some Show", season: 1 })).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("gives an episode only its own files: not another season's, not a pack's unnumbered ones", async () => {
    const { get } = siteWith([
      { name: "Some Show - 1x01.srt", content: line("one") },
      { name: "Some Show - 2x01.srt", content: line("other season") },
      { name: "extras.srt", content: line("unnumbered") },
      { name: "commentary.srt", content: line("unnumbered too") },
    ]);
    const manager = new FallbackSubtitleManager(undefined, get);
    const tracks = await manager.getSubtitles({ title: "Some Show", season: 1, episode: 1 });
    expect(tracks).toHaveLength(1);
    expect(manager.getVtt(tracks[0]!.url.replace("/api/subtitles/fallback/", "").replace(".vtt", ""))).toContain("one");
    expect(await manager.getSubtitles({ title: "Some Show", season: 1, episode: 2 })).toEqual([]);
  });

  it("does not ask again about a season the site had nothing for", async () => {
    const asked: string[] = [];
    const get: typeof fetch = async (input) => {
      asked.push(String(input));
      return new Response("no shows here", { status: 200 });
    };
    const manager = new FallbackSubtitleManager(undefined, get);
    expect(await manager.getSubtitles({ title: "Nowhere", season: 1, episode: 1 })).toEqual([]);
    expect(await manager.getSubtitles({ title: "Nowhere", season: 1, episode: 2 })).toEqual([]);
    expect(asked).toHaveLength(1);
  });
});
