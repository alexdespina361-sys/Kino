import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  decodeSubtitleBytes,
  extractSrtFromZip,
  matchesEpisode,
  normalizeRomanianText,
  RomanianSubtitleManager,
  srtToVtt,
} from "./romanian";

describe("Romanian subtitle processing", () => {
  it("normalizes legacy Romanian cedillas to modern comma-below diacritics", () => {
    const legacy = "A fost odată ca niciodată, o poveste cu şoareci şi ţăran.";
    const normalized = normalizeRomanianText(legacy);
    expect(normalized).toBe("A fost odată ca niciodată, o poveste cu șoareci și țăran.");
  });

  it("decodes UTF-8 and Windows-1250 encoded subtitle bytes accurately", () => {
    const text = "Ne vedem mâine la ora cinci.";
    const utf8Buf = Buffer.from(text, "utf8");
    expect(decodeSubtitleBytes(utf8Buf)).toBe(text);

    // CP1250 encoding test
    // "mâine": 'm' (0x6D), 'â' in CP1250 is 0xE2, 'i' (0x69), 'n' (0x6E), 'e' (0x65)
    // "și": 'ș' in CP1250 is 0xBA (or 0xAA)
    const cp1250Bytes = Buffer.from([0x6D, 0xE2, 0x69, 0x6E, 0x65, 0x20, 0xBA, 0x69, 0x20, 0xFE, 0x61, 0x72, 0x61]);
    const decoded = decodeSubtitleBytes(cp1250Bytes);
    expect(decoded).toContain("mâine");
    expect(decoded).toContain("și");
  });

  it("converts SRT to standard WebVTT", () => {
    const srt = `1\n00:01:27,379 --> 00:01:28,672\nNe vedem mâine.\n\n2\n00:01:48,525 --> 00:01:49,651\nDoamne!`;
    const vtt = srtToVtt(srt);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:01:27.379 --> 00:01:28.672");
    expect(vtt).toContain("Ne vedem mâine.");
  });

  it("extracts .srt files from a zip archive", () => {
    // Create a mini zip buffer in memory with one compressed .srt file
    const srtContent = "1\n00:00:10,000 --> 00:00:12,000\nSalut!";
    const deflated = zlib.deflateRawSync(Buffer.from(srtContent, "utf8"));
    const filename = "test.srt";
    const fnBuf = Buffer.from(filename, "utf8");

    // Construct local file header
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // general purpose bit flag
    header.writeUInt16LE(8, 8); // compression method (deflate)
    header.writeUInt16LE(0, 10); // file mod time
    header.writeUInt16LE(0, 12); // file mod date
    header.writeUInt32LE(0, 14); // crc-32 (ignored in raw extraction)
    header.writeUInt32LE(deflated.length, 18); // compressed size
    header.writeUInt32LE(Buffer.byteLength(srtContent), 22); // uncompressed size
    header.writeUInt16LE(fnBuf.length, 26); // file name length
    header.writeUInt16LE(0, 28); // extra field length

    const zip = Buffer.concat([header, fnBuf, deflated]);
    const extracted = extractSrtFromZip(zip);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.name).toBe("test.srt");
    expect(extracted[0]?.content).toContain("Salut!");
  });

  it("matches season and episode variations in release filenames", () => {
    expect(matchesEpisode("Loki.S01E01.1080p.WEB-DL.srt", 1, 1)).toBe(true);
    expect(matchesEpisode("Loki.1x01.Glorious.Purpose.srt", 1, 1)).toBe(true);
    expect(matchesEpisode("Breaking.Bad.Season.1.Episode.1.Pilot.srt", 1, 1)).toBe(true);
    expect(matchesEpisode("Loki.S01E02.Variant.srt", 1, 1)).toBe(false);
    expect(matchesEpisode("Loki.S02E01.srt", 1, 1)).toBe(false);
  });

  it("stores and retrieves subtitles in RomanianSubtitleManager", async () => {
    // (No site is asked in a test: a manager without a `get` of the test's own would reach the real ones.)
    const manager = new RomanianSubtitleManager(undefined, async () => {
      throw new Error("no site is asked in this test");
    });
    // Simulate cached entry
    const sub = {
      id: "test_sub_1",
      label: "Romanian · Test Release",
      vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTest",
      source: "subs.ro" as const,
    };
    (manager as unknown as { cache: Map<string, typeof sub[]> }).cache.set("tt9999999:1:1", [sub]);
    (manager as unknown as { subtitleById: Map<string, string> }).subtitleById.set(sub.id, sub.vtt);

    const tracks = await manager.getSubtitles({ imdbId: "tt9999999", season: 1, episode: 1 });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.url).toBe("/api/subtitles/ro/test_sub_1.vtt");
    expect(tracks[0]?.lang).toBe("ron");

    const vtt = manager.getVtt("test_sub_1");
    expect(vtt).toBe(sub.vtt);
  });
});
