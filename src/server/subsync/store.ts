import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeTimings, SharedTimingSchema, SUBSYNC_KEY, type SharedTiming } from "../../shared";
import { PostgresPersistence, type Persistence, type SqlClient } from "../accounts/persistence";

/**
 * The most timings kept; when there are more, the ones that were last used longest ago go. A timing is a few tens of kilobytes (about 30 for a
 * film, and 192 KiB is the most that is taken for the longest file there can be), so this is some tens of megabytes in practice and 200 at the
 * very most: a free Postgres (500 MB, shared with the accounts) has room for that.
 */
export const SUBSYNC_MAX_ENTRIES = 1000;
/** A timing counts as used again at most this often (a read of it is not a write to the disk or the database every time). */
const TOUCH_EVERY_MS = 3600_000;

/**
 * Where the shared timings of subtitle files are kept (see `shared/subsync.ts`). Apart from the accounts: there are many of them, a
 * few kilobytes each, and nothing in them is private, so they are read one at a time instead of all being held in memory.
 */
export interface SubsyncStore {
  get(key: string): Promise<SharedTiming | undefined>;
  /** Joins a timing to what is kept for the key. False when it is not for the same file as the one kept (a different number of lines). */
  merge(key: string, arrived: SharedTiming): Promise<boolean>;
}

/** Runs the jobs for one key one after the other: a join reads what is kept and writes it back, and two at once would lose one of them. */
class Turns {
  private readonly busy = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const turn = (this.busy.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
    this.busy.set(key, turn);
    const done = () => this.busy.get(key) === turn && this.busy.delete(key);
    void turn.then(done, done);
    return turn;
  }
}

/** Nowhere (tests, `DATA_DIR=memory`): gone when the server stops. */
export class MemorySubsyncStore implements SubsyncStore {
  private readonly timings = new Map<string, SharedTiming>();

  constructor(private readonly limit = SUBSYNC_MAX_ENTRIES) {}

  async get(key: string) {
    const timing = this.timings.get(key);
    if (timing) {
      // (Used: the one that has not been for longest is the first in the map.)
      this.timings.delete(key);
      this.timings.set(key, timing);
    }
    return timing;
  }

  async merge(key: string, arrived: SharedTiming) {
    const merged = mergeTimings(this.timings.get(key), arrived);
    if (!merged) return false;
    this.timings.delete(key);
    this.timings.set(key, merged);
    while (this.timings.size > this.limit) this.timings.delete(this.timings.keys().next().value as string);
    return true;
  }

  get size(): number {
    return this.timings.size;
  }
}

/** One small file to a timing, in a folder next to the accounts' file (a PC, or a host with a disk that stays). */
export class FileSubsyncStore implements SubsyncStore {
  private readonly turns = new Turns();
  private sinceSweep = 0;

  constructor(
    private readonly dir: string,
    private readonly limit = SUBSYNC_MAX_ENTRIES,
    private readonly log: { warn(message: string): void } = console,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string): string {
    // (Only ever a key that has the shape of one: nothing from a request can name another place.)
    if (!SUBSYNC_KEY.test(key)) throw new Error("not a key");
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string) {
    try {
      const file = this.file(key);
      const parsed = SharedTimingSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
      if (!parsed.success) return undefined;
      await this.touch(file);
      return parsed.data;
    } catch {
      return undefined;
    }
  }

  /** The age of a file is how long it is since it was used (see `sweep`): a read makes it new again, once an hour at most. */
  private async touch(file: string): Promise<void> {
    try {
      if (this.now() - (await stat(file)).mtimeMs > TOUCH_EVERY_MS) await utimes(file, new Date(), new Date());
    } catch {
      // (A file that cannot be touched is still read.)
    }
  }

  merge(key: string, arrived: SharedTiming) {
    return this.turns.run(key, () => this.write(key, arrived));
  }

  private async write(key: string, arrived: SharedTiming): Promise<boolean> {
    const kept = await this.get(key);
    const merged = mergeTimings(kept, arrived);
    if (!merged) return false;
    if (merged === kept) return true; // (nothing new in it)
    await mkdir(this.dir, { recursive: true });
    const file = this.file(key);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(merged));
    await rename(temporary, file);
    if (++this.sinceSweep >= 100) {
      this.sinceSweep = 0;
      void this.sweep().catch((error: Error) => this.log.warn(`Shared subtitle timings: ${error.message}`));
    }
    return true;
  }

  /** Forgets the timings that were used longest ago, down to nine tenths of the limit, when there are more than the limit. */
  private async sweep(): Promise<void> {
    const names = (await readdir(this.dir)).filter((name) => name.endsWith(".json"));
    if (names.length <= this.limit) return;
    const files = await Promise.all(names.map(async (name) => ({ name, at: (await stat(path.join(this.dir, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
    files.sort((a, b) => a.at - b.at);
    for (const { name } of files.slice(0, names.length - Math.floor(this.limit * 0.9))) await unlink(path.join(this.dir, name)).catch(() => {});
  }
}

/** A table in the accounts' Postgres (a host whose disk is wiped on every restart, like a free Render instance). */
export class PostgresSubsyncStore implements SubsyncStore {
  private readonly turns = new Turns();
  private ready: Promise<unknown> | undefined;
  private sinceSweep = 0;

  constructor(
    private readonly db: SqlClient,
    private readonly limit = SUBSYNC_MAX_ENTRIES,
  ) {}

  private table(): Promise<unknown> {
    this.ready ??= this.db
      .query("create table if not exists kino_subsync (key text primary key, value jsonb not null, used timestamptz not null default now())")
      .catch((error: unknown) => {
        this.ready = undefined; // (asked again next time)
        throw error;
      });
    return this.ready;
  }

  async get(key: string) {
    await this.table();
    // (One statement: the read makes the timing new again, once an hour at most.)
    const { rows } = await this.db.query(
      "with touched as (update kino_subsync set used = now() where key = $1 and used < now() - make_interval(secs => $2) returning 1) select value from kino_subsync where key = $1",
      [key, TOUCH_EVERY_MS / 1000],
    );
    const parsed = SharedTimingSchema.safeParse(rows[0]?.value);
    return parsed.success ? parsed.data : undefined;
  }

  /** One at a time for a key (this is the only server writing to the table): two timings that arrive together are both kept. */
  merge(key: string, arrived: SharedTiming) {
    return this.turns.run(key, () => this.write(key, arrived));
  }

  private async write(key: string, arrived: SharedTiming): Promise<boolean> {
    const kept = await this.get(key);
    const merged = mergeTimings(kept, arrived);
    if (!merged) return false;
    if (merged === kept) return true; // (nothing new in it)
    await this.db.query("insert into kino_subsync (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value, used = now()", [key, JSON.stringify(merged)]);
    if (++this.sinceSweep >= 100) {
      this.sinceSweep = 0;
      await this.db.query("delete from kino_subsync where key in (select key from kino_subsync order by used desc offset $1)", [Math.floor(this.limit * 0.9)]).catch(() => {});
    }
    return true;
  }
}

/**
 * Picks the home of the shared timings to match where the accounts are kept: Postgres, a folder (`subsync` next to the accounts' file),
 * or nowhere.
 */
export function subsyncStoreFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): SubsyncStore {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresSubsyncStore(persistence.db);
  if (kind === "file") return new FileSubsyncStore(path.resolve(env.DATA_DIR ?? "data", "subsync"));
  return new MemorySubsyncStore();
}
