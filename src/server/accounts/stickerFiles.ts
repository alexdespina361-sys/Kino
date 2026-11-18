import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isStickerId } from "../../shared";
import { PostgresPersistence, type Persistence, type SqlClient } from "./persistence";

export interface StickerFiles {
  get(id: string): Promise<Buffer | undefined>;
  put(id: string, data: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
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

export class PostgresStickerFiles implements StickerFiles {
  private ready: Promise<unknown> | undefined;

  constructor(private readonly db: SqlClient) {}

  private table(): Promise<unknown> {
    this.ready ??= this.db.query("create table if not exists kino_stickers (id text primary key, data bytea not null)").catch((error: unknown) => {
      this.ready = undefined;
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

export function stickerFilesFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): StickerFiles {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresStickerFiles(persistence.db);
  if (kind === "file") return new FileStickerFiles(path.resolve(env.DATA_DIR ?? "data", "stickers"));
  return new MemoryStickerFiles();
}

export const personalStickersOn = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|on|true|yes)$/i.test(env.PERSONAL_STICKERS ?? "");

export const movingStickersOn = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|on|true|yes)$/i.test(env.MOVING_STICKERS ?? "");

export function personalStickersMaxBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const megabytes = Number(env.PERSONAL_STICKERS_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * 1024 * 1024) : undefined;
}
