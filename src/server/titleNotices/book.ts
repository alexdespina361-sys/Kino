import path from "node:path";
import { TITLE_NOTICE_KEEP_MS, TITLE_NOTICES_MAX, TitleNoticeSchema, type TitleNotice } from "../../shared";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import type { FilmPart, TitleSource } from "./source";

/**
 * The notices of what is new of the titles a profile watches (shared/titleNotices.ts): a new episode or season of a show, a new film of a series of
 * films. How it is kept cheap, and quiet:
 *
 * - A title is asked about once for everybody who watches it, and only when something may have changed: a show that is over once a week, one that
 *   is running on the day its next episode is due, a series of films once a week (every day while one of them is about to come out). A few titles
 *   a minute at most, so a start with everything due takes a while and hurts nobody.
 * - What is known is kept (a table or a file of its own, next to the accounts): a restart asks about nothing again and tells nobody twice.
 * - The first time a profile is seen to watch a title, it is told nothing: what is out by then is what it knows (its `base`). Only what comes out
 *   after that is news. So is a profile that turned the notices off: its base moves on, and turning them on again brings no backlog.
 * - An episode is news a day and a half after the start of the day it aired (`HOLD_MS`): the movie database dates an episode by the day in its own
 *   country, which begins up to a day before the episode is shown, and the places it plays from have it some hours after that. A film is news once
 *   it can be watched at home (a digital, a physical or a TV release), as the library's own rule has it.
 * - Only titles with a number in the movie database can be followed (the library's own links): a link pasted from somewhere else is not.
 *
 * It decides and keeps; `tell` is how a profile's phone hears (the Android app, through the push hub), a few times a day at most.
 */

const HOUR = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR;
export const HOLD_MS = 36 * HOUR;
/** How far into the day of its next episode a running show is asked about. */
const AIR_LOOK_MS = 12 * HOUR;
/** How many titles of a profile are followed (the newest first), and how many titles are asked about at each look. */
export const FOLLOWED_MAX = 80;
export const TITLES_PER_LOOK = 6;
/** How often it looks, and how often it reads again who watches what. */
export const LOOK_MS = 60_000;
export const SWEEP_MS = 5 * 60_000;
/** How many times a day a profile's phone is told. */
export const TELLS_PER_DAY = 3;
/** A film that came out longer ago than this is out at home: nobody is asked. */
const SURELY_HOME_MS = 365 * DAY_MS;
/** How many films of one series are asked about at one look (the rest at the next). */
const HOME_CHECKS = 4;
const PARTS_MAX = 60;
/** A first season longer than this is one a page may show in parts (a long anime): its episodes are not told of by number. */
export const ONE_SEASON_MAX = 26;
/** How often a line of the journal says that the movie database cannot be asked. */
const WARN_EVERY_MS = 6 * HOUR;
const FLUSH_MS = 5_000;
const RETRY_SAVE_MS = 60_000;

/** A title a profile watches: `tv-1399` or `movie-603`, and its name as the profile has it. */
export interface Followed {
  key: string;
  title: string;
}
export interface Follower {
  profile: string;
  /** Whether it wants to be told (its setting): one that does not is told nothing, and gets no backlog later. */
  on: boolean;
  /** A child's profile: told of the shows it watches, never of a film it has not seen (which may not be for children). */
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
  /** The last episode that is out, and news by now. */
  last: Ep | null;
  /** The first episode after it that aired and is not news yet, and when it is. */
  waiting?: Ep & { ripeAt: number };
}
interface FilmDoc {
  v: 1;
  kind: "movie";
  key: string;
  checkedAt: number;
  nextAt: number;
  /** The series of films it is one of; null for a film that is one of none. */
  collection: number | null;
}
interface SeriesDoc {
  v: 1;
  kind: "col";
  key: string;
  checkedAt: number;
  nextAt: number;
  parts: FilmPart[];
  /** The films of it that can be watched at home. */
  out: number[];
}
type TitleDoc = ShowDoc | FilmDoc | SeriesDoc;
interface ProfileDoc {
  v: 1;
  /** What was out of each show when the profile was last told (or first seen to watch it). */
  shows: Record<string, Ep>;
  /** The films of each series that were out then. */
  films: Record<string, number[]>;
  items: TitleNotice[];
  /** How many times its phone was told on which day. */
  told?: { day: string; n: number };
}

