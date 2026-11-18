import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  feedbackClosed,
  type FeedbackArea,
  type FeedbackContext,
  type FeedbackDetailKey,
  type FeedbackFrequency,
  type FeedbackKind,
  type FeedbackMime,
  type FeedbackRole,
  type FeedbackSeverity,
  type FeedbackStatus,
} from "../../shared";
import { PostgresPersistence, type Persistence, type SqlClient } from "../accounts/persistence";

export const FEEDBACK_MAX_BYTES = 150 * 1024 * 1024;
export const FEEDBACK_MAX_REPORTS = 600;
export const FEEDBACK_MAX_MESSAGES = 100;
const RECORD_BYTES = 6 * 1024;
const NEW_REPORT = "new";

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface FeedbackFile {
  id: string;
  name: string;
  mime: FeedbackMime;
  role: FeedbackRole;
  note?: string;
  width?: number;
  height?: number;
  bytes: number;
  gone?: true;
}

export interface FeedbackMessage {
  id: number;
  at: number;
  from: "user" | "team";
  text: string;
  asks?: true;
  files?: string[];
}

export interface FeedbackRecord {
  v: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  keyHash: string;
  accountId?: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string;
  message: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity;
  frequency?: FeedbackFrequency;
  answer: boolean;
  status: FeedbackStatus;
  files: FeedbackFile[];
  context: FeedbackContext | null;
  contextDropped?: string[];
  messages: FeedbackMessage[];
  seen: number;
  tags: string[];
  note: string;
}

export interface FeedbackBackend {
  load(): Promise<FeedbackRecord[]>;
  save(record: FeedbackRecord): Promise<void>;
  remove(id: string): Promise<void>;
  putFile(report: string, file: string, data: Buffer): Promise<void>;
  getFile(report: string, file: string): Promise<Buffer | undefined>;
  removeFiles(report: string, files?: string[]): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryFeedbackBackend implements FeedbackBackend {
  readonly records = new Map<string, FeedbackRecord>();
  readonly files = new Map<string, Buffer>();

  async load() {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
  async save(record: FeedbackRecord) {
    this.records.set(record.id, structuredClone(record));
  }
  async remove(id: string) {
    this.records.delete(id);
    await this.removeFiles(id);
  }
  async putFile(report: string, file: string, data: Buffer) {
    this.files.set(`${report}/${file}`, Buffer.from(data));
  }
  async getFile(report: string, file: string) {
    return this.files.get(`${report}/${file}`);
  }
  async removeFiles(report: string, files?: string[]) {
    for (const key of [...this.files.keys()]) {
      const [owner, name] = key.split("/") as [string, string];
      if (owner === report && (!files || files.includes(name))) this.files.delete(key);
    }
  }
}

const REPORT_ID = /^[0-9]{1,9}$/;
const FILE_ID = /^[a-z0-9]{4,24}$/;

export class FileFeedbackBackend implements FeedbackBackend {
  constructor(
    private readonly dir: string,
    private readonly log: { warn(message: string): void } = console,
  ) {}

  private reportFile(id: string): string {
    if (!REPORT_ID.test(id)) throw new Error("not a report");
    return path.join(this.dir, `${id}.json`);
  }
  private fileOf(report: string, file: string): string {
    if (!REPORT_ID.test(report) || !FILE_ID.test(file)) throw new Error("not a file");
    return path.join(this.dir, report, file);
  }

  async load() {
    const records: FeedbackRecord[] = [];
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await readFile(path.join(this.dir, name), "utf8")) as FeedbackRecord;
        if (parsed?.v === 1 && typeof parsed.id === "string" && REPORT_ID.test(parsed.id)) records.push(parsed);
      } catch (error) {
        this.log.warn(`Feedback: could not read ${name} (${(error as Error).message}); left it where it is.`);
      }
    }
    return records;
  }

  async save(record: FeedbackRecord) {
    await mkdir(this.dir, { recursive: true });
    const file = this.reportFile(record.id);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, file);
  }

  async remove(id: string) {
    await rm(this.reportFile(id), { force: true });
    await this.removeFiles(id);
  }

  async putFile(report: string, file: string, data: Buffer) {
    const target = this.fileOf(report, file);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, target);
  }

  async getFile(report: string, file: string) {
    return readFile(this.fileOf(report, file)).catch(() => undefined);
  }

  async removeFiles(report: string, files?: string[]) {
    if (!REPORT_ID.test(report)) throw new Error("not a report");
    if (!files) return void (await rm(path.join(this.dir, report), { recursive: true, force: true }));
    for (const file of files) await rm(this.fileOf(report, file), { force: true });
  }
}

