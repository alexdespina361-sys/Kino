import {
  COLLECTIONS,
  DEFAULT_LIST,
  emptyData,
  isLive,
  LIMITS,
  listKey,
  listOf,
  ListNameSchema,
  MAX_LISTS,
  mergeCollection,
  mergeData,
  newListId,
  progressFor,
  progressKeyOf,
  RATING_NOTE_MAX,
  ratingKey,
  isScore,
  resolveLists,
  resolveSettings,
  seriesKeyOf,
  titleLink,
  watchedFor,
  watchedKey,
  type LibraryKind,
  type ListInfo,
  type LiveListItem,
  type LiveListName,
  type LiveProgress,
  type LiveRating,
  type LiveWatched,
  type NormalizedMedia,
  type Playback,
  type ProfileData,
  type SettingItem,
  type Settings,
  type SettingKey,
  type SyncItem,
  type SyncRequest,
  type SyncResponse,
  type WatchFacts,
} from "../../shared";
import { LEGACY_KEYS, readLegacy } from "./legacy";

/** Where what was watched is kept when nobody is signed in: this browser only. */
export const GUEST = "guest";
const KEY_PREFIX = "kino.data.";
const SAVE_AFTER_MS = 400;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the screens read: live items only, newest first. */
export interface Snapshot {
  scope: string;
  /** "Continue watching" and "Recently played": one card per film or show. */
  progress: LiveProgress[];
  watched: LiveWatched[];
  /** The lists, the first one always. */
  lists: ListInfo[];
  /** Every saved title of every list (a title in two lists is there twice), newest first. */
  list: LiveListItem[];
  /** What the profile rated: titles and seasons, the one changed last first. */
  ratings: LiveRating[];
  settings: Settings;
}

/** A title that can go in a list: what a library tile has. */
export interface ListEntry {
  id: string;
  title: string;
  url: string;
  image?: string | undefined;
  backdrop?: string | undefined;
  year?: number | undefined;
  description?: string | undefined;
}

/** A title that can be rated: the same, and whether it is a film or a show when that is known. */
export interface RatedTitle {
  title: string;
  url: string;
  image?: string | undefined;
  backdrop?: string | undefined;
  year?: number | undefined;
  kind?: LibraryKind | undefined;
}

/** What a person changes in a rating: the score, the note (the note alone changes nothing without a score). */
export interface RatingChange {
  score?: number;
  note?: string;
}

interface Saved {
  v: 1;
  data: ProfileData;
  /** The server's counter as of the last exchange with it. */
  rev: number;
  /** What was changed here (as "list:key") and has not been confirmed by the server yet. */
  dirty: string[];
}

const live = <T extends SyncItem>(items: readonly T[]) => items.filter((item) => !item.deleted) as Array<Exclude<T, { deleted: true }>>;
const byNewest = <T extends { at: number }>(items: T[]) => items.sort((a, b) => b.at - a.at);

/**
 * What the person has watched, saved in its lists, and chosen in the settings: in memory, kept in localStorage per place (the
 * browser's own "guest" copy, and one per profile), and brought into line with the server by `pending` and `accept`. All
 * changes are small items stamped with the time, so the copies on every screen settle on the same answer (see account.ts).
 */
