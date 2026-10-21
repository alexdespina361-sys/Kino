import { describe, expect, it } from "vitest";
import type { CatFrame, Clip } from "../types";
import { CatRig, type Solved } from "./rig";

const frame = (over: Partial<CatFrame>): CatFrame => ({ x: 0, y: 0, facing: 1, clip: "stand", clipTime: 0, progress: 0, odometer: 0, vx: 0, vy: 0, grounded: true, viewer: false, drowsy: 0, energy: 0.3, appear: 1, petted: false, carried: false, ...over });

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

  /** A cat covering ground in `clip` at `perSecond` body lengths a second for `seconds`, 60 frames a second (px = 100): `watch` sees each frame after the first second. */
  const covering = (steps: { clip: Clip; perSecond: number; seconds: number }[], watch: (s: Solved, clip: Clip) => void, seed = 3): void => {
    const rig = new CatRig(seed);
    let odometer = 0;
    let t = 0;
    for (const step of steps) {
      for (let k = 0; k < Math.round(step.seconds * 60); k++) {
        odometer += (step.perSecond * 100) / 60;
        t += 1 / 60;
        rig.update(frame({ clip: step.clip, odometer, vx: step.perSecond * 100, clipTime: t }), 1 / 60, 100);
        if (t > 1) watch(rig.solved, step.clip);
      }
    }
  };
  const correlation = (a: number[], b: number[]): number => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
      ab += (a[i]! - ma) * (b[i]! - mb);
      aa += (a[i]! - ma) ** 2;
      bb += (b[i]! - mb) ** 2;
    }
    return ab / Math.sqrt(aa * bb || 1);
  };

  it("gallops when it runs: the paws land in pairs with the body in the air between, the body rocks over them, and the tail streams out behind", () => {
    const lifts = { fn: [] as number[], ff: [] as number[], hn: [] as number[], hf: [] as number[] };
    const rump: number[] = [];
    const shoulder: number[] = [];
    let allUp = 0;
    let tail = { dx: 0, dy: 0 };
    covering([{ clip: "run", perSecond: 2.6, seconds: 6 }], (s) => {
      for (const key of ["fn", "ff", "hn", "hf"] as const) lifts[key].push(s.legs[key].lift);
      rump.push(s.pose.p.rumpTop.y);
      shoulder.push(s.pose.p.shoulderTop.y);
      if ((["fn", "ff", "hn", "hf"] as const).every((key) => s.legs[key].lift > 0.02)) allUp++;
      tail = { dx: s.tail[s.tail.length - 1]!.x - s.tail[0]!.x, dy: s.tail[s.tail.length - 1]!.y - s.tail[0]!.y };
    });
    // (the two hind paws go together, and the two front, and the pairs take turns)
    expect(correlation(lifts.hn, lifts.hf)).toBeGreaterThan(0.5);
    expect(correlation(lifts.fn, lifts.ff)).toBeGreaterThan(0.5);
    expect(correlation(lifts.hn, lifts.fn)).toBeLessThan(0.2);
    // (a walk's paws go one at a time: the two hind ones against each other)
    const walkLifts = { hn: [] as number[], hf: [] as number[] };
    let walkAllUp = 0;
    covering([{ clip: "walk", perSecond: 1, seconds: 6 }], (s) => {
      walkLifts.hn.push(s.legs.hn.lift);
      walkLifts.hf.push(s.legs.hf.lift);
      if ((["fn", "ff", "hn", "hf"] as const).every((key) => s.legs[key].lift > 0.02)) walkAllUp++;
    });
    expect(correlation(walkLifts.hn, walkLifts.hf)).toBeLessThan(0);
    expect(walkAllUp).toBe(0);
    // (and a gallop has a time when every paw is off the ground)
    expect(allUp / lifts.hn.length).toBeGreaterThan(0.05);
    // (the rump and the shoulders rock the opposite ways, by a few hundredths of the body)
    expect(Math.max(...rump) - Math.min(...rump)).toBeGreaterThan(0.04);
    expect(correlation(rump, shoulder)).toBeLessThan(-0.2);
    // (the tail is out behind, not up and over)
    expect(tail.dx).toBeLessThan(-0.45);
    expect(tail.dy).toBeGreaterThan(-0.3);
  });

  it("does not jump when it breaks into a run, slows to a walk, creeps up on something or stops (no joint moves more than a fifth of the body in one frame: a leg used to go by 0.4)", () => {
    let previous: number[] | null = null;
    let biggest = 0;
    const joints = (s: Solved): number[] => [
      ...(["fn", "ff", "hn", "hf"] as const).flatMap((key) => [s.legs[key].toe.x, s.legs[key].toe.y, s.legs[key].mid.x, s.legs[key].mid.y, s.legs[key].hock.x, s.legs[key].hock.y]),
      s.head.x,
      s.head.y,
      s.tail[s.tail.length - 1]!.x,
      s.tail[s.tail.length - 1]!.y,
    ];
    covering(
      [
        { clip: "walk", perSecond: 1, seconds: 3 },
        { clip: "run", perSecond: 2.6, seconds: 3 },
        { clip: "walk", perSecond: 1, seconds: 3 },
        { clip: "run", perSecond: 2.6, seconds: 3 },
        { clip: "stand", perSecond: 0, seconds: 3 },
        // (the hunt: a walk, the creep, the wiggle before the pounce, and a walk again)
        { clip: "walk", perSecond: 1, seconds: 3 },
        { clip: "stalk", perSecond: 0.4, seconds: 3 },
        { clip: "wiggle", perSecond: 0, seconds: 2 },
        { clip: "walk", perSecond: 1, seconds: 3 },
      ],
      (s) => {
        const now = joints(s);
        if (previous) for (let i = 0; i + 1 < now.length; i += 2) biggest = Math.max(biggest, Math.hypot(now[i]! - previous[i]!, now[i + 1]! - previous[i + 1]!));
        previous = now;
      },
    );
    expect(biggest).toBeLessThan(0.2);
  });

  /** Where a joint is seen once the whole cat is tipped (about the middle of its body): x the way it faces and y up, in body lengths from its feet. */
  const seen = (s: Solved, j: { x: number; y: number }) => {
    const c = Math.cos(s.pitch);
    const si = Math.sin(s.pitch);
    return { x: j.x * c - (j.y + 0.4) * si, y: -(j.x * si + (j.y + 0.4) * c - 0.4) };
  };
  const inHand = (seconds: number, over: Partial<CatFrame> = {}) => inClip({ clip: "stand", carried: true, grounded: false, viewer: true, ...over }, seconds);

  it("hangs by the scruff: nearly upright, the head at the top, the hind legs and the tail below the body, the ears back, the eyes wide, and no shadow", () => {
    const s = inHand(3);
    const standing = inClip({ clip: "stand" }, 3);
    expect(s.pitch).toBeLessThan(-1.0);
    expect(s.pitch).toBeGreaterThan(-1.4);
    const head = seen(s, s.head);
    const hip = seen(s, s.pose.p.hip);
    expect(head.y).toBeGreaterThan(hip.y + 0.6);
    for (const key of ["hn", "hf"] as const) expect(seen(s, s.legs[key].toe).y).toBeLessThan(hip.y - 0.25);
    const tail = s.tail.map((j) => seen(s, j));
    expect(tail[tail.length - 1]!.y).toBeLessThan(tail[0]!.y - 0.4);
    expect(s.head.earL).toBeGreaterThan(standing.head.earL + 0.2);
    expect(s.head.pupil).toBeGreaterThan(standing.head.pupil + 0.3);
    expect(s.shadow).toBeLessThan(0.05);
    expect(standing.shadow).toBe(1);
  });

  it("tips over and rights itself in about a third of a second, and nothing snaps on the way (no joint moves more than 0.3 of the body in a frame; the tail's tip used to go by 0.7)", () => {
    const rig = new CatRig(5);
    rig.snapTo(frame({}), 100);
    let previous: number[] | null = null;
    let biggest = 0;
    const joints = (s: Solved): number[] =>
      [...(["fn", "ff", "hn", "hf"] as const).flatMap((key) => [s.legs[key].toe, s.legs[key].mid, s.legs[key].hock]), s.head, s.tail[s.tail.length - 1]!].flatMap((j) => {
        const at = seen(s, j);
        return [at.x, at.y];
      });
    let t = 0;
    const pitches: number[] = [];
    for (const [carried, frames] of [[false, 60], [true, 120], [false, 120]] as const) {
      for (let k = 0; k < frames; k++) {
        t += 1 / 60;
        rig.update(frame({ carried, grounded: !carried, viewer: carried, clipTime: t }), 1 / 60, 100);
        const now = joints(rig.solved);
        for (const n of now) expect(Number.isFinite(n)).toBe(true);
        if (previous) for (let i = 0; i + 1 < now.length; i += 2) biggest = Math.max(biggest, Math.hypot(now[i]! - previous[i]!, now[i + 1]! - previous[i + 1]!));
        previous = now;
        pitches.push(rig.solved.pitch);
      }
    }
    expect(biggest).toBeLessThan(0.3);
    // (the turn is mostly done a third of a second after the hand takes hold, and the cat is the right way up again a third of a second after it is let go)
    expect(pitches[60 + 20]!).toBeLessThan(-0.9);
    expect(pitches[60 + 120 + 20]!).toBeGreaterThan(-0.25);
    expect(Math.abs(pitches[pitches.length - 1]!)).toBeLessThan(0.02);
  });

  it("swings under the hand like a pendulum: taken fast one way it is tipped further, and it hangs as it did once the hand is still", () => {
    const rig = new CatRig(5);
    const base = frame({ carried: true, grounded: false, viewer: true });
    rig.snapTo(base, 100);
    for (let k = 0; k < 120; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
    const still = rig.solved.pitch;
    let furthest = 0;
    for (let k = 0; k < 40; k++) {
      rig.update({ ...base, vx: 100 * (k / 40) * 8, clipTime: 2 + k / 60 }, 1 / 60, 100);
      furthest = Math.max(furthest, Math.abs(rig.solved.pitch - still));
    }
    expect(furthest).toBeGreaterThan(0.05);
    for (let k = 0; k < 240; k++) rig.update({ ...base, clipTime: 3 + k / 60 }, 1 / 60, 100);
    expect(Math.abs(rig.solved.pitch - still)).toBeLessThan(0.02);
  });

  it("keeps every number finite in every scene, however it is entered and left", () => {
    const clips: Clip[] = ["scratch", "knead", "sniff", "stalk", "wiggle", "sit", "loaf", "stand", "crouch", "peek", "tap", "doze", "shift", "curl"];
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

describe("the cat with the page: looking over an edge, batting at the pointer, nodding off, turning in its sleep, and what it feels", () => {
  const tip = (s: Solved) => s.tail[s.tail.length - 1]!;

  it("peeks over an edge: the front of it goes down and forward, the head low and out over what it looks at, and its feet stay where they were", () => {
    const look = { x: 240, y: 230 };
    const standing = inClip({ clip: "stand", look }, 1.5);
    const peek = inClip({ clip: "peek", look }, 1.5);
    // (y is down)
    expect(peek.head.y).toBeGreaterThan(standing.head.y + 0.12);
    expect(peek.head.x).toBeGreaterThan(standing.head.x + 0.05);
    expect(peek.pose.p.chestFront.y).toBeGreaterThan(standing.pose.p.chestFront.y + 0.02);
    for (const key of ["fn", "ff", "hn", "hf"] as const) expect(peek.legs[key].toe.y, key).toBeCloseTo(0, 2);
  });

  it("bats at the pointer: the forepaw is up at the height of what it reaches for, goes out and comes back again and again, and the other feet stay down", () => {
    const reach = { x: 96, y: -72 };
    const xs: number[] = [];
    const s = inClip({ clip: "tap", reach, look: reach }, 3.5, (sol, t) => {
      if (t > 1) xs.push(sol.legs.fn.toe.x);
    });
    const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
    let beats = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i - 1]! < mid && xs[i]! >= mid) beats++;
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.08);
    // (about two and a half a second)
    expect(beats).toBeGreaterThanOrEqual(4);
    expect(s.legs.fn.toe.y).toBeLessThan(-0.3);
    for (const key of ["ff", "hn", "hf"] as const) expect(Math.abs(s.legs[key].toe.y), key).toBeLessThan(0.03);
  });

  it("nods off: the head sinks and comes up with a jerk, the eyes heavy and then open a little, again and again", () => {
    const ys: number[] = [];
    const open: number[] = [];
    inClip({ clip: "doze", drowsy: 0.62 }, 8, (s) => {
      ys.push(s.head.y);
      open.push(s.head.openL);
    });
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.06);
    expect(Math.min(...open)).toBeLessThan(0.22);
    expect(Math.max(...open)).toBeGreaterThan(0.4);
    // (a doze is not a sleep: the eyes are not shut for good, and the cat does not curl up)
    const asleep = inClip({ clip: "curl", drowsy: 1 }, 2);
    expect(Math.max(...ys)).toBeLessThan(asleep.head.y - 0.15);
  });

  it("turns in its sleep: the head comes up and an eye opens a little, and it is curled up just as it was when it is done", () => {
    const rig = new CatRig(3);
    const base = frame({ clip: "curl", drowsy: 1 });
    rig.snapTo(base, 100);
    for (let k = 0; k < 120; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
    const asleep = { y: rig.solved.head.y, x: rig.solved.head.x, open: rig.solved.head.openL, tail: tip(rig.solved).x };
    let highest = Infinity;
    let widest = 0;
    const total = 2.8;
    for (let k = 0; k < total * 60; k++) {
      rig.update({ ...base, clip: "shift", progress: k / 60 / total, clipTime: k / 60 }, 1 / 60, 100);
      highest = Math.min(highest, rig.solved.head.y);
      widest = Math.max(widest, rig.solved.head.openL);
    }
    expect(highest).toBeLessThan(asleep.y - 0.2);
    expect(widest).toBeGreaterThan(asleep.open + 0.25);
    for (let k = 0; k < 180; k++) rig.update({ ...base, clipTime: k / 60 }, 1 / 60, 100);
    expect(rig.solved.head.y).toBeCloseTo(asleep.y, 2);
    expect(rig.solved.head.x).toBeCloseTo(asleep.x, 2);
    expect(rig.solved.head.openL).toBeCloseTo(asleep.open, 2);
  });

  it("shows what it feels in its face and its tail: ears up and the tail lifted for joy, ears flat and eyes wide for a fright, the head low and the eyes heavy for a letdown, the head cocked", () => {
    for (const clip of ["sit", "stand"] as const) {
      const none = inClip({ clip }, 1.5);
      const joy = inClip({ clip, emote: "joy" }, 1.5);
      expect(joy.head.earL, clip).toBeLessThan(none.head.earL - 0.05);
      // (a sitting cat's tail lies along the floor, and is lifted high; a standing cat's is carried up already)
      if (clip === "sit") expect(tip(joy).y).toBeLessThan(tip(none).y - 0.3);
      else expect(tip(joy).y).toBeLessThanOrEqual(tip(none).y);
      const startle = inClip({ clip, emote: "startle" }, 1.5);
      expect(startle.head.earL, clip).toBeGreaterThan(0.8);
      expect(startle.head.pupil, clip).toBeGreaterThan(0.95);
      const droop = inClip({ clip, emote: "droop" }, 1.5);
      expect(droop.head.y, clip).toBeGreaterThan(none.head.y + 0.03);
      expect(droop.head.openL, clip).toBeLessThan(0.85);
      expect(droop.head.earL, clip).toBeGreaterThan(none.head.earL + 0.2);
      for (const emote of ["tilt", "think"] as const) {
        const s = inClip({ clip, emote, viewer: emote === "tilt" }, 1.5);
        expect(Math.abs(s.head.rot - none.head.rot), `${clip} ${emote}`).toBeGreaterThan(0.3);
      }
    }
  });

  it("goes into a feeling and out of it, into a scene and out of it, without a joint snapping (none moves more than a fifth of the body in one frame)", () => {
    const rig = new CatRig(4);
    rig.snapTo(frame({ clip: "sit" }), 100);
    const joints = (s: Solved): number[] => [
      ...(["fn", "ff", "hn", "hf"] as const).flatMap((key) => [s.legs[key].toe.x, s.legs[key].toe.y, s.legs[key].mid.x, s.legs[key].mid.y]),
      s.head.x,
      s.head.y,
      tip(s).x,
      tip(s).y,
    ];
    let previous: number[] | null = null;
    let biggest = 0;
    let where = "";
    let t = 0;
    const scenes: Array<[Partial<CatFrame>, number]> = [
      [{ clip: "sit" }, 1],
      [{ clip: "sit", emote: "startle" }, 0.6],
      [{ clip: "sit" }, 1],
      [{ clip: "sit", emote: "joy" }, 1.5],
      [{ clip: "stand", emote: "droop" }, 1.5],
      [{ clip: "stand", emote: "tilt", viewer: true }, 1.5],
      [{ clip: "stand", emote: "think" }, 1.5],
      [{ clip: "stand" }, 1],
      [{ clip: "peek", look: { x: 240, y: 230 } }, 2],
      [{ clip: "stand" }, 1],
      [{ clip: "tap", reach: { x: 96, y: -72 }, look: { x: 96, y: -72 } }, 2.5],
      [{ clip: "sit" }, 1.5],
      [{ clip: "loaf" }, 1],
      [{ clip: "doze", drowsy: 0.62 }, 5],
      [{ clip: "curl", drowsy: 1 }, 2],
      [{ clip: "shift", drowsy: 1 }, 2.8],
      [{ clip: "curl", drowsy: 1 }, 2],
    ];
    for (const [scene, [over, seconds]] of scenes.entries()) {
      const n = Math.round(seconds * 60);
      for (let k = 0; k < n; k++) {
        t += 1 / 60;
        rig.update(frame({ ...over, clipTime: t % 4, progress: over.clip === "shift" ? k / n : 0 }), 1 / 60, 100);
        const now = joints(rig.solved);
        for (const x of now) expect(Number.isFinite(x)).toBe(true);
        if (previous) {
          for (let i = 0; i + 1 < now.length; i += 2) {
            const step = Math.hypot(now[i]! - previous[i]!, now[i + 1]! - previous[i + 1]!);
            if (step > biggest) {
              biggest = step;
              where = `scene ${scene} ${JSON.stringify(over)} frame ${k} joint ${i / 2}: ${step.toFixed(3)}`;
            }
          }
        }
        previous = now;
      }
    }
    expect(biggest, where).toBeLessThan(0.2);
  });
});
