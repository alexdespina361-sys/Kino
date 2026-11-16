import { describe, expect, it } from "vitest";
import { believableSkipTimes, mergeSkipTimes, skipTimesOf } from "./skip";

describe("skip times", () => {
  it("are read from what a source wrote, each part on its own, and never trusted as they are", () => {
    expect(skipTimesOf({ intro: { start: 85.004, end: 175.996 } })).toEqual({ intro: { start: 85, end: 176 } });
    expect(skipTimesOf({ intro: { start: 0, end: 0 }, outro: { start: 1300, end: 1390 } })).toEqual({ outro: { start: 1300, end: 1390 } }); // (0-0 is a source's "none")
    expect(skipTimesOf({ intro: { start: "85", end: 175 } })).toBeUndefined();
    expect(skipTimesOf({ intro: { start: Number.NaN, end: 175 } })).toBeUndefined();
    expect(skipTimesOf({ intro: { start: -1, end: 175 } })).toBeUndefined();
    expect(skipTimesOf({ intro: { start: 10, end: 90_000 } })).toBeUndefined();
    expect(skipTimesOf({ ending: { start: 10, end: 90 } })).toBeUndefined();
    expect(skipTimesOf(null)).toBeUndefined();
    expect(skipTimesOf("intro")).toBeUndefined();
  });

  it("from two places: the first one's time of each part, the second one's where the first has none", () => {
    const own = { intro: { start: 80, end: 170 } };
    const aniSkip = { intro: { start: 90, end: 180 }, outro: { start: 1300, end: 1390 } };
    expect(mergeSkipTimes(own, aniSkip)).toEqual({ intro: { start: 80, end: 170 }, outro: { start: 1300, end: 1390 } });
    expect(mergeSkipTimes(undefined, aniSkip)).toEqual(aniSkip);
    expect(mergeSkipTimes(undefined, undefined)).toBeUndefined();
  });

  it("are kept only where such a part is, and lasts what such a part lasts, for a video of this length", () => {
    const length = 1420;
    expect(believableSkipTimes({ intro: { start: 85, end: 175 }, outro: { start: 1300, end: 1390 } }, length)).toEqual({ intro: { start: 85, end: 175 }, outro: { start: 1300, end: 1390 } });
    expect(believableSkipTimes({ intro: { start: 85, end: 90 } }, length)).toBeUndefined(); // five seconds is no opening
    expect(believableSkipTimes({ intro: { start: 85, end: 400 } }, length)).toBeUndefined(); // five minutes is no opening either
    expect(believableSkipTimes({ intro: { start: 900, end: 990 } }, length)).toBeUndefined(); // an opening in the second half is not one
    expect(believableSkipTimes({ outro: { start: 300, end: 390 } }, length)).toBeUndefined(); // nor credits in the first
    expect(believableSkipTimes({ recap: { start: 600, end: 640 } }, length)).toBeUndefined(); // a "previously on" comes near the start
    expect(believableSkipTimes({ intro: { start: 85, end: 175 } }, 100)).toBeUndefined(); // a short video has nothing to skip
  });

  it("are another cut's when they end past the video, and are cut at its end when they end a second or two after it", () => {
    expect(believableSkipTimes({ outro: { start: 1330, end: 1421.5 } }, 1420)).toEqual({ outro: { start: 1330, end: 1420 } });
    expect(believableSkipTimes({ outro: { start: 1400, end: 1490 } }, 1420)).toBeUndefined();
  });

  it("leave out a \"previously on\" that runs into the opening (one of the two is wrong, and the opening is the one people send)", () => {
    expect(believableSkipTimes({ recap: { start: 0, end: 100 }, intro: { start: 85, end: 175 } }, 1420)).toEqual({ intro: { start: 85, end: 175 } });
    expect(believableSkipTimes({ recap: { start: 0, end: 60 }, intro: { start: 85, end: 175 } }, 1420)).toEqual({ recap: { start: 0, end: 60 }, intro: { start: 85, end: 175 } });
  });
});
