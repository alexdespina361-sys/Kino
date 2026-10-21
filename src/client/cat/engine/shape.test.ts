import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import type { Clip, Rect } from "../types";
import { BAND, coreOf, FOOT_SLACK, HALF_WIDTH, HEIGHT, reachOf, shapeCovers, shapeHits, standingMargin } from "./shape";
import { BANDS, CORES } from "./shape-table";

const L = 100;
const CLIPS = Object.keys(BANDS) as Clip[];

describe("the shape of the drawn cat", () => {
  it("is measured for every clip, from the feet up, with nothing missing in between", () => {
    expect(CLIPS.length).toBe(23);
    for (const clip of CLIPS) {
      const bands = BANDS[clip];
      expect(bands.length, clip).toBeGreaterThanOrEqual(4);
      expect(bands.length, clip).toBeLessThanOrEqual(16);
      for (const [back, front] of bands) {
        expect(Number.isFinite(back) && Number.isFinite(front), clip).toBe(true);
        expect(back + front, clip).toBeGreaterThan(0);
      }
    }
  });

  it("says how a cat is built: standing tallest, curled up lowest, and a tail that lies out behind a sitting cat along the floor", () => {
    const up = (clip: Clip) => reachOf(clip).up;
    expect(up("curl")).toBeLessThan(up("loaf"));
    expect(up("loaf")).toBeLessThan(up("sit"));
    expect(up("sit")).toBeLessThanOrEqual(up("stand") + BAND);
    // (what the old boxes had at half the width and half the height of it)
    expect(up("sit")).toBeGreaterThanOrEqual(1);
    expect(up("loaf")).toBeGreaterThan(0.7);
    const sit = reachOf("sit");
    expect(sit.back).toBeGreaterThan(0.9);
    expect(sit.front).toBeLessThan(0.7);
    // ...and it is a tail: the body of the same cat, a hand's breadth up, is not as long
    const [back] = BANDS.sit[4]!;
    expect(back).toBeLessThan(0.5);
  });

  it("has a core inside everything that is drawn", () => {
    for (const clip of CLIPS) {
      const [back, front, up] = coreOf(clip);
      const reach = reachOf(clip);
      expect(back, clip).toBeLessThanOrEqual(reach.back);
      expect(front, clip).toBeLessThanOrEqual(reach.front);
      expect(up, clip).toBeLessThanOrEqual(reach.up);
      expect(back + front, clip).toBeGreaterThan(0.5);
      expect(up, clip).toBeGreaterThan(0.3);
      expect(CORES[clip]).toBe(coreOf(clip));
    }
  });

  it("is the same turned round: what a cat that faces left covers is what one that faces right does, mirrored", () => {
    const rng = createRng(3);
    for (let i = 0; i < 400; i++) {
      const clip = CLIPS[rng.int(0, CLIPS.length - 1)]!;
      const rect: Rect = { x: rng.range(-150, 150), y: 800 - rng.range(0, 150), w: rng.range(5, 90), h: rng.range(5, 90) };
      const mirrored: Rect = { ...rect, x: -(rect.x + rect.w) };
      const x = rng.range(-60, 60);
      expect(shapeHits(clip, 1, x, 800, L, rect), `${clip} ${i}`).toBe(shapeHits(clip, -1, -x, 800, L, mirrored));
      expect(shapeCovers(clip, 1, x, 800, L, [rect]), `${clip} ${i}`).toBeCloseTo(shapeCovers(clip, -1, -x, 800, L, [mirrored]), 6);
    }
  });

  it("covers all of a rectangle that is in the middle of its body, none of one that is not, and the whole of its area for a screen-sized one", () => {
    const inside: Rect = { x: 500 + 0.05 * L, y: 800 - 0.45 * L, w: 0.1 * L, h: 0.1 * L };
    expect(shapeCovers("sit", 1, 500, 800, L, [inside])).toBeCloseTo(0.01 * L * L, 6);
    expect(shapeCovers("sit", 1, 900, 800, L, [inside])).toBe(0);
    for (const clip of CLIPS) {
      const all = BANDS[clip].reduce((sum, [back, front]) => sum + (back + front) * L * BAND * L, 0);
      expect(shapeCovers(clip, 1, 500, 800, L, [{ x: -5000, y: -5000, w: 10000, h: 10000 }]), clip).toBeCloseTo(all, 4);
    }
  });

  it("touches a rectangle only where it is drawn: above its head, below its feet, and far off are not", () => {
    // (a rectangle ahead of its nose, at the height of its head, and one the other side of it)
    const ahead = BANDS.stand[8]![1] * L;
    const nose: Rect = { x: 500 + ahead - 2, y: 800 - 0.85 * L, w: 10, h: 10 };
    expect(shapeHits("stand", 1, 500, 800, L, nose)).toBe(true);
    expect(shapeHits("stand", 1, 500 - 0.6 * L, 800, L, nose)).toBe(false);
    expect(shapeHits("stand", 1, 500, 800, L, { x: 450, y: 800 - 3 * L, w: 20, h: 20 })).toBe(false);
    // (the feet may touch the line a zone starts at, a little: not a zone that begins lower than that)
    const below = (gap: number): Rect => ({ x: 480, y: 800 + gap, w: 40, h: 50 });
    expect(shapeHits("stand", 1, 500, 800, L, below(FOOT_SLACK - 1))).toBe(true);
    expect(shapeHits("stand", 1, 500, 800, L, below(FOOT_SLACK + 1))).toBe(false);
    // (a sitting cat's tail along the floor behind it is hit by a zone there, and the cat the other way round is not)
    const floor: Rect = { x: 500 - 0.95 * L, y: 790, w: 10, h: 10 };
    expect(shapeHits("sit", 1, 500, 800, L, floor)).toBe(true);
    expect(shapeHits("sit", -1, 500, 800, L, floor)).toBe(false);
  });

  it("asks a ledge to keep from a zone as far as the cat reaches at the heights the zone is at", () => {
    const at = (fromFeet: number, tall: number): Rect => ({ x: 1000, y: 800 - fromFeet * L - tall * L, w: 100, h: tall * L });
    const head = standingMargin(at(0.8, 0.1), 800, L);
    const paws = standingMargin(at(0, 0.1), 800, L);
    expect(head).toBeGreaterThan(0.65 * L);
    expect(paws).toBeGreaterThan(0.35 * L);
    expect(paws).toBeLessThan(head);
    // (a zone above the cat, or below the line it is on, asks for nothing)
    expect(standingMargin(at(2, 0.3), 800, L)).toBe(0);
    expect(standingMargin({ x: 1000, y: 800 + FOOT_SLACK + 2, w: 100, h: 50 }, 800, L)).toBe(0);
    // (and one as tall as the cat, for all of it)
    expect(standingMargin(at(0, 1.5), 800, L)).toBeCloseTo(HALF_WIDTH * L, 6);
    expect(HEIGHT).toBeGreaterThanOrEqual(1);
  });
});
