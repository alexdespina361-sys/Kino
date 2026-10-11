import { guessesFor, itemsOf, normalizeQuery, searchItems, spelledOut, type EpisodeDetail, type Library, type LibraryItem, type LibraryRow } from "../../shared";

/** A place that offers video openly and can list some of it as rows of titles. Each one is asked as seldom as the cache allows. */
export interface LibrarySource {
  id: string;
  name: string;
  /** Collect the rows. Throws when the place cannot be reached. */
  load(): Promise<LibraryRow[]>;
  search?(query: string): Promise<LibraryItem[]>;
  /** Titles like the one a link plays, when the link is one of this place's own (anything else: none). */
  similar?(link: string): Promise<LibraryItem[]>;
  /** What is known about each episode of one season of the show a link plays, when the link is one of this place's own (anything else: none). */
  episodes?(link: string, season: number): Promise<EpisodeDetail[]>;
  /** The seasons that can be watched of the show a link plays, in order (none for a film or a link that is not this place's own). Throws when the place cannot be reached. */
  seasons?(link: string): Promise<number[]>;
}

/** How a try at playing a link went: it played, the place has no video of it, or the video could not be reached this time. */
export type PlayOutcome = "found" | "none" | "failed";

export interface LibraryService {
  get(): Promise<Library>;
  search(query: string): Promise<LibraryItem[]>;
  similar(link: string): Promise<LibraryItem[]>;
  episodes(link: string, season: number): Promise<EpisodeDetail[]>;
  seasons(link: string): Promise<number[]>;
  /**
   * Hears how a try at playing a link went. The places list far more than they can play, so a title whose video was not there
   * (or could not be reached on two separate tries) is left out of what the library lists for a while, and out of what it finds
   * too unless it was only out of reach; one that plays is back for good.
   */
  played(link: string, outcome: PlayOutcome): void;
}

export interface LibraryOptions {
  sources: LibrarySource[];
  /** How long what was collected stays good. */
  ttlMs?: number;
  /** After a failed attempt, how long before the place is asked again. */
  retryMs?: number;
  /** How long a title with no video to play stays out of the lists. */
  noVideoMs?: number;
  now?: () => number;
  log?: { warn: (details: object, message: string) => void };
}

