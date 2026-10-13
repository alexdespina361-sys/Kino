import { describe, expect, it } from "vitest";
import type { LiveRating } from "../../shared";
import { translate } from "../i18n";
import { averageText, factLines, mergeFacts, ratingFor, ratingNote, ratingSummary, scoreWord, SCORES, sortRatings, storedFacts } from "./ratingText";

const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params);
const ro = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("ro", key, params);

const rated = (key: string, score: number, ratedAt = 1, extra: Partial<LiveRating> = {}): LiveRating => ({ key, at: ratedAt, title: key, url: `https://x.example/${key}`, score, ratedAt, ...extra });
/** Noon in the middle of the month, so the day is the same in every time zone. */
const DAY = Date.UTC(2026, 9, 12, 12);

describe("the scores", () => {
  it("are one to ten, and each has a word in every language", () => {
    expect(SCORES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(SCORES.map((score) => scoreWord(en, score))).toEqual(["Appalling", "Horrible", "Very bad", "Bad", "Average", "Fine", "Good", "Very good", "Great", "Masterpiece"]);
    expect(scoreWord(ro, 10)).toBe("Capodoperă");
  });
  it("have no word for a number that is no score", () => {
    expect(scoreWord(en, 0)).toBe("");
    expect(scoreWord(en, 11)).toBe("");
    expect(scoreWord(en, 5.5)).toBe("");
  });
});

describe("ratingFor", () => {
  const ratings = [rated("rate:https://x.example/show?s=1&e=1", 8), rated("rate:https://x.example/show?s=1&e=1|s2", 6, 1, { season: 2 }), rated("rate:https://x.example/film", 9)];
  it("finds the rating of a title by its link, whichever episode the link is of, and of one of its seasons", () => {
    expect(ratingFor(ratings, "https://x.example/film")?.score).toBe(9);
    expect(ratingFor(ratings, "https://x.example/show?s=3&e=5")?.score).toBe(8);
    expect(ratingFor(ratings, "https://x.example/show?s=1&e=1", 2)?.score).toBe(6);
    expect(ratingFor(ratings, "https://x.example/show?s=1&e=1", 3)).toBeUndefined();
    expect(ratingFor(ratings, "https://x.example/other")).toBeUndefined();
  });
});

describe("sortRatings", () => {
  const list = [rated("a", 6, 100), rated("b", 9, 300), rated("c", 9, 200), rated("d", 7, 400)];
  it("puts the newest rating first, or the best first with the newest among equal scores", () => {
    expect(sortRatings(list, "new").map((r) => r.key)).toEqual(["d", "b", "c", "a"]);
    expect(sortRatings(list, "high").map((r) => r.key)).toEqual(["b", "c", "d", "a"]);
  });
  it("leaves the list it was given alone", () => {
    const before = list.map((r) => r.key);
    sortRatings(list, "high");
    expect(list.map((r) => r.key)).toEqual(before);
  });
  it("keeps a title's seasons together in order when they were rated at once", () => {
    const seasons = [rated("s", 7, 5, { season: 2 }), rated("s", 7, 5, { season: 1 })];
    expect(sortRatings(seasons, "new").map((r) => r.season)).toEqual([1, 2]);
  });
});

describe("mergeFacts", () => {
  it("keeps the furthest anyone got and the latest time", () => {
    expect(mergeFacts({ percent: 100, watchedAt: 50 }, { percent: 3, watchedAt: 90 })).toEqual({ percent: 100, watchedAt: 90 });
    expect(mergeFacts({ seen: 4, of: 10, watchedAt: 5 }, { seen: 2, watchedAt: 1 })).toEqual({ seen: 4, of: 10, watchedAt: 5 });
  });
  it("takes the size of a season from whoever knows it, and never counts more episodes than there are", () => {
    expect(mergeFacts({ seen: 12 }, { of: 10 })).toEqual({ seen: 10, of: 10 });
    expect(mergeFacts({ seen: 3, of: 8 }, { of: 10 })).toEqual({ seen: 3, of: 10 });
  });
  it("is what is known when only one side knows anything", () => {
    expect(mergeFacts({}, {})).toEqual({});
    expect(mergeFacts({ percent: 40 }, {})).toEqual({ percent: 40 });
    expect(mergeFacts({}, { percent: 40 })).toEqual({ percent: 40 });
  });
});

describe("storedFacts", () => {
  it("is what a rating remembers of the watching, and nothing for what it does not", () => {
    expect(storedFacts(rated("a", 5, 1, { watchedAt: 9, percent: 100 }))).toEqual({ watchedAt: 9, percent: 100 });
    expect(storedFacts(rated("a", 5, 1, { seen: 2, of: 8 }))).toEqual({ seen: 2, of: 8 });
    expect(storedFacts(rated("a", 5, 1))).toEqual({});
    expect(storedFacts(undefined)).toEqual({});
  });
});

describe("factLines", () => {
  it("says when it was rated, that all of a film was watched, and when it was finished", () => {
    expect(factLines(en, "en", DAY, { percent: 100, watchedAt: DAY })).toEqual(["Rated 12 Oct 2026", "Watched all of it", "Finished 12 Oct 2026"]);
  });
  it("says how much of a film was watched, and when it was last watched, when it was not all", () => {
    expect(factLines(en, "en", DAY, { percent: 62, watchedAt: DAY })).toEqual(["Rated 12 Oct 2026", "62% watched", "Last watched 12 Oct 2026"]);
  });
  it("counts the episodes of a season out of how many it has, or on their own when that is not known", () => {
    expect(factLines(en, "en", DAY, { seen: 3, of: 10, watchedAt: DAY })).toEqual(["Rated 12 Oct 2026", "3 of 10 episodes watched", "Last watched 12 Oct 2026"]);
    expect(factLines(en, "en", undefined, { seen: 1, of: 1, watchedAt: DAY })).toEqual(["1 of 1 episode watched", "Finished 12 Oct 2026"]);
    expect(factLines(en, "en", undefined, { seen: 5 })).toEqual(["5 episodes watched"]);
    expect(factLines(en, "en", undefined, { seen: 1 })).toEqual(["1 episode watched"]);
  });
  it("is only the day it was rated for a title that was never watched here, and nothing without even that", () => {
    expect(factLines(en, "en", DAY, {})).toEqual(["Rated 12 Oct 2026"]);
    expect(factLines(en, "en", undefined, {})).toEqual([]);
  });
  it("writes the days in the language of the screen", () => {
    expect(factLines(ro, "ro", DAY, {})[0]).toMatch(/^Notat pe 12 oct\.? 2026$/);
  });
});

describe("ratingNote and ratingSummary", () => {
  it("puts the score under a title, with the season when it is one", () => {
    expect(ratingNote(en, { score: 8 })).toBe("8/10");
    expect(ratingNote(en, { score: 6, season: 2 })).toBe("Season 2 · 6/10");
  });
  it("sums up how many were given and their mean to one decimal, in the language's number", () => {
    expect(ratingSummary(en, "en", [{ score: 8 }, { score: 7 }, { score: 7 }])).toBe("3 ratings · average 7.3");
    expect(ratingSummary(en, "en", [{ score: 10 }])).toBe("1 rating · average 10");
    expect(ratingSummary(ro, "ro", [{ score: 8 }, { score: 7 }, { score: 7 }])).toBe("3 note · media 7,3");
    expect(ratingSummary(en, "en", [])).toBe("");
  });
  it("writes the mean without a decimal when it has none", () => {
    expect(averageText("en", [{ score: 8 }, { score: 6 }])).toBe("7");
  });
});
