import { describe, expect, it } from "vitest";
import type { LibraryItem, TitleAbout } from "../../shared";
import { aboutRows, ageOf } from "./about";

const item = (id: string): LibraryItem => ({ id, title: id, url: `https://filmpire.sc/watch/${id}` });
const about = (some: Partial<TitleAbout> = {}): TitleAbout => ({ genres: [], directors: [], creators: [], cast: [], ages: {}, parts: [], similar: [], ...some });

describe("ageOf", () => {
  it("gives a reader the rating of their own country first", () => {
    const ages = { RO: "AP-12", IT: "T", US: "PG-13", GB: "12A" };
    expect(ageOf(ages, "ro")).toEqual({ country: "RO", rating: "AP-12" });
    expect(ageOf(ages, "it")).toEqual({ country: "IT", rating: "T" });
    expect(ageOf(ages, "en")).toEqual({ country: "US", rating: "PG-13" });
  });

  it("falls back to the US, then Britain, then whichever country has one", () => {
    expect(ageOf({ US: "R", GB: "15" }, "ro")).toEqual({ country: "US", rating: "R" });
    expect(ageOf({ GB: "15", IT: "14" }, "en")).toEqual({ country: "GB", rating: "15" });
    expect(ageOf({ IT: "14" }, "en")).toEqual({ country: "IT", rating: "14" });
    expect(ageOf({ RO: "AG" }, "en")).toEqual({ country: "RO", rating: "AG" });
  });

  it("says nothing when no country rated the title", () => {
    expect(ageOf({}, "en")).toBeUndefined();
    expect(ageOf({ US: "" }, "en")).toBeUndefined();
  });
});

describe("aboutRows", () => {
  it("lists the other parts first and titles like it second, and leaves out a row with no title", () => {
    const rows = aboutRows(about({ parts: [item("a")], similar: [item("b"), item("c")] }));
    expect(rows.map((row) => [row.id, row.items.map((one) => one.id)])).toEqual([
      ["parts", ["a"]],
      ["similar", ["b", "c"]],
    ]);
    expect(aboutRows(about({ similar: [item("b")] })).map((row) => row.id)).toEqual(["similar"]);
    expect(aboutRows(about({ parts: [item("a")] })).map((row) => row.id)).toEqual(["parts"]);
  });

  it("is no rows for a title nothing is known of, or one still being asked about", () => {
    expect(aboutRows(about())).toEqual([]);
    expect(aboutRows(null)).toEqual([]);
    expect(aboutRows(undefined)).toEqual([]);
  });
});
