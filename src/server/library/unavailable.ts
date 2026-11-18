import path from "node:path";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import { parseAnimeHeavenLink } from "./animeheaven";

export const OCCASION_GAP_MS = 6 * 3600 * 1000;
export const OCCASIONS_TO_MARK = 2;
export const MARK_MS = 14 * 24 * 3600 * 1000;
export const KEEP_MS = 60 * 24 * 3600 * 1000;
export const MAX_RECORDS = 3000;
const FLUSH_MS = 30_000;
const RETRY_MS = 30_000;

export interface PlayKey {
  key: string;
  show: string;
  titleId: string;
  season?: number;
  episode?: number;
}

const wholeNumber = (value: string | null): number | undefined => (value !== null && /^\d{1,4}$/.test(value) ? Number(value) : undefined);

export function playKeyOf(link: string): PlayKey | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/(^|\.)filmpire\.(sc|cc)$/i.test(url.hostname)) {
    const match = /^\/watch\/(\d{1,10})$/.exec(url.pathname);
    if (!match) return null;
    const id = match[1]!;
    const season = wholeNumber(url.searchParams.get("s") ?? url.searchParams.get("season"));
    const episode = wholeNumber(url.searchParams.get("e") ?? url.searchParams.get("episode"));
    if (season !== undefined && episode !== undefined) return { key: `filmpire:tv:${id}:${season}:${episode}`, show: `filmpire:tv:${id}`, titleId: `filmpire-tv-${id}`, season, episode };
    if (season !== undefined || episode !== undefined || /^(series|tv)$/.test(url.searchParams.get("type") ?? "")) return null;
    return { key: `filmpire:movie:${id}`, show: `filmpire:movie:${id}`, titleId: `filmpire-movie-${id}` };
  }
  if (/(^|\.)animeheaven\.me$/i.test(url.hostname) && url.pathname === "/anime.php") {
    const slug = parseAnimeHeavenLink(link)?.slug;
    if (!slug || !/^[a-z0-9]{1,40}$/i.test(slug)) return null;
    const season = wholeNumber(url.searchParams.get("s")) ?? 1;
    const episode = wholeNumber(url.searchParams.get("e"));
    if (episode === undefined) return null;
    return { key: `animeheaven:${slug}:${season}:${episode}`, show: `animeheaven:${slug}`, titleId: `animeheaven-series-${slug}`, season, episode };
  }
  return null;
}

export interface UnavailableRecord {
  v: 1;
  key: string;
  show: string;
  titleId: string;
  season?: number;
  episode?: number;
  title?: string;
  kind?: "movie" | "series";
  link: string;
  occasions: number;
  first: number;
  last: number;
}

export interface UnavailableStoreOptions {
  persistence: Persistence;
  now?: () => number;
  flushMs?: number;
  log?: { warn(message: string): void };
}

export interface UnavailableAnswer {
  title: boolean;
  episodes: Array<{ season: number; episode: number }>;
}

export class UnavailableStore {
  private readonly records = new Map<string, UnavailableRecord>();
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> = Promise.resolve();

  private constructor(private readonly options: Required<Omit<UnavailableStoreOptions, "log">> & Pick<UnavailableStoreOptions, "log">) {}

  static async open(options: UnavailableStoreOptions): Promise<UnavailableStore> {
    const store = new UnavailableStore({ now: Date.now, flushMs: FLUSH_MS, ...options });
    await store.load();
    return store;
  }

  private now() {
    return this.options.now();
  }

