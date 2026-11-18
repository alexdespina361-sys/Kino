import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * "No more than `max` of these in `windowMs`", counted per key (an address, an e-mail). In memory; one that is given a name is also kept over a
 * restart by the `LimitKeeper` the server was started with (a restart is every push: without it a day's allowance would begin again each time).
 */
export class RateLimiter implements Keepable {
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;
  /** What was counted before the restart, by the names the keeper gave the keys: each is taken up the first time its key is asked about. */
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
    this.recent(key); // (what was counted before a restart is taken up first, and forgotten with the rest)
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
      // (only moments that can still count: inside the window, and not after now)
      const list = entry[1].filter((at): at is number => Number.isFinite(at) && at > now - this.windowMs && at <= now + SKEW_MS).slice(-this.max);
      if (list.length > 0) hits.set(entry[0], list);
    }
    if (hits.size > 0) this.before = { hits, name, until: now + this.windowMs + SKEW_MS };
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

/* ------------------------------ kept over a restart ------------------------------ */

/** How many keys of one limiter are written down, the newest: a file that somebody could make grow is not kept whole. */
const KEPT_KEYS_MAX = 20_000;
/** A moment a little after now is taken as now (two clocks); one further ahead was not written by this server. */
const SKEW_MS = 60_000;

/** What the keeper asks of a limiter: what it counted, with the keys named the keeper's way, and to take that back after a restart. */
export interface Keepable {
  kept(name: (key: string) => string): unknown;
  restore(data: unknown, name: (key: string) => string): void;
}

let keeper: LimitKeeper | undefined;
/** Something else that counts and is worth keeping over a restart (the hours of the owner's page) gives its name to the keeper, if there is one. */
export function keepOverRestart(name: string, thing: Keepable): void {
  keeper?.take(name, thing);
}

/** The keeper the limiters made from now on give their names to (`index.ts`, once, before the app is built). None in a test: nothing is kept. */
export function keepLimitsIn(next: LimitKeeper | undefined): void {
  keeper = next;
}

/**
 * Writes down what the named limiters counted, and gives it back to them after a restart, so that a push does not forgive everybody: the wrong
 * passwords and PINs, the sign-ups and reports of the hour, the day's allowances. One small file, written when the server stops and every minute
 * (a server that is killed loses a minute at most). The keys (addresses, names, accounts) are not written as they are: each is a code made of it
 * with a secret of this file's own, which is enough to know the same key again and says nothing to who reads a line of it. Nothing in it lasts
 * longer than its limiter's window (a day at most).
 */
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

  /** The keeper of this file: with what it holds, or with nothing when it is not there or cannot be read (a keeper that starts empty is no failure). */
  static open(file: string, warn?: (message: string) => void): LimitKeeper {
    try {
      return new LimitKeeper(file, JSON.parse(readFileSync(file, "utf8")) as { salt?: unknown; limits?: unknown }, warn);
    } catch {
      return new LimitKeeper(file, undefined, warn);
    }
  }

  private readonly name = (key: string): string => createHmac("sha256", this.salt).update(key).digest("base64url").slice(0, 22);

  /** A limiter says its name (once: a second one of the same name is not kept) and takes up what was counted under it before the restart. */
  take(name: string, limiter: Keepable): void {
    if (this.named.has(name)) return;
    this.named.set(name, limiter);
    const had = this.had[name];
    if (had === undefined) return;
    delete this.had[name];
    try {
      limiter.restore(had, this.name);
    } catch {
      // (what cannot be taken back is let go: the limiter begins again, as it did before there was a keeper)
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

  /** Written whole to a file beside it, then put in its place: a server stopped half way leaves the old one. Only the server's own user may read it. */
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

  /** Saves now and then until `stop`. */
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