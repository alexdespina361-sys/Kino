import { describe, expect, it } from "vitest";
import { TitleAboutSchema } from "../../shared";
import { hasRomanianDub, hasRomanianDubSync, normalizeDubTitle } from "./romanian";

describe("Romanian dubbing service", () => {
  it("normalizes titles and strips diacritics and noise labels", () => {
    expect(normalizeDubTitle("Shrek al treilea (2007) (Dublat în Română)")).toBe("shrek al treilea");
    expect(normalizeDubTitle("Regele Leu (1994) - Film")).toBe("regele leu");
    expect(normalizeDubTitle("Întors pe dos 2: Ediție Specială!")).toBe("intors pe dos 2 editie speciala");
    expect(normalizeDubTitle("Pădurea Fermecată")).toBe("padurea fermecata");
  });

  it("identifies well-known Romanian dubbed titles by TMDB ID", () => {
    // Shrek (808)
    expect(hasRomanianDubSync({ tmdbId: 808, type: "movie", title: "Shrek" })).toBe(true);
    // Cars (920)
    expect(hasRomanianDubSync({ tmdbId: 920, type: "movie", title: "Cars" })).toBe(true);
    // The Lion King (8587)
    expect(hasRomanianDubSync({ tmdbId: 8587, type: "movie", title: "The Lion King" })).toBe(true);
    // Frozen (109445)
    expect(hasRomanianDubSync({ tmdbId: 109445, type: "movie", title: "Frozen" })).toBe(true);
    // Sonic Boom TV (61845)
    expect(hasRomanianDubSync({ tmdbId: 61845, type: "tv", title: "Sonic Boom" })).toBe(true);
  });

  it("counts an ID only for a title of its kind: TMDB numbers films and shows apart", () => {
    expect(hasRomanianDubSync({ tmdbId: 387, type: "tv", title: "SpongeBob SquarePants" })).toBe(true);
    expect(hasRomanianDubSync({ tmdbId: 387, type: "movie", title: "Das Boot" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 808, type: "tv", title: "The show TMDB numbers 808" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 808, title: "Shrek" })).toBe(false); // (a kind not said: the ID says nothing, the one-word name needs animation)
    // Live-action shows that were on the list of animated series.
    expect(hasRomanianDubSync({ tmdbId: 1408, type: "tv", title: "House" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 4614, type: "tv", title: "NCIS" })).toBe(false);
  });

  it("identifies titles by English franchise and title names", () => {
    expect(hasRomanianDubSync({ title: "Shrek the Third", isAnimation: true })).toBe(true);
    expect(hasRomanianDubSync({ title: "Kung Fu Panda 4" })).toBe(true);
    expect(hasRomanianDubSync({ title: "How to Train Your Dragon: The Hidden World" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Despicable Me 4" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Toy Story 3" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Ice Age: Collision Course" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Inside Out 2" })).toBe(true);
  });

  it("identifies titles by Romanian localized names", () => {
    expect(hasRomanianDubSync({ title: "Regele Leu" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Regatul de gheață" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Epoca de gheață 3" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Mașini 2", isAnimation: true })).toBe(true);
    expect(hasRomanianDubSync({ title: "Motanul încălțat" })).toBe(true);
    expect(hasRomanianDubSync({ title: "Întors pe dos 2" })).toBe(true);
  });

  it("returns false for live-action adult or non-dubbed media", () => {
    expect(hasRomanianDubSync({ tmdbId: 238, type: "movie", title: "The Godfather" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 424, type: "movie", title: "Schindler's List" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 872585, type: "movie", title: "Oppenheimer" })).toBe(false);
  });

  it("counts a one-word name only for an animated title", () => {
    // (Films that start with, or have in them, the one-word name of a dubbed cartoon.)
    expect(hasRomanianDubSync({ tmdbId: 22947, type: "movie", title: "Up in the Air" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 301, type: "movie", title: "Rio Bravo" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 369557, type: "movie", title: "Sing Street" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 18232, type: "movie", title: "Coco Before Chanel", originalTitle: "Coco avant Chanel" })).toBe(false);
    expect(hasRomanianDubSync({ title: "Rio 2", isAnimation: true })).toBe(true);
    expect(hasRomanianDubSync({ title: "Toy Story 3" })).toBe(true); // (a name of more words is enough by itself)
  });

  it("supports async lookup with fallback", async () => {
    const res = await hasRomanianDub({ title: "Shrek", tmdbId: 808, type: "movie" });
    expect(res).toBe(true);
  });

  it("validates TitleAboutSchema with hasRoDub", () => {
    const parsed = TitleAboutSchema.parse({
      genres: ["Animation", "Comedy"],
      directors: ["Andrew Adamson"],
      creators: [],
      cast: ["Mike Myers", "Eddie Murphy"],
      ages: { US: "PG" },
      parts: [],
      similar: [],
      hasRoDub: true,
    });
    expect(parsed.hasRoDub).toBe(true);
  });
});
