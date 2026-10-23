import { describe, expect, it } from "vitest";
import { decodeClips, encodeClips, skeletonStamp, type ClipSource } from "./clipfile";
import { Pose, Skeleton, blend, dualSkin, lengthOf, matrixOf, sampleClip, sampleFrame, solve, solveDual, turnAbout, type Adjust, type SkeletonData } from "./pose";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a at the origin; b a step along x from a; c a step along x from b; d a step up from a. */
const toy = (): SkeletonData => ({
  names: ["a", "b", "c", "d"],
  parent: [-1, 0, 1, 0],
  restT: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
  restR: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
});

const apply = (m: ArrayLike<number>, at: number, p: [number, number, number]): [number, number, number] => [
  m[at]! * p[0] + m[at + 1]! * p[1] + m[at + 2]! * p[2] + m[at + 3]!,
  m[at + 4]! * p[0] + m[at + 5]! * p[1] + m[at + 6]! * p[2] + m[at + 7]!,
  m[at + 8]! * p[0] + m[at + 9]! * p[1] + m[at + 10]! * p[2] + m[at + 11]!,
];

const near = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(eps);
};

describe("the cat's skeleton and its pose", () => {
  it("is refused when a bone hangs from one that comes after it", () => {
    const bad = toy();
    bad.parent = [1, -1, 1, 0];
    expect(() => new Skeleton(bad)).toThrow();
  });

  it("gives every bone the skin that leaves a point where it is, at rest", () => {
    const skeleton = new Skeleton(toy());
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, new Pose(skeleton), IDENTITY, out);
    for (let j = 0; j < skeleton.count; j++) near(out.subarray(j * 12, j * 12 + 12), IDENTITY);
  });

  it("carries what hangs from a bone with the bone", () => {
    const skeleton = new Skeleton(toy());
    const pose = new Pose(skeleton);
    // b turns a quarter about z: c (a step along x from b) swings up to a step up from b
    const q = turnAbout(0, 0, 1, Math.PI / 2);
    pose.r.set(q, 4);
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, pose, IDENTITY, out);
    // a point at c's joint (2, 0, 0), skinned to c, ends at (1, 1, 0)
    near(apply(out, 2 * 12, [2, 0, 0]), [1, 1, 0]);
    // a point at b's joint stays; a point on d (not below b) stays
    near(apply(out, 1 * 12, [1, 0, 0]), [1, 0, 0]);
    near(apply(out, 3 * 12, [0, 1, 0]), [0, 1, 0]);
  });

  it("moves a bone away from its parent when the pose says so, and puts the world after it", () => {
    const skeleton = new Skeleton(toy());
    const pose = new Pose(skeleton);
    pose.t.set([0, 0, 5], 0); // the root, 5 along z
    const world = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30];
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, pose, world, out);
    near(apply(out, 2 * 12, [2, 0, 0]), [12, 20, 35]);
  });

  it("adds a turn about a bone's own joint, about the cat's axes, and carries what hangs from it", () => {
    const skeleton = new Skeleton(toy());
    const pose = new Pose(skeleton);
    // b turned a quarter about y by the added turn: c (a step along x from b) is carried to a step along -z from b
    const adjust: Adjust[] = [{ bone: 1, q: turnAbout(0, 1, 0, Math.PI / 2) }];
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, pose, IDENTITY, out, adjust);
    near(apply(out, 2 * 12, [2, 0, 0]), [1, 0, -1]);
    // and the joint it turns about stays where it is
    near(apply(out, 1 * 12, [1, 0, 0]), [1, 0, 0]);
  });

  it("makes a matrix of a quaternion that turns a point the way the quaternion says", () => {
    const m = new Float64Array(9);
    const [x, y, z, w] = turnAbout(0, 0, 1, Math.PI / 2);
    matrixOf(m, x, y, z, w);
    near(m, [0, -1, 0, 1, 0, 0, 0, 0, 1], 1e-9);
  });
});