export const LIBRARY_TTL_MS = 6 * 60 * 60 * 1000;
export const LIBRARY_RETRY_MS = 2 * 60 * 1000;
/** What is asked about a link ("titles like this one", "this show's episodes") is remembered for this many links, for as long as the library is. */
const ANSWERS_REMEMBERED = 200;
/** A search that found this many titles is not asked again in other words. */
const ENOUGH_ANSWERS = 3;
/** Of what is typed in a search, this much is looked for (a title's name is shorter). */
const MAX_QUERY_LENGTH = 100;
/** A link is left out of the lists at this many strikes: a place that has no video of it is two, a video that could not be reached just now is one. */
const STRIKES_TO_HIDE = 2;
/** A video that could not be reached counts as another strike only when the try comes this long after the one before: a bad moment fails every try at once. */
export const STRIKE_GAP_MS = 2 * 60 * 1000;
/** The links that failed to play are remembered for this many of them (a link that is not a title costs a place here too), the oldest going first. */
const FAILURES_REMEMBERED = 500;

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
  const noVideoMs = options.noVideoMs ?? ttlMs;
  const entries: Entry[] = options.sources.map((source) => ({ source, rows: [], collectedAt: 0, nextAttempt: 0, inflight: null }));

  /**
   * The links that failed to play, with their strikes and when the last one came: at two the title is left out of the lists until
   * `noVideoMs` has passed. `hard` is for a place that has no video of it at all, as against one that could not be reached.
   */
  const failures = new Map<string, { strikes: number; at: number; hard: boolean }>();
  /** Whether a title is offered. A search leaves out less: a title that was only out of reach is still found when it is asked for by name. */
  const listed = (item: LibraryItem, asked = false): boolean => {
    const failure = failures.get(item.url);
    if (!failure) return true;
    if (now() - failure.at >= noVideoMs) {
      failures.delete(item.url);
      return true;
    }
    return failure.strikes < STRIKES_TO_HIDE || (asked && !failure.hard);
  };
  /** The rows without the titles that are left out; a row left with nothing goes too. */
  const listedRows = (rows: LibraryRow[]): LibraryRow[] =>
    failures.size === 0
      ? rows
      : rows.flatMap((row) => {
          const items = row.items.filter((item) => listed(item));
          return items.length === row.items.length ? [row] : items.length > 0 ? [{ ...row, items }] : [];
        });

  /**
   * A question about a link, put to the places in turn: the first one that knows the link answers. An empty answer is
   * remembered too, so a link nobody knows is not asked about again and again (but not when a place could not be reached, which
   * is not an answer: it is asked again); when the memory is full the oldest goes.
   */
  const answers = <T>() => {
    const known = new Map<string, { at: number; items: T[] }>();
    return async (key: string, ask: (source: LibrarySource) => Promise<T[]> | undefined): Promise<T[]> => {
      const before = known.get(key);
      if (before && now() - before.at < ttlMs) return before.items;
      let items: T[] = [];
      let unreachable = false;
      for (const { source } of entries) {
        try {
          items = (await ask(source)) ?? [];
        } catch {
          items = [];
          unreachable = true;
        }
        if (items.length > 0) break;
      }
      if (items.length === 0 && unreachable) return items;
      known.delete(key);
      known.set(key, { at: now(), items });
      if (known.size > ANSWERS_REMEMBERED) known.delete(known.keys().next().value!);
      return items;
    };
  };
  const similarTo = answers<LibraryItem>();
  const episodesOf = answers<EpisodeDetail>();
  const seasonsOf = answers<number>();

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
        rows: listedRows(entries.flatMap((entry) => entry.rows)),
        updatedAt: collected.length > 0 ? Math.min(...collected.map((entry) => entry.collectedAt)) : 0,
      };
    },
    async search(query: string) {
      const text = spelledOut(query.slice(0, MAX_QUERY_LENGTH));
      if (!normalizeQuery(text)) return [];

      const seen = new Set<string>();
      const found: LibraryItem[] = [];
      const take = (items: LibraryItem[]) => {
        for (const item of items) {
          if (seen.has(item.id) || !listed(item, true)) continue;
          seen.add(item.id);
          found.push(item);
        }
      };
      const ask = async (words: string) => {
        const answers = entries.map(async ({ source }) => {
          try {
            return (await source.search?.(words)) ?? [];
          } catch {
            return [];
          }
        });
        return (await Promise.all(answers)).flat();
      };

      // What is listed here and matches, then what the places answer to it as typed.
      take(searchItems(itemsOf(entries.flatMap((entry) => entry.rows)), text));
      take(await ask(text));

      // A place does not forgive a slip ("strager things" finds nothing there): with little to show, ask it the words on their own, and
      // let the titles that come back be matched against what was typed.
      if (found.length < ENOUGH_ANSWERS) take(searchItems((await Promise.all(guessesFor(text).map(ask))).flat(), text));
      return found;
    },
    similar: async (link: string) => (await similarTo(link, (source) => source.similar?.(link))).filter((item) => listed(item)),
    episodes: (link: string, season: number) => episodesOf(`${season}|${link}`, (source) => source.episodes?.(link, season)),
    seasons: (link: string) => seasonsOf(link, (source) => source.seasons?.(link)),
    played(link: string, outcome: PlayOutcome) {
      if (outcome === "found") {
        failures.delete(link);
        return;
      }
      if (link.length > 2048) return;
      const before = failures.get(link);
      const kept = before && now() - before.at < noVideoMs ? before : undefined;
      // No video at the place is final; one that could not be reached counts only as a separate try (two at once are one bad moment).
      const next =
        outcome === "none"
          ? { strikes: STRIKES_TO_HIDE, at: now(), hard: true }
          : kept && (kept.hard || now() - kept.at < STRIKE_GAP_MS)
            ? kept
            : { strikes: (kept?.strikes ?? 0) + 1, at: now(), hard: false };
      failures.delete(link); // (set again below, so the map stays in the order the links last failed)
      failures.set(link, next);
      if (failures.size > FAILURES_REMEMBERED) failures.delete(failures.keys().next().value!);
    },
  };
}
