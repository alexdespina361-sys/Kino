import { describe, expect, it } from "vitest";
import { Cadence, HELD_FRAMES, VideoClock, boostDelay, boostPhase, gridJobs, gridMoment, gridRate, refreshRate, type HeldFrame } from "./boostTiming";

/**
 * A video of `fps` frames a second played on a screen of `hz`: each frame comes at the first refresh at or after its moment (as a browser shows them), and
 * at each refresh the boost picks what to show. Gives, for each refresh after the first second, the moment of the video it showed (or NaN for none).
 */
function play(fps: number, hz: number, outFps: number, seconds = 5, start = 0.137): { shown: number[]; drawn: boolean[]; between: boolean[] } {
  const clock = new VideoClock();
  const cadence = new Cadence();
  const frames: HeldFrame[] = [];
  let next = 0;
  const shown: number[] = [];
  const drawn: boolean[] = [];
  const between: boolean[] = [];
  const vsync = 1000 / hz;
  for (let refresh = 0; refresh * vsync < seconds * 1000; refresh++) {
    const now = 5000 + refresh * vsync + start; // (the page's clock does not start at 0)
    // The video's frames whose moment has come (the video started at the page's 5000 ms).
    while (5000 + (next / fps) * 1000 <= now) {
      const frame = { mediaTime: next / fps, arrived: now };
      clock.add(frame);
      frames.push(frame);
      if (frames.length > HELD_FRAMES) frames.shift();
      next++;
    }
    if (frames.length === 0) continue;
    const phase = boostPhase(frames, clock.at(now) - boostDelay(clock.frameTime(), hz), outFps);
    const tick = cadence.tick(now, outFps, hz);
    if (now < 7000) continue; // (the clock settles in its first two seconds)
    drawn.push(tick);
    between.push(phase.between);
    const [from, to] = [frames[phase.from]!, frames[phase.to]!];
    shown.push(from.mediaTime + phase.t * (to.mediaTime - from.mediaTime));
  }
  return { shown, drawn, between };
}

/** The steps between the moments shown on the refreshes that drew a new frame. */
const stepsOf = (run: ReturnType<typeof play>): number[] => {
  const moments = run.shown.filter((_, index) => run.drawn[index]);
  return moments.slice(1).map((moment, index) => moment - moments[index]!);
};

