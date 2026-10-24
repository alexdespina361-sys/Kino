import { describe, expect, it, vi } from "vitest";
import { createRng } from "../rng";
import type { CatEvent, CatFrame, Rect, Surface, Target, World } from "../types";
import { CLIMB_BACK, CLIMB_HANG, CLIMB_LIP, CLIMB_TIME, JUMP_LANDING, JUMP_TAKEOFF, SWAT_HIT } from "../types";
import { CatEngine } from "./engine";
import { computeLedges, findPath, GRAVITY, jumpAt, ledgeAt, MAX_DOWN, MAX_UP, planJump, reshape, restSpot, SCALE_MAX, screenEdges, settledCost, STEP_MAX, STEP_MIN, stepFlight, type Clutter, type Ledge, type RestPose } from "./ledges";
import { shapeCovers, shapeHits } from "./shape";
import { browseWorld, defaultPage, playerWorld, runSession, stepCat, type PageOptions } from "./sim";
import { BASELINE, GINGER, RAGDOLL, tasteFor, temperamentOf } from "./temperament";
import { tvLibrary } from "./tv-library.fixture";

const L = 92;

// (the longest of these step the brain through hours of a made-up afternoon: 3 to 5 seconds on a quiet machine, and a machine that is busy with something else takes twice that)
vi.setConfig({ testTimeout: 30_000 });

describe("rng", () => {
  it("gives the same numbers for the same seed, and others for another", () => {
    const a = createRng(5);
    const b = createRng(5);
    const c = createRng(6);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("chooses by weight, never an item with no weight, and nothing from nothing", () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) expect(rng.weighted(["a", "b", "c"], (x) => (x === "b" ? 1 : 0))).toBe("b");
    expect(rng.weighted([], () => 1)).toBeUndefined();
    expect(rng.weighted(["a"], () => 0)).toBeUndefined();
  });
  it("forks give streams of their own", () => {
    const rng = createRng(9);
    const f1 = rng.fork("x");
    const f2 = rng.fork("y");
    expect(f1.next()).not.toBe(f2.next());
  });
});

describe("ledges", () => {
  const world = (over: Partial<World> = {}): World => ({
    viewport: { x: 0, y: 0, w: 1920, h: 1080 },
    bodyLength: L,
    surfaces: [{ id: "row", kind: "shelfTop", y: 800, x0: 100, x1: 1500, weight: 1 }],
    keepOut: [],
    targets: [],
    mode: "browse",
    player: "none",
    controlsUp: false,
    quiet: false,
    reducedMotion: false,
    ...over,
  });

  it("is the whole surface, less the cat's own width, when nothing is in the way", () => {
    const [ledge, ...rest] = computeLedges(world());
    expect(rest).toHaveLength(0);
    expect(ledge!.x0).toBeGreaterThan(100);
    expect(ledge!.x1).toBeLessThan(1500);
    expect(ledge!.y).toBe(800);
  });

  it("is cut in pieces by a zone that stands where the cat's body would be, and by nothing that is elsewhere", () => {
    const cut = computeLedges(world({ keepOut: [{ x: 700, y: 650, w: 200, h: 100 }] }));
    expect(cut).toHaveLength(2);
    // (above the cat's head: no matter; below its feet: no matter)
    expect(computeLedges(world({ keepOut: [{ x: 700, y: 100, w: 200, h: 100 }] }))).toHaveLength(1);
    expect(computeLedges(world({ keepOut: [{ x: 700, y: 900, w: 200, h: 100 }] }))).toHaveLength(1);
    const [a, b] = cut;
    expect(a!.x1).toBeLessThan(700);
    expect(b!.x0).toBeGreaterThan(900);
  });

  it("leaves out a stretch with no room for the cat, and a surface that is off the screen", () => {
    expect(computeLedges(world({ keepOut: [{ x: 90, y: 700, w: 1420, h: 100 }] }))).toHaveLength(0);
    expect(computeLedges(world({ surfaces: [{ id: "low", kind: "shelfTop", y: 1500, x0: 0, x1: 1900, weight: 1 }] }))).toHaveLength(0);
    expect(computeLedges(world({ surfaces: [{ id: "high", kind: "shelfTop", y: 20, x0: 0, x1: 1900, weight: 1 }] }))).toHaveLength(0);
  });

  describe("settling clear of words and zones", () => {
    const ledge: Ledge = { id: "row#0", surfaceId: "row", kind: "shelfTop", y: 800, x0: 100, x1: 1500, weight: 1 };
    const around = (over: Partial<Clutter> = {}): Clutter => ({ keepOut: [], viewport: { x: 0, y: 0, w: 1920, h: 1080 }, ...over });
    /** A name as wide as a card's, hanging low over the shelf, where a cat sitting there has its haunches and its tail. */
    const name = (x: number, tall = 0.4): Rect => ({ x, y: 800 - 0.3 * L - tall * L / 2, w: 1.6 * L, h: tall * L });
    const covers = (x: number, facing: 1 | -1, rects: Rect[], pose: RestPose = "sit"): number => shapeCovers(pose, facing, x, 800, L, rects);

    it("counts how much of the words a cat settled in a posture would cover: what is drawn of it, and a cat lying down covers less high up than one sitting up", () => {
      // (a word in the middle of its body: all of it; one far off: none; one half under its side)
      const inside = { x: 500 + 0.05 * L, y: 800 - 0.45 * L, w: 0.1 * L, h: 0.1 * L };
      expect(covers(500, 1, [inside])).toBeCloseTo(0.01 * L * L, 6);
      expect(covers(900, 1, [inside])).toBe(0);
      // (the tail of a sitting cat lies out behind it along the floor, and is not where it faces)
      const tail = { x: 500 - 0.9 * L, y: 800 - 0.15 * L, w: 0.1 * L, h: 0.1 * L };
      expect(covers(500, 1, [tail])).toBeGreaterThan(0);
      expect(covers(500, -1, [tail])).toBe(0);
      // (a word above the head is not covered)
      expect(covers(500, 1, [{ x: 480, y: 800 - 1.6 * L, w: 40, h: 20 }])).toBe(0);
      // (a word at a height where the sitting cat's head is, nine tenths of a body length from the floor, and not the lying one's)
      const high = { x: 500, y: 800 - 0.9 * L, w: 0.3 * L, h: 0.1 * L };
      expect(covers(500, 1, [high])).toBeGreaterThan(0);
      for (const lying of ["loaf", "curl"] as const) expect(covers(500, 1, [high], lying), lying).toBe(0);
    });

    it("has nothing to say when there are no words, or none under the cat", () => {
      expect(restSpot(ledge, 700, 1, L, "sit", around())).toBeUndefined();
      expect(restSpot(ledge, 700, 1, L, "sit", around({ soft: [] }))).toBeUndefined();
      expect(restSpot(ledge, 700, 1, L, "sit", around({ soft: [name(1000)] }))).toBeUndefined();
      // (a name that is above a cat lying down is no reason to move it)
      expect(restSpot(ledge, 700, 1, L, "loaf", around({ soft: [{ x: 700 - 0.8 * L, y: 800 - 1.15 * L, w: 1.6 * L, h: 0.1 * L }] }))).toBeUndefined();
    });

    it("finds a place on the shelf where the cat covers (nearly) none of them, and not a long walk off", () => {
      const words = [name(700 - 0.8 * L), name(1000), name(1300)];
      const here = covers(700, 1, words);
      expect(here).toBeGreaterThan(0.25 * L * L);
      const spot = restSpot(ledge, 700, 1, L, "sit", around({ soft: words }))!;
      expect(spot).toBeDefined();
      expect(covers(spot, spot > 700 ? 1 : -1, words)).toBeLessThan(here / 2);
      expect(Math.abs(spot - 700)).toBeGreaterThanOrEqual(0.25 * L);
      expect(Math.abs(spot - 700)).toBeLessThanOrEqual(3.5 * L + 1);
      expect(spot).toBeGreaterThanOrEqual(ledge.x0);
      expect(spot).toBeLessThanOrEqual(ledge.x1);
    });

    it("prefers the nearer of two clear places", () => {
      const words = [name(700 - 0.8 * L)];
      const left = restSpot(ledge, 690, 1, L, "sit", around({ soft: words }))!;
      const right = restSpot(ledge, 710, 1, L, "sit", around({ soft: words }))!;
      expect(left).toBeLessThan(690);
      expect(right).toBeGreaterThan(710);
      // (a hair's breadth of a letter under its side is not covering it)
      expect(covers(left, -1, words)).toBeLessThan(0.01 * L * L);
      expect(covers(right, 1, words)).toBeLessThan(0.01 * L * L);
    });

    it("stays on its shelf, and leaves it be when words are everywhere", () => {
      const nearTheEnd = restSpot(ledge, ledge.x0 + 5, -1, L, "sit", around({ soft: [name(ledge.x0 - 0.2 * L)] }))!;
      expect(nearTheEnd).toBeGreaterThanOrEqual(ledge.x0);
      expect(restSpot(ledge, 700, 1, L, "sit", around({ soft: [{ x: 0, y: 800 - 1.3 * L, w: 1600, h: 1.2 * L }] }))).toBeUndefined();
    });

    it("settles clear of a zone it must keep out of as it settles: its tail too, and the edge of the screen", () => {
      // a zone low down behind where it sits: its body does not reach it, its tail does
      const zone = { x: 560, y: 760, w: 60, h: 50 };
      expect(shapeHits("sit", 1, 700, 800, L, zone)).toBe(true);
      const spot = restSpot(ledge, 700, 1, L, "sit", around({ keepOut: [zone] }))!;
      expect(spot).toBeDefined();
      expect(shapeHits("sit", spot > 700 ? 1 : -1, spot, 800, L, zone)).toBe(false);
      // (the screen's edge is a zone: a cat that sits where its tail would be off the screen is moved in)
      const edge = restSpot({ ...ledge, x0: 0 }, 20, 1, L, "sit", around());
      expect(edge).toBeDefined();
      expect(edge!).toBeGreaterThan(20);
    });

    it("knows every posture it can settle in", () => {
      const poses: RestPose[] = ["stand", "sit", "loaf", "curl", "knead"];
      for (const pose of poses) expect(covers(500, 1, [{ x: 0, y: 0, w: 2000, h: 2000 }], pose), pose).toBeGreaterThan(0);
    });

    it("settles for the worst of the postures it goes through: a place for a long sleep is one where lying down, treading and sleeping all fit", () => {
      // (a shelf that ends where the cat's feet may still be on the screen: a cat lying out with its tail along the floor does not fit at the very end, and asleep it lies out too, the head down on its paws)
      const end: Ledge = { ...ledge, x0: 100, x1: 1920 - 0.78 * L };
      const around0 = around();
      const worst = settledCost(["loaf", "knead", "curl"], -1, end.x1, 800, L, around0);
      expect(worst).toBe(Math.max(settledCost("loaf", -1, end.x1, 800, L, around0), settledCost("knead", -1, end.x1, 800, L, around0), settledCost("curl", -1, end.x1, 800, L, around0)));
      expect(settledCost("curl", -1, end.x1, 800, L, around0)).toBeGreaterThan(0);
      expect(worst).toBeGreaterThan(0);
      expect(restSpot(end, end.x1, -1, L, "curl", around0)).toBeDefined();
      const spot = restSpot(end, end.x1, -1, L, ["loaf", "knead", "curl"], around0)!;
      expect(spot).toBeDefined();
      expect(spot).toBeLessThan(end.x1);
      expect(settledCost(["loaf", "knead", "curl"], -1, spot, 800, L, around0)).toBeLessThan(0.02 * L * L);
    });
  });

  it("finds the way between shelves, and nothing that is too far up", () => {
    const w = browseWorld(defaultPage());
    const ledges = computeLedges(w).filter((l) => l.kind === "shelfTop");
    const [a, b] = ledges;
    const path = findPath(ledges, a!, a!.x0 + 10, b!, b!.x0 + 10, w.bodyLength);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    const farUp = { ...b!, id: "far", surfaceId: "far", y: a!.y - (MAX_UP + 1) * w.bodyLength };
    expect(findPath([a!, farUp], a!, a!.x0, farUp, farUp.x0, w.bodyLength)).toBeNull();
  });

  describe("a step up that is climbed, not leapt at", () => {
    const step = (rise: number, over: Partial<Ledge> = {}, under: Partial<Ledge> = {}): [Ledge, Ledge] => [
      { id: "low#0", surfaceId: "low", kind: "shelfTop", y: 800, x0: 100, x1: 1500, weight: 1, ...under },
      { id: "high#0", surfaceId: "high", kind: "shelfTop", y: 800 - rise * L, x0: 300, x1: 1300, weight: 1, ...over },
    ];

    it("is a climb from the place under the lip, on the side the cat comes from, when it is about as high as the cat hangs", () => {
      for (const rise of [STEP_MIN + 0.001, 1.4, STEP_MAX - 0.001]) {
        const [from, to] = step(rise);
        const coming = findPath([from, to], from, 400, to, 700, L)!;
        expect(coming, `${rise}`).toHaveLength(1);
        // (from the left: it faces right, stands on top at the place it was sent to, and its place under the lip is a stride behind that)
        expect(coming[0]!.climb, `${rise}`).toEqual({ dir: 1 });
        expect(coming[0]!.landX, `${rise}`).toBe(700);
        expect(coming[0]!.takeoffX, `${rise}`).toBeCloseTo(700 - CLIMB_BACK * L, 6);
        const back = findPath([from, to], from, 1000, to, 700, L)!;
        expect(back[0]!.climb, `${rise}`).toEqual({ dir: -1 });
        expect(back[0]!.takeoffX, `${rise}`).toBeCloseTo(700 + CLIMB_BACK * L, 6);
      }
    });

    it("is a leap when it is lower or higher than that: a stride is not worth the show, and a spring is what a high one takes", () => {
      for (const rise of [0.5, STEP_MIN - 0.1, STEP_MAX + 0.1, 2.5, 3.5]) {
        const [from, to] = step(rise);
        const hop = findPath([from, to], from, 400, to, 700, L)![0]!;
        expect(hop.climb, `${rise}`).toBeUndefined();
        expect(hop.landX, `${rise}`).toBe(700);
      }
      // (and a step down is a step down)
      const [low, high] = step(1.4);
      expect(findPath([low, high], high, 700, low, 400, L)![0]!.climb).toBeUndefined();
    });

    it("is a leap when no place of the ledge it is on is under the lip: the cat cannot stand where it would hang", () => {
      // (a little ledge off to the side of the one above: the place under the lip of what it wants is not on it)
      const [from, to] = step(1.4, {}, { x0: 400, x1: 420 });
      const hop = findPath([from, to], from, 410, to, 600, L)![0]!;
      expect(hop.climb).toBeUndefined();
      expect(hop.takeoffX).toBe(420);
    });
  });

  describe("a step up too high for a hang, gone up the face of the card (where the painter can draw the cat from behind)", () => {
    const step = (rise: number, under: Partial<Ledge> = {}): [Ledge, Ledge] => [
      { id: "low#0", surfaceId: "low", kind: "shelfTop", y: 800, x0: 100, x1: 1500, weight: 1, ...under },
      { id: "high#0", surfaceId: "high", kind: "shelfTop", y: 800 - rise * L, x0: 300, x1: 1300, weight: 1 },
    ];

    it("is gone up from the place under the lip, facing right on top, when it is too high to leap at and no higher than SCALE_MAX; and is no way at all without the painter", () => {
      for (const rise of [MAX_UP + 0.05, SCALE_MAX - 0.001]) {
        const [from, to] = step(rise);
        expect(findPath([from, to], from, 1000, to, 700, L), `${rise}: without it`).toBeNull();
        // (from either side: the picture of its back faces right, so it does too, on top)
        for (const fromX of [400, 1000]) {
          const path = findPath([from, to], from, fromX, to, 700, L, 3, true)!;
          const where = `${rise}, from ${fromX}`;
          expect(path, where).toHaveLength(1);
          expect(path[0]!.scale, where).toEqual({ dir: 1 });
          expect(path[0]!.climb, where).toBeUndefined();
          expect(path[0]!.landX, where).toBe(700);
          expect(path[0]!.takeoffX, where).toBeCloseTo(700 - CLIMB_BACK * L, 6);
        }
      }
      // (and higher than that, not at all)
      const [from, to] = step(SCALE_MAX + 0.05);
      expect(findPath([from, to], from, 1000, to, 700, L, 3, true)).toBeNull();
    });

    it("faces left on top when there is no room under the lip to face right, and is no way when there is room for neither", () => {
      const [from, to] = step(MAX_UP + 0.3, { x0: 650 });
      const hop = findPath([from, to], from, 1000, to, 700, L, 3, true)![0]!;
      expect(hop.scale).toEqual({ dir: -1 });
      expect(hop.takeoffX).toBeCloseTo(700 + CLIMB_BACK * L, 6);
      const [narrow, high] = step(MAX_UP + 0.3, { x0: 650, x1: 700 });
      expect(findPath([narrow, high], narrow, 680, high, 700, L, 3, true)).toBeNull();
    });

    it("leaves a step it can leap up a leap (the cat's own to go up the face of, now and then), and one about as high as its hang a climb", () => {
      for (const rise of [STEP_MAX + 0.1, 2.5, MAX_UP - 0.05]) {
        const [from, to] = step(rise);
        const hop = findPath([from, to], from, 400, to, 700, L, 3, true)![0]!;
        expect(hop.scale, `${rise}`).toBeUndefined();
        expect(hop.climb, `${rise}`).toBeUndefined();
        expect(hop.landX, `${rise}`).toBe(700);
      }
      const [from, to] = step(1.4);
      expect(findPath([from, to], from, 400, to, 700, L, 3, true)![0]!.climb).toEqual({ dir: 1 });
    });
  });
});

describe("jumping", () => {
  it("is an arc that leaves and lands exactly where it was planned, over both places", () => {
    for (const [fx, fy, tx, ty] of [
      [100, 800, 400, 450],
      [100, 450, 400, 800],
      [300, 600, 300, 600],
      [800, 700, 560, 700],
    ] as const) {
      const plan = planJump(fx, fy, tx, ty, L)!;
      expect(plan).not.toBeNull();
      const start = jumpAt(plan, 0);
      const end = jumpAt(plan, plan.flight);
      expect(start.x).toBeCloseTo(fx, 3);
      expect(start.y).toBeCloseTo(fy, 3);
      expect(end.x).toBeCloseTo(tx, 3);
      expect(end.y).toBeCloseTo(ty, 3);
      let top = Infinity;
      for (let t = 0; t <= plan.flight; t += plan.flight / 50) top = Math.min(top, jumpAt(plan, t).y);
      expect(top).toBeLessThanOrEqual(Math.min(fy, ty) - 0.4 * L);
    }
  });

  it("is a physically sensible arc: the time up and down follow gravity, and the speed at the top is across only", () => {
    const plan = planJump(100, 800, 400, 500, L)!;
    expect(plan.up).toBeCloseTo(Math.sqrt((2 * (800 - plan.apexY)) / (GRAVITY * L)), 6);
    const top = jumpAt(plan, plan.up);
    expect(Math.abs(top.vy)).toBeLessThan(1);
    expect(top.vx).toBeGreaterThan(0);
  });

  it("is refused when it is more than the cat can do", () => {
    expect(planJump(100, 900, 100, 900 - (MAX_UP + 0.2) * L, L)).toBeNull();
    expect(planJump(100, 300, 100, 300 + (MAX_DOWN + 0.2) * L, L)).toBeNull();
    expect(planJump(100, 900, 100 + 10 * L, 900, L)).toBeNull();
    expect(planJump(100, 900, 100, 900 - (MAX_UP - 0.2) * L, L)).not.toBeNull();
  });

  it("shares the clip's progress as the engine says: crouch up to the take-off, flight to the landing", () => {
    expect(JUMP_TAKEOFF).toBeLessThan(JUMP_LANDING);
  });

  it("is stepped along its arc frame by frame to the same places the arc has in time, and lands when it should", () => {
    const plan = planJump(100, 800, 400, 500, L)!;
    let phase = 0;
    let t = 0;
    for (;;) {
      const step = stepFlight(plan, phase, 1 / 60, L);
      phase = step.phase;
      t += 1 / 60;
      const ref = jumpAt(plan, Math.min(t, plan.flight));
      expect(Math.abs(step.x - ref.x)).toBeLessThan(0.1 * L);
      expect(Math.abs(step.y - ref.y)).toBeLessThan(0.1 * L);
      if (step.done) break;
      expect(t).toBeLessThan(3);
    }
    expect(t).toBeCloseTo(plan.flight, 1);
  });

  it("never goes faster than gravity allows, however the shelf it is heading for is moved while it is in the air", () => {
    const plan = planJump(100, 600, 400, 600, L)!;
    const g = GRAVITY * L;
    let phase = 0;
    let prevY = plan.fromY;
    for (let i = 0; i < 400; i++) {
      // the landing shelf slides down 40px a frame for a while: the arc follows it
      if (i < 12) plan.toY += 40;
      reshape(plan, L);
      const step = stepFlight(plan, phase, 1 / 30, L);
      phase = step.phase;
      const rise = plan.fromY - plan.apexY;
      const drop = plan.toY - plan.apexY;
      // (the shelf's own movement is not the cat's)
      const own = Math.abs(step.y - prevY) - (i < 12 ? 40 : 0);
      expect(own).toBeLessThan(Math.sqrt(2 * g * Math.max(rise, drop)) / 30 + 1);
      prevY = step.y;
      if (step.done) return;
    }
    throw new Error("never landed");
  });
});

const run = (engine: CatEngine, world: World, seconds: number) => stepCat(engine, world, seconds);

describe("the cat on a page", () => {
  it("comes in on a shelf, fading in, and stays on it", () => {
    const engine = new CatEngine(3);
    const world = browseWorld(defaultPage());
    const { frames } = run(engine, world, 6);
    expect(frames[0]!.appear).toBe(0);
    expect(frames[frames.length - 1]!.appear).toBe(1);
    const last = frames[frames.length - 1]!;
    const ledge = ledgeAt(computeLedges(world), engine.debug().surfaceId!, last.x)!;
    expect(last.y).toBe(ledge.y);
    expect(last.x).toBeGreaterThanOrEqual(ledge.x0 - 1);
    expect(last.x).toBeLessThanOrEqual(ledge.x1 + 1);
  });

  it("waits, unseen, while the page has no place for it", () => {
    const engine = new CatEngine(3);
    const empty: World = { ...browseWorld(defaultPage()), surfaces: [] };
    const { frames } = run(engine, empty, 4);
    expect(frames.every((f) => f.appear === 0)).toBe(true);
    const { frames: later } = stepCat(engine, browseWorld(defaultPage()), 4);
    expect(later[later.length - 1]!.appear).toBe(1);
  });

  it("walks along a shelf, within it, with its feet's distance counted", () => {
    const engine = new CatEngine(11);
    const world = browseWorld(defaultPage());
    const { frames } = run(engine, world, 300);
    const ledges = computeLedges(world);
    const walked = frames.filter((f) => f.clip === "walk" || f.clip === "run");
    expect(walked.length).toBeGreaterThan(0);
    for (const f of frames) {
      if (f.appear < 0.05 || !f.grounded) continue;
      expect(ledges.some((l) => Math.abs(l.y - f.y) < 1 && f.x >= l.x0 - 1 && f.x <= l.x1 + 1)).toBe(true);
    }
    let odo = 0;
    for (const f of frames) {
      expect(f.odometer).toBeGreaterThanOrEqual(odo - 1e-6);
      odo = f.odometer;
    }
    expect(odo).toBeGreaterThan(L);
  });

  it("faces the way it walks, and does not walk faster than a run", () => {
    const engine = new CatEngine(5);
    const world = browseWorld(defaultPage());
    const { frames } = run(engine, world, 400);
    for (const f of frames) {
      // (on its feet: a leap goes as fast as its arc needs)
      if (f.grounded) expect(Math.abs(f.vx)).toBeLessThan(3 * L);
      if (f.clip === "walk" && Math.abs(f.vx) > 0.3 * L) expect(Math.sign(f.vx)).toBe(f.facing);
    }
  });

  it("hops between shelves, and lands on the one it aimed at", () => {
    const engine = new CatEngine(21);
    const world = browseWorld(defaultPage());
    const ledges = computeLedges(world);
    let jumps = 0;
    let wasAir = false;
    const { frames } = run(engine, world, 600);
    for (const f of frames) {
      if (!f.grounded) wasAir = true;
      else if (wasAir) {
        jumps++;
        wasAir = false;
        expect(ledges.some((l) => Math.abs(l.y - f.y) < 1.5)).toBe(true);
      }
    }
    expect(jumps).toBeGreaterThan(0);
  });

  it("goes with its shelf when the page scrolls", () => {
    const engine = new CatEngine(2);
    const page = defaultPage();
    run(engine, browseWorld(page), 5);
    const before = engine.frame.y;
    page.scroll = 120;
    const { frames } = stepCat(engine, browseWorld(page), 1);
    const last = frames[frames.length - 1]!;
    expect(Math.abs(last.y - (before - 120))).toBeLessThan(2);
  });

  it("steps out of the way of the card that gets the focus, and does not stand in it", () => {
    const engine = new CatEngine(8);
    const page = defaultPage();
    page.rows = 1;
    run(engine, browseWorld(page), 4);
    const x = engine.frame.x;
    // a card with the focus where the cat stands
    const cats = browseWorld(page);
    const tile = cats.targets.find((t) => x >= t.rect.x && x <= t.rect.x + t.rect.w)!;
    const focus = { row: 0, col: Number(tile.id.split("c")[1]) };
    page.focus = focus;
    const { frames, world } = stepCat(engine, browseWorld(page), 5);
    const last = frames[frames.length - 1]!;
    expect(shapeHits(last.clip, last.facing, last.x, last.y, world.bodyLength, world.focus!)).toBe(false);
    expect(last.appear).toBeGreaterThan(0.9);
  });

  it("is pet: happy, for a moment, and no longer than that", () => {
    const engine = new CatEngine(4);
    const world = browseWorld(defaultPage());
    run(engine, world, 4);
    engine.send({ type: "cat.pet" });
    const { frames } = stepCat(engine, world, 4);
    expect(frames[2]!.petted).toBe(true);
    expect(frames[frames.length - 1]!.petted).toBe(false);
  });

  it("comes when called, and runs to the shelf nearest the call", () => {
    const engine = new CatEngine(17);
    const world = browseWorld(defaultPage());
    run(engine, world, 4);
    engine.send({ type: "cat.call", at: { x: 1300, y: 860 } });
    const { frames } = stepCat(engine, world, 15);
    expect(frames.some((f) => f.clip === "run")).toBe(true);
    // (where it stopped running: it has arrived, and sits there for a while before it goes about its day again)
    const arrived = frames[frames.map((f) => f.clip).lastIndexOf("run") + 1]!;
    expect(Math.abs(arrived.y - 861)).toBeLessThan(5);
    expect(Math.abs(arrived.x - 1300)).toBeLessThan(0.5 * L);
  });

  it("points at a poster it is told to, with its paw, and looks at it", () => {
    const engine = new CatEngine(33);
    const world = browseWorld(defaultPage());
    run(engine, world, 4);
    const target = world.targets.find((t) => t.id.endsWith("r1c2"))!;
    engine.send({ type: "cat.point", targetId: target.id });
    const { frames } = stepCat(engine, world, 20);
    const pointing = frames.filter((f) => f.clip === "point");
    expect(pointing.length).toBeGreaterThan(30);
    expect(pointing[5]!.reach).toBeDefined();
    expect(pointing[5]!.look!.x).toBeCloseTo(target.rect.x + target.rect.w / 2, 0);
  });

  it("is not left in the middle of a swat at a poster, or of a point, by a page that sent it away and brought it back: it sits when it is in sight again", () => {
    for (const [seed, clip] of [[1, "swat"], [2, "swat"], [3, "swat"], [33, "point"]] as const) {
      const engine = new CatEngine(seed);
      const world = browseWorld(defaultPage());
      run(engine, world, 4);
      engine.send({ type: "cat.point", targetId: world.targets.find((t) => t.id.endsWith("r1c2"))!.id });
      let frame = engine.frame;
      for (let i = 0; i < 60 * 30 && frame.clip !== clip; i++) frame = engine.update(world, 1 / 30);
      expect(frame.clip, `seed ${seed}`).toBe(clip);
      // (gone for a while: the menu, or another tab, or the TV off)
      stepCat(engine, { ...world, mode: "away" }, 3);
      expect(engine.frame.appear).toBeLessThan(0.05);
      // (and back: in the frame that ends the fade the cat has no act, and it is not in a scene of the one it left)
      const gaps: string[] = [];
      stepCat(engine, world, 2, 30, (f) => {
        if (engine.debug().act === "none") gaps.push(f.clip);
      });
      expect(gaps.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(gaps, `seed ${seed}`).not.toContain(clip);
    }
  });

  it("rides a shelf that scrolls out from under the top bar, and then makes its way off, rather than hang in the air or stay under the bar", () => {
    const engine = new CatEngine(8);
    const page = defaultPage();
    page.rows = 1;
    run(engine, browseWorld(page), 4);
    page.scroll = 320; // the shelf is now at 191, where the top bar leaves no room for a cat
    const world = browseWorld(page);
    const shelf = world.surfaces.find((s) => s.kind === "shelfTop")!;
    const { frames } = stepCat(engine, world, 5);
    for (const f of frames.slice(0, 15)) expect(Math.abs(f.y - shelf.y)).toBeLessThan(1.5);
    const last = frames[frames.length - 1]!;
    expect(world.keepOut.some((zone) => last.grounded && last.appear > 0.05 && shapeHits(last.clip, last.facing, last.x, last.y, world.bodyLength, zone))).toBe(false);
  });

  it("is put back on the screen when the window is made smaller under it, and is not seen to be anywhere else", () => {
    const engine = new CatEngine(2);
    run(engine, browseWorld(defaultPage()), 6);
    const small = defaultPage();
    small.width = 1280;
    small.height = 720;
    const world = browseWorld(small);
    const { frames } = stepCat(engine, world, 4);
    for (const f of frames.slice(4)) if (f.appear > 0.05) expect(f.x).toBeLessThanOrEqual(world.viewport.w + 0.6 * world.bodyLength);
    expect(frames[frames.length - 1]!.appear).toBeGreaterThan(0.9);
  });

  it("is put down at the end of a shelf, still sitting, when the window is made smaller under it, with none of it over the edge of the screen (turned round if its tail needs it)", () => {
    const engine = new CatEngine(2);
    const page = defaultPage();
    page.rows = 0;
    run(engine, browseWorld(page), 5);
    // (to the far end of the floor, and then back a little way, so that it sits facing the other way, with its tail out behind it towards the edge)
    engine.send({ type: "cat.call", at: { x: 1900, y: 1074 } });
    run(engine, browseWorld(page), 6);
    engine.send({ type: "cat.call", at: { x: 1700, y: 1074 } });
    run(engine, browseWorld(page), 0.2);
    expect(engine.debug().act).toBe("walk");
    for (let i = 0; i < 400 && !engine.debug().act.startsWith("rest:"); i++) run(engine, browseWorld(page), 0.05);
    expect(engine.debug().act).toBe("rest:sit");
    expect(engine.frame.facing).toBe(-1);
    // the window is made smaller under it: it is put back at the end of the shelf, still sitting
    const small = defaultPage();
    small.rows = 0;
    small.width = 1280;
    small.height = 720;
    const world = browseWorld(small);
    const { frames } = stepCat(engine, world, 3);
    expect(engine.debug().act).toBe("rest:sit");
    const last = frames[frames.length - 1]!;
    // (with the long tail the cat once had it had to be turned round here to keep the tail on the screen; the cat of today has a tail that fits whichever way it faces, and what is asked is that it does)
    for (const edge of screenEdges(world.viewport, world.bodyLength, 0.12)) expect(shapeHits(last.clip, last.facing, last.x, last.y, world.bodyLength, edge)).toBe(false);
  });

  it("is not brought back by a touch, a call or a command while a menu has sent it away", () => {
    const engine = new CatEngine(3);
    const page = defaultPage();
    run(engine, browseWorld(page), 5);
    const menu = browseWorld(page, { modal: true });
    stepCat(engine, menu, 0.1);
    engine.send({ type: "cat.command", command: "sit" });
    engine.send({ type: "cat.call", at: { x: 500, y: 500 } });
    engine.send({ type: "cat.pet" });
    const later = stepCat(engine, menu, 2).frames;
    expect(later.every((f) => f.appear < 0.8)).toBe(true);
    expect(later[later.length - 1]!.appear).toBe(0);
    // and it is back when the menu is shut
    const back = stepCat(engine, browseWorld(page), 4).frames;
    expect(back[back.length - 1]!.appear).toBe(1);
  });

  it("is deterministic: one seed is one cat", () => {
    const frames = (seed: number) => {
      const engine = new CatEngine(seed);
      return stepCat(engine, browseWorld(defaultPage()), 120).frames.map((f) => [f.x.toFixed(2), f.y.toFixed(2), f.clip]);
    };
    expect(frames(7)).toEqual(frames(7));
    expect(frames(7)).not.toEqual(frames(8));
  });

  it("does not roam when the viewer wants quiet, or has asked for reduced motion: it only rests", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const engine = new CatEngine(5);
      const page = defaultPage();
      page[flag] = true;
      const world = browseWorld(page);
      const { frames } = stepCat(engine, world, 600);
      const moved = frames.filter((f) => f.clip === "walk" || f.clip === "run" || f.clip === "jump");
      expect(moved.length).toBe(0);
      const xs = frames.filter((f) => f.appear > 0.5).map((f) => f.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
    }
  });
});

