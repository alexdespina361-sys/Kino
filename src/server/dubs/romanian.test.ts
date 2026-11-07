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
    expect(hasRomanianDubSync({ tmdbId: 808, title: "Shrek" })).toBe(true);
    // Cars (920)
    expect(hasRomanianDubSync({ tmdbId: 920, title: "Cars" })).toBe(true);
    // The Lion King (8587)
    expect(hasRomanianDubSync({ tmdbId: 8587, title: "The Lion King" })).toBe(true);
    // Frozen (109445)
    expect(hasRomanianDubSync({ tmdbId: 109445, title: "Frozen" })).toBe(true);
    // Sonic Boom TV (61845)
    expect(hasRomanianDubSync({ tmdbId: 61845, title: "Sonic Boom" })).toBe(true);
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
    expect(hasRomanianDubSync({ tmdbId: 238, title: "The Godfather" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 424, title: "Schindler's List" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 872585, title: "Oppenheimer" })).toBe(false);
  });

  it("counts a one-word name only for an animated title", () => {
    // (Films that start with, or have in them, the one-word name of a dubbed cartoon.)
    expect(hasRomanianDubSync({ tmdbId: 22947, title: "Up in the Air" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 301, title: "Rio Bravo" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 369557, title: "Sing Street" })).toBe(false);
    expect(hasRomanianDubSync({ tmdbId: 18232, title: "Coco Before Chanel", originalTitle: "Coco avant Chanel" })).toBe(false);
    expect(hasRomanianDubSync({ title: "Rio 2", isAnimation: true })).toBe(true);
    expect(hasRomanianDubSync({ title: "Toy Story 3" })).toBe(true); // (a name of more words is enough by itself)
  });

  it("supports async lookup with fallback", async () => {
    const res = await hasRomanianDub({ title: "Shrek", tmdbId: 808 });
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
