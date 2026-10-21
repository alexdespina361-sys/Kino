import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import type { CatFrame, Rect, World } from "../types";
import { JUMP_LANDING, JUMP_TAKEOFF } from "../types";
import { CatEngine } from "./engine";
import { computeLedges, findPath, GRAVITY, jumpAt, ledgeAt, MAX_DOWN, MAX_UP, planJump, reshape, restSpot, screenEdges, settledCost, stepFlight, type Clutter, type Ledge, type RestPose } from "./ledges";
import { shapeCovers, shapeHits } from "./shape";
import { browseWorld, defaultPage, playerWorld, runSession, stepCat } from "./sim";

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

describe("the cat in a film", () => {
  const film = (state: World["player"] = "playing", controls = false) => playerWorld(1920, 1080, state, controls);

  it("goes to its perch while the page changes, and sleeps there", () => {
    const engine = new CatEngine(1);
    run(engine, browseWorld(defaultPage()), 4);
    const w = film();
    const { frames } = stepCat(engine, w, 30);
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
    run(engine, w, 30);
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
    run(engine, film(), 30);
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
    expect(engine.frame.clip).toBe("curl");
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
      expect(last.clip, `seed ${seed}`).toBe("curl");
    }
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
