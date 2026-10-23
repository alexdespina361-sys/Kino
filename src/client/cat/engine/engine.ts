import { clamp, clamp01, finite, lerp } from "../math";
import { createRng, type Rng } from "../rng";
import { JUMP_LANDING, JUMP_TAKEOFF, type CatEvent, type CatFrame, type Clip, type Emote, type Rect, type Target, type Vec, type World } from "../types";
import { clampToLedge, computeLedges, findPath, GRAVITY, ledgeAt, planJump, reshape, screenEdges, settle, settledCost, stepFlight, type JumpPlan, type Ledge, type RestPose, type Settling } from "./ledges";
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
  /** `at`: what it looks at while it rests (the picture of a film, from its perch). `viewer`: it looks out of the screen, at whoever is there, for the first of it. */
  | { k: "rest"; pose: Pose; dur: number; at?: Vec; feel?: Emote; viewer?: boolean }
  | { k: "sleep"; dur: number }
  /** `stalk`: creeping, low and slow, at the thing it is stalking (the point it looks at). `look`: what it keeps its eyes on, going (where it is going next). */
  | { k: "walk"; x: number; run: boolean; maxT: number; stalk?: Vec; look?: Vec }
  | { k: "jump"; toSurface: string; toX: number }
  /** A hand has it by the scruff (see `grab`); it is in the air until the hand lets go, and then it falls (`fall`) to the place it will land. */
  | { k: "carried" }
  | { k: "fall" }
  /** A little scene with a length of its own; `at` is what the cat looks at while it lasts. */
  | { k: "shot"; clip: "stretch" | "yawn" | "groom" | "scratch" | "knead" | "sniff" | "wiggle" | "peek" | "doze" | "shift"; dur: number; at?: Vec }
  | { k: "point"; target: Rect; dur: number; id?: string }
  /** One swat at a poster the cat found for the viewer (`id`: the page's own name for it, which is looked for again where it is by then; `target`: where it was when the cat set out). */
  | { k: "swat"; target: Rect; dur: number; id?: string }
  /** Batting at what the pointer is over (it follows the pointer, while it is near; `at` is where it was when the cat began). */
  | { k: "tap"; at: Vec; dur: number };

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

/** A cat that is falling (see `CatEngine.runFall`): where it is to come down, how fast it is going, whether it has, and how long it has been settling since. */
interface FallState {
  toSurface: string;
  toX: number;
  vy: number;
  landed: boolean;
  settleT: number;
  placeY: number;
  missed: boolean;
  /** Shaken off a shelf by a page that is flung: it has no place it is falling to yet (see `freeFall`). */
  free: boolean;
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
  /** What the cat last chose to do of its own accord, by the name of the thing ("pat", "zoomies", "ponder"...), and "" before it has chosen anything. */
  choice: string;
  /** The poster it is waiting to be able to set out for (it was asked while in the air, say), if it is. */
  pending: string | null;
  /** It was shaken off its shelf by a page that was flung, and has not come down on anything yet (see `SHAKE_SPEED`). */
  flung: boolean;
  /** How fast the page is scrolled just now, in body lengths a second (down the screen positive). */
  scroll: number;
  /** How many readings of the page in a row were fast enough to shake the cat off (see SHAKE_SPEED). */
  fast: number;
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
/**
 * Being carried (all in body lengths unless it says otherwise): where the cat's feet hang from the hand once it hangs by the scruff (below it, and a little
 * further the way it faces: the scruff is behind the middle of the hanging cat, as the drawn pose has it), how fast the hang settles from wherever the hand took it
 * (a second's reciprocal), the fastest the hand can take it along and how quickly it follows (the cat lags behind a hand that flicks), and how long a silent hand
 * (a pointer that was lost) holds it before it is let go (seconds).
 */
export const HANG_DOWN = 0.73;
export const HANG_AHEAD = 0.1;
const HANG_RELAX = 7;
const CARRY_SPEED = 16;
const CARRY_FOLLOW = 16;
const CARRY_SILENCE = 2.5;
/**
 * Letting go: the cat comes down on the first place under it, or springs up onto one that is a little above its feet (the hang puts its paws below the line
 * of the shelf it was taken from) -- at most this far above, and at most this far across, steered to as it falls at `FALL_STEER` a second, no faster than
 * `FALL_FASTEST` (air is not nothing to a cat); and settles for `FALL_SETTLE` seconds after the landing.
 */
const SPRING = 0.6;
const FALL_ACROSS = 3;
const FALL_STEER = 4;
const FALL_FASTEST = 14;
const FALL_SETTLE = 0.32;
/**
 * What the cat makes of the page around it (body lengths, and seconds): a drop of this much or more is looked over before the cat goes down it, and a climb of
 * this much is measured (a wiggle, as a cat does); a pointer that goes faster than `FLINCH_SPEED` (body lengths a second) within `FLINCH_NEAR` of the cat makes it
 * flinch, and not again for a while; a pointer that rests (slower than `PLAY_STILL`, for `PLAY_STILL_FOR`) within `PLAY_REACH` of it, up at the height of its head, is
 * something to bat at.
 */
const PEEK_DROP = 1.3;
const MEASURE_CLIMB = 1.1;
/**
 * Swatting at the poster it found for the viewer (body lengths and seconds): how far ahead of its middle its paw lands (so it stands that far before the poster's middle), how far
 * before that it begins to creep up on it, and how long its two swats take (the second a little quicker).
 */
const SWAT_REACH = 0.62;
/** How far (body lengths) a ledge may be above or below the line of a poster's top and still be along its shelf, and how far short of the poster a paw may fall and still count as on it. */
const SAME_SHELF = 0.3;
const SWAT_MISS = 0.2;
const CREEP = 0.9;
const SWAT_FIRST = 1.45;
const SWAT_SECOND = 1.25;
/**
 * A cat asked to show a poster while it cannot set out (it is in the air, in a hand, or fading out to come back elsewhere, or the shelf it stood on has just gone from under it, as
 * a page scrolled to the poster takes it) sets out when it can, if that is within this many seconds; and a shelf that is gone, with another where the cat's feet are (within this
 * many body lengths of them), is exchanged for that one, and not left by a leap. (The cat is set on the new shelf in a frame, so the distance is kept under what the fastest of its
 * own movements covers in a frame of a fast screen: 18 body lengths a second is 0.3 of one at 60 frames.)
 */
const POINT_WAIT = 8;
const ADOPT = 0.25;
/**
 * A row of posters that is scrolled under the cat carries it with them (the cat is on them) until it has been carried this far (body lengths), and then it hops back to where it
 * was, or away to another shelf (this share of the times); the shortest time between two such hops, and how long the posters must be still before the carrying is forgotten. A
 * shelf that is itself scrolled out of the room the cat has is left at once, and not after the `RIDE` a shelf that is only still is.
 */
const CARRIED_FAR = 1.2;
const CARRIED_AWAY = 0.35;
const CARRIED_EVERY = 1.4;
const CARRIED_FORGET = 0.6;
const RIDE_MOVING = 0.12;
/** How fast the cat is carried the way the posters have slid (a share of what is left, for every second): the page is read a few times a second, and the carrying is eased in between. */
export const RIDE_EASE = 22;
/**
 * A page that is flung (its shelves going by faster than `SHAKE_SPEED` body lengths a second, in `SHAKE_READINGS` readings of the page one after the other) does not take the cat up with the
 * shelf it sits on: the cat is shaken off it and falls, in front of the page that goes by (so that, with the page still flying, it seems to hang there as it comes down). It comes down on the first
 * place under it once the page has slowed to `CATCH_SPEED`, or on the foot of the screen, which it is handed to when it is within `HANDOVER` body lengths of it (or has been falling for
 * `FREE_FALL_MAX` seconds). A speed is worked out between two readings of the page at least `SCROLL_SPAN` seconds apart (nearer than that, they are too near to tell a speed from), and a page that
 * has not been read again for `SCROLL_STILL` seconds is thought to be still.
 * (What the library's rows really do, in a browser, at the top of a step, in body lengths a second: one key of the remote 26 to 30, a wheel spun fast 32, three keys in quick succession 36, a page
 * key 72, a key held down 85, so that a step of the remote or a wheel takes the cat with its shelf, and a held key or a flung page does not.)
 */
const SHAKE_SPEED = 40;
const SHAKE_READINGS = 2;
const CATCH_SPEED = 8;
const HANDOVER = 2.2;
const FREE_FALL_MAX = 3;
const SCROLL_SPAN = 0.012;
const SCROLL_STILL = 0.15;
/** How far through a leap's way down the cat is drawn while it is in free fall: the legs reaching down (see `runFall`). */
const FREE_FALL_POSE = 0.62;
const FLINCH_SPEED = 9;
const FLINCH_NEAR = 1.7;
const FLINCH_EVERY = 25;
const PLAY_STILL = 2.5;
const PLAY_STILL_FOR = 0.6;
const PLAY_REACH = 2.6;

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
  /** Where the hand that carries the cat has hold of it, when one does; where its feet hang from that (as it is now: it eases into the hang); when the hand last said anything. */
  private hold: Vec | null = null;
  private hangX = 0;
  private hangY = 0;
  /** How far below the hand the feet were, and how high, when the hand took hold; and where the hand was. */
  private hangY0 = 0;
  private groundY = 0;
  private grabAt: Vec = { x: 0, y: 0 };
  private heldAt = 0;
  /**
   * A cat that was let go of, on its way down to where it will land (see `runFall`); or, with `free`, one that a flung page shook off its shelf, and that has no place it is falling to yet
   * (see `freeFall`).
   */
  private fall: FallState | null = null;
  /** What it feels (see `Emote`) and until when. */
  private emote: Emote = "none";
  private emoteUntil = 0;
  /** The pointer, as the cat has watched it: where it was, how fast it is going (body lengths a second, smoothed) and for how long it has been slow. */
  private pointerPrev: Vec | null = null;
  private pointerSpeed = 0;
  private pointerStill = 0;
  /** A film's cat has nodded off once (it does not watch the film all over again every time it wakes). */
  private dozed = false;
  /**
   * A row of posters that is scrolled under the cat (see `rideRow`): the posters as they were at the last frame, how far they have still to carry the cat (pixels, eased in over a few
   * frames), how far they have carried it since it last hopped, and for how long they have been still.
   */
  private seenTargets: readonly Target[] | null = null;
  private rowPending = 0;
  private rowRide = 0;
  private rowStillT = 0;
  /** How many times a swat has sent the cat back to where it should stand by the poster (the page moved it since the cat set out): at most twice for one trip. */
  private swatFixes = 0;
  /** The poster the cat was asked to show when it could not set out, and the time (the engine's own clock) it is no longer wanted after (see `pointAt`). */
  private pendingPoint: { id: string; until: number } | null = null;
  private choice = "";
  /** Where the shelf the cat stands on was at the last frame (to see that it is moving: the page is scrolled). */
  private shelfY = Number.NaN;
  /**
   * How fast the page is scrolled (pixels a second, down the screen positive), as worked out between two readings of it (`measureScroll`): the page as it was at the last reading used, when that
   * was, how big the screen was, whether the page is thought still, and how many readings in a row were fast.
   */
  private scrollSpeed = 0;
  private scrollWorld: World | null = null;
  private scrollRead: number | undefined;
  private scrollAt = 0;
  private scrollShelves = new Map<string, number>();
  private scrollSize = "";
  private scrollStill = true;
  private fastRun = 0;

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
      carried: false,
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
      choice: this.choice,
      pending: this.pendingPoint?.id ?? null,
      flung: this.fall?.free === true && !this.fall.landed,
      scroll: this.world ? this.scrollSpeed / this.world.bodyLength : 0,
      fast: this.fastRun,
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
    this.watchPointer(world, dt);
    this.drift(dt);
    if (this.emote !== "none" && this.now >= this.emoteUntil) this.emote = "none";
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

