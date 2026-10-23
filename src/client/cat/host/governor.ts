/**
 * Keeps the cat from costing the screen more than it is worth. It is told, after every frame, what the cat's frame cost (the brain and the paint,
 * in milliseconds) and how long the screen took to come round to the next one, and decides how the cat is drawn: in full, at half the rate with
 * plain pixels (a TV that is slow), or not at all (a screen that cannot spare it). A frame that is slow once is nothing; it takes a stretch of
 * them to change anything, and a worse picture is not given back until a longer stretch of good ones. Pure: the numbers in, a decision out.
 */

export type Quality = "full" | "low" | "off";

export interface GovernorOptions {
  /** Milliseconds a frame of the cat may cost on average before it is made cheaper. */
  budget: number;
}

/** How many frames after the start, or a change of quality, are not counted. */
const WARM_UP = 8;

export class Governor {
  quality: Quality = "full";
  private cost = 0;
  private samples = 0;
  private slow = 0;
  private fast = 0;
  private warm = 0;

  constructor(private readonly options: GovernorOptions) {}

  /** Report one frame. Returns the quality to use from now on. */
  note(costMs: number, gapMs: number): Quality {
    if (this.quality === "off") return "off";
    // a frame that was waited for (the tab was in the background, the screen slept) says nothing of what the cat costs
    if (gapMs > 250) return this.quality;
    // the first few pictures after the start (or a change of picture) are the browser getting ready for them: they are not what the cat costs
    if (this.warm < WARM_UP) {
      this.warm++;
      return this.quality;
    }
    this.cost = this.samples === 0 ? costMs : this.cost * 0.95 + costMs * 0.05;
    this.samples++;
    if (this.samples < 30) return this.quality;
    const over = this.quality === "full" ? this.options.budget : this.options.budget * 1.6;
    if (this.cost > over) {
      this.slow++;
      this.fast = 0;
    } else if (this.cost < this.options.budget * 0.75 && this.quality === "low") {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - 1);
      this.fast = Math.max(0, this.fast - 1);
    }
    // about 120 frames of being over (two seconds on a screen of sixty) is a reason to go down; many more of being well under to go back up
    if (this.slow > 120) {
      this.quality = this.quality === "full" ? "low" : "off";
      this.reset();
    } else if (this.fast > 600) {
      this.quality = "full";
      this.reset();
    }
    return this.quality;
  }

  /** The average cost of a frame now, for the diagnostics. */
  get average(): number {
    return this.cost;
  }

  private reset(): void {
    this.samples = 0;
    this.slow = 0;
    this.fast = 0;
    this.warm = 0;
  }
}

/** What to do about a card that has taken the detailed cat's picture away: make the cat again now, wait a moment before trying, or be done with the card. */
export type Revive = "now" | "wait" | "never";

/** How many times the cat is made again in a stretch of `REVIVAL_WINDOW_MS`, a failed try counted, before the card is given up on. */
const REVIVALS = 3;
const REVIVAL_WINDOW_MS = 60_000;
/** The time a card is given between one try and the next: one that has just lost its pictures is often slow to give a new one. */
const REVIVAL_SPACING_MS = 1000;

/**
 * A card takes the detailed cat's picture away now and then: a phone does it when the page has been in the background, or when a film asks for the
 * memory. That says nothing of what the cat costs, and is no reason to be done with the detailed cat for good; a card that does it again and again
 * is, so the cat is made again but only so many times in a stretch, and not too soon after the last try. Pure: the time in, an answer out.
 */
export class Revival {
  private tries: number[] = [];

  /** Asked once for every frame that finds the picture gone; "now" counts as a try. */
  ask(time: number): Revive {
    this.tries = this.tries.filter((at) => time - at < REVIVAL_WINDOW_MS);
    if (this.tries.length >= REVIVALS) return "never";
    const last = this.tries[this.tries.length - 1];
    if (last !== undefined && time - last < REVIVAL_SPACING_MS) return "wait";
    this.tries.push(time);
    return "now";
  }
}