describe("the cat sent to show the viewer a poster", () => {
  interface Entry {
    act: string;
    surface: string | null;
    f: CatFrame;
  }
  const copy = (engine: CatEngine, f: CatFrame): Entry => ({ act: engine.debug().act, surface: engine.debug().surfaceId, f: { ...f, ...(f.reach ? { reach: { ...f.reach } } : {}), ...(f.look ? { look: { ...f.look } } : {}) } });
  /**
   * The cat settles on a shelf of the made-up page, is told to go to the poster `pick` chooses, and is stepped on: every frame, copied, with the act it was in and the shelf it was on.
   * `change` may hand the engine a different page as time goes by (a scroll).
   */
  const sent = (seed: number, pick: (world: World, engine: CatEngine) => Target, options: { page?: PageOptions; seconds?: number; from?: 0 | 1; change?: (t: number, current: World) => World | undefined } = {}) => {
    const engine = new CatEngine(seed);
    const world = browseWorld(options.page ?? defaultPage());
    run(engine, world, 6);
    // (called to a shelf we know: the top row, to the right of the banner, or the one below it. The rows under those are off the screen)
    engine.send({ type: "cat.call", at: options.from === 0 ? { x: 1500, y: 511 } : { x: 900, y: 861 } });
    run(engine, world, 8);
    const target = pick(world, engine);
    engine.send({ type: "cat.point", targetId: target.id });
    const log: Entry[] = [];
    let current = world;
    stepCat(engine, world, options.seconds ?? 40, 30, (f, t) => {
      log.push(copy(engine, f));
      const next = options.change?.(t, current);
      if (next) current = next;
      return next;
    });
    return { engine, target, log, L: world.bodyLength, now: () => current };
  };
  const first = (log: Entry[], act: string): number => log.findIndex((e) => e.act === act);
  /** Where the swats begin (the second begins in the frame the first ends, so it is the progress starting over that says so). */
  const swatStarts = (log: Entry[]): number[] => log.flatMap((e, i) => (e.f.clip === "swat" && (i === 0 || log[i - 1]!.f.clip !== "swat" || e.f.progress < log[i - 1]!.f.progress) ? [i] : []));
  /** The swats of the trip itself: those before the cat points (it may pat a poster of its own accord a long while after). */
  const tripSwats = (log: Entry[]): number[] => swatStarts(log).filter((i) => i < first(log, "point"));
  const hit = (log: Entry[]): Entry | undefined => log.find((e) => e.f.clip === "swat" && e.f.progress >= SWAT_HIT);
  const middleOf = (t: Target): number => t.rect.x + t.rect.w / 2;
  /** A poster on the other shelf (the top row's, to the right of the banner, or the second's). */
  const otherShelf = (world: World, engine: CatEngine): Target => world.targets.find((t) => t.id === (engine.debug().surfaceId === "p1:row1" ? "p1:r0c3" : "p1:r1c3"))!;
  /** A poster on the cat's own shelf, three to eight body lengths off. */
  const sameShelf = (world: World, engine: CatEngine): Target => {
    const L = world.bodyLength;
    const near = world.targets.filter((t) => t.surfaceId === engine.debug().surfaceId && Math.abs(middleOf(t) - engine.frame.x) >= 3.2 * L && Math.abs(middleOf(t) - engine.frame.x) <= 8 * L);
    return near[0]!;
  };
  const inside = (p: { x: number; y: number }, rect: Rect): boolean => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;

  it("goes to a poster on another shelf by leaps, creeps up on it, wiggles, swats it twice with the paw coming down on it, points at it, and sits by it looking out at the viewer", () => {
    for (const [seed, from] of [[33, 1], [4, 0], [21, 1]] as const) {
      const { target, log, L } = sent(seed, otherShelf, { from });
      const stalk = first(log, "stalk");
      const wiggle = first(log, "shot:wiggle");
      const swat = first(log, "swat");
      const point = first(log, "point");
      const label = `seed ${seed}`;
      expect(stalk, label).toBeGreaterThanOrEqual(0);
      expect(wiggle, label).toBeGreaterThan(stalk);
      expect(swat, label).toBeGreaterThan(wiggle);
      expect(point, label).toBeGreaterThan(swat);
      // (it leapt to the poster's shelf, and was on it for the creep)
      expect(log.slice(0, stalk).some((e) => e.act === "jump"), label).toBe(true);
      expect(log[stalk]!.surface, label).toBe(target.surfaceId);
      expect(tripSwats(log), label).toHaveLength(2);
      // (and the paw comes down on the poster: the cat is on its shelf, faces it, a paw's reach from its middle, and what the paw lands on is the poster)
      const landed = hit(log)!;
      expect(landed.surface, label).toBe(target.surfaceId);
      expect(Math.abs(landed.f.y - target.rect.y), label).toBeLessThan(1.5);
      expect(Math.sign(middleOf(target) - landed.f.x), label).toBe(landed.f.facing);
      expect(Math.abs(middleOf(target) - landed.f.x), label).toBeGreaterThan(0.3 * L);
      expect(Math.abs(middleOf(target) - landed.f.x), label).toBeLessThan(0.9 * L);
      expect(inside(landed.f.reach!, target.rect), label).toBe(true);
      // (then it points for the best part of four seconds, and sits, with its eyes on the viewer)
      expect(log.filter((e) => e.f.clip === "point").length, label).toBeGreaterThan(90);
      expect(log.slice(point).some((e) => e.act === "rest:sit" && e.f.viewer), label).toBe(true);
      // (and it is quick about it: the first swat is within twenty seconds of the word)
      expect(swat / 30, label).toBeLessThan(20);
    }
  });

  it("comes to a poster on its own shelf by hops along the shelf, and not by a run", () => {
    const { target, log } = sent(33, sameShelf);
    const swat = first(log, "swat");
    const before = log.slice(0, swat);
    const hops = before.filter((e, i) => e.act === "jump" && (i === 0 || before[i - 1]!.act !== "jump")).length;
    expect(hops).toBeGreaterThanOrEqual(1);
    expect(hops).toBeLessThanOrEqual(3);
    expect(before.every((e) => e.surface === target.surfaceId)).toBe(true);
    expect(before.some((e) => e.f.clip === "run")).toBe(false);
    expect(tripSwats(log)).toHaveLength(2);
  });

  it("does not swat at a poster that its shelf has no place to stand at (the library's own words are over it): it comes as near as it may, and holds a paw out to it", () => {
    for (const seed of [33, 4, 21]) {
      const engine = new CatEngine(seed);
      const base = browseWorld(defaultPage());
      run(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 1500, y: 861 } });
      run(engine, base, 8);
      expect(engine.debug().surfaceId, `seed ${seed}`).toBe("p1:row1");
      // (words, at the height of a cat, along the whole of the second row's shelf)
      const L = base.bodyLength;
      const covered: World = { ...base, keepOut: [...base.keepOut, { x: 0, y: 861 - 0.6 * L, w: 1920, h: 0.4 * L }] };
      // (a poster at the far end of that shelf from where the cat is: it has to leave the shelf, and the page has nowhere nearer for it than the foot of the screen)
      const target = covered.targets.find((t) => t.id === "p1:r1c0")!;
      engine.send({ type: "cat.point", targetId: target.id });
      const log: Entry[] = [];
      stepCat(engine, covered, 30, 30, (f) => {
        log.push(copy(engine, f));
      });
      const label = `seed ${seed}`;
      expect(log.some((e) => e.act === "swat" || e.f.clip === "swat"), label).toBe(false);
      const point = first(log, "point");
      expect(point, label).toBeGreaterThanOrEqual(0);
      // (it is no longer on the shelf that has no place for it, and is nearer the poster than the place it set out from)
      expect(log[point]!.surface, label).not.toBe("p1:row1");
      const dist = (f: CatFrame): number => Math.hypot(Math.max(0, target.rect.x - f.x, f.x - (target.rect.x + target.rect.w)), Math.max(0, target.rect.y - f.y, f.y - (target.rect.y + target.rect.h)));
      expect(dist(log[point]!.f), label).toBeLessThan(dist(log[0]!.f));
      expect(log.filter((e) => e.f.clip === "point").length, label).toBeGreaterThan(60);
    }
  });

  it("only points, from where it sits, for a viewer who wants less motion", () => {
    const page = defaultPage();
    page.reducedMotion = true;
    const { log } = sent(33, otherShelf, { page, seconds: 15 });
    expect(log.some((e) => ["swat", "jump", "walk", "stalk", "shot:wiggle"].includes(e.act))).toBe(false);
    expect(log.every((e) => e.f.clip !== "swat")).toBe(true);
    expect(log.filter((e) => e.f.clip === "point").length).toBeGreaterThan(100);
  });

  it("comes for a viewer who asked for quiet, too, and swats, but does not hop about on the way", () => {
    const page = defaultPage();
    page.quiet = true;
    const { log } = sent(33, sameShelf, { page });
    expect(tripSwats(log)).toHaveLength(2);
    expect(log.slice(0, first(log, "swat")).some((e) => e.act === "jump")).toBe(false);
  });

  it("swats the poster where the page has it now when the page was scrolled after the cat set out", () => {
    const page = defaultPage();
    const { target, log, now } = sent(33, otherShelf, {
      page,
      change: (t) => {
        if (page.scroll === 0 && t > 2) {
          page.scroll = 60;
          return browseWorld(page);
        }
        return undefined;
      },
    });
    const rect = now().targets.find((t) => t.id === target.id)!.rect;
    expect(rect.y).toBeCloseTo(target.rect.y - 60, 6);
    expect(tripSwats(log)).toHaveLength(2);
    const landed = hit(log)!;
    expect(inside(landed.f.reach!, rect)).toBe(true);
    expect(Math.abs(landed.f.y - rect.y)).toBeLessThan(1.5);
  });

  it("is not turned back from the poster by the row it is on being scrolled sideways on the way: it goes to where it should stand by it, and swats", () => {
    for (const seed of [33, 4, 21]) {
      const engine = new CatEngine(seed);
      const base = browseWorld(defaultPage());
      run(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 900, y: 861 } });
      run(engine, base, 8);
      const target = sameShelf(base, engine);
      engine.send({ type: "cat.point", targetId: target.id });
      let offset = 0;
      let read = base;
      const log: Entry[] = [];
      stepCat(engine, base, 45, 30, (f, t) => {
        log.push(copy(engine, f));
        // (a tenth of a second between reads, a row that slides a little every time, for a second of the trip: a good way, for a hand on a scroll wheel)
        if (t > 0.5 && t < 1.4 && Math.round(t * 30) % 3 === 0) {
          offset += 30;
          read = { ...base, targets: base.targets.map((one) => (one.surfaceId === target.surfaceId ? { ...one, rect: { ...one.rect, x: one.rect.x + offset } } : one)) };
          return read;
        }
        return undefined;
      });
      const label = `seed ${seed}`;
      expect(tripSwats(log), label).toHaveLength(2);
      const rect = read.targets.find((one) => one.id === target.id)!.rect;
      const landed = hit(log)!;
      expect(inside(landed.f.reach!, rect), label).toBe(true);
      expect(Math.abs(rect.x + rect.w / 2 - landed.f.x), label).toBeLessThan(0.9 * base.bodyLength);
    }
  });
});

describe("the cat asked to show a poster when the page has been scrolled to it (the shelf the cat stood on goes off the screen)", () => {
  interface Entry {
    act: string;
    surface: string | null;
    pending: string | null;
    f: CatFrame;
  }
  const copy = (engine: CatEngine, f: CatFrame): Entry => ({ act: engine.debug().act, surface: engine.debug().surfaceId, pending: engine.debug().pending, f: { ...f, ...(f.reach ? { reach: { ...f.reach } } : {}) } });
  /** The page as the TV reads it once it has been scrolled: the rows that have left the screen are not in it at all. */
  const scrolledTo = (scroll: number, gone: string[]): World => {
    const page = defaultPage();
    page.scroll = scroll;
    const world = browseWorld(page);
    return { ...world, surfaces: world.surfaces.filter((s) => !gone.includes(s.id)), targets: world.targets.filter((t) => !gone.includes(t.surfaceId ?? "")) };
  };
  /** A cat settled on the top row, to the right of the banner. */
  const onTopRow = (seed: number): CatEngine => {
    const engine = new CatEngine(seed);
    const base = browseWorld(defaultPage());
    run(engine, base, 6);
    engine.send({ type: "cat.call", at: { x: 1500, y: 511 } });
    run(engine, base, 8);
    expect(engine.debug().surfaceId).toBe("p1:row0");
    return engine;
  };
  const swatStarts = (log: Entry[]): number[] => log.flatMap((e, i) => (e.f.clip === "swat" && (i === 0 || log[i - 1]!.f.clip !== "swat" || e.f.progress < log[i - 1]!.f.progress) ? [i] : []));
  const inside = (p: { x: number; y: number }, rect: Rect): boolean => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;

  it("stands on the shelf that the scroll brought to where its feet are, and does not leap from it, when its own has gone", () => {
    for (const seed of [33, 4, 21]) {
      const engine = onTopRow(seed);
      // (one row's worth: the second row is now where the top one was, and the top one is off the screen)
      const after = scrolledTo(350, ["p1:row0"]);
      const log: Entry[] = [];
      stepCat(engine, after, 3, 30, (f) => {
        log.push(copy(engine, f));
      });
      const label = `seed ${seed}`;
      expect(log.some((e) => e.act === "jump"), label).toBe(false);
      expect(log.every((e) => e.surface === "p1:row1"), label).toBe(true);
      expect(log.every((e) => Math.abs(e.f.y - 511) < 0.5), label).toBe(true);
    }
  });

  it("goes on to the poster, and swats it, from the shelf it stands on after that, when it was asked after the scroll", () => {
    for (const seed of [33, 4, 21]) {
      const engine = onTopRow(seed);
      const after = scrolledTo(350, ["p1:row0"]);
      run(engine, after, 0.65);
      const target = after.targets.find((t) => t.id === "p1:r1c0")!;
      engine.send({ type: "cat.point", targetId: target.id });
      const log: Entry[] = [];
      stepCat(engine, after, 30, 30, (f) => {
        log.push(copy(engine, f));
      });
      const label = `seed ${seed}`;
      const swats = swatStarts(log).filter((i) => i < log.findIndex((e) => e.act === "point"));
      expect(log.findIndex((e) => e.act === "stalk"), label).toBeGreaterThanOrEqual(0);
      expect(swats, label).toHaveLength(2);
      const landed = log.find((e) => e.f.clip === "swat" && e.f.progress >= SWAT_HIT)!;
      expect(landed.surface, label).toBe(target.surfaceId);
      expect(inside(landed.f.reach!, target.rect), label).toBe(true);
    }
  });

  it("waits for the landing when it is asked in mid-air (a shelf that went from under it has it leap to another), and then goes to the poster and swats it", () => {
    for (const seed of [33, 4, 21]) {
      const engine = onTopRow(seed);
      // (half a row's worth: no shelf is where its feet are, so it leaps to one)
      const after = scrolledTo(175, ["p1:row0"]);
      const log: Entry[] = [];
      let target: Target | undefined;
      let asked = false;
      stepCat(engine, after, 40, 30, (f) => {
        const here = engine.debug();
        if (!asked && here.act === "jump" && here.jumpTo) {
          // (a poster on the shelf it is leaping to, a good way off)
          target = after.targets.filter((t) => t.surfaceId === here.jumpTo).sort((a, b) => Math.abs(b.rect.x - f.x) - Math.abs(a.rect.x - f.x))[0];
          engine.send({ type: "cat.point", targetId: target!.id });
          asked = true;
        }
        log.push(copy(engine, f));
      });
      const label = `seed ${seed}`;
      expect(asked, label).toBe(true);
      // (it is told, in the air; it does not make a plan from there, but keeps the poster in mind until it is down)
      const told = log.findIndex((e) => e.pending === target!.id);
      expect(told, label).toBeGreaterThanOrEqual(0);
      expect(log[told]!.act, label).toBe("jump");
      const set = log.findIndex((e, i) => i > told && e.pending === null);
      expect(set, label).toBeGreaterThan(told);
      expect(log.slice(told, set).every((e) => e.pending === target!.id), label).toBe(true);
      // (and then it creeps up on the poster, wiggles and swats it twice, on the shelf the poster is on)
      const swats = swatStarts(log).filter((i) => i < log.findIndex((e) => e.act === "point"));
      expect(log.slice(set).some((e) => e.act === "stalk"), label).toBe(true);
      expect(swats, label).toHaveLength(2);
      const landed = log.find((e) => e.f.clip === "swat" && e.f.progress >= SWAT_HIT)!;
      expect(landed.surface, label).toBe(target!.surfaceId);
      expect(inside(landed.f.reach!, target!.rect), label).toBe(true);
    }
  });

  it("forgets the poster if it is told something else before it can set out", () => {
    const engine = onTopRow(33);
    const after = scrolledTo(175, ["p1:row0"]);
    const log: Entry[] = [];
    let asked = false;
    stepCat(engine, after, 20, 30, (f) => {
      const here = engine.debug();
      if (!asked && here.act === "jump" && here.jumpTo) {
        engine.send({ type: "cat.point", targetId: after.targets.find((t) => t.surfaceId === here.jumpTo)!.id });
        asked = true;
      } else if (asked && here.pending !== null && log.every((e) => e.pending === null)) {
        engine.send({ type: "cat.command", command: "sit" });
      }
      log.push(copy(engine, f));
    });
    expect(log.some((e) => e.pending !== null)).toBe(true);
    expect(log[log.length - 1]!.pending).toBe(null);
    expect(log.some((e) => e.act === "stalk" || e.f.clip === "swat")).toBe(false);
  });
});

describe("the cat called, or told to play, in the middle of a leap of its own (it lands first, and is answered from the shelf it lands on)", () => {
  /**
   * Four shelves on a screen of 1920 by 1080. `a` and `c` are on one line, a leap apart; `b` is a long way under `a` (a cat drops to it, and cannot leap up to `a`, or across and up to `c`, from it); `d` is a
   * step up from `b` and a step up to `c`. So the way to `c` is one leap from `a`, and two from `b`, by `d`: a route that was made from `a` is not one to walk from `b`.
   */
  const shelf = (id: string, y: number, x0: number, x1: number): Surface => ({ id, kind: "shelfTop", y, x0, x1, weight: 1 });
  const page = (...surfaces: Surface[]): World => ({ viewport: { x: 0, y: 0, w: 1920, h: 1080 }, bodyLength: L, surfaces, keepOut: [], targets: [], mode: "browse", player: "none", controlsUp: false, quiet: false, reducedMotion: false });
  const a = shelf("a", 300, 180, 720);
  const world = page(a, shelf("b", 735, 180, 720), shelf("c", 300, 880, 1480), shelf("d", 515, 700, 1000));
  /** The same page with a poster on `d`, a pointer over `c`. */
  const poster: Target = { id: "poster", rect: { x: 800, y: 515, w: 120, h: 190 }, surfaceId: "d" };
  const withPoster: World = { ...world, targets: [poster] };
  const withPointer: World = { ...world, pointer: { x: 1300, y: 300 } };
  type Phase = "winding up" | "in the air" | "settling";
  /** The leap from `a` down to `b`: crouching for it, in the air, and settled from it (the cat is on `b` by then). */
  const phases: Record<Phase, (engine: CatEngine) => boolean> = {
    "winding up": (engine) => engine.debug().act === "jump" && engine.debug().jumpTo === "b" && engine.frame.grounded,
    "in the air": (engine) => engine.debug().act === "jump" && engine.debug().jumpTo === "b" && !engine.frame.grounded,
    settling: (engine) => engine.debug().act === "jump" && engine.debug().jumpTo === null && engine.debug().surfaceId === "b",
  };
  /** A cat that sits on `a` (the only shelf the page has at first) is called down to `b`, and stepped on until it is in `phase` of the leap that takes it there. */
  const leaping = (seed: number, phase: Phase): CatEngine => {
    const engine = new CatEngine(seed);
    run(engine, page(a), 5);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, world, 1);
    engine.send({ type: "cat.call", at: { x: 450, y: 735 } });
    for (let i = 0; i < 30 * 10 && !phases[phase](engine); i++) engine.update(world, 1 / 30);
    expect(phases[phase](engine), `seed ${seed}: the leap`).toBe(true);
    return engine;
  };
  /** The cat stepped on for `seconds` in `on`, and the shelves it stood on, in order, added to `stood`. */
  const watch = (engine: CatEngine, stood: string[], on: World, seconds: number): void => {
    stepCat(engine, on, seconds, 30, () => {
      const at = engine.debug().surfaceId!;
      if (stood[stood.length - 1] !== at) stood.push(at);
    });
  };
  /**
   * A cat in `phase` of its leap to `b` is told `events` (in one frame, the page being `on`): what it holds after that frame, and the shelves it stood on, in order, as the next ten seconds go by (a route to
   * `c` takes it seven, and it sits there for eight more).
   */
  const told = (seed: number, phase: Phase, events: CatEvent[], on: World = world) => {
    const engine = leaping(seed, phase);
    const stood = [engine.debug().surfaceId!];
    for (const event of events) engine.send(event);
    engine.update(on, 1 / 30);
    const held = engine.debug().asked;
    const waiting = engine.debug().pending;
    watch(engine, stood, on, 10);
    return { engine, held, waiting, stood };
  };
  const toC = { type: "cat.call", at: { x: 1300, y: 300 } } as const;

  it("is answered from the shelf it lands on when it is called as it winds up for a leap, in the air, or settling from it, and not by the route made for the shelf it left", () => {
    for (const phase of ["winding up", "in the air", "settling"] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const { engine, held, stood } = told(seed, phase, [toC]);
        const label = `${phase}, seed ${seed}`;
        // (it lands where its leap was going, goes up to `c` by `d`, as a route from `b` does, and sits down where it was called)
        expect(stood, label).toEqual(phase === "settling" ? ["b", "d", "c"] : ["a", "b", "d", "c"]);
        expect(engine.debug().act, label).toBe("rest:sit");
        expect(Math.abs(engine.frame.x - toC.at.x), label).toBeLessThan(0.5 * L);
        // (and it kept the call in mind until its leap was over, and made no route from where it was)
        expect(held, label).toBe("come");
        expect(engine.debug().asked, label).toBeNull();
      }
    }
  });

  it("is told to come in the air (to the pointer, over `c`), and comes from the shelf it lands on", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { engine, held, stood } = told(seed, "in the air", [{ type: "cat.command", command: "come" }], withPointer);
      expect(stood, `seed ${seed}`).toEqual(["a", "b", "d", "c"]);
      expect(engine.debug().surfaceId, `seed ${seed}`).toBe("c");
      expect(held, `seed ${seed}`).toBe("come");
    }
  });

  it("is told to play in the air: it holds the command until it has landed, and plays from the shelf it lands on (the only leap a cat can make from `b` is its first)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const { held, stood } = told(seed, "in the air", [{ type: "cat.command", command: "play" }]);
      expect(stood.slice(0, 3), `seed ${seed}`).toEqual(["a", "b", "d"]);
      expect(held, `seed ${seed}`).toBe("play");
    }
  });

  it("forgets the call when it is told something else before it can set out, a command to sit, or a poster to show, which it goes to from the shelf it lands on", () => {
    for (const seed of [1, 2]) {
      const { engine, held, stood } = told(seed, "in the air", [toC, { type: "cat.command", command: "sit" }]);
      expect(stood, `seed ${seed}`).toEqual(["a", "b"]);
      expect(engine.debug().act, `seed ${seed}`).toBe("rest:sit");
      expect(held, `seed ${seed}`).toBeNull();
    }
    const { held, waiting, stood } = told(1, "in the air", [toC, { type: "cat.point", targetId: poster.id }], withPoster);
    expect(stood.slice(0, 3)).toEqual(["a", "b", "d"]);
    expect(stood).not.toContain("c");
    expect(held).toBeNull();
    expect(waiting).toBe(poster.id);
  });

  it("forgets the call when the page sends the cat away (a menu opens) before it can set out: it does not go to the place when it is back", () => {
    const engine = leaping(1, "in the air");
    const stood = [engine.debug().surfaceId!];
    engine.send(toC);
    engine.update(world, 1 / 30);
    expect(engine.debug().asked).toBe("come");
    watch(engine, stood, { ...world, mode: "away" }, 1);
    expect(engine.debug().asked).toBeNull();
    watch(engine, stood, world, 12);
    expect(stood).not.toContain("c");
    expect(engine.debug().asked).toBeNull();
  });

  it("is not called while a hand has it, and the call is not remembered for when it is let go", () => {
    const engine = new CatEngine(1);
    run(engine, page(a), 5);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, world, 1);
    engine.send({ type: "cat.grab", at: { x: engine.frame.x, y: engine.frame.y - 0.4 * L } });
    engine.update(world, 1 / 30);
    expect(engine.debug().act).toBe("carried");
    engine.send(toC);
    engine.send({ type: "cat.command", command: "come" });
    engine.send({ type: "cat.command", command: "play" });
    engine.update(world, 1 / 30);
    expect(engine.debug().act).toBe("carried");
    expect(engine.debug().asked).toBeNull();
    engine.send({ type: "cat.drop" });
    const stood = [engine.debug().surfaceId!];
    watch(engine, stood, world, 4);
    expect(engine.debug().asked).toBeNull();
    expect(stood).not.toContain("c");
  });
});

describe("the cat on a row of posters that is scrolled sideways", () => {
  interface Entry {
    act: string;
    surface: string | null;
    f: CatFrame;
  }
  const slid =(base: World, surfaceId: string, dx: number): World => ({ ...base, targets: base.targets.map((t) => (t.surfaceId === surfaceId ? { ...t, rect: { ...t.rect, x: t.rect.x + dx } } : t)) });
  /**
   * A cat that is sitting on a shelf, the row it sits on slid by `step` pixels every tenth of a second, `reads` times over (a fresh list of posters at every read, the shelf itself
   * where it was), toward the middle of the screen, and then stepped on for `after` seconds. What it did, and where it was.
   */
  const slide = (seed: number, step: number, reads: number, options: { page?: PageOptions; after?: number } = {}) => {
    const engine = new CatEngine(seed);
    const base = browseWorld(options.page ?? defaultPage());
    run(engine, base, 6);
    // (called to the second row, which is on the screen whole, and told to sit there)
    engine.send({ type: "cat.call", at: { x: 900, y: 861 } });
    run(engine, base, 8);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, base, 1);
    const surface = engine.debug().surfaceId!;
    const x0 = engine.frame.x;
    const toward = x0 < base.viewport.w / 2 ? 1 : -1;
    const log: Entry[] = [];
    let offset = 0;
    let read = base;
    const keep = (f: CatFrame): void => {
      log.push({ act: engine.debug().act, surface: engine.debug().surfaceId, f: { ...f } });
    };
    for (let i = 0; i < reads; i++) {
      offset += toward * step;
      read = slid(base, surface, offset);
      stepCat(engine, read, 0.1, 30, keep);
    }
    const carried = engine.frame.x - x0;
    stepCat(engine, read, options.after ?? 3, 30, keep);
    return { engine, log, x0, surface, offset, carried, L: base.bodyLength, toward };
  };

  it("goes with the posters, sitting, for a short way, and does not hop for that", () => {
    for (const seed of [1, 2, 3]) {
      const { log, carried, offset, x0, toward } = slide(seed, 20, 4, { after: 0 });
      // (it was carried what the posters moved, to within a few pixels, the way they moved)
      expect(Math.sign(carried), `seed ${seed}`).toBe(toward);
      expect(Math.abs(carried - offset), `seed ${seed}`).toBeLessThan(8);
      expect(log.some((e) => e.act === "jump"), `seed ${seed}`).toBe(false);
      expect(log[log.length - 1]!.act, `seed ${seed}`).toBe("rest:sit");
      expect(Math.abs(log[log.length - 1]!.f.x - x0 - offset), `seed ${seed}`).toBeLessThan(8);
    }
  });

  it("hops back to where it was after the posters have carried it a good way, or, now and then, off to another shelf, and is on its feet again in the end", () => {
    let back = 0;
    let away = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const { log, x0, surface, L } = slide(seed, 20, 10);
      const label = `seed ${seed}`;
      const first = log.findIndex((e) => e.act === "jump");
      expect(first, label).toBeGreaterThanOrEqual(0);
      // (where it came down, on its feet and done with the leap: a lively cat goes on to something of its own after that)
      const down = log.findIndex((e, i) => i > first && e.f.grounded && e.act !== "jump");
      expect(down, label).toBeGreaterThan(first);
      const end = log[down]!;
      expect(log[log.length - 1]!.f.grounded, label).toBe(true);
      if (end.surface !== surface) away++;
      else {
        back++;
        expect(Math.abs(end.f.x - x0), label).toBeLessThan(0.75 * L);
      }
    }
    expect(back).toBeGreaterThanOrEqual(8);
    expect(away).toBeGreaterThanOrEqual(1);
  });

  it("only goes with the posters, and does not hop, for a viewer who wants quiet or less motion", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const page = defaultPage();
      page[flag] = true;
      const { log, x0, toward } = slide(2, 20, 15, { page, after: 2 });
      expect(log.some((e) => e.act === "jump" || e.act === "walk"), flag).toBe(false);
      expect(Math.sign(log[log.length - 1]!.f.x - x0), flag).toBe(toward);
      expect(Math.abs(log[log.length - 1]!.f.x - x0), flag).toBeGreaterThan(100);
    }
  });

  it("does not carry a cat that is in a hand: the hand has it, whatever the row under it does", () => {
    const xs = (sliding: boolean): number[] => {
      const engine = new CatEngine(5);
      const base = browseWorld(defaultPage());
      run(engine, base, 6);
      const surface = engine.debug().surfaceId!;
      engine.send({ type: "cat.grab", at: { x: 700, y: 500 } });
      const out: number[] = [];
      let read = base;
      for (let i = 0; i < 12; i++) {
        if (sliding) read = slid(base, surface, 30 * (i + 1));
        out.push(...stepCat(engine, read, 0.1).frames.map((f) => Number(f.x.toFixed(3))));
      }
      return out;
    };
    expect(xs(true)).toEqual(xs(false));
  });
});

