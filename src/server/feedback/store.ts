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

/** What the reports may take up (the pictures are nearly all of it). A free Postgres has 500 MB, shared with the accounts and the subtitle timings. */
export const FEEDBACK_MAX_BYTES = 150 * 1024 * 1024;
/** The most reports kept; past this the oldest closed ones go (see `prune`). */
export const FEEDBACK_MAX_REPORTS = 600;
/** The most lines (answers, from either side) one report holds: a thread is not a chat room. */
export const FEEDBACK_MAX_MESSAGES = 100;
/** What the words of a report count for in the budget, besides its files. */
const RECORD_BYTES = 6 * 1024;

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
  /** Taken out to make room (the words stay, see `prune`). */
  gone?: true;
}

export interface FeedbackMessage {
  id: number;
  at: number;
  from: "user" | "team";
  text: string;
  /** The team is asking something, and the report waits for the answer. */
  asks?: true;
  /** The ids of the files sent with the line. */
  files?: string[];
}

export interface FeedbackRecord {
  v: 1;
  /** A number (1, 2, 3...), as text: what the team calls the report. */
  id: string;
  createdAt: number;
  updatedAt: number;
  /** The sender's key is never kept, only what it takes to know it again. */
  keyHash: string;
  /** The account that was signed in when it was sent (and the sender wanted the answer): the report is on all of that account's devices. */
  accountId?: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string;
  message: string;
  details: Partial<Record<FeedbackDetailKey, string>>;
  severity?: FeedbackSeverity;
  frequency?: FeedbackFrequency;
  /** False: the sender asked not to be answered, and kept no way to read an answer. */
  answer: boolean;
  status: FeedbackStatus;
  files: FeedbackFile[];
  context: FeedbackContext | null;
  /** The parts of what the page said about itself that could not be read, so they were left out. */
  contextDropped?: string[];
  messages: FeedbackMessage[];
  /** The newest line from the team that the sender has opened. */
  seen: number;
  /** The team's own: never shown to the sender. */
  tags: string[];
  note: string;
}

/**
 * Where reports are kept between restarts. Like the accounts' the store holds the words of every report in memory (they are small) and tells this what
 * changed; the files (pictures, logs) are not in memory, they are read when someone asks.
 */
export interface FeedbackBackend {
  load(): Promise<FeedbackRecord[]>;
  save(record: FeedbackRecord): Promise<void>;
  /** The report and every file of it. */
  remove(id: string): Promise<void>;
  putFile(report: string, file: string, data: Buffer): Promise<void>;
  getFile(report: string, file: string): Promise<Buffer | undefined>;
  /** These files of the report (all of them when none are named). */
  removeFiles(report: string, files?: string[]): Promise<void>;
  close?(): Promise<void>;
}

/** Nowhere (tests, `DATA_DIR=memory`): gone when the server stops. */
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

/** `<id>.json` for a report and a folder `<id>` with its files, in a folder next to the accounts' file (a PC, or a host with a disk that stays). */
export class FileFeedbackBackend implements FeedbackBackend {
  constructor(
    private readonly dir: string,
    private readonly log: { warn(message: string): void } = console,
  ) {}

