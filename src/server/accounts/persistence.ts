import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Persistence {
  load(): Promise<Map<string, unknown>>;
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
    this.writing = this.writing.catch(() => {}).then(() => this.write());
    return this.writing;
  }

  private async write() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(path.join(path.dirname(this.file), ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(this.docs)), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end?(): Promise<void>;
}

export class PostgresPersistence implements Persistence {
  constructor(
    readonly db: SqlClient,
    private readonly table = "kino_docs",
  ) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`Not a table name: ${table}`);
  }

  async load() {
    await this.db.query(`create table if not exists ${this.table} (key text primary key, value jsonb not null)`);
    const { rows } = await this.db.query(`select key, value from ${this.table}`);
    return new Map(rows.map((row) => [String(row.key), row.value] as const));
  }

  async save({ put, remove }: { put: Map<string, unknown>; remove: Set<string> }) {
    if (put.size === 0 && remove.size === 0) return;
    await this.db.query(
      `with forgotten as (delete from ${this.table} where key = any($3::text[])) insert into ${this.table} (key, value) select * from unnest($1::text[], $2::jsonb[]) on conflict (key) do update set value = excluded.value`,
      [[...put.keys()], [...put.values()].map((value) => JSON.stringify(value)), [...remove]],
    );
  }

  async close() {
    await this.db.end?.();
  }
}

export function databaseTls(env: NodeJS.ProcessEnv): { ca?: string; rejectUnauthorized: boolean } | undefined {
  const url = env.DATABASE_URL ?? "";
  if (/sslmode=(disable|allow)|localhost|127\.0\.0\.1/.test(url)) return undefined;
  if (!env.DATABASE_CA_FILE) return { rejectUnauthorized: false };
  return { ca: readFileSync(env.DATABASE_CA_FILE, "utf8"), rejectUnauthorized: true };
}

export async function persistenceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log: { warn(message: string): void } = console,
): Promise<{ persistence: Persistence; describe: string; kind: "postgres" | "file" | "memory" }> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const ssl = databaseTls(env);
    if (ssl && !ssl.rejectUnauthorized) log.warn("Postgres: the connection is encrypted but the database's certificate is not checked: set DATABASE_CA_FILE to the provider's root certificate.");
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4, ssl });
    pool.on("error", (error) => log.warn(`Postgres: ${error.message}`));
    return { persistence: new PostgresPersistence(pool), describe: "Postgres (DATABASE_URL)", kind: "postgres" };
  }
  if (env.RENDER && env.DATA_DIR === undefined) {
    log.warn("Render wipes this server's disk on every deploy and restart, so accounts kept in a file are lost with it. Set DATABASE_URL to a Postgres (Neon or Supabase have free ones), or put DATA_DIR on a persistent disk.");
  }
  const dir = env.DATA_DIR ?? "data";
  if (dir === "memory") return { persistence: new MemoryPersistence(), describe: "memory only (accounts are lost when the server stops)", kind: "memory" };
  const file = path.resolve(dir, "kino.json");
  return { persistence: new FilePersistence(file, log), describe: `file ${file}`, kind: "file" };
}
