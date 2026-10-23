import { describe, expect, it } from "vitest";
import { Pose, Skeleton, turnAbout, type SkeletonData } from "./pose";
import { Secondary, type Gust } from "./secondary";

/** A small cat: the hips, a back that is three bones, and a tail that goes back and up from the hips (the names are the real skeleton's, which is what the followers look for). */
const NAMES = ["Hips", "spine1", "spine2", "chest", "tail", "tailstart", "tail1", "tail2", "tail3"];
const PARENT = [-1, 0, 1, 2, 0, 4, 5, 6, 7];
const AT: Array<[number, number, number]> = [
  [-0.4, 0.5, 0],
  [0.18, -0.04, 0],
  [0.18, -0.04, 0],
  [0.18, -0.04, 0],
  [0, 0, 0],
  [-0.15, 0.03, 0],
  [-0.12, 0.07, 0],
  [-0.08, 0.12, 0],
  [-0.08, 0.12, 0],
];
const data: SkeletonData = {
  names: NAMES,
  parent: PARENT,
  restT: AT.flat(),
  restR: NAMES.flatMap(() => [0, 0, 0, 1]),
};
const skeleton = new Skeleton(data);

const QUIET: Gust = { forward: 0, up: 0, sway: 0, energy: 0, breath: 0 };
const roll = (pose: Pose, name: string): number => {
  // (the angle about the cat's z of a bone's turn, which is all that these tests turn)
  const o = skeleton.bone(name) * 4;
  return 2 * Math.atan2(pose.r[o + 2]!, pose.r[o + 3]!);
};
const turned = (name: string, angle: number): Pose => {
  const pose = new Pose(skeleton);
  const q = turnAbout(0, 0, 1, angle);
  pose.r.set(q, skeleton.bone(name) * 4);
  return pose;
};

