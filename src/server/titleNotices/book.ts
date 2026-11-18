import path from "node:path";
import { TITLE_NOTICE_KEEP_MS, TITLE_NOTICES_MAX, TitleNoticeSchema, type TitleNotice } from "../../shared";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import type { FilmPart, TitleSource } from "./source";

const HOUR = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR;
export const HOLD_MS = 36 * HOUR;
const AIR_LOOK_MS = 12 * HOUR;
export const FOLLOWED_MAX = 80;
export const TITLES_PER_LOOK = 6;
export const LOOK_MS = 60_000;
export const SWEEP_MS = 5 * 60_000;
export const TELLS_PER_DAY = 3;
const SURELY_HOME_MS = 365 * DAY_MS;
const HOME_CHECKS = 4;
const PARTS_MAX = 60;
export const ONE_SEASON_MAX = 26;
const WARN_EVERY_MS = 6 * HOUR;
const FLUSH_MS = 5_000;
const RETRY_SAVE_MS = 60_000;

export interface Followed {
  key: string;
  title: string;
}
export interface Follower {
  profile: string;
  on: boolean;
  child: boolean;
  titles: Followed[];
}

interface Ep {
  season: number;
  episode: number;
}
interface ShowDoc {
  v: 1;
  kind: "tv";
  key: string;
  checkedAt: number;
  nextAt: number;
  name: string;
  image?: string;
  backdrop?: string;
  year?: number;
  last: Ep | null;
  waiting?: Ep & { ripeAt: number };
}
interface FilmDoc {
  v: 1;
  kind: "movie";
  key: string;
  checkedAt: number;
  nextAt: number;
  collection: number | null;
}
interface SeriesDoc {
  v: 1;
  kind: "col";
  key: string;
  checkedAt: number;
  nextAt: number;
  parts: FilmPart[];
  out: number[];
}
type TitleDoc = ShowDoc | FilmDoc | SeriesDoc;
interface ProfileDoc {
  v: 1;
  shows: Record<string, Ep>;
  films: Record<string, number[]>;
  items: TitleNotice[];
  told?: { day: string; n: number };
}

export interface TitleNoticeOptions {
  persistence: Persistence;
  source: TitleSource;
  followers: () => Follower[];
  tell?: (profile: string) => void;
  now?: () => number;
  log?: { warn(message: string): void };
  flushMs?: number;
}

const ZERO: Ep = { season: 0, episode: 0 };
const later = (a: Ep, b: Ep): boolean => a.season > b.season || (a.season === b.season && a.episode > b.episode);
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const numberOf = (key: string): number => Number(key.slice(key.indexOf("-") + 1));
const isEp = (value: unknown): value is Ep => !!value && typeof value === "object" && Number.isInteger((value as Ep).season) && Number.isInteger((value as Ep).episode);

export class TitleNoticeBook {
  private readonly titles = new Map<string, TitleDoc>();
  private readonly profiles = new Map<string, ProfileDoc>();
  private watchers = new Map<string, Follower[]>();
  private seriesWatchers = new Map<string, Array<{ follower: Follower; like: string }>>();
  private sweptAt = -Infinity;
  private warnedAt = -Infinity;
  private stale = true;
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private saving: Promise<void> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lookTimer: ReturnType<typeof setInterval> | undefined;
  private looking: Promise<void> | undefined;
  private tell: ((profile: string) => void) | undefined;
  onTell(tell: (profile: string) => void): void {
    this.tell = tell;
  }
  readonly counts = { asked: 0, failed: 0, notices: 0, told: 0 };

  private constructor(private readonly options: TitleNoticeOptions) {}

