import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import { BROWSERS_PER_ADDRESS } from "./live";

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
  watched?: number;
}
/** Who has been counted today (see `hashOf`), and the salt they were hashed with. Only ever one of these, today's. */
interface SeenDoc {
  v: 1;
  day: string;
  salt: string;
  hashes: string[];
  /** How many visitors each address was counted as today, by a hash of the address alone (see `BROWSERS_PER_ADDRESS`). None in a day written before 18 Nov. */
  addresses?: Array<[string, number]>;
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
  /** Seconds of film the signed-in profiles played that day, all of them together (see `watched`). None on a day before it was counted. */
  watched?: number;
}

export class VisitCounter {
  private readonly days = new Map<string, DayVisits>();
  private seen: { day: string; salt: string; hashes: Set<string>; addresses: Map<string, number> } | undefined;
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
          if (typeof doc.day === "string" && Number.isFinite(doc.visitors) && Number.isFinite(doc.loads)) this.days.set(doc.day, { visitors: doc.visitors, loads: doc.loads, ...(typeof doc.watched === "number" && Number.isFinite(doc.watched) && doc.watched > 0 ? { watched: doc.watched } : {}) });
        } else if (key.startsWith("seen:")) {
          // Today's carries on (a restart must not count the same people twice); any other is a day that is over, and goes.
          const doc = value as SeenDoc;
          if (doc.day === today && typeof doc.salt === "string") {
            const addresses = (Array.isArray(doc.addresses) ? doc.addresses : []).filter((each): each is [string, number] => Array.isArray(each) && typeof each[0] === "string" && Number.isSafeInteger(each[1]) && each[1] > 0);
            this.seen = { day: doc.day, salt: doc.salt, hashes: new Set(doc.hashes.filter((hash) => typeof hash === "string")), addresses: new Map(addresses) };
          }
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
    return this.seen && key === `seen:${this.seen.day}` ? { v: 1, day: this.seen.day, salt: this.seen.salt, hashes: [...this.seen.hashes], addresses: [...this.seen.addresses] } : undefined;
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
  count(address: string, agent: string, language: string): void {
    const day = dayOf(this.now());
    this.rollOver(day);
    // A new day starts with a new salt, so today's visitors cannot be told from yesterday's.
    this.seen ??= { day, salt: randomBytes(18).toString("base64url"), hashes: new Set(), addresses: new Map() };
    const visits = this.days.get(day) ?? { visitors: 0, loads: 0 };
    this.days.set(day, visits);
    visits.loads++;
    const hash = hashOf(this.seen.salt, address, agent, language);
    // (An address is a few visitors at most: one that gives its browser a new name at each load is still one of them. The review of 18 Nov.)
    const from = hashOf(this.seen.salt, address, "", "");
    const counted = this.seen.addresses.get(from) ?? 0;
    if (!this.seen.hashes.has(hash) && this.seen.hashes.size < MAX_VISITORS_A_DAY && counted < BROWSERS_PER_ADDRESS) {
      this.seen.hashes.add(hash);
      this.seen.addresses.set(from, counted + 1);
      visits.visitors++;
      this.touch(`seen:${day}`);
    }
    this.touch(`visits:${day}`);
  }

  /**
   * Some seconds of film were played by a signed-in profile (the accounts say so as its progress comes in: `AccountStore.onWatched`). One number for the
   * day, of everybody together: not who, not what. A guest's watching is kept on the guest's own device and never comes here.
   */
  watched(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const day = dayOf(this.now());
    const visits = this.days.get(day) ?? { visitors: 0, loads: 0 };
    this.days.set(day, visits);
    visits.watched = Math.round((visits.watched ?? 0) + seconds);
    this.touch(`visits:${day}`);
  }

  /** What each day came to, and the first day there is a number for. */
  records(): { since: string | undefined; days: ReadonlyMap<string, DayVisits> } {
    return { since: [...this.days.keys()].sort()[0], days: this.days };
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