  private reportFile(id: string): string {
    // (Only ever what the store made: nothing from a request can name another place.)
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

/** Two tables in the accounts' Postgres (a host whose disk is wiped on every restart, like a free Render instance). */
export class PostgresFeedbackBackend implements FeedbackBackend {
  private ready: Promise<unknown> | undefined;

  constructor(private readonly db: SqlClient) {}

  private tables(): Promise<unknown> {
    this.ready ??= (async () => {
      await this.db.query("create table if not exists kino_feedback (id text primary key, value jsonb not null)");
      await this.db.query("create table if not exists kino_feedback_files (report text not null, id text not null, data bytea not null, primary key (report, id))");
    })().catch((error: unknown) => {
      this.ready = undefined; // (asked again next time)
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

/** A report as it comes in (the routes have checked it, see `files.ts`). */
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
}

export interface FeedbackStoreOptions {
  backend: FeedbackBackend;
  maxBytes?: number;
  maxReports?: number;
  now?: () => number;
  log?: { warn(message: string): void };
}

export interface FeedbackFilter {
  status?: FeedbackStatus | "open" | "closed";
  kind?: FeedbackKind;
  area?: FeedbackArea;
  /** Words that are in the title, the message, the details or the lines of the report (all of them, any case). */
  q?: string;
  /** Only the reports the team has not answered (the sender was the last to write, or nobody has). */
  waiting?: boolean;
}

/** The number of lines of a report that its sender has not opened. */
export const unreadOf = (record: FeedbackRecord): number => record.messages.filter((message) => message.from === "team" && message.id > record.seen).length;

/** The report waits for the team: nobody has answered, or the sender had the last word. */
export function waitingOn(record: FeedbackRecord): boolean {
  if (feedbackClosed(record.status) || record.status === "planned") return false;
  const last = record.messages[record.messages.length - 1];
  if (!last) return record.status !== "needs_info";
  return last.from === "user";
}

const reportBytes = (record: FeedbackRecord) => RECORD_BYTES + record.files.reduce((sum, file) => sum + (file.gone ? 0 : file.bytes), 0);

/**
 * The reports. All of them are in memory (their words: some kilobytes each, 600 at the very most); every change is written to the backend first and is
 * seen after that, so what an answer says was kept has been kept. One change to a report at a time.
 */
export class FeedbackStore {
  private readonly records = new Map<string, FeedbackRecord>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly creating = new Map<string, Promise<FeedbackRecord>>();
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

  /** How much the reports take up (the files, and a little for the words). */
  get bytes(): number {
    let sum = 0;
    for (const record of this.records.values()) sum += reportBytes(record);
    return sum;
  }

  /** A number that goes up with every change that the team should hear of: a report, a line from the sender. */
  get rev(): number {
    return this.revision;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
    await this.backend.close?.();
  }

  /* ------------------------------ reading ------------------------------ */

  get(id: string): FeedbackRecord | undefined {
    return this.records.get(id);
  }

  /** The report that was sent with this key. */
  byKey(key: string): FeedbackRecord | undefined {
    const hash = sha256(key);
    for (const record of this.records.values()) if (record.keyHash === hash) return record;
    return undefined;
  }

  forAccount(accountId: string): FeedbackRecord[] {
    return [...this.records.values()].filter((record) => record.accountId === accountId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Newest change first. */
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

  /**
   * Resolves with the revision once it is above `since` (at once if it already is, or if `since` is from before a restart), or after `ms` with the
   * same number: the team's `watch` asks again each time.
   */
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

  /* ------------------------------ writing ------------------------------ */

  /** Runs the jobs for one report one after the other: a change reads the report and writes it back, and two at once would lose one of them. */
  private chained<T>(id: string, job: () => Promise<T>): Promise<T> {
    const turn = (this.chains.get(id) ?? Promise.resolve()).catch(() => {}).then(job);
    this.chains.set(id, turn);
    const done = () => this.chains.get(id) === turn && this.chains.delete(id);
    void turn.then(done, done);
    return turn;
  }

  /**
   * Takes a report in. The same key twice is the same report (a page that did not hear the answer sends it again), so the second time is the first's
   * report and `created` is false. The files and the words are written before this answers.
   */
  async create(input: NewReport): Promise<{ record: FeedbackRecord; created: boolean }> {
    const hash = sha256(input.key);
    const known = this.byKey(input.key);
    if (known) return { record: known, created: false };
    const running = this.creating.get(hash);
    if (running) return { record: await running, created: false };
    const job = this.make(input, hash);
    this.creating.set(hash, job);
    try {
      return { record: await job, created: true };
    } finally {
      this.creating.delete(hash);
    }
  }

  private async make(input: NewReport, keyHash: string): Promise<FeedbackRecord> {
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
      files: input.files.map(({ meta, data }) => ({ ...meta, bytes: data.length })),
      context: input.context,
      ...(input.contextDropped?.length ? { contextDropped: input.contextDropped } : {}),
      messages: [],
      seen: 0,
      tags: [],
      note: "",
    };
    try {
      await Promise.all(input.files.map(({ meta, data }) => this.backend.putFile(id, meta.id, data)));
      await this.backend.save(record);
    } catch (error) {
      await this.backend.removeFiles(id).catch(() => {});
      throw error;
    }
    this.records.set(id, record);
    this.bump();
    await this.prune().catch((error: Error) => this.log.warn(`Feedback: could not make room: ${error.message}`));
    return record;
  }

  /**
   * Changes a report: `change` is given a copy to change (and may return false for "nothing to change"). The copy is written, then it is the report.
   * A change that is not `quiet` is one the team should hear of.
   */
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

  /** A line in the report's thread, with the files that go with it. False when the report is not there or its thread is full. */
  async addMessage(
    id: string,
    line: { from: "user" | "team"; text: string; asks?: boolean; files?: Array<{ meta: Omit<FeedbackFile, "bytes">; data: Buffer }>; status?: FeedbackStatus },
  ): Promise<FeedbackMessage | "full" | undefined> {
    const files = line.files ?? [];
    return this.chained(id, async () => {
      const current = this.records.get(id);
      if (!current) return undefined;
      if (current.messages.length >= FEEDBACK_MAX_MESSAGES) return "full";
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
      return message;
    });
  }

  /** Takes a report out for good, with its files. */
  remove(id: string): Promise<boolean> {
    return this.chained(id, async () => {
      if (!this.records.has(id)) return false;
      await this.backend.remove(id);
      this.records.delete(id);
      this.bump();
      return true;
    });
  }

  /**
   * Makes room when the reports take up more than they may: first the files of the oldest report that is closed go (the words stay), then the files of the
   * oldest that is not; and when there are more reports than may be kept, the oldest closed one goes, else the oldest.
   */
  async prune(): Promise<void> {
    const oldestFirst = () => [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id));
    while (this.bytes > this.maxBytes) {
      const withFiles = oldestFirst().filter((record) => record.files.some((file) => !file.gone));
      const victim = withFiles.find((record) => feedbackClosed(record.status)) ?? withFiles[0];
      if (!victim) break;
      const gone = victim.files.filter((file) => !file.gone).map((file) => file.id);
      await this.backend.removeFiles(victim.id, gone);
      await this.update(victim.id, (draft) => {
        for (const file of draft.files) if (gone.includes(file.id)) file.gone = true;
      }, { quiet: true });
    }
    while (this.records.size > this.maxReports) {
      const all = oldestFirst();
      const victim = all.find((record) => feedbackClosed(record.status)) ?? all[0];
      if (!victim || !(await this.remove(victim.id))) break;
    }
  }
}

/** Picks the home of the reports to match where the accounts are kept: Postgres, a folder (`feedback` next to the accounts' file), or nowhere. */
export function feedbackBackendFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): FeedbackBackend {
  if (kind === "postgres" && persistence instanceof PostgresPersistence) return new PostgresFeedbackBackend(persistence.db);
  if (kind === "file") return new FileFeedbackBackend(path.resolve(env.DATA_DIR ?? "data", "feedback"));
  return new MemoryFeedbackBackend();
}

/** `FEEDBACK_MAX_MB` (a fraction will do) as bytes, or nothing when it is not set to a number above zero. */
export function feedbackMaxBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const megabytes = Number(env.FEEDBACK_MAX_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * 1024 * 1024) : undefined;
}
