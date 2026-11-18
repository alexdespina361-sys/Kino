import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import { BROWSERS_PER_ADDRESS } from "./live";

interface DayDoc {
  v: 1;
  day: string;
  visitors: number;
  loads: number;
  watched?: number;
}
interface SeenDoc {
  v: 1;
  day: string;
  salt: string;
  hashes: string[];
  addresses?: Array<[string, number]>;
}

export const MAX_VISITORS_A_DAY = 20_000;
const FLUSH_MS = 30_000;
const RETRY_MS = 30_000;

export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

function hashOf(salt: string, address: string, agent: string, language: string): string {
  return createHash("sha256").update([salt, address, agent.slice(0, 300), language.slice(0, 100)].join("\0")).digest("base64url").slice(0, 16);
}

export interface VisitCounterOptions {
  persistence: Persistence;
  now?: () => number;
  flushMs?: number;
  log?: { warn(message: string): void };
}

export interface DayVisits {
  visitors: number;
  loads: number;
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

  rollOver(today = dayOf(this.now())): void {
    if (!this.seen || this.seen.day === today) return;
    this.forget(`seen:${this.seen.day}`);
    this.seen = undefined;
  }

  private watchMidnight() {
    if (this.options.flushMs <= 0) return;
    const midnight = Date.parse(dayOf(this.now())) + 24 * 3600 * 1000;
    this.midnight = setTimeout(() => {
      this.rollOver();
      this.watchMidnight();
    }, midnight + 1000 - this.now());
    this.midnight.unref?.();
  }

  count(address: string, agent: string, language: string): void {
    const day = dayOf(this.now());
    this.rollOver(day);
    this.seen ??= { day, salt: randomBytes(18).toString("base64url"), hashes: new Set(), addresses: new Map() };
    const visits = this.days.get(day) ?? { visitors: 0, loads: 0 };
    this.days.set(day, visits);
    visits.loads++;
    const hash = hashOf(this.seen.salt, address, agent, language);
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

  watched(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const day = dayOf(this.now());
    const visits = this.days.get(day) ?? { visitors: 0, loads: 0 };
    this.days.set(day, visits);
    visits.watched = Math.round((visits.watched ?? 0) + seconds);
    this.touch(`visits:${day}`);
  }

  records(): { since: string | undefined; days: ReadonlyMap<string, DayVisits> } {
    return { since: [...this.days.keys()].sort()[0], days: this.days };
  }
}

export function visitsPersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_visits");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "visits.json"));
  return new MemoryPersistence();
}
