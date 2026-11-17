import { describe, expect, it } from "vitest";
import {
  deobfuscateZokoBlob,
  extractZokoStream,
  getHiAnimeEpisodes,
  getHiAnimeServers,
  normalizeAnimeTitle,
  resolveHiAnimeEpisodeStream,
  searchHiAnime,
} from "./hianime";

function makeZokoBlob(json: object): string {
  const jsonStr = JSON.stringify(json);
  const buf = Buffer.from(jsonStr, "utf8");
  const keyBuf = Buffer.from("otaku-embed-v1", "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ keyBuf[i % keyBuf.length]!;
  }
  return out.toString("base64");
}

describe("hianime library", () => {
  it("deobfuscates ZokoAnime blob using otaku-embed-v1 key", () => {
    const original = { src: "https://hls.test/master.m3u8", subtitles: [{ lang: "en", label: "English", src: "https://hls.test/subs.vtt" }] };
    const blob = makeZokoBlob(original);
    const decoded = JSON.parse(deobfuscateZokoBlob(blob));
    expect(decoded).toEqual(original);
  });

  it("normalizes anime titles by stripping diacritics and punctuation", () => {
    expect(normalizeAnimeTitle("Pokémon: Ultimate Journeys")).toBe("pokemon ultimate journeys");
    expect(normalizeAnimeTitle("Sousou no Frieren (TV)")).toBe("sousou no frieren tv");
  });

  it("parses search results from HiAnime HTML", async () => {
    const fakeHtml = `
      <div class="film-detail">
        <h3 class="film-name"><a href="/pokemon-journeys-the-series-1879" title="Pokemon Journeys: The Series">Pokemon Journeys</a></h3>
      </div>
      <div class="film-detail">
        <h3 class="film-name"><a href="/pokemon-7102" title="Pokémon">Pokémon</a></h3>
      </div>
    `;

    const fakeFetch = (async () => ({
      ok: true,
      text: async () => fakeHtml,
    })) as unknown as typeof fetch;

    const results = await searchHiAnime("pokemon", fakeFetch);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "1879",
      title: "Pokemon Journeys: The Series",
      href: "https://hianime.at/pokemon-journeys-the-series-1879",
    });
    expect(results[1]).toEqual({
      id: "7102",
      title: "Pokémon",
      href: "https://hianime.at/pokemon-7102",
    });
  });

  it("parses episode list from HiAnime API response", async () => {
    const fakeApiResponse = {
      status: true,
      html: `
        <div class="ss-list">
          <a class="item ep-item" data-id="30871" data-number="1" title="Episode 1"><div class="ssli-order">1</div></a>
          <a class="item ep-item" data-id="30872" data-number="2" title="Episode 2"><div class="ssli-order">2</div></a>
          <a class="item ep-item" data-id="30873" data-number="3" title="Episode 3"><div class="ssli-order">3</div></a>
        </div>
      `,
    };

    const fakeFetch = (async () => ({
      ok: true,
      json: async () => fakeApiResponse,
    })) as unknown as typeof fetch;

    const episodes = await getHiAnimeEpisodes("1879", fakeFetch);
    expect(episodes).toHaveLength(3);
    expect(episodes[0]).toEqual({ num: 1, id: "30871", title: "Episode 1" });
    expect(episodes[2]).toEqual({ num: 3, id: "30873", title: "Episode 3" });
  });

  it("parses servers and decodes base64 hashes", async () => {
    const subEmbed = "https://zokoanime.video/stream/mal/40351/3/sub";
    const dubEmbed = "https://zokoanime.video/stream/mal/40351/3/dub";
    const fakeApiResponse = {
      status: true,
      html: `
        <div class="servers-sub">
          <div class="item server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>
        </div>
        <div class="servers-dub">
          <div class="item server-item" data-type="dub" data-server-name="ZokoAnime" data-hash="${Buffer.from(dubEmbed).toString("base64")}"></div>
        </div>
      `,
    };

    const fakeFetch = (async () => ({
      ok: true,
      json: async () => fakeApiResponse,
    })) as unknown as typeof fetch;

    const servers = await getHiAnimeServers("30873", fakeFetch);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ type: "sub", serverName: "ZokoAnime", embedUrl: subEmbed });
    expect(servers[1]).toEqual({ type: "dub", serverName: "ZokoAnime", embedUrl: dubEmbed });
  });

  it("extracts stream and subtitles from Zoko embed HTML", async () => {
    const streamPayload = {
      src: "https://hls.test/p/master.m3u8",
      subtitles: [
        { lang: "en", label: "English", default: true, src: "https://hls.test/subs/en.vtt" },
      ],
      skip: {
        intro: { start: 90, end: 180 },
        outro: { start: 1300, end: 1380 },
      },
    };
    const blob = makeZokoBlob(streamPayload);
    const fakeHtml = `<html><script>window.__P="${blob}";</script></html>`;

    const fakeFetch = (async () => ({
      ok: true,
      text: async () => fakeHtml,
    })) as unknown as typeof fetch;

    const stream = await extractZokoStream("https://zokoanime.video/stream/mal/40351/3/sub", fakeFetch);
    expect(stream).not.toBeNull();
    expect(stream?.src).toBe("https://hls.test/p/master.m3u8");
    expect(stream?.subtitles).toEqual([
      { lang: "en", label: "English", src: "https://hls.test/subs/en.vtt", default: true },
    ]);
    expect(stream?.skip?.intro).toEqual({ start: 90, end: 180 });
  });

  it("resolves full episode stream with alternate dub", async () => {
    const subEmbed = "https://zokoanime.video/stream/mal/40351/3/sub";
    const dubEmbed = "https://zokoanime.video/stream/mal/40351/3/dub";

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/api/theme/episode/list/")) {
        return {
          ok: true,
          json: async () => ({
            html: '<a class="ep-item" data-id="30873" data-number="3" title="Episode 3"></a>',
          }),
        };
      }
      if (u.includes("/api/theme/episode/servers")) {
        return {
          ok: true,
          json: async () => ({
            html: `
              <div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(subEmbed).toString("base64")}"></div>
              <div class="server-item" data-type="dub" data-server-name="ZokoAnime" data-hash="${Buffer.from(dubEmbed).toString("base64")}"></div>
            `,
          }),
        };
      }
      if (u === subEmbed) {
        const blob = makeZokoBlob({ src: "https://hls.test/sub/master.m3u8", subtitles: [{ lang: "en", src: "https://hls.test/sub.vtt" }] });
        return { ok: true, text: async () => `window.__P="${blob}"` };
      }
      if (u === dubEmbed) {
        const blob = makeZokoBlob({ src: "https://hls.test/dub/master.m3u8", subtitles: [] });
        return { ok: true, text: async () => `window.__P="${blob}"` };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const result = await resolveHiAnimeEpisodeStream("1879", 3, { mode: "sub", fetcher: fakeFetch });
    expect(result).not.toBeNull();
    expect(result?.stream.src).toBe("https://hls.test/sub/master.m3u8");
    expect(result?.altDubStream?.stream.src).toBe("https://hls.test/dub/master.m3u8");
  });

  it("falls through to ZokoAnime sub when wanted dub only has a non-Zoko server that fails extraction", async () => {
    const megaDub = "https://megaplay.example/embed/9901/dub";
    const zokoSub = "https://zokoanime.video/stream/mal/9901/1/sub";
    const asked: string[] = [];

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      asked.push(u);
      if (u.includes("/api/theme/episode/list/9901")) {
        return {
          ok: true,
          json: async () => ({
            html: '<a class="ep-item" data-id="99011" data-number="1" title="Episode 1"></a>',
          }),
        };
      }
      if (u.includes("/api/theme/episode/servers?episodeId=99011")) {
        return {
          ok: true,
          json: async () => ({
            html: `
              <div class="server-item" data-type="dub" data-server-name="MegaPlay" data-hash="${Buffer.from(megaDub).toString("base64")}"></div>
              <div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(zokoSub).toString("base64")}"></div>
            `,
          }),
        };
      }
      if (u === megaDub) {
        return { ok: true, text: async () => "<html><body>no zoko blob here</body></html>" };
      }
      if (u === zokoSub) {
        const blob = makeZokoBlob({ src: "https://hls.test/9901/sub.m3u8", subtitles: [{ lang: "en", src: "https://hls.test/9901/en.vtt" }] });
        return { ok: true, text: async () => `window.__P="${blob}"` };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const result = await resolveHiAnimeEpisodeStream("9901", 1, { mode: "dub", fetcher: fakeFetch });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("sub");
    expect(result?.stream.src).toBe("https://hls.test/9901/sub.m3u8");
    // MegaPlay was tried once and not retried when looking for an alternate
    expect(asked.filter((u) => u === megaDub)).toHaveLength(1);
  });

  it("moves on to the next server when the first ZokoAnime server fails or throws", async () => {
    const brokenZoko = "https://zokoanime.video/stream/mal/9902/1/sub?broken";
    const workingMirror = "https://zokoanime.video/stream/mal/9902/1/sub?ok";
    const brokenAlt = "https://megaplay.example/embed/9902/dub";
    const workingAlt = "https://zokoanime.video/stream/mal/9902/1/dub";

    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/api/theme/episode/list/9902")) {
        return {
          ok: true,
          json: async () => ({
            html: '<a class="ep-item" data-id="99021" data-number="1" title="Episode 1"></a>',
          }),
        };
      }
      if (u.includes("/api/theme/episode/servers?episodeId=99021")) {
        return {
          ok: true,
          json: async () => ({
            html: `
              <div class="server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="${Buffer.from(brokenZoko).toString("base64")}"></div>
              <div class="server-item" data-type="sub" data-server-name="HD-2" data-hash="${Buffer.from(workingMirror).toString("base64")}"></div>
              <div class="server-item" data-type="dub" data-server-name="MegaPlay" data-hash="${Buffer.from(brokenAlt).toString("base64")}"></div>
              <div class="server-item" data-type="dub" data-server-name="ZokoAnime" data-hash="${Buffer.from(workingAlt).toString("base64")}"></div>
            `,
          }),
        };
      }
      if (u === brokenZoko) throw new Error("upstream reset");
      if (u === brokenAlt) return { ok: false, status: 500 };
      if (u === workingMirror) {
        const blob = makeZokoBlob({ src: "https://hls.test/9902/sub.m3u8", subtitles: [] });
        return { ok: true, text: async () => `window.__P="${blob}"` };
      }
      if (u === workingAlt) {
        const blob = makeZokoBlob({ src: "https://hls.test/9902/dub.m3u8", subtitles: [] });
        return { ok: true, text: async () => `window.__P="${blob}"` };
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    const result = await resolveHiAnimeEpisodeStream("9902", 1, { mode: "sub", fetcher: fakeFetch });
    expect(result).not.toBeNull();
    expect(result?.stream.src).toBe("https://hls.test/9902/sub.m3u8");
    expect(result?.alternate?.type).toBe("dub");
    expect(result?.alternate?.stream.src).toBe("https://hls.test/9902/dub.m3u8");
  });
});