describe("the cat on a page that is flung (scrolled fast)", () => {
  interface Entry {
    act: string;
    flung: boolean;
    surface: string | null;
    jumpTo: string | null;
    f: CatFrame;
  }
  /**
   * A cat settled on the top row (right of the banner) or on the foot of the screen, the page then taken from `from` to `to` pixels of scroll at `perFrame` pixels a frame (at 60
   * frames a second, a fresh read of the page at every frame), and held there for `after` seconds. What it did at every frame, from the first of the fling.
   */
  const fling = (seed: number, perFrame: number, to: number, options: { page?: PageOptions; from?: number; after?: number; on?: "row" | "floor"; ask?: (engine: CatEngine, world: World) => void; shape?: (world: World, shelf: string | null) => World } = {}) => {
    const page = options.page ?? defaultPage();
    page.scroll = options.from ?? 0;
    const engine = new CatEngine(seed);
    const base = browseWorld(page);
    run(engine, base, 6);
    engine.send({ type: "cat.call", at: options.on === "floor" ? { x: 1500, y: 1074 } : { x: 1500, y: 511 - page.scroll } });
    run(engine, base, 8);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, base, 1);
    const surface = engine.debug().surfaceId;
    const y0 = engine.frame.y;
    options.ask?.(engine, base);
    const log: Entry[] = [];
    const keep = (f: CatFrame): void => {
      const d = engine.debug();
      log.push({ act: d.act, flung: d.flung, surface: d.surfaceId, jumpTo: d.jumpTo, f: { ...f } });
    };
    let scroll = page.scroll;
    let world = base;
    let clock = 0;
    const dir = Math.sign(to - scroll);
    while (scroll !== to) {
      scroll += dir * Math.min(perFrame, Math.abs(to - scroll));
      world = { ...browseWorld({ ...page, scroll }), readAt: (clock += 1000 / 60) };
      if (options.shape) world = options.shape(world, surface);
      stepCat(engine, world, 1 / 60, 60, keep);
    }
    // (the host goes on reading the page, at every frame, for a moment after it stopped, and the world it hands the cat is the very same one, read again)
    let held = 0;
    stepCat(engine, world, options.after ?? 5, 60, (f) => {
      keep(f);
      if (held++ < 27) world.readAt = clock += 1000 / 60;
    });
    return { engine, log, surface, y0, world, L: base.bodyLength };
  };

  it("does not float up with its shelf: it is shaken off it, and falls as gravity has it, to the foot of the screen if the page keeps flying", () => {
    for (const seed of [1, 2, 3, 4]) {
      // (a fling of a second and a third: it is on the foot of the screen well before the page stops)
      const { log, surface, y0, L } = fling(seed, 100, 8000);
      const label = `seed ${seed}`;
      expect(surface, label).toBe("p1:row0");
      const first = log.findIndex((e) => e.flung);
      // (within a few frames of the fling's start: two reads of a page that goes by that fast)
      expect(first, label).toBeGreaterThanOrEqual(0);
      expect(first, label).toBeLessThan(5);
      const air = log.slice(first).filter((e) => e.flung);
      expect(air.length, label).toBeGreaterThan(8);
      expect(air.every((e) => e.act === "fall" && !e.f.grounded), label).toBe(true);
      // (it went up with the shelf for one read at most -- it could not know -- and not a pixel after: from there on it only falls, a little more every frame, never faster than a cat can)
      expect(Math.min(...log.map((e) => e.f.y)), label).toBeGreaterThan(y0 - 100 - 1);
      for (let i = first + 1; i < log.length && log[i]!.flung; i++) {
        const step = log[i]!.f.y - log[i - 1]!.f.y;
        expect(step, label).toBeGreaterThanOrEqual(0);
        expect(step, label).toBeLessThanOrEqual((14 * L) / 60 + 0.01);
      }
      // (and that hangs: it takes the better part of half a second to come down by the three lengths of itself that the shelf above the banner is from the foot of the screen)
      expect(air.length, label).toBeGreaterThan(15);
      // (as gravity has it: a quarter of a second in, it has fallen what a cat falls in that time, give or take the first frame)
      expect(log[first + 15]!.f.y - log[first]!.f.y, label).toBeGreaterThan(0.8 * 0.5 * GRAVITY * L * 0.25 ** 2);
      const end = log[log.length - 1]!;
      expect(end.surface, label).toBe("floor");
      expect(end.f.grounded, label).toBe(true);
      expect(Math.abs(end.f.y - 1074), label).toBeLessThan(1);
      // (it is handed to the foot of the screen as it comes down to it, with the page still flying, and does not go past it and out of sight)
      expect(Math.max(...log.map((e) => e.f.y)), label).toBeLessThanOrEqual(1074.5);
      expect(Math.min(...log.slice(first).map((e) => e.f.appear)), label).toBeGreaterThan(0.95);
    }
  });

  it("comes down on the first shelf under it once the page has slowed, and carries on as a cat does that has come down", () => {
    for (const seed of [1, 2, 3, 4]) {
      // (four frames of it, and the page stops with the second row a little under the cat, which has been shaken off the top one)
      const { log } = fling(seed, 100, 400);
      const label = `seed ${seed}`;
      const first = log.findIndex((e) => e.flung);
      expect(first, label).toBeGreaterThanOrEqual(0);
      const land = log.findIndex((e, i) => i > first && e.f.grounded);
      expect(land, label).toBeGreaterThan(first);
      expect(log[land]!.surface, label).toBe("p1:row1");
      expect(log[land]!.f.y, label).toBeCloseTo(461, 0);
      // (and it sits a moment, and washes, as it does when a hand has let it go)
      expect(log.slice(land).some((e) => e.act === "rest:sit"), label).toBe(true);
      expect(log[log.length - 1]!.f.grounded, label).toBe(true);
    }
  });

  it("is shaken off by a page that is flung down from under it, too, and falls (it is not carried down faster than it would fall)", () => {
    for (const seed of [1, 2]) {
      const { log, surface, L } = fling(seed, 100, 0, { from: 700 });
      const label = `seed ${seed}`;
      expect(surface, label).toBe("p1:row2");
      const first = log.findIndex((e) => e.flung);
      expect(first, label).toBeGreaterThanOrEqual(0);
      expect(first, label).toBeLessThan(5);
      for (let i = first + 1; i < log.length && log[i]!.flung; i++) {
        const step = log[i]!.f.y - log[i - 1]!.f.y;
        expect(step, label).toBeGreaterThanOrEqual(0);
        expect(step, label).toBeLessThanOrEqual((14 * L) / 60 + 0.01);
      }
      expect(log[log.length - 1]!.f.grounded, label).toBe(true);
    }
  });

  it("is shaken off even when the first look at the fling finds its shelf gone (slid up out of the rows) and it has begun to leap to another: the leap is given up, and it falls from where it was", () => {
    // (the page drops a shelf that has slid above the top of the rows: the cat sees a shelf that is gone, and leaps to the next, which the fling takes away from it as well)
    const gone = (world: World, shelf: string | null): World => ({ ...world, surfaces: world.surfaces.filter((s) => s.id !== shelf), targets: world.targets.filter((t) => t.surfaceId !== shelf) });
    for (const seed of [1, 2, 3, 4]) {
      const { log, y0, L } = fling(seed, 100, 8000, { shape: gone });
      const label = `seed ${seed}`;
      expect(log[0]!.act, label).toBe("jump");
      const first = log.findIndex((e) => e.flung);
      expect(first, label).toBeGreaterThan(0);
      expect(first, label).toBeLessThan(4);
      // (it did not go up a pixel after that, nor chase the shelf it was to leap to: it hung where it was, and fell, and the page, which has no shelf to be on, took no part in it)
      expect(Math.min(...log.map((e) => e.f.y)), label).toBeGreaterThan(y0 - 1);
      for (let i = first + 1; i < log.length && log[i]!.flung; i++) {
        const step = log[i]!.f.y - log[i - 1]!.f.y;
        expect(step, label).toBeGreaterThanOrEqual(0);
        expect(step, label).toBeLessThanOrEqual((14 * L) / 60 + 0.01);
      }
      expect(log.slice(first).filter((e) => e.flung).length, label).toBeGreaterThan(15);
      // (and it is not leaping to anything any more)
      expect(log.filter((e) => e.flung).every((e) => e.jumpTo === null), label).toBe(true);
      const end = log[log.length - 1]!;
      expect(end.surface, label).toBe("floor");
      expect(end.f.grounded, label).toBe(true);
      expect(Math.abs(end.f.y - 1074), label).toBeLessThan(1);
    }
  });

  it("is shaken off in the middle of a leap, too: it goes the way it was going for a moment, then falls, and does not chase the shelf it was leaping to", () => {
    for (const seed of [1, 2, 3, 4]) {
      const label = `seed ${seed}`;
      const engine = new CatEngine(seed);
      const page = defaultPage();
      const base = browseWorld(page);
      run(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 1500, y: 511 } });
      run(engine, base, 8);
      engine.send({ type: "cat.command", command: "play" });
      // (on, until it is in the air on a leap from the top row)
      let guard = 0;
      while (!(engine.debug().act === "jump" && !engine.frame.grounded) && guard++ < 1800) stepCat(engine, base, 1 / 60, 60);
      expect(guard, label).toBeLessThan(1800);
      const log: Entry[] = [];
      let scroll = 0;
      let clock = 0;
      while (scroll < 8000) {
        scroll += 100;
        const world = { ...browseWorld({ ...page, scroll }), readAt: (clock += 1000 / 60) };
        stepCat(engine, world, 1 / 60, 60, (f) => {
          const d = engine.debug();
          log.push({ act: d.act, flung: d.flung, surface: d.surfaceId, jumpTo: d.jumpTo, f: { ...f } });
        });
      }
      const L = base.bodyLength;
      const first = log.findIndex((e) => e.flung);
      expect(first, label).toBeGreaterThanOrEqual(0);
      expect(first, label).toBeLessThan(5);
      // (no lurch: the speed it is going at is the one it had, and the fall goes on from there)
      const was = first > 0 ? log[first - 1]!.f : undefined;
      if (was) {
        expect(Math.abs(log[first]!.f.vy - was.vy), label).toBeLessThan(0.5 * L);
        expect(Math.abs(log[first]!.f.y - was.y), label).toBeLessThan(0.3 * L);
      }
      // (it rises no further than the speed it had takes it, and then it only falls, never faster than a cat can)
      const rising = Math.min(0, log[first]!.f.vy);
      const top = log[first]!.f.y - (rising * rising) / (2 * GRAVITY * L);
      for (let i = first; i < log.length && log[i]!.flung; i++) {
        expect(log[i]!.f.y, `${label} at ${i}`).toBeGreaterThanOrEqual(top - 0.5);
        if (i > first) expect(log[i]!.f.y - log[i - 1]!.f.y, `${label} at ${i}`).toBeLessThanOrEqual((14 * L) / 60 + 0.01);
      }
      expect(log.slice(first).filter((e) => e.flung).length, label).toBeGreaterThan(8);
      expect(log.filter((e) => e.flung).every((e) => e.jumpTo === null), label).toBe(true);
      const end = log[log.length - 1]!;
      expect(end.f.grounded, label).toBe(true);
      expect(end.surface, label).toBe("floor");
    }
  });

  it("is not shaken off by a page that jumped, once, or that goes by slowly: only by one that is flung, read after read", () => {
    // (the page scrolled to a poster, in one read, is not a fling: the cat is on the shelf the scroll brought to where its feet are)
    const engine = new CatEngine(3);
    const base = browseWorld(defaultPage());
    run(engine, base, 6);
    engine.send({ type: "cat.call", at: { x: 1500, y: 511 } });
    run(engine, base, 8);
    const jumped = browseWorld({ ...defaultPage(), scroll: 350 });
    const acts = new Set<string>();
    stepCat(engine, jumped, 4, 60, () => {
      acts.add(engine.debug().act);
      expect(engine.debug().flung).toBe(false);
    });
    expect(acts.has("fall")).toBe(false);
    // (a page scrolled at 600 pixels a second, which is a finger that drags it, takes the cat with the shelf and it stays on its feet; so does a step of the remote, which goes by at
    // twenty-odd body lengths a second at the quickest. A wheel spun fast, 55 pixels a frame for a screenful, is not on this list any more: it is shaken off, see below)
    for (const [perFrame, to] of [
      [10, 350],
      [40, 327],
    ] as const) {
      const { log } = fling(3, perFrame, to);
      expect(log.some((e) => e.flung), `${perFrame} px a frame`).toBe(false);
      expect(log.some((e) => e.act === "fall"), `${perFrame} px a frame`).toBe(false);
    }
  });

  it("does not shake off a cat that is showing the viewer a poster, nor one that must not move about, nor one that is on the foot of the screen", () => {
    const point = (engine: CatEngine, world: World): void => {
      engine.send({ type: "cat.point", targetId: world.targets.find((t) => t.id === "p1:r1c4")!.id });
    };
    const quiet = defaultPage();
    quiet.quiet = true;
    const still = defaultPage();
    still.reducedMotion = true;
    for (const [name, run_] of [
      ["showing a poster", fling(2, 100, 3000, { ask: point })],
      ["quiet", fling(2, 100, 3000, { page: quiet })],
      ["reduced motion", fling(2, 100, 3000, { page: still })],
      ["on the foot of the screen", fling(2, 100, 3000, { on: "floor" })],
    ] as const) {
      expect(run_.log.some((e) => e.flung || e.act === "fall"), name).toBe(false);
    }
  });

  it("shakes a sleeping cat off its shelf as well, and it is startled", () => {
    const { log } = fling(5, 100, 3000, {
      ask: (engine) => {
        engine.send({ type: "cat.command", command: "sleep" });
      },
    });
    const first = log.findIndex((e) => e.flung);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(log[first + 1]!.f.emote).toBe("startle");
    expect(log[first + 1]!.f.clip).toBe("jump");
    expect(log[log.length - 1]!.f.grounded).toBe(true);
  });
});

describe("the cat on a page that is scrolled down too far and too fast to be a step of the remote (it would float up with its shelf)", () => {
  interface Entry {
    act: string;
    flung: boolean;
    surface: string | null;
    f: CatFrame;
  }
  /** The pitch of the rows of the made-up page, in pixels: what a step of the remote scrolls it by. */
  const PITCH = 350;
  /** The fractions of a step of the remote that go by in each frame at 60 a second (measured in a browser): up to 48 body lengths a second for a frame, and over in a quarter of a second. */
  const EASE = [0.04, 0.15, 0.45, 0.8, 0.51, 0.31, 0.22, 0.14, 0.11, 0.08, 0.05, 0.04, 0.03, 0.01].map((n) => n / 2.93);
  const stepOf = (px = PITCH): number[] => EASE.map((n) => n * px);
  const idle = (frames: number): number[] => Array.from({ length: frames }, () => 0);
  const even = (px: number, frames: number): number[] => Array.from({ length: frames }, () => px);
  /** Twelve notches of a wheel that does not smooth: a hundred pixels in a frame, and the next frame still, thirty milliseconds apart. */
  const NOTCHES = Array.from({ length: 12 }, () => [100, 0]).flat();
  /**
   * A cat settled on `row` of a page of twelve (at `from` pixels of scroll), the page then scrolled by `deltas` pixels a frame, down positive, at 60 frames a second -- a fresh read of the page
   * in every frame in which it moved, and the very same world in the frames in which it did not -- and held there for a moment. What it did at every frame.
   */
  const scrolled = (seed: number, deltas: number[], options: { row?: number; from?: number; page?: PageOptions; shape?: (world: World) => World; ask?: (engine: CatEngine, world: World) => void } = {}) => {
    const page = { ...(options.page ?? defaultPage()), rows: 12 };
    page.scroll = options.from ?? 350;
    const shape = options.shape ?? ((world: World) => world);
    const engine = new CatEngine(seed);
    const base = shape(browseWorld(page));
    run(engine, base, 6);
    const row = options.row ?? 2;
    engine.send({ type: "cat.call", at: { x: 1500, y: 511 + 350 * row - page.scroll } });
    run(engine, base, 8);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, base, 1);
    const surface = engine.debug().surfaceId;
    const y0 = engine.frame.y;
    options.ask?.(engine, base);
    const log: Entry[] = [];
    const keep = (f: CatFrame): void => {
      const d = engine.debug();
      log.push({ act: d.act, flung: d.flung, surface: d.surfaceId, f: { ...f } });
    };
    let scroll = page.scroll;
    let world = base;
    let clock = 0;
    const travelled: number[] = [];
    for (const delta of deltas) {
      if (delta !== 0) {
        scroll += delta;
        world = { ...shape(browseWorld({ ...page, scroll })), readAt: (clock += 1000 / 60) };
      }
      travelled.push(scroll - page.scroll);
      stepCat(engine, world, 1 / 60, 60, keep);
    }
    // (the host goes on reading the page, at every frame, for a moment after it stopped)
    let held = 0;
    stepCat(engine, world, 4, 60, (f) => {
      keep(f);
      if (held++ < 27) world.readAt = clock += 1000 / 60;
    });
    return { engine, log, surface, row, y0, travelled, L: base.bodyLength };
  };
  /** It went with its shelf, every frame of the page's way (to the pixel; what it does of its own accord after that is its own), and did not fall. */
  const rides = (run_: ReturnType<typeof scrolled>, label: string): void => {
    expect(run_.surface, label).toBe(`p1:row${run_.row}`);
    expect(run_.log.some((e) => e.flung || e.act === "fall"), label).toBe(false);
    const moving = run_.travelled.findLastIndex((by, i) => by !== (run_.travelled[i - 1] ?? 0));
    run_.travelled.slice(0, moving + 2).forEach((by, i) => {
      // (a cat that begins a leap of its own, now the page has stopped, is crouching: that is not the page's doing)
      if (run_.log[i]!.act === "jump") return;
      expect(run_.log[i]!.surface, `${label} at ${i}`).toBe(run_.surface);
      expect(Math.abs(run_.log[i]!.f.y - (run_.y0 - by)), `${label} at ${i}`).toBeLessThan(1);
    });
  };
  /** The shelf of the page as it stands at the end that a cat falling from `y` comes down on first. */
  const firstUnder = (scroll: number, y: number): string => {
    const world = browseWorld({ ...defaultPage(), rows: 12, scroll });
    return world.surfaces.filter((s) => s.kind === "shelfTop" && s.y >= y - 1).sort((a, b) => a.y - b.y)[0]!.id;
  };

  it("takes the cat with its shelf for a step of the remote, and for the first step of all, where the banner folds up and the rows jump before they scroll", () => {
    rides(scrolled(1, [...stepOf(), ...idle(120)]), "a step");
    // (the page laid out again by half a banner in one frame, a few frames of nothing, and then the step)
    rides(scrolled(2, [170, ...idle(3), ...stepOf(), ...idle(120)]), "the first step");
    // (and the same step for a cat that is smaller, or larger, than the page is built for: a step is a row's pitch, whatever the cat's size makes of a body length)
    for (const size of [0.8, 1.35]) rides(scrolled(3, [...stepOf(), ...idle(120)], { shape: (world) => ({ ...world, bodyLength: world.bodyLength * size }) }), `a cat of ${size}`);
  });

  it("takes the cat with its shelf for two steps with a pause between them, but shakes it off in the second of two steps close together", () => {
    // (a second between the starts of the two, and then seven tenths of a second)
    rides(scrolled(1, [...stepOf(), ...idle(46), ...stepOf(), ...idle(120)], { from: 0, row: 1 }), "a second apart");
    rides(scrolled(1, [...stepOf(), ...idle(28), ...stepOf(), ...idle(120)], { from: 0, row: 1 }), "seven tenths of a second apart");
    for (const seed of [1, 2, 3]) {
      // (the second a third of a second after the first began, a tenth of a second after it came to rest: the page has not been still for a sixth of a second between them)
      const { log, y0 } = scrolled(seed, [...stepOf(), ...idle(4), ...stepOf(), ...idle(120)], { from: 0, row: 1 });
      const label = `seed ${seed}`;
      const first = log.findIndex((e) => e.flung);
      expect(first, label).toBeGreaterThanOrEqual(0);
      // (during the second step, and not before it: it has gone up with its shelf by a step and a quarter at the most, and a frame's travel more)
      expect(first, label).toBeGreaterThan(14);
      const risen = Math.min(...log.slice(0, first + 1).map((e) => e.f.y));
      expect(risen, label).toBeGreaterThan(y0 - 1.25 * PITCH - 0.8 * (PITCH / 2.93) - 1);
      expect(risen, label).toBeLessThan(y0 - PITCH);
      expect(log[log.length - 1]!.f.grounded, label).toBe(true);
    }
  });

  it("shakes the cat off a page that is scrolled down by a wheel spun fast, by a scrollbar dragged and by three steps at once: it falls from where it has risen to, a step and a quarter at the most, and lands on the first place under it", () => {
    const gestures: Array<[string, number[]]> = [
      ["a wheel spun", NOTCHES],
      // (a screenful in a third of a second, the pointer pulling the thumb, no smoothing: twenty-odd body lengths a second all the way)
      ["a scrollbar dragged", even(42, 22)],
      ["three steps", [...stepOf(), ...idle(4), ...stepOf(), ...idle(4), ...stepOf()]],
      // (a body length a frame: the older rule, the page flung)
      ["a page flung", even(111, 30)],
    ];
    for (const [name, deltas] of gestures) {
      for (const seed of [1, 2]) {
        const label = `${name}, seed ${seed}`;
        const { log, y0, L, travelled } = scrolled(seed, [...deltas, ...idle(8)], { from: 0, row: 1 });
        const first = log.findIndex((e) => e.flung);
        expect(first, label).toBeGreaterThanOrEqual(0);
        // (it rose with the shelf for a step and a quarter, and the frame it was shaken off in: no more)
        expect(Math.min(...log.slice(0, first + 1).map((e) => e.f.y)), label).toBeGreaterThan(y0 - 1.25 * PITCH - Math.max(...deltas) - 1);
        // (and from there on it only falls, never faster than a cat can, until the page has slowed)
        for (let i = first + 1; i < log.length && log[i]!.flung; i++) {
          const step = log[i]!.f.y - log[i - 1]!.f.y;
          expect(step, `${label} at ${i}`).toBeGreaterThanOrEqual(0);
          expect(step, `${label} at ${i}`).toBeLessThanOrEqual((14 * L) / 60 + 0.01);
        }
        // (a wheel turns in notches: between two of them the page is still, and the cat does not land on that account; it comes down when the page has stopped)
        const landed = log.findIndex((e, i) => i > first && e.f.grounded);
        expect(landed, label).toBeGreaterThan(first);
        expect(log.slice(first, landed).every((e) => e.act === "fall" && !e.f.grounded), label).toBe(true);
        // (steps with a pause between them: it comes down in the pause, if the page has slowed to nothing in it, and is shaken off again by the next)
        if (name !== "three steps") expect(landed, label).toBeGreaterThan(deltas.length - 2);
        expect(log[landed]!.f.y, label).toBeGreaterThanOrEqual(log[first]!.f.y);
        // (on the first place under it: when it gave up the air it had fallen as far as the last frame of its fall in the air, and that is the shelf below it then; or the foot of the screen)
        const lastAir = log.reduce((at, e, i) => (e.flung ? i : at), first);
        const under = firstUnder(travelled[travelled.length - 1]!, log[lastAir]!.f.y);
        if (name === "a wheel spun" || name === "a scrollbar dragged") expect(log[landed]!.surface, label).toBe(under);
      }
    }
  });

  it("shakes a cat off a wheel spun fast within a few notches: in a tenth of a second, and not after the page has gone a screenful", () => {
    for (const seed of [1, 2, 3]) {
      const { log } = scrolled(seed, [...NOTCHES, ...idle(8)], { from: 0, row: 1 });
      const first = log.findIndex((e) => e.flung);
      // (the fifth notch is the fifth frame with a hundred pixels in it, the ninth frame: five hundred pixels is a step and a quarter, and more)
      expect(first, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(first, `seed ${seed}`).toBeLessThanOrEqual(9);
    }
  });

  it("does not shake the cat off a page that is scrolled down slowly, however far, nor one that went down and came back, nor one that is scrolled up by as much", () => {
    // (ten body lengths a second for most of a second: far, and not fast)
    rides(scrolled(1, [...even(18, 36), ...idle(120)]), "slowly");
    // (a body length and a half down, and back up the same way)
    rides(scrolled(1, [...even(25, 10), ...even(-25, 10), ...idle(120)]), "down and back");
    // (shelves going down the screen at thirty body lengths a second, the length of a step and a quarter: only the speed of a fling shakes a cat off then; it is not floating)
    for (const seed of [1, 2]) rides(scrolled(seed, [...even(-55, 9), ...idle(120)], { from: 700 }), `scrolled up, seed ${seed}`);
  });

  it("does not shake off a cat that is showing the viewer a poster, nor one that must not move about, nor one that is in a hand or on the foot of the screen", () => {
    const point = (engine: CatEngine, world: World): void => {
      engine.send({ type: "cat.point", targetId: world.targets.find((t) => t.id === "p1:r1c4")!.id });
    };
    const quiet = defaultPage();
    quiet.quiet = true;
    const still = defaultPage();
    still.reducedMotion = true;
    // (a scrollbar dragged for a third of a second: far enough, and fast enough, to shake a cat off, and not so far that its shelf is gone from the screen)
    const drag = even(42, 12);
    for (const [name, run_] of [
      ["showing a poster", scrolled(2, drag, { from: 0, row: 1, ask: point })],
      ["quiet", scrolled(2, drag, { from: 0, row: 1, page: quiet })],
      ["reduced motion", scrolled(2, drag, { from: 0, row: 1, page: still })],
    ] as const) {
      expect(run_.log.some((e) => e.flung || e.act === "fall"), name).toBe(false);
    }
    expect(scrolled(2, drag, { from: 0, row: 1 }).log.some((e) => e.flung), "and a cat that is doing nothing in particular is").toBe(true);
    // (on the foot of the screen, which does not go with the page: called to it before the page moves)
    const engine = new CatEngine(2);
    const page = { ...defaultPage(), rows: 12 };
    const base = browseWorld(page);
    run(engine, base, 6);
    engine.send({ type: "cat.call", at: { x: 1500, y: 1074 } });
    run(engine, base, 8);
    engine.send({ type: "cat.command", command: "sit" });
    run(engine, base, 1);
    expect(engine.debug().surfaceId).toBe("floor");
    let scroll = 0;
    let clock = 0;
    for (const delta of drag) {
      scroll += delta;
      stepCat(engine, { ...browseWorld({ ...page, scroll }), readAt: (clock += 1000 / 60) }, 1 / 60, 60, () => {
        expect(engine.debug().flung).toBe(false);
        expect(engine.debug().act).not.toBe("fall");
      });
    }
    // (and one that a hand has by the scruff is the hand's)
    const held = new CatEngine(2);
    run(held, base, 6);
    held.send({ type: "cat.call", at: { x: 1500, y: 511 } });
    run(held, base, 8);
    held.send({ type: "cat.grab", at: { x: held.frame.x, y: held.frame.y - 40 } });
    stepCat(held, base, 0.5, 60);
    expect(held.debug().act).toBe("carried");
    scroll = 0;
    for (const delta of drag) {
      scroll += delta;
      stepCat(held, { ...browseWorld({ ...page, scroll }), readAt: (clock += 1000 / 60) }, 1 / 60, 60);
      expect(held.debug().act).toBe("carried");
    }
  });
});

describe("what the cat does of its own accord with the posters", () => {
  /** A cat on the made-up page for `seconds`, with the things it chose along the way: when (frames), what, and the frames from there on. */
  const roam = (seed: number, seconds: number, page = defaultPage(), energy?: number) => {
    const engine = new CatEngine(seed);
    const world = browseWorld(page);
    const frames: CatFrame[] = [];
    const acts: string[] = [];
    const choices: Array<{ at: number; name: string }> = [];
    let last = "";
    stepCat(engine, world, seconds, 30, (f) => {
      if (energy !== undefined) engine.mood.energy = energy;
      const choice = engine.debug().choice;
      if (choice !== last) {
        choices.push({ at: frames.length, name: choice });
        last = choice;
      }
      frames.push({ ...f, ...(f.reach ? { reach: { ...f.reach } } : {}) });
      acts.push(engine.debug().act);
    });
    return { world, frames, acts, choices };
  };

  it("pats at a poster on its shelf now and then: it walks up to it, looks over the lip, swats once or twice with the paw on the poster, and sits", () => {
    let pats = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { world, frames, choices } = roam(seed, 900);
      let lastPat = -Infinity;
      for (const choice of choices) {
        if (choice.name !== "pat") continue;
        pats++;
        // (a patient cat: not twice within fifty seconds, the least of the fifty to a hundred it waits)
        expect((choice.at - lastPat) / 30, `seed ${seed}`).toBeGreaterThanOrEqual(50);
        lastPat = choice.at;
        const within = frames.slice(choice.at, choice.at + 40 * 30);
        const hit = within.find((f) => f.clip === "swat" && f.progress >= SWAT_HIT);
        expect(hit, `seed ${seed} pat at ${choice.at / 30} s`).toBeDefined();
        expect(world.targets.some((t) => hit!.reach!.x >= t.rect.x && hit!.reach!.x <= t.rect.x + t.rect.w && hit!.reach!.y >= t.rect.y && hit!.reach!.y <= t.rect.y + t.rect.h), `seed ${seed}`).toBe(true);
        expect(hit!.grounded, `seed ${seed}`).toBe(true);
      }
    }
    expect(pats).toBeGreaterThanOrEqual(3);
  });

  it("has the zoomies when it is lively: runs and leaps from shelf to shelf two or three times and sits down, pleased with itself", () => {
    let runs = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { frames, acts, choices } = roam(seed, 900, defaultPage(), 0.9);
      let lastRun = -Infinity;
      for (const choice of choices) {
        // (one chosen in the last half minute is not seen to the end)
        if (choice.name !== "zoomies" || choice.at + 30 * 30 > frames.length) continue;
        runs++;
        expect((choice.at - lastRun) / 30, `seed ${seed}`).toBeGreaterThanOrEqual(100);
        lastRun = choice.at;
        const next = acts.slice(choice.at, choice.at + 30 * 30);
        // (two or three leaps, and then it sits down on its feet: a lively cat goes on to something of its own after that, in the air at the end of the half minute, say)
        let leaps = 0;
        let sat = -1;
        for (let i = 1; i < next.length && sat < 0; i++) {
          if (next[i] === "jump" && next[i - 1] !== "jump") leaps++;
          if (next[i] === "rest:sit" && leaps >= 2) sat = i;
        }
        expect(leaps, `seed ${seed} zoomies at ${choice.at / 30} s`).toBeGreaterThanOrEqual(2);
        expect(leaps, `seed ${seed} zoomies at ${choice.at / 30} s`).toBeLessThanOrEqual(3);
        expect(sat, `seed ${seed} zoomies at ${choice.at / 30} s: it sat down`).toBeGreaterThan(0);
        expect(frames[choice.at + sat]!.grounded, `seed ${seed}`).toBe(true);
      }
    }
    expect(runs).toBeGreaterThanOrEqual(3);
  });

  it("does neither for a viewer who wants quiet or less motion", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const page = defaultPage();
      page[flag] = true;
      const { frames, choices } = roam(3, 600, page, 0.9);
      expect(choices.some((c) => c.name === "pat" || c.name === "zoomies"), flag).toBe(false);
      expect(frames.some((f) => f.clip === "swat"), flag).toBe(false);
    }
  });

  it("keeps the leaps of 'play' and the zoomies the same kind of thing: a few runs and leaps and a sit", () => {
    const engine = new CatEngine(9);
    const world = browseWorld(defaultPage());
    run(engine, world, 6);
    engine.send({ type: "cat.command", command: "play" });
    const acts: string[] = [];
    stepCat(engine, world, 30, 30, () => {
      acts.push(engine.debug().act);
    });
    expect(acts).toContain("jump");
    expect(acts[acts.length - 1]).toMatch(/^rest:|^walk$|^none$/);
    const reduced = defaultPage();
    reduced.reducedMotion = true;
    const calm = new CatEngine(9);
    const quietWorld = browseWorld(reduced);
    run(calm, quietWorld, 6);
    calm.send({ type: "cat.command", command: "play" });
    const calmFrames = stepCat(calm, quietWorld, 10).frames;
    expect(calmFrames.some((f) => f.clip === "jump" || f.clip === "run")).toBe(false);
  });
});

