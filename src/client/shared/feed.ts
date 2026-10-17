import { useSyncExternalStore } from "react";
import { itemsOf, LibraryMoreSchema, LibraryRowsSchema, TitleIndex, type LibraryItem, type LibraryKind, type LibraryRow } from "../../shared";

/**
 * The library as it grows while a page is scrolled: the rows the server lists first (`base`), the rows it brings after them a few at a
 * time (`shelves`, one run for each of Home, Movies and Series), and the further pages of any row (`more`). The TV and the phone read the
 * same store, so what was scrolled to is still there when a film is closed. Every title it receives goes into one index, which the
 * screens search before the server is asked.
 */

/** A row grows to this many titles as it is scrolled sideways, and a category's page to the second as it is scrolled down. */
export const ROW_CAP = 100;
export const GRID_CAP = 300;
/** No more than this many rows are brought below the first ones. */
export const SHELF_CAP = 60;
/** A row brought below the first ones is left out when fewer than this many of its titles are not already shown above it. */
export const MIN_SHELF = 8;
/** The server has no page past this one. */
const LAST_PAGE = 100;
/** A question that failed is asked again after this long, and after twice that, and so on up to `RETRY_MAX_MS`. */
const RETRY_MS = 4000;
const RETRY_MAX_MS = 30_000;

/** Home asks for rows of both kinds; Movies and Series for their own. */
export type ShelfKey = "all" | LibraryKind;
export const shelfKey = (kind: LibraryKind | undefined): ShelfKey => kind ?? "all";

/** What has been received (its identity changes only when something arrives, so a screen that works out rows from it does so when there is news). */
export interface FeedData {
  base: readonly LibraryRow[];
  /** The rows brought after the first ones, and where to ask for the next: the first (0), or none (null: that was the last). */
  shelves: Readonly<Record<ShelfKey, { rows: readonly LibraryRow[]; cursor: number | null }>>;
  /** More titles of a row, from page 2: the next page to ask for, and whether there are no more. */
  more: Readonly<Record<string, { items: readonly LibraryItem[]; next: number; last: boolean }>>;
}

/** What is being asked or could not be: "shelves:all" for the next rows of Home, "more:<row id>" for the next titles of a row. */
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

const emptyData = (): FeedData => ({
  base: [],
  shelves: { all: { rows: [], cursor: 0 }, movie: { rows: [], cursor: 0 }, series: { rows: [], cursor: 0 } },
  more: {},
});

/* ------------------------------ what the pages show ------------------------------ */

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = record;
  return rest;
};

/** Titles of one row, once each, up to `cap`. */
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

/** The rows as they were last merged, so a row nothing was added to is the very same object (and a screen has nothing to draw again for it). */
const merged = new WeakMap<LibraryRow, { more: readonly LibraryItem[]; cap: number; row: LibraryRow }>();

/** A row with the further pages of it that have been received after its own titles (each title once), up to `cap` titles. */
export function withMore(row: LibraryRow, more: readonly LibraryItem[] | undefined, cap: number): LibraryRow {
  if (!more || more.length === 0) return row.items.length <= cap ? row : { ...row, items: row.items.slice(0, cap) };
  const before = merged.get(row);
  if (before && before.more === more && before.cap === cap) return before.row;
  const next = { ...row, items: onceEach([...row.items, ...more], cap) };
  merged.set(row, { more, cap, row: next });
  return next;
}

/**
 * The rows brought after the first ones, without the titles already shown above them (a title is on a page once), and without a row
 * that has fewer than `min` titles left. Only the first page of each is looked at, so a page scrolled further along never takes a title
 * out of the rows below it.
 */
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

/** The rows of Home, Movies or Series: the first ones, then the ones brought after them. */
export function pageRows(data: FeedData, kind: LibraryKind | undefined, cap = ROW_CAP): LibraryRow[] {
  const base = data.base.filter((row) => row.items.length > 0);
  const shelves = freshShelves(base, data.shelves[shelfKey(kind)].rows);
  return [...base, ...shelves].map((row) => withMore(row, data.more[row.id]?.items, cap));
}

