import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isStickerId } from "../../shared";
import { PostgresPersistence, type Persistence, type SqlClient } from "./persistence";

/**
 * Where the pictures of personal stickers are kept (shared/stickers.ts): apart from the accounts' documents, which are all read into memory at start. What is
 * said of each sticker (whose, how big, who has it) is one of those documents (stickers.ts); its picture is here, by its name, and read when it is asked for.
 * Postgres keeps them in a table of their own; a file server in a folder; tests in memory.
 */
export interface StickerFiles {
  get(id: string): Promise<Buffer | undefined>;
  put(id: string, data: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
  /** The names of every picture there is (for what start-up tidies: see `StickerBook.reconcile`). */
  ids(): Promise<string[]>;
}

export class MemoryStickerFiles implements StickerFiles {
  readonly files = new Map<string, Buffer>();
  async get(id: string) {
    const data = this.files.get(id);
    return data ? Buffer.from(data) : undefined;
  }
  async put(id: string, data: Buffer) {
    this.files.set(id, Buffer.from(data));
  }
  async remove(id: string) {
    this.files.delete(id);
  }
  async ids() {
    return [...this.files.keys()];
  }
}

/**
 * A folder with a file for each picture. Only a sticker's name ever names a file (nothing a request says can name another place). Each is `<name>.png`, one
 * that moves too (an animated WebP): what kind of picture it is, is read from its first bytes when it is sent (stickerImage.ts `pictureType`).
 */
export class FileStickerFiles implements StickerFiles {
  constructor(private readonly dir: string) {}

  private fileOf(id: string): string {
    if (!isStickerId(id)) throw new Error("not a sticker");
    return path.join(this.dir, `${id}.png`);
  }

  async get(id: string) {
    if (!isStickerId(id)) return undefined;
    return readFile(this.fileOf(id)).catch(() => undefined);
  }
  async put(id: string, data: Buffer) {
    await mkdir(this.dir, { recursive: true });
    const file = this.fileOf(id);
    await writeFile(`${file}.tmp`, data, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async remove(id: string) {
    await rm(this.fileOf(id), { force: true });
  }
  async ids() {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names.filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)).filter(isStickerId);
  }
}

/** A table of their own in the accounts' Postgres (never the accounts' documents, which are read whole into memory). */
export class PostgresStickerFiles implements StickerFiles {
  private ready: Promise<unknown> | undefined;

  constructor(private readonly db: SqlClient) {}

  private table(): Promise<unknown> {
    this.ready ??= this.db.query("create table if not exists kino_stickers (id text primary key, data bytea not null)").catch((error: unknown) => {
      this.ready = undefined; // (asked again next time)
      throw error;
    });
    return this.ready;
  }

  async get(id: string) {
    if (!isStickerId(id)) return undefined;
    await this.table();
    const { rows } = await this.db.query("select data from kino_stickers where id = $1", [id]);
    const data = rows[0]?.data;
    return data instanceof Uint8Array ? Buffer.from(data) : undefined;
  }
  async put(id: string, data: Buffer) {
    if (!isStickerId(id)) throw new Error("not a sticker");
    await this.table();
    await this.db.query("insert into kino_stickers (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data", [id, data]);
  }
  async remove(id: string) {
    await this.table();
    await this.db.query("delete from kino_stickers where id = $1", [id]);
  }
  async ids() {
    await this.table();
    const { rows } = await this.db.query("select id from kino_stickers");
    return rows.map((row) => String(row.id));
  }
}

/** The home of the pictures, next to the accounts': their Postgres, a `stickers` folder beside their file, or memory. */
export function stickerFilesFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): StickerFiles {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresStickerFiles(persistence.db);
  if (kind === "file") return new FileStickerFiles(path.resolve(env.DATA_DIR ?? "data", "stickers"));
  return new MemoryStickerFiles();
}

/** Whether the host turned personal stickers on (env PERSONAL_STICKERS=on); off unless it did. */
export const personalStickersOn = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|on|true|yes)$/i.test(env.PERSONAL_STICKERS ?? "");

/** Whether the host turned stickers that move on as well (env MOVING_STICKERS=on: shared/stickers.ts `MOVING_STICKER`); off unless it did. */
export const movingStickersOn = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|on|true|yes)$/i.test(env.MOVING_STICKERS ?? "");

/** How many megabytes the site keeps of them (env PERSONAL_STICKERS_MB), or nothing when it is not set to a number above zero. */
export function personalStickersMaxBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const megabytes = Number(env.PERSONAL_STICKERS_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * 1024 * 1024) : undefined;
}
