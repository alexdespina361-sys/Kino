import { bodyLengthFor } from "../math";
import { createRng, type Rng } from "../rng";
import type { CatEvent, CatFrame, Rect, Surface, Target, World } from "../types";
import { CatEngine, RIDE_EASE } from "./engine";
import { HALF_WIDTH, reachOf, shapeHits } from "./shape";
import type { Temperament } from "./temperament";

/**
 * The scenario simulator: a made-up page (rows of posters like the TV's home, a film's screen), made-up things happening to it (scrolling,
 * the card with the focus moving, a menu opening, the film starting, the window being resized, a touch of the cat) and a cat that is stepped
 * through it in virtual time, from a seed. After every frame the cat is checked against what must never happen. A failure is replayable: the
 * seed and the second say where. Used by the tests, and by `scripts/cat/soak.mjs` for hours of cat in a few seconds.
 */

export interface PageOptions {
  width: number;
  height: number;
  /** 0.. how far the rows are scrolled up. */
  scroll: number;
  rows: number;
  tilesPerRow: number;
  /** Poster width in pixels. */
  tile: number;
  focus: { row: number; col: number } | null;
  /** The page's id, changed when the page is replaced (a route change gives new rows). */
  page: number;
  reducedMotion: boolean;
  quiet: boolean;
  /** Names hanging right above each shelf, over the cards (the worst case: where a cat standing on the shelf would sit), as the page's `soft` words. */
  names?: boolean;
  /** How far each row of posters is scrolled sideways, in pixels (the shelf itself stays where it is: the posters slide under it). */
  slide?: number[];
}

export const defaultPage = (): PageOptions => ({ width: 1920, height: 1080, scroll: 0, rows: 4, tilesPerRow: 6, tile: 330, focus: null, page: 1, reducedMotion: false, quiet: false });

export { bodyLengthFor };

/** A page of rows of posters, in the shape the TV's home has. */
export function browseWorld(page: PageOptions, extra: { pointer?: { x: number; y: number }; modal?: boolean } = {}): World {
  const { width, height } = page;
  const L = bodyLengthFor(width, height);
  const surfaces: Surface[] = [];
  const targets: Target[] = [];
  const keepOut: Rect[] = [];
  const soft: Rect[] = [];
  let focus: Rect | undefined;
  for (let row = 0; row < page.rows; row++) {
    const top = 511 + 350 * row - page.scroll;
    const x0 = 125;
    const x1 = x0 + page.tilesPerRow * (page.tile + 24);
    surfaces.push({ id: `p${page.page}:row${row}`, kind: "shelfTop", y: top, x0, x1, weight: 1 });
    for (let col = 0; col < page.tilesPerRow; col++) {
      const rect = { x: x0 + col * (page.tile + 24) + (page.slide?.[row] ?? 0), y: top, w: page.tile, h: 190 };
      targets.push({ id: `p${page.page}:r${row}c${col}`, rect, surfaceId: `p${page.page}:row${row}` });
      if (page.names) soft.push({ x: rect.x + 10, y: top - 0.55 * L, w: page.tile * 0.7, h: 0.4 * L });
      if (page.focus && page.focus.row === row && page.focus.col === col) focus = { x: rect.x - 12, y: rect.y - 12, w: rect.w + 24, h: rect.h + 24 };
    }
  }
  surfaces.push({ id: "floor", kind: "fallbackFloor", y: height - 6, x0: 0, x1: width, weight: 0.4 });
  // the banner and its buttons, and the corner's buttons, are not for standing in front of
  keepOut.push({ x: 130, y: 120 - page.scroll, w: 960, h: 340 }, { x: 0, y: 0, w: width, h: 130 }, { x: 0, y: 0, w: 140, h: height });
  if (focus) keepOut.push(focus);
  if (extra.modal) keepOut.push({ x: 300, y: 150, w: width - 600, h: height - 300 });
  const world: World = {
    viewport: { x: 0, y: 0, w: width, h: height },
    bodyLength: L,
    surfaces,
    keepOut,
    targets,
    mode: extra.modal ? "away" : "browse",
    player: "none",
    controlsUp: false,
    quiet: page.quiet,
    reducedMotion: page.reducedMotion,
  };
  if (focus) world.focus = focus;
  if (soft.length > 0) world.soft = soft;
  if (extra.pointer) world.pointer = extra.pointer;
  return world;
}

