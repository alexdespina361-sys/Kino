import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import type { CatFrame, Rect, World } from "../types";
import { JUMP_LANDING, JUMP_TAKEOFF } from "../types";
import { CatEngine } from "./engine";
import { computeLedges, findPath, GRAVITY, jumpAt, ledgeAt, MAX_DOWN, MAX_UP, planJump, reshape, restSpot, screenEdges, settledCost, stepFlight, type Clutter, type Ledge, type RestPose } from "./ledges";
import { shapeCovers, shapeHits } from "./shape";
import { browseWorld, defaultPage, playerWorld, runSession, stepCat } from "./sim";
import { tvLibrary } from "./tv-library.fixture";

const L = 92;

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
      // (a word at a height where the sitting cat's head is, and not the lying one's)
      const high = { x: 500, y: 800 - 1.05 * L, w: 0.3 * L, h: 0.1 * L };
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

    it("settles for the worst of the postures it goes through: a place for a long sleep is one where lying down and treading fit as well as curling up", () => {
      // (a shelf that ends where the cat's feet may still be on the screen: curled up it fits at the very end, lying out with its tail along the floor it does not)
      const end: Ledge = { ...ledge, x0: 100, x1: 1920 - 0.78 * L };
      const around0 = around();
      const worst = settledCost(["loaf", "knead", "curl"], -1, end.x1, 800, L, around0);
      expect(worst).toBe(Math.max(settledCost("loaf", -1, end.x1, 800, L, around0), settledCost("knead", -1, end.x1, 800, L, around0), settledCost("curl", -1, end.x1, 800, L, around0)));
      expect(settledCost("curl", -1, end.x1, 800, L, around0)).toBe(0);
      expect(worst).toBeGreaterThan(0);
      expect(restSpot(end, end.x1, -1, L, "curl", around0)).toBeUndefined();
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

  it("turns round when the window is made smaller and puts it down at the end of a shelf with its tail over the edge of the screen, and is not left lying so", () => {
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
    expect(last.facing).toBe(1);
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
    // told, the cat hides about a third of what it hides by chance: measured 0.06 against 0.20)
    expect(blind.hidden).toBeGreaterThan(0.15);
    expect(told.hidden).toBeLessThan(0.09);
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
    // (measured: 0.24 of its resting time on this page hid names when it knew only the shelf it was on; 0.04 knowing the others)
    expect(seen.share).toBeLessThan(0.1);
    // (it is on the crowded shelf now and then, on its way and for the pauses of a stroll, but not to rest on)
    expect(seen.on["p1:row0"] ?? 0).toBeLessThan(0.1 * seen.resting);
    expect(seen.on["p1:row1"] ?? 0).toBeGreaterThan(0.3 * seen.resting);
  });

  it("on the TV's own library page, as the cat read it, it does not rest in front of a name: not where it settles and not where it lands from a hop", () => {
    // (the floor of the screen is the place with the names: the rows are clear of them)
    let floor = 0;
    let hid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]) {
      const engine = new CatEngine(seed);
      for (let i = 0; i < 600 * 30; i++) {
        const f = engine.update(tvLibrary, 1 / 30);
        const debug = engine.debug();
        const pose: RestPose | null = debug.act === "rest:sit" ? "sit" : debug.act === "rest:loaf" ? "loaf" : debug.act === "rest:stand" ? "stand" : debug.act === "sleep" ? "curl" : null;
        if (!pose || debug.surfaceId !== "floor" || f.appear < 0.99 || !f.grounded) continue;
        floor++;
        if (shapeCovers(pose, f.facing, f.x, f.y, tvLibrary.bodyLength, tvLibrary.soft!) / tvLibrary.bodyLength ** 2 > 0.1) hid++;
      }
    }
    expect(floor).toBeGreaterThan(8000);
    // (measured: 0.095 of its resting on the floor hid more than a tenth of a body-square of names while the landing of a hop was left to chance, and the posture was the one drawn; 0.028 since,
    // nearly all of it the first seat or loaf where it appears and the seat after a sniff)
    expect(hid / floor).toBeLessThan(0.05);
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
  const settled = (seed = 4, flags: Partial<ReturnType<typeof defaultPage>> = {}) => {
    const page = { ...defaultPage(), ...flags };
    const engine = new CatEngine(seed);
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
    // the feet two body lengths over the shelf; the first shelf above is more than the cat can spring up to, the floor is further down
    const hung = lift(engine, world, { x: x + 0.8 * body, y: second!.y - 2 * body - 0.73 * body });
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
    // (about the time a body length's fall of two takes: sqrt(2 * 2 / 24) = 0.4 s)
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

  it("is not picked up when the viewer wants quiet or less motion, in a film, or while a menu has sent it away, and is still stroked", () => {
    for (const flag of ["quiet", "reducedMotion"] as const) {
      const { engine, world, body } = settled(6, { [flag]: true });
      engine.send({ type: "cat.grab", at: { x: engine.frame.x, y: engine.frame.y - 0.4 * body } });
      engine.send({ type: "cat.carry", at: { x: 800, y: 300 } });
      const frames = stepCat(engine, world, 1).frames;
      expect(frames.every((f) => !f.carried && f.grounded), flag).toBe(true);
      expect(Math.abs(frames[frames.length - 1]!.x - frames[0]!.x), flag).toBeLessThan(1);
    }
    const film = playerWorld(1920, 1080, "playing", false);
    const inFilm = new CatEngine(6);
    stepCat(inFilm, film, 8);
    inFilm.send({ type: "cat.grab", at: { x: inFilm.frame.x, y: inFilm.frame.y - 40 } });
    expect(stepCat(inFilm, film, 1).frames.some((f) => f.carried)).toBe(false);
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
    const once: Array<{ seed: number; seconds: number; fps?: number; names?: boolean }> = [
      { seed: 581, seconds: 900, fps: 20 },
      { seed: 196, seconds: 600 },
      { seed: 283, seconds: 900, names: true },
      { seed: 294, seconds: 900, fps: 60 },
      { seed: 386, seconds: 600, fps: 60 },
      { seed: 62, seconds: 600, fps: 60 },
      { seed: 153, seconds: 600, fps: 60 },
    ];
    for (const run of once) expect(runSession({ ...run, chaos }).violations, JSON.stringify(run)).toEqual([]);
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
        if (dbg.act === "jump" && before !== "jump") {
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
});
