import { describe, expect, it } from "vitest";
import { defaultSyncMode, describeTrack, parsePrefs, pickBaseSubtitleTrack, pickTrack, serializePrefs } from "./prefs";

describe("defaultSyncMode", () => {
  it("is Light on a weaker screen: 4 threads or fewer, or 4 GB or less", () => {
    expect(defaultSyncMode({ cores: 4 })).toBe("light");
    expect(defaultSyncMode({ cores: 2, memoryGb: 8 })).toBe("light");
    expect(defaultSyncMode({ cores: 8, memoryGb: 4 })).toBe("light");
    expect(defaultSyncMode({ cores: 16, memoryGb: 2 })).toBe("light");
    expect(defaultSyncMode({ memoryGb: 1 })).toBe("light");
  });
  it("is Thorough on the others, and when the browser says nothing", () => {
    expect(defaultSyncMode({ cores: 8, memoryGb: 8 })).toBe("full");
    expect(defaultSyncMode({ cores: 6 })).toBe("full");
    expect(defaultSyncMode({ cores: 0 })).toBe("full");
    expect(defaultSyncMode({})).toBe("full");
  });
  it("a viewer's own pick is kept in the prefs and comes before it", () => {
    expect(parsePrefs(serializePrefs({ subtitleSyncMode: "full" })).subtitleSyncMode).toBe("full");
  });
});

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

  it("takes the release the viewer chose when the video has it, else the best-fitting one of their language", () => {
    const releases = [
      { id: 0, label: "English · Boondocks S01E10 The Itis.DVD.NonHI.cc.en.SNY", lang: "en" },
      { id: 1, label: "English (2) · The Boondocks S01E10 - Eng - HMAX WEBRIP x265 HEVC", lang: "en" },
      { id: 2, label: "English (3) · The.Boondocks.S01E10.Eng-Songs.WEB", lang: "en" },
    ];
    expect(pickTrack(releases, { lang: "en", label: "English · Boondocks S01E10 The Itis.DVD.NonHI.cc.en.SNY" })).toBe(0);
    expect(pickTrack(releases, { lang: "en", label: "English · Boondocks S01E09 The Itis.DVD.NonHI.cc.en.SNY" })).toBe(1);
    expect(pickTrack([releases[2]!], { lang: "en", label: "English" })).toBeUndefined();
  });

  it("finds nothing rather than guessing", () => {
    expect(pickTrack(tracks, { lang: "fr", label: "Français" })).toBeUndefined();
    expect(pickTrack([], { lang: "en", label: "English" })).toBeUndefined();
  });
});

describe("pickBaseSubtitleTrack", () => {
  it("picks the preferred track if present", () => {
    expect(pickBaseSubtitleTrack(tracks, { lang: "ro", label: "Română" })).toBe(1);
  });

  it("falls back to English base subtitles when preferred language is not present", () => {
    expect(pickBaseSubtitleTrack(tracks, { lang: "ja", label: "Japanese" })).toBe(0);
  });

  it("defaults base subtitles to English when no preference is set", () => {
    expect(pickBaseSubtitleTrack(tracks)).toBe(0);
  });

  it("respects explicit 'off'", () => {
    expect(pickBaseSubtitleTrack(tracks, "off")).toBe(-1);
  });

  it("turns nothing on when the film has neither the language asked for nor English: a language nobody asked for is not put on screen", () => {
    const noEn = [{ id: 5, label: "Japanese", lang: "ja" }];
    expect(pickBaseSubtitleTrack(noEn, { lang: "ro", label: "Română" })).toBeUndefined();
    expect(pickBaseSubtitleTrack(noEn)).toBeUndefined();
    expect(pickBaseSubtitleTrack([{ id: 2, label: "English (3) · The.Boondocks.S01E10.Eng-Songs.WEB", lang: "en" }])).toBeUndefined();
  });

  it("starts with the first of the profile's own languages that the film has, before English", () => {
    expect(pickBaseSubtitleTrack(tracks, undefined, { chosen: ["nl", "ro"] })).toBe(1);
    expect(pickBaseSubtitleTrack(tracks, undefined, { chosen: ["nl"] })).toBe(0);
    expect(pickBaseSubtitleTrack(tracks, { lang: "en", label: "English" }, { chosen: ["ro"] })).toBe(0);
  });

  it("does not start with English for a profile that asked for its own languages only", () => {
    expect(pickBaseSubtitleTrack(tracks, undefined, { chosen: ["nl"], only: true })).toBeUndefined();
    expect(pickBaseSubtitleTrack(tracks, undefined, { chosen: ["ro"], only: true })).toBe(1);
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
