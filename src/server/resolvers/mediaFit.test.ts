import { describe, expect, it } from "vitest";
import { MAX_ALTERNATES, NormalizedMediaSchema, fitMedia, parseServerMessage, type NormalizedMedia } from "../../shared";
import { ResolverRegistry } from "./registry";
import type { Resolver } from "./types";

/*
 * A screen checks every message it is sent and lets go of one that does not fit, without a word. A look-up that "found" a film with one alternate too
 * many, or a label a few letters too long, was therefore a film that would not start, and nothing anywhere said why. What is found is made to fit before
 * it is handed on, and the log says which fields did not.
 */

const stream = (n: number) => ({ url: `https://cdn.example/${n}.m3u8`, type: "hls" as const });
const asLoad = (media: NormalizedMedia) => JSON.stringify({ type: "TV_CMD", command: { type: "LOAD", media } });

/** What a look-up can find that a screen does not take: each of these alone was enough for the film not to start. */
const tooMuch = (): NormalizedMedia =>
  ({
    title: "A Film",
    stream: { ...stream(0), directUrl: `https://cdn.example/direct?${"x".repeat(3000)}` },
    subtitles: [
      { id: 0, label: "English", lang: "en", url: "/api/proxy?url=a" },
      { id: 1, label: `Romanian · ${"A.Very.Long.Release.Name.".repeat(8)}`, lang: "ro", url: "/api/proxy?url=b" },
      { id: 2, label: "Past the limit", url: `/api/proxy?url=${"y".repeat(3000)}` },
      { id: 3, label: "Odd language", lang: "a-language-code-that-is-far-too-long", url: "/api/proxy?url=c" },
    ],
    alternates: [
      ...Array.from({ length: 11 }, (_, n) => ({ label: `Server ${n + 2}`, stream: stream(n + 1) })),
      { label: "A server whose name is much longer than the sixty letters a picker has room for, by a good deal", stream: stream(20) },
    ],
    poster: "not an address",
    year: 20_260,
  }) as NormalizedMedia;

describe("fitMedia", () => {
  it("leaves alone what fits", () => {
    const media: NormalizedMedia = { title: "A Film", stream: stream(0), alternates: [{ stream: stream(1) }] };
    expect(fitMedia(media)).toEqual({ media, unfit: [] });
  });

  it("cuts what is too long, cuts off what is too many and leaves out what cannot fit: the film plays without it", () => {
    const found = tooMuch();
    // (As it was: the screen let the whole message go.)
    expect(NormalizedMediaSchema.safeParse(found).success).toBe(false);
    expect(parseServerMessage(asLoad(found))).toBeNull();

    const { media, unfit } = fitMedia(found);
    expect(media).not.toBeNull();
    expect(parseServerMessage(asLoad(media!))).not.toBeNull();
    expect(media!.stream).toEqual(stream(0)); // (without the address that was too long to be asked directly)
    expect(media!.subtitles?.map((track) => [track.id, track.label.length <= 100, track.lang])).toEqual([
      [0, true, "en"],
      [1, true, "ro"],
      [3, true, undefined],
    ]);
    expect(media!.alternates).toHaveLength(MAX_ALTERNATES);
    expect(media!.alternates?.[0]?.label).toBe("Server 2");
    expect(media!.poster).toBeUndefined();
    expect(media!.year).toBeUndefined();
    // (Which fields, never what was in them.)
    expect(unfit).toEqual(expect.arrayContaining(["stream.directUrl", "subtitles.1.label", "subtitles.2.url", "subtitles.3.lang", "alternates", "poster", "year"]));
    expect(JSON.stringify(unfit)).not.toContain("cdn.example");
  });

  it("gives nothing when the video's own address does not fit: there is nothing to play", () => {
    expect(fitMedia({ stream: { url: `https://cdn.example/${"z".repeat(3000)}`, type: "hls" } }).media).toBeNull();
    expect(fitMedia({ stream: { url: "javascript:alert(1)", type: "hls" } } as NormalizedMedia).media).toBeNull();
  });

  it("keeps a series and its episodes, without the episodes that do not fit", () => {
    const episodes = Array.from({ length: 450 }, (_, n) => ({ season: 1, episode: n + 1, url: `https://site.example/watch/1?s=1&e=${n + 1}`, title: n === 0 ? "t".repeat(400) : `Episode ${n + 1}` }));
    const { media } = fitMedia({ stream: stream(0), series: { season: 1, episode: 1, episodes } });
    expect(media?.series?.episodes).toHaveLength(400);
    expect(media?.series?.episodes?.[0]?.title).toHaveLength(300);
    expect(media?.series).toMatchObject({ season: 1, episode: 1 });
  });
});

describe("a look-up that found more than a screen takes", () => {
  const lines: Array<Record<string, unknown>> = [];
  const log = { info: (object: Record<string, unknown>, message: string) => void lines.push({ ...object, msg: message }) };
  const finding = (media: NormalizedMedia): Resolver => ({ id: "test", resolve: async () => ({ status: "success", media, resolver: "test" }) });

  it("hands on a film that starts, and the log says which fields did not fit", async () => {
    lines.length = 0;
    const result = await new ResolverRegistry([], finding(tooMuch()), log).resolve("https://site.example/movie/1");
    if (result.status !== "success") throw new Error(result.status);
    expect(parseServerMessage(asLoad(result.media))).not.toBeNull();
    expect(result.media.alternates).toHaveLength(MAX_ALTERNATES);
    expect(result.media.page).toBe("https://site.example/movie/1");
    const said = lines.find((line) => line.msg === "media-unfit");
    expect(said).toMatchObject({ domain: "site.example", resolver: "test", plays: true });
    expect(said?.fields).toEqual(expect.arrayContaining(["alternates", "stream.directUrl"]));
    expect(JSON.stringify(lines)).not.toContain("cdn.example");
    expect(lines.find((line) => line.msg === "resolve")).toMatchObject({ success: true });
  });

  it("says so when there is nothing left to play, and does not call that a film", async () => {
    lines.length = 0;
    const result = await new ResolverRegistry([], finding({ stream: { url: `https://cdn.example/${"z".repeat(3000)}`, type: "hls" } }), log).resolve("https://site.example/movie/2");
    expect(result.status).toBe("unsupported");
    expect(lines.find((line) => line.msg === "media-unfit")).toMatchObject({ plays: false });
    expect(lines.find((line) => line.msg === "resolve")).toMatchObject({ success: false, reason: "UNSUPPORTED" });
  });

  it("says nothing about a film that fits", async () => {
    lines.length = 0;
    const result = await new ResolverRegistry([], finding({ title: "A Film", stream: stream(0) }), log).resolve("https://site.example/movie/3");
    expect(result.status).toBe("success");
    expect(lines.some((line) => line.msg === "media-unfit")).toBe(false);
  });
});
