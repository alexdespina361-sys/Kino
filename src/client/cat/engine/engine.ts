import { clamp, clamp01, finite, lerp } from "../math";
import { createRng, type Rng } from "../rng";
import { JUMP_LANDING, JUMP_TAKEOFF, type CatEvent, type CatFrame, type Clip, type Rect, type Vec, type World } from "../types";
import { clampToLedge, computeLedges, findPath, ledgeAt, planJump, reshape, screenEdges, settle, settledCost, stepFlight, type JumpPlan, type Ledge, type RestPose, type Settling } from "./ledges";
import { HALF_WIDTH, shapeHits } from "./shape";

/**
 * The cat's mind and legs. Each frame it is given the page as a `World` (plain numbers) and the time that passed, and it says what the cat
 * is doing as a `CatFrame`. It knows nothing of the browser, so a whole afternoon of a cat can be run in a test, from a seed, in a blink.
 *
 * How it decides: what has to be done at once (a pet, a call, the film starting) replaces the plan; with nothing to do, the cat chooses
 * what it feels like by weighing what it could do (rest, wander, hop to another shelf, groom, stretch, sleep) against how long ago it last
 * did it, how sleepy and how lively it is, and what the page offers. Every act has a time it must end by, so nothing holds the cat for ever.
 */

type Pose = "sit" | "loaf" | "stand";

type Act =
  | { k: "fade"; to: 0 | 1; rate: number }
  | { k: "relocate"; where: "home" | "perch" }
  | { k: "rest"; pose: Pose; dur: number }
  | { k: "sleep"; dur: number }
  /** `stalk`: creeping, low and slow, at the thing it is stalking (the point it looks at). */
  | { k: "walk"; x: number; run: boolean; maxT: number; stalk?: Vec }
  | { k: "jump"; toSurface: string; toX: number }
  /** A little scene with a length of its own; `at` is what the cat looks at while it lasts. */
  | { k: "shot"; clip: "stretch" | "yawn" | "groom" | "scratch" | "knead" | "sniff" | "wiggle"; dur: number; at?: Vec }
  | { k: "point"; target: Rect; dur: number };

/** A leap in progress: a crouch, the flight along the arc of `plan`, and the settling after the landing. */
interface JumpState {
  plan: JumpPlan;
  toSurface: string;
  /** Seconds of crouching before the leap and of settling after the landing (the two ends of the clip), and how far through each it is. */
  crouch: number;
  settle: number;
  crouchT: number;
  settleT: number;
  /** How far along the arc: 0..1 up to the top, 1..2 down (see stepFlight). */
  phase: number;
  landed: boolean;
  /** The shelf it took off from and where that was then: if the page scrolls, the whole arc goes with it. */
  fromSurface: string;
  fromShelfY: number;
  baseFromY: number;
}

export interface Mood {
  sleepiness: number;
  energy: number;
  affection: number;
  curiosity: number;
}

export interface EngineDebug {
  act: string;
  queue: string[];
  surfaceId: string | null;
  /** The shelf a leap in the air is going to. */
  jumpTo: string | null;
  ledges: number;
  mode: string;
  placed: boolean;
  mood: Mood;
  now: number;
}

/** Speeds in body lengths per second, and how quickly the cat gets up to them. */
const WALK_SPEED = 0.95;
const STALK_SPEED = 0.4;
const RUN_SPEED = 2.5;
const ACCEL = 3.2;
/** How long the cat takes to appear and to fade away, and what it does at most for any act (the watchdog). */
const FADE_IN_RATE = 1 / 0.8;
const FADE_OUT_RATE = 1 / 0.3;
const WATCHDOG = 240;
/**
 * How long a cat rides a shelf that has no room for it before it goes, how long it may stay where it should not be (seconds), and after how much of that it
 * steps aside if the shelf has room for it elsewhere (it goes only when there is none).
 */
const RIDE = 0.7;
const OVERLAP = 1.6;
const ASIDE = 0.5;
/** How much of a cat that is settled (in body lengths: the tip of its tail) may be over the edge of the screen before it turns round or steps in. */
const EDGE_SLACK = 0.12;
/**
 * What the best place on the shelf a cat is on still hides (of the words and the zones, in body-lengths squared) for it to look for a place on another shelf, and
 * the most that place may hide, at most this share of the first: a tenth of a name is a paw's breadth, and a cat does not walk off for that.
 */
const UNTIDY = 0.1;
const CLEAN = 0.04;
const CLEANER = 0.4;

const label = (act: Act): string =>
  act.k === "rest" ? `rest:${act.pose}` : act.k === "shot" ? `shot:${act.clip}` : act.k === "fade" ? (act.to === 0 ? "fade:out" : "fade:in") : act.k === "walk" && act.stalk ? "stalk" : act.k;
const centre = (rect: Rect): Vec => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

export class CatEngine {
  /** The frame to draw. The same object every time, updated in place. */
  readonly frame: CatFrame;
  readonly mood: Mood = { sleepiness: 0.1, energy: 0.35, affection: 0.2, curiosity: 0.3 };
  private readonly rng: Rng;
  private readonly rngLook: Rng;
  private now = 0;
  private events: CatEvent[] = [];
  private act: Act | null = null;
  private actT = 0;
  private queue: Act[] = [];
  private world: World | null = null;
  private ledges: Ledge[] = [];
  private mode: World["mode"] | "boot" = "boot";
  private surfaceId: string | null = null;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private facing: 1 | -1 = 1;
  private odometer = 0;
  private grounded = true;
  private alpha = 0;
  private alphaTarget: 0 | 1 = 0;
  private alphaRate = FADE_IN_RATE;
  private placed = false;
  private drowsy = 0;
  private clip: Clip = "stand";
  private clipT = 0;
  private progress = 0;
  private lookPoint: Vec | undefined;
  private viewer = false;
  private lookUntil = 0;
  private reach: Vec | undefined;
  private petUntil = -1;
  private petted = false;
  private lastInteraction = 0;
  private jump: JumpState | null = null;
  private cool: Record<string, number> = {};
  private history: string[] = [];
  private visited: Record<string, number> = {};
  private dismissed = false;
  private focusId: string | null = null;
  private lastFocusAt = -100;
  /** How long the cat has ridden a shelf that has no room for it, and how long it has stood where it should not (see keepOnLedge). */
  private rideT = 0;
  private overlapT = 0;
  /** The page has asked the cat to be away since it last kept to its shelf. */
  private wasAway = false;

  constructor(seed = 1) {
    this.rng = createRng(seed).fork("director");
    this.rngLook = createRng(seed).fork("look");
    this.frame = {
      x: 0,
      y: 0,
      facing: 1,
      clip: "stand",
      clipTime: 0,
      progress: 0,
      odometer: 0,
      vx: 0,
      vy: 0,
      grounded: true,
      viewer: false,
      drowsy: 0,
      energy: 0.35,
      appear: 0,
      petted: false,
    };
  }

