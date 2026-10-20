import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import type { World } from "../types";
import { JUMP_LANDING, JUMP_TAKEOFF } from "../types";
import { CatEngine } from "./engine";
import { boxHits, computeLedges, findPath, GRAVITY, jumpAt, ledgeAt, MAX_DOWN, MAX_UP, planJump, reshape, stepFlight } from "./ledges";
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

  it("knows whether the cat's box would touch a zone", () => {
    expect(boxHits(500, 800, L, { x: 450, y: 760, w: 20, h: 20 })).toBe(true);
    expect(boxHits(500, 800, L, { x: 900, y: 760, w: 20, h: 20 })).toBe(false);
    expect(boxHits(500, 800, L, { x: 450, y: 100, w: 20, h: 20 })).toBe(false);
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
      expect(Math.abs(f.vx)).toBeLessThan(3 * L);
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
    expect(boxHits(last.x, last.y, world.bodyLength, world.focus!)).toBe(false);
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
    expect(world.keepOut.some((zone) => last.grounded && last.appear > 0.05 && boxHits(last.x, last.y, world.bodyLength, zone))).toBe(false);
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

describe("the cat in a film", () => {
  const film = (state: World["player"] = "playing", controls = false, captions = false) => playerWorld(1920, 1080, state, controls, captions);

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

  it("is out of sight when the controls are up, or subtitles are on its place, and back after", () => {
    const engine = new CatEngine(1);
    run(engine, film(), 30);
    const hidden = stepCat(engine, film("playing", true, false), 3).frames;
    expect(hidden[hidden.length - 1]!.appear).toBe(0);
    const back = stepCat(engine, film("playing", false, false), 5).frames;
    expect(back[back.length - 1]!.appear).toBe(1);
    // a subtitle where the perch is
    const w = film("playing", false, false);
    const onPerch = { ...w, keepOut: [{ x: 1500, y: 900, w: 420, h: 150 }] };
    const gone = stepCat(engine, onPerch, 3).frames;
    expect(gone[gone.length - 1]!.appear).toBe(0);
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
