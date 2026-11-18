export type Edge = "top" | "bottom";

export const DWELL_MS = 1000;
export const SLOWEST = 0.5;
export const FASTEST = 1.6;
export const RAMP_MS = 2500;
const LEAVE_AT = 2;
const MAX_STEP_MS = 64;
export const LOOK_MS = 150;
export const IDLE_MS = 400;

export const stripOf = (height: number): number => Math.round(Math.min(48, Math.max(24, height * 0.045)));

export function edgeAt(y: number, height: number, was: Edge | null = null): Edge | null {
  const strip = stripOf(height);
  if (y <= (was === "top" ? strip * LEAVE_AT : strip)) return "top";
  if (y >= height - (was === "bottom" ? strip * LEAVE_AT : strip)) return "bottom";
  return null;
}

export const speedAt = (movingMs: number): number => SLOWEST + (FASTEST - SLOWEST) * Math.min(1, Math.max(0, movingMs / RAMP_MS));

export interface Page {
  room(edge: Edge): boolean;
  shown(): number;
  by(pixels: number): void;
}

export interface EdgeWorld {
  pageFor(edge: Edge, x: number): Page | null;
}

export interface EdgeHint {
  edge: Edge;
  moving: boolean;
}

export interface PointerMove {
  x: number;
  y: number;
  height: number;
  mouse: boolean;
  busy: () => boolean;
}

export class EdgeScroll {
  private edge: Edge | null = null;
  private spent = false;
  private x = 0;
  private page: Page | null = null;
  private looked = -Infinity;
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

  move(point: PointerMove): boolean {
    if (!point.mouse) return this.stand();
    this.x = point.x;
    let edge = edgeAt(point.y, point.height, this.edge);
    if (edge && point.busy()) edge = null;
    if (edge === this.edge) return false;
    this.begin(edge);
    return edge !== null;
  }

  other(): void {
    if (this.edge === null || this.spent) return;
    this.spent = true;
    this.halt();
  }

  stand(): boolean {
    this.begin(null);
    return false;
  }

  frame(now: number): number | null {
    const edge = this.edge;
    if (edge === null || this.spent) return null;
    if (!this.page || now - this.looked >= LOOK_MS) {
      this.page = this.world.pageFor(edge, this.x);
      this.looked = now;
    }
    const page = this.page;
    if (!page || !page.room(edge)) {
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