describe("the frame boost's timing", () => {
  it("24 fps on a 60 Hz screen at 60: a new frame at every refresh, each 1/60 s of the video after the one before (the video's own 2-3 cadence gone)", () => {
    const run = play(24, 60, 60);
    expect(run.between.every(Boolean)).toBe(true);
    expect(run.drawn.every(Boolean)).toBe(true);
    for (const step of stepsOf(run)) expect(step).toBeCloseTo(1 / 60, 4);
  });

  it("24 fps at 30 on a 60 Hz screen: every other refresh, each 1/30 s after the one before", () => {
    const run = play(24, 60, 30);
    const drawn = run.drawn.filter(Boolean).length;
    expect(drawn / (run.drawn.length / 60)).toBeCloseTo(30, 0);
    for (const step of stepsOf(run)) expect(step).toBeCloseTo(1 / 30, 4);
  });

  it("30 and 25 fps at 60 are smooth too; the boost never runs out of frames (it is late enough)", () => {
    for (const fps of [30, 25]) {
      const run = play(fps, 60, 60);
      expect(run.between.every(Boolean)).toBe(true);
      for (const step of stepsOf(run)) expect(step).toBeCloseTo(1 / 60, 4);
    }
  });

  it("23.976 fps (whose frames come 0 to 8 ms late in a slow cycle) stays within half a millisecond of even, over 20 seconds", () => {
    const run = play(24000 / 1001, 60, 60, 22);
    expect(run.between.every(Boolean)).toBe(true);
    for (const step of stepsOf(run)) expect(Math.abs(step - 1 / 60)).toBeLessThan(0.0005);
  });

  it("60 fps on a 144 Hz screen: 60 new frames a second (2 and 3 refreshes in turn), each at the moment of the refresh that shows it", () => {
    const run = play(24, 144, 60, 6);
    const seconds = run.drawn.length / 144;
    expect(run.drawn.filter(Boolean).length / seconds).toBeCloseTo(60, 0);
    for (const step of stepsOf(run)) expect([2 / 144, 3 / 144].some((each) => Math.abs(step - each) < 1e-4)).toBe(true);
  });

  it("a video that already has the frames (60 fps at 60, or 30 at 30) is shown as it is", () => {
    expect(play(60, 60, 60).between.some(Boolean)).toBe(false);
    expect(play(30, 60, 30).between.some(Boolean)).toBe(false);
  });

  it("makes nothing across a seek, a loop or a stall, and starts the clock again from the frame after one", () => {
    const older = { mediaTime: 10, arrived: 1000 };
    const held = { from: 0, to: 1, t: 1, between: false };
    expect(boostPhase([older, { mediaTime: 4, arrived: 1042 }], 9.99, 60)).toEqual(held); // (back: a loop or a seek)
    expect(boostPhase([older, { mediaTime: 12, arrived: 1042 }], 10.5, 60)).toEqual(held); // (ahead by 2 s: a seek)
    expect(boostPhase([older], 10, 60)).toEqual({ from: 0, to: 0, t: 1, between: false }); // (the first frame)
    // Right after a seek, the frame after it is held until its moment comes, then the boost goes on from there (never back).
    const after = [older, { mediaTime: 20, arrived: 1042 }, { mediaTime: 20 + 1 / 24, arrived: 1084 }];
    expect(boostPhase(after, 19.99, 60)).toEqual({ from: 0, to: 1, t: 1, between: false });
    expect(boostPhase(after, 20 + 1 / 48, 60)).toMatchObject({ from: 1, to: 2, between: true });
    expect(boostPhase(after, 20 + 1 / 48, 60).t).toBeCloseTo(0.5, 6);
    const clock = new VideoClock();
    for (let index = 0; index < 48; index++) clock.add({ mediaTime: 10 + index / 24, arrived: 1000 + (index * 1000) / 24 });
    expect(clock.at(3000)).toBeCloseTo(12, 3);
    clock.add({ mediaTime: 1, arrived: 3100 }); // (a loop back to the start)
    expect(clock.at(3100)).toBeCloseTo(1, 3);
    clock.add({ mediaTime: 1 + 1 / 24, arrived: 3150 });
    clock.add({ mediaTime: 1 + 2 / 24, arrived: 9000 }); // (paused for 6 s: the clock follows the video, not the page)
    expect(clock.at(9000)).toBeCloseTo(1 + 2 / 24, 3);
  });

  it("catches up at once when the first frames after Play came late (the decoder warming up), not a little a frame", () => {
    const clock = new VideoClock();
    // The first 10 frames come 60 ms late, the rest on time (24 fps, the video's moment 0 at the page's 1000 ms).
    for (let index = 0; index < 30; index++) clock.add({ mediaTime: index / 24, arrived: 1000 + (index * 1000) / 24 + (index < 10 ? 60 : 0) });
    expect(clock.at(1000 + 30_000 / 24)).toBeCloseTo(30 / 24, 3);
  });

  it("holds the newer frame when the next one is late (a stall, or a pause)", () => {
    const phase = boostPhase([{ mediaTime: 1, arrived: 0 }, { mediaTime: 1 + 1 / 24, arrived: 42 }], 1.5, 60);
    expect(phase).toEqual({ from: 0, to: 1, t: 1, between: true });
  });

  it("gives RIFE the moments between two frames on its grid: 24 to 60 is 2 or 3 a pair (one of them the frame itself), 24 to 30 is 1", () => {
    const at = (m: number, t: number) => ({ m, t: expect.closeTo(t, 6) as unknown as number });
    // 24 fps frames 0 and 1/24 on a grid of 60: 0 (the frame itself), 1/60 (t 0.4), 2/60 (0.8).
    expect(gridJobs(0, 1 / 24, 60)).toEqual([at(1, 0.4), at(2, 0.8)]);
    // the next pair: 3/60 (t 0.2), 4/60 (0.6); 5/60 is the frame 2/24 itself
    expect(gridJobs(1 / 24, 2 / 24, 60)).toEqual([at(3, 0.2), at(4, 0.6)]);
    // 24 to 30: four frames between every four of the video's (one per pair, but for the pair that starts on the grid)
    const jobs = [0, 1, 2, 3].flatMap((index) => gridJobs(index / 24, (index + 1) / 24, 30));
    expect(jobs.map((each) => each.m)).toEqual([1, 2, 3, 4]);
    expect(jobs.map((each) => Math.round(each.t * 10) / 10)).toEqual([0.8, 0.6, 0.4, 0.2]);
    // nothing across a seek, and the moments for a 57 Hz screen
    expect(gridJobs(10, 12, 60)).toEqual([]);
    expect(gridRate(60, 57)).toBe(57);
    expect(gridRate(60, 60)).toBe(60);
    expect(gridRate(30, 60)).toBe(30);
    expect(gridRate(60, 0)).toBe(60);
    expect(gridMoment(1 / 60 + 0.004, 60)).toBe(1);
  });

  it("knows the screen's refresh rate, leaving pauses out", () => {
    expect(refreshRate([16.6, 16.7, 16.7, 16.8, 16.6, 16.7, 16.7, 400, 16.7, 16.6, 16.7])).toBeCloseTo(60, 0);
    expect(refreshRate([6.9, 7, 6.9, 7, 6.9, 7, 6.9, 7, 6.9, 7])).toBeCloseTo(144, -1);
    expect(refreshRate([16.7, 16.7])).toBe(0);
  });
});