/**
 * A film's screen, as the page reads it: the cat's perch is a corner of the picture, and there is nothing to keep out of (the cat's layer is under the controls
 * and the subtitles, which come and go over it without it going anywhere).
 */
export function playerWorld(width: number, height: number, state: World["player"], controlsUp: boolean, viewer: { quiet?: boolean; reducedMotion?: boolean } = {}): World {
  const L = bodyLengthFor(width, height);
  const perch: Surface = { id: "perch", kind: "playerPerch", y: height * 0.9, x0: width - 3.2 * L, x1: width - 0.6 * L, weight: 1 };
  return { viewport: { x: 0, y: 0, w: width, h: height }, bodyLength: L, surfaces: [perch], keepOut: [], targets: [], mode: "player", player: state, controlsUp, quiet: viewer.quiet ?? false, reducedMotion: viewer.reducedMotion ?? false };
}

export interface SimStats {
  seconds: number;
  frames: number;
  /** Seconds spent in each kind of act. */
  acts: Record<string, number>;
  /** Seconds spent feeling each feeling (see `Emote`). */
  emotes: Record<string, number>;
  /** How many times the cat chose each thing to do of its own accord (see `EngineDebug.choice`). */
  choices: Record<string, number>;
  hops: number;
  /** How many times a page that was flung shook the cat off its shelf. */
  flings: number;
  /** Seconds the cat was in sight in the library, by the kind of place under its feet ("shelfTop", "fallbackFloor"...), or "air" while it was off its feet. */
  places: Record<string, number>;
  surfaces: string[];
  minAppear: number;
  maxAppear: number;
  violations: string[];
  /** The last frames before the first violation, one line each, so a failure can be read where it happened. */
  context: string[];
  lastDebug: string;
}

export interface SimOptions {
  seed: number;
  seconds: number;
  fps?: number;
  /**
   * What may happen to the page. `mouse`: a pointer that wanders the page, dashes about, rests, comes to the cat, and is put down (it is gone from the world three
   * seconds after it last moved, as the host has it). `fling`: the scrolling (`scroll`) is that of a finger that flings the page, eight thousand pixels a second and as far as the whole
   * page, and not the slow one of a wheel. `stroke`: a hand now and then rests on the cat for two to fourteen seconds and strokes it as the host's hand does (a stroke a third of a second
   * after it came and one every second after that, an end to it when it goes), in a film as well as on the library (where the world has no pointer to say where the hand is).
   */
  chaos?: { scroll?: boolean; focus?: boolean; resize?: boolean; modal?: boolean; film?: boolean; touch?: boolean; route?: boolean; visibility?: boolean; hand?: boolean; mouse?: boolean; slide?: boolean; fling?: boolean; stroke?: boolean };
  reducedMotion?: boolean;
  quiet?: boolean;
  /** What sort of cat it is (see `Temperament`): the baseline, the cat before there were two, when not said. */
  temperament?: Temperament | string;
  /** The page has names over its shelves (see `PageOptions.names`). */
  names?: boolean;
  /** Stop at the first thing that must not happen. */
  stopOnViolation?: boolean;
  /** How many frames before the first violation to keep for `context` (default 14). */
  contextFrames?: number;
}

// Body lengths per second: faster than any run or leap the cat makes (the fastest part of the highest leap is about 15).
const VMAX_L = 18;