describe("going about: a cat that is free to roam passes through the foot of the screen, and is a livelier one", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12];
  /** The two pages it is measured on, and a place on the foot of the screen of each: the TV's own library (two shelves and the foot, 1280x720) and the simulator's page (four shelves, 1920x1080). */
  const pages: Array<[string, World, { x: number; y: number }]> = [
    ["the TV's library", tvLibrary, { x: 640, y: 711 }],
    ["the simulator's page", browseWorld(defaultPage()), { x: 900, y: 1074 }],
  ];

  interface Afternoons {
    seen: number;
    foot: number;
    /** Frames asleep on the foot of the screen. */
    napped: number;
    /** The seconds of every stay on the foot of the screen, one after the other. */
    stays: number[];
    hops: number;
    walking: number;
    asleep: number;
    /** Frames at rest, asleep or in a scene of its own. */
    still: number;
  }
  /** What a free cat does over a few afternoons on `world`: where it is, and what it is doing. */
  const afternoons = (world: World, secondsEach = 600): Afternoons => {
    const kinds = new Map(world.surfaces.map((s) => [s.id, s.kind] as const));
    const out: Afternoons = { seen: 0, foot: 0, napped: 0, stays: [], hops: 0, walking: 0, asleep: 0, still: 0 };
    for (const seed of seeds) {
      const engine = new CatEngine(seed);
      let onFoot = 0;
      let wasJumping = false;
      for (let i = 0; i < secondsEach * 30; i++) {
        const f = engine.update(world, 1 / 30);
        const debug = engine.debug();
        if (f.appear <= 0.5) continue;
        out.seen++;
        const kind = f.grounded && debug.surfaceId ? kinds.get(debug.surfaceId) : "air";
        if (kind === "fallbackFloor") {
          out.foot++;
          onFoot++;
          if (debug.act === "sleep") out.napped++;
        } else if (kind !== "air" && onFoot > 0) {
          out.stays.push(onFoot / 30);
          onFoot = 0;
        }
        const jumping = debug.act === "jump";
        if (jumping && !wasJumping) out.hops++;
        wasJumping = jumping;
        if (debug.act === "walk" || debug.act === "stalk") out.walking++;
        if (debug.act === "sleep") out.asleep++;
        if (debug.act.startsWith("rest") || debug.act === "sleep" || debug.act.startsWith("shot")) out.still++;
      }
      if (onFoot > 0) out.stays.push(onFoot / 30);
    }
    return out;
  };
  const kept = new Map<World, Afternoons>();
  const afternoon = (world: World): Afternoons => {
    let one = kept.get(world);
    if (!one) kept.set(world, (one = afternoons(world)));
    return one;
  };

  it("gets up from the foot of the screen onto a shelf in a quarter of a minute or so, called down to it or not: it is a place to pass through", () => {
    for (const [name, world, foot] of pages) {
      const times: number[] = [];
      for (let seed = 1; seed <= 30; seed++) {
        const engine = new CatEngine(seed);
        stepCat(engine, world, 6);
        // (not in the middle of a hop: it would come down on the shelf it is leaping to, and be called there)
        for (let i = 0; i < 20 * 30 && !engine.debug().act.startsWith("rest"); i++) engine.update(world, 1 / 30);
        engine.send({ type: "cat.call", at: foot });
        // (counted from when it has come, and is on its feet there)
        let arrived = -1;
        let left = -1;
        for (let i = 0; i < 120 * 30 && left < 0; i++) {
          const f = engine.update(world, 1 / 30);
          const debug = engine.debug();
          if (arrived < 0) {
            if (debug.surfaceId === "floor" && f.grounded && debug.act !== "walk" && debug.act !== "jump") arrived = i;
          } else if (f.grounded && debug.surfaceId !== "floor" && debug.act !== "fall") left = (i - arrived) / 30;
        }
        times.push(left);
      }
      // (the cat before this one stayed a median half a minute, a tenth of the time more than a minute, and now and then three minutes; measured now, over forty cats: a median of 12 s, a tenth over 19 s, the slowest 32 s and 45 s)
      expect(times.filter((t) => t < 0), name).toEqual([]);
      const sorted = [...times].sort((a, b) => a - b);
      expect(sorted[sorted.length >> 1]!, name).toBeLessThan(16);
      expect(sorted[Math.floor(sorted.length * 0.9)]!, name).toBeLessThan(26);
      expect(sorted[sorted.length - 1]!, name).toBeLessThan(60);
    }
  });

  it("spends hardly any of an afternoon on the foot of the screen of a page that has shelves, and none of it asleep", () => {
    for (const [name, world] of pages) {
      const seen = afternoon(world);
      expect(seen.seen, name).toBeGreaterThan(5000);
      // (measured: 1.1 % on the TV's library and 1.8 % on the simulator's page; the cat before this one 14 % and 24 %, in stays of up to a minute and a half to two and a half minutes)
      expect(seen.foot / seen.seen, name).toBeLessThan(0.04);
      expect(Math.max(0, ...seen.stays), name).toBeLessThan(30);
      expect(seen.napped, name).toBe(0);
    }
  });

  it("goes about more: it hops more, walks more and sleeps less than a cat that was content to stay where it was", () => {
    // (measured on the TV's library, against the cat before this one -- 0.92 hops a minute, 13.6 % of its time walking, 38 % asleep, 84 % still: 1.8, 19.7, 23, 75; on the simulator's page 0.77, 14.1, 37, 84: 1.5, 19.1, 26, 77.
    // The cat with the sleep it had before, but not on the foot, was 27 % and 30 % asleep.)
    for (const [name, world, hops, asleep] of [
      ["the TV's library", tvLibrary, 1.4, 0.25],
      ["the simulator's page", pages[1]![1], 1.25, 0.28],
    ] as const) {
      const seen = afternoon(world);
      expect((seen.hops * 60 * 30) / seen.seen, name).toBeGreaterThan(hops);
      expect(seen.walking / seen.seen, name).toBeGreaterThan(0.16);
      expect(seen.asleep / seen.seen, name).toBeLessThan(asleep);
      expect(seen.still / seen.seen, name).toBeLessThan(0.8);
    }
  });

  it("is as restful as it was on a page that has nothing but the foot of the screen: there it naps, and goes about the place", () => {
    const floorOnly: World = { ...tvLibrary, surfaces: tvLibrary.surfaces.filter((s) => s.kind === "fallbackFloor"), targets: [] };
    const seen = afternoon(floorOnly);
    expect(seen.foot / seen.seen).toBeGreaterThan(0.95);
    expect(seen.asleep / seen.seen).toBeGreaterThan(0.1);
    expect(seen.walking / seen.seen).toBeGreaterThan(0.05);
  });

  it("is not made to go anywhere by it for a viewer who wants quiet or less motion: it stays where it was put", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const world = { ...tvLibrary, [flag]: true };
      for (const seed of [1, 2, 3]) {
        const engine = new CatEngine(seed);
        stepCat(engine, world, 6);
        engine.send({ type: "cat.call", at: { x: 640, y: 711 } });
        stepCat(engine, world, 10);
        const start = engine.debug().surfaceId;
        for (let i = 0; i < 240 * 30; i++) {
          engine.update(world, 1 / 30);
          const debug = engine.debug();
          expect(debug.surfaceId, `${flag} seed ${seed}`).toBe(start);
          expect(["walk", "run", "jump"], `${flag} seed ${seed}`).not.toContain(debug.act);
        }
      }
    }
  });

  it("runs the zoomies from shelf to shelf, and not down to the foot of the screen", () => {
    const world = pages[1]![1];
    const kinds = new Map(world.surfaces.map((s) => [s.id, s.kind] as const));
    let lands = 0;
    let low = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = new CatEngine(seed);
      let last = "";
      let from = -1;
      for (let i = 0; i < 900 * 30; i++) {
        engine.mood.energy = 0.9;
        engine.update(world, 1 / 30);
        const debug = engine.debug();
        if (debug.choice !== last) {
          last = debug.choice;
          from = debug.choice === "zoomies" ? i : -1;
        }
        // (where it sits down at the end of it)
        if (from >= 0 && debug.act === "rest:sit" && i - from > 20) {
          lands++;
          if (kinds.get(debug.surfaceId ?? "") === "fallbackFloor") low++;
          from = -1;
        }
      }
    }
    expect(lands).toBeGreaterThanOrEqual(10);
    expect(low).toBeLessThanOrEqual(lands * 0.1);
  });

  /** What the cat did of its own accord when a card got the focus on another shelf: when it chose to follow, and the frame in which it first sat on that shelf afterwards. */
  const followed = (seed: number) => {
    const page = defaultPage();
    const base = browseWorld(page);
    const engine = new CatEngine(seed);
    stepCat(engine, base, 6);
    // (on the second shelf, and the focus is moved to a card on the first)
    engine.send({ type: "cat.call", at: { x: 900, y: 861 } });
    stepCat(engine, base, 12);
    page.focus = { row: 0, col: 3 };
    const world = browseWorld(page);
    engine.send({ type: "catalog.itemFocused", id: "p1:r0c3" });
    let last = engine.debug().choice;
    let chose = -1;
    let sat = undefined as CatFrame | undefined;
    stepCat(engine, world, 30, 30, (f, t) => {
      const debug = engine.debug();
      if (debug.choice !== last) {
        last = debug.choice;
        if (debug.choice === "follow" && chose < 0) chose = t;
      }
      if (chose >= 0 && !sat && debug.act === "rest:sit" && debug.surfaceId === "p1:row0") sat = { ...f, ...(f.look ? { look: { ...f.look } } : {}) };
    });
    return { chose, sat, card: world.focus!, L: world.bodyLength };
  };

  it("goes over to the card that got the focus, on another shelf, and sits by it, looking at it", () => {
    let went = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { chose, sat, card, L } = followed(seed);
      // (one that set out in the last ten seconds of the half minute is not seen to the end)
      if (chose < 0 || chose > 20) continue;
      went++;
      const label = `seed ${seed}`;
      expect(sat, label).toBeDefined();
      // (within a moment's walk of it, and its eyes on it)
      expect(Math.abs(sat!.x - (card.x + card.w / 2)), label).toBeLessThan(card.w / 2 + 1.6 * L);
      expect(sat!.look, label).toBeDefined();
      expect(sat!.look!.x, label).toBeGreaterThan(card.x);
      expect(sat!.look!.x, label).toBeLessThan(card.x + card.w);
      expect(sat!.look!.y, label).toBeGreaterThan(card.y);
      expect(sat!.look!.y, label).toBeLessThan(card.y + card.h);
    }
    // (measured: 8 of 40 cats in half a minute; the rest were busy with something of their own when the focus moved, or tired, and the focus of a viewer who goes on down the library is news again at every card)
    expect(went).toBeGreaterThanOrEqual(4);
  });

  it("does not follow a card that got the focus a long while ago, or is on the shelf it is on, or when the viewer wants quiet or less motion", () => {
    // a focus that moved to a card on the shelf the cat is on (it may leave that shelf of its own accord, and come back to the card: it does not set out for a card that is on the shelf it is on)
    for (let seed = 1; seed <= 20; seed++) {
      const page = defaultPage();
      const base = browseWorld(page);
      const engine = new CatEngine(seed);
      stepCat(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 900, y: 861 } });
      stepCat(engine, base, 12);
      // (whichever shelf it is on by now)
      const row = /row(\d)/.exec(engine.debug().surfaceId ?? "")?.[1];
      if (row === undefined) continue;
      page.focus = { row: Number(row), col: 5 };
      const world = browseWorld(page);
      engine.send({ type: "catalog.itemFocused", id: `p1:r${row}c5` });
      let last = engine.debug().choice;
      stepCat(engine, world, 25, 30, () => {
        const debug = engine.debug();
        if (debug.choice !== last) {
          last = debug.choice;
          if (debug.choice === "follow") expect(debug.surfaceId, `same shelf, seed ${seed}`).not.toBe(`p1:row${row}`);
        }
      });
    }
    // a card that has had the focus for a long while (the cat was never told it moved)
    for (let seed = 1; seed <= 12; seed++) {
      const page = defaultPage();
      const base = browseWorld(page);
      const engine = new CatEngine(seed);
      stepCat(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 900, y: 861 } });
      stepCat(engine, base, 12);
      page.focus = { row: 0, col: 3 };
      const world = browseWorld(page);
      let last = engine.debug().choice;
      stepCat(engine, world, 120, 30, () => {
        const debug = engine.debug();
        if (debug.choice !== last) {
          last = debug.choice;
          expect(debug.choice, `long ago, seed ${seed}`).not.toBe("follow");
        }
      });
    }
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const page = { ...defaultPage(), [flag]: true };
      const engine = new CatEngine(3);
      stepCat(engine, browseWorld(page), 6);
      page.focus = { row: 0, col: 3 };
      const world = browseWorld(page);
      engine.send({ type: "catalog.itemFocused", id: "p1:r0c3" });
      const { frames } = stepCat(engine, world, 40);
      expect(frames.some((f) => f.clip === "walk" || f.clip === "jump"), flag).toBe(false);
    }
  });

  /** What the cat did of its own accord when a pointer came to rest far from it: the frame in which it first sat looking at the pointer afterwards, and whether it chose to greet it. */
  const greeted = (seed: number, pointer: { x: number; y: number }) => {
    const page = defaultPage();
    const base = browseWorld(page);
    const engine = new CatEngine(seed);
    stepCat(engine, base, 6);
    engine.send({ type: "cat.call", at: { x: 1600, y: 861 } });
    stepCat(engine, base, 12);
    const world = browseWorld(page, { pointer });
    let last = engine.debug().choice;
    let chose = -1;
    let sat = undefined as CatFrame | undefined;
    stepCat(engine, world, 30, 30, (f, t) => {
      const debug = engine.debug();
      if (debug.choice !== last) {
        last = debug.choice;
        if (debug.choice === "greet" && chose < 0) chose = t;
      }
      if (chose >= 0 && !sat && debug.act === "rest:sit") sat = { ...f, ...(f.look ? { look: { ...f.look } } : {}) };
    });
    return { chose, sat, L: world.bodyLength };
  };

  it("comes over to a pointer that has rested for a while some way off, and sits where it can see it", () => {
    const pointer = { x: 600, y: 800 };
    let came = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { chose, sat, L } = greeted(seed, pointer);
      if (chose < 0 || chose > 20) continue;
      came++;
      const label = `seed ${seed}`;
      expect(sat, label).toBeDefined();
      expect(Math.abs(sat!.x - pointer.x), label).toBeLessThan(2.2 * L);
      expect(sat!.look!.x, label).toBeCloseTo(pointer.x, 0);
      expect(sat!.look!.y, label).toBeCloseTo(pointer.y, 0);
      // (on the shelf under it)
      expect(sat!.y - pointer.y, label).toBeGreaterThan(0);
      expect(sat!.y - pointer.y, label).toBeLessThan(1.4 * L);
    }
    // (measured: 18 of 40 cats in half a minute, 14 in the first twenty seconds of it)
    expect(came).toBeGreaterThanOrEqual(8);
  });

  it("does not come over to a pointer that is on the move, or is beside it already, or for a viewer who wants quiet or less motion", () => {
    for (let seed = 1; seed <= 10; seed++) {
      // a pointer that goes to and fro all the time (never at rest for a second)
      const page = defaultPage();
      const base = browseWorld(page);
      const engine = new CatEngine(seed);
      stepCat(engine, base, 6);
      engine.send({ type: "cat.call", at: { x: 1600, y: 861 } });
      stepCat(engine, base, 12);
      let last = engine.debug().choice;
      for (let i = 0; i < 90 * 30; i++) {
        const x = 300 + 700 * (0.5 + 0.5 * Math.sin(i / 20));
        engine.update(browseWorld(page, { pointer: { x, y: 800 } }), 1 / 30);
        const debug = engine.debug();
        if (debug.choice !== last) {
          last = debug.choice;
          expect(debug.choice, `moving, seed ${seed}`).not.toBe("greet");
        }
      }
      // a pointer that rests two body lengths from it, wherever it goes (a pointer that near is the bat's, not a greeting's)
      const near = new CatEngine(seed);
      stepCat(near, base, 6);
      last = near.debug().choice;
      for (let i = 0; i < 90 * 30; i++) {
        const f = near.frame;
        const side = f.x < base.viewport.w / 2 ? 1 : -1;
        near.update(browseWorld(page, { pointer: { x: f.x + side * 2 * base.bodyLength, y: f.y - 0.5 * base.bodyLength } }), 1 / 30);
        const debug = near.debug();
        if (debug.choice !== last) {
          last = debug.choice;
          expect(debug.choice, `beside it, seed ${seed}`).not.toBe("greet");
        }
      }
    }
    for (const flag of ["quiet", "reducedMotion"] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const page = { ...defaultPage(), [flag]: true };
        const engine = new CatEngine(seed);
        stepCat(engine, browseWorld(page), 6);
        let last = engine.debug().choice;
        const { frames } = stepCat(engine, browseWorld(page, { pointer: { x: 600, y: 800 } }), 60, 30, () => {
          const debug = engine.debug();
          if (debug.choice !== last) {
            last = debug.choice;
            expect(debug.choice, `${flag} seed ${seed}`).not.toBe("greet");
          }
        });
        expect(frames.some((f) => f.clip === "walk" || f.clip === "jump"), `${flag} seed ${seed}`).toBe(false);
      }
    }
  });

  it("visits a poster on another shelf now and then: goes over, creeps up on it, pats it, and sits", () => {
    const world = tvLibrary;
    const L2 = world.bodyLength;
    let visits = 0;
    for (const seed of seeds) {
      const engine = new CatEngine(seed);
      const frames: Array<{ f: CatFrame; surface: string | null }> = [];
      const chose: Array<{ at: number; from: string | null }> = [];
      let last = "";
      for (let i = 0; i < 900 * 30; i++) {
        const f = engine.update(world, 1 / 30);
        const debug = engine.debug();
        frames.push({ f: { ...f, ...(f.reach ? { reach: { ...f.reach } } : {}) }, surface: debug.surfaceId });
        if (debug.choice !== last) {
          last = debug.choice;
          if (debug.choice === "visit") chose.push({ at: i, from: frames[Math.max(0, i - 1)]!.surface });
        }
      }
      for (const { at, from } of chose) {
        // (one chosen in the last minute is not seen to the end)
        if (at + 60 * 30 > frames.length) continue;
        visits++;
        const label = `seed ${seed} visit at ${at / 30} s`;
        const hit = frames.slice(at, at + 60 * 30).find((e) => e.f.clip === "swat" && e.f.progress >= SWAT_HIT);
        expect(hit, label).toBeDefined();
        const poster = world.targets.find((t) => hit!.f.reach!.x >= t.rect.x && hit!.f.reach!.x <= t.rect.x + t.rect.w && hit!.f.reach!.y >= t.rect.y - 0.2 * L2 && hit!.f.reach!.y <= t.rect.y + t.rect.h);
        expect(poster, label).toBeDefined();
        // (a poster of another shelf than the one it was on, and it is on that shelf, on its feet)
        expect(poster!.surfaceId, label).not.toBe(from);
        expect(hit!.surface, label).toBe(poster!.surfaceId);
        expect(hit!.f.grounded, label).toBe(true);
      }
    }
    expect(visits).toBeGreaterThanOrEqual(5);
  });

  it("has its busy spells and its quiet ones: its energy swings over a few minutes, and not in step with the next cat's", () => {
    const at: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = new CatEngine(seed);
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 700 * 30; i++) {
        engine.update(tvLibrary, 1 / 30);
        if (i === 100 * 30) at.push(engine.mood.energy);
        if (i >= 60 * 30 && i % 30 === 0) {
          lo = Math.min(lo, engine.mood.energy);
          hi = Math.max(hi, engine.mood.energy);
        }
      }
      // (measured: from 0.16 to 0.49, three cycles in it)
      expect(hi - lo, `seed ${seed}`).toBeGreaterThan(0.25);
    }
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(0.15);
  });
});

describe("a character of its own: the ginger cat is restless, curious and friendly, the ragdoll lazy and grumpy", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const world = tvLibrary;
  const kinds = new Map(world.surfaces.map((s) => [s.id, s.kind] as const));

  interface Day {
    seen: number;
    foot: number;
    napped: number;
    /** The seconds of every stay on the foot of the screen, one after the other. */
    stays: number[];
    hops: number;
    walking: number;
    asleep: number;
    running: number;
    energy: number;
    curiosity: number;
    chose: Record<string, number>;
    /** The fastest it walked, in body lengths a second. */
    pace: number;
  }
  /** What a cat of this character does alone on the TV's library for ten minutes, for each of a few seeds (counted in frames, 30 a second). */
  const lived = (temperament: string): Day => {
    const out: Day = { seen: 0, foot: 0, napped: 0, stays: [], hops: 0, walking: 0, asleep: 0, running: 0, energy: 0, curiosity: 0, chose: {}, pace: 0 };
    let frames = 0;
    for (const seed of seeds) {
      const engine = new CatEngine(seed, { temperament });
      let onFoot = 0;
      let wasJumping = false;
      let lastChoice = "";
      for (let i = 0; i < 600 * 30; i++) {
        const f = engine.update(world, 1 / 30);
        const debug = engine.debug();
        frames++;
        out.energy += engine.mood.energy;
        out.curiosity += engine.mood.curiosity;
        if (debug.choice !== lastChoice) {
          lastChoice = debug.choice;
          out.chose[debug.choice] = (out.chose[debug.choice] ?? 0) + 1;
        }
        if (f.clip === "walk") out.pace = Math.max(out.pace, Math.abs(f.vx) / world.bodyLength);
        if (f.appear <= 0.5) continue;
        out.seen++;
        const kind = f.grounded && debug.surfaceId ? kinds.get(debug.surfaceId) : "air";
        if (kind === "fallbackFloor") {
          out.foot++;
          onFoot++;
          if (debug.act === "sleep") out.napped++;
        } else if (kind !== "air" && onFoot > 0) {
          out.stays.push(onFoot / 30);
          onFoot = 0;
        }
        const jumping = debug.act === "jump";
        if (jumping && !wasJumping) out.hops++;
        wasJumping = jumping;
        if (debug.act === "walk" || debug.act === "stalk") out.walking++;
        if (debug.act === "sleep") out.asleep++;
        if (f.clip === "run") out.running++;
      }
      if (onFoot > 0) out.stays.push(onFoot / 30);
    }
    out.energy /= frames;
    out.curiosity /= frames;
    return out;
  };
  const kept = new Map<string, Day>();
  const day = (temperament: string): Day => {
    let one = kept.get(temperament);
    if (!one) kept.set(temperament, (one = lived(temperament)));
    return one;
  };
  /** The share of the time it was in sight that it spent so. */
  const share = (d: Day, pick: (d: Day) => number): number => pick(d) / d.seen;
  /** How many times a minute (in sight) it chose to do any of these things. */
  const perMinute = (d: Day, ...things: string[]): number => (things.reduce((a, b) => a + (d.chose[b] ?? 0), 0) * 60 * 30) / d.seen;

  it("is the cat as it was when its table is the baseline's: neutral numbers, and frame for frame the same cat, made by its name or by its table", () => {
    expect(BASELINE).toMatchObject({ name: "baseline", speed: 1, drowsiness: 1, stay: 1, likes: {}, petPatience: Infinity, wakeGrump: 0, swatsHand: 0, sulk: 0, petJoy: 0 });
    expect(temperamentOf("baseline")).toBe(BASELINE);
    expect(temperamentOf("ginger")).toBe(GINGER);
    expect(temperamentOf("ragdoll")).toBe(RAGDOLL);
    // (a coat that is neither of the two the settings offer is the cat as it was)
    expect(temperamentOf("tuxedo")).toBe(BASELINE);
    for (const seed of [1, 2, 3]) {
      const pictures = (engine: CatEngine) => stepCat(engine, tvLibrary, 60).frames.map((f) => JSON.stringify(f));
      const plain = pictures(new CatEngine(seed));
      expect(pictures(new CatEngine(seed, { temperament: "baseline" })), `seed ${seed}`).toEqual(plain);
      expect(pictures(new CatEngine(seed, { temperament: BASELINE })), `seed ${seed}`).toEqual(plain);
    }
  });

  it("says which cat it is, and is another cat from the moment it is told so: livelier or lazier at once, and not by degrees", () => {
    expect(new CatEngine(1).debug().temperament).toBe("baseline");
    expect(new CatEngine(1, { temperament: "ginger" }).debug().temperament).toBe("ginger");
    const engine = new CatEngine(2, { temperament: "ginger" });
    stepCat(engine, tvLibrary, 30);
    const energy = engine.mood.energy;
    const curiosity = engine.mood.curiosity;
    engine.setTemperament("ragdoll");
    expect(engine.debug().temperament).toBe("ragdoll");
    expect(engine.mood.energy).toBeCloseTo(energy - 0.2, 9);
    expect(engine.mood.curiosity).toBeCloseTo(curiosity - 0.2, 9);
    engine.setTemperament(GINGER);
    expect(engine.mood.energy).toBeCloseTo(energy, 9);
    expect(engine.mood.curiosity).toBeCloseTo(curiosity, 9);
    engine.setTemperament("tuxedo");
    expect(engine.debug().temperament).toBe("baseline");
  });

  it("cares for what it might do as its table says, but not for the leap that gets it up from where it should not stay: that is worth the same to every cat", () => {
    expect(tasteFor(BASELINE, "hop", false)).toBe(1);
    expect(tasteFor(GINGER, "hop", false)).toBe(1.2);
    expect(tasteFor(RAGDOLL, "hop", false)).toBe(0.7);
    expect(tasteFor(RAGDOLL, "sleep", true)).toBe(1.5);
    expect(tasteFor(RAGDOLL, "a thing that is not in the table", false)).toBe(1);
    for (const t of [BASELINE, GINGER, RAGDOLL]) expect(tasteFor(t, "hop", true), t.name).toBe(1);
  });

  it("goes about more if it is the ginger and less if it is the ragdoll: it hops, walks and runs more and sleeps less, or the other way about", () => {
    // (measured over forty cats, fifteen minutes each, on this library, the cat as it was against the ginger against the ragdoll: hops a minute 1.6, 2.4, 0.75; walking 18 % of the time, 23 %, 10 %;
    // asleep 26 %, 17 %, 41 %; running 0.15 %, 0.8 %, none; with the table of the cat's reach made again from the pictures, the ginger walks 1.15 times what the cat as it was does, not 1.28)
    const [plain, ginger, ragdoll] = ["baseline", "ginger", "ragdoll"].map(day) as [Day, Day, Day];
    expect(share(ginger, (d) => d.hops)).toBeGreaterThan(1.25 * share(plain, (d) => d.hops));
    expect(share(ragdoll, (d) => d.hops)).toBeLessThan(0.65 * share(plain, (d) => d.hops));
    expect(share(ginger, (d) => d.walking)).toBeGreaterThan(1.08 * share(plain, (d) => d.walking));
    expect(share(ragdoll, (d) => d.walking)).toBeLessThan(0.7 * share(plain, (d) => d.walking));
    expect(share(ginger, (d) => d.asleep)).toBeLessThan(0.85 * share(plain, (d) => d.asleep));
    expect(share(ragdoll, (d) => d.asleep)).toBeGreaterThan(1.3 * share(plain, (d) => d.asleep));
    expect(share(ginger, (d) => d.running)).toBeGreaterThan(2 * share(plain, (d) => d.running));
  });

  it("looks into more things if it is the ginger and into fewer if it is the ragdoll: a card to look down at, a poster to pat or to go over to", () => {
    // (measured over forty cats: inspect, visit and pat together 0.52 a minute for the cat as it was, 0.76 for the ginger, 0.32 for the ragdoll)
    const curious = (name: string) => perMinute(day(name), "inspect", "visit", "pat");
    expect(curious("ginger")).toBeGreaterThan(1.25 * curious("baseline"));
    expect(curious("ragdoll")).toBeLessThan(0.75 * curious("baseline"));
  });

  it("passes through the foot of the screen whichever cat it is: never asleep on it, hardly any of an afternoon on it, and no stay of half a minute", () => {
    for (const name of ["baseline", "ginger", "ragdoll"]) {
      const d = day(name);
      expect(d.seen, name).toBeGreaterThan(5000);
      expect(d.foot / d.seen, name).toBeLessThan(0.04);
      expect(Math.max(0, ...d.stays), name).toBeLessThan(30);
      expect(d.napped, name).toBe(0);
    }
  });

  it("gets up from the foot of the screen in a quarter of a minute or so whichever cat it is (getting up is not a matter of taste)", () => {
    // (and a cat that cannot abide a hop, as a table by hand may say: it gets up all the same)
    for (const who of ["ginger", "ragdoll", { ...BASELINE, name: "hates a hop", likes: { hop: 0.02 } }]) {
      const name = typeof who === "string" ? who : who.name;
      const times: number[] = [];
      for (let seed = 1; seed <= 20; seed++) {
        const engine = new CatEngine(seed, { temperament: who });
        stepCat(engine, world, 6);
        for (let i = 0; i < 20 * 30 && !engine.debug().act.startsWith("rest"); i++) engine.update(world, 1 / 30);
        engine.send({ type: "cat.call", at: { x: 640, y: 711 } });
        let arrived = -1;
        let left = -1;
        for (let i = 0; i < 120 * 30 && left < 0; i++) {
          const f = engine.update(world, 1 / 30);
          const debug = engine.debug();
          if (arrived < 0) {
            if (debug.surfaceId === "floor" && f.grounded && debug.act !== "walk" && debug.act !== "jump") arrived = i;
          } else if (f.grounded && debug.surfaceId !== "floor" && debug.act !== "fall") left = (i - arrived) / 30;
        }
        times.push(left);
      }
      expect(times.filter((t) => t < 0), name).toEqual([]);
      const sorted = [...times].sort((a, b) => a - b);
      expect(sorted[sorted.length >> 1]!, name).toBeLessThan(16);
      expect(sorted[Math.floor(sorted.length * 0.9)]!, name).toBeLessThan(26);
      expect(sorted[sorted.length - 1]!, name).toBeLessThan(60);
    }
  });

  it("settles in its mood where its character puts it: the ginger livelier and more curious than the cat as it was, the ragdoll less", () => {
    const [plain, ginger, ragdoll] = ["baseline", "ginger", "ragdoll"].map(day) as [Day, Day, Day];
    // (nothing happens to these cats, so their moods are where they settle, and the energy swings round that)
    for (const [d, energy, curiosity] of [[plain, 0.32, 0.28], [ginger, 0.42, 0.4], [ragdoll, 0.22, 0.2]] as const) {
      expect(Math.abs(d.energy - energy), `energy ${d.energy.toFixed(3)} against ${energy}`).toBeLessThan(0.05);
      expect(Math.abs(d.curiosity - curiosity), `curiosity ${d.curiosity.toFixed(3)} against ${curiosity}`).toBeLessThan(0.05);
    }
  });

  it("walks at its own pace: the ginger an eighth faster than the cat as it was, the ragdoll a sixth slower", () => {
    expect(day("ginger").pace / day("baseline").pace).toBeCloseTo(1.12, 1);
    expect(day("ragdoll").pace / day("baseline").pace).toBeCloseTo(0.85, 1);
  });

  it("is not made to go anywhere by its character for a viewer who wants quiet or less motion, whichever cat it is: it stays where it was put", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const still = { ...tvLibrary, [flag]: true };
      for (const name of ["ginger", "ragdoll"]) {
        for (const seed of [1, 2]) {
          const engine = new CatEngine(seed, { temperament: name });
          stepCat(engine, still, 6);
          engine.send({ type: "cat.call", at: { x: 640, y: 711 } });
          stepCat(engine, still, 10);
          const start = engine.debug().surfaceId;
          for (let i = 0; i < 240 * 30; i++) {
            engine.update(still, 1 / 30);
            const debug = engine.debug();
            expect(debug.surfaceId, `${name} ${flag} seed ${seed}`).toBe(start);
            expect(["walk", "run", "jump", "swat"], `${name} ${flag} seed ${seed}`).not.toContain(debug.act);
          }
        }
      }
    }
  });
});

