import { describe, expect, it } from "vitest";
import { LIVE_BEHIND, nextWindow, rest, WINDOW } from "./schedule";

const plan = { playhead: 0, rate: 1, covered: [{ from: 0, to: 120 }], heard: [], speed: 5 };

describe("the next window for the recogniser, when the sound comes as the film plays", () => {
  const live = { playhead: 47, rate: 1, covered: [{ from: 0, to: 46.8 }], heard: [], speed: 0.5, live: true };

  it("is the newest whole window behind the picture, however slow the device", () => {
    expect(nextWindow(live)).toBe(30);
  });

  it("goes back to the ones not heard, as far as it may", () => {
    expect(nextWindow({ ...live, heard: [{ from: 30, to: 45 }] })).toBe(15);
    expect(nextWindow({ ...live, playhead: 200, covered: [{ from: 0, to: 199 }], heard: [{ from: 135, to: 195 }] })).toBe(180 - LIVE_BEHIND * WINDOW);
    expect(nextWindow({ ...live, playhead: 200, covered: [{ from: 0, to: 199 }], heard: [{ from: 120, to: 195 }] })).toBeUndefined();
  });

  it("waits for a whole window, and for its sound all through", () => {
    expect(nextWindow({ ...live, playhead: 14, covered: [{ from: 0, to: 13.9 }] })).toBeUndefined();
    expect(nextWindow({ ...live, covered: [{ from: 0, to: 35 }, { from: 36, to: 46.8 }] })).toBe(15);
  });

  it("after a jump, takes the sound around the picture", () => {
    expect(nextWindow({ ...live, playhead: 500, covered: [{ from: 0, to: 120 }, { from: 470, to: 499.5 }] })).toBe(480);
  });

  it("in the light way, is the newest whole window of those on the grid (one in `every`)", () => {
    expect(nextWindow({ ...live, every: 3 })).toBe(0);
    expect(nextWindow({ ...live, playhead: 200, covered: [{ from: 0, to: 199 }], every: 3 })).toBe(180);
    expect(nextWindow({ ...live, playhead: 200, covered: [{ from: 0, to: 199 }], heard: [{ from: 180, to: 195 }], every: 3 })).toBe(135);
  });
});

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
    expect(nextWindow({ ...plan, playhead: 20, speed: 0.5 })).toBe(45);
  });

  it("counts a fast-forward in", () => {
    expect(nextWindow({ ...plan, playhead: 5, rate: 4, speed: 2 })).toBe(30);
  });

  it("finds the sound that is after a jump", () => {
    expect(nextWindow({ ...plan, playhead: 500, covered: [{ from: 0, to: 120 }, { from: 495, to: 540 }] })).toBe(495);
  });

  it("in the light way, hears one window in `every`, on the grid", () => {
    expect(nextWindow({ ...plan, playhead: 20, every: 3 })).toBe(45);
    expect(nextWindow({ ...plan, playhead: 20, every: 3, heard: [{ from: 45, to: 60 }] })).toBe(90);
    expect(nextWindow({ ...plan, playhead: 20, every: 1 })).toBe(15);
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
