import { describe, expect, it } from "vitest";
import { fitMedia, NormalizedMediaSchema, preferredSourceIndex, sourceMenus, sourcesOf, type NormalizedMedia } from "./media";

/*
 * Where a film comes from and how sharp it is are two questions, with a picker each. A source that hands over the same stream in several qualities
 * marks them (`quality`), and those are listed under Quality: under Source the main stream stands for them all.
 */
const stream = (name: string) => ({ url: `https://films.example/${name}.mp4`, type: "mp4" as const });

describe("a film's sources and its qualities", () => {
  const film: NormalizedMedia = {
    title: "Two Questions",
    stream: { url: "https://films.example/auto.m3u8", type: "hls" },
    quality: "Auto (HLS)",
    alternates: [
      { label: "1080p", quality: "1080p", stream: stream("1080") },
      { label: "720p", quality: "720p", stream: stream("720") },
      { label: "Mirror", stream: stream("mirror") },
    ],
  };

  it("lists the qualities of the main stream apart from the other places to get the film from", () => {
    const all = sourcesOf(film);
    expect(all.map((source) => source.quality)).toEqual(["Auto (HLS)", "1080p", "720p", undefined]);
    expect(sourceMenus(all)).toEqual({ sources: [0, 3], qualities: [0, 1, 2] });
  });

  it("leaves a film whose alternates are other sources as it was", () => {
    const all = sourcesOf({ stream: stream("a"), alternates: [{ label: "Mirror", stream: stream("b") }, { stream: stream("c") }] });
    expect(sourceMenus(all)).toEqual({ sources: [0, 1, 2], qualities: [] });
  });

  it("does not make a quality picker out of one marked stream, or out of marks the main stream does not share", () => {
    expect(sourceMenus(sourcesOf({ stream: stream("a"), quality: "1080p", alternates: [{ label: "Mirror", stream: stream("b") }] }))).toEqual({ sources: [0, 1], qualities: [] });
    // (Marked alternates beside an unmarked main stream: nothing says they are the same stream, so they stay sources.)
    const all = sourcesOf({ stream: stream("a"), alternates: [{ quality: "720p", stream: stream("b") }, { quality: "480p", stream: stream("c") }] });
    expect(sourceMenus(all)).toEqual({ sources: [0, 1, 2], qualities: [] });
  });

  it("keeps the marks when a film is trimmed to fit, and the trimmed film is still one the screen accepts", () => {
    const { media: fitted, unfit } = fitMedia({ ...film, title: "long ".repeat(100) });
    expect(unfit).toEqual(["title"]); // (so it was trimmed, not passed through)
    expect(NormalizedMediaSchema.safeParse(fitted).success).toBe(true);
    expect(fitted?.quality).toBe("Auto (HLS)");
    expect(fitted?.alternates?.map((alternate) => alternate.quality)).toEqual(["1080p", "720p", undefined]);
  });
});

describe("preferredSourceIndex (anime audio preferred language)", () => {
  const animeMedia: NormalizedMedia = {
    title: "Anime Episode",
    sourceLabel: "Japanese (Sub)",
    stream: { url: "https://films.example/sub.m3u8", type: "hls" },
    alternates: [
      { label: "English Dub", stream: { url: "https://films.example/dub.m3u8", type: "hls" } },
    ],
  };

  it("picks English Dub source index when preferred anime audio is eng", () => {
    expect(preferredSourceIndex(animeMedia, "eng")).toBe(1);
  });

  it("picks Japanese (Sub) source index when preferred anime audio is jp or unset", () => {
    expect(preferredSourceIndex(animeMedia, "jp")).toBe(0);
    expect(preferredSourceIndex(animeMedia, undefined)).toBe(0);
  });

  it("has no say over a title without an anime's audios: one source, a film's Romanian dub, a source whose name says sub", () => {
    const singleSourceMedia: NormalizedMedia = {
      title: "Solo",
      stream: { url: "https://films.example/video.mp4", type: "mp4" },
    };
    expect(preferredSourceIndex(singleSourceMedia, "eng")).toBeUndefined();
    expect(preferredSourceIndex(singleSourceMedia, "jp")).toBeUndefined();
    const dubbed: NormalizedMedia = {
      stream: { url: "https://films.example/a.m3u8", type: "hls" },
      alternates: [
        { label: "Română (Dublat)", stream: { url: "https://dub.example/a.m3u8", type: "hls" } },
        { label: "Subtitled source", stream: { url: "https://other.example/a.m3u8", type: "hls" } },
      ],
    };
    expect(preferredSourceIndex(dubbed, "eng")).toBeUndefined();
    expect(preferredSourceIndex(dubbed, "jp")).toBeUndefined();
    expect(preferredSourceIndex(dubbed, undefined)).toBeUndefined();
  });

  it("finds the dub of the HiAnime server's label too, and leaves an anime without the audio asked for alone", () => {
    const server: NormalizedMedia = {
      stream: { url: "https://films.example/sub.m3u8", type: "hls" },
      alternates: [{ label: "Server 2 (English Dub)", stream: { url: "https://films.example/dub.m3u8", type: "hls" } }],
    };
    expect(preferredSourceIndex(server, "eng")).toBe(1);
    // (The main one is not labelled: it is the anime's own audio, the one that is not the dub - Japanese chosen while the dub plays goes back to it.)
    expect(preferredSourceIndex(server, "jp")).toBe(0);
    expect(preferredSourceIndex(server, undefined)).toBe(0);
    const dubFirst: NormalizedMedia = {
      sourceLabel: "English Dub",
      stream: { url: "https://films.example/dub.m3u8", type: "hls" },
      alternates: [{ label: "Server 2", stream: { url: "https://films.example/sub.m3u8", type: "hls" } }],
    };
    expect([preferredSourceIndex(dubFirst, "jp"), preferredSourceIndex(dubFirst, "eng")]).toEqual([1, 0]);
    const onlyDub: NormalizedMedia = { stream: { url: "https://films.example/dub.m3u8", type: "hls" }, alternates: [{ label: "English Dub", stream: { url: "https://films.example/dub2.m3u8", type: "hls" } }] };
    expect(preferredSourceIndex(onlyDub, "jp")).toBe(0);
  });
});
