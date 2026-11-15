import path from "node:path";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import { parseAnimeHeavenLink } from "./animeheaven";

/**
 * What nobody could play: the films and the episodes that the library lists and that no source had a video of, so that the screens can say so before Play
 * and the team has a list to look for sources with (`GET /api/admin/unavailable`, `node scripts/unavailable.mjs`).
 *
 * A title is marked only after its look-up found nothing on two separate occasions (`OCCASION_GAP_MS` apart) with nothing found in between: one
 * "nothing" can be a source that was slow just then (a look-up that waits out a slow source and finds nothing elsewhere says "unsupported" all the
 * same). One found video takes the mark away for good, and a mark that nobody has met again for `MARK_MS` is no longer shown. It is a label and nothing
 * more: Play looks the title up as always, so a source that has it now plays it and the mark goes. Nothing is ever asked of a source for this list.
 *
 * Only the library's own links are kept (a film or an episode of the places it lists), never a pasted link, and never who pressed Play.
 */

/** Two "nothing"s closer than this are one occasion (Try again, the screen's second look, the next episode looked up in advance). */
export const OCCASION_GAP_MS = 10 * 60 * 1000;
/** How many occasions mark a title for the screens. */
export const OCCASIONS_TO_MARK = 2;
/** How long a mark is shown after the last time a look-up found nothing. */
export const MARK_MS = 14 * 24 * 3600 * 1000;
/** A record nobody has met again for this long is forgotten (the team's list is for what people still ask for). */
export const KEEP_MS = 60 * 24 * 3600 * 1000;
/** At most this many records: past it, the one met the longest ago goes. */
export const MAX_RECORDS = 3000;
const FLUSH_MS = 30_000;
const RETRY_MS = 30_000;

/** What a link plays, as the list knows it: the film, or the show and its episode. `titleId` is the library's id of the title (`LibraryItem.id`). */
export interface PlayKey {
  key: string;
  /** The film, or the show the episode is of: every episode of a show has the same. */
  show: string;
  titleId: string;
  season?: number;
  episode?: number;
}

const wholeNumber = (value: string | null): number | undefined => (value !== null && /^\d{1,4}$/.test(value) ? Number(value) : undefined);

/**
 * The film or the episode a link of the library plays, or null for any other link. One function for what is kept and for what is asked about, so a
 * mark is always found again: the library's links for one episode differ only in what is no part of the episode (the anime site's `key`).
 */
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
    // (A show's link without its episode is not something that plays.)
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

/** One film or episode that a look-up found nothing for. */
export interface UnavailableRecord {
  v: 1;
  key: string;
  show: string;
  titleId: string;
  season?: number;
  episode?: number;
  /** The title's name and kind, when the library knew them (the team's list says what it is). */
  title?: string;
  kind?: "movie" | "series";
  /** The link that was played last, for the team. */
  link: string;
  /** How many separate occasions found nothing, since the last time something was found. */
  occasions: number;
  first: number;
  last: number;
}

export interface UnavailableStoreOptions {
  persistence: Persistence;
  now?: () => number;
  /** How long changes wait before they are written (30 s unless set; 0 leaves it to whoever calls `flush`, which is what tests do). */
  flushMs?: number;
  log?: { warn(message: string): void };
}

/** What the screens are told about one title (see `GET /api/library/unavailable`). */
export interface UnavailableAnswer {
  /** The film itself is marked (a show never is: its episodes are). */
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
    // (In the order they were last met, so the one met the longest ago is the first to go.)
    for (const record of loaded.sort((a, b) => a.last - b.last)) this.records.set(record.key, record);
    this.trim();
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
  private trim() {
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value!;
      this.records.delete(oldest);
      this.forget(oldest);
    }
  }

  /** Write what changed. Resolves when it is written; a failure is kept to try again. */
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

  /* ------------------------------ hearing ------------------------------ */

  /**
   * A look-up of `link` found nothing (no source had a video of it). `about` is what the library knows of the title, for the team's list. Any link that
   * is not one of the library's is not kept.
   */
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
      // (The last of the occasions: a second try of the same occasion does not move it, or a viewer pressing Try again every few minutes would never make two.)
      last: fresh && at - fresh.last < OCCASION_GAP_MS ? fresh.last : at,
    };
    this.records.delete(play.key); // (set again below, so the map stays in the order they were last met)
    this.records.set(play.key, record);
    this.touch(play.key);
    this.trim();
  }

  /** A look-up of `link` found a video: whatever was kept of it goes. */
  found(link: string): void {
    const play = playKeyOf(link);
    if (!play || !this.records.delete(play.key)) return;
    this.forget(play.key);
  }

  private marked(record: UnavailableRecord): boolean {
    return record.occasions >= OCCASIONS_TO_MARK && this.now() - record.last < MARK_MS;
  }

  /** What is marked of the title a link plays: the film, or the episodes of the show (any of the show's links asks for all of them). */
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

  /** Everything kept, for the team: the most occasions first, then the one met last. */
  list(): Array<UnavailableRecord & { marked: boolean }> {
    return [...this.records.values()]
      .filter((record) => this.now() - record.last < KEEP_MS)
      .map((record) => ({ ...record, marked: this.marked(record) }))
      .sort((a, b) => b.occasions - a.occasions || b.last - a.last);
  }
}

/** Where the list is kept: next to the accounts, but not among them (a table, or a file, of its own), as the visitor count is. */
export function unavailablePersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    // (The accounts' pool is shared, so closing this one must not end it: the accounts close it.)
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_unavailable");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "unavailable.json"));
  return new MemoryPersistence();
}