    this.measureScroll(world);
    if (this.placed) {
      this.rideRow(world, dt);
      this.keepOnLedge(world, dt);
    }
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
    f.carried = this.hold !== null && this.act?.k === "carried";
    f.emote = this.emote;
    return f;
  }

  /** What it feels, for this long (see `Emote`). */
  private feel(kind: Emote, seconds: number): void {
    this.emote = kind;
    this.emoteUntil = this.now + seconds;
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
      // (a cat in a hand, or falling out of one, is not stroked, called or told: it is busy)
      const inHand = this.act?.k === "carried" || this.act?.k === "fall";
      switch (event.type) {
        case "cat.disable":
          this.dismissed = true;
          this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }]);
          break;
        case "cat.enable":
          this.dismissed = false;
          break;
        case "cat.grab":
          if (unreachable || inHand || !this.canBeCarried(world)) break;
          this.pendingPoint = null;
          this.grab(world, event.at);
          break;
        case "cat.carry":
          if (this.hold && this.act?.k === "carried") {
            this.hold = this.insideScreen(world, event.at);
            this.heldAt = this.now;
          }
          break;
        case "cat.drop":
          if (this.hold && this.act?.k === "carried") this.letGo(world);
          break;
        case "cat.pet": {
          if (unreachable || inHand) break;
          this.lastInteraction = this.now;
          this.petUntil = this.now + 1.3;
          this.mood.affection = clamp01(this.mood.affection + 0.04);
          this.mood.sleepiness = Math.max(0, this.mood.sleepiness - 0.05);
          const busy = this.act?.k === "jump" || this.act?.k === "point" || this.act?.k === "swat" || this.act?.k === "fade" || this.act?.k === "relocate";
          if (!busy && this.act?.k !== "rest" && this.placed) this.hardPlan([{ k: "rest", pose: "sit", dur: 4 }]);
          break;
        }
        case "cat.petEnd":
          this.petUntil = Math.min(this.petUntil, this.now + 0.8);
          break;
        case "cat.call":
          if (unreachable || inHand) break;
          this.pendingPoint = null;
          this.lastInteraction = this.now;
          this.dismissed = false;
          this.mood.energy = clamp01(this.mood.energy + 0.25);
          this.mood.affection = clamp01(this.mood.affection + 0.05);
          this.comeTo(world, event.at);
          break;
        case "cat.command":
          if ((unreachable || inHand) && event.command !== "away") break;
          this.pendingPoint = null;
          this.lastInteraction = this.now;
          this.command(world, event.command);
          break;
        case "catalog.itemFocused":
          if (event.id !== this.focusId) {
            this.focusId = event.id;
            this.lastFocusAt = this.now;
            this.mood.curiosity = clamp01(this.mood.curiosity + 0.2);
            if (world.focus && this.act?.k !== "sleep") this.lookAt(centre(world.focus), 2.5);
            // (now and then a new card is a puzzle: a tilt of the head)
            if (this.canFeel(world, unreachable || inHand) && this.cooled("tilt") && this.rngLook.chance(0.12)) {
              this.cool.tilt = this.now + 20;
              this.feel("tilt", 1.7);
            }
          }
          break;
        case "cat.react":
          if (unreachable || inHand || !this.placed) break;
          this.lastInteraction = this.now;
          this.react(world, event.kind);
          break;
        case "cat.point":
          // (a cat that is in a hand, in the air, or fading out is asked all the same: it sets out when it can, see `pointAt`)
          if (world.mode === "away") break;
          this.lastInteraction = this.now;
          this.pointAt(world, event.targetId);
          break;
        case "player.play":
        case "player.resume":
          // (a film that goes on after a pause finds the cat awake for a moment; one that has only begun, watching it)
          if (world.mode === "player" && !unreachable) this.hardPlan([...(this.dozed ? ([{ k: "rest", pose: "loaf", dur: 2.5 }] as const) : []), ...this.filmPlan(world)]);
          break;
        case "player.pause":
          if (world.mode === "player" && !unreachable) this.hardPlan([{ k: "rest", pose: "loaf", dur: 18 }, ...this.filmPlan(world)]);
          break;
        case "player.ended":
          // (the end of the film wakes it: a yawn, a stretch, and it sits up for what comes next)
          if (world.mode === "player" && !unreachable) this.hardPlan([{ k: "rest", pose: "loaf", dur: 1.2 }, { k: "shot", clip: "yawn", dur: 2.8 }, { k: "shot", clip: "stretch", dur: 2.4 }, { k: "rest", pose: "sit", dur: 20 }]);
          break;
        default:
          break;
      }
    }
  }

  /** Replace the plan, unless the cat is in the air (it finishes its leap first) or in a hand (the hand lets go first). */
  private hardPlan(plan: Act[]): void {
    this.queue = plan;
    if (!this.act) return;
    // (a cat that has come down and is only settling is not in the air any more)
    if (this.act.k === "jump" || this.act.k === "carried" || (this.act.k === "fall" && !this.fall?.landed)) return;
    if (this.act.k === "fall") this.fall = null;
    this.act = null;
  }

  /** Out of the way at once (a menu has opened, the page is hidden, the viewer sent the cat away): even a leap in the air, or a hand that has hold of it, is cut short. */
  private vanish(plan: Act[]): void {
    if (this.act?.k === "jump" || this.act?.k === "carried" || this.act?.k === "fall") {
      this.jump = null;
      this.hold = null;
      this.fall = null;
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
    // (a film that begins is watched from its start)
    if (world.mode === "player") this.dozed = false;
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
    // (a page that is flung does not take the cat up with its shelf: the cat is shaken off it, whatever it was about to do on it, or doing: the first look at a page that is being flung
    // is of a shelf that has gone from under the cat already, and the cat has begun to leap to another one, which the page takes away from it again)
    if (this.fastRun >= SHAKE_READINGS && this.shakeOff(world)) return;
    if (!this.grounded) return;
    // (not while leaping, but when the leap has landed and is only settling; nor while on the way out to come back somewhere else)
    if ((this.act?.k === "jump" && !this.jump?.landed) || this.queueHas("relocate") || (this.act?.k === "fade" && this.act.to === 0)) return;
    const L = world.bodyLength;
    const vp = world.viewport;
    const here = this.surfaceId ? ledgeAt(this.ledges, this.surfaceId, this.x) : undefined;
    if (!here) {
      // the shelf has no room for a cat any more (it is scrolling out from under the top bar, or off the screen): the cat goes with it for a
      // moment, as anything on the shelf would, and then makes its way off (a shelf that is moving, because the page is scrolled, is left at once: it is not going to have room again)
      const shelf = this.surfaceId ? world.surfaces.find((s) => s.id === this.surfaceId) : undefined;
      const moving = shelf !== undefined && Number.isFinite(this.shelfY) && Math.abs(shelf.y - this.shelfY) > 0.004 * L;
      if (shelf) this.shelfY = shelf.y;
      if (shelf && this.rideT < (moving ? RIDE_MOVING : RIDE) && this.x >= shelf.x0 && this.x <= shelf.x1 && shelf.y >= vp.y && shelf.y <= vp.y + vp.h + 0.9 * L && !this.isUnseen(world)) {
        this.rideT += dt;
        this.y = shelf.y;
        return;
      }
      this.leaveGone(world);
      return;
    }
    this.shelfY = here.y;
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
    } else if (this.act?.k !== "walk" || this.act.stalk) {
      // something has come up where the cat stands: it steps out of its way, briskly, and a little further than it has to, rather than stand in it
      // (a cat that is stalking is not walking out of it: it creeps, and a window made smaller under it left it cut by the edge of the screen for more than two seconds)
      const away = clamp(to + Math.sign(to - this.x) * 0.5 * L, here.x0, here.x1);
      this.hardPlan([{ k: "walk", x: away, run: gap > 1.2 * L, maxT: 12 }]);
    }
  }

  /**
   * How fast the page is scrolled: how far the shelves it has in both of two readings went between them (the middle of those, so that a shelf which is not part of the scrolling does not
   * count), over the time between the readings. The page is read when it has moved, at every frame while it does, and the cat is handed the very same world in between, so a reading is a
   * new world, and one that is the same for `SCROLL_STILL` seconds is a page that is still (its reference is then taken at each frame, so that the reading when it starts is of the frame
   * it started in). A page that was made over (another screen size, no shelf in common) is not one that was scrolled.
   */
  private measureScroll(world: World): void {
    if (world === this.scrollWorld && world.readAt === this.scrollRead) {
      if (this.scrollStill || this.now - this.scrollAt > SCROLL_STILL) {
        this.scrollStill = true;
        this.scrollAt = this.now;
        this.scrollSpeed = 0;
        this.fastRun = 0;
      }
      return;
    }
    this.scrollWorld = world;
    this.scrollRead = world.readAt;
    this.scrollStill = false;
    const size = `${world.viewport.w}x${world.viewport.h}:${world.bodyLength}`;
    const span = this.now - this.scrollAt;
    if (world.mode === "browse" && size === this.scrollSize && span < SCROLL_SPAN) return;
    const shelves = new Map<string, number>();
    const moved: number[] = [];
    if (world.mode === "browse") {
      for (const surface of world.surfaces) {
        if (surface.kind !== "shelfTop") continue;
        shelves.set(surface.id, surface.y);
        const was = size === this.scrollSize ? this.scrollShelves.get(surface.id) : undefined;
        if (was !== undefined) moved.push(surface.y - was);
      }
    }
    moved.sort((a, b) => a - b);
    this.scrollSpeed = moved.length > 0 && span > 0 ? moved[moved.length >> 1]! / span : 0;
    this.fastRun = Math.abs(this.scrollSpeed) >= SHAKE_SPEED * world.bodyLength ? this.fastRun + 1 : 0;
    this.scrollShelves = shelves;
    this.scrollSize = size;
    this.scrollAt = this.now;
  }

  /**
   * The page is flung under a cat that stands on a shelf, or is leaping from one to another (the shelves it leaps between fly off as it does): it is shaken off, and is in free fall (see
   * `freeFall`), from where it is, as fast as it was going up or down. Not so for a cat that must not move about, or is showing a poster, or is on its way out; nor one on the foot of the
   * screen, which does not go with the page.
   */
  private shakeOff(world: World): boolean {
    const act = this.act;
    if (world.mode !== "browse" || world.quiet || world.reducedMotion || this.dismissed || this.hold !== null || this.alpha < 0.5) return false;
    if (act && (act.k === "carried" || act.k === "fall" || act.k === "fade" || act.k === "relocate")) return false;
    if (this.queueHas("point") || this.queueHas("swat") || this.queueHas("relocate") || this.pendingPoint !== null) return false;
    const kind = this.surfaceId ? world.surfaces.find((s) => s.id === this.surfaceId)?.kind : undefined;
    if (kind === "fallbackFloor") return false;
    // (a cat in the air keeps going the way it was going, and gravity takes it from there; one that was gathering itself for a leap, or standing, has no way it was going)
    const going = this.grounded ? 0 : finite(this.vy);
    this.jump = null;
    this.finish();
    this.queue = [];
    this.act = { k: "fall" };
    this.fall = { toSurface: "", toX: this.x, vy: going, landed: false, settleT: 0, placeY: this.y, missed: false, free: true };
    this.grounded = false;
    this.vx = 0;
    this.vy = going;
    this.rideT = 0;
    this.overlapT = 0;
    this.rowPending = 0;
    this.rowRide = 0;
    this.setClip("jump");
    this.progress = FREE_FALL_POSE;
    this.feel("startle", 1.3);
    return true;
  }

  /**
   * The viewer scrolls the row of posters the cat stands on (they slide sideways under it): the cat is on them, and goes with them (eased in over a few frames: the page is read
   * a few times a second, not at every frame). When they have carried it a good way, it hops back to where it was, or, now and then, away to another shelf. A cat that must not
   * move about (a quiet one, or one for a viewer who wants less motion) only goes with them, and does not hop, and one in the middle of a leap, in a hand or fading is not on them.
   */
  private rideRow(world: World, dt: number): void {
    const targets = world.targets;
    const before = this.seenTargets;
    this.seenTargets = targets;
    const L = world.bodyLength;
    const here = this.here();
    // (a cat that is gathering itself for a leap is not on the row: the leap is measured from where it stands, and a cat carried off its mark would be snapped back to it)
    // (nor one that has been left outside its shelf by a card that has taken the focus, say: `keepOnLedge` sees to that, and it is not for the posters to put it back)
    const onRow = this.grounded && this.surfaceId !== null && world.mode === "browse" && here !== undefined && this.x >= here.x0 && this.x <= here.x1 && this.alpha > 0.5 && this.hold === null && this.act?.k !== "fade" && this.act?.k !== "relocate" && this.act?.k !== "jump";
    if (!onRow) {
      this.rowPending = 0;
      this.rowRide = 0;
      return;
    }
    if (before && before !== targets) {
      // (how far the posters of this shelf have slid since the last frame: the middle of what those that are still there have moved by; a row that was made over is not one that was scrolled)
      const was = new Map<string, number>();
      for (const one of before) if (one.surfaceId === this.surfaceId) was.set(one.id, one.rect.x);
      const slid: number[] = [];
      for (const one of targets) {
        const x = one.surfaceId === this.surfaceId ? was.get(one.id) : undefined;
        if (x !== undefined) slid.push(one.rect.x - x);
      }
      if (slid.length >= 2) {
        slid.sort((a, b) => a - b);
        const middle = slid[slid.length >> 1]!;
        if (Math.abs(middle) >= 0.5 && Math.abs(middle) <= 6 * L) this.rowPending += middle;
      }
    }
    if (Math.abs(this.rowPending) < 0.05) {
      this.rowPending = 0;
      this.rowStillT += dt;
      if (this.rowStillT > CARRIED_FORGET) this.rowRide = 0;
      return;
    }
    this.rowStillT = 0;
    const take = Math.abs(this.rowPending) < 1 ? this.rowPending : this.rowPending * Math.min(1, dt * RIDE_EASE);
    this.rowPending -= take;
    const wanted = this.x + take;
    const to = clampToLedge(here, wanted);
    this.rowRide += to - this.x;
    this.x = to;
    // (carried as far as it likes, or to the end of its shelf: a cat that may hop does)
    const free = !world.reducedMotion && !world.quiet && this.cooled("carried");
    // (nor is a cat on its way to show a poster turned back from it, or one that is showing it)
    const busy = this.act?.k === "jump" || this.act?.k === "carried" || this.act?.k === "fall" || this.queueHas("point") || this.queueHas("swat") || this.queueHas("relocate") || this.pendingPoint !== null;
    if (!free || busy || (Math.abs(this.rowRide) < CARRIED_FAR * L && to === wanted)) return;
    this.cool.carried = this.now + CARRIED_EVERY;
    const away = this.rng.chance(CARRIED_AWAY) ? this.nearestReachable(world) : undefined;
    if (away && away.surfaceId !== here.surfaceId) {
      this.rowRide = 0;
      this.hardPlan([{ k: "jump", toSurface: away.surfaceId, toX: clampToLedge(away, this.x) }, { k: "rest", pose: "sit", dur: this.rng.range(2, 4) }]);
      return;
    }
    // (back the way it was carried, as far as a leap goes)
    const back = clampToLedge(here, this.x - clamp(this.rowRide, -3.2 * L, 3.2 * L));
    this.rowRide = 0;
    if (Math.abs(back - this.x) < 0.5 * L) return;
    this.hardPlan([{ k: "jump", toSurface: here.surfaceId, toX: back }, { k: "rest", pose: "sit", dur: this.rng.range(1.5, 3) }]);
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
    // (the shelf it stood on has gone off with a scrolling page, and another has come to where its feet are: it stands on that one, and does not leap away from it)
    if (this.adoptShelfUnder(world)) return;
    if (this.alpha > 0.05 && this.ledges.length > 0 && !world.reducedMotion && !world.quiet) {
      const target = this.nearestReachable(world);
      if (target) {
        this.hardPlan([{ k: "jump", toSurface: target.surfaceId, toX: clampToLedge(target, this.x) }]);
        return;
      }
    }
    this.hardPlan([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: world.mode === "player" ? "perch" : "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
  }

  /** The shelf the cat stood on is not on the page any more, and another shelf is where its feet are (it was scrolled there): the cat is on that one now. */
  private adoptShelfUnder(world: World): boolean {
    if (!this.surfaceId || world.surfaces.some((s) => s.id === this.surfaceId)) return false;
    let best: Ledge | undefined;
    for (const ledge of this.ledges) {
      if (this.x < ledge.x0 || this.x > ledge.x1 || Math.abs(ledge.y - this.y) > ADOPT * world.bodyLength) continue;
      if (!best || Math.abs(ledge.y - this.y) < Math.abs(best.y - this.y)) best = ledge;
    }
    if (!best) return false;
    this.surfaceId = best.surfaceId;
    this.shelfY = best.y;
    this.y = best.y;
    this.rideT = 0;
    this.visited[best.surfaceId] = this.now;
    return true;
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
    const act = this.act;
    // (a sleeper that shifts in its sleep is still asleep, and one that nods off is on the way to it)
    const sleeping = act?.k === "sleep" || (act?.k === "shot" && act.clip === "shift");
    const dozing = act?.k === "shot" && act.clip === "doze";
    m.sleepiness = clamp01(m.sleepiness + dt * (sleeping ? -0.025 : idle > 30 ? 1 / 260 : 1 / 900));
    m.energy = clamp01(m.energy + (0.32 - m.energy) * Math.min(1, dt / 25));
    m.curiosity = clamp01(m.curiosity + (0.28 - m.curiosity) * Math.min(1, dt / 40));
    m.affection = clamp01(m.affection + (0.2 - m.affection) * Math.min(1, dt / 240));
    const goal = sleeping ? 1 : dozing ? 0.62 : this.petted ? 0.1 : 0;
    this.drowsy = clamp01(this.drowsy + clamp(goal - this.drowsy, -dt * 0.9, dt * 0.3));
    this.clipT += dt;
  }

  /* ------------------------------ feelings, and what the pointer does ------------------------------ */

  /** Whether the cat is in a state to show a feeling that nothing asked of it: awake, in sight, not in a hand, and not on the page at the page's say-so. */
  private canFeel(world: World, busy: boolean): boolean {
    const act = this.act;
    if (busy || !this.placed || this.alpha < 0.5 || world.mode === "away" || act?.k === "sleep") return false;
    return !(act?.k === "shot" && (act.clip === "shift" || act.clip === "doze"));
  }

  /** The page tells the cat what it found for the viewer: a title (joy, and a little bounce on the spot) or none (a letdown). */
  private react(world: World, kind: "found" | "empty"): void {
    // (a cat that is asleep does not hear it: the title it is shown, if there is one, is what wakes it)
    if (!this.canFeel(world, false)) return;
    if (kind === "found") {
      this.feel("joy", 1.8);
      const here = this.here();
      if (here && world.mode === "browse" && !world.reducedMotion && !world.quiet && this.grounded && this.act?.k !== "jump") {
        // (towards the side with room)
        const dir: 1 | -1 = this.x - here.x0 > here.x1 - this.x ? -1 : 1;
        this.hardPlan([{ k: "jump", toSurface: here.surfaceId, toX: clampToLedge(here, this.x + dir * 0.3 * world.bodyLength) }]);
      }
    } else {
      this.feel("droop", 2.4);
      this.hardPlan([{ k: "rest", pose: "sit", dur: 2.8 }]);
    }
  }

  /** How fast the pointer goes, and how long it has been slow; a pointer that dashes close to the cat is a fright. */
  private watchPointer(world: World, dt: number): void {
    const point = world.pointer;
    if (!point || dt <= 0) {
      this.pointerPrev = point ? { x: point.x, y: point.y } : null;
      this.pointerSpeed = 0;
      this.pointerStill = 0;
      return;
    }
    const L = world.bodyLength;
    if (this.pointerPrev) {
      const v = Math.hypot(point.x - this.pointerPrev.x, point.y - this.pointerPrev.y) / dt / L;
      this.pointerSpeed += (v - this.pointerSpeed) * Math.min(1, dt * 14);
    } else this.pointerSpeed = 0;
    this.pointerStill = this.pointerSpeed < PLAY_STILL ? this.pointerStill + dt : 0;
    this.pointerPrev = { x: point.x, y: point.y };
    if (this.pointerSpeed > FLINCH_SPEED && this.cooled("flinch")) this.flinch(world, point);
  }

  private flinch(world: World, point: Vec): void {
    const L = world.bodyLength;
    const act = this.act;
    if (world.mode !== "browse" || world.reducedMotion || world.quiet || !this.canFeel(world, this.leaving())) return;
    if (act?.k === "carried" || act?.k === "fall" || act?.k === "jump" || act?.k === "fade" || act?.k === "relocate") return;
    // (near the cat, and not on it: a hand that comes to stroke it is not a fright)
    const away = Math.hypot(point.x - this.x, point.y - (this.y - 0.4 * L));
    if (away > FLINCH_NEAR * L || away < 0.45 * L) return;
    this.cool.flinch = this.now + FLINCH_EVERY + this.rngLook.range(0, 15);
    this.feel("startle", 0.5);
    this.lookAt({ x: point.x, y: point.y }, 1.8);
    // (it freezes, and then, as if nothing had happened, it washes)
    this.hardPlan([
      { k: "rest", pose: act?.k === "walk" ? "stand" : "sit", dur: 0.9 },
      ...(this.rngLook.chance(0.55) ? ([{ k: "shot", clip: "groom", dur: this.rngLook.range(2.4, 3.8) }] as const) : []),
    ]);
  }

  /**
   * A film's cat: it watches the picture a while from its perch (the first time it is on), nods off, and sleeps, shifting a little in its sleep now and then. A viewer who
   * wants no motion has it asleep, still.
   */
  private filmPlan(world: World): Act[] {
    if (world.reducedMotion) return [{ k: "sleep", dur: 600 }];
    const sleep: Act[] = [{ k: "sleep", dur: this.rng.range(70, 150) }, { k: "shot", clip: "shift", dur: 2.8 }];
    if (this.dozed) return sleep;
    this.dozed = true;
    const vp = world.viewport;
    const picture = { x: vp.x + vp.w / 2, y: vp.y + vp.h * 0.38 };
    return [{ k: "rest", pose: "loaf", dur: this.rng.range(7, 16), at: picture }, { k: "shot", clip: "doze", dur: this.rng.range(7.5, 11) }, ...sleep];
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
    if (this.act?.k === "point" || this.act?.k === "swat") return;
    if (this.act?.k === "carried") {
      // (held up by the scruff, it stares out of the screen at whoever has it)
      this.viewer = true;
      this.lookPoint = undefined;
      return;
    }
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
    const L = world.bodyLength;
    // (a cat in no hurry looks where it is going, and looks over a drop before it goes down it and measures a climb before it goes up)
    const calm = !run && !world.reducedMotion;
    for (const hop of path) {
      const landing = { x: hop.landX, y: hop.ledge.y };
      plan.push({ k: "walk", x: hop.takeoffX, run, maxT: 30, ...(calm ? { look: landing } : {}) });
      if (calm && hop.ledge.y - cursor.y >= PEEK_DROP * L) plan.push({ k: "shot", clip: "peek", dur: this.rng.range(0.8, 1.4), at: landing });
      else if (calm && cursor.y - hop.ledge.y >= MEASURE_CLIMB * L) plan.push({ k: "shot", clip: "wiggle", dur: this.rng.range(0.5, 0.8), at: landing });
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

  /**
   * The cat was asked to show the viewer a poster it found. It goes there briskly (somebody is waiting to be shown it) by leaps between the shelves, or, when the poster is
   * on the shelf it stands on, by a few hops along it; it creeps the last of the way with its eyes on the poster, wiggles, swats at it twice, and then holds a paw out to it
   * a while and sits down by it. A viewer who wants no motion has it point from where it is.
   */
  private pointAt(world: World, targetId: string): void {
    const waited = this.pendingPoint?.id === targetId ? this.pendingPoint.until : undefined;
    this.pendingPoint = null;
    const target = world.targets.find((one) => one.id === targetId);
    if (!target || world.mode !== "browse") return;
    // (a cat that cannot set out from where it is -- not on the page yet, in a hand, in the air, fading out to come back elsewhere, or with the shelf it stood on gone from under
    // it, as a page scrolled to the poster takes it -- sets out when it can, and not before: a route measured from a place it is leaving would be a wrong one)
    if (!this.readyToSetOut(world)) {
      this.pendingPoint = { id: targetId, until: waited ?? this.now + POINT_WAIT };
      return;
    }
    const rect = target.rect;
    const only: Act[] = [{ k: "point", target: rect, dur: 5, id: targetId }, { k: "rest", pose: "sit", dur: 4 }];
    if (world.reducedMotion || this.ledges.length === 0) {
      this.hardPlan(only);
      return;
    }
    // (the places it may swat from, the best first: a trip it can make to the nearest of them)
    for (const spot of this.swatSpots(world, rect)) {
      const trip = this.swatTrip(world, target, spot);
      if (trip) {
        this.hardPlan(trip);
        return;
      }
    }
    // (the poster's shelf has no place a cat may stand at it, or none that a paw reaches the poster from -- the library's words or the cat's own panel are over it, say: it comes
    // as near as it may, and holds a paw out to the poster from there)
    this.hardPlan(this.nearTrip(world, target) ?? only);
  }

  /**
   * Where the cat may stand to swat at a poster: on a ledge along the poster's own shelf, a paw's reach before the poster's middle (or as near to that as the ledge lets it, if
   * the paw still comes down on the poster), on either side of it; the nearest to the cat first, and the side it comes from before the other.
   */
  private swatSpots(world: World, rect: Rect): Array<{ ledge: Ledge; stand: number; side: 1 | -1 }> {
    const L = world.bodyLength;
    const cx = rect.x + rect.w / 2;
    const from: 1 | -1 = this.x <= cx ? 1 : -1;
    const found: Array<{ ledge: Ledge; stand: number; side: 1 | -1; cost: number }> = [];
    for (const ledge of this.ledges) {
      if (Math.abs(ledge.y - rect.y) > SAME_SHELF * L) continue;
      for (const side of [1, -1] as const) {
        const stand = clampToLedge(ledge, cx - side * SWAT_REACH * L);
        const paw = stand + side * SWAT_REACH * L;
        // (it faces the poster's middle, as the swat will have it: a ledge that ends beyond the middle is no place to swat from on that side)
        if ((cx - stand) * side < 0 || Math.max(0, rect.x - paw, paw - (rect.x + rect.w)) > SWAT_MISS * L) continue;
        found.push({ ledge, stand, side, cost: Math.abs(stand - this.x) + (side === from ? 0 : 0.5 * L) + (ledge.surfaceId === this.surfaceId ? 0 : 2 * L) });
      }
    }
    return found.sort((a, b) => a.cost - b.cost);
  }

  /**
   * The trip to a poster, from where the cat is, ending in swats at it from `spot`: briskly (somebody is waiting to be shown it) by leaps between the shelves, or, when the poster is
   * on the shelf it stands on, by a few hops along it; it creeps up the last of the way with its eyes on the poster, wiggles, swats at it twice, and then holds a paw out to it a while
   * and sits down by it, looking out of the screen at the viewer, pleased with itself. Null when there is no way to that place.
   */
  private swatTrip(world: World, target: Target, spot: { ledge: Ledge; stand: number; side: 1 | -1 }): Act[] | null {
    const rect = target.rect;
    const L = world.bodyLength;
    const { ledge: near, stand, side } = spot;
    const here = this.here();
    // it begins to creep a little way before the place it swats from
    const alongside = here !== undefined && here.surfaceId === near.surfaceId && (stand - this.x) * side >= -0.1 * L && (stand - this.x) * side <= CREEP * L + 0.1 * L;
    const lead = clampToLedge(near, stand - side * CREEP * L);
    const route = alongside ? [] : this.routeTo(world, near, lead, true);
    if (!route) return null;
    let travel: Act[] = route;
    // (on the poster's own shelf, and not close: it comes by hops, as an excited cat does, and not by a run)
    const far = Math.abs(lead - this.x);
    if (!alongside && !world.quiet && here?.surfaceId === near.surfaceId && !route.some((act) => act.k === "jump") && far >= 1.3 * L && far <= 8 * L) {
      const hops = clamp(Math.round(far / (1.6 * L)), 1, 3);
      travel = Array.from({ length: hops }, (_, i): Act => ({ k: "jump", toSurface: near.surfaceId, toX: this.x + ((lead - this.x) * (i + 1)) / hops }));
    }
    const contact = this.swatPoint(rect, stand, near.y, side, L);
    this.swatFixes = 0;
    return [
      ...travel,
      { k: "walk", x: stand, run: false, maxT: 8, stalk: contact },
      { k: "shot", clip: "wiggle", dur: this.rng.range(0.8, 1.1), at: contact },
      { k: "swat", target: rect, dur: SWAT_FIRST, id: target.id },
      { k: "swat", target: rect, dur: SWAT_SECOND, id: target.id },
      { k: "point", target: rect, dur: 4, id: target.id },
      { k: "rest", pose: "sit", dur: 4.5, viewer: true, feel: "joy" },
    ];
  }

  /** The trip to the place nearest a poster that the cat may stand at, where it holds a paw out to the poster (for a poster it cannot swat from anywhere). Null when there is no way to it. */
  private nearTrip(world: World, target: Target): Act[] | null {
    const rect = target.rect;
    const cx = rect.x + rect.w / 2;
    let best: { ledge: Ledge; stand: number; d: number } | null = null;
    for (const ledge of this.ledges) {
      const stand = clampToLedge(ledge, cx);
      // (how far the cat's feet are from the poster's box)
      const d = Math.hypot(Math.max(0, rect.x - stand, stand - (rect.x + rect.w)), Math.max(0, rect.y - ledge.y, ledge.y - (rect.y + rect.h)));
      if (!best || d < best.d) best = { ledge, stand, d };
    }
    if (!best) return null;
    const route = this.routeTo(world, best.ledge, best.stand, true);
    if (!route) return null;
    return [...route, { k: "point", target: rect, dur: 5, id: target.id }, { k: "rest", pose: "sit", dur: 4 }];
  }

  /** Whether the cat is somewhere it can set out from: on the page, on the ground of a shelf the page still has (any ground, for a viewer who wants no motion), and neither in a hand, nor in the air, nor on its way out. */
  private readyToSetOut(world: World): boolean {
    const k = this.act?.k;
    if (!this.placed || this.leaving() || k === "jump" || k === "carried" || k === "fall") return false;
    return world.reducedMotion || this.here() !== undefined;
  }

  /** Where a swat lands on a poster: a paw's reach ahead of the cat and just under the lip of its shelf, or the place of the poster that is nearest to that. */
  private swatPoint(rect: Rect, x: number, y: number, dir: 1 | -1, L: number): Vec {
    const m = 0.05 * L;
    return {
      x: clamp(x + dir * SWAT_REACH * L, rect.x + m, Math.max(rect.x + m, rect.x + rect.w - m)),
      y: clamp(y + 0.08 * L, rect.y + m, Math.max(rect.y + m, rect.y + rect.h - m)),
    };
  }

  /** The poster a pointing or swatting act is about, where the page has it now (it has moved if the page was scrolled since the cat set out). */
  private posterOf(world: World, act: { id?: string | undefined; target: Rect }): Rect {
    return (act.id !== undefined ? world.targets.find((one) => one.id === act.id)?.rect : undefined) ?? act.target;
  }

  private playPlan(world: World): void {
    if (world.reducedMotion || world.mode !== "browse") {
      this.hardPlan([{ k: "rest", pose: "sit", dur: 4 }]);
      return;
    }
    if (!this.here()) return;
    this.hardPlan([...this.hopAround(world, 3), { k: "rest", pose: "sit", dur: 5 }]);
  }

  /** A run and a leap from shelf to shelf, `hops` times, each to a shelf (one leap away) picked at random: a cat at play, or one that has the zoomies. */
  private hopAround(world: World, hops: number): Act[] {
    const plan: Act[] = [];
    const L = world.bodyLength;
    let at: Ledge | undefined = this.here();
    let x = this.x;
    if (!at) return plan;
    for (let i = 0; i < hops; i++) {
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
    return plan;
  }

  /* ------------------------------ in a hand ------------------------------ */

  /** Whether a hand may take the cat up: in the library or a film (it is put down on the film's perch), a cat in plain sight, and not for a viewer who asked for quiet or for less motion (it then only rests, where it is). */
  private canBeCarried(world: World): boolean {
    return (world.mode === "browse" || world.mode === "player") && !world.reducedMotion && !world.quiet && this.placed && this.alpha > 0.5 && !this.dismissed;
  }

  /** The point of the screen nearest the hand: a hand cannot take the cat off the screen. */
  private insideScreen(world: World, at: Vec): Vec {
    const vp = world.viewport;
    return { x: clamp(finite(at.x), vp.x, vp.x + vp.w), y: clamp(finite(at.y), vp.y + 0.2 * world.bodyLength, vp.y + vp.h) };
  }

  /**
   * A hand takes hold of the cat, wherever it is (on a shelf, or in the air in a leap) and however it was taken: it hangs where the hand found it at first, and
   * eases into the hang by the scruff from there (so a hand that only brushed it, and lets go, puts it back where it was).
   */
  private grab(world: World, at: Vec): void {
    const hand = this.insideScreen(world, at);
    this.lastInteraction = this.now;
    this.mood.energy = clamp01(this.mood.energy + 0.2);
    this.mood.affection = clamp01(this.mood.affection - 0.04);
    this.mood.sleepiness = Math.max(0, this.mood.sleepiness - 0.2);
    this.petUntil = -1;
    this.jump = null;
    this.fall = null;
    this.finish();
    this.queue = [];
    this.hold = hand;
    this.heldAt = this.now;
    this.hangX = this.x - hand.x;
    this.hangY = this.y - hand.y;
    this.hangY0 = this.hangY;
    this.groundY = this.y;
    this.grabAt = { x: hand.x, y: hand.y };
    this.act = { k: "carried" };
    this.actT = 0;
    this.grounded = false;
    this.startAct(world);
  }

  /** Carried: the cat's feet follow the hand, a little behind it and lagging, hanging from it by the scruff. */
  private carry(world: World, dt: number): void {
    const hold = this.hold;
    if (!hold) {
      this.finish();
      return;
    }
    // (a hand that has said nothing for a while is gone: a pointer lost to a window that lost its focus, say)
    if (this.now - this.heldAt > CARRY_SILENCE) {
      this.letGo(world);
      return;
    }
    const L = world.bodyLength;
    this.lastInteraction = this.now;
    this.setClip("stand");
    this.grounded = false;
    const ease = 1 - Math.exp(-HANG_RELAX * dt);
    this.hangX += (HANG_AHEAD * L * this.facing - this.hangX) * ease;
    this.hangY += (HANG_DOWN * L - this.hangY) * ease;
    // (a cat taken up by the middle does not sink as the hang forms, below where it stood or below where the hand found it: it is the hand that lifts it. That is for
    // the moment of the grab: a hand that has carried it half a body away lets it hang, and one that has carried it a body and a half away has the whole hang, whichever
    // way it went, so a cat taken down to a lower shelf is not held up by the middle all the way)
    // (a window made smaller brings the cat in with it: a cat in a hand is never left off the screen, whatever it was following. One that is partly on the screen is led
    // in as it follows the hand, as fast as a hand can carry it, and not set on the edge in a frame, which was seen as a jump of 64 px by the soak: it aims a hair
    // inside the edge, so that it is inside in a few frames)
    const vp = world.viewport;
    const slack = 0.02 * L;
    const hung = clamp01((Math.hypot(hold.x - this.grabAt.x, hold.y - this.grabAt.y) / L - 0.5) / 1);
    const hangs = hold.y + this.hangY;
    const kept = Math.min(hangs, Math.max(hold.y + this.hangY0, this.groundY));
    const wantY = clamp(kept + (hangs - kept) * hung, vp.y + 0.2 * L + slack, vp.y + vp.h + 0.8 * L - slack);
    let vx = (clamp(hold.x + this.hangX, vp.x + slack, vp.x + vp.w - slack) - this.x) * CARRY_FOLLOW;
    let vy = (wantY - this.y) * CARRY_FOLLOW;
    const fastest = CARRY_SPEED * L;
    const speed = Math.hypot(vx, vy);
    if (speed > fastest) {
      vx *= fastest / speed;
      vy *= fastest / speed;
    }
    this.x += vx * dt;
    this.y += vy * dt;
    // (one that the window made smaller has left wholly off the screen is put back on it at once: nobody sees that, and the lead-in would show nothing for a second)
    if (this.isUnseen(world)) {
      this.x = clamp(this.x, vp.x, vp.x + vp.w);
      this.y = clamp(this.y, vp.y + 0.2 * L, vp.y + vp.h + 0.8 * L);
    }
    this.vx = vx;
    this.vy = vy;
  }

  /**
   * Where a cat let go of here comes down: the place under its feet that it can steer to on the way (not further across than it has time for), or one a little
   * above them (see `SPRING`). The nearest the best -- one it would spring up to a little less than one it would fall to, and the floor of a page less than a shelf. With `floorOnly`, the foot of the
   * screen is the only place it would come down on.
   */
  private dropTarget(world: World, spring = SPRING * world.bodyLength, floorOnly = false): { ledge: Ledge; x: number } | null {
    const L = world.bodyLength;
    let best: { ledge: Ledge; x: number } | null = null;
    let least = Infinity;
    for (const ledge of this.ledges) {
      if (floorOnly && ledge.kind !== "fallbackFloor") continue;
      const x = clampToLedge(ledge, this.x);
      const across = Math.abs(x - this.x);
      const below = ledge.y - this.y;
      if (below < -spring) continue;
      const time = 0.25 + Math.sqrt((2 * Math.max(0, below)) / (GRAVITY * L));
      if (across > Math.min(FALL_ACROSS * L, FALL_STEER * L * time)) continue;
      const score = (below >= 0 ? below : -2 * below) + 1.5 * across + (ledge.kind === "fallbackFloor" ? 0.3 * L : 0);
      if (score < least) {
        least = score;
        best = { ledge, x };
      }
    }
    return best;
  }

  /** Where the hand would put the cat down if it let go now (a point on a shelf), while a hand has it. */
  landing(): Vec | null {
    if (!this.hold || this.act?.k !== "carried" || !this.world) return null;
    const target = this.dropTarget(this.world);
    return target ? { x: target.x, y: target.ledge.y } : null;
  }

  /** The hand lets go: the cat falls to the place under it (or springs up onto one a little above its paws), or, with none, is gone from the page and back somewhere else. */
  private letGo(world: World): void {
    this.hold = null;
    const target = this.dropTarget(world);
    if (!target) {
      this.finish();
      this.grounded = true;
      this.vx = 0;
      this.vy = 0;
      this.setClip("stand");
      this.hardPlan([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
      return;
    }
    const L = world.bodyLength;
    // (a place above its feet: it springs up over its edge, and comes down on it)
    const up = this.y - target.ledge.y;
    this.fall = { toSurface: target.ledge.surfaceId, toX: target.x, vy: up > 0 ? -Math.sqrt(2 * GRAVITY * L * (up + 0.3 * L)) : 0, landed: false, settleT: 0, placeY: target.ledge.y, missed: false, free: false };
    this.act = { k: "fall" };
    this.actT = 0;
    this.visited[target.ledge.surfaceId] = this.now;
  }

  /** Falling out of a hand to the place chosen as it let go: it steers across to it, falls as gravity and the air let it, lands, settles, and then does what a cat does. */
  private runFall(world: World, dt: number): void {
    const fall = this.fall;
    if (!fall) {
      this.finish();
      return;
    }
    const L = world.bodyLength;
    this.setClip("jump");
    if (!fall.landed) {
      // (shaken off its shelf by a page that is flung: it falls where it is, with no place it falls to, until the page has slowed, or it is down to the foot of the screen; then it is given one)
      if (fall.free && this.freeFall(world, fall, dt)) return;
      let target = ledgeAt(this.ledges, fall.toSurface, fall.toX);
      if (!target || fall.missed) {
        // (the shelf it was falling to is gone, with the page changing, or the page took it away above the cat as it sprang up, and the cat is past the top of its spring and
        // under it: it comes down on whatever is under it now, or is gone from the page and back somewhere else; a place above its feet only if it is still rising, and
        // only as high as that rise takes it: a cat past the top of its spring is not lifted onto a shelf)
        const again = this.dropTarget(world, fall.vy < 0 ? Math.min(SPRING * L, (fall.vy * fall.vy) / (2 * GRAVITY * L)) : 0);
        fall.missed = false;
        if (!again) {
          this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
          return;
        }
        fall.toSurface = again.ledge.surfaceId;
        fall.toX = again.x;
        fall.placeY = again.ledge.y;
        target = again.ledge;
      }
      // (a window made smaller under a cat in the air leaves it off the screen, and too far from any place to steer to in time: it is gone, and back somewhere else)
      const vp = world.viewport;
      if (this.x < vp.x || this.x > vp.x + vp.w) {
        this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
        return;
      }
      const aim = clampToLedge(target, fall.toX);
      fall.toX = aim;
      // (it is steered so as to arrive over the place as it arrives at it, whatever the distance: the time left is the fall's own, from where it is and how fast it is going.
      // A steer that only closed a part of what was left each frame left up to a third of a body's length to be put right at the touchdown)
      const g = GRAVITY * L;
      const left = Math.max(dt, (-fall.vy + Math.sqrt(Math.max(0, fall.vy * fall.vy + 2 * g * (target.y - this.y)))) / g);
      const reach = FALL_STEER * 1.5 * L * dt;
      const across = clamp((aim - this.x) * clamp01(dt / left), -reach, reach);
      this.x += across;
      this.vx = dt > 0 ? across / dt : 0;
      fall.vy = Math.min(fall.vy + GRAVITY * L * dt, FALL_FASTEST * L);
      this.y += fall.vy * dt;
      this.vy = fall.vy;
      this.grounded = false;
      // (the legs reach down for the ground all the way, and the more as it comes near: the pose of the last of a leap's way down, not the stretched one of its top)
      this.progress = fall.vy < 0 ? 0.4 : lerp(0.72, 0.62, clamp01((target.y - this.y) / L));
      const placeWas = fall.placeY;
      fall.placeY = target.y;
      if (this.y < target.y || fall.vy < 0) return;
      // a cat comes down on a place only if the two met in this frame (the cat falling on to it, or the place moving up to it); one that is further under it than that
      // is not lifted on to it: the place got away from it as it sprang (the page was scrolled), and it comes down on what is under it now
      if (this.y - target.y > fall.vy * dt + Math.abs(target.y - placeWas) + 1) {
        fall.missed = true;
        return;
      }
      // touchdown, where it is (a place that was moved from under it in the last moment is left to keepOnLedge, which steps the cat back on to it, and does not lurch it)
      fall.landed = true;
      this.y = target.y;
      this.surfaceId = target.surfaceId;
      this.grounded = true;
      this.vx = 0;
      this.vy = 0;
    }
    // settling (the rest of the clip): keepOnLedge keeps the feet on the shelf it landed on, which may be moving
    fall.settleT += dt;
    this.progress = JUMP_LANDING + (1 - JUMP_LANDING) * clamp01(fall.settleT / FALL_SETTLE);
    // (what the steering could not close, a third of a body's length at most, is closed as it crouches: a landing that is nearly on its place is not snapped on to it in one frame)
    const rest = fall.toX - this.x;
    if (Math.abs(rest) < 0.3 * L) this.x += rest * (1 - Math.exp(-14 * dt));
    if (fall.settleT < FALL_SETTLE) return;
    this.fall = null;
    this.finish();
    // (as if it had meant to: it sits a moment, and washes; on a shelf with names it first goes where it hides none of them)
    const here = this.here();
    const spot = here && !world.reducedMotion && !world.quiet ? settle(here, this.x, this.facing, L, "sit", world).x : undefined;
    this.cool.groom = this.now + this.rng.range(45, 90);
    this.queue = [
      ...(spot !== undefined ? ([{ k: "walk", x: spot, run: false, maxT: 25 }] as const) : []),
      { k: "rest", pose: "sit", dur: this.rng.range(0.9, 1.6) },
      ...(this.rng.chance(0.75) ? ([{ k: "shot", clip: "groom", dur: this.rng.range(3, 5) }] as const) : []),
    ];
  }

  /**
   * A cat that a flung page shook off its shelf: it falls as gravity has it, where it is, in front of the page that goes by (a shelf that flies up at it does not catch it, nor does one that
   * flies down from under it carry it off: the page is not what it stands on any more). Once the page has slowed it comes down on the first place under it, as a cat let go of does; and when it is
   * down to the foot of the screen with the page still flying, on that. Says whether it is still in the air; if not, the fall is given the place it is to come down on, and goes on as a fall does.
   */
  private freeFall(world: World, fall: FallState, dt: number): boolean {
    const L = world.bodyLength;
    const vp = world.viewport;
    // (a window made smaller under a cat in the air leaves it off the screen: it is gone, and back somewhere else)
    if (this.x < vp.x || this.x > vp.x + vp.w) {
      this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
      return true;
    }
    const slow = Math.abs(this.scrollSpeed) < CATCH_SPEED * L;
    if (slow || this.y >= vp.y + vp.h - HANDOVER * L || this.actT > FREE_FALL_MAX) {
      const found = this.dropTarget(world, 0, !slow);
      if (!found) {
        this.vanish([{ k: "fade", to: 0, rate: FADE_OUT_RATE }, { k: "relocate", where: "home" }, { k: "fade", to: 1, rate: FADE_IN_RATE }]);
        return true;
      }
      fall.free = false;
      fall.toSurface = found.ledge.surfaceId;
      fall.toX = found.x;
      fall.placeY = found.ledge.y;
      this.visited[found.ledge.surfaceId] = this.now;
      return false;
    }
    fall.vy = Math.min(fall.vy + GRAVITY * L * dt, FALL_FASTEST * L);
    this.y += fall.vy * dt;
    this.vx = 0;
    this.vy = fall.vy;
    this.grounded = false;
    this.progress = FREE_FALL_POSE;
    return true;
  }

  /* ------------------------------ choosing what to do ------------------------------ */

  private next(world: World): void {
    // (a poster the cat was asked to show while it could not set out: it sets out as soon as it can, unless that has been too long coming)
    const waiting = this.pendingPoint;
    if (waiting) {
      if (this.now <= waiting.until && !this.dismissed) this.pointAt(world, waiting.id);
      else this.pendingPoint = null;
    }
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
        // (a cat that comes in during a film goes straight to what a film's cat does)
        this.queue = world.mode === "player" ? [] : [{ k: "rest", pose: "sit", dur: 3 }];
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
        // (a cat that changes places is never seen doing it: what is left of it is gone, and it comes in sitting or lying, not in the middle of a scene of the last place)
        this.alpha = 0;
        if (this.clip === "doze" || this.clip === "shift" || this.clip === "peek" || this.clip === "tap" || this.clip === "swat" || this.clip === "point") this.setClip(act.where === "perch" ? "loaf" : "sit");
        if (!this.place(world, act.where)) this.placed = false;
        break;
      case "jump":
        this.startJump(world, act);
        break;
      case "point": {
        this.reach = centre(this.posterOf(world, act));
        this.lookAt(this.reach, act.dur);
        if (Math.abs(this.reach.x - this.x) > 1) this.facing = this.reach.x > this.x ? 1 : -1;
        break;
      }
      case "swat": {
        // (it faces the poster, with its eyes on the place the paw will land)
        const rect = this.posterOf(world, act);
        const middle = centre(rect).x;
        if (Math.abs(middle - this.x) > 1) this.facing = middle > this.x ? 1 : -1;
        // (the page was scrolled since the cat set out, and the poster is not where it meant to stand by it: it creeps to where it should be and swats from there; a page that
        // will not keep still is given up on after twice, and the paw lands at the poster's nearest edge)
        const L = world.bodyLength;
        const here = this.here();
        const stand = here ? clampToLedge(here, middle - this.facing * SWAT_REACH * L) : this.x;
        if (here && this.swatFixes < 2 && !world.reducedMotion && Math.abs(stand - this.x) > 0.45 * L) {
          this.swatFixes++;
          this.queue.unshift(act);
          // (it creeps the last of the way, and walks the rest)
          const spot = this.swatPoint(rect, stand, this.y, this.facing, L);
          this.act = { k: "walk", x: stand, run: false, maxT: 8, ...(Math.abs(stand - this.x) > L ? { look: spot } : { stalk: spot }) };
          this.actT = 0;
          this.startAct(world);
          return;
        }
        this.reach = this.swatPoint(rect, this.x, this.y, this.facing, L);
        this.lookAt(this.reach, act.dur);
        break;
      }
      case "rest":
        // (resting with its eyes on something: the picture of a film, a card that has the focus)
        if (act.at) {
          this.lookAt(act.at, act.dur);
          if (Math.abs(act.at.x - this.x) > 1) this.facing = act.at.x > this.x ? 1 : -1;
        }
        if (act.feel) this.feel(act.feel, Math.min(act.dur, 2.4));
        if (act.viewer) {
          this.viewer = true;
          this.lookPoint = undefined;
          this.lookUntil = this.now + Math.min(act.dur, 3.5);
        }
        break;
      case "tap": {
        // (it reaches at where the pointer is, and has its eyes on it)
        this.reach = act.at;
        this.lookAt(act.at, 0.5);
        if (Math.abs(act.at.x - this.x) > 1) this.facing = act.at.x > this.x ? 1 : -1;
        break;
      }
      case "walk":
        // (a cat that stalks has its eyes on what it stalks, all the way; one that is going somewhere looks at the place)
        if (act.stalk) this.lookAt(act.stalk, act.maxT);
        else if (act.look && !act.run) this.lookAt(act.look, Math.min(act.maxT, 1.2 + Math.abs(act.x - this.x) / (WALK_SPEED * world.bodyLength)));
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

  /** In a film the cat watches the picture a while from its perch, nods off and sleeps (see `filmPlan`); it is awake, and loafing, when the film is paused. */
  private choosePlayer(world: World): Act[] {
    if (world.player === "paused" || world.player === "loading" || world.player === "none") return [{ k: "rest", pose: "loaf", dur: 12 }];
    if (world.player === "ended" || world.player === "error") return [{ k: "rest", pose: "sit", dur: 20 }];
    return this.filmPlan(world);
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
        const nap = this.rng.range(25, 70);
        // (a long nap is not one stillness: part of the way through, the sleeper changes its position)
        const turns = nap > 45 && this.rng.chance(0.55);
        const asleep: Act[] = turns
          ? [{ k: "sleep", dur: nap * this.rng.range(0.4, 0.6) }, { k: "shot", clip: "shift", dur: 2.6 }, { k: "sleep", dur: nap * this.rng.range(0.3, 0.45) }]
          : [{ k: "sleep", dur: nap }];
        // (a nap is the longest stillness there is: a cat that is free to roam does not take it where its body would hide a name, however it was just that it moved,
        // and goes to a shelf that is clear of them for it, or does not nap now)
        const poses: readonly RestPose[] = tread ? ["loaf", "knead", "curl"] : ["loaf", "curl"];
        const found = settling(poses);
        let way: Act[] | null = null;
        if (found && found.cost > UNTIDY * L * L) {
          way = this.cleanerPlace(world, poses, found.cost);
          if (!way) return null;
          this.cool.relocate = this.now + this.rng.range(12, 25);
        }
        return [
          ...(way ?? (found?.x === undefined ? [] : [{ k: "walk", x: found.x, run: false, maxT: 25 } as const])),
          { k: "rest", pose: "loaf", dur: 2.5 },
          ...(tread ? [{ k: "shot", clip: "knead", dur: this.rng.range(4, 7) } as const] : []),
          ...asleep,
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
          // (and now and then, as it looks at the card, it cocks its head)
          const tilts = this.rngLook.chance(0.25);
          return [{ k: "walk", x, run: false, maxT: 30, look: centre(f) }, { k: "rest", pose: "sit", dur: this.rng.range(5, 10), ...(tilts ? { feel: "tilt" as const } : {}) }];
        },
      });
    }

    // a poster on a lower row, a few lengths down the page: the cat goes to the place above it and looks down at it, head out
    if (here && roaming && world.targets.length > 0 && this.cooled("inspect")) {
      options.push({
        name: "inspect",
        score: 0.3 * (0.4 + m.curiosity) * (1 - 0.6 * tired),
        plan: () => {
          const below = world.targets.filter((t) => {
            if (!t.surfaceId || t.surfaceId === here.surfaceId) return false;
            const at = centre(t.rect);
            return at.y - here.y >= 1.2 * L && at.y - here.y <= 4.5 * L && Math.abs(at.x - this.x) <= 6 * L;
          });
          const one = this.rng.pick(below);
          if (!one) return null;
          const at = centre(one.rect);
          // (above it, or as near to that as it can be without its body hiding a name)
          const above = clampToLedge(here, at.x);
          const x = spotFor("stand", above) ?? above;
          this.cool.inspect = this.now + this.rng.range(50, 100);
          return [
            ...(Math.abs(x - this.x) < 0.5 * L ? [] : [{ k: "walk", x, run: false, maxT: 30, look: at } as const]),
            { k: "shot", clip: "peek", dur: this.rng.range(2.2, 3.4), at },
            { k: "rest", pose: cleanestPose("sit", x), dur: this.rng.range(1.5, 3) },
          ];
        },
      });
    }

    // the pointer is resting up near the cat's head, a little way off: something to bat at (and not again for a while)
    const lure = world.pointer;
    if (here && roaming && lure && this.cooled("bat") && this.pointerStill >= PLAY_STILL_FOR) {
      const dx = lure.x - this.x;
      if (Math.abs(dx) >= 0.7 * L && Math.abs(dx) <= PLAY_REACH * L && lure.y <= here.y - 0.1 * L && lure.y >= here.y - 1.3 * L) {
        options.push({
          name: "bat",
          score: 1.4 * (0.5 + m.energy) * (1 - 0.7 * tired),
          plan: () => {
            const dir: 1 | -1 = dx >= 0 ? 1 : -1;
            const at = { x: lure.x, y: lure.y };
            // (it stands a paw's length from it)
            const from = clampToLedge(here, at.x - dir * 0.7 * L);
            if (Math.abs(at.x - from) > 1.05 * L) return null;
            this.cool.bat = this.now + this.rng.range(70, 130);
            return [
              ...(Math.abs(from - this.x) > 0.15 * L ? [{ k: "walk", x: from, run: false, maxT: 12, look: at } as const] : []),
              { k: "tap", at, dur: this.rng.range(2.2, 3.4) },
              { k: "rest", pose: "sit", dur: this.rng.range(1, 2.2) },
            ];
          },
        });
      }
    }

    // a poster on this shelf, a few lengths off, that is not the one the viewer is on: it goes up to it, looks over the lip, and pats it, once or twice (and the poster gives a little)
    if (here && roaming && world.targets.length > 0 && this.cooled("pat")) {
      const focus = world.focus;
      const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const standFor = (t: Target): number => centre(t.rect).x - (centre(t.rect).x >= this.x ? 1 : -1) * SWAT_REACH * L;
      const prey = world.targets.filter((t) => t.surfaceId === here.surfaceId && !(focus && overlaps(t.rect, focus)) && standFor(t) >= here.x0 && standFor(t) <= here.x1 && Math.abs(standFor(t) - this.x) <= 6 * L);
      if (prey.length > 0) {
        options.push({
          name: "pat",
          score: 0.3 * (0.4 + m.curiosity) * (0.4 + m.energy) * (1 - 0.7 * tired),
          plan: () => {
            const one = this.rng.pick(prey);
            if (!one) return null;
            const side: 1 | -1 = centre(one.rect).x >= this.x ? 1 : -1;
            const stand = standFor(one);
            const contact = this.swatPoint(one.rect, stand, here.y, side, L);
            this.swatFixes = 0;
            this.cool.pat = this.now + this.rng.range(80, 150);
            return [
              ...(Math.abs(stand - this.x) > 0.3 * L ? [{ k: "walk", x: stand, run: false, maxT: 25, look: contact } as const] : []),
              { k: "shot", clip: "peek", dur: this.rng.range(1.2, 2), at: contact },
              { k: "swat", target: one.rect, dur: SWAT_FIRST, id: one.id },
              ...(this.rng.chance(0.4) ? [{ k: "swat", target: one.rect, dur: SWAT_SECOND, id: one.id } as const] : []),
              { k: "rest", pose: "sit", dur: this.rng.range(1.5, 3), ...(this.rng.chance(0.5) ? { feel: "tilt" as const } : {}) },
            ];
          },
        });
      }
    }

    // the zoomies: a lively cat now and then runs and leaps from shelf to shelf for no reason at all, and sits down, pleased with itself
    if (here && roaming && this.ledges.length > 1 && m.energy > 0.45 && this.cooled("zoomies")) {
      options.push({
        name: "zoomies",
        score: 0.28 * (m.energy - 0.3) * (1 - 0.8 * tired),
        plan: () => {
          const run = this.hopAround(world, this.rng.chance(0.5) ? 2 : 3);
          if (run.length === 0) return null;
          this.cool.zoomies = this.now + this.rng.range(110, 200);
          return [...run, { k: "rest", pose: "sit", dur: this.rng.range(2, 3.5), feel: "joy" }];
        },
      });
    }

    // (a thoughtful moment, now and then: a look away and up; where it sits, and only if its body hides none of the names there)
    const hides = Math.max(settledCost("sit", 1, this.x, this.y, L, world), settledCost("sit", -1, this.x, this.y, L, world));
    options.push({
      name: "ponder",
      score: this.cooled("ponder") && tired < 0.8 && hides <= CLEAN * L * L ? 0.28 : 0,
      plan: () => {
        this.cool.ponder = this.now + this.rng.range(40, 90);
        return [{ k: "rest", pose: "sit", dur: this.rng.range(3, 5.5), feel: "think" }];
      },
    });

    // (not the same thing twice in a row)
    const weighted = options.map((o) => ({ o, w: Math.max(0, o.score) * (last.startsWith(o.name) ? 0.35 : 1) }));
    for (let tries = 0; tries < 4; tries++) {
      const pick = this.rng.weighted(weighted, (c) => c.w);
      if (!pick) break;
      const plan = pick.o.plan();
      if (plan && plan.length > 0) {
        this.choice = pick.o.name;
        return plan;
      }
      pick.w = 0;
    }
    this.choice = "rest";
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
    // (a hand may hold the cat as long as it likes: it is the hand's act, and the silence of a hand that is gone ends it)
    if (this.actT > WATCHDOG && act.k !== "carried") {
      this.jump = null;
      this.fall = null;
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
      case "swat":
        this.stop(dt, L);
        this.setClip("swat");
        this.progress = clamp01(this.actT / act.dur);
        // (the page may have moved under it since the swat began: the paw lands where the poster is)
        this.reach = this.swatPoint(this.posterOf(world, act), this.x, this.y, this.facing, L);
        if (this.actT >= act.dur || world.reducedMotion) this.finish();
        break;
      case "tap": {
        this.stop(dt, L);
        this.setClip("tap");
        // (the paw goes where the pointer goes, for as long as it is there to be batted at: not behind the cat, nor off out of reach)
        const point = world.pointer;
        const ahead = point ? (point.x - this.x) * this.facing : 0;
        if (!point || this.actT >= act.dur || world.quiet || world.reducedMotion || world.mode !== "browse" || ahead < 0.25 * L || ahead > (PLAY_REACH + 0.4) * L || Math.abs(point.y - (this.y - 0.6 * L)) > 1.6 * L) {
          this.finish();
          break;
        }
        this.reach = { x: point.x, y: point.y };
        this.lookAt(this.reach, 0.4);
        break;
      }
      case "walk":
        this.walk(world, act, dt);
        break;
      case "jump":
        this.runJump(world, dt);
        break;
      case "carried":
        this.carry(world, dt);
        break;
      case "fall":
        this.runFall(world, dt);
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
    // (a cat that the page has left outside its shelf, by a window made smaller under a walk to a place that is off the screen now, runs back in rather than stroll, cut by the edge of the screen all the way)
    const hurry = !act.stalk && (act.run || Math.abs(clampToLedge(ledge, this.x) - this.x) > 0.4 * L);
    this.setClip(act.stalk ? "stalk" : hurry ? "run" : "walk");
    // a cat going one way that must go the other brakes first, then turns
    if (dir !== this.facing) {
      if (Math.abs(this.vx) > 0.25 * L) {
        this.stop(dt, L);
        return;
      }
      this.facing = dir;
    }
    const cruise = (act.stalk ? STALK_SPEED : hurry ? RUN_SPEED : WALK_SPEED) * L;
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
    // (the eyes are on the place it is going to, all the way)
    this.lookAt({ x: toX, y: to.y - 0.35 * world.bodyLength }, total);
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
