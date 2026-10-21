import { describe, expect, it } from "vitest";
import { CatEngine } from "../engine/engine";
import { browseWorld, defaultPage, stepCat } from "../engine/sim";
import type { CatFrame, World } from "../types";
import { carried, type Rides } from "./carry";

/** What of the made-up page (see `browseWorld`) is on its scroller: the banner is, the top bar and the strip down the side are not, and the card with the focus is. */
const RIDES: Rides = { keepOut: [true, false, false, true], focus: true };

/** The world with every number rounded to the millionth (a shelf that is carried by a shift and one that is read there are the same place, give or take the last digit of a float). */
const rounded = (world: World): unknown => JSON.parse(JSON.stringify(world, (_key, value) => (typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value)));

describe("a page carried on to where its scroller is now", () => {
  it("moves what is on the scroller, with the rows, and leaves the foot of the screen and what is fixed where they are", () => {
    const page = { ...defaultPage(), names: true, focus: { row: 0, col: 2 } };
    const read = browseWorld(page);
    read.pointer = { x: 10, y: 20 };
    const before = JSON.stringify(read);
    const now = carried(read, -120, RIDES, 777);
    // (the read one is not touched)
    expect(JSON.stringify(read)).toBe(before);
    expect(now).not.toBe(read);
    expect(now.readAt).toBe(777);
    for (const [i, surface] of now.surfaces.entries()) expect(surface.y, surface.id).toBe(read.surfaces[i]!.y + (surface.kind === "shelfTop" ? -120 : 0));
    expect(now.surfaces.some((s) => s.kind === "fallbackFloor")).toBe(true);
    for (const [i, zone] of now.keepOut.entries()) expect(zone.y, `zone ${i}`).toBe(read.keepOut[i]!.y + (RIDES.keepOut[i] ? -120 : 0));
    for (const [i, target] of now.targets.entries()) expect(target.rect.y).toBe(read.targets[i]!.rect.y - 120);
    for (const [i, name] of now.soft!.entries()) expect(name.y).toBe(read.soft![i]!.y - 120);
    expect(now.focus!.y).toBe(read.focus!.y - 120);
    // (and what the page is otherwise is as it was)
    expect(now.pointer).toEqual({ x: 10, y: 20 });
    expect(now.bodyLength).toBe(read.bodyLength);
    expect(now.mode).toBe("browse");
    expect(now.targets[3]!.rect.x).toBe(read.targets[3]!.rect.x);
    expect(now.targets[3]!.surfaceId).toBe(read.targets[3]!.surfaceId);
  });

  it("leaves a card with the focus that is not on the scroller (a button of the banner) where it is", () => {
    const read = browseWorld({ ...defaultPage(), focus: { row: 1, col: 1 } });
    const now = carried(read, -50, { keepOut: RIDES.keepOut, focus: false }, 1);
    expect(now.focus).toEqual(read.focus);
  });

  it("is the page as a read at that moment would have it: the same, to the pixel", () => {
    for (const [from, to] of [
      [0, 120],
      [300, 40],
      [700, 700 + 333],
    ] as const) {
      const page = { ...defaultPage(), names: true, focus: { row: 1, col: 3 }, scroll: from };
      const read = browseWorld(page);
      const exact = browseWorld({ ...page, scroll: to });
      const now = carried(read, from - to, RIDES, 0);
      delete now.readAt;
      expect(rounded(now), `from ${from} to ${to}`).toEqual(rounded(exact));
    }
  });

  it("makes a cat on a page that is read only now and then ride its shelf as it does on a page that is read at every frame: the same frames, to the last decimal", () => {
    // (an hour of scroll in a few seconds, at sixty frames: five pixels a frame down, then twelve, then back up at nine; the page is read every sixth frame)
    const steps = [...Array.from({ length: 50 }, () => 5), ...Array.from({ length: 40 }, () => 12), ...Array.from({ length: 60 }, () => -9)];
    const run = (seed: number, carry: boolean | "stale"): CatFrame[] => {
      const page = defaultPage();
      const engine = new CatEngine(seed);
      const base = browseWorld(page);
      stepCat(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 1500, y: 511 } });
      stepCat(engine, base, 8);
      engine.send({ type: "cat.command", command: "sit" });
      stepCat(engine, base, 1);
      const frames: CatFrame[] = [];
      let read = base;
      let readScroll = page.scroll;
      let clock = 0;
      steps.forEach((step, i) => {
        page.scroll += step;
        clock += 1000 / 60;
        let world: World;
        if (carry === true) world = { ...browseWorld(page), readAt: clock };
        else {
          if (i % 6 === 0) {
            read = { ...browseWorld(page), readAt: clock };
            readScroll = page.scroll;
          }
          world = carry === "stale" || page.scroll === readScroll ? read : carried(read, readScroll - page.scroll, RIDES, clock);
        }
        stepCat(engine, world, 1 / 60, 60, (f) => {
          frames.push({ ...f });
        });
      });
      return frames;
    };
    for (const seed of [1, 2, 3]) {
      const fresh = run(seed, true);
      const onward = run(seed, false);
      expect(onward.map((f) => [f.x, f.y, f.grounded]), `seed ${seed}`).toEqual(fresh.map((f) => [f.x, f.y, f.grounded]));
      // (and a page that is not carried on is not that: the cat's feet are left behind by the shelf, a few frames of scroll at most, and caught up with at each read)
      const stale = run(seed, "stale");
      const worst = Math.max(...stale.map((f, i) => Math.abs(f.y - fresh[i]!.y)));
      expect(worst, `seed ${seed}`).toBeGreaterThan(20);
    }
  });
});
