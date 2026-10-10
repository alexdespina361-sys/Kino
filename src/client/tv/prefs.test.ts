import { describe, expect, it } from "vitest";
import { describeTrack, parsePrefs, pickTrack, serializePrefs } from "./prefs";

const tracks = [
  { id: 0, label: "English", lang: "eng" },
  { id: 1, label: "Română", lang: "ron" },
  { id: 2, label: "Deutsch" },
];

describe("pickTrack", () => {
  it("matches by language even when sources spell it differently", () => {
    expect(pickTrack(tracks, { lang: "en", label: "English" })).toBe(0);
    expect(pickTrack(tracks, { lang: "ro", label: "whatever" })).toBe(1);
  });

  it("falls back to the same name for tracks that declare no language", () => {
    expect(pickTrack(tracks, { label: "deutsch" })).toBe(2);
    expect(pickTrack(tracks, { lang: "de", label: "Deutsch" })).toBe(2);
  });

  it("finds nothing rather than guessing", () => {
    expect(pickTrack(tracks, { lang: "fr", label: "Français" })).toBeUndefined();
    expect(pickTrack([], { lang: "en", label: "English" })).toBeUndefined();
  });
});

describe("describeTrack", () => {
  it("stores a normalised language and the label", () => {
    expect(describeTrack({ id: 0, label: "English", lang: "eng" })).toEqual({ lang: "en", label: "English" });
    expect(describeTrack({ id: 2, label: "Deutsch" })).toEqual({ label: "Deutsch" });
  });
});

describe("prefs storage", () => {
  it("round-trips, including an explicit 'off'", () => {
    const prefs = { subtitles: "off" as const, audio: { lang: "en", label: "English" }, captionStyle: { size: "large" as const, color: "yellow" as const } };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });

  it("keeps the subtitle size an older version stored, as part of the caption look", () => {
    expect(parsePrefs('{"subtitleSize":"large"}')).toEqual({ captionStyle: { size: "large" } });
    expect(parsePrefs('{"subtitleSize":"small","captionStyle":{"size":"xlarge"}}')).toEqual({ captionStyle: { size: "xlarge" } });
  });

  it("ignores missing, corrupt or foreign data", () => {
    expect(parsePrefs(undefined)).toEqual({});
    expect(parsePrefs("{nope")).toEqual({});
    expect(parsePrefs('{"subtitleSize":"gigantic"}')).toEqual({});
    expect(parsePrefs('{"subtitles":"on"}')).toEqual({});
    expect(parsePrefs('{"captionStyle":{"color":"plaid"}}')).toEqual({});
  });
});
