import { describe, expect, it } from "vitest";
import { normalizeLang } from "./lang";
import {
  completeSeries,
  episodeName,
  groupBySeason,
  NormalizedMediaSchema,
  sortEpisodes,
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