  private async load() {
    const loaded: UnavailableRecord[] = [];
    for (const [key, value] of await this.options.persistence.load()) {
      const doc = value as Partial<UnavailableRecord> | null;
      const good =
        doc &&
        doc.v === 1 &&
        doc.key === key &&
        typeof doc.show === "string" &&
        typeof doc.titleId === "string" &&
        typeof doc.link === "string" &&
        Number.isFinite(doc.occasions) &&
        Number.isFinite(doc.first) &&
        Number.isFinite(doc.last);
      if (!good) {
        this.options.log?.warn(`Skipped an unreadable record of what nobody could play (${key.slice(0, 80)}).`);
        continue;
      }
      if (this.now() - doc.last! >= KEEP_MS) this.forget(key);
      else loaded.push(doc as UnavailableRecord);
    }
    for (const record of loaded.sort((a, b) => a.last - b.last)) this.records.set(record.key, record);
    this.trim();
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
  private trim() {
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value!;
      this.records.delete(oldest);
      this.forget(oldest);
    }
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing = this.flushing.catch(() => {}).then(async () => {
      if (this.dirty.size === 0 && this.removed.size === 0) return;
      const put = new Map<string, unknown>();
      for (const key of this.dirty) {
        const record = this.records.get(key);
        if (record) put.set(key, record);
      }
      const remove = new Set(this.removed);
      this.dirty.clear();
      this.removed.clear();
      try {
        await this.options.persistence.save({ put, remove });
      } catch (error) {
        for (const key of put.keys()) if (!this.removed.has(key)) this.dirty.add(key);
        for (const key of remove) if (!this.dirty.has(key)) this.removed.add(key);
        this.options.log?.warn(`Could not save what nobody could play: ${(error as Error).message}`);
        this.schedule(RETRY_MS);
      }
    });
    return this.flushing;
  }

  async close() {
    await this.flush();
    await this.options.persistence.close?.();
  }

  nothingFound(link: string, about?: { title?: string | undefined; kind?: "movie" | "series" | undefined }): void {
    const play = playKeyOf(link);
    if (!play) return;
    const at = this.now();
    const before = this.records.get(play.key);
    const fresh = before && at - before.last < KEEP_MS ? before : undefined;
    const record: UnavailableRecord = {
      v: 1,
      key: play.key,
      show: play.show,
      titleId: play.titleId,
      ...(play.season !== undefined ? { season: play.season } : {}),
      ...(play.episode !== undefined ? { episode: play.episode } : {}),
      ...((about?.title ?? fresh?.title) ? { title: (about?.title ?? fresh?.title)!.slice(0, 300) } : {}),
      ...((about?.kind ?? fresh?.kind) ? { kind: (about?.kind ?? fresh?.kind)! } : {}),
      link: link.slice(0, 2048),
      occasions: fresh ? fresh.occasions + (at - fresh.last >= OCCASION_GAP_MS ? 1 : 0) : 1,
      first: fresh?.first ?? at,
      last: fresh && at - fresh.last < OCCASION_GAP_MS ? fresh.last : at,
    };
    this.records.delete(play.key);
    this.records.set(play.key, record);
    this.touch(play.key);
    this.trim();
  }

  found(link: string): void {
    const play = playKeyOf(link);
    if (!play || !this.records.delete(play.key)) return;
    this.forget(play.key);
  }

  private marked(record: UnavailableRecord): boolean {
    return record.occasions >= OCCASIONS_TO_MARK && this.now() - record.last < MARK_MS;
  }

  answerFor(link: string): UnavailableAnswer {
    const play = playKeyOf(link);
    if (!play) return { title: false, episodes: [] };
    const episodes: UnavailableAnswer["episodes"] = [];
    let title = false;
    for (const record of this.records.values()) {
      if (record.show !== play.show || !this.marked(record)) continue;
      if (record.season !== undefined && record.episode !== undefined) episodes.push({ season: record.season, episode: record.episode });
      else title = true;
    }
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return { title, episodes: episodes.slice(0, 500) };
  }

  list(): Array<UnavailableRecord & { marked: boolean }> {
    return [...this.records.values()]
      .filter((record) => this.now() - record.last < KEEP_MS)
      .map((record) => ({ ...record, marked: this.marked(record) }))
      .sort((a, b) => b.occasions - a.occasions || b.last - a.last);
  }
}

export function unavailablePersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_unavailable");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "unavailable.json"));
  return new MemoryPersistence();
}
