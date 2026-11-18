import { useSyncExternalStore } from "react";
import { itemsOf, LibraryMoreSchema, LibraryRowsSchema, TitleIndex, type LibraryItem, type LibraryRow, type LibrarySection } from "../../shared";
import { spreadOf } from "./spread";

export const ROW_CAP = 100;
export const GRID_CAP = 300;
const NEAR_BOTTOM = 1.5;
export const nearBottom = (box: HTMLElement | null): boolean => box !== null && box.clientHeight > 0 && box.scrollHeight - box.clientHeight - box.scrollTop <= box.clientHeight * NEAR_BOTTOM;
export const SHELF_CAP = 60;
export const MIN_SHELF = 8;
const LAST_PAGE = 100;
const RETRY_MS = 4000;
const RETRY_MAX_MS = 30_000;

export type ShelfKey = "all" | LibrarySection;
export const shelfKey = (section: LibrarySection | undefined): ShelfKey => section ?? "all";

export interface FeedData {
  base: readonly LibraryRow[];
  shelves: Readonly<Record<ShelfKey, { rows: readonly LibraryRow[]; cursor: number | null }>>;
  more: Readonly<Record<string, { items: readonly LibraryItem[]; next: number; last: boolean }>>;
}

export interface FeedStatus {
  busy: Readonly<Record<string, true>>;
  failed: Readonly<Record<string, true>>;
}

export interface FeedSnapshot {
  data: FeedData;
  status: FeedStatus;
}

const shelvesId = (key: ShelfKey) => `shelves:${key}`;
const moreId = (rowId: string) => `more:${rowId}`;

const nothingYet = () => ({ rows: [], cursor: 0 });
const emptyData = (): FeedData => ({
  base: [],
  shelves: { all: nothingYet(), movie: nothingYet(), series: nothingYet(), cartoon: nothingYet(), anime: nothingYet() },
  more: {},
});

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = record;
  return rest;
};