export class PostgresFeedbackBackend implements FeedbackBackend {
  private ready: Promise<unknown> | undefined;

  constructor(private readonly db: SqlClient) {}

  private tables(): Promise<unknown> {
    this.ready ??= (async () => {
      await this.db.query("create table if not exists kino_feedback (id text primary key, value jsonb not null)");
      await this.db.query("create table if not exists kino_feedback_files (report text not null, id text not null, data bytea not null, primary key (report, id))");
    })().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async load() {
    await this.tables();
    const { rows } = await this.db.query("select value from kino_feedback");
    return rows.map((row) => row.value as FeedbackRecord).filter((record) => record?.v === 1 && typeof record.id === "string");
  }

  async save(record: FeedbackRecord) {
    await this.tables();
    await this.db.query("insert into kino_feedback (id, value) values ($1, $2::jsonb) on conflict (id) do update set value = excluded.value", [record.id, JSON.stringify(record)]);
  }

  async remove(id: string) {
    await this.tables();
    await this.db.query("with files as (delete from kino_feedback_files where report = $1) delete from kino_feedback where id = $1", [id]);
  }

  async putFile(report: string, file: string, data: Buffer) {
    await this.tables();
    await this.db.query("insert into kino_feedback_files (report, id, data) values ($1, $2, $3) on conflict (report, id) do update set data = excluded.data", [report, file, data]);
  }

  async getFile(report: string, file: string) {
    await this.tables();
    const { rows } = await this.db.query("select data from kino_feedback_files where report = $1 and id = $2", [report, file]);
    const data = rows[0]?.data as Uint8Array | undefined;
    return data ? Buffer.from(data) : undefined;
  }

  async removeFiles(report: string, files?: string[]) {
    await this.tables();
    if (!files) await this.db.query("delete from kino_feedback_files where report = $1", [report]);
    else await this.db.query("delete from kino_feedback_files where report = $1 and id = any($2::text[])", [report, files]);
  }
}

export interface NewReport {
  key: string;
  accountId?: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string;
  message: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity | undefined;
  frequency?: FeedbackFrequency | undefined;
  answer: boolean;
  context: FeedbackContext | null;
  contextDropped?: string[];
  files: Array<{ meta: Omit<FeedbackFile, "bytes">; data: Buffer }>;
  from?: string;
}

export interface FeedbackStoreOptions {
  backend: FeedbackBackend;
  maxBytes?: number;
  maxReports?: number;
  now?: () => number;
  log?: { warn(message: string): void };
}

export class FeedbackFull extends Error {
  constructor() {
    super("The feedback is full of reports that are still open");
    this.name = "FeedbackFull";
  }
}

export class TooManyOpen extends Error {
  constructor() {
    super("The sender has as many reports open as one sender may");
    this.name = "TooManyOpen";
  }
}

export interface FeedbackFilter {
  status?: FeedbackStatus | "open" | "closed";
  kind?: FeedbackKind;
  area?: FeedbackArea;
  q?: string;
  waiting?: boolean;
}

export const unreadOf = (record: FeedbackRecord): number => record.messages.filter((message) => message.from === "team" && message.id > record.seen).length;

export function waitingOn(record: FeedbackRecord): boolean {
  if (feedbackClosed(record.status) || record.status === "planned") return false;
  const last = record.messages[record.messages.length - 1];
  if (!last) return record.status !== "needs_info";
  return last.from === "user";
}

type Added = { message: FeedbackMessage; refused: string[] } | "full" | undefined;

const filesBytes = (record: FeedbackRecord) => record.files.reduce((sum, file) => sum + (file.gone ? 0 : file.bytes), 0);

const reportBytes = (record: FeedbackRecord) => RECORD_BYTES + record.messages.reduce((sum, message) => sum + Buffer.byteLength(message.text), 0) + filesBytes(record);

export class FeedbackStore {
  private readonly records = new Map<string, FeedbackRecord>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly creating = new Map<string, Promise<{ record: FeedbackRecord; refused: string[] }>>();
  private readonly senders = new Map<string, string>();
  private readonly waiters = new Set<() => void>();
  private nextId = 1;
  private revision = 0;
  private readonly maxBytes: number;
  private readonly maxReports: number;
  private readonly now: () => number;
  private readonly log: { warn(message: string): void };
  readonly backend: FeedbackBackend;

