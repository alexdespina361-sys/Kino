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
  type LiveSaved,
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

export const GUEST = "guest";
const KEY_PREFIX = "kino.data.";
const SAVE_AFTER_MS = 400;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Snapshot {
  scope: string;
  progress: LiveProgress[];
  watched: LiveWatched[];
  lists: ListInfo[];
  list: LiveListItem[];
  ratings: LiveRating[];
  settings: Settings;
  saved: LiveSaved[];
  waiting: boolean;
}

export interface ListEntry {
  id: string;
  title: string;
  url: string;
  image?: string | undefined;
  backdrop?: string | undefined;
  year?: number | undefined;
  description?: string | undefined;
}

export interface RatedTitle {
  title: string;
  url: string;
  image?: string | undefined;
  backdrop?: string | undefined;
  year?: number | undefined;
  kind?: LibraryKind | undefined;
  section?: "cartoon" | "anime" | undefined;
}

export interface RatingChange {
  score?: number;
  note?: string;
}

interface Saved {
  v: 1;
  data: ProfileData;
  rev: number;
  dirty: string[];
  answered?: boolean;
}

const live = <T extends SyncItem>(items: readonly T[]) => items.filter((item) => !item.deleted) as Array<Exclude<T, { deleted: true }>>;
const byNewest = <T extends { at: number }>(items: T[]) => items.sort((a, b) => b.at - a.at);