  /** What the page tells the cat. Handled at the start of the next update. */
  send(event: CatEvent): void {
    this.events.push(event);
    if (this.events.length > 64) this.events.shift();
  }

  debug(): EngineDebug {
    return {
      act: this.act ? label(this.act) : "none",
      queue: this.queue.map(label),
      surfaceId: this.surfaceId,
      jumpTo: this.jump && !this.jump.landed ? this.jump.toSurface : null,
      ledges: this.ledges.length,
      mode: this.mode,
      placed: this.placed,
      mood: { ...this.mood },
      now: this.now,
    };
  }

  /* ------------------------------ the frame ------------------------------ */

  update(world: World, dtRaw: number): CatFrame {
    const dt = clamp(finite(dtRaw), 0, 0.1);
    this.now += dt;
    if (world !== this.world) {
      this.world = world;
      this.ledges = computeLedges(world).filter((ledge) => (world.mode === "player" ? ledge.kind === "playerPerch" : ledge.kind !== "playerPerch"));
    }
    this.handleEvents(world);
    this.followMode(world);
    this.drift(dt);
    if (!this.placed) {
      this.alpha = 0;
      this.alphaTarget = 0;
      // (without a place the cat only waits for one: a rest or a sleep it was handed would be one that nothing ever ends)
      if (this.act && this.act.k !== "relocate" && this.act.k !== "fade") this.act = null;
    } else {
      // (a cat that is on the page and not on its way out is coming into sight: a plan that took the place of its fade in, say, does not leave it unseen)
      if (this.alphaTarget === 0 && !this.dismissed && world.mode !== "away" && !this.leaving()) {
        this.alphaTarget = 1;
        this.alphaRate = FADE_IN_RATE;
      }
      if (this.alphaTarget === 1 && this.alpha < 1) this.alpha = Math.min(1, this.alpha + dt * this.alphaRate);
      else if (this.alphaTarget === 0 && this.alpha > 0) this.alpha = Math.max(0, this.alpha - dt * this.alphaRate);
    }

    if (this.placed) this.keepOnLedge(world, dt);
    if (!this.act) this.next(world);
    if (this.act) this.runAct(world, dt);
    // (what comes next starts in the same frame, not a frame late: a leap cut short, say, goes straight to the cat fading out)
    if (!this.act && this.queue.length > 0) {
      this.next(world);
      if (this.act) this.runAct(world, 0);
    }

    this.updateLook(world);
    this.petted = this.now < this.petUntil;
    return this.fill();
  }

  private fill(): CatFrame {
    const f = this.frame;
    f.x = finite(this.x);
    f.y = finite(this.y);
    f.facing = this.facing;
    f.clip = this.clip;
    f.clipTime = this.clipT;
    f.progress = this.progress;
    f.odometer = this.odometer;
    f.vx = finite(this.vx);
    f.vy = finite(this.vy);
    f.grounded = this.grounded;
    f.viewer = this.viewer;
    if (this.lookPoint) f.look = this.lookPoint;
    else delete f.look;
    if (this.reach) f.reach = this.reach;
    else delete f.reach;
    f.drowsy = this.drowsy;
    f.energy = this.mood.energy;
    f.appear = this.placed ? this.alpha : 0;
    f.petted = this.petted;
    return f;
  }

  private setClip(clip: Clip): void {
    if (clip !== this.clip) {
      this.clip = clip;
      this.clipT = 0;
    }
  }

  /* ------------------------------ events ------------------------------ */

  /** On its way out of the page (fading away, or about to come back somewhere else): what the viewer does then does not change that. */
  private leaving(): boolean {
    return this.queueHas("relocate") || (this.act?.k === "fade" && this.act.to === 0);
  }

