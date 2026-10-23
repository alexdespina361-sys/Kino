/**
 * Scrolling with nothing but a pointer. A screen that can only move a mouse and click (no wheel, and no remote's keys: a TV in its pointer mode,
 * an air mouse) cannot scroll a page, so it scrolls by resting the pointer against the top or bottom edge of the screen for a moment. This is the
 * rule of that, apart from the page it scrolls (`EdgeWorld`; the DOM and the stylesheet are in EdgeScrollHint.tsx).
 *
 * It must be no surprise to anybody else, so it starts only from a pointer that has just moved into the strip, and everything else that gets a
 * person about ends it: a key, a press, a finger, or leaving the strip. After one of those the pointer has to go out of the strip and come back
 * before it counts again (a pointer left lying at the edge while the remote is used, or after a click, moves nothing). A wheel turned once ends
 * it for good (`retire`): a screen with a wheel or a trackpad has no use for it, and is never bothered by it again.
 */

export type Edge = "top" | "bottom";

/** How long the pointer rests in the strip before the page moves: one that is only passing, or that stops to press something, moves nothing. */
export const DWELL_MS = 1000;
/** Screens a second. It starts gently, so the end of the wait is no jolt, and goes faster the longer it has been moving (a long page is a long way). */
export const SLOWEST = 0.5;
export const FASTEST = 1.6;
export const RAMP_MS = 2500;
/** A pointer is out of the strip only when it is this many strips from the edge: a hand shakes. */
const LEAVE_AT = 2;
/** A frame that took longer than this was a stall, not time the page should have moved through. */
const MAX_STEP_MS = 64;
/** How often a pointer that waits looks at the page again (it changes under a pointer that rests)... */
export const LOOK_MS = 150;
/** ...and how often one that finds nothing to scroll, or a page at its end, does (the library brings more rows as a page nears its end, and a pointer that rests goes on then). */
export const IDLE_MS = 400;

/** How thick the strip is on a screen `height` tall: thin, so that only a pointer that is pushed against the edge is in it (and not one that is on the way to the buttons of the corner). */
export const stripOf = (height: number): number => Math.round(Math.min(40, Math.max(16, height * 0.025)));

/** The edge the pointer at `y` is in, or none. One that is in it stays in it until it is well out: `was` is the edge it was in. */
export function edgeAt(y: number, height: number, was: Edge | null = null): Edge | null {
  const strip = stripOf(height);
  if (y <= (was === "top" ? strip * LEAVE_AT : strip)) return "top";
  if (y >= height - (was === "bottom" ? strip * LEAVE_AT : strip)) return "bottom";
  return null;
}

/** How many screens a second the page moves once it has been moving for `movingMs`. */
export const speedAt = (movingMs: number): number => SLOWEST + (FASTEST - SLOWEST) * Math.min(1, Math.max(0, movingMs / RAMP_MS));

/** What the machine needs of the thing it scrolls. */
export interface Page {
  /** Whether it can still go that way. */
  room(edge: Edge): boolean;
  /** How tall the part of it that shows is. */
  shown(): number;
  /** Moves it by this many whole pixels (down when positive). */
  by(pixels: number): void;
}

export interface EdgeWorld {
  /** The page the pointer at `x`, against `edge`, would scroll: null where nothing scrolls. */
  pageFor(edge: Edge, x: number): Page | null;
}

/** What is told to the person: that the pointer is in the strip of an edge and a page would scroll from it (`moving`: it does). */
export interface EdgeHint {
  edge: Edge;
  moving: boolean;
}

/** Where the pointer is, as a move of it says. */
export interface PointerMove {
  x: number;
  y: number;
  /** The size of the screen. */
  height: number;
  /** A mouse: a finger and a pen are no pointer that rests. */
  mouse: boolean;
  /**
   * Whether a button is held (a drag: of the bar of the picture, of a selection), or the pointer is on something that opens under a pointer that rests
   * (the menu): nobody is waiting for a page to move. Asked only of a pointer that is in a strip, so that the rest of its moves cost nothing.
   */
  busy: () => boolean;
}