  private constructor(options: FeedbackStoreOptions) {
    this.backend = options.backend;
    this.maxBytes = options.maxBytes ?? FEEDBACK_MAX_BYTES;
    this.maxReports = options.maxReports ?? FEEDBACK_MAX_REPORTS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? console;
  }

  static async open(options: FeedbackStoreOptions): Promise<FeedbackStore> {
    const store = new FeedbackStore(options);
    for (const record of await store.backend.load()) {
      store.records.set(record.id, record);
      store.nextId = Math.max(store.nextId, Number(record.id) + 1);
    }
    store.revision = store.records.size;
    return store;
  }

  get size(): number {
    return this.records.size;
  }

  get bytes(): number {
    let sum = 0;
    for (const record of this.records.values()) sum += reportBytes(record);
    return sum;
  }

  get full(): boolean {
    const closed = this.oldestFirst().filter((record) => feedbackClosed(record.status));
    const places = this.records.size - this.maxReports + 1;
    if (closed.length < places) return true;
    let used = this.bytes + RECORD_BYTES;
    closed.forEach((record, n) => (used -= n < places ? reportBytes(record) : filesBytes(record)));
    return used > this.maxBytes;
  }

  get rev(): number {
    return this.revision;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
    await this.backend.close?.();
  }

  get(id: string): FeedbackRecord | undefined {
    return this.records.get(id);
  }

  byKey(key: string): FeedbackRecord | undefined {
    const hash = sha256(key);
    for (const record of this.records.values()) if (record.keyHash === hash) return record;
    return undefined;
  }

  forAccount(accountId: string): FeedbackRecord[] {
    return [...this.records.values()].filter((record) => record.accountId === accountId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  list(filter: FeedbackFilter = {}): FeedbackRecord[] {
    const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = [...this.records.values()].filter((record) => {
      if (filter.status === "open" ? feedbackClosed(record.status) : filter.status === "closed" ? !feedbackClosed(record.status) : filter.status && record.status !== filter.status) return false;
      if (filter.kind && record.kind !== filter.kind) return false;
      if (filter.area && record.area !== filter.area) return false;
      if (filter.waiting && !waitingOn(record)) return false;
      if (words.length === 0) return true;
      const text = [record.title, record.message, ...Object.values(record.details), ...record.messages.map((message) => message.text), record.tags.join(" "), record.note].join("\n").toLowerCase();
      return words.every((word) => text.includes(word));
    });
    return found.sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id));
  }

  async file(id: string, fileId: string): Promise<{ meta: FeedbackFile; data: Buffer } | undefined> {
    const meta = this.records.get(id)?.files.find((file) => file.id === fileId);
    if (!meta || meta.gone) return undefined;
    const data = await this.backend.getFile(id, fileId);
    return data ? { meta, data } : undefined;
  }

