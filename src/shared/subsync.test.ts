import { describe, expect, it } from "vitest";
import { mergeTimings, SharedTimingSchema, SUBSYNC_MAX_LINES, SUBSYNC_MAX_MOVE, type SharedPlacement, type SharedTiming } from "./subsync";

const timing = (lines: number, ...placed: SharedPlacement[]): SharedTiming => ({ v: 1, lines, placed });

describe("SharedTimingSchema", () => {
  it("takes a timing in order and within the file", () => {
    expect(SharedTimingSchema.safeParse(timing(10, [0, 120, 130, 1], [3, -40, -40, 0], [9, 0, 0, 0])).success).toBe(true);
  });

  it("turns away what is not one", () => {
    const bad = [
      { v: 2, lines: 10, placed: [[0, 0, 0, 0]] },
      { v: 1, lines: 0, placed: [[0, 0, 0, 0]] },
      { v: 1, lines: SUBSYNC_MAX_LINES + 1, placed: [[0, 0, 0, 0]] },
      { v: 1, lines: 10, placed: [] },
      { v: 1, lines: 10, placed: [[10, 0, 0, 0]] }, // (a line the file does not have)
      { v: 1, lines: 10, placed: [[3, 0, 0, 0], [3, 5, 5, 1]] }, // (twice)
      { v: 1, lines: 10, placed: [[4, 0, 0, 0], [3, 0, 0, 0]] }, // (out of order)
      { v: 1, lines: 10, placed: [[0, SUBSYNC_MAX_MOVE * 100 + 1, 0, 0]] },
      { v: 1, lines: 10, placed: [[0, 0.5, 0, 0]] }, // (not whole centiseconds)
      { v: 1, lines: 10, placed: [[0, 0, 0, 2]] },
      { v: 1, lines: 10, placed: [[0, 0, 0]] },
      { v: 1, lines: 10, placed: [[0, 0, 0, 0]], text: "Hello" }.text,
      "nope",
      null,
    ];
    for (const each of bad) expect(SharedTimingSchema.safeParse(each).success, JSON.stringify(each)).toBe(false);
  });
});

describe("mergeTimings", () => {
  it("keeps what arrives when nothing is kept", () => {
    const arrived = timing(5, [1, 10, 10, 0]);
    expect(mergeTimings(undefined, arrived)).toBe(arrived);
  });

  it("joins the lines of both, in order", () => {
    const merged = mergeTimings(timing(9, [4, 40, 40, 1], [0, 1, 1, 0]), timing(9, [2, 20, 20, 1], [8, 80, 80, 0]));
    expect(merged?.placed.map((each) => each[0])).toEqual([0, 2, 4, 8]);
    expect(merged).toMatchObject({ v: 1, lines: 9 });
  });

  it("prefers a placement that had words to go by, and otherwise the newer one", () => {
    const kept = timing(5, [1, 10, 10, 0], [2, 20, 20, 1], [3, 30, 30, 1]);
    const arrived = timing(5, [1, 11, 11, 1], [2, 21, 21, 0], [3, 31, 31, 1]);
    expect(mergeTimings(kept, arrived)?.placed).toEqual([
      [1, 11, 11, 1], // (words beat none)
      [2, 20, 20, 1], // (none does not beat words)
      [3, 31, 31, 1], // (both had words: the newer)
    ]);
    expect(mergeTimings(timing(5, [0, 5, 5, 0]), timing(5, [0, 6, 6, 0]))?.placed).toEqual([[0, 6, 6, 0]]);
  });

  it("hands back what is kept when the arrived one has nothing to add", () => {
    const kept = timing(5, [1, 10, 10, 1], [2, 20, 20, 0]);
    expect(mergeTimings(kept, timing(5, [1, 10, 10, 1]))).toBe(kept); // (the same)
    expect(mergeTimings(kept, timing(5, [1, 99, 99, 0]))).toBe(kept); // (no words do not replace words)
    expect(mergeTimings(kept, timing(5, [2, 20, 20, 0]))).toBe(kept);
    expect(mergeTimings(kept, timing(5, [2, 21, 20, 0]))).not.toBe(kept); // (a different place for the line)
    expect(mergeTimings(kept, timing(5, [3, 30, 30, 0]))).not.toBe(kept); // (a line not yet placed)
  });

  it("will not mix timings of files with a different number of lines", () => {
    expect(mergeTimings(timing(5, [1, 10, 10, 0]), timing(6, [1, 10, 10, 0]))).toBeUndefined();
  });

  it("does not change what it was given", () => {
    const kept = timing(5, [1, 10, 10, 0]);
    const arrived = timing(5, [2, 20, 20, 0]);
    mergeTimings(kept, arrived);
    expect(kept.placed).toEqual([[1, 10, 10, 0]]);
    expect(arrived.placed).toEqual([[2, 20, 20, 0]]);
  });
});
