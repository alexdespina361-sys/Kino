import { describe, expect, it } from "vitest";
import { Pose, Skeleton, globals, turnAbout, type SkeletonData } from "./pose";
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

const TAIL = ["tail", "tailstart", "tail1", "tail2", "tail3"];
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

  it("carries a turn of the root on along the tail: each bone gets there after the one before it, the tip rings a little, and all of it arrives", () => {
    const secondary = new Secondary(skeleton);
    secondary.apply(new Pose(skeleton), 1 / 60, QUIET);
    // the root of the tail is turned half a radian; where each bone points in the cat's frame is its own turn and those of the bones before it
    const seen: number[][] = [];
    for (let i = 0; i < 90; i++) {
      const pose = turned("tail", 0.5);
      secondary.apply(pose, 1 / 60, QUIET);
      let sum = 0;
      seen.push(TAIL.map((name) => (sum += roll(pose, name))));
    }
    // (a tenth of a second on: the root is there, and the tip has hardly begun)
    expect(seen[5]![0]!).toBeGreaterThan(0.4);
    expect(seen[5]![4]!).toBeLessThan(0.1);
    const arrives = (k: number): number => seen.findIndex((row) => row[k]! > 0.25);
    for (let k = 1; k < TAIL.length; k++) expect(arrives(k)).toBeGreaterThan(arrives(k - 1));
    // (the tip goes past where it was sent, by more than the root does, and not far)
    const most = Math.max(...seen.map((row) => row[4]!));
    expect(most).toBeGreaterThan(Math.max(...seen.map((row) => row[0]!)) + 0.05);
    expect(most).toBeLessThan(0.5 * 1.6);
    // (a second and a half on: all of it is where it was sent)
    for (let k = 0; k < TAIL.length; k++) expect(seen[89]![k]!).toBeCloseTo(0.5, 1);
  });

  it("keeps pointing where it was when the body turns, and is carried round after it", () => {
    const secondary = new Secondary(skeleton);
    secondary.apply(new Pose(skeleton), 1 / 60, QUIET);
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      const pose = turned("Hips", 0.5);
      secondary.apply(pose, 1 / 60, QUIET);
      seen.push(roll(pose, "tail"));
    }
    // (the root turns back against the body's turn at first, and the body's turn is all there is a second on)
    expect(seen[2]!).toBeLessThan(-0.1);
    expect(Math.abs(seen[89]!)).toBeLessThan(0.02);
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

  it("sways the whole tail in a wave that runs on from the root and is wider towards the tip", () => {
    const secondary = new Secondary(skeleton);
    // where each bone points in the cat's frame, for half a minute
    const swing: number[][] = TAIL.map(() => []);
    for (let i = 0; i < 60 * 30; i++) {
      const pose = new Pose(skeleton);
      secondary.apply(pose, 1 / 60, { ...QUIET, sway: 1 });
      let sum = 0;
      TAIL.forEach((name, k) => swing[k]!.push((sum += roll(pose, name))));
    }
    const range = (k: number): number => Math.max(...swing[k]!) - Math.min(...swing[k]!);
    for (let k = 1; k < TAIL.length; k++) expect(range(k)).toBeGreaterThan(range(k - 1));
    // (not the tip alone: the root sways too, and the tip does not swing wildly in a calm cat)
    expect(range(0)).toBeGreaterThan(0.1);
    expect(range(4)).toBeGreaterThan(0.4);
    expect(range(4)).toBeLessThan(1.1);
    // (the tip is not the root over again: the waves are a wave that is behind from one bone to the next, so the two are far from one rhythm)
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    const [root, tip] = [swing[0]!, swing[4]!];
    const [mr, mt] = [mean(root), mean(tip)];
    let both = 0;
    let sr = 0;
    let st = 0;
    for (let i = 0; i < root.length; i++) {
      both += (root[i]! - mr) * (tip[i]! - mt);
      sr += (root[i]! - mr) ** 2;
      st += (tip[i]! - mt) ** 2;
    }
    expect(Math.abs(both / Math.sqrt(sr * st))).toBeLessThan(0.7);
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

  it("is wider and quicker for a lively cat", () => {
    const tipRange = (energy: number): number => {
      const secondary = new Secondary(skeleton);
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < 60 * 30; i++) {
        const pose = new Pose(skeleton);
        secondary.apply(pose, 1 / 60, { ...QUIET, sway: 1, energy });
        let sum = 0;
        for (const name of TAIL) sum += roll(pose, name);
        low = Math.min(low, sum);
        high = Math.max(high, sum);
      }
      return high - low;
    };
    expect(tipRange(1)).toBeGreaterThan(tipRange(0) * 1.3);
  });

  it("flicks now and then (more for a lively cat), and not when it is not to sway", () => {
    const count = (sway: number, energy: number): number => {
      const secondary = new Secondary(skeleton);
      for (let i = 0; i < 60 * 120; i++) secondary.apply(new Pose(skeleton), 1 / 60, { ...QUIET, sway, energy });
      return secondary.flicks;
    };
    expect(count(1, 0)).toBeGreaterThan(5);
    expect(count(1, 1)).toBeGreaterThan(count(1, 0));
    expect(count(0, 1)).toBe(0);
  });

  it("does the same for the same seed, and not for another", () => {
    const run = (seed: number): number[] => {
      const secondary = new Secondary(skeleton, seed);
      const out: number[] = [];
      for (let i = 0; i < 600; i++) {
        const pose = new Pose(skeleton);
        secondary.apply(pose, 1 / 60, { ...QUIET, sway: 1, energy: 0.5 });
        out.push(roll(pose, "tail3"));
      }
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
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

describe("a tail on the floor", () => {
  /** Where the joints of the tail are (height, and the distance of each from the one before), as the pose has them. */
  const joints = (pose: Pose): { y: number[]; gap: number[] } => {
    const R = new Float64Array(skeleton.count * 9);
    const T = new Float64Array(skeleton.count * 3);
    globals(skeleton, pose, undefined, R, T);
    const at = TAIL.map((name) => skeleton.bone(name));
    const y = at.map((j) => T[j * 3 + 1]!);
    const gap = at.slice(1).map((j, i) => Math.hypot(T[j * 3]! - T[at[i]! * 3]!, T[j * 3 + 1]! - T[at[i]! * 3 + 1]!, T[j * 3 + 2]! - T[at[i]! * 3 + 2]!));
    return { y, gap };
  };
  /** A cat whose tail hangs from the hips down and back, far below where the floor is. */
  const hanging = (): Pose => turned("tail", 1.75);

  it("is held up off the floor, bone by bone, and the bones keep their length", () => {
    const secondary = new Secondary(skeleton);
    const free = hanging();
    const rest = joints(free);
    // (it does hang through the floor: the last joint is far below it)
    expect(rest.y[4]!).toBeLessThan(0.1);
    const pose = hanging();
    const root = skeleton.bone("tail") * 4;
    const turnOfRoot = Array.from(pose.r.slice(root, root + 4));
    secondary.settle(pose, 1);
    // (a bone whose end is clear of the floor is left as it was: the root of this tail, which the hips hold up)
    expect(Array.from(pose.r.slice(root, root + 4))).toEqual(turnOfRoot);
    const held = joints(pose);
    for (let k = 1; k < TAIL.length; k++) expect(held.y[k]!).toBeGreaterThan(0.19);
    // (and it was turned, not bent out of shape: a bone is as long as it was)
    for (let k = 0; k < held.gap.length; k++) expect(held.gap[k]!).toBeCloseTo(rest.gap[k]!, 4);
    // (the turns are still turns)
    for (const name of NAMES) {
      const o = skeleton.bone(name) * 4;
      expect(Math.hypot(pose.r[o]!, pose.r[o + 1]!, pose.r[o + 2]!, pose.r[o + 3]!)).toBeCloseTo(1, 4);
    }
  });

  it("is left alone when it is clear of the floor, and by a cat that has none under it", () => {
    const secondary = new Secondary(skeleton);
    const up = new Pose(skeleton);
    const before = up.r.slice();
    secondary.settle(up, 1);
    expect(Array.from(up.r)).toEqual(Array.from(before));
    const low = hanging();
    const kept = low.r.slice();
    secondary.settle(low, 0);
    expect(Array.from(low.r)).toEqual(Array.from(kept));
  });

  it("is held up by as much as the floor is there: half the floor lifts it half of the way", () => {
    const secondary = new Secondary(skeleton);
    const height = (share: number): number => {
      const pose = hanging();
      secondary.settle(pose, share);
      return joints(pose).y[4]!;
    };
    const [none, half, all] = [height(0), height(0.5), height(1)];
    expect(half).toBeGreaterThan(none + 0.03);
    expect(all).toBeGreaterThan(half + 0.03);
  });

  it("is only held up in the picture: the springs go on as they were, and the tail comes off the floor when its wave does", () => {
    const run = (hold: boolean): number[][] => {
      const secondary = new Secondary(skeleton);
      const out: number[][] = [];
      for (let i = 0; i < 120; i++) {
        const pose = hanging();
        secondary.apply(pose, 1 / 60, { ...QUIET, sway: 1, energy: 0.5 });
        // (the picture before the floor is the spring's own)
        out.push(Array.from(pose.r));
        if (hold) secondary.settle(pose, 1);
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });

  it("does not turn a tail that lies along the floor on its end when the floor is above its root", () => {
    // (the cat is lying in the floor to its hips: the tail is turned up by a quarter of a turn at most, and not stood on end)
    const secondary = new Secondary(skeleton);
    const sunk = new Pose(skeleton);
    sunk.t[skeleton.bone("Hips") * 3 + 1] = -0.5;
    secondary.settle(sunk, 1);
    const R = new Float64Array(skeleton.count * 9);
    const T = new Float64Array(skeleton.count * 3);
    globals(skeleton, sunk, undefined, R, T);
    const root = skeleton.bone("tail");
    const first = skeleton.bone("tailstart");
    const rise = (T[first * 3 + 1]! - T[root * 3 + 1]!) / Math.hypot(T[first * 3]! - T[root * 3]!, T[first * 3 + 1]! - T[root * 3 + 1]!);
    expect(rise).toBeLessThanOrEqual(0.5 + 1e-4);
    expect(rise).toBeGreaterThan(0.3);
  });
});
