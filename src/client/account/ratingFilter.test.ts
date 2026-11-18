import { describe, expect, it } from "vitest";
import type { LiveRating } from "../../shared";
import { filterRatings, filterRows, ownSection, ratingChoices, usableFilter } from "./ratingFilter";

const rated = (title: string, score: number, more: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${title}`, at: 1, title, url: `https://films.example/${title}`, score, ratedAt: 1, ...more });

const ratings = [
  rated("heat", 9, { kind: "movie" }),
  rated("alien", 8, { kind: "movie" }),
  rated("dark", 9, { kind: "series" }),
  rated("shrek", 7, { kind: "movie", section: "cartoon" }),
  rated("akira", 9, { kind: "movie", section: "anime" }),
  rated("old", 4),
];
const titles = (list: readonly LiveRating[]) => list.map((rating) => rating.title);

describe("the ratings filter", () => {
  it("knows a rating's section from what it says: a cartoon or an anime, else its kind, else a film", () => {
    expect(ratings.map(ownSection)).toEqual(["movie", "movie", "series", "cartoon", "anime", "movie"]);
  });

  it("offers only the sections and scores the ratings have, in the pages' order and the highest score first, with how many of each", () => {
    expect(ratingChoices(ratings, {})).toEqual({
      sections: [
        { section: "movie", count: 3 },
        { section: "series", count: 1 },
        { section: "cartoon", count: 1 },
        { section: "anime", count: 1 },
      ],
      scores: [
        { score: 9, count: 3 },
        { score: 8, count: 1 },
        { score: 7, count: 1 },
        { score: 4, count: 1 },
      ],
    });
    expect(ratingChoices(ratings, { section: "movie" }).scores).toEqual([
      { score: 9, count: 1 },
      { score: 8, count: 1 },
      { score: 4, count: 1 },
    ]);
  });

  it("keeps one section, one score, or both", () => {
    expect(titles(filterRatings(ratings, {}))).toEqual(["heat", "alien", "dark", "shrek", "akira", "old"]);
    expect(titles(filterRatings(ratings, { section: "movie" }))).toEqual(["heat", "alien", "old"]);
    expect(titles(filterRatings(ratings, { score: 9 }))).toEqual(["heat", "dark", "akira"]);
    expect(titles(filterRatings(ratings, { section: "anime", score: 9 }))).toEqual(["akira"]);
  });

  it("lets go of a choice none of the ratings has any more, rather than show nothing", () => {
    expect(usableFilter(ratings, { section: "movie", score: 7 })).toEqual({ section: "movie" });
    expect(titles(filterRatings(ratings, { section: "movie", score: 7 }))).toEqual(["heat", "alien", "old"]);
    expect(usableFilter(ratings.slice(0, 2), { section: "anime", score: 8 })).toEqual({ score: 8 });
    expect(filterRatings([], { section: "anime", score: 8 })).toEqual([]);
  });

  it("asks where a title is browsed of whoever knows better (the library), when it is given a way to", () => {
    const fromLibrary = (rating: LiveRating) => (rating.title === "alien" ? "cartoon" : ownSection(rating));
    expect(titles(filterRatings(ratings, { section: "cartoon" }, fromLibrary))).toEqual(["alien", "shrek"]);
  });

  it("shows a row of choices only when it has more than one thing to choose, All (or Any) first", () => {
    expect(filterRows(ratingChoices(ratings, {}))).toEqual({ sections: [undefined, "movie", "series", "cartoon", "anime"], scores: [undefined, 9, 8, 7, 4] });
    expect(filterRows(ratingChoices([rated("a", 8, { kind: "movie" }), rated("b", 8, { kind: "movie" })], {}))).toEqual({ sections: [], scores: [] });
    expect(filterRows(ratingChoices(ratings, { section: "series" }))).toEqual({ sections: [undefined, "movie", "series", "cartoon", "anime"], scores: [] });
  });
});
