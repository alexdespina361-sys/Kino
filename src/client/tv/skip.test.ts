import { describe, expect, it } from "vitest";
import { creditsRunToEnd, nextButtonFrom, segmentAt } from "./skip";

const LENGTH = 1420;
const TIMES = { recap: { start: 0, end: 60 }, intro: { start: 85, end: 175 }, outro: { start: 1330, end: 1410 } };

describe("the Skip button", () => {
  it("is up while the picture is in a part, and names it", () => {
    expect(segmentAt(TIMES, 10, LENGTH, false)).toMatchObject({ kind: "recap", start: 0, end: 60 });
    expect(segmentAt(TIMES, 85, LENGTH, false)).toMatchObject({ kind: "intro", start: 85, end: 175, key: "intro:85" });
    expect(segmentAt(TIMES, 1340, LENGTH, false)).toMatchObject({ kind: "credits", start: 1330, end: 1410 });
    expect(segmentAt(TIMES, 70, LENGTH, false)).toBeNull(); // between the "previously on" and the opening
    expect(segmentAt(TIMES, 84.9, LENGTH, false)).toBeNull();
    expect(segmentAt(TIMES, 174.6, LENGTH, false)).toBeNull(); // (not in its last half second: a button that comes and goes at once is a flicker)
    expect(segmentAt(undefined, 100, LENGTH, false)).toBeNull();
    expect(segmentAt(TIMES, 100, 0, false)).toBeNull(); // a length not known yet
  });

  it("leaves credits that run to the end of an episode to the Next episode button, when there is a next episode", () => {
    expect(creditsRunToEnd(TIMES, LENGTH)).toBe(true); // they end ten seconds before the end
    expect(segmentAt(TIMES, 1340, LENGTH, true)).toBeNull();
    expect(segmentAt(TIMES, 100, LENGTH, true)).toMatchObject({ kind: "intro" }); // (the opening is still the Skip button's)
    // Credits with a while after them (a scene, the next one's preview) are skipped to that, and Next episode comes at the end.
    const early = { outro: { start: 1250, end: 1340 } };
    expect(creditsRunToEnd(early, LENGTH)).toBe(false);
    expect(segmentAt(early, 1260, LENGTH, true)).toMatchObject({ kind: "credits", end: 1340 });
  });
});

describe("the Next episode button", () => {
  it("comes as the credits start when they run to the end, and in the last seconds otherwise", () => {
    expect(nextButtonFrom(TIMES, LENGTH, 15)).toBe(1330);
    expect(nextButtonFrom({ outro: { start: 1250, end: 1340 } }, LENGTH, 15)).toBe(LENGTH - 15);
    expect(nextButtonFrom(undefined, LENGTH, 15)).toBe(LENGTH - 15);
    expect(nextButtonFrom({ outro: { start: 1410, end: 1420 } }, LENGTH, 15)).toBe(LENGTH - 15); // (credits that start in the last seconds: never later than those)
  });
});
