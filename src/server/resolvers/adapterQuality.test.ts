import { describe, expect, it } from "vitest";
import { sourceMenus, sourcesOf } from "../../shared";
import { romanianDubsOn } from "../dubs/romanian";
import { createFilmpireAdapter } from "./adapters/filmpire";

/*
 * One film in three qualities is one source with three qualities, not three sources. The adapter says so by marking the main stream and each of the
 * others with its quality; the screen then lists them under Quality and keeps Source for the places a film can come from (shared/media.ts, `sourceMenus`).
 */
describe("a film that comes in several qualities", () => {
  const answers = (qualities: Record<string, { url: string; type: string }>) =>
    (async (url: string | URL) => {
      const address = String(url);
      if (address.includes("api.themoviedb.org")) return { ok: true, status: 200, json: async () => ({ id: 99999, title: "Drawn Film", genres: [{ id: 16 }] }) };
      if (address.includes("vidlink.pro/api/b/movie/")) return { ok: true, status: 200, json: async () => ({ stream: { type: "file", qualities } }) };
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;
  const file = (name: string) => ({ url: `https://films.example/${name}.mp4`, type: "mp4" });

  it("is marked with the quality of each of its files, the best first", async () => {
    const adapter = createFilmpireAdapter({ fetch: answers({ "720": file("720"), "1080": file("1080"), "480": file("480") }) });
    const found = await adapter.resolve(new URL("https://filmpire.sc/watch/99999"));
    expect(found.status).toBe("success");
    if (found.status !== "success") return;
    expect(found.media.quality).toBe("1080p");
    expect(found.media.stream.directUrl).toBe("https://films.example/1080.mp4");
    expect(found.media.alternates?.map((alternate) => alternate.quality)).toEqual(["720p", "480p"]);
    // What the screen makes of it: one place to get it from, three qualities.
    expect(sourceMenus(sourcesOf(found.media))).toEqual({ sources: [0], qualities: [0, 1, 2] });
  });

  it("is not marked when it comes in one quality only: there is nothing to pick", async () => {
    const adapter = createFilmpireAdapter({ fetch: answers({ "720": file("720") }) });
    const found = await adapter.resolve(new URL("https://filmpire.sc/watch/99999"));
    expect(found.status).toBe("success");
    if (found.status !== "success") return;
    expect(found.media.quality).toBeUndefined();
    expect(sourceMenus(sourcesOf(found.media)).qualities).toEqual([]);
  });
});

describe("Romanian dubs", () => {
  it("are offered, badge and source alike, only while RO_DUB_SOURCES is on", () => {
    const before = process.env.RO_DUB_SOURCES;
    try {
      delete process.env.RO_DUB_SOURCES;
      expect(romanianDubsOn()).toBe(false);
      process.env.RO_DUB_SOURCES = "on";
      expect(romanianDubsOn()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.RO_DUB_SOURCES;
      else process.env.RO_DUB_SOURCES = before;
    }
  });
});