  waitForChange(since: number, ms: number, signal?: AbortSignal): Promise<number> {
    if (this.revision !== since || signal?.aborted) return Promise.resolve(this.revision);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal?.removeEventListener("abort", done);
        resolve(this.revision);
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  private bump(): void {
    this.revision++;
    for (const wake of [...this.waiters]) wake();
  }

  private chained<T>(id: string, job: () => Promise<T>): Promise<T> {
    const turn = (this.chains.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
    this.chains.set(id, turn);
    const done = () => this.chains.get(id) === turn && this.chains.delete(id);
    void turn.then(done, done);
    return turn;
  }

  async create(
    input: NewReport,
    { filesOptional = false, maxOpen }: { filesOptional?: boolean; maxOpen?: number } = {},
  ): Promise<{ record: FeedbackRecord; created: boolean; refused: string[] }> {
    const hash = sha256(input.key);
    const known = this.byKey(input.key);
    if (known) return { record: known, created: false, refused: [] };
    const running = this.creating.get(hash);
    if (running) return { ...(await running), created: false };
    const job = this.chained(NEW_REPORT, () => this.make(input, hash, filesOptional, maxOpen));
    this.creating.set(hash, job);
    try {
      return { ...(await job), created: true };
    } finally {
      this.creating.delete(hash);
    }
  }

  private async make(input: NewReport, keyHash: string, filesOptional: boolean, maxOpen: number | undefined): Promise<{ record: FeedbackRecord; refused: string[] }> {
    if (input.from && maxOpen !== undefined && this.openFrom(input.from) >= maxOpen) throw new TooManyOpen();
    const hasWords = input.message !== "" || Object.keys(input.details).length > 0;
    const { files, refused } = await this.admit(input.files, filesOptional && hasWords);
    const id = String(this.nextId++);
    const at = this.now();
    const record: FeedbackRecord = {
      v: 1,
      id,
      createdAt: at,
      updatedAt: at,
      keyHash,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      kind: input.kind,
      area: input.area,
      title: input.title,
      message: input.message,
      details: input.details,
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.frequency ? { frequency: input.frequency } : {}),
      answer: input.answer,
      status: "new",
      files: files.map(({ meta, data }) => ({ ...meta, bytes: data.length })),
      context: input.context,
      ...(input.contextDropped?.length ? { contextDropped: input.contextDropped } : {}),
      messages: [],
      seen: 0,
      tags: [],
      note: "",
    };
    try {
      await Promise.all(files.map(({ meta, data }) => this.backend.putFile(id, meta.id, data)));
      await this.backend.save(record);
    } catch (error) {
      await this.backend.removeFiles(id).catch(() => {});
      throw error;
    }
    this.records.set(id, record);
    if (input.from) this.senders.set(id, input.from);
    this.bump();
    return { record, refused };
  }

  private openFrom(address: string): number {
    let open = 0;
    for (const [id, from] of this.senders) {
      const record = this.records.get(id);
      if (from === address && record && !feedbackClosed(record.status)) open++;
    }
    return open;
  }

  update(id: string, change: (draft: FeedbackRecord) => boolean | void, { quiet = false }: { quiet?: boolean } = {}): Promise<FeedbackRecord | undefined> {
    return this.chained(id, async () => {
      const current = this.records.get(id);
      if (!current) return undefined;
      const draft = structuredClone(current);
      if (change(draft) === false) return current;
      if (!quiet) draft.updatedAt = this.now();
      await this.backend.save(draft);
      this.records.set(id, draft);
      if (!quiet) this.bump();
      return draft;
    });
  }

  async addMessage(
    id: string,
    line: { from: "user" | "team"; text: string; asks?: boolean; files?: Array<{ meta: Omit<FeedbackFile, "bytes">; data: Buffer }>; status?: FeedbackStatus },
  ): Promise<Added> {
    const given = line.files ?? [];
    const write = (): Promise<Added> =>
      this.chained(id, async () => {
        const current = this.records.get(id);
        if (!current) return undefined;
        if (current.messages.length >= FEEDBACK_MAX_MESSAGES) return "full";
        const { files, refused } = line.from === "user" ? await this.fit(given, line.text !== "", Buffer.byteLength(line.text), id) : { files: given, refused: [] };
        await Promise.all(files.map(({ meta, data }) => this.backend.putFile(id, meta.id, data)));
        const draft = structuredClone(current);
        const message: FeedbackMessage = {
          id: (draft.messages[draft.messages.length - 1]?.id ?? 0) + 1,
          at: this.now(),
          from: line.from,
          text: line.text,
          ...(line.asks ? { asks: true as const } : {}),
          ...(files.length ? { files: files.map(({ meta }) => meta.id) } : {}),
        };
        draft.messages.push(message);
        draft.files.push(...files.map(({ meta, data }) => ({ ...meta, bytes: data.length })));
        if (line.status) draft.status = line.status;
        draft.updatedAt = message.at;
        try {
          await this.backend.save(draft);
        } catch (error) {
          await this.backend.removeFiles(id, files.map(({ meta }) => meta.id)).catch(() => {});
          throw error;
        }
        this.records.set(id, draft);
        this.bump();
        return { message, refused };
      });
    return line.from === "user" ? this.chained(NEW_REPORT, write) : write();
  }

  remove(id: string): Promise<boolean> {
    return this.chained(id, async () => {
      if (!this.records.has(id)) return false;
      await this.backend.remove(id);
      this.records.delete(id);
      this.senders.delete(id);
      this.bump();
      return true;
    });
  }

  private oldestFirst(): FeedbackRecord[] {
    return [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id));
  }

