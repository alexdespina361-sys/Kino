import { describe, expect, it } from "vitest";
import {
  filterDiverseSubtitles,
  inferSubtitleSource,
  computeTrackScore,
} from "./diversity";

describe("diversity subtitle cleanup", () => {
  it("infers source from url and labels correctly", () => {
    expect(inferSubtitleSource({ id: 0, label: "English", url: "/api/subtitles/ro/123.vtt" })).toBe("romanian");
    expect(inferSubtitleSource({ id: 1, label: "English", url: "/api/subtitles/fallback/sakamoto.vtt" })).toBe("tvsubtitles");
    expect(inferSubtitleSource({ id: 2, label: "English", url: "/api/subtitles/official/hash.vtt" })).toBe("official");
    expect(inferSubtitleSource({ id: 3, label: "English", url: "https://opensubtitles-v3.strem.io/sub.srt" })).toBe("opensubtitles");
    expect(inferSubtitleSource({ id: 4, label: "English", url: "https://dl.subdl.com/sub.zip" })).toBe("subdl");
    expect(inferSubtitleSource({ id: 5, label: "English", url: "https://bcdn.hakunaymatata.com/sub.vtt" })).toBe("provider");
  });

  it("limits one language from taking all slots: picks top 3 from best source + top 1 from each other", () => {
    // 6 OpenSubtitles tracks, 3 Provider tracks, 2 TVSubtitles tracks in English
    const tracks = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `os_${i}`,
        url: `https://opensubtitles/en_${i}.srt`,
        label: `English (OS ${i}) · WEB-DL`,
        lang: "en",
        source: "opensubtitles" as const,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `prov_${i}`,
        url: `https://provider/en_${i}.vtt`,
        label: `English (Official Stream ${i}) · WEB-DL`,
        lang: "en",
        source: "provider" as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `tv_${i}`,
        url: `/api/subtitles/fallback/en_${i}.vtt`,
        label: `English (TVSubtitles ${i}) · WEB-DL`,
        lang: "en",
        source: "tvsubtitles" as const,
      })),
    ];

    const result = filterDiverseSubtitles(tracks);
    // Best source (provider) should have 3 tracks
    // opensubtitles should have 1 track
    // tvsubtitles should have 1 track
    // Total for English should be 5 tracks!
    expect(result).toHaveLength(5);
    const sources = result.map((t) => inferSubtitleSource(t));
    expect(sources.filter((s) => s === "provider")).toHaveLength(3);
    expect(sources.filter((s) => s === "opensubtitles")).toHaveLength(1);
    expect(sources.filter((s) => s === "tvsubtitles")).toHaveLength(1);
  });

  it("preserves multi-language coverage across languages", () => {
    const raw = [
      // 10 English tracks
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `en_${i}`,
        url: `https://opensubtitles/en_${i}.srt`,
        label: `English ${i}`,
        lang: "en",
      })),
      // 5 Romanian tracks
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `ro_${i}`,
        url: `/api/subtitles/ro/sub_${i}.vtt`,
        label: `Romanian ${i}`,
        lang: "ro",
      })),
      // 2 Spanish tracks
      { id: "es_0", url: "https://opensubtitles/es_0.srt", label: "Spanish 0", lang: "es" },
      { id: "es_1", url: "https://opensubtitles/es_1.srt", label: "Spanish 1", lang: "es" },
      // 1 German track
      { id: "de_0", url: "https://opensubtitles/de_0.srt", label: "German", lang: "de" },
    ];

    const filtered = filterDiverseSubtitles(raw);
    const langs = filtered.map((t) => t.lang);
    // English comes first, then Romanian, then Spanish, then German
    expect(langs.slice(0, 3)).toEqual(["en", "en", "en"]);
    expect(langs.includes("ro")).toBe(true);
    expect(langs.includes("es")).toBe(true);
    expect(langs.includes("de")).toBe(true);
  });

  it("deduplicates tracks with identical URLs", () => {
    const tracks = [
      { id: 0, url: "https://example.com/sub1.vtt", label: "English 1", lang: "en" },
      { id: 1, url: "https://example.com/sub1.vtt", label: "English 1 Duplicate", lang: "en" },
    ];
    const res = filterDiverseSubtitles(tracks);
    expect(res).toHaveLength(1);
  });
});
