import { describe, expect, it } from "vitest";
import { SWAT_HIT } from "../types";
import { SWAT_REST_REACH, swatPose } from "./swat";

describe("the swat, as the paw moves through it", () => {
  it("begins and ends with the paw where it rests, and the cat's weight where it was", () => {
    for (const p of [0, 1]) {
      const pose = swatPose(p);
      expect(pose.turn, `${p}`).toBeCloseTo(0, 6);
      expect(pose.reach, `${p}`).toBeCloseTo(SWAT_REST_REACH, 6);
      expect(pose.lean, `${p}`).toBeCloseTo(0, 6);
    }
    // (outside the clip it is the nearest end of it)
    expect(swatPose(-3)).toEqual(swatPose(0));
    expect(swatPose(7)).toEqual(swatPose(1));
  });

  it("raises the paw up and back behind the shoulder, with the weight gone back, before it comes down", () => {
    const raised = swatPose(0.32);
    // (radians off the line to the poster: negative is up and back, and past two is above the shoulder)
    expect(raised.turn).toBeLessThan(-2);
    expect(raised.lean).toBeLessThan(-0.2);
    // (and it has not touched anything yet)
    for (const p of [0.05, 0.12, 0.2, 0.3, 0.35]) expect(swatPose(p).turn, `${p}`).toBeLessThan(0);
  });

  it("lands on the poster at the moment the clip says, with the weight on it, and the paw a little past the line", () => {
    const landed = swatPose(SWAT_HIT);
    expect(landed.turn).toBeGreaterThan(0);
    expect(landed.turn).toBeLessThan(0.4);
    expect(landed.lean).toBeGreaterThan(0.95);
    expect(landed.reach).toBeGreaterThan(swatPose(0.3).reach);
    // (it is pressed there a moment)
    expect(swatPose(0.5).turn).toBeCloseTo(landed.turn, 1);
    expect(swatPose(0.5).lean).toBeGreaterThan(0.95);
  });

  it("flicks the paw back and puts it down again", () => {
    const recoil = swatPose(0.66);
    expect(recoil.turn).toBeLessThan(-0.5);
    expect(recoil.lean).toBeLessThan(0.6);
    expect(swatPose(0.84).turn).toBeGreaterThan(recoil.turn);
    expect(Math.abs(swatPose(0.84).turn)).toBeLessThan(0.4);
  });

  it("never jumps from one moment to the next: the strike is the fastest part of it, and it is just before the hit", () => {
    const steps = 2000;
    let fastest = 0;
    let where = 0;
    let previous = swatPose(0);
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const pose = swatPose(p);
      for (const value of [pose.turn, pose.reach, pose.lean]) expect(Number.isFinite(value)).toBe(true);
      const step = Math.abs(pose.turn - previous.turn);
      if (step > fastest) {
        fastest = step;
        where = p;
      }
      // (a tenth of a radian is a long way to move in a five-hundredth of the clip, outside the strike)
      if (p < 0.35 || p > SWAT_HIT) expect(step, `${p}`).toBeLessThan(0.1);
      expect(Math.abs(pose.reach - previous.reach), `${p}`).toBeLessThan(0.02);
      expect(Math.abs(pose.lean - previous.lean), `${p}`).toBeLessThan(0.08);
      previous = pose;
    }
    expect(where).toBeGreaterThan(0.38);
    expect(where).toBeLessThanOrEqual(SWAT_HIT);
    expect(fastest).toBeLessThan(0.25);
  });
});
