import { describe, expect, it } from "vitest";
import { LIBRARY_SECTIONS, LibraryItemSchema, LibraryRowSchema, LibrarySectionSchema, sectionOf } from "./library";

describe("the sections of the library", () => {
  it("are Movies, Series, Cartoons and Anime, in the order the pages list them", () => {
    expect(LIBRARY_SECTIONS).toEqual(["movie", "series", "cartoon", "anime"]);
    expect(LibrarySectionSchema.safeParse("cartoon").success).toBe(true);
    expect(LibrarySectionSchema.safeParse("cartoons").success).toBe(false);
    expect(LibrarySectionSchema.safeParse("documentary").success).toBe(false);
  });

  it("are said by a title or a row only when it is a cartoon or an anime: for the others the kind (a film or a show) is the section", () => {
    expect(sectionOf({ kind: "movie" })).toBe("movie");
    expect(sectionOf({ kind: "series" })).toBe("series");
    expect(sectionOf({ kind: "series", section: "cartoon" })).toBe("cartoon");
    expect(sectionOf({ kind: "movie", section: "anime" })).toBe("anime");
    expect(sectionOf({ section: "anime" })).toBe("anime");
    // (a source that does not say what its titles are: they are on Home only)
    expect(sectionOf({})).toBeUndefined();
  });

  it("go over the wire with a title and with a row, and a title or a row without one is as it was", () => {
    const item = { id: "a", title: "A", url: "https://x.example/a" };
    expect(LibraryItemSchema.parse({ ...item, kind: "series", section: "anime" })).toMatchObject({ kind: "series", section: "anime" });
    expect(LibraryItemSchema.parse({ ...item, kind: "movie" }).section).toBeUndefined();
    expect(LibraryItemSchema.safeParse({ ...item, section: "everything" }).success).toBe(false);
    const row = { id: "r", title: "R", source: "S", items: [item] };
    expect(LibraryRowSchema.parse({ ...row, kind: "movie", section: "cartoon" })).toMatchObject({ section: "cartoon" });
    expect(LibraryRowSchema.parse(row).section).toBeUndefined();
  });
});
