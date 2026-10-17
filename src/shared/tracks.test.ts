import { describe, expect, it } from "vitest";
import { byRelease, defaultTrack, groupOf, groupTracks, orderGroups, preferredLanguages, releaseRank, versionLabel } from "./tracks";

const track = (id: number, label: string, lang?: string) => ({ id, label, ...(lang ? { lang } : {}) });

describe("preferredLanguages", () => {
  it("starts from the site's language, then English, Romanian and Italian, each once", () => {
    expect(preferredLanguages(undefined, "en")).toEqual(["en", "ro", "it"]);
    expect(preferredLanguages(undefined, "ro")).toEqual(["ro", "en", "it"]);
    expect(preferredLanguages([], "it")).toEqual(["it", "en", "ro"]);
  });

  it("is the person's own list, in their order, when they made one", () => {
    expect(preferredLanguages(["fr", "de", "fr"], "en")).toEqual(["fr", "de"]);
    expect(preferredLanguages(["eng", "ron"], "it")).toEqual(["en", "ro"]); // however a code is spelled
  });
});

describe("orderGroups", () => {
  const groups = groupTracks([track(0, "Deutsch", "de"), track(1, "English", "en"), track(2, "Italiano", "it"), track(3, "Magyar", "hu"), track(4, "Română", "ro")]);
  const keys = (list: { key: string }[]) => list.map((group) => group.key);

  it("puts the preferred languages first in their order, and the rest after in the video's order", () => {
    const { pinned, more } = orderGroups(groups, ["en", "ro", "it"]);
    expect(keys(pinned)).toEqual(["en", "ro", "it"]);
    expect(keys(more)).toEqual(["de", "hu"]);
  });

  it("leaves out a preferred language the video has no subtitles in", () => {
    const { pinned, more } = orderGroups(groups, ["fr", "hu", "en"]);
    expect(keys(pinned)).toEqual(["hu", "en"]);
    expect(keys(more)).toEqual(["de", "it", "ro"]);
  });

  it("with `only`, shows nothing but the preferred ones", () => {
    const { pinned, more } = orderGroups(groups, ["ro", "en"], true);
    expect(keys(pinned)).toEqual(["ro", "en"]);
    expect(more).toEqual([]);
  });

  it("with `only`, still shows the language that is on now", () => {
    const { pinned, more } = orderGroups(groups, ["ro", "en"], true, "de");
    expect(keys(pinned)).toEqual(["ro", "en"]);
    expect(keys(more)).toEqual(["de"]);
  });

  it("with `only`, still shows everything when none of the preferred languages is there", () => {
    const { pinned, more } = orderGroups(groups, ["fr"], true);
    expect(pinned).toEqual([]);
    expect(keys(more)).toEqual(["de", "en", "it", "hu", "ro"]);
  });
});

describe("groupTracks", () => {
  it("groups by language in the order languages first appear, whatever spelling the codes have", () => {
    const groups = groupTracks([track(0, "English", "en"), track(1, "Romanian", "ron"), track(2, "English (2)", "eng"), track(3, "Ro 2", "ro")]);
    expect(groups.map((group) => [group.key, group.name, group.tracks.map((t) => t.id)])).toEqual([
      ["en", "English", [0, 2]],
      ["ro", "Romanian", [1, 3]],
    ]);
  });

  it("puts tracks that name no language together as Other, and names codes it cannot translate", () => {
    const groups = groupTracks([track(0, "Commentary"), track(1, "Forced"), track(2, "Mystery", "xx")]);
    expect(groups.map((group) => [group.key, group.name])).toEqual([
      ["und", "Other"],
      ["xx", "XX"],
    ]);
    expect(groups[0]!.tracks).toHaveLength(2);
  });

  it("names the languages in the language of the reader", () => {
    const groups = groupTracks([track(0, "English", "en"), track(1, "Romanian", "ro"), track(2, "Mystery")], "ro", "Altele");
    expect(groups.map((group) => group.name)).toEqual(["Engleză", "Română", "Altele"]);
  });

  it("is empty for no tracks", () => {
    expect(groupTracks([])).toEqual([]);
  });
});