  private evict(id: string): Promise<void> {
    return this.chained(id, async () => {
      const current = this.records.get(id);
      if (!current || !feedbackClosed(current.status)) return;
      await this.backend.remove(id);
      this.records.delete(id);
      this.senders.delete(id);
      this.bump();
    });
  }

  private evictFiles(id: string): Promise<void> {
    return this.chained(id, async () => {
      const current = this.records.get(id);
      if (!current || !feedbackClosed(current.status)) return;
      const gone = current.files.filter((file) => !file.gone).map((file) => file.id);
      if (gone.length === 0) return;
      await this.backend.removeFiles(id, gone);
      const draft = structuredClone(current);
      for (const file of draft.files) file.gone = true;
      await this.backend.save(draft);
      this.records.set(id, draft);
    });
  }

  private async admit(files: NewReport["files"], optional: boolean): Promise<{ files: NewReport["files"]; refused: string[] }> {
    while (this.records.size >= this.maxReports) {
      const victim = this.oldestFirst().find((record) => feedbackClosed(record.status));
      if (!victim) throw this.turnedAway("places");
      await this.evict(victim.id);
    }
    return this.fit(files, optional, RECORD_BYTES);
  }

  private async fit(files: NewReport["files"], optional: boolean, words: number, spare?: string): Promise<{ files: NewReport["files"]; refused: string[] }> {
    const wanted = files.reduce((sum, { data }) => sum + data.length, 0);
    while (this.bytes + words + wanted > this.maxBytes) {
      const victim = this.oldestFirst().find((record) => record.id !== spare && feedbackClosed(record.status) && record.files.some((file) => !file.gone));
      if (!victim) break;
      await this.evictFiles(victim.id);
    }
    let room = this.maxBytes - this.bytes - words;
    if (room >= wanted) return { files, refused: [] };
    if (!optional || room < 0) throw this.turnedAway("room", spare === undefined ? "a report" : "an answer");
    const kept: NewReport["files"] = [];
    const refused: string[] = [];
    for (const file of files) {
      if (file.data.length > room) {
        refused.push(file.meta.id);
      } else {
        kept.push(file);
        room -= file.data.length;
      }
    }
    return { files: kept, refused };
  }

  private turnedAway(limit: "places" | "room", what = "a report"): FeedbackFull {
    const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
    const reached = limit === "places" ? `all ${this.maxReports} places are` : `all the room (${megabytes(this.maxBytes)} MB) is`;
    const kept = `${this.records.size} reports are kept, ${megabytes(this.bytes)} MB`;
    this.log.warn(`Feedback: turned ${what} away: ${reached} taken by reports that are still open, and no closed one is left to make room from (${kept}).`);
    return new FeedbackFull();
  }
}

export function feedbackBackendFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): FeedbackBackend {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresFeedbackBackend(persistence.db);
  if (kind === "file") return new FileFeedbackBackend(path.resolve(env.DATA_DIR ?? "data", "feedback"));
  return new MemoryFeedbackBackend();
}

export function feedbackMaxBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const megabytes = Number(env.FEEDBACK_MAX_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * 1024 * 1024) : undefined;
}
