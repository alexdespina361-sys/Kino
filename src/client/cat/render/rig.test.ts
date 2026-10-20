import { describe, expect, it } from "vitest";
import type { CatFrame, Clip } from "../types";
import { CatRig, type Solved } from "./rig";

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, ...over });

/** A cat in a clip for `seconds`, 60 frames a second: what the rig has at the end, and what it had along the way (`watch` is looked at every frame). */
function inClip(over: Partial<CatFrame>, seconds: number, watch?: (s: Solved, t: number) => void, seed = 3): Solved {
  const rig = new CatRig(seed);
  const base = frame(over);
  rig.snapTo(base, 100);
  const steps = Math.round(seconds * 60);
  for (let k = 0; k < steps; k++) {
    rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
    watch?.(rig.solved, k / 60);
  }
  return rig.solved;
}

describe("the cat's little scenes", () => {
  it("scratches behind its ear: the hind foot comes up to the head, the head goes down to it, and the knee is below the leg's line", () => {
    const s = inClip({ clip: "scratch" }, 1.5);
    const standing = inClip({ clip: "sit" }, 1.5);
    const toe = s.legs.hn.toe;
    // the foot is at the head (within the length of the head), and the head is lower than a sitting cat holds it
    expect(Math.hypot(toe.x - s.head.x, toe.y - s.head.y)).toBeLessThan(0.14);
    expect(s.head.y).toBeGreaterThan(standing.head.y + 0.1);
    // the knee is on the belly side of the line from the hip to the hock (below it, y being down), or on it when the leg is at full stretch,
    // and never behind and above (which is where the standing cat's way of bending would put it)
    const { root, mid, hock } = s.legs.hn;
    const side = (hock.x - root.x) * (mid.y - root.y) - (hock.y - root.y) * (mid.x - root.x);
    expect(side).toBeGreaterThan(-0.002);
    // the other hind foot stays where it is
    expect(s.legs.hf.toe.y).toBeCloseTo(0, 2);
  });

  it("works the foot fast while it scratches, and goes back to sitting when it is done", () => {
    const ys: number[] = [];
    inClip({ clip: "scratch" }, 1.5, (s, t) => {
      if (t > 0.8) ys.push(s.legs.hn.toe.y);
    });
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.02);
    // (the clip is over: a sit again, with the foot back on the ground)
    const rig = new CatRig(3);
    const scratching = frame({ clip: "scratch" });
    rig.snapTo(scratching, 100);
    for (let k = 0; k < 90; k++) rig.update({ ...scratching, clipTime: k / 60 }, 1 / 60, 100);
    const sitting = frame({ clip: "sit" });
    for (let k = 0; k < 150; k++) rig.update({ ...sitting, clipTime: k / 60 }, 1 / 60, 100);
    expect(rig.solved.legs.hn.toe.y).toBeGreaterThan(-0.02);
    expect(Math.abs(rig.solved.legs.hn.toe.y)).toBeLessThan(0.02);
  });

  it("kneads: the forepaws take turns to lift, never both at once, and it purrs with its eyes half shut", () => {
    let both = 0;
    let frontMax = 0;
    let farMax = 0;
    let minOpen = 1;
    inClip({ clip: "knead" }, 4, (s, t) => {
      if (t < 1) return;
      frontMax = Math.max(frontMax, s.legs.fn.lift);
      farMax = Math.max(farMax, s.legs.ff.lift);
      if (s.legs.fn.lift > 0.04 && s.legs.ff.lift > 0.04) both++;
      minOpen = Math.min(minOpen, s.head.openL);
    });
    expect(frontMax).toBeGreaterThan(0.05);
    expect(farMax).toBeGreaterThan(0.05);
    expect(both).toBe(0);
    expect(minOpen).toBeLessThan(0.6);
  });

  it("sniffs with its nose lower than its chest, its eyes down, and its feet where they were", () => {
    const s = inClip({ clip: "sniff" }, 1.5);
    const standing = inClip({ clip: "stand" }, 1.5);
    expect(s.head.y).toBeGreaterThan(standing.head.y + 0.3);
    expect(s.head.eyeY).toBeGreaterThan(0.6);
    expect(s.legs.fn.toe.y).toBeCloseTo(0, 2);
    expect(s.legs.hn.toe.y).toBeCloseTo(0, 2);
  });

  it("stalks low: its back is lower than a walking cat's, and its steps are shorter and lower", () => {
    // (the distance walked is what moves the legs: the same stretch of it for both)
    const walk = (clip: Clip, perSecond: number): { back: number; lift: number; swing: number } => {
      const rig = new CatRig(3);
      let odometer = 0;
      let lift = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let back = 0;
      for (let k = 0; k < 360; k++) {
        odometer += perSecond / 60;
        rig.update(frame({ clip, odometer, vx: perSecond, clipTime: k / 60 }), 1 / 60, 100);
        if (k > 180) {
          lift = Math.max(lift, rig.solved.legs.fn.lift, rig.solved.legs.hn.lift);
          lo = Math.min(lo, rig.solved.legs.fn.toe.x);
          hi = Math.max(hi, rig.solved.legs.fn.toe.x);
          back = rig.solved.pose.p.backMid.y;
        }
      }
      return { back, lift, swing: hi - lo };
    };
    const stalking = walk("stalk", 40);
    const walking = walk("walk", 95);
    // (y is down)
    expect(stalking.back).toBeGreaterThan(walking.back + 0.12);
    expect(stalking.lift).toBeLessThan(walking.lift);
    expect(stalking.swing).toBeLessThan(walking.swing);
    expect(stalking.lift).toBeGreaterThan(0.01);
  });

  it("wiggles its rump, up and from side to side, with its feet planted, before a pounce", () => {
    const xs: number[] = [];
    const feet: number[] = [];
    let rumpUp = 0;
    const still = inClip({ clip: "crouch" }, 1.5);
    inClip({ clip: "wiggle" }, 2, (s, t) => {
      if (t < 0.7) return;
      xs.push(s.pose.p.rumpTop.x);
      feet.push(s.legs.hn.toe.x);
      rumpUp = Math.max(rumpUp, still.pose.p.rumpTop.y - s.pose.p.rumpTop.y);
    });
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.025);
    expect(rumpUp).toBeGreaterThan(0.02);
    expect(Math.max(...feet) - Math.min(...feet)).toBeLessThan(0.005);
  });

  it("slow-blinks at a viewer now and then (shut for most of a second, not the quick blink of a moment)", () => {
    let longest = 0;
    let run = 0;
    inClip({ clip: "sit", viewer: true }, 40, (s) => {
      if (s.head.openL < 0.15) run += 1 / 60;
      else {
        longest = Math.max(longest, run);
        run = 0;
      }
    });
    expect(longest).toBeGreaterThan(0.4);
    // and not at one who is not looked at: only the quick blinks
    let quick = 0;
    run = 0;
    inClip({ clip: "sit" }, 40, (s) => {
      if (s.head.openL < 0.15) run += 1 / 60;
      else {
        quick = Math.max(quick, run);
        run = 0;
      }
    });
    expect(quick).toBeLessThan(0.3);
  });

  it("dreams: asleep, its ears flick and a forepaw jerks now and then, once, and is still again", () => {
    // (a curled cat's forepaw rests a hair off the ground: 0.01)
    let paw = 0;
    let ears = 0;
    let jerked = false;
    let stilled = false;
    inClip({ clip: "curl", drowsy: 1 }, 90, (s) => {
      paw = Math.max(paw, s.legs.fn.lift);
      ears = Math.max(ears, Math.abs(s.head.earL - s.head.earR));
      if (s.legs.fn.lift > 0.03) jerked = true;
      else if (jerked && s.legs.fn.lift < 0.012) stilled = true;
    });
    expect(paw).toBeGreaterThan(0.03);
    expect(ears).toBeGreaterThan(0.05);
    expect(stilled).toBe(true);
    // (awake, in the same posture, nothing of the kind)
    let awake = 0;
    inClip({ clip: "curl", drowsy: 0 }, 30, (s) => {
      awake = Math.max(awake, s.legs.fn.lift);
    });
    expect(awake).toBeLessThan(0.012);
  });

  it("keeps every number finite in every scene, however it is entered and left", () => {
    const clips: Clip[] = ["scratch", "knead", "sniff", "stalk", "wiggle", "sit", "loaf", "stand", "crouch"];
    const rig = new CatRig(9);
    let t = 0;
    for (const clip of [...clips, ...[...clips].reverse()]) {
      for (let k = 0; k < 45; k++) {
        t += 1 / 60;
        rig.update(frame({ clip, clipTime: t % 3, odometer: t * 40, vx: clip === "stalk" ? 40 : 0, progress: (t % 3) / 3 }), 1 / 60, 100);
        const s = rig.solved;
        const numbers = [s.head.x, s.head.y, s.head.rot, ...(["fn", "ff", "hn", "hf"] as const).flatMap((key) => [s.legs[key].mid.x, s.legs[key].mid.y, s.legs[key].hock.x, s.legs[key].hock.y, s.legs[key].toe.x, s.legs[key].toe.y]), ...s.tail.flatMap((j) => [j.x, j.y])];
        for (const n of numbers) expect(Number.isFinite(n), `${clip} at ${t.toFixed(2)}`).toBe(true);
      }
    }
  });
});