export class EdgeScroll {
  private edge: Edge | null = null;
  /** The pointer is in the strip, but a key, a wheel or a press has since said it is not to count until it has gone out and come back. */
  private spent = false;
  /** A wheel has turned: this screen has no need of it. */
  private retired = false;
  private x = 0;
  private page: Page | null = null;
  private looked = -Infinity;
  /** When the wait began: the hint was first shown for this stay in the strip. */
  private since: number | null = null;
  private moving = false;
  private movingSince = 0;
  private last = 0;
  private carry = 0;
  private hint: EdgeHint | null = null;

  constructor(
    private readonly world: EdgeWorld,
    private readonly show: (hint: EdgeHint | null) => void,
  ) {}

  /** The pointer moved. True when `frame` has something to look at now (it came into a strip). */
  move(point: PointerMove): boolean {
    if (this.retired) return false;
    if (!point.mouse) return this.stand();
    this.x = point.x;
    let edge = edgeAt(point.y, point.height, this.edge);
    if (edge && point.busy()) edge = null;
    if (edge === this.edge) return false;
    this.begin(edge);
    return edge !== null;
  }

  /** A key was pressed, or a button went down: somebody is using something else, and what rests in a strip waits for the pointer to leave it and come back. */
  other(): void {
    if (this.edge === null || this.spent) return;
    this.spent = true;
    this.halt();
  }

  /** The wheel turned: whoever it is can scroll without this, and it is not offered to them again (until the page is opened anew). */
  retire(): void {
    this.retired = true;
    this.begin(null);
  }

  /** The pointer left the page, or the page lost the screen, or a finger is on it: there is no pointer that rests. */
  stand(): boolean {
    this.begin(null);
    return false;
  }

  /**
   * One look at the page and, when it is time, one step along it. Returns when to look again: `null` for never (nothing waits), 0 for the next frame,
   * or after that many milliseconds.
   */
  frame(now: number): number | null {
    const edge = this.edge;
    if (edge === null || this.spent) return null;
    if (!this.page || now - this.looked >= LOOK_MS) {
      this.page = this.world.pageFor(edge, this.x);
      this.looked = now;
    }
    const page = this.page;
    if (!page || !page.room(edge)) {
      // No page goes this way, or it is at its end: nothing to say, and the wait (when it has not begun to move) is counted again from when there is.
      this.page = null;
      if (!this.moving) this.since = null;
      this.tell(null);
      return IDLE_MS;
    }
    if (!this.moving) {
      this.since ??= now;
      this.tell({ edge, moving: false });
      const left = DWELL_MS - (now - this.since);
      if (left > 0) return Math.min(LOOK_MS, left);
      this.moving = true;
      this.movingSince = now;
      this.last = now;
      this.carry = 0;
    }
    const step = Math.min(MAX_STEP_MS, Math.max(0, now - this.last));
    this.last = now;
    const want = speedAt(now - this.movingSince) * page.shown() * (step / 1000) + this.carry;
    const whole = Math.trunc(want);
    this.carry = want - whole;
    if (whole > 0) page.by(edge === "bottom" ? whole : -whole);
    this.tell({ edge, moving: true });
    return 0;
  }

  /** Into a strip, or out of any (null): what was going on is over, and a new stay begins. */
  private begin(edge: Edge | null): void {
    this.halt();
    this.edge = edge;
    this.spent = false;
  }

  private halt(): void {
    this.page = null;
    this.looked = -Infinity;
    this.since = null;
    this.moving = false;
    this.tell(null);
  }

  private tell(hint: EdgeHint | null): void {
    const before = this.hint;
    if (before === hint || (before && hint && before.edge === hint.edge && before.moving === hint.moving)) return;
    this.hint = hint;
    this.show(hint);
  }
}
