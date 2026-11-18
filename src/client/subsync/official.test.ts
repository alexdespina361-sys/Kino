import { describe, expect, it } from "vitest";
import { offerLines, type TimedFile } from "./official";

function timed(count: number, solved: (i: number) => boolean, worded: (i: number) => boolean): TimedFile {
  const cues = Array.from({ length: count }, (_, i) => ({ start: i + 0.004, end: i + 0.8, text: `line ${i}` }));
  const indices = [...cues.keys()];
  return {
    cues,
    placed: cues.map((cue) => ({ ...cue, start: cue.start + 1.5, end: cue.end + 1.5 })),
    solved: new Set(indices.filter(solved)),
    worded: new Set(indices.filter(worded)),
  };
}

describe("offerLines: when a screen offers its timing of a file for a Kino Official subtitle", () => {
  it("offers a file placed nearly all, mostly by words: each line's start in the file and on the film, in centiseconds", () => {
    const lines = offerLines(timed(50, (i) => i !== 3, (i) => i % 4 !== 0))!;
    expect(lines).toHaveLength(50);
    expect(lines[1]).toEqual([100, 250, 330, 1]);
    expect(lines[3]).toBeNull();
    expect(lines[4]![3]).toBe(0);
  });

  it("offers nothing while too little is placed, too little of it by words, or the file is a handful of lines", () => {
    expect(offerLines(timed(50, (i) => i >= 10, () => true))).toBeUndefined();
    expect(offerLines(timed(50, () => true, (i) => i % 2 === 0))).toBeUndefined();
    expect(offerLines(timed(20, () => true, () => true))).toBeUndefined();
  });

  it("does not count a line by words unless a solve placed it", () => {
    expect(offerLines(timed(50, (i) => i < 44, () => true))).toBeUndefined();
  });
});
