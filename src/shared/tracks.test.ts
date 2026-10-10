import { describe, expect, it } from "vitest";
import { groupOf, groupTracks, orderGroups, preferredLanguages, versionLabel } from "./tracks";

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
