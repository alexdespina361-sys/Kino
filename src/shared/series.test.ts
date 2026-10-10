import { describe, expect, it } from "vitest";
import { normalizeLang } from "./lang";
import {
  completeSeries,
  episodeLabel,
  episodeName,
  groupBySeason,
  NormalizedMediaSchema,
  previousEpisode,
  seriesKeyOf,
  sortEpisodes,
  sourcesOf,
  stateIsFor,
  type EpisodeRef,
  type NormalizedMedia,
} from "./media";

const ep = (season: number, episode: number, title?: string): EpisodeRef => ({
  season,
  episode,
  ...(title ? { title } : {}),
  url: `https://site.example/watch/1?s=${season}&e=${episode}`,
});

const media = (season: number, episode: number, extra: Partial<NormalizedMedia["series"] & object> = {}): NormalizedMedia => ({
  title: "Show",
  stream: { url: "https://cdn.example/x.m3u8", type: "hls" },
  series: { season, episode, ...extra },
});

describe("episode lists", () => {
  it("sorts by season, then episode, whatever order the source used", () => {
    const sorted = sortEpisodes([ep(2, 1), ep(1, 3), ep(1, 1), ep(2, 2), ep(1, 2)]);
    expect(sorted.map((e) => `${e.season}.${e.episode}`)).toEqual(["1.1", "1.2", "1.3", "2.1", "2.2"]);
  });

  it("groups by season in order", () => {
    const groups = groupBySeason([ep(2, 1), ep(1, 2), ep(1, 1)]);
    expect(groups.map((g) => [g.season, g.episodes.length])).toEqual([[1, 2], [2, 1]]);
  });

  it("names an episode by its title, or by its number when the title is just a placeholder", () => {
    expect(episodeName(ep(1, 3, "The Pilot"))).toBe("The Pilot");
    expect(episodeName(ep(1, 3, "S1:E3"))).toBe("Episode 3");
    expect(episodeName(ep(1, 3, "S1 E3"))).toBe("Episode 3");
    expect(episodeName(ep(1, 3))).toBe("Episode 3");
  });

  it("labels an episode by its title, or by its numbers when it has none", () => {
    expect(episodeLabel(ep(1, 3, "The Pilot"))).toBe("The Pilot");
    expect(episodeLabel(ep(2, 5))).toBe("S2:E5");
  });

  it("accepts a series with a list, and rejects an absurdly long one", () => {
    const episodes = Array.from({ length: 5 }, (_, i) => ep(1, i + 1));
    expect(NormalizedMediaSchema.safeParse(media(1, 2, { episodes })).success).toBe(true);
    const tooMany = Array.from({ length: 401 }, (_, i) => ep(1, i + 1));
    expect(NormalizedMediaSchema.safeParse(media(1, 2, { episodes: tooMany })).success).toBe(false);
  });
});

describe("completeSeries", () => {
  const episodes = [ep(1, 1), ep(1, 2), ep(2, 1)];

  it("fills in next from the list, within a season and across seasons", () => {
    expect(completeSeries(media(1, 1, { episodes })).series?.next).toMatchObject({ season: 1, episode: 2 });
    expect(completeSeries(media(1, 2, { episodes })).series?.next).toMatchObject({ season: 2, episode: 1 });
  });

  it("leaves the last episode without a next", () => {
    expect(completeSeries(media(2, 1, { episodes })).series?.next).toBeUndefined();
  });

  it("never overrides a next the source set itself", () => {
    const own = ep(1, 9, "custom");
    expect(completeSeries(media(1, 1, { episodes, next: own })).series?.next).toBe(own);
  });

  it("does nothing for movies, lists without the current episode, or empty lists", () => {
    const movie: NormalizedMedia = { stream: { url: "/x.mp4", type: "mp4" } };
    expect(completeSeries(movie)).toBe(movie);
    const unknown = media(5, 5, { episodes });
    expect(completeSeries(unknown)).toBe(unknown);
    const empty = media(1, 1, { episodes: [] });
    expect(completeSeries(empty)).toBe(empty);
  });
});

