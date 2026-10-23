import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatFrame } from "../../types";
import { CatRig, type Solved } from "../rig";
import { decodeClips, encodeClips, type ClipSource } from "./clipfile";
import { Director } from "./director";
import { decodeMesh } from "./format";
import { Skeleton } from "./pose";

const bufferOf = (name: string): ArrayBuffer => {
  const file = readFileSync(new URL(name, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false, ...over });

const solvedIn = (over: Partial<CatFrame>): Solved => {
  const rig = new CatRig(3);
  const base = frame(over);
  rig.snapTo(base, 100);
  for (let k = 0; k < 30; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
  return rig.solved;
};

describe("the director, getting up", () => {
  const mesh = decodeMesh(bufferOf("./cat.mesh"));
  const skeleton = new Skeleton(mesh.skeleton);
  const hips = skeleton.bone("Hips");
  const bones = skeleton.count;

  /** A clip that only moves the hips: from height `a` to `b` over `seconds`, then (when `loop`) back. (No bone turns: the hips' height is all the test looks at.) */
  const hipsClip = (name: string, a: number, b: number, seconds: number, loop = false): ClipSource => {
    const fps = 30;
    const frames = Math.round(seconds * fps) + 1;
    const t = new Float64Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      t[f * 3] = -0.4;
      t[f * 3 + 1] = a + (b - a) * (f / (frames - 1));
    }
    const places = new Array<Float64Array | null>(bones).fill(null);
    places[hips] = t;
    return { name, fps, frames, loop, stride: 0, marks: {}, r: new Array<null>(bones).fill(null), t: places };
  };
  const clipsOf = (...sources: ClipSource[]) => {
    const bytes = encodeClips(mesh.skeleton, sources);
    return decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, skeleton);
  };
  // (the cat stands at 0.5, goes down to 0.3 over a second and a half to lie, and to 0.32 to sit; the walk and the stand are level)
  const clips = () => clipsOf(hipsClip("stand", 0.5, 0.5, 1, true), hipsClip("walk", 0.5, 0.5, 1, true), hipsClip("loaf", 0.5, 0.3, 1.5), hipsClip("sit", 0.5, 0.32, 1.2), hipsClip("curl", 0.5, 0.28, 2));
  const height = (d: Director): number => d.pose.t[hips * 3 + 1]!;
  const play = (d: Director, s: Solved, seconds: number, each?: (t: number) => void): void => {
    for (let k = 0; k < Math.round(seconds * 60); k++) {
      d.update(s, 1 / 60, 100, 0);
      each?.((k + 1) / 60);
    }
  };

  it("gets a cat that lies up the way it lay down, not in a jump: a blend between the two would stand it in a third of a second", () => {
    const d = new Director(skeleton, clips());
    const lying = solvedIn({ clip: "loaf" });
    play(d, lying, 3);
    expect(height(d)).toBeCloseTo(0.3, 2);
    const standing = solvedIn({ clip: "stand" });
    let before = height(d);
    let worst = 0;
    const at: Record<string, number> = {};
    play(d, standing, 2, (t) => {
      worst = Math.max(worst, Math.abs(height(d) - before));
      before = height(d);
      if (Math.abs(t - 0.3) < 0.009) at.third = height(d);
      if (Math.abs(t - 1.8) < 0.009) at.late = height(d);
    });
    // (0.2 over a second: a picture at 60 to the second moves it by a few thousandths, and the cat is not half up at a third of a second)
    expect(worst).toBeLessThan(0.012);
    expect(at.third).toBeLessThan(0.42);
    expect(at.late).toBeCloseTo(0.5, 1);
  });

  it("gets up by the clip it went down by, whichever lying posture it was in, and also from the sitting acts, which are done from the sit", () => {
    const d = new Director(skeleton, clips());
    play(d, solvedIn({ clip: "curl", drowsy: 1 }), 3);
    expect(height(d)).toBeCloseTo(0.28, 2);
    play(d, solvedIn({ clip: "stand" }), 0.4);
    // (it rises by the curl clip, which goes lower: not a blend towards the loaf or the sit)
    expect(height(d)).toBeGreaterThan(0.28);
    expect(height(d)).toBeLessThan(0.45);
  });

  it("does not get up for a posture that is walked, run or leapt into, nor when the cat is picked up, but blends over more than a third of a second", () => {
    const d = new Director(skeleton, clips());
    play(d, solvedIn({ clip: "loaf" }), 3);
    const walking = solvedIn({ clip: "walk", vx: 150 });
    let before = height(d);
    let worst = 0;
    play(d, walking, 1, () => {
      worst = Math.max(worst, Math.abs(height(d) - before));
      before = height(d);
    });
    expect(height(d)).toBeCloseTo(0.5, 2);
    // (a blend over half a second takes 0.2 in about 0.5: at most 0.012 a picture at the middle of the ease)
    expect(worst).toBeLessThan(0.02);
    const e = new Director(skeleton, clips());
    play(e, solvedIn({ clip: "loaf" }), 3);
    play(e, solvedIn({ clip: "stand", carried: true, grounded: false }), 0.1);
    // (taken up from a lying position: the blend is the only thing it can be, and it has started)
    expect(height(e)).toBeGreaterThan(0.3);
  });

  it("passes on from where it is if what the engine wants changes while the cat is getting up (no jump)", () => {
    const d = new Director(skeleton, clips());
    play(d, solvedIn({ clip: "loaf" }), 3);
    play(d, solvedIn({ clip: "stand" }), 0.3);
    let before = height(d);
    let worst = 0;
    play(d, solvedIn({ clip: "walk", vx: 150 }), 1, () => {
      worst = Math.max(worst, Math.abs(height(d) - before));
      before = height(d);
    });
    expect(worst).toBeLessThan(0.02);
    expect(height(d)).toBeCloseTo(0.5, 2);
  });

  it("goes from lying to sitting by a blend (the cat does not stand up to sit down) that takes its time", () => {
    const d = new Director(skeleton, clips());
    play(d, solvedIn({ clip: "loaf" }), 3);
    let top = 0;
    play(d, solvedIn({ clip: "sit" }), 1.5, () => {
      top = Math.max(top, height(d));
    });
    // (the sit clip goes down from standing: the blend meets it on the way, not at the top)
    expect(top).toBeLessThan(0.5);
  });

  it("starts again with a cat that has just appeared when it is told to (the lab draws one cat in many places)", () => {
    const d = new Director(skeleton, clips());
    play(d, solvedIn({ clip: "loaf" }), 3);
    play(d, solvedIn({ clip: "stand" }), 0.1);
    d.restart();
    play(d, solvedIn({ clip: "stand" }), 0.05);
    expect(height(d)).toBeCloseTo(0.5, 2);
    expect(d.blending).toBe(false);
  });
});
