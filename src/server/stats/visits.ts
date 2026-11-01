import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";

/**
 * How many people come to the site, a number for each day and nothing more. A page load is turned into a hash of the visitor's address, browser and
 * language, salted with a secret made for the day; the hash is kept to tell a second load of the same day from a new visitor, and the day after it is
 * deleted together with its salt, so nothing that was kept can be turned back into an address, or tell today's visitor from yesterday's. What stays for
 * good is the number: `visits:<day>` = how many visitors and how many page loads. No cookie, nothing is put on the visitor's device.
 */

/** What one day came to. */
interface DayDoc {
  v: 1;
  day: string;
  visitors: number;
  loads: number;
}
/** Who has been counted today (see `hashOf`), and the salt they were hashed with. Only ever one of these, today's. */
interface SeenDoc {
  v: 1;
  day: string;
  salt: string;
  hashes: string[];
}

/** A day with more different visitors than this stops adding them (a flood of made-up browsers must not grow what is kept without end); the loads go on being counted. */
export const MAX_VISITORS_A_DAY = 20_000;
/** Changes wait this long before they are written: a busy day writes a few times a minute, not at every load. */
const FLUSH_MS = 30_000;
const RETRY_MS = 30_000;

/** The day a moment falls in (UTC), as `2026-11-01`. */
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Sixteen characters of a sha256: enough to tell one visitor of a day from another, and far too few to be a name for them. */
function hashOf(salt: string, address: string, agent: string, language: string): string {
  return createHash("sha256").update([salt, address, agent.slice(0, 300), language.slice(0, 100)].join("\0")).digest("base64url").slice(0, 16);
}

export interface VisitCounterOptions {
  persistence: Persistence;
  now?: () => number;
  /** How long changes wait before they are written (30 s unless set; 0 leaves the writing to whoever calls `flush`, which is what tests do). */
  flushMs?: number;
  log?: { warn(message: string): void };
}

export interface DayVisits {
  visitors: number;
  loads: number;
}

/** Where the visitor's address was read from: Cloudflare's header, the first of X-Forwarded-For, or the connection itself. */
export type AddressSource = "cloudflare" | "forwarded" | "connection";

export class VisitCounter {
  private readonly days = new Map<string, DayVisits>();
  /** How many loads each kind of address was behind since the server started: the way to see that a host's proxy gives the visitor's address (and not its own). */
  private readonly sources: Record<AddressSource, number> = { cloudflare: 0, forwarded: 0, connection: 0 };
  private seen: { day: string; salt: string; hashes: Set<string> } | undefined;
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private midnight: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(private readonly options: Required<Omit<VisitCounterOptions, "log">> & Pick<VisitCounterOptions, "log">) {}

  static async open(options: VisitCounterOptions): Promise<VisitCounter> {
    const counter = new VisitCounter({ now: Date.now, flushMs: FLUSH_MS, ...options });
    await counter.load();
    counter.watchMidnight();
    return counter;
  }

  private now() {
    return this.options.now();
  }

  private async load() {
    const today = dayOf(this.now());
    for (const [key, value] of await this.options.persistence.load()) {
      try {
        if (key.startsWith("visits:")) {
          const doc = value as DayDoc;
          if (typeof doc.day === "string" && Number.isFinite(doc.visitors) && Number.isFinite(doc.loads)) this.days.set(doc.day, { visitors: doc.visitors, loads: doc.loads });
        } else if (key.startsWith("seen:")) {
          // Today's carries on (a restart must not count the same people twice); any other is a day that is over, and goes.
          const doc = value as SeenDoc;
          if (doc.day === today && typeof doc.salt === "string") this.seen = { day: doc.day, salt: doc.salt, hashes: new Set(doc.hashes.filter((hash) => typeof hash === "string")) };
          else this.forget(key);
        }
      } catch {
        this.options.log?.warn(`Skipped an unreadable record (${key}).`);
      }
    }
  }

  /* ------------------------------ persistence ------------------------------ */

  private schedule(delay = this.options.flushMs) {
    if (this.options.flushMs <= 0) return;
    this.timer ??= setTimeout(() => void this.flush(), delay);
    this.timer.unref?.();
  }
  private touch(key: string) {
    this.removed.delete(key);
    this.dirty.add(key);
    this.schedule();
  }
  private forget(key: string) {
    this.dirty.delete(key);
    this.removed.add(key);
    this.schedule();
  }

