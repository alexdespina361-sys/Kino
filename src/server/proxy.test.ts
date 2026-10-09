import { describe, expect, it } from "vitest";
import { rewriteM3u8, srtToVtt } from "./proxy";

describe("rewriteM3u8", () => {
  it("rewrites segment URLs relative to the playlist URL", () => {
    const input = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:10",
      "#EXTINF:10.0,",
      "segment1.ts",
      "#EXTINF:10.0,",
      "http://cdn.example/segment2.ts",
    ].join("\n");

    const result = rewriteM3u8(input, "https://media.example/stream/master.m3u8", "https://site.example");

    expect(result).toContain("/api/proxy?url=https%3A%2F%2Fmedia.example%2Fstream%2Fsegment1.ts&referer=https%3A%2F%2Fsite.example");
    expect(result).toContain("/api/proxy?url=http%3A%2F%2Fcdn.example%2Fsegment2.ts&referer=https%3A%2F%2Fsite.example");
  });

  it("rewrites URI in #EXT-X-KEY tags", () => {
    const input = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.php?id=1"',
      "#EXTINF:5.0,",
      "chunk0.ts",
    ].join("\n");

    const result = rewriteM3u8(input, "https://media.example/hls/list.m3u8");
    expect(result).toContain('URI="/api/proxy?url=https%3A%2F%2Fmedia.example%2Fhls%2Fkey.php%3Fid%3D1"');
    expect(result).toContain("/api/proxy?url=https%3A%2F%2Fmedia.example%2Fhls%2Fchunk0.ts");
  });
});

describe("srtToVtt", () => {
  it("converts srt timestamp format to vtt", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello");
  });

  it("preserves already valid vtt content", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello";
    expect(srtToVtt(vtt)).toBe(vtt);
  });
});