describe("secondary motion", () => {
  it("follows the bones it is made for, and only those the skeleton has", () => {
    const secondary = new Secondary(skeleton);
    expect(secondary.bones).toEqual(["spine1", "spine2", "chest", "tail", "tailstart", "tail1", "tail2", "tail3"]);
    const without = new Skeleton({ names: ["Hips", "chest"], parent: [-1, 0], restT: [0, 0, 0, 0.3, 0, 0], restR: [0, 0, 0, 1, 0, 0, 0, 1] });
    expect(new Secondary(without).bones).toEqual(["chest"]);
  });

  it("leaves a pose that is still, and quiet, just as it is", () => {
    const secondary = new Secondary(skeleton);
    const pose = new Pose(skeleton);
    const first = pose.r.slice();
    for (let i = 0; i < 120; i++) secondary.apply(pose, 1 / 60, QUIET);
    for (let i = 0; i < first.length; i++) expect(pose.r[i]).toBeCloseTo(first[i]!, 6);
  });

  it("lags behind a bone that is turned, the tip further than the root, and gets there", () => {
    const secondary = new Secondary(skeleton);
    // the tail is at rest, and then every bone of it is turned half a radian at once
    const rest = new Pose(skeleton);
    secondary.apply(rest, 1 / 60, QUIET);
    const seen: Record<string, number[]> = { tail: [], tail3: [] };
    for (let i = 0; i < 90; i++) {
      const pose = new Pose(skeleton);
      for (const name of ["tail", "tailstart", "tail1", "tail2", "tail3"]) pose.r.set(turnAbout(0, 0, 1, 0.5), skeleton.bone(name) * 4);
      secondary.apply(pose, 1 / 60, QUIET);
      seen.tail!.push(roll(pose, "tail"));
      seen.tail3!.push(roll(pose, "tail3"));
    }
    // (two pictures on: the root has moved on more than the tip, and the tip is still on its way a tenth of a second on)
    expect(seen.tail![1]!).toBeGreaterThan(seen.tail3![1]!);
    expect(seen.tail![5]!).toBeGreaterThan(seen.tail3![5]!);
    // (a second and a half on: both are where they were sent)
    expect(seen.tail![89]!).toBeCloseTo(0.5, 1);
    expect(seen.tail3![89]!).toBeCloseTo(0.5, 1);
    // (the tip rings: it goes past, by more than the root does, and not a lot)
    const most = Math.max(...seen.tail3!);
    expect(most).toBeGreaterThan(Math.max(...seen.tail!) + 0.02);
    expect(most).toBeLessThan(0.5 * 1.4);
  });

  it("gets to the same place whatever the length of the picture, and is steady for a very long one", () => {
    const at = (dt: number, seconds: number): number => {
      const secondary = new Secondary(skeleton);
      secondary.apply(new Pose(skeleton), dt, QUIET);
      let last = 0;
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        const pose = turned("tail2", 0.4);
        secondary.apply(pose, dt, QUIET);
        last = roll(pose, "tail2");
      }
      return last;
    };
    const a = at(1 / 60, 0.4);
    const b = at(1 / 30, 0.4);
    const c = at(1 / 240, 0.4);
    expect(Math.abs(a - c)).toBeLessThan(0.03);
    expect(Math.abs(b - c)).toBeLessThan(0.06);
    // a picture that took a fifth of a second (a tab that was hidden) is not one that throws the tail about
    const secondary = new Secondary(skeleton);
    secondary.apply(new Pose(skeleton), 1 / 60, QUIET);
    const pose = turned("tail3", 1);
    secondary.apply(pose, 0.2, QUIET);
    secondary.apply(pose, 5, QUIET);
    for (const v of pose.r) expect(Number.isFinite(v)).toBe(true);
    for (const name of NAMES) {
      const o = skeleton.bone(name) * 4;
      expect(Math.hypot(pose.r[o]!, pose.r[o + 1]!, pose.r[o + 2]!, pose.r[o + 3]!)).toBeCloseTo(1, 4);
    }
  });

  it("starts from the pose it is given, not from where the bones were", () => {
    const secondary = new Secondary(skeleton);
    secondary.apply(turned("tail3", 0.9), 1 / 60, QUIET);
    secondary.reset();
    const pose = turned("tail3", -0.6);
    secondary.apply(pose, 1 / 60, QUIET);
    expect(roll(pose, "tail3")).toBeCloseTo(-0.6, 5);
  });

  it("drags the tail behind a body that speeds up, and lets it lift when the body stops and lands", () => {
    const settle = (gust: Gust): number => {
      const secondary = new Secondary(skeleton);
      const pose = new Pose(skeleton);
      secondary.apply(pose, 1 / 60, QUIET);
      for (let i = 0; i < 240; i++) {
        const p = new Pose(skeleton);
        secondary.apply(p, 1 / 60, gust);
        if (i === 239) return roll(p, "tail1");
      }
      return 0;
    };
    // (the tail goes back and up from the hips, and a turn about z that is more than none lowers it)
    expect(settle({ ...QUIET, forward: 20 })).toBeGreaterThan(0.02);
    expect(settle({ ...QUIET, forward: -20 })).toBeLessThan(-0.02);
    expect(settle({ ...QUIET, up: 20 })).toBeGreaterThan(0.02);
    // however hard the push, a tail is not turned right round
    expect(Math.abs(settle({ ...QUIET, forward: 5000 }))).toBeLessThan(0.45);
  });

  it("sways the tail in a wave that is wider towards the tip, and runs on from the root", () => {
    const secondary = new Secondary(skeleton);
    const swing: Record<string, number[]> = { tail: [], tailstart: [], tail1: [], tail2: [], tail3: [] };
    for (let i = 0; i < 60 * 6; i++) {
      const pose = new Pose(skeleton);
      secondary.apply(pose, 1 / 60, { ...QUIET, sway: 1 });
      for (const name of Object.keys(swing)) swing[name]!.push(roll(pose, name));
    }
    const range = (name: string): number => Math.max(...swing[name]!) - Math.min(...swing[name]!);
    expect(range("tail3")).toBeGreaterThan(range("tail1"));
    expect(range("tail1")).toBeGreaterThan(range("tail"));
    expect(range("tail3")).toBeGreaterThan(0.25);
    expect(range("tail3")).toBeLessThan(0.6);
    // (the tip is behind the root: it reaches its top later)
    const topAt = (name: string): number => swing[name]!.slice(0, 120).indexOf(Math.max(...swing[name]!.slice(0, 120)));
    expect(topAt("tail3")).not.toBe(topAt("tail"));
    // (and a cat that does not sway has a still tail)
    const still = new Secondary(skeleton);
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      const pose = new Pose(skeleton);
      still.apply(pose, 1 / 60, { ...QUIET, sway: 0 });
      seen.push(roll(pose, "tail3"));
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(1e-6);
  });

  it("lifts the chest with the breath in, and by more than the bones behind it", () => {
    const secondary = new Secondary(skeleton);
    const pose = new Pose(skeleton);
    secondary.apply(pose, 1 / 60, QUIET);
    secondary.apply(pose, 1 / 60, { ...QUIET, breath: 1 });
    expect(roll(pose, "chest")).toBeCloseTo(0.02, 3);
    expect(roll(pose, "spine2")).toBeCloseTo(0.014, 3);
    expect(roll(pose, "spine1")).toBeCloseTo(0.008, 3);
    const out = new Pose(skeleton);
    secondary.apply(out, 1 / 60, { ...QUIET, breath: -1 });
    expect(roll(out, "chest")).toBeCloseTo(-0.02, 3);
  });
});