describe("skinning by dual quaternions", () => {
  const skeleton = new Skeleton(toy());
  /** The point `p` skinned to `bones` (their weights), as the shader does it: with the bones `solveDual` gave. */
  const skinTo = (pose: Pose, p: [number, number, number], bones: number[], weights: number[], adjust?: Adjust[]): number[] => {
    const dq = new Float32Array(skeleton.count * 8);
    solveDual(skeleton, pose, dq, adjust);
    const skin = [0, 0, 0, 0];
    const weight = [0, 0, 0, 0];
    bones.forEach((b, i) => ((skin[i] = b), (weight[i] = weights[i]!)));
    const at = [0, 0, 0];
    dualSkin(dq, skin, weight, 0, 1, p[0], p[1], p[2], 0, 0, 1, at, [0, 0, 0]);
    return at;
  };

  it("leaves a point where it is, at rest, whatever bones carry it", () => {
    const pose = new Pose(skeleton);
    near(skinTo(pose, [0.3, 0.7, -0.2], [0], [1]), [0.3, 0.7, -0.2], 1e-6);
    near(skinTo(pose, [0.3, 0.7, -0.2], [2, 1, 3], [0.5, 0.3, 0.2]), [0.3, 0.7, -0.2], 1e-6);
  });

  it("puts a point carried by one bone where the bone's matrix puts it, for turns, moves and the added turns", () => {
    const pose = new Pose(skeleton);
    pose.r.set(turnAbout(0.6, 0.0, 0.8, 1.1), 4);
    pose.r.set(turnAbout(0, 1, 0, -0.7), 8);
    pose.t.set([0.2, 0.1, 0.4], 0);
    const adjust: Adjust[] = [{ bone: 3, q: turnAbout(1, 0, 0, 0.5) }];
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, pose, IDENTITY, out, adjust);
    for (let j = 0; j < skeleton.count; j++) near(skinTo(pose, [1.4, -0.3, 0.9], [j], [1], adjust), apply(out, j * 12, [1.4, -0.3, 0.9]), 1e-5);
  });

  it("keeps a point between two bones that are turned a half turn apart the distance it was from the axis, where matrices averaged bring it to the axis (the candy wrapper)", () => {
    const pose = new Pose(skeleton);
    // b is twisted a half turn about its own axis (along x, through (1, 0, 0)); a point one step off that axis is carried half by a and half by b
    pose.r.set(turnAbout(1, 0, 0, Math.PI), 4);
    const p: [number, number, number] = [1, 1, 0];
    const dual = skinTo(pose, p, [0, 1], [0.5, 0.5]);
    expect(Math.hypot(dual[1]!, dual[2]!)).toBeCloseTo(1, 5);
    const out = new Float32Array(skeleton.count * 12);
    solve(skeleton, pose, IDENTITY, out);
    const a = apply(out, 0, p);
    const b = apply(out, 12, p);
    const linear = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    expect(Math.hypot(linear[1]!, linear[2]!)).toBeLessThan(1e-5);
  });

  it("signs each bone on the side of the bone it hangs from, however far the limb is folded (the root, on the side of no turn)", () => {
    // b is turned 100 degrees from a, and c another 100 from b: c is 200 degrees from a, which the matrix alone says is 160 the other way round
    const pose = new Pose(skeleton);
    pose.r.set(turnAbout(0, 0, 1, (100 * Math.PI) / 180), 4);
    pose.r.set(turnAbout(0, 0, 1, (100 * Math.PI) / 180), 8);
    const dq = new Float32Array(skeleton.count * 8);
    solveDual(skeleton, pose, dq);
    const dot = (i: number, j: number): number => dq[i * 8]! * dq[j * 8]! + dq[i * 8 + 1]! * dq[j * 8 + 1]! + dq[i * 8 + 2]! * dq[j * 8 + 2]! + dq[i * 8 + 3]! * dq[j * 8 + 3]!;
    expect(dq[3]!).toBeGreaterThan(0);
    expect(dot(1, 0)).toBeGreaterThan(0);
    expect(dot(2, 1)).toBeGreaterThan(0);
    expect(dot(3, 0)).toBeGreaterThan(0);
    // (c's turn is the 200 degrees: its scalar part is that of a turn past a half)
    expect(dq[2 * 8 + 3]!).toBeLessThan(0);
  });

  it("puts a point where it is whichever bone it lists first: two points that carry the same bones in another order are not torn apart by a limb folded past a half turn", () => {
    // (the arrangement that tore the cat's inner elbow: weights a third each on the hips, the shoulder and the forearm, the forearm folded back 200 degrees from the hips)
    const pose = new Pose(skeleton);
    pose.r.set(turnAbout(0, 0, 1, (100 * Math.PI) / 180), 4);
    pose.r.set(turnAbout(0, 0, 1, (100 * Math.PI) / 180), 8);
    const dq = new Float32Array(skeleton.count * 8);
    solveDual(skeleton, pose, dq);
    const at = (bones: number[], weights: number[]): number[] => {
      const out = [0, 0, 0];
      dualSkin(dq, bones, weights, 0, 1, 0.9, 0.4, -0.2, 0, 1, 0, out, [0, 0, 0]);
      return out;
    };
    const first = at([0, 1, 2, 0], [0.35, 0.34, 0.31, 0]);
    for (const [bones, weights] of [
      [[2, 1, 0, 0], [0.31, 0.34, 0.35, 0]],
      [[1, 0, 2, 0], [0.34, 0.35, 0.31, 0]],
      [[2, 0, 1, 0], [0.31, 0.35, 0.34, 0]],
    ] as const) near(at([...bones], [...weights]), first, 1e-6);
    // and a point with weights that differ by a hundredth is a hundredth of the way from the other, not a limb away
    const near2 = at([1, 0, 2, 0], [0.35, 0.34, 0.31, 0]);
    expect(Math.hypot(near2[0]! - first[0]!, near2[1]! - first[1]!, near2[2]! - first[2]!)).toBeLessThan(0.05);
  });

  it("turns the normal with the blended turn and leaves it a unit", () => {
    const pose = new Pose(skeleton);
    pose.r.set(turnAbout(0, 0, 1, Math.PI / 2), 4);
    const dq = new Float32Array(skeleton.count * 8);
    solveDual(skeleton, pose, dq);
    const at = [0, 0, 0];
    const n = [0, 0, 0];
    dualSkin(dq, [1, 0, 0, 0], [1, 0, 0, 0], 0, 1, 2, 0, 0, 1, 0, 0, at, n);
    near(n, [0, 1, 0], 1e-6);
    dualSkin(dq, [0, 1, 0, 0], [0.5, 0.5, 0, 0], 0, 1, 2, 0, 0, 1, 0, 0, at, n);
    expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 6);
  });
});