  private handleEvents(world: World): void {
    const events = this.events;
    this.events = [];
    // (a cat that the page has sent away, or that is on its way out, or that has no place on the page yet, is not there to be petted, called or told: what it
    // is given to do then would keep it from ever looking for a place)
    const unreachable = world.mode === "away" || this.leaving() || !this.placed;
    for (const event of events) {
      switch (event.type) {
        case "cat.disable":
          this.dismissed = true;
          this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }]);
          break;
        case "cat.enable":
          this.dismissed = false;
          break;
        case "cat.pet": {
          if (unreachable) break;
          this.lastInteraction = this.now;
          this.petUntil = this.now + 1.3;
          this.mood.affection = clamp01(this.mood.affection + 0.04);
          this.mood.sleepiness = Math.max(0, this.mood.sleepiness - 0.05);
          const busy = this.act?.k === "jump" || this.act?.k === "point" || this.act?.k === "fade" || this.act?.k === "relocate";
          if (!busy && this.act?.k !== "rest" && this.placed) this.hardPlan([{ k: "rest", pose: "sit", dur: 4 }]);
          break;
        }
        case "cat.petEnd":
          this.petUntil = Math.min(this.petUntil, this.now + 0.8);
          break;
        case "cat.call":
          if (unreachable) break;
          this.lastInteraction = this.now;
          this.dismissed = false;
          this.mood.energy = clamp01(this.mood.energy + 0.25);
          this.mood.affection = clamp01(this.mood.affection + 0.05);
          this.comeTo(world, event.at);
          break;
        case "cat.command":
          if (unreachable && event.command !== "away") break;
          this.lastInteraction = this.now;
          this.command(world, event.command);
          break;
        case "catalog.itemFocused":
          if (event.id !== this.focusId) {
            this.focusId = event.id;
            this.lastFocusAt = this.now;
            this.mood.curiosity = clamp01(this.mood.curiosity + 0.2);
            if (world.focus && this.act?.k !== "sleep") this.lookAt(centre(world.focus), 2.5);
          }
          break;
        case "cat.point":
          if (unreachable) break;
          this.lastInteraction = this.now;
          this.pointAt(world, event.targetId);
          break;
        case "player.play":
        case "player.resume":
          if (world.mode === "player" && !unreachable) this.hardPlan([{ k: "rest", pose: "loaf", dur: 2.5 }, { k: "sleep", dur: 600 }]);
          break;
        case "player.pause":
          if (world.mode === "player" && !unreachable) this.hardPlan([{ k: "rest", pose: "loaf", dur: 18 }, { k: "sleep", dur: 600 }]);
          break;
        case "player.ended":
          if (world.mode === "player" && !unreachable) this.hardPlan([{ k: "shot", clip: "stretch", dur: 2.4 }, { k: "rest", pose: "loaf", dur: 20 }]);
          break;
        default:
          break;
      }
    }
  }

  /** Replace the plan, unless the cat is in the air (it finishes its leap first). */
  private hardPlan(plan: Act[]): void {
    this.queue = plan;
    if (this.act && this.act.k !== "jump") this.act = null;
  }

  /** Out of the way at once (a menu has opened, the page is hidden, the viewer sent the cat away): even a leap in the air is cut short. */
  private vanish(plan: Act[]): void {
    if (this.act?.k === "jump") {
      this.jump = null;
      this.act = null;
      this.grounded = true;
      this.vx = 0;
      this.vy = 0;
      this.setClip("stand");
    }
    this.hardPlan(plan);
  }

  private command(world: World, command: "sit" | "sleep" | "play" | "away" | "come"): void {
    switch (command) {
      case "sit":
        this.hardPlan([{ k: "rest", pose: "sit", dur: 20 }]);
        break;
      case "sleep":
        this.hardPlan([{ k: "sleep", dur: 90 }]);
        break;
      case "away":
        this.dismissed = true;
        this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }]);
        break;
      case "come":
        this.dismissed = false;
        this.comeTo(world, world.pointer ?? (world.focus ? centre(world.focus) : undefined));
        break;
      case "play":
        this.mood.energy = 1;
        this.playPlan(world);
        break;
    }
  }

  /* ------------------------------ lifecycle and places ------------------------------ */

  private followMode(world: World): void {
    if (world.mode === this.mode) return;
    const previous = this.mode;
    this.mode = world.mode;
    if (previous === "boot") return;
    if (world.mode === "away") {
      this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }]);
    } else if (previous === "away" && this.placed && this.here()) {
      // the cat is where it was, and the page still has that place for it
      this.hardPlan([{ k: "fade", to: 1, rate: FADE_IN_RATE }]);
    } else {
      // a new scene (the film began or ended): out, to the new place, and in again
      this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: world.mode === "player" ? "perch" : "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
    }
  }

  private place(world: World, where: "home" | "perch"): boolean {
    const pool = this.ledges.filter((ledge) => (where === "perch" ? ledge.kind === "playerPerch" : ledge.kind !== "playerPerch"));
    if (pool.length === 0) return false;
    const L = world.bodyLength;
    const pick =
      where === "perch"
        ? pool[0]!
        : (this.rng.weighted(pool, (ledge) => ledge.weight * (1 + Math.min(2, (ledge.x1 - ledge.x0) / (4 * L)))) ?? pool[0]!);
    this.putAt(pick, where === "perch" ? (pick.x0 + pick.x1) / 2 : this.startOn(pick, world));
    return true;
  }

  /** Where on a ledge a cat that comes to it settles: of a few places in its middle half, the one where it covers the least of the words and the zones. */
  private startOn(ledge: Ledge, world: World): number {
    const L = world.bodyLength;
    let best = lerp(ledge.x0, ledge.x1, this.rng.range(0.25, 0.75));
    let bestCost = Infinity;
    for (let tries = 0; tries < 6; tries++) {
      const x = tries === 0 ? best : lerp(ledge.x0, ledge.x1, this.rng.range(0.15, 0.85));
      const cost = Math.max(settledCost("sit", 1, x, ledge.y, L, world), settledCost("sit", -1, x, ledge.y, L, world));
      if (cost < bestCost - 0.01 * L * L) {
        best = x;
        bestCost = cost;
      }
      if (bestCost === 0) break;
    }
    return best;
  }

  private putAt(ledge: Ledge, x: number): void {
    this.surfaceId = ledge.surfaceId;
    this.x = clampToLedge(ledge, x);
    this.y = ledge.y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.placed = true;
    this.rideT = 0;
    this.overlapT = 0;
    this.visited[ledge.surfaceId] = this.now;
  }

  /** Keep the cat's feet on the shelf it stands on, wherever the page has moved it, and get it out of the way of what has come. */
  private keepOnLedge(world: World, dt: number): void {
    if (world.mode === "away") {
      this.wasAway = true;
      return;
    }
    if (!this.grounded) return;
    // (not while leaping, but when the leap has landed and is only settling; nor while on the way out to come back somewhere else)
    if ((this.act?.k === "jump" && !this.jump?.landed) || this.queueHas("relocate") || (this.act?.k === "fade" && this.act.to === 0)) return;
    const L = world.bodyLength;
    const vp = world.viewport;
    const here = this.surfaceId ? ledgeAt(this.ledges, this.surfaceId, this.x) : undefined;
    if (!here) {
      // the shelf has no room for a cat any more (it is scrolling out from under the top bar, or off the screen): the cat goes with it for a
      // moment, as anything on the shelf would, and then makes its way off
      const shelf = this.surfaceId ? world.surfaces.find((s) => s.id === this.surfaceId) : undefined;
      if (shelf && this.rideT < RIDE && this.x >= shelf.x0 && this.x <= shelf.x1 && shelf.y >= vp.y && shelf.y <= vp.y + vp.h + 0.9 * L && !this.isUnseen(world)) {
        this.rideT += dt;
        this.y = shelf.y;
        return;
      }
      this.leaveGone(world);
      return;
    }
    this.rideT = 0;
    // (the cat does not follow its shelf while the page has asked it to be away: if the shelf is somewhere else when that is over, the cat is
    // there, having faded in again, and is not seen crossing the screen)
    if (this.wasAway && Math.abs(here.y - this.y) > 0.3 * L) this.alpha = 0;
    this.wasAway = false;
    this.y = here.y;
    const to = clampToLedge(here, this.x);
    const gap = Math.abs(to - this.x);
    // standing in something it should keep out of (any part of the cat as it is drawn now: the tail on the ground too), for too long: it goes elsewhere
    // (a cat that has settled keeps its tail and its nose on the screen, too: put back at the end of a shelf by a window made smaller, say, it would lie with its tail off the edge)
    const act = this.act;
    const settled = act !== null && (act.k === "rest" || act.k === "sleep" || (act.k === "shot" && !act.at));
    const zones = settled ? [...world.keepOut, ...screenEdges(vp, L, EDGE_SLACK)] : world.keepOut;
    const inside = zones.some((zone) => shapeHits(this.clip, this.facing, this.x, this.y, L, zone));
    if (gap > 0 || inside) this.overlapT += dt;
    else this.overlapT = 0;
    if (inside && gap === 0 && this.overlapT > ASIDE && act?.k !== "walk") {
      // (a tail over a button or over the edge of the screen is on the other side when the cat faces the other way: it turns round, as a cat settling will)
      const other: 1 | -1 = this.facing > 0 ? -1 : 1;
      if (!zones.some((zone) => shapeHits(this.clip, other, this.x, this.y, L, zone))) {
        this.facing = other;
        this.overlapT = 0;
        return;
      }
      // (something has come up where the cat is, and the shelf has room for it a little way off: it steps there, as a cat would, rather than go)
      if (!world.reducedMotion && !world.quiet) {
        const free = this.clearSpot(zones, here, L);
        if (free !== undefined) {
          this.overlapT = 0;
          this.hardPlan([{ k: "walk", x: free, run: false, maxT: 12 }]);
          return;
        }
      }
    }
    if (this.overlapT > OVERLAP) {
      this.overlapT = 0;
      this.leaveGone(world);
      return;
    }
    if (gap < Math.max(1.5, 0.08 * L) || this.isUnseen(world)) {
      // (a nudge too small to be seen, or a cat that the window being made smaller left outside the screen: put back without a walk)
      this.x = to;
    } else if (gap > 2.5 * L || world.reducedMotion) {
      // too far to walk (the window was made smaller, the shelf moved away), or the viewer wants no walking about: it goes, and comes back
      this.leaveGone(world);
    } else if (this.act?.k !== "walk") {
      // something has come up where the cat stands: it steps out of its way, briskly, and a little further than it has to, rather than stand in it
      const away = clamp(to + Math.sign(to - this.x) * 0.5 * L, here.x0, here.x1);
      this.hardPlan([{ k: "walk", x: away, run: gap > 1.2 * L, maxT: 12 }]);
    }
  }

  /** The nearest place on the ledge where the cat, as it is drawn now, keeps clear of every zone (facing the way it would walk there), if there is one near. */
  private clearSpot(zones: readonly Rect[], ledge: Ledge, L: number): number | undefined {
    const sides: Array<1 | -1> = [this.facing, this.facing > 0 ? -1 : 1];
    for (let d = 0.1; d <= 4; d += 0.1) {
      for (const dir of sides) {
        const x = this.x + dir * d * L;
        if (x < ledge.x0 || x > ledge.x1) continue;
        if (!zones.some((zone) => shapeHits(this.clip, dir, x, ledge.y, L, zone))) return x;
      }
    }
    return undefined;
  }

  /** Whether no part of the cat is on the screen. */
  private isUnseen(world: World): boolean {
    const vp = world.viewport;
    const L = world.bodyLength;
    const half = HALF_WIDTH * L;
    return this.x < vp.x - half || this.x > vp.x + vp.w + half || this.y > vp.y + vp.h + 0.9 * L || this.y < vp.y;
  }

  /** The cat is wholly off the screen: nobody sees it go, and it is somewhere else when it can next be seen. */
  private slipAway(world: World): void {
    this.alpha = 0;
    this.alphaTarget = 0;
    this.vanish([{ k: "relocate", where: world.mode === "player" ? "perch" : "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
  }

  /** The shelf is gone, or has no room for a cat any more: leap to another, or fade out and come back somewhere else. */
  private leaveGone(world: World): void {
    // (already on the way out: fading to come back somewhere else)
    if (this.queueHas("relocate")) return;
    if (this.isUnseen(world)) {
      this.slipAway(world);
      return;
    }
    if (this.alpha > 0.05 && this.ledges.length > 0 && !world.reducedMotion && !world.quiet) {
      const target = this.nearestReachable(world);
      if (target) {
        this.hardPlan([{ k: "jump", toSurface: target.surfaceId, toX: clampToLedge(target, this.x) }]);
        return;
      }
    }
    this.hardPlan([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: world.mode === "player" ? "perch" : "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
  }

  private queueHas(k: Act["k"]): boolean {
    return this.queue.some((act) => act.k === k) || this.act?.k === k;
  }

  private nearestReachable(world: World): Ledge | undefined {
    const L = world.bodyLength;
    let best: Ledge | undefined;
    let bestD = Infinity;
    for (const ledge of this.ledges) {
      const x = clampToLedge(ledge, this.x);
      // (not the place it is already at)
      if (Math.abs(x - this.x) < 0.8 * L && Math.abs(ledge.y - this.y) < 0.8 * L) continue;
      if (!planJump(this.x, this.y, x, ledge.y, L)) continue;
      const d = Math.abs(ledge.y - this.y) + Math.abs(x - this.x);
      if (d < bestD) {
        best = ledge;
        bestD = d;
      }
    }
    return best;
  }

  /* ------------------------------ mood ------------------------------ */

  private drift(dt: number): void {
    const m = this.mood;
    const idle = this.now - this.lastInteraction;
    const sleeping = this.act?.k === "sleep";
    m.sleepiness = clamp01(m.sleepiness + dt * (sleeping ? -0.025 : idle > 30 ? 1 / 260 : 1 / 900));
    m.energy = clamp01(m.energy + (0.32 - m.energy) * Math.min(1, dt / 25));
    m.curiosity = clamp01(m.curiosity + (0.28 - m.curiosity) * Math.min(1, dt / 40));
    m.affection = clamp01(m.affection + (0.2 - m.affection) * Math.min(1, dt / 240));
    const goal = sleeping ? 1 : this.petted ? 0.1 : 0;
    this.drowsy = clamp01(this.drowsy + clamp(goal - this.drowsy, -dt * 0.9, dt * 0.3));
    this.clipT += dt;
  }

  /* ------------------------------ looking ------------------------------ */

  private lookAt(point: Vec, seconds: number): void {
    this.lookPoint = point;
    this.viewer = false;
    this.lookUntil = this.now + seconds;
  }

  private updateLook(world: World): void {
    if (this.act?.k === "sleep" || !this.placed || this.alpha <= 0.02) {
      this.lookPoint = undefined;
      this.viewer = false;
      return;
    }
    if (this.act?.k === "point") return;
    if (this.petted) {
      this.viewer = !world.pointer;
      this.lookPoint = world.pointer;
      this.lookUntil = this.now + 1;
      return;
    }
    if (this.now < this.lookUntil) return;
    const r = this.rngLook;
    this.viewer = false;
    this.lookPoint = undefined;
    if (this.act?.k === "walk" || this.act?.k === "jump") {
      this.lookUntil = this.now + r.range(0.8, 2);
      return;
    }
    const target = world.targets.length > 0 ? r.pick(world.targets) : undefined;
    const roll = r.next();
    if (roll < 0.22 && this.now - (this.cool.viewer ?? -100) > 12) {
      this.viewer = true;
      this.cool.viewer = this.now;
    } else if (roll < 0.5 && world.focus) this.lookPoint = centre(world.focus);
    else if (roll < 0.72 && target) this.lookPoint = centre(target.rect);
    else if (roll < 0.84 && world.pointer) this.lookPoint = world.pointer;
    this.lookUntil = this.now + r.range(1.3, 4.2);
  }

  /* ------------------------------ going places ------------------------------ */

  private here(): Ledge | undefined {
    return this.surfaceId ? ledgeAt(this.ledges, this.surfaceId, this.x) : undefined;
  }

  /** The acts that take the cat from where it stands to `x` on another ledge (or this one): walks along ledges, leaps between them. */
  private routeTo(world: World, to: Ledge, x: number, run: boolean): Act[] | null {
    const from = this.here();
    if (!from) return null;
    const path = findPath(this.ledges, from, this.x, to, x, world.bodyLength);
    if (!path) return null;
    const plan: Act[] = [];
    let cursor = from;
    for (const hop of path) {
      plan.push({ k: "walk", x: hop.takeoffX, run, maxT: 30 });
      plan.push({ k: "jump", toSurface: hop.ledge.surfaceId, toX: hop.landX });
      cursor = hop.ledge;
    }
    plan.push({ k: "walk", x: clampToLedge(cursor, x), run, maxT: 30 });
    return plan;
  }

  /**
   * The way to a place on another shelf, a leap or two off, where a cat settled in `pose` hides much less than `than` of the words and the zones (at most `CLEANER` of
   * it, and no more than `CLEAN` of a body-square): the cleanest place there is that it can get to, or none. The floor of a page with no shelves is not a place to
   * settle.
   */
  private cleanerPlace(world: World, pose: RestPose | readonly RestPose[], than: number): Act[] | null {
    const here = this.here();
    if (!here) return null;
    const L = world.bodyLength;
    const found: Array<{ ledge: Ledge; x: number; cost: number }> = [];
    for (const ledge of this.ledges) {
      if (ledge.surfaceId === here.surfaceId || ledge.kind === "fallbackFloor" || ledge.kind === "playerPerch") continue;
      let best: { x: number; cost: number } | null = null;
      for (let x = ledge.x0 + 0.4 * L; x <= ledge.x1 - 0.4 * L; x += 0.3 * L) {
        const cost = Math.max(settledCost(pose, 1, x, ledge.y, L, world), settledCost(pose, -1, x, ledge.y, L, world));
        if (!best || cost < best.cost) best = { x, cost };
      }
      if (best && best.cost <= Math.min(CLEAN * L * L, CLEANER * than)) found.push({ ledge, ...best });
    }
    found.sort((a, b) => a.cost - b.cost);
    for (const one of found.slice(0, 4)) {
      if (findPath(this.ledges, here, this.x, one.ledge, one.x, L, 2) === null) continue;
      const plan = this.routeTo(world, one.ledge, one.x, false);
      if (plan) return plan;
    }
    return null;
  }

  private comeTo(world: World, at: Vec | undefined): void {
    if (!this.placed || this.ledges.length === 0) return;
    if (world.reducedMotion || world.mode !== "browse") {
      this.hardPlan([{ k: "rest", pose: "sit", dur: 8 }]);
      return;
    }
    const goal = at ?? world.pointer ?? { x: world.viewport.x + world.viewport.w / 2, y: world.viewport.y + world.viewport.h };
    let best: Ledge | undefined;
    let bestD = Infinity;
    for (const ledge of this.ledges) {
      const d = Math.abs(clampToLedge(ledge, goal.x) - goal.x) + Math.abs(ledge.y - goal.y) * 1.2;
      if (d < bestD) {
        best = ledge;
        bestD = d;
      }
    }
    const plan = best ? this.routeTo(world, best, clampToLedge(best, goal.x), true) : null;
    this.hardPlan([...(plan ?? []), { k: "rest", pose: "sit", dur: 8 }]);
  }

  private pointAt(world: World, targetId: string): void {
    const target = world.targets.find((one) => one.id === targetId);
    if (!target || !this.placed || world.mode !== "browse") return;
    const cx = target.rect.x + target.rect.w / 2;
    // the ledge nearest the poster that is not above it, and the place on it nearest the poster
    const near = this.ledges
      .filter((ledge) => ledge.y >= target.rect.y - 4)
      .sort((a, b) => Math.abs(a.y - target.rect.y) - Math.abs(b.y - target.rect.y) || Math.abs(clampToLedge(a, cx) - cx) - Math.abs(clampToLedge(b, cx) - cx))[0];
    // (briskly: somebody is waiting to be shown it)
    const plan = !world.reducedMotion && near ? (this.routeTo(world, near, clampToLedge(near, cx), true) ?? []) : [];
    this.hardPlan([...plan, { k: "point", target: target.rect, dur: 5 }, { k: "rest", pose: "sit", dur: 4 }]);
  }

  private playPlan(world: World): void {
    if (world.reducedMotion || world.mode !== "browse") {
      this.hardPlan([{ k: "rest", pose: "sit", dur: 4 }]);
      return;
    }
    const plan: Act[] = [];
    const L = world.bodyLength;
    let at: Ledge | undefined = this.here();
    let x = this.x;
    if (!at) return;
    for (let i = 0; i < 3; i++) {
      const from: Ledge = at;
      const options: Ledge[] = this.ledges.filter((ledge) => ledge.id !== from.id && findPath(this.ledges, from, x, ledge, (ledge.x0 + ledge.x1) / 2, L, 1) !== null);
      const to: Ledge | undefined = this.rng.pick(options);
      if (!to) break;
      const landX = lerp(to.x0, to.x1, this.rng.range(0.2, 0.8));
      const path = findPath(this.ledges, from, x, to, landX, L, 1);
      if (!path) break;
      for (const hop of path) {
        plan.push({ k: "walk", x: hop.takeoffX, run: true, maxT: 30 });
        plan.push({ k: "jump", toSurface: hop.ledge.surfaceId, toX: hop.landX });
      }
      // (a leap lands as near as it can; it runs on to the place it chose)
      plan.push({ k: "walk", x: landX, run: true, maxT: 30 });
      at = to;
      x = landX;
    }
    this.hardPlan([...plan, { k: "rest", pose: "sit", dur: 5 }]);
  }

  /* ------------------------------ choosing what to do ------------------------------ */

  private next(world: World): void {
    if (this.queue.length > 0) {
      this.act = this.queue.shift()!;
      this.actT = 0;
      this.startAct(world);
      return;
    }
    if (world.mode === "away" || this.dismissed) return;
    if (!this.placed) {
      // the first time, and after the page had no place for a cat: come in
      if (this.ledges.length > 0 && this.place(world, world.mode === "player" ? "perch" : "home")) {
        this.alphaTarget = 1;
        this.alphaRate = FADE_IN_RATE;
        this.queue = [{ k: "rest", pose: "sit", dur: 3 }];
      }
      return;
    }
    if (this.alphaTarget === 0) {
      this.alphaTarget = 1;
      this.alphaRate = FADE_IN_RATE;
    }
    const plan = world.mode === "player" ? this.choosePlayer(world) : this.choose(world);
    this.act = plan.shift() ?? { k: "rest", pose: "sit", dur: 4 };
    this.queue = plan;
    this.actT = 0;
    this.startAct(world);
  }

  private startAct(world: World): void {
    const act = this.act;
    if (!act) return;
    switch (act.k) {
      case "fade":
        this.alphaTarget = act.to;
        this.alphaRate = act.rate;
        break;
      case "relocate":
        // (a cat that changes places is never seen doing it: what is left of it is gone)
        this.alpha = 0;
        if (!this.place(world, act.where)) this.placed = false;
        break;
      case "jump":
        this.startJump(world, act);
        break;
      case "point": {
        this.reach = centre(act.target);
        this.lookAt(this.reach, act.dur);
        if (Math.abs(this.reach.x - this.x) > 1) this.facing = this.reach.x > this.x ? 1 : -1;
        break;
      }
      case "walk":
        // (a cat that stalks has its eyes on what it stalks, all the way)
        if (act.stalk) this.lookAt(act.stalk, act.maxT);
        break;
      case "shot":
        if (act.at) {
          // (through the pounce that follows, too: the leap is a second or so)
          this.lookAt(act.at, act.dur + 1.2);
          if (Math.abs(act.at.x - this.x) > 1) this.facing = act.at.x > this.x ? 1 : -1;
        }
        break;
      default:
        break;
    }
    this.history.push(label(act));
    if (this.history.length > 8) this.history.shift();
  }

  /** In a film the cat is asleep on its perch; it wakes a little when the film is paused. */
  private choosePlayer(world: World): Act[] {
    if (world.player === "paused" || world.player === "loading" || world.player === "none") return [{ k: "rest", pose: "loaf", dur: 12 }];
    if (world.player === "ended" || world.player === "error") return [{ k: "rest", pose: "sit", dur: 20 }];
    return [{ k: "sleep", dur: 600 }];
  }

  private cooled(name: string): boolean {
    return this.now >= (this.cool[name] ?? 0);
  }

  private choose(world: World): Act[] {
    const L = world.bodyLength;
    const here = this.here();
    const m = this.mood;
    const roaming = !world.reducedMotion && !world.quiet;
    const idle = this.now - this.lastInteraction;
    const last = this.history[this.history.length - 1] ?? "";
    const tired = m.sleepiness;
    interface Option {
      name: string;
      score: number;
      plan: () => Act[] | null;
    }
    const options: Option[] = [];

    // (a cat that is going to settle for a while does it where its body does not cover the names under the cards, if the shelf has such a place; it only walks for it when it is free to roam)
    // (it faces the way it walks there: `from` is where it means to settle, and the spot is looked for round it)
    const settling = (pose: RestPose | readonly RestPose[], from = this.x, on: Ledge | undefined = here): Settling | undefined =>
      roaming && on ? settle(on, from, from === this.x ? this.facing : from > this.x ? 1 : -1, L, pose, world) : undefined;
    const spotFor = (pose: RestPose | readonly RestPose[], from = this.x, on: Ledge | undefined = here): number | undefined => settling(pose, from, on)?.x;
    // (and when even the best place of this shelf would hide a name, a cat that is free to roam, and has not just done it, goes to another shelf that has a better one, a leap or two off)
    const walkToSpot = (pose: RestPose | readonly RestPose[]): Act[] => {
      const found = settling(pose);
      if (found && found.cost > UNTIDY * L * L && this.cooled("relocate") && this.rng.chance(0.8)) {
        const away = this.cleanerPlace(world, pose, found.cost);
        if (away) {
          this.cool.relocate = this.now + this.rng.range(12, 25);
          return away;
        }
      }
      return found?.x === undefined ? [] : [{ k: "walk", x: found.x, run: false, maxT: 25 }];
    };
    // (a posture that the shelf has no room for, with the words as they are, is taken less: a cat lying out in front of a name when it could sit up between two)
    const roomFor = (pose: RestPose): number => 1 / (1 + (6 * (settling(pose)?.cost ?? 0)) / (L * L));
    // (and the one that was drawn gives way, when its best place would still hide a name, to a posture that would hide at most half as much: it lies down or gets up instead of sitting in front of the name)
    const cleanestPose = (pose: Pose, from = this.x, on: Ledge | undefined = here): Pose => {
      const cost = settling(pose, from, on)?.cost;
      if (cost === undefined || cost <= UNTIDY * L * L) return pose;
      let best = pose;
      let least = cost;
      for (const other of ["sit", "loaf", "stand"] as const) {
        const c = settling(other, from, on)?.cost;
        if (c !== undefined && c < 0.5 * least) {
          best = other;
          least = c;
        }
      }
      return best;
    };

    options.push({
      name: "rest",
      score: 1.0 + tired * 0.8,
      plan: () => {
        const pose = cleanestPose(this.rng.weighted<Pose>(["sit", "loaf", "stand"], (p) => (p === "sit" ? 0.5 : p === "loaf" ? 0.3 + tired * 0.4 : 0.2) * roomFor(p)) ?? "sit");
        return [...walkToSpot(pose), { k: "rest", pose, dur: this.rng.range(4, 12) }];
      },
    });

    if (here && roaming && here.x1 - here.x0 > 1.6 * L) {
      options.push({
        name: "wander",
        score: 0.95 * (0.4 + m.energy),
        plan: () => {
          for (let tries = 0; tries < 6; tries++) {
            const x = lerp(here.x0, here.x1, this.rng.range(0.05, 0.95));
            if (Math.abs(x - this.x) > 1.3 * L) {
              // (a cat that has walked somewhere often smells it before it settles)
              const sniff: Act[] = tired < 0.7 && this.rng.chance(0.4) ? [{ k: "shot", clip: "sniff", dur: this.rng.range(2.2, 3.4) }] : [];
              const pose: Pose = cleanestPose(this.rng.chance(0.6) ? "sit" : "stand", x);
              const dur = this.rng.range(2, 7);
              // (it stops where it was going, or a little off that if the names are there)
              return [{ k: "walk", x: spotFor(pose, x) ?? x, run: false, maxT: 40 }, ...sniff, { k: "rest", pose, dur }];
            }
          }
          return null;
        },
      });
    }

    if (here && roaming && this.ledges.length > 1) {
      options.push({
        name: "hop",
        score: this.cooled("hop") ? 0.8 * (0.3 + m.energy) : 0.05,
        plan: () => {
          const candidates = this.ledges
            .filter((ledge) => ledge.surfaceId !== here.surfaceId)
            .map((ledge) => {
              const x = lerp(ledge.x0, ledge.x1, this.rng.range(0.2, 0.8));
              const path = findPath(this.ledges, here, this.x, ledge, x, L, 2);
              return path ? { ledge, x, hops: path.length } : null;
            })
            .filter((c): c is { ledge: Ledge; x: number; hops: number } => c !== null);
          // (the shelves it has not been to lately are the more interesting)
          const pick = this.rng.weighted(candidates, (c) => c.ledge.weight / c.hops / (1 + 2 * Math.exp(-(this.now - (this.visited[c.ledge.surfaceId] ?? -1000)) / 40)));
          if (!pick) return null;
          const sits = this.rng.chance(0.65);
          const dur = this.rng.range(2, 6);
          const cool = this.rng.range(6, 14);
          // (it lands where it can settle clear of the names, the posture drawn giving way to a cleaner one if the shelf has no clean place for it: a landing at a chance place on a shelf of names is a few seconds in front of one)
          const pose = cleanestPose(sits ? "sit" : "stand", pick.x, pick.ledge);
          const spot = spotFor(pose, pick.x, pick.ledge) ?? pick.x;
          const plan = this.routeTo(world, pick.ledge, spot, false) ?? this.routeTo(world, pick.ledge, pick.x, false);
          if (!plan) return null;
          this.cool.hop = this.now + cool;
          plan.push({ k: "rest", pose, dur });
          return plan;
        },
      });
    }

    options.push({
      name: "groom",
      score: this.cooled("groom") && tired < 0.85 ? 0.55 : 0.02,
      plan: () => {
        this.cool.groom = this.now + this.rng.range(45, 90);
        return [{ k: "rest", pose: "sit", dur: 1.2 }, { k: "shot", clip: "groom", dur: this.rng.range(3.5, 6.5) }];
      },
    });
    options.push({
      name: "scratch",
      // (a busy little scene: not for a viewer who asked for quiet or for less motion)
      score: roaming && this.cooled("scratch") && tired < 0.85 ? 0.3 : 0,
      plan: () => {
        this.cool.scratch = this.now + this.rng.range(70, 140);
        return [{ k: "rest", pose: "sit", dur: 1 }, { k: "shot", clip: "scratch", dur: this.rng.range(3.2, 5) }];
      },
    });
    // a poster on this shelf, a few lengths off: stalked, low and slow, with a wiggle, and pounced on (it lands on it, and sits as if it meant to)
    if (here && roaming && world.targets.length > 0 && this.cooled("prowl")) {
      options.push({
        name: "prowl",
        score: 0.34 * (0.4 + m.energy) * (0.6 + m.curiosity),
        plan: () => {
          // (a poster a few lengths off, with the whole run-up and the landing on this stretch of the shelf, not off the end of it or under the bar)
          const inside = (x: number): boolean => x >= here.x0 && x <= here.x1;
          const prey = world.targets
            .filter((t) => t.surfaceId === here.surfaceId)
            .map((t) => ({ at: centre(t.rect), gap: Math.abs(centre(t.rect).x - this.x) }))
            .filter((t) => t.gap >= 3.2 * L && t.gap <= 5.6 * L)
            .filter((t) => inside(t.at.x - Math.sign(t.at.x - this.x) * 1.8 * L) && inside(t.at.x - Math.sign(t.at.x - this.x) * 0.2 * L));
          const one = this.rng.pick(prey);
          if (!one) return null;
          const dir: 1 | -1 = one.at.x > this.x ? 1 : -1;
          // (it creeps to a leap's length from it, and springs from there to just short of its middle)
          const from = clampToLedge(here, one.at.x - dir * 1.8 * L);
          const to = clampToLedge(here, one.at.x - dir * 0.2 * L);
          if (Math.abs(from - this.x) < 1.3 * L || !planJump(from, here.y, to, here.y, L)) return null;
          this.cool.prowl = this.now + this.rng.range(90, 160);
          const plan: Act[] = [
            { k: "walk", x: from, run: false, maxT: 25, stalk: one.at },
            { k: "shot", clip: "wiggle", dur: this.rng.range(1, 1.5), at: one.at },
            { k: "jump", toSurface: here.surfaceId, toX: to },
            { k: "rest", pose: "sit", dur: this.rng.range(1.5, 3) },
          ];
          // (as if it had meant to)
          if (this.rng.chance(0.5)) plan.push({ k: "shot", clip: "groom", dur: this.rng.range(2.5, 4) });
          return plan;
        },
      });
    }
    options.push({
      name: "stretch",
      score: this.cooled("stretch") ? 0.32 : 0.01,
      plan: () => {
        this.cool.stretch = this.now + this.rng.range(60, 120);
        return [{ k: "shot", clip: "stretch", dur: 2.6 }];
      },
    });
    options.push({
      name: "yawn",
      score: this.cooled("yawn") && tired > 0.3 ? 0.4 : 0.01,
      plan: () => {
        this.cool.yawn = this.now + this.rng.range(40, 80);
        return [{ k: "rest", pose: "sit", dur: 1 }, { k: "shot", clip: "yawn", dur: 2.8 }];
      },
    });
    options.push({
      name: "sleep",
      score: idle > 40 ? 0.08 + tired * 1.8 : 0.0,
      // (and before it lies down for good, a cat will often tread its place into shape; the place is chosen for all of it: lying down, treading, curled up)
      plan: () => {
        const tread = this.rng.chance(0.5);
        return [
          ...walkToSpot(tread ? ["loaf", "knead", "curl"] : ["loaf", "curl"]),
          { k: "rest", pose: "loaf", dur: 2.5 },
          ...(tread ? [{ k: "shot", clip: "knead", dur: this.rng.range(4, 7) } as const] : []),
          { k: "sleep", dur: this.rng.range(25, 70) },
          { k: "shot", clip: "stretch", dur: 2.4 },
        ];
      },
    });
    // a card has just been given the focus: the cat sits near it and watches
    if (here && roaming && this.now - this.lastFocusAt < 6 && world.focus && this.cooled("watch")) {
      options.push({
        name: "watch",
        score: 1.6 * (0.5 + m.curiosity),
        plan: () => {
          const f = world.focus!;
          const cx = f.x + f.w / 2;
          const x = clampToLedge(here, cx + (this.x < cx ? -1 : 1) * (f.w / 2 + 0.8 * L));
          this.cool.watch = this.now + this.rng.range(25, 50);
          return [{ k: "walk", x, run: false, maxT: 30 }, { k: "rest", pose: "sit", dur: this.rng.range(5, 10) }];
        },
      });
    }

    // (not the same thing twice in a row)
    const weighted = options.map((o) => ({ o, w: Math.max(0, o.score) * (last.startsWith(o.name) ? 0.35 : 1) }));
    for (let tries = 0; tries < 4; tries++) {
      const pick = this.rng.weighted(weighted, (c) => c.w);
      if (!pick) break;
      const plan = pick.o.plan();
      if (plan && plan.length > 0) return plan;
      pick.w = 0;
    }
    return [{ k: "rest", pose: "sit", dur: this.rng.range(3, 8) }];
  }

  /* ------------------------------ acts ------------------------------ */

  private finish(): void {
    this.act = null;
    this.actT = 0;
    this.progress = 0;
    this.reach = undefined;
  }

  private runAct(world: World, dt: number): void {
    const act = this.act!;
    this.actT += dt;
    if (this.actT > WATCHDOG) {
      this.jump = null;
      this.finish();
      return;
    }
    const L = world.bodyLength;
    switch (act.k) {
      case "fade":
        this.stop(dt, L);
        if (!this.placed || (act.to === 0 ? this.alpha <= 0.001 : this.alpha >= 0.999)) this.finish();
        break;
      case "relocate":
        this.finish();
        break;
      case "rest":
        this.stop(dt, L);
        this.setClip(act.pose);
        if (this.actT >= act.dur) this.finish();
        break;
      case "sleep":
        this.stop(dt, L);
        this.setClip("curl");
        if (this.actT >= act.dur) this.finish();
        break;
      case "shot":
        this.stop(dt, L);
        this.setClip(act.clip);
        this.progress = clamp01(this.actT / act.dur);
        if (this.actT >= act.dur) this.finish();
        break;
      case "point":
        this.stop(dt, L);
        this.setClip("point");
        if (this.actT >= act.dur) this.finish();
        break;
      case "walk":
        this.walk(world, act, dt);
        break;
      case "jump":
        this.runJump(world, dt);
        break;
    }
  }

  /** Come to a stop, if moving (a brake, not a halt). */
  private stop(dt: number, L: number): void {
    if (!this.grounded) return;
    if (Math.abs(this.vx) > 1) {
      this.vx += clamp(-this.vx, -dt * ACCEL * 1.5 * L, dt * ACCEL * 1.5 * L);
      this.x += this.vx * dt;
      this.odometer += Math.abs(this.vx) * dt;
      if (Math.abs(this.vx) < 4) this.vx = 0;
    } else this.vx = 0;
  }

  private walk(world: World, act: Extract<Act, { k: "walk" }>, dt: number): void {
    const L = world.bodyLength;
    const ledge = this.here();
    if (!ledge) {
      this.finish();
      return;
    }
    const goal = clampToLedge(ledge, act.x);
    const dist = Math.abs(goal - this.x);
    const dir: 1 | -1 = goal >= this.x ? 1 : -1;
    this.setClip(act.stalk ? "stalk" : act.run ? "run" : "walk");
    // a cat going one way that must go the other brakes first, then turns
    if (dir !== this.facing) {
      if (Math.abs(this.vx) > 0.25 * L) {
        this.stop(dt, L);
        return;
      }
      this.facing = dir;
    }
    const cruise = (act.stalk ? STALK_SPEED : act.run ? RUN_SPEED : WALK_SPEED) * L;
    const brake = Math.sqrt(2 * ACCEL * 0.7 * L * dist);
    const want = Math.min(cruise, brake) * dir;
    this.vx += clamp(want - this.vx, -dt * ACCEL * L, dt * ACCEL * L);
    let step = this.vx * dt;
    if (Math.abs(step) >= dist) {
      step = goal - this.x;
      this.vx = 0;
    }
    this.x += step;
    this.odometer += Math.abs(step);
    if (Math.abs(goal - this.x) < 0.03 * L || this.actT > act.maxT) {
      this.vx = 0;
      this.finish();
    }
  }

  private startJump(world: World, act: Extract<Act, { k: "jump" }>): void {
    const to = ledgeAt(this.ledges, act.toSurface, act.toX);
    const toX = to ? clampToLedge(to, act.toX) : 0;
    const plan = to ? planJump(this.x, this.y, toX, to.y, world.bodyLength) : null;
    if (!to || !plan) {
      // (the page has moved since this was planned: no longer a leap the cat can make)
      this.queue = [];
      this.finish();
      return;
    }
    const total = plan.flight / (JUMP_LANDING - JUMP_TAKEOFF);
    const source = this.surfaceId ? world.surfaces.find((s) => s.id === this.surfaceId) : undefined;
    this.jump = {
      plan,
      toSurface: to.surfaceId,
      crouch: total * JUMP_TAKEOFF,
      settle: total * (1 - JUMP_LANDING),
      crouchT: 0,
      settleT: 0,
      phase: 0,
      landed: false,
      fromSurface: source ? source.id : "",
      fromShelfY: source ? source.y : this.y,
      baseFromY: plan.fromY,
    };
    if (Math.abs(toX - this.x) > 1) this.facing = toX > this.x ? 1 : -1;
    this.vx = 0;
    this.visited[to.surfaceId] = this.now;
  }

  /**
   * The shelf the leap was aimed at is gone, or has moved out of reach, with the cat in the air: it comes down on the nearest shelf below
   * (a new arc from where it is), or, with none to come down on, it is gone from the page and back somewhere else.
   */
  private redirect(world: World, jump: JumpState): void {
    const L = world.bodyLength;
    let best: { ledge: Ledge; x: number } | undefined;
    for (const ledge of this.ledges) {
      const x = clampToLedge(ledge, this.x);
      if (ledge.y < this.y - 2 || Math.abs(x - this.x) > 1.2 * L || !planJump(this.x, this.y, x, ledge.y, L)) continue;
      if (!best || ledge.y < best.ledge.y) best = { ledge, x };
    }
    const plan = best ? planJump(this.x, this.y, best.x, best.ledge.y, L) : null;
    if (!best || !plan) {
      this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: world.mode === "player" ? "perch" : "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
      return;
    }
    jump.plan = plan;
    jump.toSurface = best.ledge.surfaceId;
    jump.fromSurface = "";
    jump.phase = 0;
    jump.crouchT = jump.crouch;
    jump.settle = (plan.flight / (JUMP_LANDING - JUMP_TAKEOFF)) * (1 - JUMP_LANDING);
  }

  private runJump(world: World, dt: number): void {
    const jump = this.jump;
    if (!jump) {
      this.finish();
      return;
    }
    const plan = jump.plan;
    const L = world.bodyLength;
    this.setClip("jump");
    if (!jump.landed) {
      // the shelf it took off from may be moving (the page scrolls): the take-off end of the arc goes with it
      const from = jump.fromSurface ? world.surfaces.find((s) => s.id === jump.fromSurface) : undefined;
      if (from) plan.fromY = jump.baseFromY + (from.y - jump.fromShelfY);
    }
    if (jump.crouchT < jump.crouch) {
      // crouching, with its feet where the shelf is
      jump.crouchT += dt;
      reshape(plan, L);
      this.progress = JUMP_TAKEOFF * clamp01(jump.crouchT / jump.crouch);
      this.grounded = true;
      this.y = plan.fromY;
      this.vx = 0;
      this.vy = 0;
      if (this.isUnseen(world)) this.slipAway(world);
      return;
    }
    if (!jump.landed) {
      const target = ledgeAt(this.ledges, jump.toSurface, plan.toX);
      const aim = target ? clampToLedge(target, plan.toX) : plan.toX;
      if (target && planJump(plan.fromX, plan.fromY, aim, target.y, L)) {
        // the place being aimed for may move (the page scrolls, a card takes the focus): the landing end of the arc follows it, without a lurch
        const reach = 5 * L * dt;
        plan.toX += clamp(aim - plan.toX, -reach, reach);
        plan.toY = target.y;
        reshape(plan, L);
      } else {
        this.redirect(world, jump);
        return;
      }
      const step = stepFlight(plan, jump.phase, dt, L);
      jump.phase = step.phase;
      this.progress = JUMP_TAKEOFF + (JUMP_LANDING - JUMP_TAKEOFF) * step.s;
      if (!step.done) {
        this.x = step.x;
        this.y = step.y;
        this.vx = step.vx;
        this.vy = step.vy;
        this.grounded = false;
        this.odometer += Math.abs(step.vx) * dt;
        if (this.isUnseen(world)) this.slipAway(world);
        return;
      }
      // touchdown
      jump.landed = true;
      const down = ledgeAt(this.ledges, jump.toSurface, plan.toX);
      if (down) this.surfaceId = down.surfaceId;
      this.x = plan.toX;
      this.y = down ? down.y : plan.toY;
      this.grounded = true;
      this.vx = 0;
      this.vy = 0;
    }
    // settling (the rest of the clip): keepOnLedge keeps the feet on the shelf it landed on, which may be moving
    jump.settleT += dt;
    this.progress = JUMP_LANDING + (1 - JUMP_LANDING) * clamp01(jump.settleT / jump.settle);
    if (jump.settleT >= jump.settle) {
      this.jump = null;
      this.finish();
    }
  }
}