  private docFor(key: string): DayDoc | SeenDoc | undefined {
    if (key.startsWith("visits:")) {
      const day = key.slice("visits:".length);
      const visits = this.days.get(day);
      return visits && { v: 1, day, ...visits };
    }
    return this.seen && key === `seen:${this.seen.day}` ? { v: 1, day: this.seen.day, salt: this.seen.salt, hashes: [...this.seen.hashes] } : undefined;
  }

  /** Write what changed. Resolves when it is written; a failure is kept to try again. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing = this.flushing.catch(() => {}).then(async () => {
      if (this.dirty.size === 0 && this.removed.size === 0) return;
      const put = new Map<string, unknown>();
      for (const key of this.dirty) {
        const doc = this.docFor(key);
        if (doc !== undefined) put.set(key, doc);
      }
      const remove = new Set(this.removed);
      this.dirty.clear();
      this.removed.clear();
      try {
        await this.options.persistence.save({ put, remove });
      } catch (error) {
        for (const key of put.keys()) if (!this.removed.has(key)) this.dirty.add(key);
        for (const key of remove) if (!this.dirty.has(key)) this.removed.add(key);
        this.options.log?.warn(`Could not save the visitor counts: ${(error as Error).message}`);
        this.schedule(RETRY_MS);
      }
    });
    return this.flushing;
  }

  async close() {
    if (this.midnight) clearTimeout(this.midnight);
    await this.flush();
    await this.options.persistence.close?.();
  }

  /* ------------------------------ counting ------------------------------ */

  /** The day is over: its hashes and its salt are forgotten. (A visit does it too, but a quiet night must not keep them until somebody comes.) */
  rollOver(today = dayOf(this.now())): void {
    if (!this.seen || this.seen.day === today) return;
    this.forget(`seen:${this.seen.day}`);
    this.seen = undefined;
  }

  /** Roll over a second after each midnight (UTC), for as long as the server runs. (Tests, which write by hand, call `rollOver` themselves.) */
  private watchMidnight() {
    if (this.options.flushMs <= 0) return;
    const midnight = Date.parse(dayOf(this.now())) + 24 * 3600 * 1000;
    this.midnight = setTimeout(() => {
      this.rollOver();
      this.watchMidnight();
    }, midnight + 1000 - this.now());
    this.midnight.unref?.();
  }

  /** One page load by this visitor. (The address, browser and language are only ever seen here, to be hashed.) */
  count(address: string, agent: string, language: string, source: AddressSource = "connection"): void {
    this.sources[source]++;
    const day = dayOf(this.now());
    this.rollOver(day);
    // A new day starts with a new salt, so today's visitors cannot be told from yesterday's.
    this.seen ??= { day, salt: randomBytes(18).toString("base64url"), hashes: new Set() };
    const visits = this.days.get(day) ?? { visitors: 0, loads: 0 };
    this.days.set(day, visits);
    visits.loads++;
    const hash = hashOf(this.seen.salt, address, agent, language);
    if (!this.seen.hashes.has(hash) && this.seen.hashes.size < MAX_VISITORS_A_DAY) {
      this.seen.hashes.add(hash);
      visits.visitors++;
      this.touch(`seen:${day}`);
    }
    this.touch(`visits:${day}`);
  }

  /** What each day came to, the first day there is a number for, and where the addresses came from since the server started. */
  records(): { since: string | undefined; days: ReadonlyMap<string, DayVisits>; sources: Readonly<Record<AddressSource, number>> } {
    return { since: [...this.days.keys()].sort()[0], days: this.days, sources: { ...this.sources } };
  }
}

/**
 * Where the counts are kept: next to the accounts, but not among them (they are loaded by nobody else, and the accounts' table would be read by
 * every start for nothing). A Postgres gets a table of its own on the connection the accounts use, a folder a file of its own, and memory is memory.
 */
export function visitsPersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    // (The accounts' pool is shared, so closing this one must not end it: the accounts close it.)
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_visits");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "visits.json"));
  return new MemoryPersistence();
}