/** A clip of the toy skeleton: b turns a quarter about z over four frames (a loop of eight: there and back), and d's place moves along x. */
const swing = (loop: boolean): ClipSource => {
  const frames = 4;
  const r: ClipSource["r"] = [null, null, null, null];
  const b = new Float64Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    const [x, y, z, w] = turnAbout(0, 0, 1, (Math.PI / 2) * (f / (frames - 1)));
    b.set([x, y, z, w], f * 4);
  }
  r[1] = b;
  r[2] = [0, 0, 0.7071068, 0.7071068]; // c holds a quarter turn throughout (no: this one is the same on every frame, so it is kept once)
  const t: ClipSource["t"] = [null, null, null, null];
  const d = new Float64Array(frames * 3);
  for (let f = 0; f < frames; f++) d.set([0.1 * f, 1, 0], f * 3);
  t[3] = d;
  return { name: "swing", fps: 4, frames, loop, stride: 0.5, marks: { top: 0.75 }, r, t };
};

describe("the cat's clips", () => {
  const data = toy();
  const skeleton = new Skeleton(data);
  const pack = (clips: ClipSource[]) => {
    const bytes = encodeClips(data, clips);
    return decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton);
  };

  it("are kept as what each bone does: nothing, one turn held, or a turn a frame", () => {
    const [clip] = pack([swing(false)]);
    expect(Array.from(clip!.rKind)).toEqual([0, 2, 1, 0]);
    expect(Array.from(clip!.tKind)).toEqual([0, 0, 0, 2]);
    expect(clip!.name).toBe("swing");
    expect(clip!.stride).toBe(0.5);
    expect(clip!.marks).toEqual({ top: 0.75 });
  });

  it("come back to the pose they were made of, to a few millionths of a turn", () => {
    const [clip] = pack([swing(false)]);
    const pose = new Pose(skeleton);
    for (let f = 0; f < 4; f++) {
      sampleFrame(clip!, f, pose);
      const [x, y, z, w] = turnAbout(0, 0, 1, (Math.PI / 2) * (f / 3));
      near(pose.r.subarray(4, 8), [x, y, z, w], 1e-4);
      near(pose.t.subarray(9, 12), [0.1 * f, 1, 0], 1e-6);
    }
    // c keeps its held turn; a keeps its rest
    near(pose.r.subarray(8, 12), [0, 0, 0.7071068, 0.7071068], 1e-4);
    near(pose.r.subarray(0, 4), [0, 0, 0, 1]);
  });

  it("play between frames along the short way round, and a looping one wraps while one played once holds its ends", () => {
    const once = pack([swing(false)])[0]!;
    const loop = pack([swing(true)])[0]!;
    const pose = new Pose(skeleton);
    sampleFrame(once, 1.5, pose);
    const [x, y, z, w] = turnAbout(0, 0, 1, (Math.PI / 2) * (1.5 / 3));
    near(pose.r.subarray(4, 8), [x, y, z, w], 2e-3);
    sampleFrame(once, 9, pose);
    near(pose.t.subarray(9, 12), [0.3, 1, 0], 1e-6);
    sampleFrame(once, -3, pose);
    near(pose.t.subarray(9, 12), [0, 1, 0], 1e-6);
    // a loop of four frames at frame 5 is the loop at frame 1
    const a = new Pose(skeleton);
    const b = new Pose(skeleton);
    sampleFrame(loop, 5, a);
    sampleFrame(loop, 1, b);
    near(a.r, b.r, 1e-6);
    near(a.t, b.t, 1e-6);
    expect(lengthOf(loop)).toBe(1);
    expect(lengthOf(once)).toBe(0.75);
    sampleClip(once, 0.75, a);
    sampleFrame(once, 3, b);
    near(a.r, b.r, 1e-9);
  });

  it("are refused by a skeleton they were not made for", () => {
    const bytes = encodeClips(data, [swing(false)]);
    const other = new Skeleton({ ...toy(), restT: [0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1, 0] });
    expect(() => decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, other)).toThrow();
    expect(skeletonStamp(toy())).not.toBe(skeletonStamp({ ...toy(), restT: [0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1, 0] }));
  });

  it("do not go the long way round when a turn and its negative follow each other", () => {
    const src = swing(false);
    // the second frame of b given as the negative of what it should be: the same turn
    const b = Array.from(src.r[1]!);
    for (let k = 0; k < 4; k++) b[4 + k] = -b[4 + k]!;
    src.r[1] = b;
    const [clip] = pack([src]);
    const pose = new Pose(skeleton);
    sampleFrame(clip!, 0.5, pose);
    const [x, y, z, w] = turnAbout(0, 0, 1, (Math.PI / 2) * (0.5 / 3));
    // (the angle at half a frame is close to the straight line between 0 and a third of the quarter turn)
    const s = pose.r[4]! * x + pose.r[5]! * y + pose.r[6]! * z + pose.r[7]! * w;
    expect(Math.abs(s)).toBeGreaterThan(0.9999);
  });

  it("blend along the short way round", () => {
    const a = new Pose(skeleton);
    const b = new Pose(skeleton);
    a.r.set(turnAbout(0, 0, 1, 0.2), 4);
    // the same turn as 0.6 about z, written as its negative
    const q = turnAbout(0, 0, 1, 0.6);
    b.r.set([-q[0], -q[1], -q[2], -q[3]], 4);
    const out = new Pose(skeleton);
    blend(out, a, b, 0.5);
    const want = turnAbout(0, 0, 1, 0.4);
    const s = out.r[4]! * want[0] + out.r[5]! * want[1] + out.r[6]! * want[2] + out.r[7]! * want[3];
    expect(Math.abs(s)).toBeGreaterThan(0.99999);
  });
});