describe("normalizeLang", () => {
  it("makes the spellings subtitle sources use comparable", () => {
    expect(normalizeLang("eng")).toBe("en");
    expect(normalizeLang("EN-us")).toBe("en");
    expect(normalizeLang("pob")).toBe("pt");
    expect(normalizeLang("ron")).toBe("ro");
    expect(normalizeLang("rum")).toBe("ro");
    expect(normalizeLang("xyz")).toBe("xyz");
    expect(normalizeLang("")).toBeUndefined();
    expect(normalizeLang(undefined)).toBeUndefined();
  });
});

describe("previousEpisode", () => {
  const list = [ep(2, 1), ep(1, 2), ep(1, 1), ep(2, 2)]; // any order the source used

  it("is the episode before the current one, across a season boundary", () => {
    expect(previousEpisode(media(1, 2, { episodes: list }).series)).toMatchObject({ season: 1, episode: 1 });
    expect(previousEpisode(media(2, 1, { episodes: list }).series)).toMatchObject({ season: 1, episode: 2 });
  });

  it("is nothing for the first episode, for a list without the current one, and without a list", () => {
    expect(previousEpisode(media(1, 1, { episodes: list }).series)).toBeUndefined();
    expect(previousEpisode(media(9, 9, { episodes: list }).series)).toBeUndefined();
    expect(previousEpisode(media(1, 2).series)).toBeUndefined();
    expect(previousEpisode(undefined)).toBeUndefined();
  });
});

describe("seriesKeyOf and stateIsFor", () => {
  it("names the show without the episode, and has no name for a movie", () => {
    expect(seriesKeyOf({ ...media(1, 2), title: "The Long Night · S1 E2" })).toBe("The Long Night");
    expect(seriesKeyOf({ title: "A Movie", stream: { url: "https://cdn.example/m.mp4", type: "mp4" } })).toBeUndefined();
  });

  it("matches a player state to its media by stream, and gives a state without one the benefit of the doubt", () => {
    const current = media(1, 1);
    expect(stateIsFor(current, { stream: current.stream.url })).toBe(true);
    expect(stateIsFor(current, { stream: "https://cdn.example/other.m3u8" })).toBe(false);
    expect(stateIsFor(current, {})).toBe(true);
  });
});

describe("sourcesOf", () => {
  const main = { url: "https://cdn.example/main.m3u8", type: "hls" as const };
  const subs = [{ id: "en", label: "English", url: "/en.vtt" }];

  it("is just the main stream for a video with no alternates", () => {
    expect(sourcesOf({ stream: main })).toEqual([{ label: "Source 1", stream: main, subtitles: undefined }]);
  });

  it("lists the alternates after the main stream, naming the unnamed ones by number", () => {
    const list = sourcesOf({
      stream: main,
      subtitles: subs,
      alternates: [
        { stream: { url: "https://mirror.example/a.mp4", type: "mp4" } },
        { label: "  Server B ", stream: { url: "https://mirror.example/b.mp4", type: "mp4" }, subtitles: [] },
      ],
    });
    expect(list.map((source) => source.label)).toEqual(["Source 1", "Source 2", "Server B"]);
    expect(list[1]?.subtitles).toBe(subs); // an alternate without subtitles of its own uses the main ones
    expect(list[2]?.subtitles).toEqual([]); // one that says it has none keeps none
  });

  it("is limited in how many alternates a media may carry", () => {
    const alternate = { stream: { url: "https://mirror.example/a.mp4", type: "mp4" as const } };
    expect(NormalizedMediaSchema.safeParse({ stream: main, alternates: Array(8).fill(alternate) }).success).toBe(true);
    expect(NormalizedMediaSchema.safeParse({ stream: main, alternates: Array(9).fill(alternate) }).success).toBe(false);
  });
});