export interface TitleNoticeOptions {
  persistence: Persistence;
  source: TitleSource;
  /** Who watches what, read from the accounts (followers.ts). */
  followers: () => Follower[];
  /** A profile has news: its phone is told (never what, nor of which title). */
  tell?: (profile: string) => void;
  now?: () => number;
  log?: { warn(message: string): void };
  /** 0: nothing is written by itself (tests call `flush`). */
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
  /** Who watches each show and film, and who watches a film of each series (with the name of that film), as last read. */
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
  /** Who tells a profile's phone (the push hub, once the site has one). */
  onTell(tell: (profile: string) => void): void {
    this.tell = tell;
  }
  /** What it did (tests and the owner's numbers read it). */
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

  /** One kept document: what cannot be read is let go of (it is found out again). */
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

  /* ------------------------------ keeping ------------------------------ */

  private schedule(delay = this.options.flushMs ?? FLUSH_MS) {
    if ((this.options.flushMs ?? FLUSH_MS) <= 0) return;
    // (A save that failed has said so and is tried again by itself: nothing is left to hear of it here.)
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

  /** Write what changed. A failure is kept to try again. */
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

  /* ------------------------------ what a profile is shown ------------------------------ */

  private profile(id: string): ProfileDoc {
    let doc = this.profiles.get(id);
    if (!doc) {
      doc = { v: 1, shows: {}, films: {}, items: [] };
      this.profiles.set(id, doc);
    }
    return doc;
  }

  /** A profile's notices, the newest first (those older than a month are let go of). */
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

  /** The profile has looked at them: at the ones its bell listed (`ids`), or at all of them. */
  seen(profileId: string, ids?: readonly string[]): TitleNotice[] {
    const doc = this.profiles.get(profileId);
    const looked = (item: TitleNotice) => !item.read && (!ids || ids.includes(item.id));
    if (doc?.items.some(looked)) {
      doc.items = doc.items.map((item) => (looked(item) ? { ...item, read: true } : item));
      this.touch(`p:${profileId}`);
    }
    return this.of(profileId);
  }

  /** One is cleared away. */
  dismiss(profileId: string, id: string): TitleNotice[] {
    const doc = this.profiles.get(profileId);
    if (doc?.items.some((item) => item.id === id)) {
      doc.items = doc.items.filter((item) => item.id !== id);
      this.touch(`p:${profileId}`);
    }
    return this.of(profileId);
  }

  /** How much it keeps and did (the owner's numbers). */
  usage(): { titles: number; profiles: number; due: number; asked: number; failed: number; notices: number; told: number } {
    const now = this.now();
    return { titles: this.titles.size, profiles: this.profiles.size, due: [...this.titles.values()].filter((doc) => doc.nextAt <= now).length, ...this.counts };
  }

  /* ------------------------------ who watches what ------------------------------ */

  /** Reads who watches what, makes a place for each title that is new, and lets go of what nobody watches any more. */
  sweep(): void {
    const followers = this.options.followers();
    const watchers = new Map<string, Follower[]>();
    const seriesWatchers = new Map<string, Array<{ follower: Follower; like: string }>>();
    const alive = new Set<string>();
    const now = this.now();

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
          doc = kind === "tv" ? { v: 1, kind, key, checkedAt: 0, nextAt: 0, name: title, last: null } : { v: 1, kind, key, checkedAt: 0, nextAt: 0, collection: null };
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
            whole = { v: 1, kind: "col", key: seriesKey, checkedAt: 0, nextAt: 0, parts: [], out: [] };
            this.titles.set(seriesKey, whole);
            this.touchTitle(whole);
          }
          if (whole.kind === "col" && whole.checkedAt > 0) this.firstSightOfSeries(follower.profile, seriesKey, whole.out);
        }
      }
      // (What it no longer watches is forgotten: watched again later, it starts from what is out then.)
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

  /** (What a show has out when a profile is first seen to watch it: an episode that aired and waits to be news is out too, and is none to who begins now.) */
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

  /* ------------------------------ looking ------------------------------ */

  /**
   * One look: who watches what is read again when it is time, then the few titles that are due the longest are asked about. What changed is kept
   * before anybody is told, so that a server stopped in between tells nobody twice.
   */
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
      this.sweep();
      // (One line when it starts, so the journal shows it running and how much there is to ask.)
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
        // (The movie database could not be asked: what is known stays, and it is asked again in a while.)
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
    // (Not kept: it is in the bell all the same, and the phone is told when the next thing comes, rather than twice after a restart.)
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

    // An episode that waits to be news (`waiting`) is news when its time has come, whatever aired after it: a show with an episode every day would
    // otherwise never have one that is (each look would find a newer one, not yet news). The one after it then waits its own time.
    if (doc.waiting && (!show.last || later(doc.waiting, show.last))) delete doc.waiting; // (the movie database took it back)
    if (doc.waiting && now >= doc.waiting.ripeAt) {
      if (later(doc.waiting, doc.last ?? ZERO)) doc.last = { season: doc.waiting.season, episode: doc.waiting.episode };
      delete doc.waiting;
    }
    if (show.last && later(show.last, doc.last ?? ZERO)) {
      const ripeAt = show.last.day ? dayStart(show.last.day) + HOLD_MS : now;
      // (The first look at a show tells nobody anything: what is out by then is what everybody starts from.)
      if (first || now >= ripeAt) {
        doc.last = { season: show.last.season, episode: show.last.episode };
        delete doc.waiting;
      } else if (!doc.waiting) doc.waiting = { season: show.last.season, episode: show.last.episode, ripeAt };
    } else delete doc.waiting;
    const today = this.today();
    // (A running show is asked about on the day of its next episode, which then waits its time: asked only once that time has come, a show with an
    // episode every day would have the one after it by then, and the first of them would never be news by itself.)
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
        // (A show the movie database keeps as one long season is played in parts, numbered otherwise on its page - library/filmpire.ts `partsOf`:
        // its notice says that an episode is out, and not which number.)
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
    // (Which series a film is one of hardly ever changes: a film that is one of none may be made one when its sequel is announced.)
    doc.nextAt = now + 30 * DAY_MS;
    const collection = film?.collection ?? null;
    if (collection !== doc.collection) {
      doc.collection = collection;
      this.stale = true; // (who watches a film of which series is read again)
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
        waiting = true; // (announced, or in cinemas later)
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
        if (!part || !part.name || watched.has(`movie-${id}`)) continue; // (one it has watched already is no news to it)
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

  /** A notice for a profile: the one line of its title, the newest first; and its phone is to be told, a few times a day at most. */
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

  /* ------------------------------ running ------------------------------ */

  /** Looks every minute from now on (the first look a little after the start, when the site is up). */
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

/** Where it is kept: next to the accounts, but not among them (a table, or a file, of its own), as the visitor count is. */
export function titleNoticePersistenceFor(persistence: Persistence, kind: "postgres" | "file" | "memory", env: NodeJS.ProcessEnv = process.env): Persistence {
  if (persistence instanceof PostgresPersistence) {
    // (The accounts' pool is shared, so closing this one must not end it: the accounts close it.)
    return new PostgresPersistence({ query: (text, params) => persistence.db.query(text, params) }, "kino_title_notices");
  }
  if (kind === "file") return new FilePersistence(path.resolve(env.DATA_DIR ?? "data", "title-notices.json"));
  return new MemoryPersistence();
}
