import { describe, expect, it } from "vitest";
import { averageScore, filmFacts, isScore, percentWatched, showFacts, watchedAll } from "./rating";

describe("percentWatched", () => {
  it("counts the last five percent as all of it, since credits get skipped", () => {
    expect(percentWatched(5700, 6000)).toBe(100); // 95% exactly
    expect(percentWatched(5699, 6000)).toBe(94);
    expect(percentWatched(6000, 6000)).toBe(100);
    expect(percentWatched(7000, 6000)).toBe(100); // (a clock that ran on)
  });
  it("is whole percents, never rounded up to a hundred", () => {
    expect(percentWatched(0, 6000)).toBe(0);
    expect(percentWatched(2999, 6000)).toBe(49);
    expect(percentWatched(5690, 6000)).toBe(94);
  });
  it("is all of it when it was played to the end, whatever the numbers say, and unknown when the length is", () => {
    expect(percentWatched(10, 6000, true)).toBe(100);
    expect(percentWatched(10, 0)).toBeUndefined();
    expect(percentWatched(10, Number.NaN)).toBeUndefined();
  });
});

describe("filmFacts", () => {
  it("says when it was last watched and how much, from the card kept for it", () => {
    expect(filmFacts({ at: 500, position: 3000, duration: 6000, done: false })).toEqual({ watchedAt: 500, percent: 50 });
    expect(filmFacts({ at: 700, position: 6000, duration: 6000, done: true })).toEqual({ watchedAt: 700, percent: 100 });
  });
  it("knows nothing of a film that was never played here, and not the length of one that only began", () => {
    expect(filmFacts(undefined)).toEqual({});
    expect(filmFacts({ at: 9, position: 0, duration: 0 })).toEqual({ watchedAt: 9 });
  });
});

describe("showFacts", () => {
  const mark = (season: number, episode: number, extra: Partial<{ position: number; duration: number; done: boolean; at: number }> = {}) => ({
    show: "Show",
    season,
    episode,
    position: 2700,
    duration: 2700,
    done: true,
    at: 1000 + season * 100 + episode,
    ...extra,
  });
  const marks = [mark(1, 1), mark(1, 2), mark(1, 3, { done: false, position: 600 }), mark(2, 1), { ...mark(1, 1), show: "Other" }];

  it("counts the episodes watched to the end in a season, out of how many it has, and when one was last watched", () => {
    expect(showFacts(marks, "Show", 1, 10)).toEqual({ seen: 2, of: 10, watchedAt: 1103 });
    expect(showFacts(marks, "Show", 2, 8)).toEqual({ seen: 1, of: 8, watchedAt: 1201 });
  });
  it("counts the whole show without a total when it is not known", () => {
    expect(showFacts(marks, "Show", undefined)).toEqual({ seen: 3, watchedAt: 1201 });
  });
  it("counts an episode watched past the last five percent, and never more than the season has", () => {
    expect(showFacts([mark(1, 1, { done: false, position: 2600 })], "Show", 1, 10)).toMatchObject({ seen: 1 });
    expect(showFacts(marks, "Show", 1, 1)).toMatchObject({ seen: 1, of: 1 });
  });
  it("knows nothing of a show that was not watched", () => {
    expect(showFacts(marks, "Nothing", 1, 10)).toEqual({});
    expect(showFacts([], "Show", undefined)).toEqual({});
  });
});

describe("watchedAll", () => {
  it("is a film past the last five percent, or every episode of a season whose size is known", () => {
    expect(watchedAll({ percent: 100 })).toBe(true);
    expect(watchedAll({ percent: 80 })).toBe(false);
    expect(watchedAll({ seen: 10, of: 10 })).toBe(true);
    expect(watchedAll({ seen: 9, of: 10 })).toBe(false);
    expect(watchedAll({ seen: 9 })).toBe(false);
    expect(watchedAll({})).toBe(false);
  });
});

describe("averageScore and isScore", () => {
  it("averages to one decimal, and is nothing for nothing", () => {
    expect(averageScore([{ score: 8 }, { score: 7 }, { score: 7 }])).toBe(7.3);
    expect(averageScore([{ score: 10 }])).toBe(10);
    expect(averageScore([])).toBeUndefined();
  });
  it("takes a whole number from one to ten for a score", () => {
    expect([1, 5, 10].every(isScore)).toBe(true);
    expect([0, 11, 5.5, Number.NaN, -1].some(isScore)).toBe(false);
  });
});