export class ProfileStore {
  private scopeName = GUEST;
  private opened = false;
  private data: ProfileData = emptyData();
  private revision = 0;
  private dirty = new Set<string>();
  private snapshot: Snapshot | undefined;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: StorageLike | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.openScope(GUEST);
  }

  /* ------------------------------ reading ------------------------------ */

  get scope() {
    return this.scopeName;
  }
  /** The server's counter, as it was when this copy was last brought up to date. */
  get rev() {
    return this.revision;
  }

  getSnapshot = (): Snapshot => {
    if (!this.snapshot) {
      const lists = resolveLists(this.data.listNames);
      const known = new Set(lists.map((list) => list.id));
      // A title in a list that was removed on another screen meanwhile is in no list: it is not shown.
      this.snapshot = {
        scope: this.scopeName,
        progress: byNewest(live(this.data.progress)),
        watched: live(this.data.watched),
        lists,
        list: byNewest(live(this.data.list)).filter((item) => known.has(listOf(item))),
        ratings: byNewest(live(this.data.ratings)),
        settings: resolveSettings(this.data.settings),
      };
    }
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private changed(notify = true) {
    this.scheduleSave();
    if (!notify) return;
    this.snapshot = undefined;
    this.listeners.forEach((listener) => listener());
  }

  /* ------------------------------ keeping ------------------------------ */

  private read(scope: string): Saved | undefined {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + scope);
      const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : undefined;
      if (saved?.v !== 1 || !saved.data) return undefined;
      return { v: 1, data: { ...emptyData(), ...saved.data }, rev: saved.rev ?? 0, dirty: saved.dirty ?? [] };
    } catch {
      return undefined;
    }
  }

  private write(scope: string, saved: Saved) {
    try {
      this.storage?.setItem(KEY_PREFIX + scope, JSON.stringify(saved));
    } catch {
      /* storage full or unavailable: it is kept in memory until the page closes */
    }
  }

  private scheduleSave() {
    if (this.saveTimer || !this.storage) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  /** Write what has changed to localStorage now (the page is going away, or the scope is changing). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.write(this.scopeName, { v: 1, data: this.data, rev: this.revision, dirty: [...this.dirty] });
  }

  /** Start working with the copy kept for this place: the browser's own (`GUEST`), or one profile's. */
  openScope(scope: string) {
    if (this.opened && scope === this.scopeName) return;
    if (this.opened) this.flush();
    this.opened = true;
    this.scopeName = scope;
    const saved = this.read(scope);
    if (saved) {
      this.data = saved.data;
      this.revision = saved.rev;
      this.dirty = new Set(saved.dirty);
    } else {
      this.data = (scope === GUEST ? this.takeLegacy() : undefined) ?? emptyData();
      this.revision = 0;
      this.dirty = new Set();
    }
    this.changed(true);
  }

  /** The old per-screen lists (before accounts) become this browser's guest data, once. */
  private takeLegacy(): ProfileData | undefined {
    const storage = this.storage;
    if (!storage) return undefined;
    const data = readLegacy((key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    });
    for (const key of LEGACY_KEYS) {
      try {
        storage.removeItem(key);
      } catch {
        /* nothing to do */
      }
    }
    return data;
  }

  /** Forget a place's saved copy (when someone signs out of a shared screen, their history must not stay behind on it). */
  forget(scope: string) {
    if (scope === this.scopeName) {
      this.data = emptyData();
      this.revision = 0;
      this.dirty = new Set();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.snapshot = undefined;
    }
    try {
      this.storage?.removeItem(KEY_PREFIX + scope);
    } catch {
      /* nothing to do */
    }
  }

  /**
   * Sign-in on a screen that has been used without an account: what was watched here as a guest joins this profile, and the
   * guest's history is emptied (it is the profile's now). Returns whether anything came across.
   */
  adoptGuest(): boolean {
    if (this.scopeName === GUEST) return false;
    const guest = this.read(GUEST);
    if (!guest || guest.data.progress.length + guest.data.watched.length + guest.data.list.length + guest.data.listNames.length + guest.data.ratings.length === 0) return false;
    // The guest's settings stay with the guest: a profile's own choices are not overwritten by a visitor's.
    this.data = mergeData(this.data, { ...guest.data, settings: [] }, this.now());
    // What came across is old news here, but the server has not seen it.
    this.markAllDirty();
    this.write(GUEST, { v: 1, data: { ...emptyData(), settings: guest.data.settings }, rev: 0, dirty: [] });
    this.changed();
    return true;
  }

  /* ------------------------------ what is watched ------------------------------ */

  /** Add an item (or its removal) to one list, keeping the lists as short as they are meant to be. It is now news for the server. */
  private put<T extends SyncItem>(name: keyof ProfileData, item: T) {
    const before = (this.data[name] as SyncItem[]).find((other) => other.key === item.key);
    // A change made here is the newest this copy has seen of the thing, even when this screen's clock runs behind the one that made the
    // last change: otherwise the server would keep that one, and this screen would show a switch that is not the one the server acts on.
    const next = before && before.at >= item.at ? { ...item, at: before.at + 1 } : item;
    const rest = (this.data[name] as SyncItem[]).filter((other) => other.key !== item.key);
    const items = mergeCollection<SyncItem>([next, ...rest], [], { limit: LIMITS[name], now: this.now() });
    this.data = { ...this.data, [name]: items } as ProfileData;
    this.dirty.add(`${name}:${item.key}`);
    this.changed();
  }

  private markAllDirty() {
    for (const name of COLLECTIONS) for (const item of this.data[name]) this.dirty.add(`${name}:${item.key}`);
  }

  private find<T extends SyncItem>(name: keyof ProfileData, key: string): (T & { deleted?: undefined }) | undefined {
    const found = (this.data[name] as SyncItem[]).find((item) => item.key === key);
    return found && isLive(found) ? (found as T & { deleted?: undefined }) : undefined;
  }

  /** A video was found and is starting: it moves to the front of "Continue watching", keeping its place if it was left unfinished. */
  playbackStarted(media: NormalizedMedia) {
    const key = progressKeyOf(media);
    const card = key ? progressFor(media, this.now(), undefined, this.find<LiveProgress>("progress", key)) : undefined;
    if (card) this.put("progress", card);
  }

  /** The video is at this point. Does nothing, and costs nothing, until it has moved far enough to be worth saving. */
  playbackAt(media: NormalizedMedia, playback: Playback) {
    const now = this.now();
    const key = progressKeyOf(media);
    if (key) {
      const before = this.find<LiveProgress>("progress", key);
      const card = progressFor(media, now, playback, before);
      if (card && card !== before) this.put("progress", card);
    }
    const show = seriesKeyOf(media);
    if (show && media.series) {
      const before = this.find<LiveWatched>("watched", watchedKey({ show, season: media.series.season, episode: media.series.episode }));
      const mark = watchedFor(media, playback, now, before);
      if (mark && mark !== before) this.put("watched", mark);
    }
  }

  /** Take a title off "Continue watching". Watching it again brings it back. */
  removeProgress(key: string) {
    this.put("progress", { key, at: this.now(), deleted: true });
  }

  /** Take a title off a list (the first one, when none is named), under whichever link it was saved with: a show saved by one of its episodes is the same show. */
  removeFromList(url: string, list: string = DEFAULT_LIST) {
    const key = listKey(url, list);
    const at = this.now();
    const keys = new Set([key, ...live(this.data.list).filter((item) => listOf(item) === list && listKey(item.url, list) === key).map((item) => item.key)]);
    for (const each of keys) this.put("list", { key: each, at, deleted: true });
  }

  /** Put a title in a list or take it out. A show goes in by its first episode's link, whichever episode it was found by. */
  setInList(entry: ListEntry, inList: boolean, list: string = DEFAULT_LIST) {
    if (!inList) return this.removeFromList(entry.url, list);
    const url = titleLink(entry.url);
    const item: LiveListItem = {
      key: listKey(url, list),
      at: this.now(),
      ...(list === DEFAULT_LIST ? {} : { list }),
      id: entry.id.slice(0, 200),
      title: entry.title.slice(0, 300),
      url,
      ...(entry.image ? { image: entry.image } : {}),
      ...(entry.backdrop ? { backdrop: entry.backdrop } : {}),
      ...(entry.year ? { year: entry.year } : {}),
      ...(entry.description ? { description: entry.description.slice(0, 400) } : {}),
    };
    this.put("list", item);
  }

  /** Make a list: its id, or nothing when it has no name or there are as many lists as there can be. */
  createList(name: string): string | undefined {
    const named = ListNameSchema.safeParse(name);
    if (!named.success || resolveLists(this.data.listNames).length >= MAX_LISTS) return undefined;
    const key = newListId(this.now());
    this.put("listNames", { key, at: this.now(), name: named.data });
    return key;
  }

  /** Give a list another name (the first list too: until then it is called "Favourites"). It keeps its place among the others. */
  renameList(id: string, name: string) {
    const named = ListNameSchema.safeParse(name);
    if (!named.success || !resolveLists(this.data.listNames).some((list) => list.id === id)) return;
    const { order } = this.find<LiveListName>("listNames", id) ?? {};
    this.put("listNames", { key: id, at: this.now(), name: named.data, ...(order === undefined ? {} : { order }) });
  }

  /** Put a list one place earlier or later among the others. The first list stays first, whatever is done. */
  moveList(id: string, by: -1 | 1) {
    const ids = resolveLists(this.data.listNames)
      .map((list) => list.id)
      .filter((other) => other !== DEFAULT_LIST);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    const at = this.now();
    // Every list is given its place, so that one that was never placed does not end up somewhere else than where it was shown.
    ids.forEach((key, order) => {
      const named = this.find<LiveListName>("listNames", key);
      if (named && named.order !== order) this.put("listNames", { ...named, at, order });
    });
  }

  /** Remove a list and the titles in it. The first list stays, whatever is done: it can be renamed and emptied, not removed. */
  deleteList(id: string) {
    if (id === DEFAULT_LIST) return;
    const at = this.now();
    for (const item of live(this.data.list)) if (listOf(item) === id) this.put("list", { key: item.key, at, deleted: true });
    this.put("listNames", { key: id, at, deleted: true });
  }

  /**
   * Give a title (or one season of a show) a score, a note, or both: the score is what makes it a rating, so a note on its own is kept
   * only for a title that has one. What was watched at that moment (`facts`, see rating.ts) is remembered with it; a rating that is changed
   * again keeps what it knew when `facts` has nothing new. The rating's date moves only with the score.
   */
  setRating(title: RatedTitle, season: number | undefined, change: RatingChange, facts: WatchFacts = {}) {
    const url = titleLink(title.url);
    const key = ratingKey(url, season);
    if (key.length > 400 || url.length > 2048) return;
    const before = this.find<LiveRating>("ratings", key);
    const score = change.score ?? before?.score;
    if (score === undefined || !isScore(score)) return;
    const at = this.now();
    const note = change.note !== undefined ? change.note.trim().slice(0, RATING_NOTE_MAX) : before?.note;
    const known = <K extends keyof WatchFacts>(name: K): WatchFacts[K] => facts[name] ?? before?.[name];
    const [watchedAt, percent, seen, of] = [known("watchedAt"), known("percent"), known("seen"), known("of")];
    const image = title.image ?? before?.image;
    const backdrop = title.backdrop ?? before?.backdrop;
    const year = title.year ?? before?.year;
    const kind = title.kind ?? before?.kind;
    this.put("ratings", {
      key,
      at,
      title: title.title.slice(0, 300),
      url,
      ...(image ? { image } : {}),
      ...(backdrop ? { backdrop } : {}),
      ...(year ? { year } : {}),
      ...(kind ? { kind } : {}),
      ...(season ? { season } : {}),
      score,
      ...(note ? { note } : {}),
      ratedAt: change.score !== undefined && change.score !== before?.score ? at : (before?.ratedAt ?? at),
      ...(watchedAt !== undefined ? { watchedAt } : {}),
      ...(percent !== undefined ? { percent } : {}),
      ...(seen !== undefined ? { seen } : {}),
      ...(of !== undefined ? { of } : {}),
    } satisfies LiveRating);
  }

  /** Take back a rating (of a title, or of one of its seasons). */
  removeRating(url: string, season?: number) {
    this.put("ratings", { key: ratingKey(url, season), at: this.now(), deleted: true });
  }

  /** A setting (language, colour...). `undefined` goes back to the default. */
  setSetting<K extends SettingKey>(key: K, value: Settings[K] | undefined) {
    const at = this.now();
    this.put("settings", (value === undefined ? { key, at, deleted: true } : { key, at, value }) as SettingItem);
  }

  /* ------------------------------ staying in step with the server ------------------------------ */

  /** What to tell the server: what changed here and has not been confirmed, and where this copy is up to. `sent` goes back to `accept`. */
  pending(): { request: SyncRequest; sent: Map<string, number> } {
    const sent = new Map<string, number>();
    const send = (name: keyof ProfileData) =>
      (this.data[name] as SyncItem[]).filter((item) => {
        const id = `${name}:${item.key}`;
        if (!this.dirty.has(id)) return false;
        sent.set(id, item.at);
        return true;
      });
    const request = { since: this.revision, ...Object.fromEntries(COLLECTIONS.map((name) => [name, send(name)])) } as SyncRequest;
    return { request, sent };
  }

  /** The server answered: take in what other screens did, and note that what was sent is safe (unless it changed again meanwhile). */
  accept(response: SyncResponse, sent: ReadonlyMap<string, number>): void {
    const incoming: ProfileData = { progress: response.progress, watched: response.watched, list: response.list, listNames: response.listNames, ratings: response.ratings, settings: response.settings };
    // What the server answers about a thing this screen has just sent is the server's word, even when its copy is the older: it holds back
    // the time of a clock that runs ahead (this screen would otherwise keep its copy over every later change made on another screen, and
    // show a switch that is not the one the server acts on), and it may have preferred another screen's copy. So a thing that was sent and
    // is answered with an older copy takes that one, unless it has been changed here again since.
    const overruled = new Set<string>();
    for (const [id, at] of sent) {
      const split = id.indexOf(":");
      const name = id.slice(0, split) as keyof ProfileData;
      const key = id.slice(split + 1);
      const mine = (this.data[name] as SyncItem[]).find((item) => item.key === key);
      const theirs = (incoming[name] as SyncItem[]).find((item) => item.key === key);
      if (mine && theirs && mine.at === at && theirs.at < at) overruled.add(id);
    }
    const without = <T extends SyncItem>(name: keyof ProfileData, items: readonly T[]): T[] => items.filter((item) => !overruled.has(`${name}:${item.key}`));
    const kept: ProfileData =
      overruled.size === 0
        ? this.data
        : {
            progress: without("progress", this.data.progress),
            watched: without("watched", this.data.watched),
            list: without("list", this.data.list),
            listNames: without("listNames", this.data.listNames),
            ratings: without("ratings", this.data.ratings),
            settings: without("settings", this.data.settings),
          };
    const merged = mergeData(kept, incoming, this.now());
    const different = JSON.stringify(merged) !== JSON.stringify(this.data);
    this.data = merged;
    this.revision = response.rev;
    for (const [id, at] of sent) {
      const split = id.indexOf(":");
      const list = this.data[id.slice(0, split) as keyof ProfileData] as SyncItem[];
      const now = list.find((item) => item.key === id.slice(split + 1));
      if (!now || now.at === at || overruled.has(id)) this.dirty.delete(id);
    }
    // The server lost what it had: it needs all of it again.
    if (response.reset) this.markAllDirty();
    this.changed(different);
  }
}
