import { describe, expect, it } from "vitest";
import { parseVtt, toVtt } from "./vtt";

describe("parseVtt: a file read the way a browser reads it", () => {
  it("reads cues with and without a name, any line ending, and their markup", () => {
    const file = "﻿WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.500\r\n<i>Line one</i>\r\nsecond row\r\n\r\n00:01.000 --> 00:03.000 align:start\nNo name\n\n";
    expect(parseVtt(file)).toEqual([
      { start: 1, end: 2.5, text: "<i>Line one</i>\nsecond row" },
      { start: 1, end: 3, text: "No name" },
    ]);
  });

  it("leaves out what a browser leaves out: notes, styles, a header, a cue whose times are written wrong", () => {
    const file = [
      "WEBVTT - a title",
      "Kind: captions",
      "",
      "NOTE nothing to show",
      "",
      "STYLE",
      "::cue { color: red }",
      "",
      "00:00:01,500 --> 00:00:02.000",
      "comma time",
      "",
      "00:00:03.5 --> 00:00:04.000",
      "short time",
      "",
      "00:00:05.000 --> 00:00:06.000",
      "kept",
    ].join("\n");
    expect(parseVtt(file)).toEqual([{ start: 5, end: 6, text: "kept" }]);
  });

  it("is nothing for a file that does not start as WebVTT", () => {
    expect(parseVtt("1\n00:00:01,000 --> 00:00:02,000\nan SRT\n")).toEqual([]);
  });

  it("ends a cue's text at a line with an arrow in it, as a browser does", () => {
    expect(parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nfirst\n00:00:03.000 --> 00:00:04.000\nsecond\n")).toEqual([{ start: 1, end: 2, text: "first" }]);
  });
});

describe("toVtt", () => {
  it("writes what parseVtt reads back the same", () => {
    const cues = [
      { start: 0.5, end: 1.75, text: "- Hello\n- Hi" },
      { start: 3725.01, end: 3727, text: "<i>An hour on</i>" },
    ];
    expect(parseVtt(toVtt(cues, "a note"))).toEqual(cues);
  });

  it("never writes a line that would end a cue early", () => {
    const written = toVtt([{ start: 1, end: 2, text: "a --> b\n\n   \nc" }, { start: 3, end: 4, text: "  " }]);
    expect(parseVtt(written)).toEqual([{ start: 1, end: 2, text: "a -> b\nc" }]);
  });
});