describe("a hand that strokes it, wakes it or dashes at it: the ginger is glad of the hand, the ragdoll has its patience", () => {
  const page = defaultPage();
  const body = browseWorld(page).bodyLength;
  type Hand = { x: number; y: number };

  /** A cat of this character, settled on the simulator's page and at rest (not in the middle of something). */
  const resting = (seed: number, temperament: string | undefined, flags: Partial<PageOptions> = {}) => {
    const options = { ...page, ...flags };
    const world = browseWorld(options);
    const engine = new CatEngine(seed, temperament === undefined ? {} : { temperament });
    stepCat(engine, world, 8);
    for (let i = 0; i < 20 * 30 && !engine.debug().act.startsWith("rest"); i++) engine.update(world, 1 / 30);
    return { engine, options, world };
  };
  /** The hand a little to the side of the middle of the cat, at the height of its back (so that going away from it means something). */
  const handOn = (engine: CatEngine): Hand => ({ x: engine.frame.x + 0.3 * body, y: engine.frame.y - 0.5 * body });
  /**
   * The hand rests on the cat and strokes it as the host's hand does: a stroke a third of a second after it came and one every second after that, for as long as the cat is under it (with
   * `always`, whether it is or not), and an end to it when the cat is not. The hand follows the cat about (`follows`), or does until the cat has had enough of it and stays where it was then
   * (`leaves`), or stays where it was put (`fixed`). The frames the cat gave, the act it was in at each, and where the hand ended up.
   */
  const stroke = (engine: CatEngine, options: PageOptions, seconds: number, mode: "follows" | "leaves" | "fixed" = "follows", always = false) => {
    let hand = handOn(engine);
    let frozen = mode === "fixed";
    const acts: string[] = [];
    const queued: number[] = [];
    let next = 0.32;
    let under = true;
    const { frames } = stepCat(engine, browseWorld(options, { pointer: hand }), seconds, 30, (frame, t) => {
      const debug = engine.debug();
      acts.push(debug.act);
      queued.push(debug.queue.length);
      if (mode === "leaves" && stood(frame, debug.act, debug.queue.length)) frozen = true;
      if (!frozen) hand = { x: frame.x + 0.3 * body, y: frame.y - 0.5 * body };
      const near = always || Math.abs(frame.x - hand.x) < 0.7 * body;
      if (near && t >= next) {
        engine.send({ type: "cat.pet" });
        next += 1;
        under = true;
      } else if (!near && under) {
        engine.send({ type: "cat.petEnd" });
        under = false;
        next = t + 0.32;
      }
      return browseWorld(options, { pointer: hand });
    });
    return { frames, acts, queued, hand };
  };
  /** The cat has stood up to the hand, ears back (it has had enough: it has a plan, of a swipe, a walk and a sit, in front of it). */
  const stood = (f: CatFrame, act: string, queue: number): boolean => f.emote === "annoyed" && act === "rest:stand" && queue > 0;
  /** When (seconds) the cat first showed it was annoyed, when it first stood up to the hand (it has had enough then), and when it first swung a paw; -1 for never. */
  const told = (run: { frames: CatFrame[]; acts: string[]; queued: number[] }) => {
    const when = (pick: (f: CatFrame, act: string, queue: number) => boolean): number => {
      const i = run.frames.findIndex((f, j) => pick(f, run.acts[j]!, run.queued[j]!));
      return i < 0 ? -1 : i / 30;
    };
    return {
      warned: when((f) => f.emote === "annoyed"),
      gone: when(stood),
      swatted: when((f) => f.clip === "swat"),
    };
  };

  it("never tires of a hand if it is the ginger, or the cat as it was: a minute of strokes and not a flick of annoyance, and the ginger is glad of them now and then", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const name of ["baseline", "ginger"]) {
        const { engine, options } = resting(seed, name);
        const { frames } = stroke(engine, options, 60);
        expect(frames.some((f) => f.emote === "annoyed"), `${name} seed ${seed}`).toBe(false);
        const joy = frames.filter((f, i) => f.emote === "joy" && frames[i - 1]?.emote !== "joy").length;
        if (name === "baseline") expect(joy, `seed ${seed}`).toBe(0);
        else {
          // (a stroke in two is glad, and not more than once in three seconds and a half: 8 to 15 in a minute)
          expect(joy, `ginger seed ${seed}`).toBeGreaterThan(4);
          expect(joy, `ginger seed ${seed}`).toBeLessThan(16);
        }
      }
    }
  });

  it("warns the hand when it has had two thirds of its patience and has had enough in five to nine seconds, if it is the ragdoll: the ears go back and the tail flicks, and then it stands up to the hand", () => {
    const gone: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { engine, options } = resting(seed, "ragdoll");
      const t = told(stroke(engine, options, 14));
      // (its patience is seven seconds, from 0.7 to 1.3 of that, and a little less the sleepier it is: 4.7 to 9.1, and it is heard once a second)
      expect(t.warned, `seed ${seed}`).toBeGreaterThan(3.3);
      expect(t.warned, `seed ${seed}`).toBeLessThan(7.1);
      expect(t.gone, `seed ${seed}`).toBeGreaterThan(t.warned);
      expect(t.gone, `seed ${seed}`).toBeGreaterThan(4.9);
      expect(t.gone, `seed ${seed}`).toBeLessThan(10.2);
      gone.push(t.gone);
    }
    // (every hand has a patience of its own: the cats are not all done with it in the same second -- the twenty of them spread over four seconds)
    expect(Math.max(...gone) - Math.min(...gone)).toBeGreaterThanOrEqual(3);
  });

  it("does not purr at the hand it is warning: it is not stroked in the frames it flicks its tail, and is again after", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { engine, options } = resting(seed, "ragdoll");
      const run = stroke(engine, options, 8);
      const { frames } = run;
      const t = told(run);
      const at = Math.round(t.warned * 30);
      expect(frames[at]!.petted, `seed ${seed}`).toBe(false);
      expect(frames[at - 20]!.petted, `seed ${seed}: before`).toBe(true);
    }
  });

  it("swipes at the hand two times in three when it has had enough, with the paw where the hand is, and walks off the other way and sits with its back to it (the ragdoll)", () => {
    let swiped = 0;
    let twice = 0;
    let walked = 0;
    let away = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { engine, options, world } = resting(seed, "ragdoll");
      const ledges = computeLedges(world);
      const surface = engine.debug().surfaceId!;
      const run = stroke(engine, options, 18, "leaves");
      const { frames, acts, hand } = run;
      const t = told(run);
      expect(t.gone, `seed ${seed}`).toBeGreaterThan(0);
      if (t.swatted >= 0) {
        swiped++;
        // (and now and then a second swipe, straight after the first: the swing begins again)
        if (frames.some((f, i) => i > 0 && f.clip === "swat" && frames[i - 1]!.clip === "swat" && f.progress < frames[i - 1]!.progress - 0.5)) twice++;
        const hit = frames.find((f) => f.clip === "swat" && f.progress >= SWAT_HIT)!;
        // (the paw lands in front of the cat, towards the hand, at about the height of the hand and a paw's reach from the cat)
        expect(hit.grounded).toBe(true);
        expect(hit.facing, `seed ${seed}`).toBe(Math.sign(hand.x - hit.x));
        expect((hit.reach!.x - hit.x) * hit.facing, `seed ${seed}`).toBeGreaterThan(0.2 * body);
        expect((hit.reach!.x - hit.x) * hit.facing, `seed ${seed}`).toBeLessThan(1.1 * body);
        expect(Math.abs(hit.reach!.y - (hit.y - 0.45 * body)), `seed ${seed}`).toBeLessThan(0.1 * body);
      }
      // (the walk that follows -- right after the stand and the swipes -- is away from the hand, unless the shelf has no room on that side)
      const from = Math.round(t.gone * 30);
      const first = acts.findIndex((act, i) => i >= from && act === "walk");
      if (first < 0 || first > from + 4 * 30) continue;
      let last = first;
      while (acts[last + 1] === "walk") last++;
      const there = frames[from]!.x;
      const end = frames[last]!.x;
      if (Math.abs(end - there) < 0.8 * body) continue;
      walked++;
      const side = Math.sign(hand.x - there);
      const ledge = ledgeAt(ledges, surface, there)!;
      const room = side > 0 ? there - ledge.x0 : ledge.x1 - there;
      if (room >= 1.6 * body) {
        away++;
        expect(Math.sign(end - there), `seed ${seed}: from ${there.toFixed(0)} to ${end.toFixed(0)}, the hand at ${hand.x.toFixed(0)}`).toBe(-side);
      }
    }
    // (the chance is 0.65: 20 of 30 or so; two swipes in two of five of those)
    expect(swiped).toBeGreaterThan(12);
    expect(swiped).toBeLessThan(27);
    expect(twice).toBeGreaterThan(2);
    expect(twice).toBeLessThan(swiped);
    expect(walked).toBeGreaterThan(20);
    expect(away).toBeGreaterThan(10);
  });

  it("is not left in a swipe with no paw to land when the page has no room for it on the shelf as the swipe ends: the walk away from the hand has nowhere to go, and the frame that ends there is of a cat that sits", () => {
    let reached = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { engine, options, world } = resting(seed, "ragdoll");
      // (a card the size of the screen has the focus: the shelf is still there, and there is no room for a cat on it)
      const full: World = { ...world, keepOut: [...world.keepOut, { x: -100, y: -100, w: world.viewport.w + 200, h: world.viewport.h + 200 }] };
      expect(computeLedges(full), `seed ${seed}`).toEqual([]);
      let hand = handOn(engine);
      let frozen = false;
      let next = 0.32;
      let crowded = false;
      let gap = false;
      const noPaw: string[] = [];
      stepCat(engine, browseWorld(options, { pointer: hand }), 14, 30, (frame, t) => {
        const debug = engine.debug();
        if (frame.clip === "swat" && !frame.reach) noPaw.push(`${t.toFixed(2)}s ${debug.act}`);
        // (the frame in which the walk that was to follow ended the moment it began: no act, and the next one still to come)
        if (crowded && debug.act === "none" && debug.queue.length > 0) gap = true;
        if (!crowded && frame.clip === "swat" && frame.progress > 0.9 && debug.queue[0] === "walk") crowded = true;
        if (crowded) return full;
        if (stood(frame, debug.act, debug.queue.length)) frozen = true;
        if (!frozen) hand = { x: frame.x + 0.3 * body, y: frame.y - 0.5 * body };
        if (!frozen && Math.abs(frame.x - hand.x) < 0.7 * body && t >= next) {
          engine.send({ type: "cat.pet" });
          next += 1;
        }
        return browseWorld(options, { pointer: hand });
      });
      if (gap) reached++;
      expect(noPaw, `seed ${seed}`).toEqual([]);
    }
    // (it swipes in two of three, and walks off after it in most of those)
    expect(reached).toBeGreaterThan(5);
  });

  it("does not hear the hand while it is going: a hand that goes on stroking does not bring it back, nor cut its walk short, and it does not purr", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { engine, options } = resting(seed, "ragdoll");
      const run = stroke(engine, options, 18, "fixed", true);
      const { frames } = run;
      const t = told(run);
      const from = Math.round(t.gone * 30);
      for (let i = from; i < from + 3.8 * 30; i++) expect(frames[i]!.petted, `seed ${seed}: frame ${i - from} after`).toBe(false);
      // (and a few seconds after, the strokes are heard again)
      expect(frames.slice(from + 4.5 * 30).some((f) => f.petted), `seed ${seed}`).toBe(true);
    }
  });

  it("is touchy for forty-five seconds after it has been annoyed by a hand, and lets it be after that: the next hand has lost its patience in a couple of seconds, one that comes a minute on has the whole of it", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { engine, options } = resting(seed, "ragdoll");
      const first = stroke(engine, options, 14, "leaves");
      expect(told(first).gone, `seed ${seed}: the first hand`).toBeGreaterThan(0);
      // (it goes off, sits for a while, and a hand comes to it again, ten seconds after)
      stepCat(engine, browseWorld(options), 10);
      const second = stroke(engine, options, 8);
      const touchy = told(second).gone;
      expect(touchy, `seed ${seed}: the second hand (touchy)`).toBeGreaterThan(0);
      expect(touchy, `seed ${seed}: the second hand (touchy)`).toBeLessThan(4.6);
      // (and it is a minute and more before the third, when it has forgiven the second; awake, and not woken by it)
      stepCat(engine, browseWorld(options), 70);
      engine.send({ type: "cat.command", command: "sit" });
      stepCat(engine, browseWorld(options), 1);
      const third = stroke(engine, options, 12);
      expect(told(third).gone, `seed ${seed}: the third hand (forgiven)`).toBeGreaterThan(4.3);
    }
  });

  it("is as touchy after it fought a hand that held it, if it is the ragdoll: the hand that strokes it a quarter of a minute after it landed has lost its patience in a couple of seconds", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { engine, options, world } = resting(seed, "ragdoll");
      const grip = { x: engine.frame.x, y: engine.frame.y - 0.4 * body };
      engine.send({ type: "cat.grab", at: grip });
      for (let i = 0; i < 5 * 30; i++) {
        engine.send({ type: "cat.carry", at: grip });
        engine.update(world, 1 / 30);
      }
      engine.send({ type: "cat.drop" });
      // (it lands annoyed, does what such a cat does, and sits; awake, and not woken by the hand)
      stepCat(engine, world, 12);
      engine.send({ type: "cat.command", command: "sit" });
      stepCat(engine, world, 1);
      const gone = told(stroke(engine, options, 8)).gone;
      expect(gone, `seed ${seed}`).toBeGreaterThan(0);
      expect(gone, `seed ${seed}`).toBeLessThan(4.6);
    }
  });

  it("starts its patience afresh for a hand that came back after three seconds: strokes of three seconds, over and over, never annoy it", () => {
    for (const seed of [1, 2, 3]) {
      const { engine, options } = resting(seed, "ragdoll");
      let hand = handOn(engine);
      let next = 0.32;
      let strokes = 0;
      const { frames } = stepCat(engine, browseWorld(options, { pointer: hand }), 90, 30, (frame, t) => {
        // (four strokes, 0 to 3 seconds, and nothing for three seconds and a half, over and over)
        const phase = t % 7;
        hand = { x: frame.x + 0.3 * body, y: frame.y - 0.5 * body };
        if (phase < 3.4 && t >= next) {
          engine.send({ type: "cat.pet" });
          strokes++;
          next += 1;
        } else if (phase >= 3.4) next = Math.ceil(t / 7) * 7 + 0.32;
        return browseWorld(options, { pointer: hand });
      });
      expect(strokes, `seed ${seed}`).toBeGreaterThan(40);
      expect(frames.some((f) => f.emote === "annoyed"), `seed ${seed}`).toBe(false);
    }
  });

  it("wakes up cross if it is the ragdoll, about as often as not, and sits up and is stroked if it is the ginger or the cat as it was", () => {
    const wakings = (name: string): { cross: number; sat: number } => {
      let cross = 0;
      let sat = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const { engine, options, world } = resting(seed, name);
        engine.send({ type: "cat.command", command: "sleep" });
        stepCat(engine, world, 5);
        expect(engine.debug().act, `${name} seed ${seed}`).toBe("sleep");
        const run = stroke(engine, options, 2.5);
        if (told(run).gone >= 0) cross++;
        else if (run.frames.some((f) => f.petted)) sat++;
      }
      return { cross, sat };
    };
    const ragdoll = wakings("ragdoll");
    // (0.55 of the time: 16 of 30 or so)
    expect(ragdoll.cross, JSON.stringify(ragdoll)).toBeGreaterThan(9);
    expect(ragdoll.cross, JSON.stringify(ragdoll)).toBeLessThan(24);
    expect(ragdoll.cross + ragdoll.sat).toBe(30);
    for (const name of ["baseline", "ginger"]) expect(wakings(name), name).toEqual({ cross: 0, sat: 30 });
  });

  it("swipes at a pointer that dashes at it a third of the times if it is the ragdoll, and never if it is the ginger: the others freeze, as a cat does that is startled", () => {
    const dashes = (name: string, seeds = 40): { swiped: number; startled: number } => {
      let swiped = 0;
      let startled = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const { engine, options, world } = resting(seed, name);
        const f = engine.frame;
        // (the pointer comes at the cat from the side with the room, at fourteen body lengths a second, and stops a body length off, at the height of its back)
        const side = f.x < world.viewport.w / 2 ? 1 : -1;
        const from = f.x + side * 4 * body;
        const to = f.x + side * body;
        const seconds = Math.abs(to - from) / (14 * body);
        const y = f.y - 0.5 * body;
        let cross = false;
        let fright = false;
        stepCat(engine, world, 4, 30, (frame, t) => {
          if (frame.emote === "annoyed") cross = true;
          if (frame.emote === "startle") fright = true;
          return browseWorld(options, { pointer: { x: from + (to - from) * Math.min(1, t / seconds), y } });
        });
        if (cross) swiped++;
        if (fright && !cross) startled++;
      }
      return { swiped, startled };
    };
    const ragdoll = dashes("ragdoll", 120);
    // (the chance is 0.325, half of what it is for a hand that has been stroking it for too long: 39 of 120 or so, where twice the chance would give 78; the cat that is not swiping is startled)
    expect(ragdoll.swiped, JSON.stringify(ragdoll)).toBeGreaterThan(25);
    expect(ragdoll.swiped, JSON.stringify(ragdoll)).toBeLessThan(55);
    expect(ragdoll.swiped + ragdoll.startled, JSON.stringify(ragdoll)).toBe(120);
    expect(dashes("ginger")).toEqual({ swiped: 0, startled: 40 });
    expect(dashes("baseline")).toEqual({ swiped: 0, startled: 40 });
  });

  it("only shows it is annoyed, for a viewer who wants quiet or less motion: it does not swipe, nor walk off, nor move", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { engine, options } = resting(seed, "ragdoll", { [flag]: true });
        const start = engine.frame.x;
        const { frames, acts } = stroke(engine, options, 40);
        expect(frames.some((f) => f.emote === "annoyed"), `${flag} seed ${seed}`).toBe(true);
        expect(frames.some((f) => f.clip === "swat"), `${flag} seed ${seed}`).toBe(false);
        for (const act of acts) expect(["walk", "run", "jump", "swat", "stalk"], `${flag} seed ${seed}`).not.toContain(act);
        expect(Math.abs(frames[frames.length - 1]!.x - start), `${flag} seed ${seed}`).toBeLessThan(0.05 * body);
      }
    }
  });
});

describe("its little scenes", () => {
  /** A cat on the made-up page, its frames copied (the engine gives the same object every time) with the act each was in. */
  const watch = (seed: number, seconds: number) => {
    const engine = new CatEngine(seed);
    const world = browseWorld(defaultPage());
    const log: Array<{ act: string; f: CatFrame; surface: string | null }> = [];
    for (let i = 0; i < seconds * 30; i++) {
      const f = engine.update(world, 1 / 30);
      log.push({ act: engine.debug().act, f: { ...f, ...(f.look ? { look: { ...f.look } } : {}) }, surface: engine.debug().surfaceId });
    }
    return { world, log };
  };

  it("scratches, kneads, sniffs, and stalks and pounces, over a long afternoon, with its feet on a shelf whenever it stands to one", () => {
    const seconds: Record<string, number> = {};
    for (const seed of [5, 7, 11, 21]) {
      const stats = runSession({ seed, seconds: 900, chaos: { scroll: true, focus: true } });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      for (const [act, s] of Object.entries(stats.acts)) seconds[act] = (seconds[act] ?? 0) + s;
    }
    for (const act of ["shot:scratch", "shot:knead", "shot:sniff", "stalk", "shot:wiggle"]) expect(seconds[act] ?? 0, act).toBeGreaterThan(1);
    const { log } = watch(11, 900);
    for (const { act, f } of log) if (act.startsWith("shot:") && f.appear > 0.5) expect(f.grounded, act).toBe(true);
  });

  it("stalks a poster at a creep, wiggles, springs, lands by it on the same shelf, and sits as if it had meant to", () => {
    let stalked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { world, log } = watch(seed, 600);
      const L = world.bodyLength;
      const start = log.findIndex((e) => e.act === "stalk");
      // (not every cat stalks in ten minutes: it needs a poster the right distance off)
      if (start < 0) continue;
      stalked++;
      const until = (from: number, act: string): number => {
        let i = from;
        while (i < log.length && log[i]!.act === act) i++;
        return i;
      };
      const creepEnd = until(start, "stalk");
      // a creep: slower than a walk (0.95 L/s), all the way, and it looks at what it stalks
      for (let i = start; i < creepEnd; i++) expect(Math.abs(log[i]!.f.vx), `seed ${seed}`).toBeLessThan(0.55 * L);
      const prey = log[start + 1]!.f.look!;
      expect(prey, `seed ${seed}`).toBeDefined();
      // ...then the wiggle, the leap, and the sit
      expect(log[creepEnd]!.act, `seed ${seed}`).toBe("shot:wiggle");
      const wiggled = until(creepEnd, "shot:wiggle");
      expect(log[wiggled]!.act, `seed ${seed}`).toBe("jump");
      const leapt = until(wiggled, "jump");
      expect(log[leapt]!.act, `seed ${seed}`).toBe("rest:sit");
      // it lands on the shelf it left, close to the poster
      const landed = log[leapt]!;
      expect(landed.surface, `seed ${seed}`).toBe(log[start]!.surface);
      expect(landed.f.y, `seed ${seed}`).toBeCloseTo(log[start]!.f.y, 0);
      expect(Math.abs(landed.f.x - prey.x), `seed ${seed}`).toBeLessThan(0.6 * L);
      // (the leap was across the poster's way, not a hop on the spot)
      expect(Math.abs(landed.f.x - log[wiggled]!.f.x), `seed ${seed}`).toBeGreaterThan(1 * L);
    }
    expect(stalked).toBeGreaterThanOrEqual(5);
  });

  it("is not busy with them when the viewer wants quiet or less motion: no scratching, stalking, sniffing", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const stats = runSession({ seed: 7, seconds: 900, chaos: { scroll: true }, ...(flag === "quiet" ? { quiet: true } : { reducedMotion: true }) });
      for (const act of ["shot:scratch", "stalk", "shot:wiggle", "shot:sniff"]) expect(stats.acts[act] ?? 0, `${flag} ${act}`).toBe(0);
    }
  });
});

describe("settling clear of the names", () => {
  /** How much of the names, on average (in body-lengths squared), the cat's body hid while it rested (sat, lay, slept) over a few afternoons on a page with names hanging over its shelves, and how many frames it rested in all. */
  const afternoons = (told: boolean): { hidden: number; resting: number } => {
    let area = 0;
    let resting = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const page = defaultPage();
      page.rows = 2;
      page.names = true;
      const world = browseWorld(page);
      const { soft, ...blind } = world;
      const engine = new CatEngine(seed);
      for (let i = 0; i < 300 * 30; i++) {
        const f = engine.update(told ? world : blind, 1 / 30);
        const act = engine.debug().act;
        const pose: RestPose | null = act === "rest:sit" ? "sit" : act === "rest:loaf" ? "loaf" : act === "rest:stand" ? "stand" : act === "sleep" ? "curl" : null;
        if (!pose || f.appear < 0.99 || !f.grounded) continue;
        resting++;
        area += shapeCovers(pose, f.facing, f.x, f.y, world.bodyLength, soft!) / world.bodyLength ** 2;
      }
    }
    return { hidden: area / resting, resting };
  };

  it("rests in the gaps between them, where a cat that has not been told about them rests in front of them", () => {
    const told = afternoons(true);
    const blind = afternoons(false);
    expect(blind.resting).toBeGreaterThan(2000);
    expect(told.resting).toBeGreaterThan(2000);
    // (a shelf's names are tight and a lying cat is as long as it is: the best place a loaf can find on this page still hides 0.16 of a body-square of them, a sitting cat 0.05, a curled one 0.05, a standing one 0.01;
    // told, the cat hides about a third of what it hides by chance: measured 0.06 against 0.20; with the table of its reach made again from the pictures, where a sitting cat's tail is 1.37 body lengths behind it and not 1.11, 0.095 against 0.34)
    expect(blind.hidden).toBeGreaterThan(0.15);
    expect(told.hidden).toBeLessThan(0.11);
    expect(told.hidden).toBeLessThan(blind.hidden / 2.5);
  });

  /**
   * A page whose rows are not all alike: the names of the rows 0 and 2 run edge to edge (a title that fills its card, whatever the language: no gap for a cat to sit in),
   * the names of the others are short.
   */
  const unevenWorld = (): World => {
    const page = defaultPage();
    page.rows = 4;
    const world = browseWorld(page);
    const L2 = world.bodyLength;
    const soft: Rect[] = [];
    for (const target of world.targets) {
      const surface = world.surfaces.find((s) => s.id === target.surfaceId)!;
      const row = Number(/row(\d+)/.exec(surface.id)![1]);
      soft.push({ x: target.rect.x, y: surface.y - 0.55 * L2, w: row % 2 === 0 ? target.rect.w + 24 : 0.25 * target.rect.w, h: 0.4 * L2 });
    }
    return { ...world, soft };
  };

  /** What share of a cat's resting time, over a few afternoons on `world`, its body hid more than a tenth of a body-square of the names, and where it rested. */
  const hiding = (world: World, seeds = [1, 2, 3, 4, 5, 6, 7, 8], seconds = 400): { share: number; resting: number; on: Record<string, number> } => {
    let resting = 0;
    let hid = 0;
    const on: Record<string, number> = {};
    for (const seed of seeds) {
      const engine = new CatEngine(seed);
      for (let i = 0; i < seconds * 30; i++) {
        const f = engine.update(world, 1 / 30);
        const debug = engine.debug();
        const pose: RestPose | null = debug.act === "rest:sit" ? "sit" : debug.act === "rest:loaf" ? "loaf" : debug.act === "rest:stand" ? "stand" : debug.act === "sleep" ? "curl" : null;
        if (!pose || f.appear < 0.99 || !f.grounded) continue;
        resting++;
        on[debug.surfaceId ?? "-"] = (on[debug.surfaceId ?? "-"] ?? 0) + 1;
        if (shapeCovers(pose, f.facing, f.x, f.y, world.bodyLength, world.soft!) / world.bodyLength ** 2 > 0.1) hid++;
      }
    }
    return { share: hid / resting, resting, on };
  };

  it("leaves a shelf whose names run edge to edge for one that has room, to settle for a while", () => {
    const seen = hiding(unevenWorld());
    expect(seen.resting).toBeGreaterThan(20000);
    // (measured: 0.24 of its resting time on this page hid names when it knew only the shelf it was on; 0.04 knowing the others. A cat that goes about -- see "going about" -- has more of the shelves
    // in its day: 0.074 with the cat before it, 0.056 now; 0.094 if its leaps did not mind the names where they land, 0.11 if it did not leave a shelf of names, 0.13 if it did not cut short a stop in front of one)
    // (0.145 with the table of its reach made again from the pictures: a sitting cat's tail is 1.37 body lengths behind it, not the 1.11 the table had, and a third of its sits on this page hide a name; a loaf or a standing cat one in ten, a curled one none)
    expect(seen.share).toBeLessThan(0.16);
    // (it is on the crowded shelf now and then, on its way and for the pauses of a stroll, but not to rest on)
    expect(seen.on["p1:row0"] ?? 0).toBeLessThan(0.1 * seen.resting);
    expect(seen.on["p1:row1"] ?? 0).toBeGreaterThan(0.3 * seen.resting);
  });

  it("on the TV's own library page, as the cat read it, it does not rest in front of a name: not where it settles and not where it lands from a hop", () => {
    // (the floor of the screen is the place with the names: the rows are clear of them. A cat does not stay on the floor of a page that has rows -- see "gets up from the foot of the screen" -- so
    // the floor is looked at twice: on the page as it is, where it is a place it passes through, and on the page with only its floor, where it is the cat's whole world)
    const floorOnly: World = { ...tvLibrary, surfaces: tvLibrary.surfaces.filter((s) => s.kind === "fallbackFloor"), targets: [] };
    for (const [world, least, most] of [[tvLibrary, 100, 0.3], [floorOnly, 8000, 0.12]] as const) {
      let floor = 0;
      let hid = 0;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]) {
        const engine = new CatEngine(seed);
        for (let i = 0; i < 600 * 30; i++) {
          const f = engine.update(world, 1 / 30);
          const debug = engine.debug();
          const pose: RestPose | null = debug.act === "rest:sit" ? "sit" : debug.act === "rest:loaf" ? "loaf" : debug.act === "rest:stand" ? "stand" : debug.act === "sleep" ? "curl" : null;
          if (!pose || debug.surfaceId !== "floor" || f.appear < 0.99 || !f.grounded) continue;
          floor++;
          if (shapeCovers(pose, f.facing, f.x, f.y, world.bodyLength, world.soft!) / world.bodyLength ** 2 > 0.1) hid++;
        }
      }
      expect(floor, `${world.surfaces.length} places`).toBeGreaterThan(least);
      // (measured: 0.83 of its resting on the floor hid more than a tenth of a body-square of names while it knew nothing of them, and 0.064 knowing them, nearly all of it the first seat or loaf where it
      // appears and the seat after a sniff; the cat before this one had 0.095 while the landing of a hop was left to chance, and 0.028 since)
      // (and with the table of its reach made again from the pictures: on the page as it is, 31 of 138 frames of resting on the floor hid a name, all of them standing, and the cat is on the floor for a quarter of what it was, 568 frames, for the table says it takes more room; with only the floor, 0.106, a third of its sits and a sixth of its standing)
      expect(hid / floor, `${world.surfaces.length} places`).toBeLessThan(most);
    }
  });

  it("does not leave its shelf for the sake of names when the viewer wants quiet or less motion, but settles where it is", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const world = { ...unevenWorld(), [flag]: true };
      const engine = new CatEngine(3);
      let moving = 0;
      for (let i = 0; i < 300 * 30; i++) {
        engine.update(world, 1 / 30);
        if (["walk", "run", "jump"].includes(engine.debug().act)) moving++;
      }
      expect(moving, flag).toBe(0);
    }
  });

  it("keeps to everything it must keep to on such a page, through the same bad afternoons", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos: { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true }, names: true });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      expect(stats.maxAppear).toBeGreaterThan(0.9);
    }
  });

  it("does not walk to find a place when the viewer wants quiet or less motion", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const stats = runSession({ seed: 4, seconds: 600, names: true, ...(flag === "quiet" ? { quiet: true } : { reducedMotion: true }) });
      expect(stats.violations, flag).toEqual([]);
      expect(stats.acts["walk"] ?? 0, flag).toBe(0);
    }
  });
});

