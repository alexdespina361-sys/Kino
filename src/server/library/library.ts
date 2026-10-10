import type { Library, LibraryItem, LibraryRow } from "../../shared";

/** A place that offers video openly and can list some of it as rows of titles. Each one is asked as seldom as the cache allows. */
export interface LibrarySource {
  id: string;
  name: string;
  /** Collect the rows. Throws when the place cannot be reached. */
  load(): Promise<LibraryRow[]>;
  search?(query: string): Promise<LibraryItem[]>;
}

export interface LibraryService {
  get(): Promise<Library>;
  search(query: string): Promise<LibraryItem[]>;
}

export interface LibraryOptions {
  sources: LibrarySource[];
  /** How long what was collected stays good. */
  ttlMs?: number;
  /** After a failed attempt, how long before the place is asked again. */
  retryMs?: number;
  now?: () => number;
  log?: { warn: (details: object, message: string) => void };
}

export const LIBRARY_TTL_MS = 6 * 60 * 60 * 1000;
export const LIBRARY_RETRY_MS = 2 * 60 * 1000;

interface Entry {
  source: LibrarySource;
  rows: LibraryRow[];
  collectedAt: number;
  /** Not asked again before this. */
  nextAttempt: number;
  inflight: Promise<void> | null;
}

/**
 * Remembers what each source listed. Once something is remembered a request never waits for the place: an old list is
 * served at once while a fresh one is collected, and a place that is down leaves its last list in view. Requests that
 * arrive while a place is being asked share that one question.
 */
export function createLibrary(options: LibraryOptions): LibraryService {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? LIBRARY_TTL_MS;
  const retryMs = options.retryMs ?? LIBRARY_RETRY_MS;
  const entries: Entry[] = options.sources.map((source) => ({ source, rows: [], collectedAt: 0, nextAttempt: 0, inflight: null }));

  const collect = (entry: Entry): Promise<void> => {
    entry.inflight ??= entry.source
      .load()
      .then((rows) => {
        entry.rows = rows.filter((row) => row.items.length > 0);
        entry.collectedAt = now();
        entry.nextAttempt = entry.collectedAt + ttlMs;
      })
      .catch((error: unknown) => {
        options.log?.warn({ source: entry.source.id, error: String(error) }, "library source failed");
        entry.nextAttempt = now() + retryMs;
      })
      .finally(() => {
        entry.inflight = null;
      });
    return entry.inflight;
  };

  return {
    async get() {
      const waiting: Promise<void>[] = [];
      for (const entry of entries) {
        if (now() < entry.nextAttempt) continue;
        const attempt = collect(entry);
        if (entry.rows.length === 0) waiting.push(attempt); // nothing to show meanwhile
      }
      await Promise.all(waiting);
      const collected = entries.filter((entry) => entry.collectedAt > 0);
      return {
        rows: entries.flatMap((entry) => entry.rows),
        updatedAt: collected.length > 0 ? Math.min(...collected.map((entry) => entry.collectedAt)) : 0,
      };
    },
    async search(query: string) {
      const q = query.trim().toLowerCase();
      if (!q) return [];

      const seen = new Set<string>();
      const localMatches: LibraryItem[] = [];
      for (const entry of entries) {
        for (const row of entry.rows) {
          for (const item of row.items) {
            if (item.title.toLowerCase().includes(q)) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                localMatches.push(item);
              }
            }
          }
        }
      }

      const searchPromises = entries
        .filter((entry) => typeof entry.source.search === "function")
        .map(async (entry) => {
          try {
            return await entry.source.search!(query);
          } catch {
            return [];
          }
        });

      const remoteResults = (await Promise.all(searchPromises)).flat();
      for (const item of remoteResults) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          localMatches.push(item);
        }
      }

      return localMatches;
    },
  };
}