describe("versionLabel", () => {
  it("drops the language and the file extension from a release name", () => {
    expect(versionLabel(track(0, "English · The.Film.2023.1080p.WEB-DL.srt"), "English", 0)).toBe("The.Film.2023.1080p.WEB-DL");
    expect(versionLabel(track(1, "English (2) · Other.Release.vtt"), "English", 1)).toBe("Other.Release");
  });

  it("falls back to a number when nothing is left", () => {
    expect(versionLabel(track(0, "English"), "English", 0)).toBe("Version 1");
    expect(versionLabel(track(2, "English (3)"), "English", 2)).toBe("Version 3");
  });

  it("takes the language off however it is written, and names a bare release in the reader's words", () => {
    expect(versionLabel(track(0, "Engleză · Film.2023.srt"), ["Engleză", "English"], 0)).toBe("Film.2023");
    expect(versionLabel(track(0, "English · Film.2023.srt"), ["Engleză", "English"], 0)).toBe("Film.2023");
    expect(versionLabel(track(1, "English"), ["Engleză", "English"], 1, "Varianta 2")).toBe("Varianta 2");
  });

  it("keeps a label that is about something else", () => {
    expect(versionLabel(track(0, "Forced"), "English", 0)).toBe("Forced");
    expect(versionLabel(track(0, "English (SDH)"), "English", 0)).toBe("(SDH)");
  });
});

describe("groupOf", () => {
  it("finds the group of a track, and nothing for Off or an unknown track", () => {
    const groups = groupTracks([track(0, "English", "en"), track(1, "Romanian", "ro")]);
    expect(groupOf(groups, 1)?.key).toBe("ro");
    expect(groupOf(groups, -1)).toBeUndefined();
    expect(groupOf(groups, undefined)).toBeUndefined();
  });
});

describe("releaseRank", () => {
  // Real labels, as the site's resolver gave them for The Bad Guys and The Boondocks (the subtitle lab's pick test).
  const rank = (labels: string[]) => labels.map(releaseRank);

  it("puts WEB releases first, however their name says it", () => {
    expect(
      rank([
        "English (6) · The Boondocks S01E01 - Eng - HMAX WEBRIP x265 HEVC",
        "English (3) · The.Bad.Guys.2022.720p.AMZN.WEBRip.800MB.x264-GalaxyRG",
        "English (7) · The Boondocks (2005) - S01E01 - The Garden Party (1080p HMAX WEB-DL x265 YOGI)",
        "English (9) · The.Bad.Guys.2022.NORDiC.1080p.WEB.H.264-NiDHUG.en",
        "English (4) · The.Boondocks.S01E01.1080p.WEB.H264-BLACKHAT[eztv.io]_track3_[eng]",
        "English (4) · The Boondocks - S02E03 (2005) WEB.eng",
        "Film.2023.1080p.NF.WEBDL",
        "Film.2023.DSNP",
        "Film.2023.ATVP",
        "Film.2023.hulu",
      ]),
    ).toEqual(Array(10).fill(0));
  });

  it("then BluRay, then DVD, then everything else", () => {
    expect(releaseRank("English (5) · The.Bad.Guys.2022.BDRip.x264-KNiVES [NON-HI]")).toBe(1);
    expect(releaseRank("Film.2023.1080p.BluRay.x264")).toBe(1);
    expect(releaseRank("Film.2023.Blu-ray.BDRemux")).toBe(1);
    expect(releaseRank("English · Boondocks S01E10 The Itis.DVD.NonHI.cc.en.SNY")).toBe(2);
    expect(releaseRank("English (3) · The.Boondocks.S01E10.The.Itis.DVDRip.XviD-TOPAZ.English")).toBe(2);
    expect(releaseRank("English · The.Bad.Guys.2022.HDRip.XviD.AC3-EVO")).toBe(3);
    expect(releaseRank("English (8) · THE-BAD-GUYS-2022-ENGCP")).toBe(3);
    expect(releaseRank("Film.2023.CAM")).toBe(3);
    expect(releaseRank("English")).toBe(3);
  });

  it("does not take a WEB or a DVD that is part of another word", () => {
    expect(releaseRank("Film.Webster.2023")).toBe(3);
    expect(releaseRank("Film.2023.Info.SNF")).toBe(3);
    expect(releaseRank("Film.2023.AMZNx")).toBe(3);
    expect(releaseRank("Film.2023.SDVD")).toBe(3);
  });

  it("puts a track of only the songs or only the forced lines last, whatever its release", () => {
    expect(releaseRank("English (7) · The Bad Guys.2022.BDRemux.1080p.3D-MVC.Eng-Songs")).toBe(4);
    expect(releaseRank("Film.2023.WEB-DL.Forced")).toBe(4);
    expect(releaseRank("English (FORCED)")).toBe(4);
  });
});

