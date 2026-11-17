import { describe, expect, it } from "vitest";
import { overChildAge } from "./childAges";

// (The ratings are as TMDB had them on 17 Nov for the live site's cartoons for children.)
describe("overChildAge", () => {
  it("lets the US rating decide when there is one: The Simpsons Movie goes, though Britain says PG", () => {
    expect(overChildAge({ RO: "12", IT: "T", US: "PG-13", GB: "PG" })).toBe(true);
    expect(overChildAge({ US: "TV-14" })).toBe(true);
    expect(overChildAge({ US: "R", GB: "U" })).toBe(true);
  });

  it("keeps what the US rates for children, whatever a less reliable country says: Cars, Fantasia, The Lion King, Gumball", () => {
    expect(overChildAge({ RO: "12", IT: "T", US: "G", GB: "PG" })).toBe(false); // (Cars, Fantasia: "12" in Romania)
    expect(overChildAge({ RO: "12", IT: "T", US: "PG", GB: "PG" })).toBe(false); // (The Lion King, 2019)
    expect(overChildAge({ RO: "Unrated", IT: "VM14", US: "TV-Y7", GB: "PG" })).toBe(false); // (The Amazing World of Gumball)
    expect(overChildAge({ RO: "AP", IT: "T", US: "TV-Y7" })).toBe(false); // (Monsters University: a TV rating on a film)
  });

  it("asks Britain, then Italy, then Romania when the one before has none, and a rating it cannot read passes the word on", () => {
    expect(overChildAge({ GB: "PG" })).toBe(false); // (Asterix)
    expect(overChildAge({ GB: "12A", IT: "T" })).toBe(true);
    expect(overChildAge({ US: "NR", GB: "15" })).toBe(true);
    expect(overChildAge({ US: "NR", GB: "U" })).toBe(false); // (The Jungle Book, 1967)
    expect(overChildAge({ IT: "T" })).toBe(false);
    expect(overChildAge({ IT: "VM14" })).toBe(true);
    expect(overChildAge({ RO: "Unrated", IT: "6+" })).toBe(false);
    expect(overChildAge({ RO: "AP-12" })).toBe(true);
    expect(overChildAge({ RO: "AG" })).toBe(false);
  });

  it("keeps TMDB's label for a title no country rates, and reads a rating however it is spaced or cased", () => {
    expect(overChildAge({})).toBe(false); // (The Tom and Jerry Show, 1975)
    expect(overChildAge({ GB: "Something new" })).toBe(false);
    expect(overChildAge({ DE: "16" })).toBe(false); // (a country the site does not read)
    expect(overChildAge({ US: " pg-13 " })).toBe(true);
    expect(overChildAge({ GB: "uc" })).toBe(false);
  });
});
