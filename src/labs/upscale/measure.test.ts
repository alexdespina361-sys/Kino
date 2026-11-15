import { describe, expect, it } from "vitest";
import { easuScale, frameRate, ms, rcasAmount, summarize, targetSize, verdict } from "./measure";

describe("the upscaler test page's arithmetic", () => {
  it("sums up a speed test as its middle and its 90th percentile, leaving out what is not a time", () => {
    expect(summarize([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({ median: 5, p90: 9, samples: 10 });
    expect(summarize([2, Number.NaN, -1, Number.POSITIVE_INFINITY])).toEqual({ median: 2, p90: 2, samples: 1 });
    expect(summarize([]).samples).toBe(0);
  });

  it("calls a mode smooth, tight or slow from the time a frame of the video has, and from how many frames it drew while it played", () => {
    // 30 fps: 33.3 ms a frame.
    expect(verdict({ median: 4, p90: 6, samples: 40 }, 30)).toBe("smooth");
    expect(verdict({ median: 4, p90: 6, samples: 40 }, 30, 0.99)).toBe("smooth");
    expect(verdict({ median: 4, p90: 6, samples: 40 }, 30, 0.95)).toBe("tight"); // (fast on paper, but frames were missed)
    expect(verdict({ median: 20, p90: 25, samples: 40 }, 30)).toBe("tight");
    expect(verdict({ median: 30, p90: 40, samples: 40 }, 30)).toBe("slow");
    expect(verdict({ median: 4, p90: 6, samples: 40 }, 30, 0.8)).toBe("slow");
    expect(verdict({ median: 12, p90: 14, samples: 40 }, 60)).toBe("tight"); // (60 fps: 16.7 ms)
    expect(verdict({ median: Number.NaN, p90: Number.NaN, samples: 0 }, 30)).toBe("slow");
  });

  it("draws the picture as big as fits in the 16:9 box of the chosen height, never smaller than the video, keeping its shape with even sides", () => {
    expect(targetSize(854, 480, 720)).toEqual({ width: 1280, height: 720 }); // (854 x 480 is a hair wider than 16:9: its width sets the size)
    expect(targetSize(848, 480, 720)).toEqual({ width: 1272, height: 720 });
    expect(targetSize(640, 480, 720)).toEqual({ width: 960, height: 720 }); // (4:3: its height does)
    expect(targetSize(854, 364, 720)).toEqual({ width: 1280, height: 546 }); // (a wide film)
    expect(targetSize(320, 180, 720)).toEqual({ width: 1280, height: 720 });
    expect(targetSize(720, 576, 1080)).toEqual({ width: 1350, height: 1080 });
    expect(targetSize(1920, 1080, 720)).toEqual({ width: 1920, height: 1080 }); // (already bigger: left as it is)
    expect(targetSize(1920, 818, 720)).toEqual({ width: 1920, height: 818 });
    expect(targetSize(0, 480, 720)).toEqual({ width: 0, height: 0 });
  });

  it("gives AMD's EASU constant and RCAS amount as ffx_fsr1.h computes them", () => {
    expect(easuScale(640, 360, 1280, 720)).toEqual([0.5, 0.5, -0.25, -0.25]);
    expect(easuScale(1280, 720, 1280, 720)).toEqual([1, 1, 0, 0]);
    expect(rcasAmount(0)).toBe(1);
    expect(rcasAmount(1)).toBe(0.5);
    expect(rcasAmount(0.2)).toBeCloseTo(0.8706, 4);
  });

  it("reads the frame rate from the media times of frames shown one after another, ignoring a seek", () => {
    const at24 = Array.from({ length: 12 }, (_, index) => index / 23.976);
    expect(frameRate(at24)).toBeCloseTo(23.98, 1);
    expect(frameRate([0, 0.04, 0.08, 5, 5.04, 5.08, 5.12])).toBe(25);
    expect(frameRate([0, 1])).toBe(30);
  });

  it("writes a time short", () => {
    expect(ms(3.14159)).toBe("3.1 ms");
    expect(ms(123.4)).toBe("123 ms");
    expect(ms(Number.NaN)).toBe("-");
  });
});
