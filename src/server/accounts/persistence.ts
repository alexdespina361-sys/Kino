import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where accounts are kept between restarts. Everything is a document: a key and a JSON value. The store holds all of them
 * in memory and tells this what changed; this only has to keep them somewhere.
 *
 * The three homes: nowhere (tests, `DATA_DIR=memory`), a JSON file (a PC, or a host with a disk that stays), and Postgres
 * (`DATABASE_URL`, for a host whose disk is wiped on every restart, like a free Render instance).
 */
export interface Persistence {
  /** Everything stored: key -> value. */
  load(): Promise<Map<string, unknown>>;
  /** Store these, forget these. */
  save(changes: { put: Map<string, unknown>; remove: Set<string> }): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  readonly docs = new Map<string, unknown>();
  async load() {
    return new Map(this.docs);
  }
  async save({ put, remove }: { put: Map<string, unknown>; remove: Set<string> }) {
    for (const [key, value] of put) this.docs.set(key, structuredClone(value));
    for (const key of remove) this.docs.delete(key);
  }
}

/** One JSON file, rewritten whole through a temporary file so a crash never leaves half of it. */
export class FilePersistence implements Persistence {
  private docs = new Map<string, unknown>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly log: { warn(message: string): void } = console,
  ) {}

  async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.docs = new Map(Object.entries(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // A file that cannot be read is kept aside, never overwritten: the next save starts a new one.
        const aside = `${this.file}.unreadable-${Date.now()}`;
        await rename(this.file, aside).catch(() => {});
        this.log.warn(`Could not read ${this.file} (${(error as Error).message}); moved it to ${aside} and started empty.`);
      }
    }
    return new Map(this.docs);
  }

  save({ put, remove }: { put: Map<string, unknown>; remove: Set<string> }) {
    for (const [key, value] of put) this.docs.set(key, value);
    for (const key of remove) this.docs.delete(key);
    // One write at a time, each of the whole file as it is by then.
    this.writing = this.writing.catch(() => {}).then(() => this.write());
    return this.writing;
  }

  private async write() {
    await mkdir(path.dirname(this.file), { recursive: true });
    // The data is private (password hashes): keep it out of a repository that happens to contain the folder.
    await writeFile(path.join(path.dirname(this.file), ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(this.docs)), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

/** The part of a Postgres client this needs: `pg`'s Pool and Client have it, and so does PGlite (which the tests use). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end?(): Promise<void>;
}

export class PostgresPersistence implements Persistence {
  constructor(private readonly db: SqlClient) {}

  async load() {
    await this.db.query("create table if not exists kino_docs (key text primary key, value jsonb not null)");
    const { rows } = await this.db.query("select key, value from kino_docs");
    return new Map(rows.map((row) => [String(row.key), row.value] as const));
  }

  async save({ put, remove }: { put: Map<string, unknown>; remove: Set<string> }) {
    if (put.size > 0) {
      await this.db.query(
        "insert into kino_docs (key, value) select * from unnest($1::text[], $2::jsonb[]) on conflict (key) do update set value = excluded.value",
        [[...put.keys()], [...put.values()].map((value) => JSON.stringify(value))],
      );
    }
    if (remove.size > 0) await this.db.query("delete from kino_docs where key = any($1::text[])", [[...remove]]);
  }

  async close() {
    await this.db.end?.();
  }
}

/**
 * Pick the home from the environment: `DATABASE_URL` (Postgres), else `DATA_DIR` (a folder; `memory` means nowhere), else a
 * `data` folder next to where the server was started.
 */
export async function persistenceFromEnv(env: NodeJS.ProcessEnv = process.env, log: { warn(message: string): void } = console): Promise<{ persistence: Persistence; describe: string }> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    // Hosted databases (Neon, Supabase, Render) want TLS; a local one usually does not. `sslmode` in the URL decides.
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4, ssl: /sslmode=(disable|allow)|localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? undefined : { rejectUnauthorized: false } });
    // A database that sleeps (Neon's free one does after a few quiet minutes) drops idle connections; without this that would crash the server.
    pool.on("error", (error) => log.warn(`Postgres: ${error.message}`));
    return { persistence: new PostgresPersistence(pool), describe: "Postgres (DATABASE_URL)" };
  }
  // A free Render instance starts from a clean disk at every deploy and restart; the usual mistake is to leave the file where it is.
  if (env.RENDER && env.DATA_DIR === undefined) {
    log.warn("Render wipes this server's disk on every deploy and restart, so accounts kept in a file are lost with it. Set DATABASE_URL to a Postgres (Neon or Supabase have free ones), or put DATA_DIR on a persistent disk.");
  }
  const dir = env.DATA_DIR ?? "data";
  if (dir === "memory") return { persistence: new MemoryPersistence(), describe: "memory only (accounts are lost when the server stops)" };
  const file = path.resolve(dir, "kino.json");
  return { persistence: new FilePersistence(file, log), describe: `file ${file}` };
}
