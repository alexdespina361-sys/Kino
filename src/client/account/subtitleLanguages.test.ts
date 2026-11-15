import { describe, expect, it } from "vitest";
import { COMMON_LANGUAGES, keptLanguages, languageNamer, MAX_SUBTITLE_LANGUAGES, moveLanguage, pickableLanguages, toggleLanguage } from "./subtitleLanguages";

describe("the subtitle languages a profile chooses", () => {
  it("adds a language pressed at the end of the order, and takes it out when it is pressed again", () => {
    expect(toggleLanguage([], "nl")).toEqual(["nl"]);
    expect(toggleLanguage(["nl"], "fr")).toEqual(["nl", "fr"]);
    expect(toggleLanguage(["nl", "fr", "ro"], "fr")).toEqual(["nl", "ro"]); // (the ones after it move up a place)
  });

  it("holds twelve at most: a thirteenth is not added, and taking one out makes room again", () => {
    const full = COMMON_LANGUAGES.slice(0, MAX_SUBTITLE_LANGUAGES);
    expect(toggleLanguage(full, "ko")).toEqual(full);
    expect(toggleLanguage(toggleLanguage(full, "en"), "ko")).toEqual([...full.slice(1), "ko"]);
  });

  it("keeps none chosen as no setting at all, so that the defaults apply again", () => {
    expect(keptLanguages([])).toBeUndefined();
    expect(keptLanguages(["ro", "en"])).toEqual(["ro", "en"]);
  });

  it("moves one of them up or down a place, and leaves it where it is at either end", () => {
    expect(moveLanguage(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveLanguage(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveLanguage(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveLanguage(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("offers every language in an order that does not change as some are chosen, with any chosen elsewhere at the end", () => {
    expect(pickableLanguages([])).toEqual([...COMMON_LANGUAGES]);
    expect(pickableLanguages(["fr", "nl"])).toEqual([...COMMON_LANGUAGES]);
    expect(pickableLanguages(["fi", "fr"])).toEqual([...COMMON_LANGUAGES, "fi"]);
  });

  it("names the languages in the site's language, and a code it has no name for in capitals", () => {
    expect(languageNamer("en")("nl")).toBe("Dutch");
    expect(languageNamer("ro")("nl")).toMatch(/^[Nn]eerlandez/);
    expect(languageNamer("en")("")).toBe("");
  });
});