/** Every row there is, each once: for the pages of the categories, which open any of them whole. */
export function allRows(data: FeedData, cap = GRID_CAP): LibraryRow[] {
  const seen = new Set<string>();
  return [...data.base, ...data.shelves.all.rows, ...data.shelves.movie.rows, ...data.shelves.series.rows]
    .filter((row) => row.items.length > 0 && !seen.has(row.id) && seen.add(row.id))
    .map((row) => withMore(row, data.more[row.id]?.items, cap));
}

const rowById = (data: FeedData, id: string): LibraryRow | undefined =>
  data.base.find((row) => row.id === id) ?? [data.shelves.all, data.shelves.movie, data.shelves.series].flatMap((shelf) => shelf.rows).find((row) => row.id === id);

/* ------------------------------ the store ------------------------------ */

export interface FeedOptions {
  fetch?: typeof fetch;
  /** How long before the first failed question is asked again. */
  retryMs?: number;
}

/** What the screens ask of the store. `createFeed` makes one of their own for a test; the app has the one below. */
export interface Feed {
  getSnapshot(): FeedSnapshot;
  subscribe(listener: () => void): () => void;
  /** Every title received so far, to search before the server is asked. */
  readonly index: TitleIndex;
  /** The rows the server listed (again): their titles are searched too. */
  setBase(rows: readonly LibraryRow[]): void;
  /** Titles from anywhere else (like the ones a title is "like"), to be found by the search. */
  learn(items: readonly LibraryItem[]): void;
  /** Ask for the next rows of Home (no kind), Movies or Series, if there are any and none are being asked for. */
  loadShelves(kind?: LibraryKind): void;
  /** Ask for the next page of a row, if there is one and the row has fewer than `cap` titles. */
  loadMore(rowId: string, cap?: number): void;
  /** Forget everything (for a test). */
  reset(): void;
}

export function createFeed(options: FeedOptions = {}): Feed {
  const ask = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const retryMs = options.retryMs ?? RETRY_MS;
  const listeners = new Set<() => void>();
  let index = new TitleIndex();
  let snapshot: FeedSnapshot = { data: emptyData(), status: { busy: {}, failed: {} } };
  /** How many questions in a row failed, by what was asked: the wait grows with it. */
  const failures = new Map<string, number>();
  /** A new store is made on a reset, so what an answer that was still on its way brings is left out: it is told by this. */
  let epoch = 0;

  /** One change, one announcement: what came and the marks that go with it reach a screen together, so it draws once. */
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

  /** One question and what comes of it. A failure marks it failed and lets it be asked again after a wait. */
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
      index.add(itemsOf(rows));
      update({ data: (data) => ({ ...data, base: rows }) });
    },
    learn(items) {
      index.add(items);
    },
    loadShelves(kind) {
      const key = shelfKey(kind);
      const id = shelvesId(key);
      const shelf = snapshot.data.shelves[key];
      if (shelf.cursor === null || shelf.rows.length >= SHELF_CAP || snapshot.status.busy[id] || snapshot.status.failed[id]) return;
      run(
        id,
        `/api/library/rows?cursor=${shelf.cursor}${kind ? `&kind=${kind}` : ""}`,
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

/** The library the TV and the phone share. */
export const feed: Feed = createFeed();

/** The store as a screen reads it: it draws again when something arrives or a question starts or fails. */
export function useFeed(store: Feed = feed): FeedSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Whether the next rows of Home, Movies or Series can still be asked for (none have been asked for, or the last answer said there are more). */
export const hasMoreShelves = (snap: FeedSnapshot, kind: LibraryKind | undefined): boolean => {
  const shelf = snap.data.shelves[shelfKey(kind)];
  return shelf.cursor !== null && shelf.rows.length < SHELF_CAP;
};

/** Whether the next rows are being asked for (a screen shows a row of empty tiles in their place). */
export const loadingShelves = (snap: FeedSnapshot, kind: LibraryKind | undefined): boolean => Boolean(snap.status.busy[shelvesId(shelfKey(kind))]);

/** Whether a row can have more titles than it shows: it is not known to have none (a row of a place that has no further pages finds out when it is asked). */
export const hasMoreTitles = (snap: FeedSnapshot, rowId: string, shown: number, cap = ROW_CAP): boolean => {
  const more = snap.data.more[rowId];
  return !(more?.last) && shown < cap;
};

/** Whether the next titles of a row are being asked for. */
export const loadingTitles = (snap: FeedSnapshot, rowId: string): boolean => Boolean(snap.status.busy[moreId(rowId)]);
