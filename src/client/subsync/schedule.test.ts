import { describe, expect, it } from "vitest";
import { nextWindow, rest, WINDOW } from "./schedule";

const plan = { playhead: 0, rate: 1, covered: [{ from: 0, to: 120 }], heard: [], speed: 5 };

describe("the next window for the recogniser", () => {
  it("starts with the window the picture is in", () => {
    expect(nextWindow({ ...plan, playhead: 20 })).toBe(15);
  });

  it("goes on to the next unheard window, in order", () => {
    expect(nextWindow({ ...plan, playhead: 20, heard: [{ from: 15, to: 45 }] })).toBe(45);
  });

  it("needs sound for all of the window", () => {
    expect(nextWindow({ ...plan, covered: [{ from: 0, to: 40 }] })).toBe(0);
    expect(nextWindow({ ...plan, covered: [{ from: 0, to: 40 }], heard: [{ from: 0, to: 30 }] })).toBeUndefined();
  });

  it("leaves out a window that cannot be done before the picture is past it (a slow device)", () => {
    // 15 s of sound at a speed of 0.5 takes 30 s: the windows ending 10 s and 25 s ahead of the picture are too soon, the one ending 40 s ahead is not
    expect(nextWindow({ ...plan, playhead: 20, speed: 0.5 })).toBe(45);
  });

  it("counts a fast-forward in", () => {
    expect(nextWindow({ ...plan, playhead: 5, rate: 4, speed: 2 })).toBe(30);
  });

  it("finds the sound that is after a jump", () => {
    expect(nextWindow({ ...plan, playhead: 500, covered: [{ from: 0, to: 120 }, { from: 495, to: 540 }] })).toBe(495);
  });

  it("has nothing to do once everything ahead is heard", () => {
    expect(nextWindow({ ...plan, heard: [{ from: 0, to: 120 }] })).toBeUndefined();
    expect(WINDOW).toBe(15);
  });
});

describe("the rest between windows", () => {
  it("is as long as the work when half the time is the recogniser's", () => {
    expect(rest(2000, 0.5)).toBe(2000);
    expect(rest(2000, 1)).toBe(0);
    expect(rest(2000, 0.25)).toBe(6000);
  });
});
