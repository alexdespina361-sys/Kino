import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export class RateLimiter implements Keepable {
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;
  private before: { hits: Map<string, number[]>; name: (key: string) => string; until: number } | undefined;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    name?: string,
  ) {
    if (name) keeper?.take(name, this);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    let list = this.hits.get(key) ?? [];
    if (this.before) {
      if (this.now() > this.before.until) this.before = undefined;
      else {
        const named = this.before.name(key);
        const had = this.before.hits.get(named);
        if (had) {
          this.before.hits.delete(named);
          list = [...had, ...list].sort((a, b) => a - b);
        }
      }
    }
    list = list.filter((at) => at > cutoff);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
  wait(key: string): number {
    const list = this.recent(key);
    return list.length >= this.max ? Math.max(1, list[list.length - this.max]! + this.windowMs - this.now()) : 0;
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (++this.sinceSweep > 500) this.sweep();
  }

  undo(key: string): void {
    this.recent(key).pop();
  }

  reset(key: string): void {
    this.recent(key);
    this.hits.delete(key);
  }

  kept(name: (key: string) => string): unknown {
    this.sweep();
    const all: Array<[string, number[]]> = [...this.hits].map(([key, list]) => [name(key), list]);
    const cutoff = this.now() - this.windowMs;
    for (const [named, list] of this.before?.hits ?? []) if (list.some((at) => at > cutoff)) all.push([named, list.filter((at) => at > cutoff)]);
    return all.slice(-KEPT_KEYS_MAX);
  }

  restore(data: unknown, name: (key: string) => string): void {
    if (!Array.isArray(data)) return;
    const now = this.now();
    const hits = new Map<string, number[]>();
    for (const entry of data.slice(-KEPT_KEYS_MAX)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
      const list = entry[1].filter((at): at is number => Number.isFinite(at) && at > now - this.windowMs && at <= now + SKEW_MS).slice(-this.max);
      if (list.length > 0) hits.set(entry[0], list);
    }
    if (hits.size > 0) this.before = { hits, name, until: now + this.windowMs + SKEW_MS };
  }

  private sweep(): void {
    this.sinceSweep = 0;
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

export class WorkBudget implements Keepable {
  private spent: Array<{ at: number; ms: number }> = [];

  constructor(
    private readonly maxMs: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    name?: string,
  ) {
    if (name) keeper?.take(name, this);
  }

  kept(): unknown {
    this.wait();
    return this.spent.slice(-KEPT_KEYS_MAX).map((each) => [each.at, each.ms]);
  }

  restore(data: unknown): void {
    if (!Array.isArray(data)) return;
    const now = this.now();
    const had = data
      .slice(-KEPT_KEYS_MAX)
      .filter((each): each is [number, number] => Array.isArray(each) && Number.isFinite(each[0]) && Number.isFinite(each[1]) && each[0] > now - this.windowMs && each[0] <= now + SKEW_MS && each[1] > 0)
      .map(([at, ms]) => ({ at, ms: Math.min(ms, this.maxMs) }));
    this.spent = [...had, ...this.spent].sort((a, b) => a.at - b.at);
  }

  wait(): number {
    const cutoff = this.now() - this.windowMs;
    this.spent = this.spent.filter((each) => each.at > cutoff);
    let over = this.spent.reduce((all, each) => all + each.ms, 0) - this.maxMs;
    if (over < 0) return 0;
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

const DAY_MS = 24 * 60 * 60 * 1000;

export class DayCount implements Keepable {
  private day = -1;
  private readonly counts = new Map<string, number>();
  private before: { day: number; counts: Map<string, number>; name: (key: string) => string } | undefined;

  constructor(
    private readonly max: number,
    private readonly now: () => number = Date.now,
    name?: string,
    private readonly keysMax = 100_000,
  ) {
    if (name) keeper?.take(name, this);
  }

  private today(): Map<string, number> {
    const day = Math.floor(this.now() / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.counts.clear();
    }
    if (this.before && this.before.day !== day) this.before = undefined;
    return this.counts;
  }

  count(key: string): number {
    const counts = this.today();
    if (this.before) {
      const named = this.before.name(key);
      const old = this.before.counts.get(named);
      if (old !== undefined) {
        this.before.counts.delete(named);
        if (this.before.counts.size === 0) this.before = undefined;
        this.put(counts, key, (counts.get(key) ?? 0) + old);
      }
    }
    return counts.get(key) ?? 0;
  }

  wait(key: string, by = 1): number {
    return this.count(key) + by > this.max ? Math.max(1, (this.day + 1) * DAY_MS - this.now()) : 0;
  }

  hit(key: string, by = 1): void {
    if (by > 0) this.put(this.today(), key, this.count(key) + by);
  }

  undo(key: string, by = 1): void {
    const left = this.count(key) - by;
    if (left > 0) this.counts.set(key, left);
    else this.counts.delete(key);
  }

  private put(counts: Map<string, number>, key: string, value: number): void {
    if (!counts.has(key) && counts.size >= this.keysMax) {
      const first = counts.keys().next();
      if (!first.done) counts.delete(first.value);
    }
    counts.set(key, value);
  }

  kept(name: (key: string) => string): unknown {
    const counts = this.today();
    const all: Array<[string, number]> = [...counts].map(([key, value]) => [name(key), value]);
    for (const each of this.before?.counts ?? []) all.push(each);
    return all.length === 0 ? [] : [this.day, all.slice(-KEPT_KEYS_MAX)];
  }

  restore(data: unknown, name: (key: string) => string): void {
    if (!Array.isArray(data) || !Array.isArray(data[1])) return;
    const day = Math.floor(this.now() / DAY_MS);
    if (data[0] !== day) return;
    const counts = new Map<string, number>();
    for (const entry of (data[1] as unknown[]).slice(-KEPT_KEYS_MAX)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Number.isSafeInteger(entry[1]) || (entry[1] as number) <= 0) continue;
      counts.set(entry[0], Math.min(entry[1] as number, this.max));
    }
    if (counts.size > 0) this.before = { day, counts, name };
  }
}

const KEPT_KEYS_MAX = 20_000;
const SKEW_MS = 60_000;

export interface Keepable {
  kept(name: (key: string) => string): unknown;
  restore(data: unknown, name: (key: string) => string): void;
}

let keeper: LimitKeeper | undefined;
export function keepOverRestart(name: string, thing: Keepable): void {
  keeper?.take(name, thing);
}

export function keepLimitsIn(next: LimitKeeper | undefined): void {
  keeper = next;
}

export class LimitKeeper {
  private readonly named = new Map<string, Keepable>();
  private readonly had: Record<string, unknown>;
  private readonly salt: string;
  private timer: NodeJS.Timeout | undefined;
  private failed = false;

  constructor(
    private readonly file: string | undefined,
    loaded?: { salt?: unknown; limits?: unknown },
    private readonly warn: (message: string) => void = () => undefined,
  ) {
    this.salt = typeof loaded?.salt === "string" && loaded.salt.length >= 16 ? loaded.salt : randomBytes(24).toString("base64url");
    this.had = typeof loaded?.limits === "object" && loaded.limits !== null && typeof loaded.salt === "string" ? { ...(loaded.limits as Record<string, unknown>) } : {};
  }

  static open(file: string, warn?: (message: string) => void): LimitKeeper {
    try {
      return new LimitKeeper(file, JSON.parse(readFileSync(file, "utf8")) as { salt?: unknown; limits?: unknown }, warn);
    } catch {
      return new LimitKeeper(file, undefined, warn);
    }
  }

  private readonly name = (key: string): string => createHmac("sha256", this.salt).update(key).digest("base64url").slice(0, 22);

  take(name: string, limiter: Keepable): void {
    if (this.named.has(name)) return;
    this.named.set(name, limiter);
    const had = this.had[name];
    if (had === undefined) return;
    delete this.had[name];
    try {
      limiter.restore(had, this.name);
    } catch {
    }
  }

  get names(): string[] {
    return [...this.named.keys()];
  }

  view(): { v: 1; salt: string; limits: Record<string, unknown> } {
    const limits: Record<string, unknown> = {};
    for (const [name, limiter] of this.named) {
      const kept = limiter.kept(this.name);
      if (Array.isArray(kept) && kept.length > 0) limits[name] = kept;
    }
    return { v: 1, salt: this.salt, limits };
  }

  save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const beside = `${this.file}.new`;
      writeFileSync(beside, JSON.stringify(this.view()), { mode: 0o600 });
      renameSync(beside, this.file);
      this.failed = false;
    } catch (error) {
      if (!this.failed) this.warn(`The limits could not be written down (${error instanceof Error ? error.message : String(error)}); a restart begins them again.`);
      this.failed = true;
    }
  }

  every(ms: number): void {
    this.stop();
    this.timer = setInterval(() => this.save(), ms);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}