export class ProfileStore {
  private scopeName = GUEST;
  private opened = false;
  private data: ProfileData = emptyData();
  private revision = 0;
  private dirty = new Set<string>();
  private answered = true;
  private snapshot: Snapshot | undefined;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: StorageLike | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.openScope(GUEST);
  }

  get scope() {
    return this.scopeName;
  }
  get rev() {
    return this.revision;
  }

  getSnapshot = (): Snapshot => {
    if (!this.snapshot) {
      const lists = resolveLists(this.data.listNames);
      const known = new Set(lists.map((list) => list.id));
      this.snapshot = {
        scope: this.scopeName,
        progress: byNewest(live(this.data.progress)),
        watched: live(this.data.watched),
        lists,
        list: byNewest(live(this.data.list)).filter((item) => known.has(listOf(item))),
        ratings: byNewest(live(this.data.ratings)),
        settings: resolveSettings(this.data.settings),
        saved: byNewest(live(this.data.saved)),
        waiting: !this.answered,
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

  private read(scope: string): Saved | undefined {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + scope);
      const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : undefined;
      if (saved?.v !== 1 || !saved.data) return undefined;
      return { v: 1, data: { ...emptyData(), ...saved.data }, rev: saved.rev ?? 0, dirty: saved.dirty ?? [], answered: saved.answered ?? (saved.rev ?? 0) > 0 };
    } catch {
      return undefined;
    }
  }

  private write(scope: string, saved: Saved) {
    try {
      this.storage?.setItem(KEY_PREFIX + scope, JSON.stringify(saved));
    } catch {
    }
  }

  private scheduleSave() {
    if (this.saveTimer || !this.storage) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.write(this.scopeName, { v: 1, data: this.data, rev: this.revision, dirty: [...this.dirty], answered: this.answered });
  }

  openScope(scope: string) {
    if (this.opened && scope === this.scopeName) return;
    if (this.opened) this.flush();
    this.opened = true;
    this.scopeName = scope;
    const saved = this.read(scope);
    this.answered = scope === GUEST || saved?.answered === true;
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
      }
    }
    return data;
  }

  forget(scope: string) {
    if (scope === this.scopeName) {
      this.data = emptyData();
      this.revision = 0;
      this.dirty = new Set();
      this.answered = scope === GUEST;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.snapshot = undefined;
    }
    try {
      this.storage?.removeItem(KEY_PREFIX + scope);
    } catch {
    }
  }

  adoptGuest(): boolean {
    if (this.scopeName === GUEST) return false;
    const guest = this.read(GUEST);
    if (!guest || guest.data.progress.length + guest.data.watched.length + guest.data.list.length + guest.data.listNames.length + guest.data.ratings.length === 0) return false;
    this.data = mergeData(this.data, { ...guest.data, settings: [] }, this.now());
    this.markAllDirty();
    this.write(GUEST, { v: 1, data: { ...emptyData(), settings: guest.data.settings }, rev: 0, dirty: [] });
    this.changed();
    return true;
  }

  private put<T extends SyncItem>(name: keyof ProfileData, item: T) {
    const before = (this.data[name] as SyncItem[]).find((other) => other.key === item.key);
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

  playbackStarted(media: NormalizedMedia) {
    const key = progressKeyOf(media);
    const card = key ? progressFor(media, this.now(), undefined, this.find<LiveProgress>("progress", key)) : undefined;
    if (card) this.put("progress", card);
  }

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

  removeProgress(key: string) {
    this.put("progress", { key, at: this.now(), deleted: true });
  }

  removeFromList(url: string, list: string = DEFAULT_LIST) {
    const key = listKey(url, list);
    const at = this.now();
    const keys = new Set([key, ...live(this.data.list).filter((item) => listOf(item) === list && listKey(item.url, list) === key).map((item) => item.key)]);
    for (const each of keys) this.put("list", { key: each, at, deleted: true });
  }

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

  createList(name: string): string | undefined {
    const named = ListNameSchema.safeParse(name);
    if (!named.success || resolveLists(this.data.listNames).length >= MAX_LISTS) return undefined;
    const key = newListId(this.now());
    this.put("listNames", { key, at: this.now(), name: named.data });
    return key;
  }

  renameList(id: string, name: string) {
    const named = ListNameSchema.safeParse(name);
    if (!named.success || !resolveLists(this.data.listNames).some((list) => list.id === id)) return;
    const { order } = this.find<LiveListName>("listNames", id) ?? {};
    this.put("listNames", { key: id, at: this.now(), name: named.data, ...(order === undefined ? {} : { order }) });
  }

  moveList(id: string, by: -1 | 1) {
    const ids = resolveLists(this.data.listNames)
      .map((list) => list.id)
      .filter((other) => other !== DEFAULT_LIST);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    const at = this.now();
    ids.forEach((key, order) => {
      const named = this.find<LiveListName>("listNames", key);
      if (named && named.order !== order) this.put("listNames", { ...named, at, order });
    });
  }

  deleteList(id: string) {
    if (id === DEFAULT_LIST) return;
    const at = this.now();
    for (const item of live(this.data.list)) if (listOf(item) === id) this.put("list", { key: item.key, at, deleted: true });
    this.put("listNames", { key: id, at, deleted: true });
  }

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
    const section = title.section ?? before?.section;
    this.put("ratings", {
      key,
      at,
      title: title.title.slice(0, 300),
      url,
      ...(image ? { image } : {}),
      ...(backdrop ? { backdrop } : {}),
      ...(year ? { year } : {}),
      ...(kind ? { kind } : {}),
      ...(section ? { section } : {}),
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

  removeRating(url: string, season?: number) {
    this.put("ratings", { key: ratingKey(url, season), at: this.now(), deleted: true });
  }

  setSetting<K extends SettingKey>(key: K, value: Settings[K] | undefined) {
    const at = this.now();
    this.put("settings", (value === undefined ? { key, at, deleted: true } : { key, at, value }) as SettingItem);
  }

  setSaved(key: string, text: string | undefined) {
    if (key.length > 400 || (text !== undefined && (text.length === 0 || text.length > 400))) return;
    const at = this.now();
    this.put("saved", text === undefined ? { key, at, deleted: true } : ({ key, at, text } satisfies LiveSaved));
  }

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

  accept(response: SyncResponse, sent: ReadonlyMap<string, number>): void {
    const incoming: ProfileData = {
      progress: response.progress,
      watched: response.watched,
      list: response.list,
      listNames: response.listNames,
      ratings: response.ratings,
      settings: response.settings,
      saved: response.saved,
    };
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
            saved: without("saved", this.data.saved),
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
    if (response.reset) this.markAllDirty();
    const first = !this.answered;
    this.answered = true;
    this.changed(different || first);
  }
}
