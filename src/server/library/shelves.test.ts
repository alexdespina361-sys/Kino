import { describe, expect, it } from "vitest";
import { FILMPIRE_CATEGORIES } from "./filmpire";
import { LIBRARY_SECTIONS } from "../../shared";
import { FILMPIRE_SHELVES, SHELF_GROUPS, sectionOfCategory, shelfPlan, type FilmpireCategory } from "./shelves";

const cat = (id: string, type: "movie" | "tv" = "movie"): FilmpireCategory => ({ id, title: id.toUpperCase(), path: `/discover/${type}?x=${id}`, type });

describe("the shelves", () => {
  it("are many, each with an id and a title of its own that no first category has", () => {
    expect(FILMPIRE_SHELVES.length).toBeGreaterThanOrEqual(90);
    const ids = FILMPIRE_SHELVES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(FILMPIRE_SHELVES.map((one) => one.title)).size).toBe(ids.length);
    const first = new Set(FILMPIRE_CATEGORIES.map((one) => one.id));
    expect(ids.filter((id) => first.has(id))).toEqual([]);
    expect(FILMPIRE_SHELVES.filter((one) => one.type === "movie").length).toBeGreaterThanOrEqual(50);
    expect(FILMPIRE_SHELVES.filter((one) => one.type === "tv").length).toBeGreaterThanOrEqual(30);
  });

  it("ask TMDB's discover, in the kind's own words for dates, with nothing in them about a title, a person or a franchise", () => {
    const allowed = new Set([
      "include_adult", "language", "with_genres", "without_genres", "without_keywords", "with_original_language", "with_type", "sort_by",
      "primary_release_date.gte", "primary_release_date.lte", "first_air_date.gte", "first_air_date.lte",
      "vote_count.gte", "vote_count.lte", "vote_average.gte",
    ]);
    for (const shelf of FILMPIRE_SHELVES) {
      const [route, query = ""] = shelf.path.split("?");
      expect(route, shelf.id).toBe(`/discover/${shelf.type}`);
      const params = new URLSearchParams(query);
      for (const key of params.keys()) expect(allowed.has(key), `${shelf.id}: ${key}`).toBe(true);
      expect(params.has("page") || params.has("api_key"), shelf.id).toBe(false); // (the source adds the page and the key)
      expect(params.has("sort_by"), shelf.id).toBe(true);
      const own = shelf.type === "movie" ? "first_air_date" : "primary_release_date";
      expect([...params.keys()].filter((key) => key.startsWith(own)), `${shelf.id} uses the other kind's dates`).toEqual([]);
    }
  });

  it("ranked by the score always have a floor of votes, so that a title with one vote of ten does not lead", () => {
    for (const shelf of FILMPIRE_SHELVES) {
      const params = new URLSearchParams(shelf.path.split("?")[1]);
      if (params.get("sort_by") === "vote_average.desc") expect(Number(params.get("vote_count.gte")), shelf.id).toBeGreaterThanOrEqual(50);
    }
  });

  it("take in decades of films and of series, and the groups are all in the plan", () => {
    const ids = FILMPIRE_SHELVES.map((one) => one.id);
    expect(ids).toEqual(expect.arrayContaining(["movies-1950s", "movies-2010s", "series-1970s", "best-movies-1930s", "best-series-1960s", "classic-horror-movies", "hidden-gems-movies", "cult-classics", "world-ko-movies", "world-ko-tv"]));
    expect(shelfPlan().map((one) => one.id).sort()).toEqual([...ids].sort());
    expect(SHELF_GROUPS.flat()).toEqual(FILMPIRE_SHELVES);
  });
});

