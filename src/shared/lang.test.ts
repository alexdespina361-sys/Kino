import { describe, expect, it } from "vitest";
import { languageName, localTrackLabel, normalizeLang, trackLabel } from "./lang";

describe("languageName", () => {
  it("names the languages people watch in, from two- or three-letter codes", () => {
    expect(languageName("ro")).toBe("Romanian");
    expect(languageName("ron")).toBe("Romanian");
    expect(languageName("EN")).toBe("English");
    expect(languageName("fre")).toBe("French");
  });

  it("keeps a regional variant", () => {
    expect(languageName("pt-BR")).toMatch(/Portuguese/);
    expect(languageName("pt_BR")).toMatch(/Portuguese/);
    expect(languageName("pt-BR")).not.toBe(languageName("pt-PT"));
  });

  it("has no name for what is not a language code", () => {
    expect(languageName(undefined)).toBeUndefined();
    expect(languageName("")).toBeUndefined();
    expect(languageName("Track 2")).toBeUndefined();
    expect(languageName("zz-not-a-thing!")).toBeUndefined();
  });
});

describe("trackLabel", () => {
  it("keeps a label a person can read", () => {
    expect(trackLabel("English", "en", "Subtitle 1")).toBe("English");
    expect(trackLabel("English (SDH)", "en", "Subtitle 1")).toBe("English (SDH)");
    expect(trackLabel("Forced", undefined, "Subtitle 1")).toBe("Forced");
  });

  it("swaps a bare code for the language's name, whichever of label and lang has it", () => {
    expect(trackLabel("eng", "eng", "Subtitle 1")).toBe("English");
    expect(trackLabel("", "ro", "Subtitle 1")).toBe("Romanian");
    expect(trackLabel("ron", undefined, "Subtitle 1")).toBe("Romanian");
    expect(trackLabel("Track 2", "de", "Audio 2")).toBe("German");
  });

  it("falls back to what the source called it, then to the generic name", () => {
    expect(trackLabel("SDH", undefined, "Subtitle 3")).toBe("SDH");
    expect(trackLabel("", undefined, "Subtitle 3")).toBe("Subtitle 3");
    expect(trackLabel(undefined, "zzz-nope", "Audio 4")).toBe("Audio 4");
  });

  it("agrees with normalizeLang about what a code means", () => {
    expect(normalizeLang("eng")).toBe("en");
    expect(trackLabel("", "eng", "x")).toBe(languageName("en"));
  });
});

describe("languageName in the language of the reader", () => {
  it("says the name the way the reader's language does, starting with a capital", () => {
    expect(languageName("en", "ro")).toBe("Engleză");
    expect(languageName("ron", "it")).toBe("Rumeno");
    expect(languageName("it", "it")).toBe("Italiano");
    expect(languageName("de", "en")).toBe("German");
  });

  it("still gives up on what it cannot name", () => {
    expect(languageName("Track 2", "ro")).toBeUndefined();
    expect(languageName("en", "not a locale!")).toBeUndefined();
  });
});

describe("localTrackLabel", () => {
  it("translates a label that is only the language, and leaves the rest as the file wrote it", () => {
    expect(localTrackLabel({ label: "English", lang: "en" }, "ro")).toBe("Engleză");
    expect(localTrackLabel({ label: "Romanian", lang: "ron" }, "it")).toBe("Rumeno");
    expect(localTrackLabel({ label: "English (SDH)", lang: "en" }, "ro")).toBe("English (SDH)");
    expect(localTrackLabel({ label: "Commentary" }, "ro")).toBe("Commentary");
    expect(localTrackLabel({ label: "English", lang: "en" }, "en")).toBe("English");
  });
});
