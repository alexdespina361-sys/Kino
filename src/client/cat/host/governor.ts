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

export class Governor {
  quality: Quality = "full";
  private cost = 0;
  private samples = 0;
  private slow = 0;
  private fast = 0;

  constructor(private readonly options: GovernorOptions) {}

  /** Report one frame. Returns the quality to use from now on. */
  note(costMs: number, gapMs: number): Quality {
    if (this.quality === "off") return "off";
    // a frame that was waited for (the tab was in the background, the screen slept) says nothing of what the cat costs
    if (gapMs > 250) return this.quality;
    this.cost = this.samples === 0 ? costMs : this.cost * 0.95 + costMs * 0.05;
    this.samples++;
    if (this.samples < 30) return this.quality;
    const over = this.quality === "full" ? this.options.budget : this.options.budget * 1.6;
    if (this.cost > over) {
      this.slow++;
      this.fast = 0;
    } else if (this.cost < this.options.budget * 0.5 && this.quality === "low") {
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
    } else if (this.fast > 900) {
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
  }
}
