/**
 * "No more than `max` of these in `windowMs`", counted per key (an address, an e-mail). In memory: a restart forgives
 * everyone, which is fine for slowing down someone guessing passwords.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** How long until this key may try again; 0 when it may now. Does not count as an attempt. */
  wait(key: string): number {
    const list = this.recent(key);
    return list.length >= this.max ? Math.max(1, list[list.length - this.max]! + this.windowMs - this.now()) : 0;
  }

  /** Count an attempt. */
  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (++this.sinceSweep > 500) this.sweep();
  }

  /** Take back the attempt counted last for this key: what it was counted for did not happen (the others stay). */
  undo(key: string): void {
    this.recent(key).pop();
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Forget the keys that have gone quiet, so the map cannot grow for ever. */
  private sweep(): void {
    this.sinceSweep = 0;
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

/**
 * "No more than `maxMs` of work in `windowMs`", for everybody together: what was spent is said after it was (`spend`), so the work under way when the
 * budget runs out is finished, and the next waits. In memory, as the limiter above.
 */
export class WorkBudget {
  private spent: Array<{ at: number; ms: number }> = [];

  constructor(
    private readonly maxMs: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** How long until more may be done; 0 when it may now. */
  wait(): number {
    const cutoff = this.now() - this.windowMs;
    this.spent = this.spent.filter((each) => each.at > cutoff);
    let over = this.spent.reduce((all, each) => all + each.ms, 0) - this.maxMs;
    if (over < 0) return 0;
    // (the oldest of what was spent leaves the window first: it may go on once enough of it has)
    for (const each of this.spent) {
      over -= each.ms;
      if (over < 0) return Math.max(1, each.at + this.windowMs - this.now());
    }
    return this.windowMs;
  }

  spend(ms: number): void {
    if (ms > 0) this.spent.push({ at: this.now(), ms });
  }
}