describe("picked up by a hand", () => {
  const settled = (seed = 4, flags: Partial<ReturnType<typeof defaultPage>> = {}, temperament?: string) => {
    const page = { ...defaultPage(), ...flags };
    const engine = new CatEngine(seed, temperament === undefined ? {} : { temperament });
    const world = browseWorld(page);
    stepCat(engine, world, 8);
    return { engine, world, page, body: world.bodyLength };
  };
  const copy = (f: CatFrame): CatFrame => ({ ...f });
  /** The hand goes from `from` to `to` in `seconds`, saying where it is at every frame, as the page does; the frames the cat gave. */
  const carryTo = (engine: CatEngine, world: World, from: { x: number; y: number }, to: { x: number; y: number }, seconds: number): CatFrame[] => {
    const frames: CatFrame[] = [];
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 1; i <= n; i++) {
      engine.send({ type: "cat.carry", at: { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n } });
      frames.push(copy(engine.update(world, 1 / 30)));
    }
    return frames;
  };
  /** The hand takes the cat by the middle of its body, carries it to the hand place `at` and lets it hang there (so that its feet are where the hang puts them). */
  const lift = (engine: CatEngine, world: World, at: { x: number; y: number }): CatFrame => {
    const f = engine.frame;
    const grip = { x: f.x, y: f.y - 0.4 * world.bodyLength };
    engine.send({ type: "cat.grab", at: grip });
    engine.update(world, 1 / 30);
    carryTo(engine, world, grip, at, 1);
    return carryTo(engine, world, at, at, 1).pop()!;
  };
  const shelves = (world: World) => computeLedges(world).filter((l) => l.kind === "shelfTop").sort((a, b) => a.y - b.y);
  /** The hand lets go, and the frames the cat gives for `seconds` after, each with the act it was in (and what `between` says the page is then, as `stepCat` has it). */
  const letGoAndWatch = (engine: CatEngine, world: World, seconds: number, between?: (frame: CatFrame, t: number) => World | void): { frames: CatFrame[]; acts: string[] } => {
    const acts: string[] = [];
    engine.send({ type: "cat.drop" });
    const { frames } = stepCat(engine, world, seconds, 30, (frame, t) => {
      acts.push(engine.debug().act);
      return between?.(frame, t);
    });
    return { frames, acts };
  };
  /** The frames of the first climb among `frames`: the run of them with the climb clip. */
  const climbOf = (frames: CatFrame[]): { before: CatFrame[]; climb: CatFrame[] } => {
    const start = frames.findIndex((f) => f.clip === "climb");
    if (start < 0) return { before: frames, climb: [] };
    let end = start;
    while (frames[end + 1]?.clip === "climb") end++;
    return { before: frames.slice(0, start), climb: frames.slice(start, end + 1) };
  };

  it("takes the cat up where it stands, and it hangs from the hand by the scruff, a little behind it, following it", () => {
    const { engine, world, body } = settled();
    const start = copy(engine.frame);
    const grip = { x: start.x, y: start.y - 0.4 * body };
    engine.send({ type: "cat.grab", at: grip });
    const first = copy(engine.update(world, 1 / 30));
    expect(first.carried).toBe(true);
    expect(first.grounded).toBe(false);
    expect(engine.debug().act).toBe("carried");
    // (it is where it was when the hand took it: it does not jump to the hand)
    expect(Math.hypot(first.x - start.x, first.y - start.y)).toBeLessThan(0.05 * body);
    // the hand takes it towards the middle of the screen, a long way, and holds it there
    const goal = { x: start.x + (start.x < 900 ? 400 : -400), y: grip.y - 120 };
    const moving = carryTo(engine, world, grip, goal, 1);
    for (const f of moving) {
      expect(f.carried).toBe(true);
      expect(Math.hypot(f.vx, f.vy)).toBeLessThanOrEqual(16.01 * body);
    }
    const hanging = carryTo(engine, world, goal, goal, 1).pop()!;
    expect(hanging.x).toBeCloseTo(goal.x + 0.1 * body * hanging.facing, 0);
    expect(hanging.y).toBeCloseTo(goal.y + 0.73 * body, 0);
    expect(hanging.clip).toBe("stand");
    expect(hanging.viewer).toBe(true);
  });

  it("does not sink below where it stood as the hang forms: a hand that only lifts a little lifts the cat with it, and a hand that goes down takes it down", () => {
    const { engine, world, body } = settled(4);
    const start = copy(engine.frame);
    const grip = { x: start.x, y: start.y - 0.4 * body };
    engine.send({ type: "cat.grab", at: grip });
    // the hand holds still for a moment: the hang forms under it (0.73 of a body below the hand; the cat was 0.4 below it), and the cat stays where it is
    const resting = carryTo(engine, world, grip, grip, 1);
    for (const f of resting) expect(f.y, "no sinking").toBeLessThanOrEqual(start.y + 0.5);
    // the hand lifts it: the cat never goes down while the hand goes up, and is the hang below it once it is clear of where it stood
    const lifted = carryTo(engine, world, grip, { x: grip.x, y: grip.y - 1.5 * body }, 1.2);
    lifted.reduce((before, f) => {
      expect(f.y).toBeLessThanOrEqual(before + 0.01);
      return f.y;
    }, resting[resting.length - 1]!.y);
    const high = carryTo(engine, world, { x: grip.x, y: grip.y - 1.5 * body }, { x: grip.x, y: grip.y - 1.5 * body }, 1).pop()!;
    expect(high.y).toBeCloseTo(grip.y - 1.5 * body + 0.73 * body, 0);
    // a hand that goes down takes it down (the cat does not stay where it was taken from)
    const lower = carryTo(engine, world, { x: grip.x, y: grip.y - 1.5 * body }, { x: grip.x, y: grip.y + 1.2 * body }, 1.5);
    const last = lower.pop()!;
    expect(last.y).toBeGreaterThan(start.y + 0.5 * body);
  });

  it("has the whole hang once the hand has carried it a body and a half, level or down: it is not held up by the middle all the way to a lower shelf (a hand that has gone only a little way has not sunk it)", () => {
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const { engine, world, body } = settled(4);
      const start = copy(engine.frame);
      const grip = { x: start.x, y: start.y - 0.4 * body };
      engine.send({ type: "cat.grab", at: grip });
      const sign = grip.x < 900 ? 1 : -1;
      // (a third of a body along: it is where it stood, or a third of a body further down with the hand: the hang that forms does not sink it)
      const near = { x: grip.x + 0.3 * body * sign * dir.x, y: grip.y + 0.3 * body * dir.y };
      const little = carryTo(engine, world, grip, near, 1);
      for (const f of little) expect(f.y, `no sinking (${dir.x},${dir.y})`).toBeLessThanOrEqual(Math.max(start.y, near.y + 0.4 * body) + 0.5);
      // (and a long way along it is the full hang below the hand)
      const far = { x: grip.x + 4 * body * sign * dir.x, y: grip.y + 4 * body * dir.y };
      carryTo(engine, world, near, far, 2);
      const there = carryTo(engine, world, far, far, 1).pop()!;
      expect(there.y, `the hang below the hand (${dir.x},${dir.y})`).toBeCloseTo(far.y + 0.73 * body, 0);
    }
  });

  it("is not whisked along by a hand that flicks: it follows as fast as it can, and is a little behind", () => {
    const { engine, world, body } = settled();
    const f0 = copy(engine.frame);
    const grip = { x: f0.x, y: f0.y - 0.4 * body };
    engine.send({ type: "cat.grab", at: grip });
    const held = copy(engine.update(world, 1 / 30));
    const far = { x: grip.x + (grip.x < 900 ? 700 : -700), y: grip.y };
    engine.send({ type: "cat.carry", at: far });
    const next = copy(engine.update(world, 1 / 30));
    expect(Math.abs(next.x - held.x)).toBeLessThanOrEqual((16 * body) / 30 + 1e-6);
    expect(Math.abs(next.x - held.x)).toBeGreaterThan(0.3 * body);
    const there = carryTo(engine, world, far, far, 1.5).pop()!;
    expect(Math.abs(there.x - (far.x + 0.1 * body * there.facing))).toBeLessThan(2);
  });

  it("puts the cat down on the first shelf under it, steering across to it, and never through it", () => {
    const { engine, world, body } = settled(2);
    const [, second] = shelves(world);
    expect(second).toBeDefined();
    const x = (second!.x0 + second!.x1) / 2;
    // the feet a body length and a third over the shelf; the first shelf above is more than the cat can spring up to, and past what it can reach (see CLIMB_UP), the floor is further down
    const hung = lift(engine, world, { x: x + 0.8 * body, y: second!.y - 1.35 * body - 0.73 * body });
    expect(hung.carried).toBe(true);
    expect(engine.landing()).toEqual({ x: expect.closeTo(hung.x, 3), y: second!.y });
    engine.send({ type: "cat.drop" });
    const frames = stepCat(engine, world, 3).frames;
    expect(frames[0]!.carried).toBe(false);
    let landedAt = -1;
    frames.forEach((f, i) => {
      expect(f.y, `frame ${i}`).toBeLessThanOrEqual(second!.y + 0.5);
      expect(Math.hypot(f.vx, f.vy), `frame ${i}`).toBeLessThanOrEqual(14.01 * body);
      if (landedAt < 0 && f.grounded) landedAt = i;
    });
    expect(landedAt).toBeGreaterThan(0);
    // (about the time a fall of a body length and a third takes: sqrt(2 * 1.35 / 24) = 0.34 s)
    expect(landedAt / 30).toBeLessThan(1);
    const last = frames[frames.length - 1]!;
    expect(last.grounded).toBe(true);
    expect(last.y).toBe(second!.y);
    expect(last.x).toBeGreaterThanOrEqual(second!.x0 - 1);
    expect(last.x).toBeLessThanOrEqual(second!.x1 + 1);
    expect(engine.debug().surfaceId).toBe(second!.surfaceId);
    expect(engine.landing()).toBeNull();
  });

  it("puts a cat that a hand only brushed back where it was", () => {
    const { engine, world, body } = settled(9);
    const before = copy(engine.frame);
    const surface = engine.debug().surfaceId;
    engine.send({ type: "cat.grab", at: { x: before.x, y: before.y - 0.4 * body } });
    stepCat(engine, world, 0.1);
    engine.send({ type: "cat.drop" });
    const after = stepCat(engine, world, 2).frames.pop()!;
    expect(engine.debug().surfaceId).toBe(surface);
    expect(after.grounded).toBe(true);
    expect(after.y).toBe(before.y);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.3 * body);
  });

  it("springs up onto a shelf that its paws hang a little below, over its edge and down again", () => {
    const { engine, world, body } = settled(3);
    const [first] = shelves(world);
    expect(first).toBeDefined();
    const x = (first!.x0 + first!.x1) / 2;
    // the feet a third of a body under the line of the shelf
    const hung = lift(engine, world, { x, y: first!.y + 0.3 * body - 0.73 * body });
    expect(engine.landing()).toEqual({ x: expect.closeTo(hung.x, 3), y: first!.y });
    engine.send({ type: "cat.drop" });
    const frames = stepCat(engine, world, 3).frames;
    expect(Math.min(...frames.map((f) => f.vy))).toBeLessThan(0);
    expect(Math.min(...frames.map((f) => f.y))).toBeGreaterThan(first!.y - 0.5 * body);
    expect(Math.max(...frames.map((f) => f.y))).toBeLessThanOrEqual(first!.y + 0.3 * body + 1);
    const last = frames[frames.length - 1]!;
    expect(last.grounded).toBe(true);
    expect(last.y).toBe(first!.y);
    expect(engine.debug().surfaceId).toBe(first!.surfaceId);
  });

  describe("reaching for the edge of a shelf it was let go of near", () => {
    it("takes hold of the edge of a shelf that is further above its paws than it can spring, and hauls itself up onto it, held at the point it ends up standing at", () => {
      const { engine, world, body } = settled(3);
      const [first] = shelves(world);
      const x = (first!.x0 + first!.x1) / 2;
      // the feet a body length and a fifth under the line of the shelf: past what it can spring up to (0.6), and within what it can reach
      const hung = lift(engine, world, { x, y: first!.y + 1.2 * body - 0.73 * body });
      const where = engine.landing()!;
      expect(where.y).toBe(first!.y);
      // (it ends up standing a stride on from where its paws are, facing along the shelf: its paws are at the edge, behind the middle of its body)
      const dir = Math.sign(where.x - hung.x);
      expect(Math.abs(where.x - hung.x)).toBeCloseTo(CLIMB_BACK * body, 3);
      const { frames, acts } = letGoAndWatch(engine, world, 3);
      const { before, climb } = climbOf(frames);
      // it falls the little way to where its paws are at the edge, in the air, as the jump's picture has it, and is there within a moment
      expect(before.length).toBeGreaterThan(2);
      expect(before.length / 30).toBeLessThan(0.6);
      for (const f of before) {
        expect(f.clip).toBe("jump");
        expect(f.grounded).toBe(false);
        expect(f.y).toBeGreaterThanOrEqual(hung.y - 1);
        expect(f.y).toBeLessThanOrEqual(first!.y + CLIMB_HANG * body + 1);
      }
      expect(acts[before.length]).toBe("climb");
      // the climb: as long as the art is, its frame the point it ends up standing at all the way (the picture goes from hanging below it to standing on it), facing along the shelf
      expect(climb.length).toBeGreaterThanOrEqual(Math.round(CLIMB_TIME * 30));
      expect(climb.length).toBeLessThanOrEqual(Math.round(CLIMB_TIME * 30) + 3);
      for (const f of climb) {
        expect(f.x).toBeCloseTo(where.x, 3);
        expect(f.y).toBe(first!.y);
        expect(f.facing).toBe(dir);
        expect(f.carried).toBe(false);
        expect(f.vx).toBe(0);
        expect(f.vy).toBe(0);
      }
      // (off its feet until it is up, and its progress goes from nothing to one, and never back)
      for (const f of climb.slice(0, -1)) expect(f.grounded).toBe(false);
      expect(climb[0]!.progress).toBe(0);
      climb.reduce((before, f) => {
        expect(f.progress).toBeGreaterThanOrEqual(before);
        expect(f.progress - before).toBeLessThan(0.04);
        return f.progress;
      }, 0);
      expect(climb[climb.length - 1]!.progress).toBe(1);
      expect(climb[climb.length - 1]!.grounded).toBe(true);
      // then it is on the shelf, and goes on as a cat does that has come up onto a place
      expect(engine.debug().surfaceId).toBe(first!.surfaceId);
      const after = frames.slice(before.length + climb.length);
      expect(after.length).toBeGreaterThan(0);
      for (const f of after) {
        expect(f.grounded).toBe(true);
        expect(f.y).toBe(first!.y);
      }
    });

    it("turns in the air to face along the shelf and hauls itself up from beside its end, whichever way it faced, and takes hold only where there is room for the lip", () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        for (const end of ["left", "right"] as const) {
          const { engine, world, body } = settled(seed);
          const [first] = shelves(world);
          const x = end === "left" ? first!.x0 + 0.15 * body : first!.x1 - 0.15 * body;
          lift(engine, world, { x, y: first!.y + 1.2 * body - 0.73 * body });
          const where = engine.landing();
          expect(where, `${seed} ${end}`).not.toBeNull();
          const { frames } = letGoAndWatch(engine, world, 3);
          const { climb } = climbOf(frames);
          expect(climb.length, `${seed} ${end}`).toBeGreaterThan(30);
          // (it faces the inside of the shelf, so that the edge it holds is behind it and on the shelf: never the way out of the end)
          const facing = end === "left" ? 1 : -1;
          for (const f of climb) expect(f.facing, `${seed} ${end}`).toBe(facing);
          const lip = climb[0]!.x - facing * CLIMB_LIP * body;
          expect(lip, `${seed} ${end}`).toBeGreaterThanOrEqual(first!.x0 - CLIMB_LIP * body - 1);
          expect(lip, `${seed} ${end}`).toBeLessThanOrEqual(first!.x1 + CLIMB_LIP * body + 1);
          expect(climb[0]!.x, `${seed} ${end}`).toBeGreaterThanOrEqual(first!.x0 - 1);
          expect(climb[0]!.x, `${seed} ${end}`).toBeLessThanOrEqual(first!.x1 + 1);
        }
      }
    });

    it("falls as it always did when the edge is further above its paws than it can reach, or something is where its paws would hang", () => {
      // (two body lengths and a fifth under the first shelf: more than a stretched cat reaches)
      {
        const { engine, world, body } = settled(3);
        const [first, second] = shelves(world);
        lift(engine, world, { x: (first!.x0 + first!.x1) / 2, y: first!.y + 2.2 * body - 0.73 * body });
        expect(engine.landing()?.y).toBe(second!.y);
        const { frames } = letGoAndWatch(engine, world, 3);
        expect(frames.some((f) => f.clip === "climb")).toBe(false);
        expect(engine.debug().surfaceId).toBe(second!.surfaceId);
      }
      // (a zone across the place its paws would hang at, a hand's breadth under the edge: the card that has the focus, a menu)
      {
        const { engine, world, body } = settled(3);
        const [first, second] = shelves(world);
        const blocked: World = { ...world, keepOut: [...world.keepOut, { x: 0, y: first!.y + 0.4 * body, w: world.viewport.w, h: 0.8 * body }] };
        lift(engine, blocked, { x: (first!.x0 + first!.x1) / 2, y: first!.y + 1.2 * body - 0.73 * body });
        expect(engine.landing()?.y).toBe(second!.y);
        const { frames } = letGoAndWatch(engine, blocked, 3);
        expect(frames.some((f) => f.clip === "climb")).toBe(false);
        expect(engine.debug().surfaceId).toBe(second!.surfaceId);
      }
    });

    it("lets the edge go and comes down on what is under it when the page takes it away as it reaches", () => {
      const { engine, world, page, body } = settled(3);
      const [first] = shelves(world);
      lift(engine, world, { x: (first!.x0 + first!.x1) / 2, y: first!.y + 1.2 * body - 0.73 * body });
      expect(engine.landing()?.y).toBe(first!.y);
      // (the page is scrolled up by two screens' worth of shelf in the frame after: the first shelf is gone off the top, and the third is where the second was)
      const scrolled = browseWorld({ ...page, scroll: 700 });
      const { frames } = letGoAndWatch(engine, world, 4, (_frame, t) => (t > 0.02 ? scrolled : undefined));
      expect(frames.some((f) => f.clip === "climb")).toBe(false);
      const last = frames[frames.length - 1]!;
      expect(last.grounded).toBe(true);
      const ledges = computeLedges(scrolled);
      expect(ledges.some((l) => l.surfaceId === engine.debug().surfaceId && Math.abs(l.y - last.y) < 1.5)).toBe(true);
    });

    it("is busy while it hangs from the edge: a hand, a stroke, a call or a command does not take it from it, and a menu that opens takes it away at once", () => {
      const { engine, world, body } = settled(3);
      const [first] = shelves(world);
      lift(engine, world, { x: (first!.x0 + first!.x1) / 2, y: first!.y + 1.2 * body - 0.73 * body });
      const { frames } = letGoAndWatch(engine, world, 0.6);
      const mid = frames[frames.length - 1]!;
      expect(mid.clip).toBe("climb");
      engine.send({ type: "cat.grab", at: { x: mid.x, y: mid.y - 0.4 * body } });
      engine.send({ type: "cat.pet" });
      engine.send({ type: "cat.call", at: { x: 300, y: 300 } });
      engine.send({ type: "cat.command", command: "sleep" });
      const busy = stepCat(engine, world, 0.4).frames;
      for (const f of busy) {
        expect(f.clip).toBe("climb");
        expect(f.carried).toBe(false);
        expect(f.x).toBeCloseTo(mid.x, 3);
        expect(f.y).toBe(mid.y);
      }
      // (the menu: it is gone from the page at once, the shelf and all, and is not left hanging in the air)
      const away: World = { ...world, mode: "away" };
      const gone = stepCat(engine, away, 1.5).frames;
      expect(gone[0]!.clip).not.toBe("climb");
      expect(gone[gone.length - 1]!.appear).toBeLessThan(0.05);
    });
  });

  it("comes down on a place it may stand when it is let go over words, buttons or the edge of the screen, never in them", () => {
    for (const [hx, hy] of [[600, 300], [60, 500], [1900, 200], [1000, 90], [700, 1070], [960, 560]] as const) {
      const { engine, world } = settled(5);
      lift(engine, world, { x: hx, y: hy });
      engine.send({ type: "cat.drop" });
      const last = stepCat(engine, world, 6).frames.pop()!;
      const ledges = computeLedges(world);
      expect(last.grounded, `${hx},${hy}`).toBe(true);
      expect(last.appear, `${hx},${hy}`).toBeGreaterThan(0.9);
      expect(ledges.some((l) => l.surfaceId === engine.debug().surfaceId && Math.abs(l.y - last.y) < 1.5 && last.x >= l.x0 - 1 && last.x <= l.x1 + 1), `${hx},${hy}`).toBe(true);
      for (const zone of world.keepOut) expect(shapeHits(last.clip, last.facing, last.x, last.y, world.bodyLength, zone), `${hx},${hy}`).toBe(false);
    }
  });

  it("washes after it lands, as if it had meant to, most of the time, and sits a moment first", () => {
    let washed = 0;
    const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const { engine, world, body } = settled(seed);
      lift(engine, world, { x: 900, y: 500 - 0.73 * body });
      engine.send({ type: "cat.drop" });
      const acts: string[] = [];
      for (let i = 0; i < 8 * 30; i++) {
        engine.update(world, 1 / 30);
        const act = engine.debug().act;
        if (acts[acts.length - 1] !== act) acts.push(act);
      }
      const fell = acts.indexOf("fall");
      expect(fell, `seed ${seed}: ${acts.join(">")}`).toBeGreaterThanOrEqual(0);
      expect(acts[fell + 1], `seed ${seed}`).toBe("rest:sit");
      if (acts[fell + 2] === "shot:groom") washed++;
    }
    expect(washed).toBeGreaterThan(seeds.length * 0.5);
    expect(washed).toBeLessThan(seeds.length);
  });

  it("is not picked up when the viewer wants quiet or less motion, or while a menu has sent it away, and is still stroked", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const { engine, world, body } = settled(6, { [flag]: true });
      engine.send({ type: "cat.grab", at: { x: engine.frame.x, y: engine.frame.y - 0.4 * body } });
      engine.send({ type: "cat.carry", at: { x: 800, y: 300 } });
      const frames = stepCat(engine, world, 1).frames;
      expect(frames.every((f) => !f.carried && f.grounded), flag).toBe(true);
      expect(Math.abs(frames[frames.length - 1]!.x - frames[0]!.x), flag).toBeLessThan(1);
    }
    // (and the same in a film: a quiet cat there is stroked and not lifted)
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const film = playerWorld(1920, 1080, "playing", false, { [flag]: true });
      const inFilm = new CatEngine(6);
      stepCat(inFilm, film, 8);
      inFilm.send({ type: "cat.grab", at: { x: inFilm.frame.x, y: inFilm.frame.y - 40 } });
      expect(stepCat(inFilm, film, 1).frames.some((f) => f.carried), `${flag} in a film`).toBe(false);
    }
    const { engine, page } = settled(6);
    stepCat(engine, browseWorld(page, { modal: true }), 3);
    engine.send({ type: "cat.grab", at: { x: 500, y: 500 } });
    expect(stepCat(engine, browseWorld(page, { modal: true }), 1).frames.some((f) => f.carried)).toBe(false);
  });

  it("is busy in a hand: it is not stroked, called, told or shown a poster, but it can be sent away", () => {
    const { engine, world, body } = settled(8);
    const grip = { x: engine.frame.x, y: engine.frame.y - 0.4 * body };
    engine.send({ type: "cat.grab", at: grip });
    engine.update(world, 1 / 30);
    engine.send({ type: "cat.pet" });
    engine.send({ type: "cat.call", at: { x: 300, y: 300 } });
    engine.send({ type: "cat.command", command: "sit" });
    engine.send({ type: "cat.point", targetId: world.targets[0]!.id });
    const frames = carryTo(engine, world, grip, grip, 0.5);
    expect(frames.every((f) => f.carried && !f.petted && f.clip === "stand")).toBe(true);
    expect(engine.debug().queue).toEqual([]);
    engine.send({ type: "cat.command", command: "away" });
    const gone = stepCat(engine, world, 1).frames;
    expect(gone[0]!.carried).toBe(false);
    expect(gone[gone.length - 1]!.appear).toBe(0);
  });

  it("lets go of a hand that has said nothing for a while (a pointer that was lost), and of one that goes with the page away or into a film", () => {
    const { engine, world, body } = settled(7);
    engine.send({ type: "cat.grab", at: { x: engine.frame.x, y: engine.frame.y - 0.4 * body } });
    const frames = stepCat(engine, world, 6).frames;
    const held = frames.filter((f) => f.carried).length;
    expect(held / 30).toBeGreaterThan(2.3);
    expect(held / 30).toBeLessThan(2.8);
    expect(frames[frames.length - 1]!.grounded).toBe(true);
    // (a menu opens: the cat is gone at once, hand or no hand, and is back when it shuts)
    const other = settled(7);
    other.engine.send({ type: "cat.grab", at: { x: other.engine.frame.x, y: other.engine.frame.y - 0.4 * body } });
    other.engine.update(other.world, 1 / 30);
    expect(other.engine.frame.carried).toBe(true);
    const away = stepCat(other.engine, browseWorld(other.page, { modal: true }), 2).frames;
    expect(away.some((f) => f.carried)).toBe(false);
    expect(away[away.length - 1]!.appear).toBe(0);
    other.engine.send({ type: "cat.carry", at: { x: 500, y: 500 } });
    const back = stepCat(other.engine, browseWorld(other.page), 5).frames;
    expect(back.some((f) => f.carried)).toBe(false);
    expect(back[back.length - 1]!.appear).toBe(1);
  });

  it("falls to the place under it when the shelf it was aimed at is gone, and does not fall for ever", () => {
    const { engine, world, body } = settled(2);
    const [, second] = shelves(world);
    const x = (second!.x0 + second!.x1) / 2;
    lift(engine, world, { x, y: second!.y - 3 * body - 0.73 * body });
    engine.send({ type: "cat.drop" });
    stepCat(engine, world, 0.15);
    // the page changes under it: that row is gone
    const page = defaultPage();
    page.rows = 1;
    const frames = stepCat(engine, browseWorld(page), 8).frames;
    const last = frames[frames.length - 1]!;
    expect(last.grounded).toBe(true);
    expect(last.appear).toBeGreaterThan(0.9);
    expect(Number.isFinite(last.y)).toBe(true);
  });

  it("is steered so as to arrive over its place as it lands, however far across the hand let go of it: nothing is put right in the last frame", () => {
    // (the first version closed a part of what was left every frame and snapped the rest at the touchdown: up to a third of a body's length, seen by the soak at 60 fps)
    for (const [hx, hy] of [[600, 300], [60, 500], [1900, 200], [960, 560], [1250, 700]] as const) {
      const { engine, world, body } = settled(5);
      lift(engine, world, { x: hx, y: hy });
      engine.send({ type: "cat.drop" });
      const frames = stepCat(engine, world, 6, 60).frames;
      const down = frames.findIndex((f) => f.grounded);
      expect(down, `${hx},${hy}`).toBeGreaterThan(2);
      const last = Math.abs(frames[down]!.x - frames[down - 1]!.x);
      const before = Math.abs(frames[down - 1]!.x - frames[down - 2]!.x);
      expect(last, `${hx},${hy}: ${last.toFixed(1)} px at the touchdown, ${before.toFixed(1)} before it`).toBeLessThan(Math.max(2 * before, 0.01 * body) + 0.5);
    }
  });

  it("is gone, and back at home, when the window is made smaller under it in the air and leaves it off the screen: it is not carried across the page in view", () => {
    const { engine, world, body } = settled(2);
    const [, second] = shelves(world);
    lift(engine, world, { x: 1500, y: second!.y - 3 * body - 0.73 * body });
    engine.send({ type: "cat.drop" });
    stepCat(engine, world, 0.1);
    expect(engine.frame.x).toBeGreaterThan(1450);
    // (the window is made narrower: the shelf it was falling to is still there, 190 px from the cat, which is itself now outside the screen)
    const small: World = { ...world, viewport: { ...world.viewport, w: 1300 } };
    expect(computeLedges(small).some((ledge) => ledge.surfaceId === second!.surfaceId)).toBe(true);
    const acts: string[] = [];
    const frames = stepCat(engine, small, 8, 60, () => {
      acts.push(engine.debug().act);
    }).frames;
    // (it fades out where it is, and nothing but that is seen off the new edge for more than a moment: a third of a second of steering back would be seen)
    expect(acts).toContain("fade:out");
    expect(frames.filter((f, i) => f.appear > 0.05 && acts[i] !== "fade:out" && f.x > 1300 + 0.55 * small.bodyLength).length).toBeLessThanOrEqual(1);
    const end = frames[frames.length - 1]!;
    expect(end.appear).toBeGreaterThan(0.9);
    expect(end.grounded).toBe(true);
    expect(end.x).toBeLessThanOrEqual(1300);
  });

  it("is led in, not set on the edge in a frame, when the window is made smaller under a cat in a hand and leaves part of it on the screen (the soak found 64 px at once)", () => {
    const { engine, world, body } = settled(4);
    lift(engine, world, { x: 1500, y: 300 });
    expect(engine.frame.x).toBeGreaterThan(1450);
    // (the edge is 60 px from the middle of the cat, which is more than half a body from a cat's middle to its tail's end on the screen)
    const edge = engine.frame.x - 60;
    const small: World = { ...world, viewport: { ...world.viewport, w: edge } };
    let before = engine.frame.x;
    const frames = stepCat(engine, small, 1.5, 30).frames;
    frames.forEach((f, i) => {
      expect(f.carried, `frame ${i}`).toBe(true);
      expect(Math.abs(f.x - before), `frame ${i}`).toBeLessThanOrEqual((16 * body) / 30 + 1);
      before = f.x;
    });
    // (it is brought in over a few frames, not none and not a second)
    const inside = frames.findIndex((f) => f.x <= edge);
    expect(inside).toBeGreaterThan(1);
    expect(inside).toBeLessThan(15);
    expect(frames.slice(inside).every((f) => f.x <= edge)).toBe(true);
  });

  it("is put back on the screen in the frame the window is made smaller when none of the cat in a hand is left on it: nobody sees that", () => {
    const { engine, world } = settled(4);
    lift(engine, world, { x: 1500, y: 300 });
    const small: World = { ...world, viewport: { ...world.viewport, w: 900 } };
    const frames = stepCat(engine, small, 0.5, 30).frames;
    expect(frames[0]!.carried).toBe(true);
    expect(frames[0]!.x).toBeLessThanOrEqual(900);
  });

  it("is deterministic: the same events give the same cat", () => {
    const go = (seed: number) => {
      const { engine, world, body } = settled(seed);
      lift(engine, world, { x: 1200, y: 520 - 0.73 * body });
      engine.send({ type: "cat.drop" });
      return stepCat(engine, world, 5).frames.map((f) => `${f.x.toFixed(2)},${f.y.toFixed(2)},${f.clip}`);
    };
    expect(go(12)).toEqual(go(12));
  });

  it("goes through bad afternoons of hands, pages that change and menus that open, with nothing wrong", () => {
    const chaos = { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true, hand: true };
    let held = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      held += stats.acts["carried"] ?? 0;
    }
    expect(held).toBeGreaterThan(30);
    const calm = runSession({ seed: 3, seconds: 900, chaos: { hand: true, scroll: true, focus: true } });
    expect(calm.violations).toEqual([]);
    expect(calm.acts["fall"] ?? 0).toBeGreaterThan(1);
  });

  it("goes through the afternoons that once found it out (the soak's seeds): a stalk cut by the edge of the screen after a window was made smaller, a fall left off the screen, a snap at the touchdown", () => {
    const chaos = { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true, hand: true };
    const once: Array<{ seed: number; seconds: number; fps?: number; names?: boolean; slide?: boolean }> = [
      { seed: 581, seconds: 900, fps: 20 },
      { seed: 196, seconds: 600 },
      { seed: 283, seconds: 900, names: true },
      { seed: 294, seconds: 900, fps: 60 },
      { seed: 386, seconds: 600, fps: 60 },
      { seed: 62, seconds: 600, fps: 60 },
      { seed: 153, seconds: 600, fps: 60 },
      { seed: 313, seconds: 600 },
      { seed: 335, seconds: 600, fps: 60 },
      // (rows slid sideways in steps carry the cat for a few frames after each step: that is the row's movement, and the soak's check has to know it)
      { seed: 264, seconds: 600, fps: 60, slide: true },
      // (a window made smaller under a walk to a place that is off the screen now: the cat strolled back in, cut by the edge of the screen for 2.0 s)
      { seed: 257, seconds: 600, names: true, slide: true },
      // (a page that was changed under a cat: the shelf it stood on is gone, and the new page has one a little way off, which is where it is set, in a frame: 80 px at 60 frames)
      { seed: 76, seconds: 600, fps: 60, slide: true },
    ];
    for (const { slide, ...run } of once) expect(runSession({ ...run, chaos: slide ? { ...chaos, slide } : chaos }).violations, JSON.stringify({ ...run, slide })).toEqual([]);
  });

  describe("fighting the hand that holds it, and landing annoyed", () => {
    /** The hand takes the cat where it stands and holds still for `seconds`: the frames (30 a second). */
    const heldStill = (seed: number, seconds: number, temperament?: string) => {
      const { engine, world, body } = settled(seed, {}, temperament);
      const f = engine.frame;
      const grip = { x: f.x, y: f.y - 0.4 * body };
      engine.send({ type: "cat.grab", at: grip });
      return { engine, world, body, grip, frames: carryTo(engine, world, grip, grip, seconds) };
    };
    /** The hand holds still until the cat fights at least this hard, and says what the frame was then (it never goes on for more than half a minute). */
    const heldUntil = (seed: number, level: number, temperament?: string) => {
      const { engine, world, body } = settled(seed, {}, temperament);
      const f = engine.frame;
      const grip = { x: f.x, y: f.y - 0.4 * body };
      engine.send({ type: "cat.grab", at: grip });
      for (let i = 0; i < 30 * 30; i++) {
        engine.send({ type: "cat.carry", at: grip });
        const frame = copy(engine.update(world, 1 / 30));
        if ((frame.struggle ?? 0) >= level) return { engine, world, body, grip, frame };
      }
      throw new Error(`seed ${seed}: it never fought as hard as ${level}`);
    };
    const levels = (frames: CatFrame[]): number[] => frames.map((f) => f.struggle ?? 0);
    /** Lets go, and the frames, with the act each was in, for `seconds`. */
    const letGoFor = (engine: CatEngine, world: World, seconds: number) => {
      engine.send({ type: "cat.drop" });
      const acts: string[] = [];
      const { frames } = stepCat(engine, world, seconds, 30, () => {
        acts.push(engine.debug().act);
      });
      return { frames, acts };
    };
    /** What it did once it had come down: the feelings it showed (in order, once each) from the first frame on its feet, and whether it washed. */
    const afterwards = (frames: CatFrame[], acts: string[]) => {
      const down = frames.findIndex((f, i) => f.grounded && f.clip !== "jump" && i > 0 && frames[i - 1]!.vy === 0 && f.vy === 0);
      const feelings: string[] = [];
      let washed = false;
      let walked = false;
      for (let i = Math.max(0, down); i < frames.length; i++) {
        const feeling = frames[i]!.emote ?? "none";
        if (feeling !== "none" && feelings[feelings.length - 1] !== feeling) feelings.push(feeling);
        if (acts[i] === "shot:groom") washed = true;
        if (acts[i] === "walk") walked = true;
      }
      return { feelings, washed, walked };
    };

    it("hangs calm for a couple of seconds, and then begins to fight: 0 at first, never more than 1, and it is a number on every frame", () => {
      for (const seed of [4, 7, 12]) {
        const { frames } = heldStill(seed, 12);
        const s = levels(frames);
        expect(Math.max(...s.slice(0, 45)), `seed ${seed}: the first second and a half`).toBeLessThan(0.02);
        const begins = s.findIndex((v) => v > 0.1) / 30;
        expect(begins, `seed ${seed}: it begins`).toBeGreaterThan(1.5);
        expect(begins, `seed ${seed}: it begins`).toBeLessThan(3.6);
        expect(Math.max(...s), `seed ${seed}`).toBeGreaterThan(0.6);
        for (const f of frames) {
          expect(typeof f.struggle).toBe("number");
          expect(f.struggle!).toBeGreaterThanOrEqual(0);
          expect(f.struggle!).toBeLessThanOrEqual(1);
        }
      }
    });

    it("fights in bouts: it builds up, keeps it up for a few seconds, goes limp, and tries again, a little less hard each time", () => {
      for (const seed of [4, 9]) {
        const s = levels(heldStill(seed, 30).frames);
        // (the bouts: a stretch above half, with a valley below a fifth between one and the next)
        const peaks: number[] = [];
        const valleys: number[] = [];
        let inBout = false;
        let top = 0;
        for (const v of s) {
          if (!inBout && v > 0.45) {
            inBout = true;
            top = v;
          } else if (inBout) {
            top = Math.max(top, v);
            if (v < 0.2) {
              inBout = false;
              peaks.push(top);
              valleys.push(v);
            }
          }
        }
        expect(peaks.length, `seed ${seed}: bouts`).toBeGreaterThanOrEqual(3);
        for (const p of peaks) expect(p).toBeLessThanOrEqual(0.85 + 1e-9);
        expect(peaks[0]!, `seed ${seed}: the first is the hardest, nearly`).toBeGreaterThan(0.7);
        expect(peaks[2]!, `seed ${seed}: the third is less than the first`).toBeLessThan(peaks[0]!);
        // (limp: not gone, the cat is still in the hand)
        for (const v of valleys) expect(v).toBeGreaterThan(0.04);
      }
    });

    it("goes on trying for as long as the hand holds it, a minute and more: it is not tired out for good, and the number is always between 0 and 1", () => {
      const s = levels(heldStill(5, 60).frames);
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      // (it goes on trying, the whole minute: it is not tired out for good)
      expect(Math.max(...s.slice(30 * 45))).toBeGreaterThan(0.4);
    });

    it("is gone half a second after the hand lets go: it comes down fighting a little, on the way, and not after", () => {
      for (const seed of [4, 9, 12]) {
        const { engine, world, frame } = heldUntil(seed, 0.6);
        const { frames } = letGoFor(engine, world, 2);
        const s = levels(frames);
        expect(frames[0]!.carried).toBe(false);
        expect(s[0]!, `seed ${seed}: the first frame after the hand has let go`).toBeGreaterThan(0.3);
        expect(s[0]!).toBeLessThan(frame.struggle!);
        s.reduce((before, v, i) => {
          expect(v, `seed ${seed}: frame ${i}`).toBeLessThanOrEqual(before + 1e-9);
          return v;
        }, 1);
        expect(s[Math.ceil(0.55 * 30)], `seed ${seed}: half a second on`).toBe(0);
      }
    });

    it("does not fight a hand that only brushed it, nor when no hand has it: 0 on every frame", () => {
      const { engine, world } = settled(6);
      for (const f of stepCat(engine, world, 20).frames) expect(f.struggle ?? 0).toBe(0);
      const brushed = settled(3);
      const f = brushed.engine.frame;
      brushed.engine.send({ type: "cat.grab", at: { x: f.x, y: f.y - 0.4 * brushed.body } });
      const held = stepCat(brushed.engine, brushed.world, 0.8).frames;
      brushed.engine.send({ type: "cat.drop" });
      const after = stepCat(brushed.engine, brushed.world, 6).frames;
      for (const g of [...held, ...after]) expect(g.struggle ?? 0).toBeLessThan(0.02);
    });

    it("lands annoyed if it was fighting when the hand let go (it shows it: ears back, a fright, a shake), and lands as it always did if it was not", () => {
      for (const seed of [2, 4, 6, 9, 11, 13]) {
        const fought = heldUntil(seed, 0.6);
        const out = letGoFor(fought.engine, fought.world, 7);
        const did = afterwards(out.frames, out.acts);
        expect(did.feelings.length, `seed ${seed}: annoyed (${did.feelings.join(", ")})`).toBeGreaterThan(0);
        expect(did.feelings.every((feeling) => ["annoyed", "startle", "shake"].includes(feeling)), `seed ${seed}: ${did.feelings.join(", ")}`).toBe(true);
        const calm = settled(seed);
        const g = calm.engine.frame;
        calm.engine.send({ type: "cat.grab", at: { x: g.x, y: g.y - 0.4 * calm.body } });
        carryTo(calm.engine, calm.world, { x: g.x, y: g.y - 0.4 * calm.body }, { x: g.x, y: g.y - 0.4 * calm.body }, 0.8);
        const easy = letGoFor(calm.engine, calm.world, 7);
        const quiet = afterwards(easy.frames, easy.acts);
        expect(quiet.feelings, `seed ${seed}: a cat that did not fight`).toEqual([]);
      }
    });

    it("lands one of four ways, as its temperament weighs them: the tail flick and the walk away, a wash, a fright and a bolt, or a shake", () => {
      const kinds: Record<string, number> = { huff: 0, groom: 0, startle: 0, shake: 0 };
      for (let seed = 1; seed <= 60; seed++) {
        const fought = heldUntil(seed, 0.5);
        const out = letGoFor(fought.engine, fought.world, 8);
        const did = afterwards(out.frames, out.acts);
        const kind = did.feelings.includes("shake") ? "shake" : did.feelings.includes("startle") ? "startle" : did.washed ? "groom" : "huff";
        expect(did.feelings.length, `seed ${seed}`).toBeGreaterThan(0);
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
      for (const kind of ["huff", "groom", "startle", "shake"]) expect(kinds[kind], `${kind} (${JSON.stringify(kinds)})`).toBeGreaterThan(0);
      // (the walk away is the likeliest, then the wash)
      expect(kinds.huff!).toBeGreaterThan(kinds.startle!);
      expect(kinds.groom!).toBeGreaterThan(kinds.startle!);
    });

    it("walks off away from the hand when it is annoyed enough to (the way the hand is not: it turns its back)", () => {
      let walks = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const fought = heldUntil(seed, 0.5);
        // the hand flicks a long way to the side it was on and lets go at once: the cat is left far from it
        const side = fought.grip.x < 900 ? 1 : -1;
        const gone = { x: fought.grip.x + side * 6 * fought.body, y: fought.grip.y };
        carryTo(fought.engine, fought.world, fought.grip, gone, 0.1);
        const out = letGoFor(fought.engine, fought.world, 9);
        const down = out.frames.findIndex((f, i) => f.grounded && i > 0 && f.vy === 0 && out.frames[i - 1]!.vy === 0);
        const did = afterwards(out.frames, out.acts);
        if (!did.walked || did.washed || did.feelings.includes("startle") || did.feelings.includes("shake")) continue;
        // (the first walk after it came down: from where it landed to where it stopped, and the one the huff makes, within a few seconds of the landing: a lively cat that has sat and calmed down walks where it likes)
        const first = out.acts.findIndex((act, i) => i > down && act === "walk");
        if (first < 0 || first > down + 3 * 30) continue;
        let last = first;
        while (out.acts[last + 1] === "walk") last++;
        const there = out.frames[down]!.x;
        const end = out.frames[last]!.x;
        // (a walk away, at least a body length, the other way from the hand, unless the shelf has run out)
        if (Math.abs(end - there) < 0.8 * fought.body) continue;
        walks++;
        expect(Math.sign(end - there), `seed ${seed}: from ${there.toFixed(0)} to ${end.toFixed(0)}, the hand at ${gone.x.toFixed(0)}`).toBe(-side);
      }
      expect(walks).toBeGreaterThan(3);
    });

    it("gives the same fight for the same seed, whatever else the cat is doing meanwhile (the fight has a generator of its own)", () => {
      const a = levels(heldStill(8, 14).frames);
      const b = levels(heldStill(8, 14).frames);
      expect(b).toEqual(a);
      // (and a cat that was never held wanders as it did: the generator the fight draws from is not the one the cat's day does)
      const idle = new CatEngine(8);
      const world = browseWorld(defaultPage());
      const days = stepCat(idle, world, 120).frames.map((f) => `${f.clip}@${Math.round(f.x)}`);
      const again = new CatEngine(8);
      expect(stepCat(again, world, 120).frames.map((f) => `${f.clip}@${Math.round(f.x)}`)).toEqual(days);
    });

    describe("each cat in its own way: the ginger forgives a hand, the ragdoll fights it at once, hard and for long", () => {
      const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
      /** For each seed, when the cat begins to fight a hand that holds still (seconds), how hard it gets, and how long its first bout stays above half of that (seconds). */
      const fights = (temperament: string) =>
        seeds.map((seed) => {
          const s = levels(heldStill(seed, 25, temperament).frames);
          const top = Math.max(...s);
          const start = s.findIndex((v) => v > 0.5 * top);
          let end = start;
          while (end + 1 < s.length && s[end + 1]! > 0.5 * top) end++;
          return { begins: s.findIndex((v) => v > 0.1) / 30, top, bout: (end - start + 1) / 30 };
        });
      const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
      /** How a cat that fought at least this hard lands, in forty holds: the way the temperament weighs the four. */
      const landings = (temperament: string, level: number): Record<string, number> => {
        const kinds: Record<string, number> = { huff: 0, groom: 0, startle: 0, shake: 0 };
        for (let seed = 1; seed <= 40; seed++) {
          const fought = heldUntil(seed, level, temperament);
          const out = letGoFor(fought.engine, fought.world, 8);
          const did = afterwards(out.frames, out.acts);
          const kind = did.feelings.includes("shake") ? "shake" : did.feelings.includes("startle") ? "startle" : did.washed ? "groom" : "huff";
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
        return kinds;
      };

      it("begins to fight within a second and a half of being picked up if it is the ragdoll, in two to three and a half if it is the cat as it was, and not before three if it is the ginger", () => {
        // (measured over forty holds: the ragdoll 1.07 to 1.40 s, the cat as it was 2.2 to 3.2, the ginger 3.5 to 5.0)
        expect(Math.max(...fights("ragdoll").map((f) => f.begins))).toBeLessThan(1.6);
        for (const f of fights("baseline")) {
          expect(f.begins).toBeGreaterThan(1.9);
          expect(f.begins).toBeLessThan(3.6);
        }
        expect(Math.min(...fights("ginger").map((f) => f.begins))).toBeGreaterThan(3.2);
      });

      it("fights as hard as it is: the ragdoll with nearly all it has, the ginger with half of it", () => {
        // (measured: the ragdoll 0.87 to 0.96 at the most, the cat as it was 0.74 to 0.82, the ginger 0.48 to 0.53)
        for (const f of fights("ragdoll")) expect(f.top).toBeGreaterThan(0.85);
        for (const f of fights("ginger")) expect(f.top).toBeLessThan(0.58);
        for (const f of fights("baseline")) {
          expect(f.top).toBeGreaterThan(0.7);
          expect(f.top).toBeLessThan(0.86);
        }
      });

      it("keeps a bout up for longer if it is the ragdoll (five seconds, against three and a half, against less than three for the ginger)", () => {
        const [ragdoll, plain, ginger] = ["ragdoll", "baseline", "ginger"].map((name) => mean(fights(name).map((f) => f.bout)));
        expect(ragdoll!).toBeGreaterThan(4.5);
        expect(ginger!).toBeLessThan(3.3);
        expect(plain!).toBeGreaterThan(ginger!);
        expect(plain!).toBeLessThan(ragdoll!);
      });

      it("is put down annoyed after two and a half seconds in a hand if it is the ragdoll, and never if it is the ginger, which has not begun to fight yet", () => {
        const annoyedAfter = (temperament: string): number => {
          let annoyed = 0;
          for (const seed of seeds) {
            const held = heldStill(seed, 2.5, temperament);
            const out = letGoFor(held.engine, held.world, 7);
            if (afterwards(out.frames, out.acts).feelings.some((feeling) => ["annoyed", "startle", "shake"].includes(feeling))) annoyed++;
          }
          return annoyed;
        };
        expect(annoyedAfter("ragdoll")).toBe(seeds.length);
        expect(annoyedAfter("ginger")).toBe(0);
      });

      it("lands as its temperament weighs it: the ragdoll mostly walks off with its tail lashing, the ginger washes or shakes itself and hardly ever huffs", () => {
        // (measured over forty holds each: the ragdoll 27 huffs, 5 washes, 3 frights, 5 shakes; the ginger 2, 22, 3, 13)
        const ragdoll = landings("ragdoll", 0.5);
        const ginger = landings("ginger", 0.4);
        expect(ragdoll.huff!, JSON.stringify(ragdoll)).toBeGreaterThan(18);
        expect(ginger.huff!, JSON.stringify(ginger)).toBeLessThan(8);
        expect(ginger.groom! + ginger.shake!, JSON.stringify(ginger)).toBeGreaterThan(28);
      });
    });
  });
});

