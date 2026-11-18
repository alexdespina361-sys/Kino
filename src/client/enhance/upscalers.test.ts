import { describe, expect, it } from "vitest";
import { bestSteps, easuScale, rcasAmount } from "./upscalers";

describe("the ✦ 2K drawers' arithmetic", () => {
  it("gives AMD's EASU constant and RCAS amount as ffx_fsr1.h computes them", () => {
    expect(easuScale(640, 360, 1280, 720)).toEqual([0.5, 0.5, -0.25, -0.25]);
    expect(easuScale(1280, 720, 1280, 720)).toEqual([1, 1, 0, 0]);
    expect(rcasAmount(0)).toBe(1);
    expect(rcasAmount(1)).toBe(0.5);
    expect(rcasAmount(0.2)).toBeCloseTo(0.8706, 4);
  });

  it("runs Anime4K's biggest 2x network, and its small one again for a picture more than 2.4 times as big", () => {
    const sd = { width: 854, height: 480 };
    const sizes = (steps: ReturnType<typeof bestSteps>) => steps.map(({ network, size }) => `${network} ${size.width}x${size.height}`);
    expect(sizes(bestSteps(sd, { width: 1920, height: 1080 }))).toEqual(["CNNx2UL 1708x960"]);
    expect(sizes(bestSteps(sd, { width: 2560, height: 1440 }))).toEqual(["CNNx2UL 1708x960", "CNNx2M 3416x1920"]);
  });
});