  static async open(options: TitleNoticeOptions): Promise<TitleNoticeBook> {
    const book = new TitleNoticeBook(options);
    for (const [key, value] of await options.persistence.load()) book.take(key, value);
    return book;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  private take(key: string, value: unknown) {
    const doc = value as Partial<TitleDoc & ProfileDoc> | null;
    if (!doc || typeof doc !== "object" || doc.v !== 1) return void this.removed.add(key);
    if (key.startsWith("t:")) {
      const title = doc as TitleDoc;
      if (typeof title.key !== "string" || typeof title.nextAt !== "number" || !["tv", "movie", "col"].includes(title.kind)) return void this.removed.add(key);
      this.titles.set(title.key, title);
    } else if (key.startsWith("p:")) {
      const shows = Object.fromEntries(Object.entries(doc.shows ?? {}).filter(([, ep]) => isEp(ep)));
      const films = Object.fromEntries(Object.entries(doc.films ?? {}).filter(([, ids]) => Array.isArray(ids)));
      const items = (Array.isArray(doc.items) ? doc.items : []).flatMap((item) => {
        const known = TitleNoticeSchema.safeParse(item);
        return known.success ? [known.data] : [];
      });
      this.profiles.set(key.slice(2), { v: 1, shows, films, items, ...(doc.told ? { told: doc.told } : {}) });
    } else this.removed.add(key);
  }

  private schedule(delay = this.options.flushMs ?? FLUSH_MS) {
    if ((this.options.flushMs ?? FLUSH_MS) <= 0) return;
    this.saveTimer ??= setTimeout(() => void this.flush().catch(() => {}), delay);
    this.saveTimer.unref?.();
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
  private touchTitle(doc: TitleDoc) {
    this.touch(`t:${doc.key}`);
  }

  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        if (this.dirty.size === 0 && this.removed.size === 0) return;
        const put = new Map<string, unknown>();
        for (const key of this.dirty) {
          const doc = key.startsWith("t:") ? this.titles.get(key.slice(2)) : this.profiles.get(key.slice(2));
          if (doc) put.set(key, doc);
        }
        const remove = new Set(this.removed);
        this.dirty.clear();
        this.removed.clear();
        try {
          await this.options.persistence.save({ put, remove });
        } catch (error) {
          for (const key of put.keys()) if (!this.removed.has(key)) this.dirty.add(key);
          for (const key of remove) if (!this.dirty.has(key)) this.removed.add(key);
          this.options.log?.warn(`Could not save the notices of new episodes: ${(error as Error).message}`);
          this.schedule(RETRY_SAVE_MS);
          throw error;
        }
      });
    return this.saving;
  }

  private profile(id: string): ProfileDoc {
    let doc = this.profiles.get(id);
    if (!doc) {
      doc = { v: 1, shows: {}, films: {}, items: [] };
      this.profiles.set(id, doc);
    }
    return doc;
  }

  of(profileId: string): TitleNotice[] {
    const doc = this.profiles.get(profileId);
    if (!doc) return [];
    const from = this.now() - TITLE_NOTICE_KEEP_MS;
    if (doc.items.some((item) => item.at < from)) {
      doc.items = doc.items.filter((item) => item.at >= from);
      this.touch(`p:${profileId}`);
    }
    return doc.items.map((item) => ({ ...item }));
  }

  seen(profileId: string, ids?: readonly string[]): TitleNotice[] {
    const doc = this.profiles.get(profileId);
    const looked = (item: TitleNotice) => !item.read && (!ids || ids.includes(item.id));
    if (doc?.items.some(looked)) {
      doc.items = doc.items.map((item) => (looked(item) ? { ...item, read: true } : item));
      this.touch(`p:${profileId}`);
    }
    return this.of(profileId);
  }

  dismiss(profileId: string, id: string): TitleNotice[] {
    const doc = this.profiles.get(profileId);
    if (doc?.items.some((item) => item.id === id)) {
      doc.items = doc.items.filter((item) => item.id !== id);
      this.touch(`p:${profileId}`);
    }
    return this.of(profileId);
  }

  usage(): { titles: number; profiles: number; due: number; asked: number; failed: number; notices: number; told: number } {
    const now = this.now();
    return { titles: this.titles.size, profiles: this.profiles.size, due: [...this.titles.values()].filter((doc) => doc.nextAt <= now).length, ...this.counts };
  }

  sweep(now = this.now()): void {
    const followers = this.options.followers();
    const watchers = new Map<string, Follower[]>();
    const seriesWatchers = new Map<string, Array<{ follower: Follower; like: string }>>();
    const alive = new Set<string>();

    for (const follower of followers) {
      alive.add(follower.profile);
      const followed = follower.titles.slice(0, FOLLOWED_MAX);
      const keys = new Set(followed.map((title) => title.key));
      const series = new Set<string>();
      for (const { key, title } of followed) {
        const kind = key.startsWith("tv-") ? "tv" : key.startsWith("movie-") ? "movie" : undefined;
        if (!kind || !Number.isInteger(numberOf(key))) continue;
        let doc = this.titles.get(key);
        if (!doc) {
          doc = kind === "tv" ? { v: 1, kind, key, checkedAt: 0, nextAt: now, name: title, last: null } : { v: 1, kind, key, checkedAt: 0, nextAt: now, collection: null };
          this.titles.set(key, doc);
          this.touchTitle(doc);
        }
        watchers.set(key, [...(watchers.get(key) ?? []), follower]);
        if (doc.kind === "tv" && doc.checkedAt > 0) this.firstSight(follower.profile, key, doc.waiting ?? doc.last);
        if (doc.kind === "movie" && doc.collection !== null) {
          const seriesKey = `col-${doc.collection}`;
          if (!series.has(seriesKey)) {
            series.add(seriesKey);
            seriesWatchers.set(seriesKey, [...(seriesWatchers.get(seriesKey) ?? []), { follower, like: title }]);
          }
          let whole = this.titles.get(seriesKey);
          if (!whole) {
            whole = { v: 1, kind: "col", key: seriesKey, checkedAt: 0, nextAt: now, parts: [], out: [] };
            this.titles.set(seriesKey, whole);
            this.touchTitle(whole);
          }
          if (whole.kind === "col" && whole.checkedAt > 0) this.firstSightOfSeries(follower.profile, seriesKey, whole.out);
        }
      }
      const kept = this.profiles.get(follower.profile);
      if (kept) {
        const gone = [...Object.keys(kept.shows).filter((key) => !keys.has(key)), ...Object.keys(kept.films).filter((key) => !series.has(key))];
        if (gone.length > 0) {
          for (const key of gone) {
            delete kept.shows[key];
            delete kept.films[key];
          }
          this.touch(`p:${follower.profile}`);
        }
      }
    }

    for (const id of [...this.profiles.keys()]) {
      if (alive.has(id)) continue;
      this.profiles.delete(id);
      this.forget(`p:${id}`);
    }
    for (const [key, doc] of [...this.titles]) {
      if (doc.kind === "col" ? seriesWatchers.has(key) : watchers.has(key)) continue;
      this.titles.delete(key);
      this.forget(`t:${key}`);
    }
    this.watchers = watchers;
    this.seriesWatchers = seriesWatchers;
    this.sweptAt = now;
    this.stale = false;
  }

  private firstSight(profileId: string, key: string, last: Ep | null) {
    const doc = this.profile(profileId);
    if (doc.shows[key]) return;
    doc.shows[key] = last ? { season: last.season, episode: last.episode } : ZERO;
    this.touch(`p:${profileId}`);
  }
  private firstSightOfSeries(profileId: string, key: string, out: readonly number[]) {
    const doc = this.profile(profileId);
    if (doc.films[key]) return;
    doc.films[key] = [...out];
    this.touch(`p:${profileId}`);
  }

  async look(): Promise<void> {
    if (this.looking) return this.looking;
    this.looking = this.lookOnce().finally(() => {
      this.looking = undefined;
    });
    return this.looking;
  }

  private async lookOnce(): Promise<void> {
    const now = this.now();
    if (this.stale || now - this.sweptAt >= SWEEP_MS) {
      const first = this.sweptAt === -Infinity;
      this.sweep(now);
      if (first) this.options.log?.warn(`New episodes: ${this.titles.size} titles watched by ${this.watchers.size > 0 ? this.profiles.size : 0} profiles with something kept, ${[...this.titles.values()].filter((doc) => doc.nextAt <= now).length} to ask about now (${TITLES_PER_LOOK} a minute).`);
    }
    const due = [...this.titles.values()]
      .filter((doc) => doc.nextAt <= now)
      .sort((a, b) => a.nextAt - b.nextAt)
      .slice(0, TITLES_PER_LOOK);
    const toTell = new Set<string>();
    for (const doc of due) {
      try {
        this.counts.asked++;
        if (doc.kind === "tv") await this.lookAtShow(doc, toTell);
        else if (doc.kind === "movie") await this.lookAtFilm(doc);
        else await this.lookAtSeries(doc, toTell);
      } catch (error) {
        this.counts.failed++;
        doc.nextAt = this.now() + HOUR / 2;
        if (this.now() - this.warnedAt >= WARN_EVERY_MS) {
          this.warnedAt = this.now();
          this.options.log?.warn(`New episodes: the movie database could not be asked about ${doc.key} (${(error as Error).message}); asked again in half an hour. ${this.counts.failed} of ${this.counts.asked} questions have failed since the start.`);
        }
      }
      this.touchTitle(doc);
    }
    if (toTell.size === 0) return;
    const kept = await this.flush().then(
      () => true,
      () => false,
    );
    if (!kept) return;
    for (const profile of toTell) {
      this.counts.told++;
      (this.tell ?? this.options.tell)?.(profile);
    }
  }

  private async lookAtShow(doc: ShowDoc, toTell: Set<string>): Promise<void> {
    const now = this.now();
    const id = numberOf(doc.key);
    const show = await this.options.source.show(id);
    const first = doc.checkedAt === 0;
    doc.checkedAt = now;
    if (!show) {
      doc.nextAt = now + 7 * DAY_MS;
      return;
    }
    if (show.name) doc.name = show.name;
    for (const part of ["image", "backdrop", "year"] as const) if (show[part] !== undefined) (doc as unknown as Record<string, unknown>)[part] = show[part];

    if (doc.waiting && (!show.last || later(doc.waiting, show.last))) delete doc.waiting;
    if (doc.waiting && now >= doc.waiting.ripeAt) {
      if (later(doc.waiting, doc.last ?? ZERO)) doc.last = { season: doc.waiting.season, episode: doc.waiting.episode };
      delete doc.waiting;
    }
    if (show.last && later(show.last, doc.last ?? ZERO)) {
      const ripeAt = show.last.day ? dayStart(show.last.day) + HOLD_MS : now;
      if (first || now >= ripeAt) {
        doc.last = { season: show.last.season, episode: show.last.episode };
        delete doc.waiting;
      } else if (!doc.waiting) doc.waiting = { season: show.last.season, episode: show.last.episode, ripeAt };
    } else delete doc.waiting;
    const today = this.today();
    const usual = show.ended ? now + 7 * DAY_MS : show.nextDay && show.nextDay > today ? Math.min(Math.max(dayStart(show.nextDay) + AIR_LOOK_MS, now + HOUR), now + 7 * DAY_MS) : now + (show.nextDay ? 3 * HOUR : DAY_MS);
    doc.nextAt = doc.waiting ? Math.min(Math.max(doc.waiting.ripeAt, now + HOUR / 4), usual) : usual;

    for (const follower of this.watchers.get(doc.key) ?? []) {
      const kept = this.profile(follower.profile);
      const base = kept.shows[doc.key];
      if (!base) {
        this.firstSight(follower.profile, doc.key, doc.waiting ?? doc.last);
        continue;
      }
      if (!doc.last || !later(doc.last, base)) continue;
      const fresh = doc.last;
      kept.shows[doc.key] = { season: fresh.season, episode: fresh.episode };
      this.touch(`p:${follower.profile}`);
      if (!follower.on) continue;
      const before = kept.items.find((item) => item.id === doc.key && !item.read);
      const newSeason = fresh.season > base.season || before?.what === "season";
      const count = newSeason ? undefined : fresh.episode - base.episode + (before ? (before.count ?? 1) : 0);
      this.add(follower.profile, toTell, {
        id: doc.key,
        at: now,
        what: newSeason ? "season" : "episode",
        title: doc.name,
        url: `https://filmpire.sc/watch/${id}?s=1&e=1`,
        ...(doc.image ? { image: doc.image } : {}),
        ...(doc.backdrop ? { backdrop: doc.backdrop } : {}),
        ...(doc.year ? { year: doc.year } : {}),
        ...(fresh.season === 1 && fresh.episode > ONE_SEASON_MAX ? {} : { season: fresh.season, episode: fresh.episode }),
        ...(count !== undefined && count >= 2 ? { count: Math.min(count, 5000) } : {}),
        read: false,
      });
    }
  }

  private async lookAtFilm(doc: FilmDoc): Promise<void> {
    const now = this.now();
    const film = await this.options.source.film(numberOf(doc.key));
    doc.checkedAt = now;
    doc.nextAt = now + 30 * DAY_MS;
    const collection = film?.collection ?? null;
    if (collection !== doc.collection) {
      doc.collection = collection;
      this.stale = true;
    }
  }

  private async lookAtSeries(doc: SeriesDoc, toTell: Set<string>): Promise<void> {
    const now = this.now();
    const today = this.today();
    const parts = await this.options.source.parts(numberOf(doc.key));
    const first = doc.checkedAt === 0;
    if (!parts) {
      doc.checkedAt = now;
      doc.nextAt = now + 30 * DAY_MS;
      return;
    }
    doc.parts = parts.slice(0, PARTS_MAX);
    const out = new Set(doc.out.filter((id) => doc.parts.some((part) => part.id === id)));
    let asked = 0;
    let waiting = false;
    for (const part of doc.parts) {
      if (out.has(part.id)) continue;
      if (!part.day || part.day > today) {
        waiting = true;
        continue;
      }
      if (now - dayStart(part.day) >= SURELY_HOME_MS) {
        out.add(part.id);
        continue;
      }
      if (asked >= HOME_CHECKS) {
        waiting = true;
        continue;
      }
      asked++;
      if (await this.options.source.outAtHome(part.id, now)) out.add(part.id);
      else waiting = true;
    }
    doc.out = [...out];
    doc.checkedAt = now;
    doc.nextAt = now + (waiting ? DAY_MS : 7 * DAY_MS);

    for (const { follower, like } of this.seriesWatchers.get(doc.key) ?? []) {
      const kept = this.profile(follower.profile);
      const base = kept.films[doc.key];
      if (!base || first) {
        if (!base) this.firstSightOfSeries(follower.profile, doc.key, doc.out);
        continue;
      }
      const fresh = doc.out.filter((id) => !base.includes(id));
      if (fresh.length === 0) continue;
      kept.films[doc.key] = [...new Set([...base, ...doc.out])];
      this.touch(`p:${follower.profile}`);
      if (!follower.on || follower.child) continue;
      const watched = new Set(follower.titles.map((title) => title.key));
      for (const id of fresh) {
        const part = doc.parts.find((each) => each.id === id);
        if (!part || !part.name || watched.has(`movie-${id}`)) continue;
        this.add(follower.profile, toTell, {
          id: `movie-${id}`,
          at: now,
          what: "film",
          title: part.name,
          url: `https://filmpire.sc/watch/${id}`,
          ...(part.image ? { image: part.image } : {}),
          ...(part.backdrop ? { backdrop: part.backdrop } : {}),
          ...(part.year ? { year: part.year } : {}),
          ...(like ? { like: like.slice(0, 300) } : {}),
          read: false,
        });
      }
    }
  }

  private add(profileId: string, toTell: Set<string>, notice: TitleNotice) {
    const doc = this.profile(profileId);
    doc.items = [notice, ...doc.items.filter((item) => item.id !== notice.id)].slice(0, TITLE_NOTICES_MAX);
    this.counts.notices++;
    const day = this.today();
    const told = doc.told?.day === day ? doc.told.n : 0;
    if (told < TELLS_PER_DAY && !toTell.has(profileId)) {
      doc.told = { day, n: told + 1 };
      toTell.add(profileId);
    }
    this.touch(`p:${profileId}`);
  }

  start(): void {
    if (this.lookTimer) return;
    this.lookTimer = setInterval(() => void this.look().catch((error: Error) => this.options.log?.warn(`The look for new episodes failed: ${error.message}`)), LOOK_MS);
    this.lookTimer.unref?.();
  }

  async close(): Promise<void> {
    if (this.lookTimer) clearInterval(this.lookTimer);
    this.lookTimer = undefined;
    await this.looking?.catch(() => {});
    await this.flush().catch(() => {});
    await this.options.persistence.close?.();
  }
}

export function titleNoticePersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_title_notices");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "title-notices.json"));
  return new MemoryPersistence();
}