describe("hauling itself up a low step", () => {
  /** Two shelves, one a step (`rise` body lengths) above the other, both wide: the cat's own business to go between them. */
  const stairs = (rise: number): World => {
    const body = browseWorld(defaultPage()).bodyLength;
    return {
      viewport: { x: 0, y: 0, w: 1920, h: 1080 },
      bodyLength: body,
      surfaces: [
        { id: "low", kind: "shelfTop", y: 800, x0: 300, x1: 1500, weight: 1 },
        { id: "high", kind: "shelfTop", y: 800 - rise * body, x0: 300, x1: 1500, weight: 1 },
      ],
      keepOut: [],
      targets: [],
      mode: "browse",
      player: "none",
      controlsUp: false,
      quiet: false,
      reducedMotion: false,
    };
  };
  /** Ten minutes of a cat on `world`: its frames, and for each the shelf it was leaping to, if it was. */
  const afternoon = (seed: number, world: World, seconds = 600) => {
    const engine = new CatEngine(seed);
    const leaping: Array<string | null> = [];
    const { frames } = stepCat(engine, world, seconds, 30, () => {
      const dbg = engine.debug();
      // (a cat that has the zoomies runs and leaps at everything, as it always did: that is not a step it is climbing)
      leaping.push(dbg.act === "jump" && dbg.choice !== "zoomies" ? dbg.jumpTo : null);
    });
    return { frames, leaping };
  };
  /** How many leaps up to the upper shelf begin in `leaping`. */
  const leapsUp = (leaping: Array<string | null>): number => leaping.filter((to, i) => to === "high" && leaping[i - 1] !== "high").length;

  it("goes up a step about as high as its hang by walking to the place under the lip, taking hold of it and hauling itself up: not by a leap", () => {
    const world = stairs(1.4);
    const body = world.bodyLength;
    let climbs = 0;
    for (const seed of [1, 3, 4]) {
      const { frames, leaping } = afternoon(seed, world);
      expect(leapsUp(leaping), `seed ${seed}: leaps up`).toBe(0);
      frames.forEach((f, i) => {
        if (f.clip !== "climb" || frames[i - 1]?.clip === "climb") return;
        climbs++;
        const where = `seed ${seed}, frame ${i}`;
        // it was on its feet on the lower shelf, under the lip (its middle `CLIMB_BACK` behind the place it stands at on top), when it began
        const was = frames[i - 1]!;
        expect(was.grounded, where).toBe(true);
        expect(was.y, where).toBe(800);
        expect(Math.abs(was.x - (f.x - f.facing * CLIMB_BACK * body)), where).toBeLessThanOrEqual(0.6 * body);
        // it is held at the point it ends up at, on the upper shelf, with its feet on the line of it, and ends there on its feet
        let end = i;
        while (frames[end + 1]?.clip === "climb") end++;
        expect(end - i + 1, where).toBeGreaterThanOrEqual(Math.round(CLIMB_TIME * 30));
        for (const g of frames.slice(i, end + 1)) {
          expect(g.x, where).toBe(f.x);
          expect(g.y, where).toBe(800 - 1.4 * body);
          expect(g.facing, where).toBe(f.facing);
        }
        expect(frames[end]!.grounded, where).toBe(true);
        expect(frames[end]!.progress, where).toBe(1);
        expect(frames[end + 1]?.y ?? frames[end]!.y, where).toBe(800 - 1.4 * body);
      });
    }
    expect(climbs).toBeGreaterThanOrEqual(3);
  });

  it("leaps at a step that is lower or higher than that, as it always did", () => {
    let leaps = 0;
    for (const rise of [0.9, 2.2]) {
      const world = stairs(rise);
      for (const seed of [1, 3, 4]) {
        const { frames, leaping } = afternoon(seed, world);
        expect(frames.some((f) => f.clip === "climb"), `rise ${rise}, seed ${seed}`).toBe(false);
        leaps += leapsUp(leaping);
      }
    }
    expect(leaps).toBeGreaterThan(0);
  });

  it("leaps at it when it is called there, in a hurry", () => {
    const world = stairs(1.4);
    let called = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const engine = new CatEngine(seed);
      stepCat(engine, world, 8);
      if (engine.debug().surfaceId !== "low") continue;
      called++;
      engine.send({ type: "cat.call", at: { x: 900, y: 800 - 1.4 * world.bodyLength } });
      const { frames } = stepCat(engine, world, 6);
      expect(frames.some((f) => f.clip === "climb"), `seed ${seed}`).toBe(false);
      expect(engine.debug().surfaceId, `seed ${seed}`).toBe("high");
    }
    expect(called).toBeGreaterThan(0);
  });

  it("hauls itself up a step too in the afternoons of a page that is scrolled, resized and changed, with nothing wrong, and not in a film", () => {
    const chaos = { scroll: true, focus: true, resize: true, route: true, hand: true, mouse: true };
    let climbed = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      climbed += stats.acts["climb"] ?? 0;
    }
    expect(climbed).toBeGreaterThan(10);
    const films = runSession({ seed: 3, seconds: 300, chaos: { film: true, hand: true } });
    expect(films.violations).toEqual([]);
  });
});