function onceEach(items: readonly LibraryItem[], cap: number, seen = new Set<string>()): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const item of items) {
    if (out.length >= cap) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

const merged = new WeakMap<LibraryRow, { more: readonly LibraryItem[]; cap: number; row: LibraryRow }>();

export function withMore(row: LibraryRow, more: readonly LibraryItem[] | undefined, cap: number): LibraryRow {
  if (!more || more.length === 0) return row.items.length <= cap ? row : { ...row, items: row.items.slice(0, cap) };
  const before = merged.get(row);
  if (before && before.more === more && before.cap === cap) return before.row;
  const next = { ...row, items: onceEach([...row.items, ...more], cap) };
  merged.set(row, { more, cap, row: next });
  return next;
}

export function freshShelves(shown: readonly LibraryRow[], shelves: readonly LibraryRow[], min = MIN_SHELF): LibraryRow[] {
  const seen = new Set(shown.flatMap((row) => row.items.map((item) => item.id)));
  const out: LibraryRow[] = [];
  for (const shelf of shelves) {
    const fresh = shelf.items.filter((item) => !seen.has(item.id));
    if (fresh.length < min) continue;
    for (const item of fresh) seen.add(item.id);
    out.push(fresh.length === shelf.items.length ? shelf : { ...shelf, items: fresh });
  }
  return out;
}

export function pageRows(data: FeedData, section: LibrarySection | undefined, cap = ROW_CAP): LibraryRow[] {
  const base = spreadOf(data.base).filter((row) => row.items.length > 0);
  const shelves = freshShelves(base, data.shelves[shelfKey(section)].rows);
  return [...base, ...shelves].map((row) => withMore(row, data.more[row.id]?.items, cap));
}

const shelvesOf = (data: FeedData): LibraryRow[] => Object.values(data.shelves).flatMap((shelf) => shelf.rows);

export function allRows(data: FeedData, cap = GRID_CAP): LibraryRow[] {
  const seen = new Set<string>();
  return [...data.base, ...shelvesOf(data)].filter((row) => row.items.length > 0 && !seen.has(row.id) && seen.add(row.id)).map((row) => withMore(row, data.more[row.id]?.items, cap));
}

const rowById = (data: FeedData, id: string): LibraryRow | undefined => data.base.find((row) => row.id === id) ?? shelvesOf(data).find((row) => row.id === id);

export interface FeedOptions {
  fetch?: typeof fetch;
  retryMs?: number;
}

export interface Feed {
  getSnapshot(): FeedSnapshot;
  subscribe(listener: () => void): () => void;
  readonly index: TitleIndex;
  setBase(rows: readonly LibraryRow[]): void;
  learn(items: readonly LibraryItem[]): void;
  forget?(id: string): void;
  prune?(predicate: (item: LibraryItem) => boolean): void;
  loadShelves(section?: LibrarySection): void;
  loadMore(rowId: string, cap?: number): void;
  reset(): void;
}

export function createFeed(options: FeedOptions = {}): Feed {
  const ask = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const retryMs = options.retryMs ?? RETRY_MS;
  const listeners = new Set<() => void>();
  let index = new TitleIndex();
  let snapshot: FeedSnapshot = { data: emptyData(), status: { busy: {}, failed: {} } };
  const failures = new Map<string, number>();
  let epoch = 0;

  const update = (change: { id?: string; busy?: boolean; failed?: boolean; data?: (data: FeedData) => FeedData }) => {
    const { busy, failed } = snapshot.status;
    const { id } = change;
    snapshot = {
      data: change.data ? change.data(snapshot.data) : snapshot.data,
      status:
        id === undefined
          ? snapshot.status
          : {
              busy: change.busy === undefined ? busy : change.busy ? { ...busy, [id]: true as const } : without(busy, id),
              failed: change.failed === undefined ? failed : change.failed ? { ...failed, [id]: true as const } : without(failed, id),
            },
    };
    for (const listener of [...listeners]) listener();
  };

  const run = <T>(id: string, url: string, parse: (body: unknown) => T, keep: (answer: T) => (data: FeedData) => FeedData) => {
    const mine = epoch;
    update({ id, busy: true });
    Promise.resolve()
      .then(() => ask(url))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => parse(body))
      .then((answer) => {
        if (mine !== epoch) return;
        failures.delete(id);
        update({ id, busy: false, failed: false, data: keep(answer) });
      })
      .catch(() => {
        if (mine !== epoch) return;
        const times = (failures.get(id) ?? 0) + 1;
        failures.set(id, times);
        update({ id, busy: false, failed: true });
        const timer = setTimeout(() => {
          if (mine === epoch) update({ id, failed: false });
        }, Math.min(RETRY_MAX_MS, retryMs * 2 ** (times - 1)));
        (timer as { unref?: () => void }).unref?.();
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get index() {
      return index;
    },
    setBase(rows) {
      if (rows === snapshot.data.base) return;
      index = new TitleIndex(itemsOf(rows));
      update({ data: (data) => ({ ...data, base: rows }) });
    },
    learn(items) {
      index.add(items);
    },
    forget(id) {
      index.remove(id);
    },
    prune(predicate) {
      index.discardWhere(predicate);
    },
    loadShelves(section) {
      const key = shelfKey(section);
      const id = shelvesId(key);
      const shelf = snapshot.data.shelves[key];
      if (shelf.cursor === null || shelf.rows.length >= SHELF_CAP || snapshot.status.busy[id] || snapshot.status.failed[id]) return;
      run(
        id,
        `/api/library/rows?cursor=${shelf.cursor}${section ? `&section=${section}` : ""}`,
        (body) => LibraryRowsSchema.parse(body),
        (answer) => {
          index.add(answer.rows.flatMap((row) => row.items));
          return (data) => {
            const known = new Set([...data.base, ...data.shelves[key].rows].map((row) => row.id));
            const rows = [...data.shelves[key].rows, ...answer.rows.filter((row) => row.items.length > 0 && !known.has(row.id))];
            return { ...data, shelves: { ...data.shelves, [key]: { rows, cursor: answer.next } } };
          };
        },
      );
    },
    loadMore(rowId, cap = ROW_CAP) {
      const id = moreId(rowId);
      const row = rowById(snapshot.data, rowId);
      const have = snapshot.data.more[rowId] ?? { items: [], next: 2, last: false };
      if (!row || have.last || row.items.length + have.items.length >= cap || snapshot.status.busy[id] || snapshot.status.failed[id]) return;
      run(
        id,
        `/api/library/more?row=${encodeURIComponent(rowId)}&page=${have.next}`,
        (body) => LibraryMoreSchema.parse(body),
        (answer) => {
          index.add(answer.items);
          return (data) => {
            const now = data.more[rowId] ?? have;
            const seen = new Set([...row.items, ...now.items].map((item) => item.id));
            const items = [...now.items, ...answer.items.filter((item) => !seen.has(item.id) && seen.add(item.id))];
            const next = now.next + 1;
            return { ...data, more: { ...data.more, [rowId]: { items, next, last: answer.last || next > LAST_PAGE } } };
          };
        },
      );
    },
    reset() {
      epoch++;
      failures.clear();
      index = new TitleIndex();
      snapshot = { data: emptyData(), status: { busy: {}, failed: {} } };
      for (const listener of [...listeners]) listener();
    },
  };
}

export const feed: Feed = createFeed();

export function useFeed(store: Feed = feed): FeedSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export const hasMoreShelves = (snap: FeedSnapshot, section: LibrarySection | undefined): boolean => {
  const shelf = snap.data.shelves[shelfKey(section)];
  return shelf.cursor !== null && shelf.rows.length < SHELF_CAP;
};

export const loadingShelves = (snap: FeedSnapshot, section: LibrarySection | undefined): boolean => Boolean(snap.status.busy[shelvesId(shelfKey(section))]);

export const failedShelves = (snap: FeedSnapshot, section: LibrarySection | undefined): boolean => Boolean(snap.status.failed[shelvesId(shelfKey(section))]);

export const hasMoreTitles = (snap: FeedSnapshot, rowId: string, shown: number, cap = ROW_CAP): boolean => {
  const more = snap.data.more[rowId];
  return !(more?.last) && shown < cap;
};

export const loadingTitles = (snap: FeedSnapshot, rowId: string): boolean => Boolean(snap.status.busy[moreId(rowId)]);

export const failedTitles = (snap: FeedSnapshot, rowId: string): boolean => Boolean(snap.status.failed[moreId(rowId)]);