describe("byRelease", () => {
  it("orders by kind of release and keeps the order within a kind", () => {
    const tracks = [
      track(0, "English · The.Bad.Guys.2022.HDRip.XviD.AC3-EVO"),
      track(1, "English (2) · The.Bad.Guys.2022.HDRip.XviD.AC3-EVO-HI"),
      track(2, "English (3) · The.Bad.Guys.2022.720p.AMZN.WEBRip.800MB.x264-GalaxyRG"),
      track(3, "English (4) · The.Bad.Guys.2022.720p.AMZN.WEBRip.800MB.x264-GalaxyRG-HI"),
      track(4, "English (5) · The.Bad.Guys.2022.BDRip.x264-KNiVES [NON-HI]"),
      track(5, "English (6) · The.Bad.Guys.2022.BDRip.x264-KNiVES [HI]"),
      track(6, "English (7) · The Bad Guys.2022.BDRemux.1080p.3D-MVC.Eng-Songs"),
      track(7, "English (8) · THE-BAD-GUYS-2022-ENGCP"),
      track(8, "English (9) · The.Bad.Guys.2022.NORDiC.1080p.WEB.H.264-NiDHUG.en"),
      track(9, "English (10) · The.Bad.Guys.2022.BDRip.x264-KNiVES"),
      track(10, "English (11) · The.Bad.Guys.2022.DVDRip"),
    ];
    expect(byRelease(tracks).map((t) => t.id)).toEqual([2, 3, 8, 4, 5, 9, 10, 0, 1, 7, 6]);
    expect(tracks.map((t) => t.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // (a new list: the one given is left as it was)
  });
});

describe("defaultTrack", () => {
  it("is the best-fitting release, not the first listed", () => {
    const boondocks = [
      track(0, "English · Boondocks S01E10 The Itis.DVD.NonHI.cc.en.SNY"),
      track(1, "English (2) · Boondocks S01E10 The Itis.DVD.HI.cc.en.SNY"),
      track(2, "English (3) · The.Boondocks.S01E10.The.Itis.DVDRip.XviD-TOPAZ.English"),
      track(3, "English (4) · The Boondocks S01E10 - Eng - HMAX WEBRIP x265 HEVC"),
      track(4, "English (5) · The Boondocks (2005) - S01E10 - The Itis (1080p HMAX WEB-DL x265 YOGI)"),
    ];
    expect(defaultTrack(boondocks)?.id).toBe(3);
    expect(defaultTrack([track(0, "English"), track(1, "English (2)")])?.id).toBe(0); // (names that say nothing: the first, as before)
  });

  it("is never a track of only the songs or the forced lines", () => {
    expect(defaultTrack([track(0, "Film.2023.WEB.Forced"), track(1, "Film.2023.HDRip")])?.id).toBe(1);
    expect(defaultTrack([track(0, "English (7) · The Bad Guys.2022.BDRemux.1080p.3D-MVC.Eng-Songs")])).toBeUndefined();
    expect(defaultTrack([])).toBeUndefined();
  });
});
