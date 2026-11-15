import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  decodeSubtitleBuffer,
  extractSubtitlesFromZip,
  parseSeasonAndEpisode,
} from "./unzip";

function makeZipBuffer(files: Array<{ name: string; content: string; compress?: boolean }>): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const rawData = Buffer.from(f.content, "utf8");
    const compress = f.compress !== false;
    const compData = compress ? zlib.deflateRawSync(rawData) : rawData;
    const method = compress ? 8 : 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // sig
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(method, 8); // method
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0, 12); // date
    header.writeUInt32LE(0, 14); // crc32
    header.writeUInt32LE(compData.length, 18); // compSize
    header.writeUInt32LE(rawData.length, 22); // uncompSize
    header.writeUInt16LE(nameBuf.length, 26); // nameLen
    header.writeUInt16LE(0, 28); // extraLen

    parts.push(header, nameBuf, compData);
  }

  // Add end of central directory signature
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  parts.push(eocd);

  return Buffer.concat(parts);
}

describe("unzip subtitles", () => {
  describe("parseSeasonAndEpisode", () => {
    it("parves 1x01 format", () => {
      const res = parseSeasonAndEpisode("Sakamoto Days - 1x01 - The Legendary Hit Man.WEB.NF.en.srt");
      expect(res).toEqual({ season: 1, episode: 1 });
    });

    it("parses S02E05 format", () => {
      const res = parseSeasonAndEpisode("Breaking.Bad.S02E05.720p.WEB-DL.srt");
      expect(res).toEqual({ season: 2, episode: 5 });
    });

    it("parses Season 3 Episode 12 format", () => {
      const res = parseSeasonAndEpisode("Stranger Things Season 3 Episode 12.vtt");
      expect(res).toEqual({ season: 3, episode: 12 });
    });

    it("parses episode only numbers", () => {
      const res = parseSeasonAndEpisode("Title - 25.srt");
      expect(res?.episode).toBe(25);
    });
  });

  describe("decodeSubtitleBuffer", () => {
    it("decodes standard UTF-8 text", () => {
      const buf = Buffer.from("1\n00:00:01,000 --> 00:00:04,000\nHello world!", "utf8");
      expect(decodeSubtitleBuffer(buf)).toContain("Hello world!");
    });
  });

  describe("extractSubtitlesFromZip", () => {
    it("extracts and parses srt files from zip buffer", () => {
      const zip = makeZipBuffer([
        {
          name: "Sakamoto.Days.1x01.en.srt",
          content: "1\n00:00:01,000 --> 00:00:04,000\nEpisode 1 dialogue",
          compress: true,
        },
        {
          name: "Sakamoto.Days.1x02.en.srt",
          content: "1\n00:00:01,000 --> 00:00:04,000\nEpisode 2 dialogue",
          compress: true,
        },
        {
          name: "info.txt",
          content: "Some readme text file that should be ignored",
          compress: true,
        },
        {
          name: "__MACOSX/._Sakamoto.Days.1x01.en.srt",
          content: "Apple double file metadata",
          compress: true,
        },
      ]);

      const extracted = extractSubtitlesFromZip(zip);
      expect(extracted).toHaveLength(2);
      expect(extracted[0]!.name).toBe("Sakamoto.Days.1x01.en.srt");
      expect(extracted[0]!.season).toBe(1);
      expect(extracted[0]!.episode).toBe(1);
      expect(extracted[0]!.text).toContain("Episode 1 dialogue");

      expect(extracted[1]!.name).toBe("Sakamoto.Days.1x02.en.srt");
      expect(extracted[1]!.season).toBe(1);
      expect(extracted[1]!.episode).toBe(2);
      expect(extracted[1]!.text).toContain("Episode 2 dialogue");
    });
  });
});
