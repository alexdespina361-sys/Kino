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

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Forget the keys that have gone quiet, so the map cannot grow for ever. */
  private sweep(): void {
    this.sinceSweep = 0;
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}