describe("going up the face of a card, its back to the viewer (where the painter can draw that)", () => {
  /** Two wide shelves, one `rise` body lengths above the other, and a painter that can draw the cat from behind (or one that says it cannot, or, with null, says nothing). */
  const stairs = (rise: number, rearView: boolean | null = true): World => {
    const body = browseWorld(defaultPage()).bodyLength;
    return {
      viewport: { x: 0, y: 0, w: 1920, h: 1080 },
      bodyLength: body,
      surfaces: [
        { id: "low", kind: "shelfTop", y: 800, x0: 300, x1: 1500, weight: 1 },
        { id: "high", kind: "shelfTop", y: 800 - rise * body, x0: 300, x1: 1500, weight: 1 },
      ],
      keepOut: [],
      targets: [],
      mode: "browse",
      player: "none",
      controlsUp: false,
      quiet: false,
      reducedMotion: false,
      ...(rearView === null ? {} : { rearView }),
    };
  };
  /** `seconds` of a cat on `world`: its frames, and for each the shelf it stood on and the shelf it was leaping to, if it was. */
  const afternoon = (seed: number, world: World, seconds = 600) => {
    const engine = new CatEngine(seed);
    const on: Array<string | null> = [];
    const leaping: Array<string | null> = [];
    const { frames } = stepCat(engine, world, seconds, 30, () => {
      const dbg = engine.debug();
      on.push(dbg.surfaceId);
      leaping.push(dbg.act === "jump" ? dbg.jumpTo : null);
    });
    return { frames, on, leaping };
  };
  const leapsUp = (leaping: Array<string | null>): number => leaping.filter((to, i) => to === "high" && leaping[i - 1] !== "high").length;
  /** The runs of frames in which the cat goes up the face of the card: the first and the last frame of each. */
  const scales = (frames: CatFrame[]): Array<[number, number]> => {
    const runs: Array<[number, number]> = [];
    frames.forEach((f, i) => {
      if (f.clip !== "scale" || frames[i - 1]?.clip === "scale") return;
      let end = i;
      while (frames[end + 1]?.clip === "scale") end++;
      runs.push([i, end]);
    });
    return runs;
  };

  it("goes up a step too high for a hang by the face of the card now and then (and leaps up it the other times), hauling itself over the lip at the top; never without the painter, and the cat is as it was", () => {
    let up = 0;
    let leaps = 0;
    for (const seed of [1, 3, 4]) {
      const { frames, leaping } = afternoon(seed, stairs(2.5));
      for (const [, end] of scales(frames)) {
        // (on a page that keeps still, every way up the face ends in the climb over the lip)
        expect(frames[end + 1]?.clip, `seed ${seed}, frame ${end + 1}`).toBe("climb");
        up++;
      }
      leaps += leapsUp(leaping);
    }
    expect(up).toBeGreaterThanOrEqual(3);
    expect(leaps).toBeGreaterThanOrEqual(1);
    // without the painter, or with one that says it cannot: no scale, the leap up as it always was, and the same cat frame for frame either way
    let before = 0;
    for (const seed of [1, 3]) {
      const without = afternoon(seed, stairs(2.5, null), 300);
      expect(without.frames.some((f) => f.clip === "scale"), `seed ${seed}`).toBe(false);
      before += leapsUp(without.leaping);
      expect(afternoon(seed, stairs(2.5, false), 300).frames, `seed ${seed}`).toEqual(without.frames);
    }
    expect(before).toBeGreaterThan(0);
  });

  it("goes up a step too high to leap at only by the face of the card, and never without the painter", () => {
    let up = 0;
    for (const seed of [1, 3, 4]) {
      const { frames, on, leaping } = afternoon(seed, stairs(4.3));
      expect(leapsUp(leaping), `seed ${seed}`).toBe(0);
      up += scales(frames).length;
      // (it may come in on the upper shelf, and leap down from it; it does not get back up)
      const without = afternoon(seed, stairs(4.3, false));
      expect(without.frames.some((f) => f.clip === "scale"), `seed ${seed}`).toBe(false);
      expect(without.on.some((id, i) => id === "high" && without.on[i - 1] === "low"), `seed ${seed}`).toBe(false);
      expect(on.some((id, i) => id === "high" && on[i - 1] === "low"), `seed ${seed}`).toBe(true);
    }
    expect(up).toBeGreaterThanOrEqual(3);
  });

  it("goes straight up from where it stood at its pace, facing away and its head as the clip has it, the paws played by the distance climbed, and hangs from the lip at the top where the climb takes it on from", () => {
    const world = stairs(2.5);
    const body = world.bodyLength;
    const high = 800 - 2.5 * body;
    const step = (0.6 * body) / 30;
    let seen = 0;
    for (const seed of [1, 3, 4]) {
      const { frames } = afternoon(seed, world);
      for (const [start, end] of scales(frames)) {
        seen++;
        const where = `seed ${seed}, frames ${start}..${end}`;
        const first = frames[start]!;
        // it set off from its feet on the lower shelf, where it had walked to
        expect(frames[start - 1]!.grounded, where).toBe(true);
        expect(frames[start - 1]!.y, where).toBe(800);
        expect(Math.abs(frames[start - 1]!.x - first.x), where).toBeLessThan(0.05 * body);
        expect(first.y, where).toBeCloseTo(800, 0);
        for (let i = start; i <= end; i++) {
          const f = frames[i]!;
          expect(f.x, where).toBe(first.x);
          expect(f.facing, where).toBe(1);
          expect(f.grounded, where).toBe(false);
          expect(f.look, where).toBeUndefined();
          expect(f.viewer, where).toBe(false);
          if (i === start) continue;
          // up at every frame, by as much as the odometer says it climbed, and at its pace once under way
          const was = frames[i - 1]!;
          expect(f.y, where).toBeLessThan(was.y);
          expect(f.odometer - was.odometer, where).toBeCloseTo(was.y - f.y, 6);
          if (i - start >= 12) expect(was.y - f.y, where).toBeCloseTo(step, 6);
        }
        // as long as the face is, at that pace, and a moment to get under way
        expect(Math.abs((end - start + 1) / 30 - ((2.5 - 0.8) / 0.6 + 0.35 / 2)), where).toBeLessThan(0.1);
        // the last of it a pace short of where its forepaws take hold of the lip, and then the climb from there: the frame at the point it ends up standing at, above where it went up
        expect(frames[end]!.y - high, where).toBeGreaterThan(0.8 * body);
        expect(frames[end]!.y - high, where).toBeLessThanOrEqual(0.8 * body + step + 1e-6);
        const climb = frames[end + 1]!;
        expect(climb.clip, where).toBe("climb");
        expect(climb.progress, where).toBe(0);
        expect(climb.y, where).toBe(high);
        // (a walk stops within a few hundredths of a body length of its mark: the place under the lip)
        expect(Math.abs(climb.x - climb.facing * CLIMB_BACK * body - first.x), where).toBeLessThan(0.05 * body);
        let last = end + 1;
        while (frames[last + 1]?.clip === "climb") last++;
        expect(last - end, where).toBeGreaterThanOrEqual(Math.round(CLIMB_TIME * 30));
        for (const g of frames.slice(end + 1, last + 1)) {
          expect(g.x, where).toBe(climb.x);
          expect(g.y, where).toBe(high);
          expect(g.facing, where).toBe(climb.facing);
        }
        // and it is on its feet on top at the end of it
        expect(frames[last]!.grounded, where).toBe(true);
        expect(frames[last]!.progress, where).toBe(1);
        expect(frames[last + 1]?.y ?? frames[last]!.y, where).toBe(high);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it("is not taken off the face by a hand, nor stroked, called or told on the way up", () => {
    const world = stairs(2.5);
    const body = world.bodyLength;
    let tried = 0;
    for (const seed of [1, 3, 4]) {
      const engine = new CatEngine(seed);
      let at = -1;
      const { frames } = stepCat(engine, world, 600, 30, (f, t) => {
        if (at >= 0 || f.clip !== "scale" || f.y > 800 - 0.5 * body) return;
        at = Math.round(t * 30);
        engine.send({ type: "cat.grab", at: { x: f.x, y: f.y - 0.5 * body } });
        engine.send({ type: "cat.pet" });
        engine.send({ type: "cat.call", at: { x: 400, y: 800 } });
        engine.send({ type: "cat.command", command: "sit" });
      });
      if (at < 0) continue;
      tried++;
      const where = `seed ${seed}, frame ${at}`;
      // it goes on up the face, over the lip and onto its feet on top, never in a hand, and not stroked
      const rest = frames.slice(at + 1);
      expect(rest[0]!.clip, where).toBe("scale");
      const over = rest.findIndex((f) => f.clip !== "scale");
      expect(rest[over]!.clip, where).toBe("climb");
      const top = rest.findIndex((f) => f.clip === "climb" && f.grounded);
      expect(top, where).toBeGreaterThan(over);
      expect(rest.slice(0, top + 1).some((f) => f.carried || f.petted), where).toBe(false);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it("lets go of the face and falls to what is under it when the page takes the ledge away from over it or moves it away, or the painter that draws it from behind goes", () => {
    const body = stairs(2.5).bodyLength;
    const changes: Array<[string, (w: World, f: CatFrame) => World]> = [
      ["gone", (w) => ({ ...w, surfaces: w.surfaces.filter((s) => s.id !== "high") })],
      ["moved", (w, f) => ({ ...w, surfaces: w.surfaces.map((s) => (s.id === "high" ? { ...s, x0: f.x + (f.x > 960 ? -6 : 3) * body, x1: f.x + (f.x > 960 ? -3 : 6) * body } : s)) })],
      ["no painter", (w) => ({ ...w, rearView: false })],
    ];
    for (const [name, change] of changes) {
      let tried = 0;
      for (const seed of [1, 3, 4]) {
        const engine = new CatEngine(seed);
        const world = stairs(2.5);
        let at = -1;
        const { frames } = stepCat(engine, world, 600, 30, (f, t) => {
          if (at >= 0 || f.clip !== "scale" || f.y > 800 - 0.6 * body) return;
          at = Math.round(t * 30);
          return change(world, f);
        });
        if (at < 0) continue;
        tried++;
        const where = `${name}, seed ${seed}, frame ${at}`;
        const rest = frames.slice(at + 1);
        // at once it is falling (off its feet, the leap's clip), and goes down, and only down, onto the shelf under it, on its feet, where it was
        expect(rest[0]!.clip, where).toBe("jump");
        expect(rest[0]!.grounded, where).toBe(false);
        const down = rest.findIndex((f) => f.grounded);
        expect(down, where).toBeGreaterThan(0);
        expect(rest.slice(0, down + 1).every((f) => f.clip === "jump"), where).toBe(true);
        for (let i = 1; i <= down; i++) expect(rest[i]!.y, where).toBeGreaterThanOrEqual(rest[i - 1]!.y);
        expect(rest[down]!.y, where).toBe(800);
        expect(rest[down]!.x, where).toBeCloseTo(frames[at]!.x, 3);
      }
      expect(tried, name).toBeGreaterThan(0);
    }
  });

  it("does not go up a face that has something on it the cat keeps out of (the card the viewer is on): it leaps", () => {
    const base = stairs(2.5);
    const body = base.bodyLength;
    const high = 800 - 2.5 * body;
    // (across the whole face between the two shelves, clear of where the cat stands on either)
    const world: World = { ...base, keepOut: [{ x: 300, y: high + 10, w: 1200, h: 800 - 1.3 * body - (high + 10) }] };
    let leaps = 0;
    for (const seed of [1, 3, 4]) {
      const { frames, leaping } = afternoon(seed, world);
      expect(frames.some((f) => f.clip === "scale"), `seed ${seed}`).toBe(false);
      leaps += leapsUp(leaping);
    }
    expect(leaps).toBeGreaterThan(0);
  });

  it("is the same cat from the same seed, frame for frame", () => {
    const world = stairs(2.5);
    const seed = [1, 3, 4].find((s) => afternoon(s, world).frames.some((f) => f.clip === "scale"));
    expect(seed).toBeDefined();
    expect(afternoon(seed!, world).frames).toEqual(afternoon(seed!, world).frames);
  });

  it("goes up the faces of the cards in afternoons of a page that is scrolled, flung, resized and changed, with nothing wrong", () => {
    const chaos = { scroll: true, focus: true, resize: true, route: true, hand: true, mouse: true };
    let scaled = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos: seed > 2 ? { ...chaos, fling: true } : chaos, rearView: true });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      scaled += stats.acts["scale"] ?? 0;
    }
    expect(scaled).toBeGreaterThan(5);
  });
});

describe("the cat in a film", () => {
  const film = (state: World["player"] = "playing", controls = false) => playerWorld(1920, 1080, state, controls);

  it("goes to its perch while the page changes, and sleeps there", () => {
    const engine = new CatEngine(1);
    run(engine, browseWorld(defaultPage()), 4);
    const w = film();
    // (it watches the picture a while first, and nods off: see "watches the picture" below)
    const { frames } = stepCat(engine, w, 45);
    const last = frames[frames.length - 1]!;
    const perch = w.surfaces[0]!;
    expect(last.y).toBe(perch.y);
    expect(last.x).toBeGreaterThanOrEqual(perch.x0);
    expect(last.x).toBeLessThanOrEqual(perch.x1);
    expect(last.clip).toBe("curl");
    expect(last.drowsy).toBeGreaterThan(0.9);
    expect(last.appear).toBe(1);
    // (it went there out of sight: it never walked or leapt across the picture)
    for (const f of frames) if (f.appear > 0.05) expect(f.clip).not.toBe("jump");
  });

  it("can be picked up in a film, with the controls up or not, and is put down on its perch wherever the hand let go of it", () => {
    for (const controls of [false, true]) {
      const engine = new CatEngine(3);
      const w = film("playing", controls);
      run(engine, w, 45);
      const perch = w.surfaces[0]!;
      const grip = { x: engine.frame.x, y: engine.frame.y - 0.4 * w.bodyLength };
      engine.send({ type: "cat.grab", at: grip });
      expect(engine.update(w, 1 / 30).carried, `controls ${controls}`).toBe(true);
      // the hand takes it a long way across the picture, and holds it there
      const to = { x: 500, y: 350 };
      for (let i = 1; i <= 45; i++) {
        engine.send({ type: "cat.carry", at: { x: grip.x + ((to.x - grip.x) * i) / 45, y: grip.y + ((to.y - grip.y) * i) / 45 } });
        engine.update(w, 1 / 30);
      }
      expect(engine.frame.carried, `controls ${controls}`).toBe(true);
      engine.send({ type: "cat.drop" });
      const last = stepCat(engine, w, 10).frames.pop()!;
      expect(last.carried, `controls ${controls}`).toBe(false);
      expect(last.grounded, `controls ${controls}`).toBe(true);
      expect(last.appear, `controls ${controls}`).toBeGreaterThan(0.9);
      // (the only place a film has for it)
      expect(last.y, `controls ${controls}`).toBe(perch.y);
      expect(last.x, `controls ${controls}`).toBeGreaterThanOrEqual(perch.x0 - 1);
      expect(last.x, `controls ${controls}`).toBeLessThanOrEqual(perch.x1 + 1);
    }
  });

  it("wakes when the film is paused, and goes back to sleep when it plays", () => {
    const engine = new CatEngine(1);
    const w = film();
    run(engine, w, 45);
    engine.send({ type: "player.pause" });
    const paused = stepCat(engine, film("paused"), 5).frames;
    expect(paused[paused.length - 1]!.clip).toBe("loaf");
    expect(paused[paused.length - 1]!.drowsy).toBeLessThan(0.5);
    engine.send({ type: "player.resume" });
    const resumed = stepCat(engine, film("playing"), 20).frames;
    expect(resumed[resumed.length - 1]!.clip).toBe("curl");
  });

  it("stays where it is, asleep, when the controls come and go over it: the layer is under them, so it has no reason to go (and does not flicker with every key)", () => {
    const engine = new CatEngine(1);
    run(engine, film(), 45);
    const where = { x: engine.frame.x, y: engine.frame.y };
    let fades = 0;
    let was = engine.frame.appear;
    for (let round = 0; round < 12; round++) {
      for (const up of [true, false]) {
        const { frames } = stepCat(engine, film("playing", up), 2.5);
        for (const f of frames) {
          if (was >= 0.99 && f.appear < 0.99) fades++;
          was = f.appear;
          expect(f.x).toBeCloseTo(where.x, 3);
          expect(f.y).toBeCloseTo(where.y, 3);
        }
      }
    }
    expect(fades).toBe(0);
    // (asleep, or turning over in its sleep: in place either way)
    expect(["curl", "shift"]).toContain(engine.frame.clip);
  });

  it("finds its perch all the same when the film begins to play while the controls are over every place it could have", () => {
    // (a film that is slow to start: the controls are up, the cat has been sent out of the library and has nowhere to be yet, and then the picture plays)
    for (let seed = 1; seed <= 6; seed++) {
      const engine = new CatEngine(seed);
      run(engine, browseWorld(defaultPage()), 4);
      stepCat(engine, film("loading", true), 1.5);
      engine.send({ type: "player.play" });
      stepCat(engine, film("playing", true), 2);
      const { frames } = stepCat(engine, film("playing", false), 10);
      const last = frames[frames.length - 1]!;
      expect(last.appear, `seed ${seed}`).toBe(1);
      expect(last.y, `seed ${seed}`).toBe(film().surfaces[0]!.y);
      // (watching the picture, or nodding off, or asleep: not walking about the picture)
      expect(["loaf", "doze", "curl"], `seed ${seed}`).toContain(last.clip);
    }
  });

  it("watches the picture from its perch, nods off, and sleeps; it does not watch the film all over again every time it wakes", () => {
    const engine = new CatEngine(1);
    const w = film();
    const { frames } = stepCat(engine, w, 420);
    const seen: string[] = [];
    for (const f of frames) {
      if (f.appear < 1) continue;
      if (seen[seen.length - 1] !== f.clip) seen.push(f.clip);
    }
    expect(seen.slice(0, 3)).toEqual(["loaf", "doze", "curl"]);
    expect(seen.filter((c) => c === "loaf")).toHaveLength(1);
    expect(seen.filter((c) => c === "doze")).toHaveLength(1);
    // (it looks at the picture while it watches it: the middle of the screen, a little above the middle)
    const watching = frames.filter((f) => f.appear === 1 && f.clip === "loaf");
    expect(watching.length).toBeGreaterThan(30 * 6);
    for (const f of watching) {
      expect(f.look?.x).toBeCloseTo(960, 0);
      expect(f.look?.y).toBeCloseTo(0.38 * 1080, 0);
    }
    // (and as it nods off it gets sleepy by degrees, and is not asleep until it sleeps)
    const dozing = frames.filter((f) => f.appear === 1 && f.clip === "doze");
    expect(dozing.length).toBeGreaterThan(30 * 7);
    expect(Math.max(...dozing.map((f) => f.drowsy))).toBeLessThan(0.75);
    expect(Math.max(...dozing.map((f) => f.drowsy))).toBeGreaterThan(0.5);
    expect(Math.min(...frames.filter((f) => f.appear === 1 && f.clip === "curl").map((f) => f.drowsy))).toBeGreaterThan(0.6);
  });

  it("turns over in its sleep now and then, in its place, without waking: the shift keeps it drowsy and does not move it", () => {
    const engine = new CatEngine(1);
    const w = film();
    const { frames } = stepCat(engine, w, 420);
    const shifts = frames.filter((f) => f.appear === 1 && f.clip === "shift");
    expect(shifts.length).toBeGreaterThan(30 * 2.5);
    const perch = frames.filter((f) => f.appear === 1 && f.clip === "curl")[0]!;
    for (const f of shifts) {
      expect(f.x).toBeCloseTo(perch.x, 3);
      expect(f.y).toBeCloseTo(perch.y, 3);
      expect(f.drowsy).toBeGreaterThan(0.85);
    }
    // (more than once in a long film, and after a good sleep each time)
    let starts = 0;
    let last = "";
    let sleptFor = 0;
    let shortest = Infinity;
    for (const f of frames) {
      if (f.appear < 1) continue;
      if (f.clip === "curl") sleptFor += 1 / 30;
      if (f.clip === "shift" && last !== "shift") {
        starts++;
        shortest = Math.min(shortest, sleptFor);
        sleptFor = 0;
      }
      last = f.clip;
    }
    expect(starts).toBeGreaterThanOrEqual(2);
    expect(shortest).toBeGreaterThan(30);
  });

  it("goes straight to sleep, and stays as it is, for a viewer who wants no motion: no watching, no nodding off, no turning over", () => {
    const engine = new CatEngine(1);
    const w = playerWorld(1920, 1080, "playing", false, { reducedMotion: true });
    const { frames } = stepCat(engine, w, 300);
    expect([...new Set(frames.filter((f) => f.appear === 1).map((f) => f.clip))]).toEqual(["curl"]);
  });

  it("is not left unseen by a command that comes as it is put in its new place, before it has faded in", () => {
    for (const command of ["sleep", "sit", "play", "come"] as const) {
      const engine = new CatEngine(3);
      run(engine, browseWorld(defaultPage()), 4);
      const w = film();
      let told = false;
      let last = engine.frame.appear;
      for (let i = 0; i < 30 * 8; i++) {
        const dbg = engine.debug();
        // (the moment between the move and the fade in: it has been put where it goes, and is not in sight yet)
        if (!told && dbg.placed && dbg.mode === "player" && dbg.queue.join() === "fade:in" && last === 0) {
          engine.send({ type: "cat.command", command });
          told = true;
        }
        last = engine.update(w, 1 / 30).appear;
      }
      expect(told, command).toBe(true);
      expect(last, command).toBe(1);
    }
  });

  it("is never seen on a page that has no perch", () => {
    const engine = new CatEngine(1);
    const none: World = { ...film(), surfaces: [] };
    const { frames } = stepCat(engine, none, 20);
    expect(frames.every((f) => f.appear === 0)).toBe(true);
  });
});

describe("the cat and the things on the page", () => {
  const page = (): World => browseWorld(defaultPage());

  /** A cat that has come to rest somewhere on the page (sitting or standing, on a shelf, for a moment already), stepped there from a seed. */
  const resting = (seed: number, w: World = page()): CatEngine => {
    const engine = new CatEngine(seed);
    let still = 0;
    for (let i = 0; i < 30 * 180; i++) {
      engine.update(w, 1 / 30);
      const act = engine.debug().act;
      still = engine.frame.appear > 0.99 && engine.frame.grounded && (act === "rest:sit" || act === "rest:stand") ? still + 1 : 0;
      if (still > 15) return engine;
    }
    throw new Error(`seed ${seed}: the cat never came to rest`);
  };

  it("looks over a drop before it goes down it, and measures a climb before it goes up, when it is in no hurry", () => {
    let drops = 0;
    let climbs = 0;
    for (const seed of [1, 2, 3, 4]) {
      const w = page();
      const engine = new CatEngine(seed);
      let before = "";
      for (let i = 0; i < 30 * 600; i++) {
        engine.update(w, 1 / 30);
        const dbg = engine.debug();
        // (not the zoomies: a cat at play runs and leaps at everything, in no mood to look over the edge)
        if (dbg.act === "jump" && before !== "jump" && dbg.choice !== "zoomies") {
          const to = w.surfaces.find((s) => s.id === dbg.jumpTo);
          const from = w.surfaces.find((s) => s.id === dbg.surfaceId);
          if (to && from) {
            const fall = to.y - from.y;
            if (fall >= 1.3 * w.bodyLength) {
              drops++;
              expect(before, `seed ${seed}: down ${fall.toFixed(0)}px`).toBe("shot:peek");
            } else if (-fall >= 1.1 * w.bodyLength) {
              climbs++;
              expect(before, `seed ${seed}: up ${(-fall).toFixed(0)}px`).toBe("shot:wiggle");
            }
          }
        }
        before = dbg.act;
      }
    }
    expect(drops).toBeGreaterThan(3);
    expect(climbs).toBeGreaterThan(3);
  });

  it("is not made to look over the edge by a cat that is hurrying (called, sent to a poster)", () => {
    const w = page();
    const engine = new CatEngine(3);
    stepCat(engine, w, 20);
    const acts = new Set<string>();
    const watch = (seconds: number) => {
      for (let i = 0; i < 30 * seconds; i++) {
        engine.update(w, 1 / 30);
        acts.add(engine.debug().act);
      }
    };
    // (called to the bottom of the screen, and then sent to a poster on another row)
    engine.send({ type: "cat.call", at: { x: 900, y: 1070 } });
    watch(12);
    engine.send({ type: "cat.point", targetId: w.targets[0]!.id });
    watch(12);
    expect(acts.has("jump")).toBe(true);
    expect(acts.has("shot:peek")).toBe(false);
  });

  /** The pointer goes from `from` body lengths ahead of the middle of the cat's back to `to`, `step` body lengths a frame; the feelings the cat shows meanwhile. */
  const dash = (engine: CatEngine, w: World, from: number, to: number, step: number): string[] => {
    const shown: string[] = [];
    const cx = engine.frame.x;
    const cy = engine.frame.y - 0.4 * w.bodyLength;
    const frames = Math.ceil(Math.abs(to - from) / step);
    for (let i = 0; i <= frames; i++) {
      const d = from + Math.sign(to - from) * Math.min(Math.abs(to - from), i * step);
      engine.update({ ...w, pointer: { x: cx + d * w.bodyLength, y: cy } }, 1 / 30);
      shown.push(engine.frame.emote ?? "none");
    }
    return shown;
  };

  it("flinches when the pointer dashes at it, and freezes, then washes; not at one that drifts up to it or lands on it; and not again for a good while", () => {
    const w = page();
    for (const seed of [2, 3, 4]) {
      const engine = resting(seed, w);
      const shown = dash(engine, w, 2.4, 0.8, 0.5);
      expect(shown, `seed ${seed}`).toContain("startle");
      // (the fright is brief, and the cat stays where it was)
      const after = stepCat(engine, w, 3).frames;
      expect(after.some((f) => f.emote === "startle")).toBe(true);
      expect(after[after.length - 1]!.emote).toBe("none");
      // ...and a second dash a few seconds later is not another fright
      expect(dash(engine, w, 2.4, 0.8, 0.5), `seed ${seed}, again`).not.toContain("startle");
    }
    // (a pointer that comes slowly, or lands on the cat, is not a fright)
    for (const seed of [2, 3, 4]) {
      expect(dash(resting(seed, w), w, 2.4, 0.8, 0.03), `seed ${seed}, slowly`).not.toContain("startle");
      expect(dash(resting(seed, w), w, 3, 0.1, 3), `seed ${seed}, onto it`).not.toContain("startle");
    }
    // (nor does a cat that is asked for quiet, or for less motion, flinch)
    for (const flag of ["quiet", "reducedMotion"] as const) {
      expect(dash(resting(3, w), { ...w, [flag]: true }, 2.4, 0.8, 0.5), flag).not.toContain("startle");
    }
  });

  it("bats at a pointer that rests up by its head, a little way off: goes to a paw's length from it, faces it, reaches at it, and not again for a while", () => {
    let batted = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w0 = page();
      const engine = resting(seed, w0);
      const pointer = { x: engine.frame.x + 1.8 * w0.bodyLength, y: engine.frame.y - 0.7 * w0.bodyLength };
      const w: World = { ...w0, pointer };
      const starts: number[] = [];
      let inTap = false;
      for (let i = 0; i < 30 * 220; i++) {
        const f = engine.update(w, 1 / 30);
        if (f.clip === "tap") {
          if (!inTap) starts.push(i / 30);
          inTap = true;
          expect(f.facing, `seed ${seed}`).toBe(pointer.x > f.x ? 1 : -1);
          expect(f.reach?.x).toBeCloseTo(pointer.x, 1);
          expect(f.reach?.y).toBeCloseTo(pointer.y, 1);
          expect(Math.abs(pointer.x - f.x) / w.bodyLength, `seed ${seed}`).toBeGreaterThan(0.45);
          expect(Math.abs(pointer.x - f.x) / w.bodyLength, `seed ${seed}`).toBeLessThan(1.15);
        } else inTap = false;
      }
      if (starts.length > 0) batted++;
      for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!, `seed ${seed}`).toBeGreaterThan(70);
    }
    expect(batted).toBeGreaterThanOrEqual(4);
  });

  it("does not bat at a pointer that is on the cat, far from it, or down at its feet, nor when the viewer wants quiet or less motion (the pointer stays where it is to the cat, wherever the cat goes)", () => {
    const L2 = page().bodyLength;
    const tries: Array<[string, { dx: number; dy: number }, Partial<World>]> = [
      ["on the cat", { dx: 0.2, dy: -0.5 }, {}],
      ["far off", { dx: 4.5, dy: -0.7 }, {}],
      ["at its feet", { dx: 1.8, dy: 0.2 }, {}],
      ["quiet", { dx: 1.8, dy: -0.7 }, { quiet: true }],
      ["reduced motion", { dx: 1.8, dy: -0.7 }, { reducedMotion: true }],
    ];
    for (const [name, off, flags] of tries) {
      for (const seed of [1, 2, 3, 4]) {
        const w0: World = { ...page(), ...flags };
        const engine = resting(seed, w0);
        for (let i = 0; i < 30 * 150; i++) {
          const f = engine.update({ ...w0, pointer: { x: engine.frame.x + off.dx * L2, y: engine.frame.y + off.dy * L2 } }, 1 / 30);
          if (f.clip === "tap") throw new Error(`${name}, seed ${seed}: batted at ${(i / 30).toFixed(1)} s`);
        }
      }
    }
    // (and the same pointer, a paw's length ahead of the cat's head, is something it does bat at: the cat is not simply deaf to it)
    let batted = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w0 = page();
      const engine = resting(seed, w0);
      for (let i = 0; i < 30 * 150; i++) {
        const f = engine.update({ ...w0, pointer: { x: engine.frame.x + 1.8 * L2, y: engine.frame.y - 0.7 * L2 } }, 1 / 30);
        if (f.clip === "tap") {
          batted++;
          break;
        }
      }
    }
    expect(batted).toBeGreaterThanOrEqual(3);
  });

  it("jumps for joy on the spot when it is told a title was found, and has a letdown when it is told there was none; the quiet ones feel it without the jump", () => {
    const w = page();
    for (const seed of [2, 3, 4]) {
      const engine = resting(seed, w);
      const x0 = engine.frame.x;
      const y0 = engine.frame.y;
      engine.send({ type: "cat.react", kind: "found" });
      const frames = stepCat(engine, w, 3).frames;
      expect(frames[1]!.emote, `seed ${seed}`).toBe("joy");
      expect(frames.filter((f) => f.clip === "jump").length, `seed ${seed}`).toBeGreaterThan(8);
      // (a hop on the spot: it comes down within half a body of where it went up, on the same shelf; what it does afterwards is its own affair)
      const first = frames.findIndex((f) => f.clip === "jump");
      let end = first;
      while (end + 1 < frames.length && frames[end + 1]!.clip === "jump") end++;
      expect(Math.max(...frames.slice(0, end + 1).map((f) => Math.abs(f.x - x0))), `seed ${seed}`).toBeLessThan(0.5 * w.bodyLength);
      expect(frames[end]!.y, `seed ${seed}`).toBeCloseTo(y0, 1);
      // (a joy is a moment)
      expect(frames[frames.length - 1]!.emote).toBe("none");
    }
    for (const seed of [2, 3, 4]) {
      const engine = resting(seed, w);
      engine.send({ type: "cat.react", kind: "empty" });
      const frames = stepCat(engine, w, 3.2).frames;
      expect(frames[1]!.emote, `seed ${seed}`).toBe("droop");
      for (const f of frames.slice(15, 70)) {
        expect(f.clip, `seed ${seed}`).toBe("sit");
        expect(f.emote).toBe("droop");
      }
      expect(frames[frames.length - 1]!.emote).toBe("none");
    }
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const still = { ...w, [flag]: true };
      const engine = resting(3, still);
      engine.send({ type: "cat.react", kind: "found" });
      const frames = stepCat(engine, still, 3).frames;
      expect(frames[1]!.emote, flag).toBe("joy");
      expect(frames.some((f) => f.clip === "jump"), flag).toBe(false);
    }
  });

  it("does not take a joy for a reason to jump when it is not on its feet on a shelf (asleep, in a hand, away, or not yet there)", () => {
    const w = page();
    const asleep = new CatEngine(3);
    stepCat(asleep, w, 20);
    asleep.send({ type: "cat.command", command: "sleep" });
    stepCat(asleep, w, 5);
    asleep.send({ type: "cat.react", kind: "found" });
    const slept = stepCat(asleep, w, 3).frames;
    expect(slept.every((f) => f.clip === "curl")).toBe(true);
    expect(slept.every((f) => (f.emote ?? "none") === "none")).toBe(true);
    // (the page told it before it was there: nothing happens, and nothing is wrong)
    const early = new CatEngine(3);
    early.send({ type: "cat.react", kind: "found" });
    expect(stepCat(early, w, 2).frames.every((f) => Number.isFinite(f.x) && (f.emote ?? "none") === "none")).toBe(true);
  });

  it("sometimes goes to the place above a poster on the next row and looks down at it, and sometimes cocks its head at a new card", () => {
    let inspected = 0;
    let tilts = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = page();
      const engine = new CatEngine(seed);
      let shot = false;
      let was = "";
      let peekLooks = 0;
      let card = 0;
      for (let i = 0; i < 30 * 600; i++) {
        // (a new card gets the focus every twenty-odd seconds)
        if (i % (30 * 23) === 0) {
          card++;
          const target = w.targets[card % w.targets.length]!;
          engine.send({ type: "catalog.itemFocused", id: target.id });
          w.focus = { x: target.rect.x - 12, y: target.rect.y - 12, w: target.rect.w + 24, h: target.rect.h + 24 };
        }
        const f = engine.update(w, 1 / 30);
        const act = engine.debug().act;
        if (f.emote === "tilt" && was !== "tilt") tilts++;
        was = f.emote ?? "none";
        if (act === "shot:peek") {
          shot = true;
          if (f.look && f.look.y > f.y) peekLooks++;
        } else if (shot) {
          shot = false;
          // (a peek that is not followed by a leap was a cat looking at a poster, not at a drop)
          if (act !== "jump" && peekLooks > 20) inspected++;
          peekLooks = 0;
        }
      }
    }
    expect(inspected).toBeGreaterThanOrEqual(2);
    expect(tilts).toBeGreaterThanOrEqual(1);
  });

  it("falls into a deeper sleep in the library now and then with a turn in it (a nap of a minute is not one stillness), and ponders now and then", () => {
    let shifts = 0;
    let thinks = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const stats = runSession({ seed, seconds: 900 });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      shifts += stats.acts["shot:shift"] ?? 0;
    }
    expect(shifts).toBeGreaterThan(0);
    for (const seed of [1, 2, 3, 4]) {
      const engine = new CatEngine(seed);
      const w = page();
      let was = false;
      for (const f of stepCat(engine, w, 400).frames) {
        const now = f.emote === "think";
        if (now && !was) thinks++;
        if (now) expect(["sit", "loaf", "stand"], `seed ${seed}`).toContain(f.clip);
        was = now;
      }
    }
    expect(thinks).toBeGreaterThanOrEqual(2);
  });

  it("goes through bad afternoons with a mouse about the page, hands, films and menus, and never does the wrong scene for the viewer", () => {
    const chaos = { mouse: true, touch: true, hand: true, scroll: true, focus: true, film: true, modal: true, resize: true, route: true, visibility: true };
    let peeks = 0;
    let dozes = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      peeks += stats.acts["shot:peek"] ?? 0;
      dozes += stats.acts["shot:doze"] ?? 0;
    }
    expect(peeks).toBeGreaterThan(0);
    expect(dozes).toBeGreaterThan(0);
    // (with all of that going on the pointer is seldom at rest in the cat's reach in a browsing page, so batting at it is counted on a page with only a mouse about)
    let taps = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos: { mouse: true } });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      taps += stats.acts["tap"] ?? 0;
    }
    expect(taps).toBeGreaterThan(0);
    for (const flag of ["quiet", "reducedMotion"] as const) {
      for (const some of [chaos, { mouse: true }]) {
        const stats = runSession({ seed: 5, seconds: 600, chaos: some, [flag]: true });
        expect(stats.violations, flag).toEqual([]);
        expect(stats.acts["tap"] ?? 0, flag).toBe(0);
      }
    }
  });
});

describe("what must never happen (the cat through a very bad afternoon)", () => {
  const chaos = { scroll: true, focus: true, resize: true, modal: true, film: true, touch: true, route: true, visibility: true };

  it("never leaves the page, floats, stands in a keep-out zone, teleports or goes wrong in a number, whatever happens to the page", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const stats = runSession({ seed, seconds: 600, chaos });
      expect(stats.violations, `seed ${seed}`).toEqual([]);
      expect(stats.maxAppear).toBeGreaterThan(0.9);
    }
  });

  it("goes through an hour of a page that only scrolls and changes its focus with nothing wrong, and does things", () => {
    const stats = runSession({ seed: 99, seconds: 3600, fps: 20, chaos: { scroll: true, focus: true } });
    expect(stats.violations).toEqual([]);
    expect(stats.hops).toBeGreaterThan(5);
    expect(stats.surfaces.length).toBeGreaterThan(2);
    // it rests most of the time (the quiet is on purpose), walks some, and sleeps some
    const total = Object.values(stats.acts).reduce((a, b) => a + b, 0);
    const rest = (stats.acts["rest:sit"] ?? 0) + (stats.acts["rest:loaf"] ?? 0) + (stats.acts["rest:stand"] ?? 0);
    expect(rest / total).toBeGreaterThan(0.25);
    expect(rest / total).toBeLessThan(0.9);
  });

  it("gets through the same afternoon with reduced motion on, without moving", () => {
    const stats = runSession({ seed: 5, seconds: 600, chaos, reducedMotion: true });
    expect(stats.violations).toEqual([]);
    expect(stats.hops).toBe(0);
  });

  it("never holds the same act for ever (the watchdog), in any of those", () => {
    const stats = runSession({ seed: 3, seconds: 1800, chaos: { scroll: true, focus: true, touch: true } });
    for (const [act, seconds] of Object.entries(stats.acts)) {
      if (act === "sleep" || act === "none") continue;
      expect(seconds, act).toBeLessThan(1500);
    }
  });

  it("keeps every one of those promises for a cat of a character of its own, with a hand that strokes it, takes it up and dashes at it", () => {
    const afternoon = { ...chaos, hand: true, mouse: true, stroke: true };
    for (const temperament of ["ginger", "ragdoll"]) {
      let annoyed = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const stats = runSession({ seed, seconds: 600, chaos: afternoon, temperament });
        expect(stats.violations, `${temperament} seed ${seed}`).toEqual([]);
        annoyed += stats.emotes["annoyed"] ?? 0;
      }
      // (the hand did get on the ragdoll's nerves: this is not an afternoon without a stroke)
      if (temperament === "ragdoll") expect(annoyed).toBeGreaterThan(3);
      // and the two cats that are quiet, or that do not move, are as they were: the feeling shows, nothing else does
      for (const flag of ["quiet", "reducedMotion"] as const) {
        const stats = runSession({ seed: 5, seconds: 600, chaos: afternoon, temperament, [flag]: true });
        expect(stats.violations, `${temperament} ${flag}`).toEqual([]);
        expect(stats.acts["swat"] ?? 0, `${temperament} ${flag}`).toBe(0);
        if (flag === "reducedMotion") expect(stats.hops, temperament).toBe(0);
      }
    }
  });
});
