import { describe, expect, it } from "vitest";
import { CLIMB_BACK, CLIMB_GRAB, CLIMB_HANG, CLIMB_LIP, CLIMB_OVER, CLIMB_PULL } from "../types";
import { climbPaws, climbPose } from "./climb";

describe("the simple cat's climb (the picture the engine's climb clip is drawn as)", () => {
  const steps = 400;
  const along = Array.from({ length: steps + 1 }, (_, i) => i / steps);

  it("starts hanging by the forepaws below and behind the point it ends up standing at, and ends on it", () => {
    const first = climbPose(0);
    // (its middle is `CLIMB_BACK` behind the point it stands at, and its feet hang a body length or so below the lip: the shoulder, a leg's length below the lip, is nearer to it)
    expect(first.x).toBeCloseTo(-CLIMB_BACK, 6);
    expect(first.y).toBeGreaterThan(0.8);
    expect(first.y).toBeLessThan(CLIMB_HANG);
    expect(first.pitch).toBeLessThan(-1);
    expect(first).toMatchObject({ hang: 1, paws: 1, top: 0, scramble: 0 });
    expect(first.stretch).toBeGreaterThan(0.3);
    const last = climbPose(1);
    expect(last.x).toBeCloseTo(0, 6);
    expect(last.y).toBeCloseTo(0, 6);
    expect(last.pitch).toBeCloseTo(0, 6);
    expect(last).toMatchObject({ hang: 0, paws: 0, top: 1, scramble: 0, stretch: 0 });
  });

  it("takes hold (to the grab), pulls itself up (to the pull: the chest is over the lip) and scrambles over (to the over mark), at the marks the art is told", () => {
    // (hanging still while it takes hold)
    expect(climbPose(CLIMB_GRAB).x).toBeCloseTo(-CLIMB_BACK, 6);
    expect(climbPose(CLIMB_GRAB).y).toBeGreaterThan(0.9);
    // (at the pull the paws are on the ledge and the body has come up to the lip: its shoulder is about a leg's length below the line, and it is no longer upright)
    const pull = climbPose(CLIMB_PULL);
    expect(pull.top).toBeCloseTo(1, 6);
    expect(pull.y).toBeLessThan(0.6);
    expect(pull.y).toBeGreaterThan(0.3);
    expect(pull.pitch).toBeGreaterThan(-0.9);
    expect(pull.pitch).toBeLessThan(-0.5);
    expect(pull.hang).toBeGreaterThan(0.95);
    // (at "over" it is nearly standing: the hind legs are over the edge, and stop pedalling a moment after)
    const over = climbPose(CLIMB_OVER);
    expect(over.y).toBeLessThan(0.2);
    expect(Math.abs(over.pitch)).toBeLessThan(0.2);
    expect(over.hang).toBeLessThan(0.1);
    expect(over.scramble).toBeLessThan(0.6);
    expect(climbPose(CLIMB_OVER + 0.05).scramble).toBeLessThan(0.01);
    // (and it scrambles in between, with its hind legs, and not at the start or the end)
    expect(climbPose(0.6).scramble).toBeGreaterThan(0.9);
    expect(climbPose(0.1).scramble).toBe(0);
    expect(climbPose(0.95).scramble).toBe(0);
  });

  it("only rises and moves on, and rights itself: it never goes down, back or further over, along the way", () => {
    let before = climbPose(0);
    for (const p of along) {
      const now = climbPose(p);
      expect(now.y, `${p}`).toBeLessThanOrEqual(before.y + 1e-9);
      expect(now.x, `${p}`).toBeGreaterThanOrEqual(before.x - 1e-9);
      expect(now.pitch, `${p}`).toBeGreaterThanOrEqual(before.pitch - 1e-9);
      expect(now.hang, `${p}`).toBeLessThanOrEqual(before.hang + 1e-9);
      expect(now.top, `${p}`).toBeGreaterThanOrEqual(before.top - 1e-9);
      before = now;
    }
  });

  it("is smooth: nothing jumps between one frame and the next at sixty a second over a climb of a second and seven tenths", () => {
    const frames = Math.round(1.7 * 60);
    let before = climbPose(0);
    let biggest = 0;
    for (let k = 1; k <= frames; k++) {
      const now = climbPose(k / frames);
      biggest = Math.max(biggest, Math.hypot(now.x - before.x, now.y - before.y));
      expect(Math.abs(now.pitch - before.pitch), `${k}`).toBeLessThan(0.06);
      for (const key of ["hang", "paws", "top", "scramble", "stretch"] as const) expect(Math.abs(now[key] - before[key]), `${key} ${k}`).toBeLessThan(0.16);
      before = now;
    }
    // (the quickest part of the pull is a body length in about a quarter of a second)
    expect(biggest).toBeLessThan(0.04);
  });

  it("does not care for a progress outside the clip: it is the first or the last picture", () => {
    expect(climbPose(-3)).toEqual(climbPose(0));
    expect(climbPose(4)).toEqual(climbPose(1));
  });

  it("holds the forepaws on the lip while it hangs, and brings them over it on to the ledge as it pulls", () => {
    const hang = climbPaws(0);
    // (the lip is a `CLIMB_LIP` behind the point it ends up standing at, on the line of the ledge; the far paw a little behind the near one)
    expect(hang.near.x).toBeCloseTo(-CLIMB_LIP, 1);
    expect(hang.far.x).toBeLessThan(hang.near.x);
    expect(Math.abs(hang.near.y)).toBeLessThan(0.05);
    const top = climbPaws(1);
    expect(top.near.x).toBeGreaterThan(-CLIMB_LIP + 0.25);
    expect(top.far.x).toBeGreaterThan(-CLIMB_LIP + 0.25);
    expect(top.near.y).toBeLessThanOrEqual(0);
    // (on the way they only go on)
    let before = climbPaws(0).near.x;
    for (const p of along) {
      const x = climbPaws(p).near.x;
      expect(x).toBeGreaterThanOrEqual(before - 1e-9);
      before = x;
    }
    expect(climbPaws(-1)).toEqual(climbPaws(0));
    expect(climbPaws(2)).toEqual(climbPaws(1));
  });
});