export function runSession(options: SimOptions): SimStats {
  const fps = options.fps ?? 30;
  const dt = 1 / fps;
  const rng = createRng(options.seed ^ 0x5eed);
  const engine = new CatEngine(options.seed, options.temperament === undefined ? {} : { temperament: options.temperament });
  const chaos = options.chaos ?? {};
  const page = defaultPage();
  page.reducedMotion = options.reducedMotion ?? false;
  page.quiet = options.quiet ?? false;
  page.names = options.names ?? false;
  const stats: SimStats = { seconds: 0, frames: 0, acts: {}, emotes: {}, choices: {}, hops: 0, flings: 0, places: {}, surfaces: [], minAppear: 1, maxAppear: 0, violations: [], context: [], lastDebug: "" };
  let wasFlung = false;
  let lastChoice = "";
  /** Where each row of posters is being scrolled to sideways (see `chaos.slide`). */
  const slideGoal: number[] = [];
  const trail: string[] = [];
  const seen = new Set<string>();
  let scrollGoal = 0;
  let movedAt = -1e9;
  let inFilm = false;
  let filmState: World["player"] = "playing";
  let playAt = -1;
  let controlsUp = false;
  let modal = false;
  let hidden = false;
  let pointer: { x: number; y: number } | undefined;
  /** The wandering mouse (see `chaos.mouse`): where it is, where it goes and how fast (body lengths a second), when it is resting until, and when it last moved. */
  let mouse: { x: number; y: number; gx: number; gy: number; speed: number; restUntil: number; movedAt: number } | null = null;
  /** The hand that strokes the cat (see `chaos.stroke`): until when, and when the next stroke is due. */
  let stroking: { until: number; next: number } | null = null;
  /** A hand that has the cat (where it is, where it is going, and until when), if one does. */
  let handAt: { x: number; y: number } | null = null;
  let handGoal = { x: 0, y: 0 };
  let handSpeed = 0;
  let handUntil = 0;
  let world = browseWorld(page);
  let prev: { x: number; y: number; appear: number; onScreen: boolean; shelves: Map<string, number>; act: string } | null = null;
  let overlapSince = -1;
  let cutSince = -1;
  let lostRun = 0;
  let awaySince = -1;
  let goneSince = -1;
  let prevSize = "";
  let wasJumping = false;
  /** When a hand last had the cat (for the fight with it to be gone within a moment of the hand letting go). */
  let carriedAt = -1e9;
  /** How far the posters that were slid are still to carry a cat that is on them: the engine takes it in over a few frames (`RIDE_EASE`), so the frames after a slide are the row's movement too. */
  let carryLeft = 0;
  const steps = Math.round(options.seconds * fps);
  const fail = (msg: string) => {
    if (stats.violations.length === 0) stats.context = [...trail];
    if (stats.violations.length < 20) stats.violations.push(`t=${(stats.frames * dt).toFixed(2)}s seed=${options.seed}: ${msg}`);
  };

  const rebuild = () => {
    world = inFilm ? playerWorld(page.width, page.height, filmState, controlsUp, { quiet: page.quiet, reducedMotion: page.reducedMotion }) : browseWorld(page, { ...(pointer ? { pointer } : {}), modal });
    if (hidden) world = { ...world, mode: "away" };
  };

  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    let changed = false;
    /** How far a row of posters was slid this frame (a cat on it goes with it: that is the row's movement, not the cat's own). */
    let slideStep = 0;
    // --- things that happen to the page, at random
    if (chaos.scroll && rng.chance(0.004)) scrollGoal = rng.pick(chaos.fling ? [0, 0, 350, 700, 1400, 2800] : [0, 0, 170, 350, 520, 700]) ?? 0;
    if (page.scroll !== scrollGoal) {
      page.scroll += Math.sign(scrollGoal - page.scroll) * Math.min(Math.abs(scrollGoal - page.scroll), chaos.fling ? 8000 * dt : 40);
      changed = true;
    }
    if (chaos.slide) {
      // (a row is scrolled sideways now and then, by a wheel or a swipe: read about every tenth of a second, a good way each time)
      if (rng.chance(0.003)) slideGoal[rng.int(0, Math.max(0, page.rows - 1))] = rng.pick([0, 0, 240, 480, -240, -480, 900]) ?? 0;
      if (i % Math.max(1, Math.round(fps / 10)) === 0) {
        const slide = page.slide ?? (page.slide = []);
        for (let row = 0; row < page.rows; row++) {
          const goal = slideGoal[row] ?? 0;
          const at = slide[row] ?? 0;
          if (at !== goal) {
            const step = Math.min(Math.abs(goal - at), 70);
            slide[row] = at + Math.sign(goal - at) * step;
            slideStep = Math.max(slideStep, step);
            changed = true;
          }
        }
      }
    }
    // (what the posters that slid may carry a cat this frame: the share the engine takes of what is left, the most it could take)
    carryLeft += slideStep;
    const carryNow = carryLeft * Math.min(1, dt * RIDE_EASE);
    carryLeft -= carryNow;
    if (chaos.focus && rng.chance(0.03)) {
      page.focus = rng.chance(0.1) ? null : { row: rng.int(0, page.rows - 1), col: rng.int(0, page.tilesPerRow - 1) };
      changed = true;
      if (page.focus) engine.send({ type: "catalog.itemFocused", id: `p${page.page}:r${page.focus.row}c${page.focus.col}` });
    }
    if (chaos.resize && rng.chance(0.0015)) {
      const sizes = [
        [1920, 1080],
        [1280, 720],
        [1366, 768],
        [2560, 1440],
        [900, 500],
      ] as const;
      const [w, h] = rng.pick(sizes) ?? [1920, 1080];
      page.width = w;
      page.height = h;
      changed = true;
      engine.send({ type: "viewport.resized" });
    }
    if (chaos.route && rng.chance(0.0015)) {
      page.page++;
      page.rows = rng.int(1, 5);
      page.tilesPerRow = rng.int(2, 9);
      page.scroll = 0;
      scrollGoal = 0;
      page.focus = null;
      page.slide = [];
      slideGoal.length = 0;
      changed = true;
      engine.send({ type: "route.enter", page: String(page.page) });
    }
    if (chaos.modal && rng.chance(0.002)) {
      modal = !modal;
      changed = true;
      engine.send({ type: modal ? "ui.modalOpened" : "ui.modalClosed" });
    }
    if (chaos.visibility && rng.chance(0.0015)) {
      hidden = !hidden;
      changed = true;
      engine.send({ type: "app.visibility", visible: !hidden });
    }
    if (chaos.film && rng.chance(0.0025)) {
      inFilm = !inFilm;
      // (a film starts as the TV's does: the controls are up, and the picture takes a moment to begin to play)
      filmState = inFilm ? "loading" : "playing";
      playAt = inFilm ? t + rng.range(0, 3) : -1;
      controlsUp = inFilm && rng.chance(0.7);
      changed = true;
      if (!inFilm) engine.send({ type: "player.ended" });
    }
    if (inFilm && filmState === "loading" && t >= playAt) {
      filmState = "playing";
      changed = true;
      engine.send({ type: "player.play" });
    }
    if (inFilm) {
      if (rng.chance(0.01)) {
        controlsUp = !controlsUp;
        changed = true;
      }
      if (filmState !== "loading" && rng.chance(0.003)) {
        filmState = filmState === "playing" ? "paused" : "playing";
        changed = true;
        engine.send({ type: filmState === "paused" ? "player.pause" : "player.resume" });
      }
    }
    if (chaos.touch && rng.chance(0.01)) {
      const roll = rng.next();
      if (roll < 0.5) engine.send({ type: "cat.pet" });
      else if (roll < 0.6) engine.send({ type: "cat.petEnd" });
      else if (roll < 0.75) engine.send({ type: "cat.call", at: { x: rng.range(0, page.width), y: rng.range(0, page.height) } });
      else if (roll < 0.88) engine.send({ type: "cat.command", command: rng.pick(["sit", "sleep", "play", "come"] as const) ?? "sit" });
      else if (roll < 0.94) engine.send({ type: "cat.react", kind: rng.chance(0.6) ? "found" : "empty" });
      else if (world.targets.length > 0) engine.send({ type: "cat.point", targetId: rng.pick(world.targets)?.id ?? "" });
      if (rng.chance(0.2) && !chaos.mouse) {
        pointer = { x: rng.range(0, page.width), y: rng.range(0, page.height) };
        changed = true;
      }
    }
    if (chaos.mouse) {
      const Lm = world.bodyLength;
      if (!mouse) {
        if (rng.chance(0.006)) {
          const at = { x: rng.range(0, page.width), y: rng.range(0, page.height) };
          mouse = { ...at, gx: at.x, gy: at.y, speed: 0, restUntil: t, movedAt: t };
        }
      } else if (rng.chance(0.0015)) {
        mouse = null;
        if (pointer) changed = true;
        pointer = undefined;
      } else {
        const moving = mouse.speed > 0;
        if (!moving && t >= mouse.restUntil) {
          // (a new goal: half the time near the cat -- a hand that comes to it, at the height of its head or a dash across it -- and otherwise anywhere)
          const near = rng.chance(0.55) && engine.frame.appear > 0.5;
          mouse.gx = near ? engine.frame.x + rng.range(-3, 3) * Lm : rng.range(0, page.width);
          mouse.gy = near ? engine.frame.y - rng.range(-0.2, 1.6) * Lm : rng.range(0, page.height);
          mouse.speed = rng.chance(0.3) ? rng.range(10, 24) : rng.range(0.5, 6);
        }
        if (mouse.speed > 0) {
          const dx = mouse.gx - mouse.x;
          const dy = mouse.gy - mouse.y;
          const gap = Math.hypot(dx, dy);
          const step = Math.min(gap, mouse.speed * Lm * dt);
          if (gap > 1e-6) {
            mouse.x += (dx / gap) * step;
            mouse.y += (dy / gap) * step;
            mouse.movedAt = t;
          }
          if (gap - step < 1) {
            mouse.speed = 0;
            mouse.restUntil = t + rng.range(0.3, 6);
          }
        }
        const next = t - mouse.movedAt < 3 ? { x: mouse.x, y: mouse.y } : undefined;
        if (next || pointer) changed = true;
        pointer = next;
      }
    }
    // a hand that strokes the cat now and then: the pointer is on the cat, the first stroke is sent after a third of a second and one every second after that (as the host's hand does), for a few seconds
    if (chaos.stroke) {
      const Ls = world.bodyLength;
      if (!stroking) {
        if (world.mode !== "away" && engine.frame.appear > 0.9 && rng.chance(0.004)) stroking = { until: t + rng.range(2, 14), next: t + 0.32 };
      } else if (t >= stroking.until || world.mode === "away") {
        engine.send({ type: "cat.petEnd" });
        stroking = null;
        pointer = undefined;
        changed = true;
      } else {
        const on = { x: engine.frame.x, y: engine.frame.y - 0.5 * Ls };
        if (!pointer || Math.hypot(pointer.x - on.x, pointer.y - on.y) > 0.5) {
          pointer = on;
          changed = true;
        }
        if (t >= stroking.next) {
          engine.send({ type: "cat.pet" });
          stroking.next += 1;
        }
      }
    }
    if (changed) {
      rebuild();
      movedAt = t;
    }
    // (the host reads the page at every frame while it moves, and for a moment after, and otherwise a few times a second; the world is the very same object when nothing has changed, and says it was read)
    if (t - movedAt < 0.45 || i % Math.max(1, Math.round(fps / 10)) === 0) world.readAt = t * 1000;

    // a hand now and then takes the cat up, carries it about (as fast as a hand goes: the cat follows as fast as it can) and puts it down, or is lost with it in it
    if (chaos.hand) {
      const L0 = world.bodyLength;
      if (!handAt) {
        if (world.mode === "browse" && engine.frame.appear > 0.9 && rng.chance(0.004)) {
          handAt = { x: engine.frame.x, y: engine.frame.y - 0.4 * L0 };
          handGoal = { x: rng.range(0, page.width), y: rng.range(0, page.height) };
          handSpeed = rng.range(1, 30) * L0;
          handUntil = t + rng.range(0.2, 6);
          engine.send({ type: "cat.grab", at: { ...handAt } });
        }
      } else {
        const dx: number = handGoal.x - handAt.x;
        const dy: number = handGoal.y - handAt.y;
        const gap: number = Math.hypot(dx, dy);
        const step = Math.min(gap, handSpeed * dt);
        if (gap > 1e-6) handAt = { x: handAt.x + (dx / gap) * step, y: handAt.y + (dy / gap) * step };
        if (gap < 1 || rng.chance(0.02)) {
          handGoal = { x: rng.range(0, page.width), y: rng.range(0, page.height) };
          handSpeed = rng.range(1, 30) * L0;
        }
        if (t >= handUntil) {
          // (and one hand in seven is lost with the cat in it: the cat is let go of by itself)
          if (rng.chance(0.86)) engine.send({ type: "cat.drop" });
          handAt = null;
        } else engine.send({ type: "cat.carry", at: { ...handAt } });
      }
    }

    const frame = engine.update(world, dt);
    const dbg = engine.debug();
    stats.frames++;
    stats.seconds = stats.frames * dt;
    stats.acts[dbg.act] = (stats.acts[dbg.act] ?? 0) + dt;
    if (dbg.choice !== lastChoice) {
      lastChoice = dbg.choice;
      stats.choices[dbg.choice] = (stats.choices[dbg.choice] ?? 0) + 1;
    }
    if (frame.emote && frame.emote !== "none") stats.emotes[frame.emote] = (stats.emotes[frame.emote] ?? 0) + dt;
    if (frame.appear > 0.5 && world.mode === "browse") {
      const place = frame.grounded && dbg.surfaceId ? (world.surfaces.find((s) => s.id === dbg.surfaceId)?.kind ?? "other") : "air";
      stats.places[place] = (stats.places[place] ?? 0) + dt;
    }
    stats.lastDebug = JSON.stringify(dbg);
    stats.minAppear = Math.min(stats.minAppear, frame.appear);
    stats.maxAppear = Math.max(stats.maxAppear, frame.appear);
    const jumping = dbg.act === "jump";
    if (jumping && !wasJumping) stats.hops++;
    wasJumping = jumping;
    if (dbg.flung && !wasFlung) stats.flings++;
    wasFlung = dbg.flung;
    if (dbg.surfaceId && !seen.has(dbg.surfaceId)) {
      seen.add(dbg.surfaceId);
      stats.surfaces.push(dbg.surfaceId);
    }

    // --- what must never happen
    const L = world.bodyLength;
    const surfaceNow = dbg.surfaceId ? world.surfaces.find((s) => s.id === dbg.surfaceId) : undefined;
    trail.push(
      `${(stats.frames * dt).toFixed(2)}s ${dbg.act}${dbg.queue.length > 0 ? ` (then ${dbg.queue.slice(0, 3).join(", ")})` : ""} [${frame.clip}] on ${dbg.surfaceId ?? "-"} x=${frame.x.toFixed(0)} y=${frame.y.toFixed(1)} shelf=${surfaceNow ? surfaceNow.y.toFixed(1) : "-"} ${frame.grounded ? "ground" : "air"} appear=${frame.appear.toFixed(2)} scroll=${page.scroll}${world.focus ? ` focus=${world.focus.x.toFixed(0)},${world.focus.y.toFixed(0)}` : ""} ${page.width}x${page.height}${inFilm ? " film" : ""}${modal ? " modal" : ""}`,
    );
    if (trail.length > (options.contextFrames ?? 14)) trail.shift();
    const numbers = [frame.x, frame.y, frame.vx, frame.vy, frame.odometer, frame.drowsy, frame.energy, frame.appear, frame.progress, frame.clipTime];
    if (numbers.some((n) => !Number.isFinite(n))) fail(`a number is not finite: ${JSON.stringify(frame)}`);
    if (frame.appear < 0 || frame.appear > 1.0001) fail(`appear out of range: ${frame.appear}`);
    if (frame.drowsy < 0 || frame.drowsy > 1.0001) fail(`drowsy out of range: ${frame.drowsy}`);
    if (frame.progress < 0 || frame.progress > 1.0001) fail(`progress out of range: ${frame.progress}`);
    // (the scenes of the page: nodding off is a film's, and batting at the pointer is a roaming cat's, never one whose viewer asked for quiet or for less motion)
    const fading = dbg.act === "fade:out" || dbg.act === "fade:in" || dbg.act === "relocate";
    if (frame.appear > 0.05 && !fading) {
      if (frame.clip === "doze" && world.mode !== "player") fail(`dozing off outside a film (${dbg.act})`);
      if (frame.clip === "tap" && (world.quiet || world.reducedMotion)) fail(`batting at the pointer for a viewer who wants no motion (${dbg.act})`);
      // (a swat is a leap's worth of motion: the paw is put down on a poster, on its feet, and for a viewer who wants less motion it is never swung)
      if (frame.clip === "swat" && world.reducedMotion) fail(`swatting for a viewer who wants less motion (${dbg.act})`);
      if (frame.clip === "swat" && (!frame.reach || !frame.grounded)) fail(`a swat at nothing, or off its feet (${dbg.act}, reach ${JSON.stringify(frame.reach)}, ${frame.grounded ? "ground" : "air"})`);
      if ((frame.emote ?? "none") !== "none" && !["tilt", "think", "startle", "joy", "droop", "annoyed", "shake"].includes(frame.emote ?? "")) fail(`a feeling that is not one: ${frame.emote}`);
    }
    // (the fight with a hand is in a hand: it is 0..1, and gone within a moment of the hand letting go)
    const fight = frame.struggle ?? 0;
    if (!Number.isFinite(fight) || fight < 0 || fight > 1.0001) fail(`struggle out of range: ${fight}`);
    if (frame.carried) carriedAt = t;
    else if (fight > 0 && t - carriedAt > 0.7) fail(`still fighting a hand ${(t - carriedAt).toFixed(2)}s after it let go (${fight.toFixed(2)})`);
    const visible = frame.appear > 0.05;
    // (a cat that is fading out is on its way off the page: it is allowed to be where the page no longer has a place for it)
    const vanishing = dbg.act === "fade:out";
    // some part of the cat is on the screen
    const onScreen = frame.x >= -HALF_WIDTH * L && frame.x <= world.viewport.w + HALF_WIDTH * L && frame.y >= 0 && frame.y <= world.viewport.h + 0.9 * L + 1;
    if (visible && !vanishing) {
      const surface = dbg.surfaceId ? world.surfaces.find((s) => s.id === dbg.surfaceId) : undefined;
      if (frame.grounded && dbg.act !== "jump") {
        if (!surface) fail(`standing on a surface that is not there (${dbg.surfaceId}, act ${dbg.act})`);
        else if (Math.abs(frame.y - surface.y) > 1.5) fail(`feet ${frame.y.toFixed(1)} are not on the surface at ${surface.y.toFixed(1)} (${dbg.act})`);
      }
      // on the screen: never wholly off it, and not cut by its edge for more than a moment (a window that was just made smaller)
      // (as it is drawn: how far its tail and its nose reach, not the middle of it)
      const vw = world.viewport.w;
      const reach = reachOf(frame.clip);
      const cut = frame.x - (frame.facing > 0 ? reach.back : reach.front) * L < -0.3 * L || frame.x + (frame.facing > 0 ? reach.front : reach.back) * L > vw + 0.3 * L;
      if (!onScreen) {
        // (a frame or two of it while the cat is put back after the window was made smaller is not seen; more is)
        lostRun++;
        if (lostRun > 3) fail(`off the screen at ${frame.x.toFixed(0)},${frame.y.toFixed(0)} (${dbg.act})`);
      } else lostRun = 0;
      // (a cat in a hand is where the hand has it, edge of the screen or not)
      if (cut && dbg.act !== "carried") {
        if (cutSince < 0) cutSince = t;
        else if (t - cutSince > 2) fail(`cut by the edge of the screen for ${(t - cutSince).toFixed(1)}s at ${frame.x.toFixed(0)},${frame.y.toFixed(0)} (${dbg.act})`);
      } else cutSince = -1;
      // keeps out of what it must keep out of: at most for a moment while it steps aside
      const inside = world.keepOut.some((zone) => frame.grounded && shapeHits(frame.clip, frame.facing, frame.x, frame.y, L, zone));
      if (inside) {
        if (overlapSince < 0) overlapSince = t;
        else if (t - overlapSince > 2.8) fail(`stood in a keep-out zone for ${(t - overlapSince).toFixed(1)}s (${dbg.act}) at ${frame.x.toFixed(0)},${frame.y.toFixed(0)}`);
      } else overlapSince = -1;
    } else {
      overlapSince = -1;
      cutSince = -1;
    }
    // when the page asks for the cat to be away (a menu is open, the tab is hidden) it is gone within a moment
    if (world.mode === "away") {
      if (awaySince < 0) awaySince = t;
      else if (t - awaySince > 0.8 && visible) fail(`still there ${(t - awaySince).toFixed(1)}s after the page asked it to be away`);
    } else awaySince = -1;
    // and it comes back: a page that has a place for it, and does not ask it to be away, has it in sight again within a few seconds
    if (world.mode !== "away" && dbg.ledges > 0 && frame.appear < 0.05) {
      if (goneSince < 0) goneSince = t;
      else if (t - goneSince > 6) fail(`not in sight for ${(t - goneSince).toFixed(0)}s though the page has ${dbg.ledges} places for it (${dbg.act}, placed=${dbg.placed})`);
    } else goneSince = -1;
    // no jumps from place to place: the speed of a cat is bounded, and a shelf that moves (the page scrolls) takes the cat with it
    const shelves = new Map(world.surfaces.map((s) => [s.id, s.y] as const));
    // (a window that is resized carries the page, and the cat on it, to new places: that frame is not the cat's own movement)
    const size = `${world.viewport.w}x${world.viewport.h}`;
    const resized = prevSize !== size;
    prevSize = size;
    if (prev && visible && prev.appear > 0.05 && prev.onScreen && !resized) {
      let shelfMove = 0;
      for (const id of [dbg.surfaceId, dbg.jumpTo]) {
        const before = id ? prev.shelves.get(id) : undefined;
        const after = id ? shelves.get(id) : undefined;
        if (before !== undefined && after !== undefined) shelfMove = Math.max(shelfMove, Math.abs(after - before));
      }
      const limit = VMAX_L * L * dt + shelfMove + Math.max(slideStep, carryNow) + 1;
      const move = Math.hypot(frame.x - prev.x, frame.y - prev.y);
      // (the first frame of a climb is where the cat's paws take hold: the frame is the point it will stand at, and the picture is drawn from where it hangs, below it -- the move to there is the art's)
      const climbBegins = dbg.act === "climb" && prev.act !== "climb";
      if (move > limit && !climbBegins) fail(`jumped ${move.toFixed(0)}px in one frame (limit ${limit.toFixed(0)}, ${dbg.act})`);
    }
    prev = { x: frame.x, y: frame.y, appear: frame.appear, onScreen, shelves, act: dbg.act };
    if (options.stopOnViolation && stats.violations.length > 0) break;
  }
  return stats;
}

/** A page (browse, no chaos) and a cat, stepped for `seconds`, for tests that look at what one cat does. */
export function stepCat(engine: CatEngine, world: World, seconds: number, fps = 30, between?: (frame: CatFrame, t: number) => World | void): { frames: CatFrame[]; world: World } {
  const frames: CatFrame[] = [];
  let current = world;
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const frame = engine.update(current, dt);
    frames.push({ ...frame });
    const next = between?.(frame, i * dt);
    if (next) current = next;
  }
  return { frames, world: current };
}

export type { Rng, CatEvent };