describe("the sections of the shelves", () => {
  const params = (shelf: FilmpireCategory) => new URLSearchParams(shelf.path.split("?")[1]);
  const genres = (value: string | null) => (value ?? "").split(",");
  const inSection = (section: string) => FILMPIRE_SHELVES.filter((one) => sectionOfCategory(one) === section);

  it("put every shelf in one section, and give each enough to scroll through", () => {
    expect(inSection("movie").length).toBeGreaterThanOrEqual(50);
    expect(inSection("series").length).toBeGreaterThanOrEqual(30);
    expect(inSection("cartoon").length).toBeGreaterThanOrEqual(20);
    expect(inSection("anime").length).toBeGreaterThanOrEqual(20);
    expect(LIBRARY_SECTIONS.reduce((sum, section) => sum + inSection(section).length, 0)).toBe(FILMPIRE_SHELVES.length);
  });

  it("ask the films and the series for no animation, and the cartoons and the anime for animation only", () => {
    for (const shelf of FILMPIRE_SHELVES) {
      const section = sectionOfCategory(shelf);
      if (section === "movie" || section === "series") {
        expect(genres(params(shelf).get("without_genres")), shelf.id).toContain("16");
        expect(genres(params(shelf).get("with_genres")), shelf.id).not.toContain("16");
      } else {
        expect(genres(params(shelf).get("with_genres")), shelf.id).toContain("16");
        expect(genres(params(shelf).get("without_genres")), shelf.id).not.toContain("16");
      }
    }
  });

  it("ask for Japanese animation for the anime, and for none of it for the cartoons", () => {
    for (const shelf of inSection("anime")) expect(params(shelf).get("with_original_language"), shelf.id).toBe("ja");
    for (const shelf of inSection("cartoon")) expect(params(shelf).get("with_original_language"), shelf.id).not.toBe("ja");
    // (a French or a Chinese cartoon is a cartoon)
    expect(inSection("cartoon").map((one) => one.id)).toEqual(expect.arrayContaining(["world-fr-cartoon-movies", "world-zh-cartoon-tv"]));
  });

  it("call the films' shelves movies and the series' shelves tv, as before", () => {
    expect(inSection("movie").every((one) => one.type === "movie")).toBe(true);
    expect(inSection("series").every((one) => one.type === "tv")).toBe(true);
  });

  it("have the decades and the best of the cartoons and of the anime, as the films and the series have", () => {
    const ids = FILMPIRE_SHELVES.map((one) => one.id);
    expect(ids).toEqual(expect.arrayContaining(["cartoon-tv-1990s", "cartoon-movies-2010s", "anime-tv-2000s", "anime-movies-2020s", "best-cartoons-tv", "best-anime-movies", "classic-anime", "hidden-gems-anime"]));
  });
});

describe("shelfPlan", () => {
  it("is the same order every time, so that a page asked for twice (or by two screens) is the same page", () => {
    expect(shelfPlan().map((one) => one.id)).toEqual(shelfPlan().map((one) => one.id));
    expect(shelfPlan("movie").map((one) => one.id)).toEqual(shelfPlan("movie").map((one) => one.id));
  });

  it("takes one from each group in turn, so that a decade is never followed by another decade", () => {
    const groups = [[cat("a1"), cat("a2"), cat("a3")], [cat("b1", "tv"), cat("b2", "tv")], [cat("c1")]];
    const groupOf = (one: FilmpireCategory) => groups.findIndex((group) => group.includes(one));
    const plan = shelfPlan(undefined, groups);
    expect(plan).toHaveLength(6);
    expect(plan.map(groupOf)).toEqual([0, 1, 2, 0, 1, 0]);
    // (each shelf once)
    expect(new Set(plan).size).toBe(6);
  });

  it("is only the shelves of one section, when asked: the films, the series, the cartoons or the anime", () => {
    expect(shelfPlan("movie").every((one) => one.type === "movie" && sectionOfCategory(one) === "movie")).toBe(true);
    expect(shelfPlan("series").every((one) => one.type === "tv" && sectionOfCategory(one) === "series")).toBe(true);
    expect(shelfPlan("cartoon").every((one) => sectionOfCategory(one) === "cartoon")).toBe(true);
    expect(shelfPlan("anime").every((one) => sectionOfCategory(one) === "anime")).toBe(true);
    // (the four plans together are the shelves there are, each in one of them)
    const together = LIBRARY_SECTIONS.flatMap((section) => shelfPlan(section).map((one) => one.id));
    expect(together.sort()).toEqual(FILMPIRE_SHELVES.map((one) => one.id).sort());
  });

  it("has films and shows both among the cartoons and among the anime", () => {
    for (const section of ["cartoon", "anime"] as const) {
      expect(new Set(shelfPlan(section).map((one) => one.type)), section).toEqual(new Set(["movie", "tv"]));
    }
  });

  it("shuffles each group in its own way, not in the order of the table", () => {
    const decades = shelfPlan("movie", [SHELF_GROUPS[0]!]).map((one) => one.id);
    expect(decades).not.toEqual(SHELF_GROUPS[0]!.map((one) => one.id));
    expect([...decades].sort()).toEqual(SHELF_GROUPS[0]!.map((one) => one.id).sort());
  });

  it("has nothing for no groups, or for groups with none of the kind", () => {
    expect(shelfPlan(undefined, [])).toEqual([]);
    expect(shelfPlan("series", [[cat("a")]])).toEqual([]);
  });
});
