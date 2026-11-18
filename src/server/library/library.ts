import { CLOSEST_MAX, guessesFor, normalizeQuery, rankByQuery, spelledOut, TitleIndex, titleLink, withoutNoise, type EpisodeDetail, type Library, type LibraryItem, type LibraryRow, type LibrarySection, type TitleAbout } from "../../shared";

export interface LibrarySource {
  id: string;
  name: string;
  load(): Promise<LibraryRow[]>;
  search?(query: string): Promise<LibraryItem[]>;
  similar?(link: string): Promise<LibraryItem[]>;
  about?(link: string): Promise<TitleAbout | null>;
  title?(id: string): Promise<LibraryItem | null>;
  episodes?(link: string, season: number): Promise<EpisodeDetail[]>;
  seasons?(link: string): Promise<number[]>;
  shelves?(section: LibrarySection | undefined, cursor: number): Promise<{ rows: LibraryRow[]; next: number | null }>;
  more?(rowId: string, page: number): Promise<{ items: LibraryItem[]; last: boolean }>;
}

export type PlayOutcome = "found" | "none" | "failed";

export interface SearchAnswer {
  items: LibraryItem[];
  exact: number;
}

export interface LibraryService {
  get(): Promise<Library>;
  search(query: string): Promise<SearchAnswer>;
  rows(section: LibrarySection | undefined, cursor: number): Promise<{ rows: LibraryRow[]; next: number | null }>;
  more(rowId: string, page: number): Promise<{ items: LibraryItem[]; last: boolean }>;
  similar(link: string): Promise<LibraryItem[]>;
  about(link: string): Promise<TitleAbout | null>;
  title(id: string): Promise<LibraryItem | null>;
  known(id: string): LibraryItem | undefined;
  episodes(link: string, season: number): Promise<EpisodeDetail[]>;
  seasons(link: string): Promise<number[]>;
  played(link: string, outcome: PlayOutcome): void;
}

export interface LibraryOptions {
  sources: LibrarySource[];
  ttlMs?: number;
  retryMs?: number;
  noVideoMs?: number;
  now?: () => number;
  log?: { warn: (details: object, message: string) => void };
}

export const LIBRARY_TTL_MS = 6 * 60 * 60 * 1000;
export const LIBRARY_RETRY_MS = 2 * 60 * 1000;
const ANSWERS_REMEMBERED = 200;
const LIKES_REMEMBERED = 2000;
const ENOUGH_ANSWERS = 3;
const WANTED_ANSWERS = 6;
const MAX_ANSWERS = 120;
const PAGES_REMEMBERED = 600;
const MAX_QUERY_LENGTH = 100;
const STRIKES_TO_HIDE = 2;
export const STRIKE_GAP_MS = 2 * 60 * 1000;
const FAILURES_REMEMBERED = 500;

interface Entry {
  source: LibrarySource;
  rows: LibraryRow[];
  collectedAt: number;
  nextAttempt: number;
  inflight: Promise<void> | null;
}

export function createLibrary(options: LibraryOptions): LibraryService {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? LIBRARY_TTL_MS;
  const retryMs = options.retryMs ?? LIBRARY_RETRY_MS;
  const noVideoMs = options.noVideoMs ?? ttlMs;
  const entries: Entry[] = options.sources.map((source) => ({ source, rows: [], collectedAt: 0, nextAttempt: 0, inflight: null }));

  const failures = new Map<string, { strikes: number; at: number; hard: boolean }>();
  const listed = (item: LibraryItem, asked = false): boolean => {
    const failure = failures.get(item.url);
    if (!failure) return true;
    if (now() - failure.at >= noVideoMs) {
      failures.delete(item.url);
      return true;
    }
    return failure.strikes < STRIKES_TO_HIDE || (asked && !failure.hard);
  };
  const canonicalItemKey = (item: LibraryItem): string => {
    const idMatch = /(?:tmdb|filmpire)-(movie|tv|series)-(\d+)/i.exec(item.id);
    if (idMatch?.[1] && idMatch[2]) {
      const kind = idMatch[1].toLowerCase() === "movie" ? "movie" : "series";
      return `tmdb:${kind}:${idMatch[2]}`;
    }
    const urlMatch = /\/watch\/(\d+)/.exec(item.url);
    if (urlMatch?.[1]) {
      const kind = item.kind ?? "media";
      return `tmdb:${kind}:${urlMatch[1]}`;
    }
    const imdbMatch = /(tt\d{7,10})/i.exec(item.id) || /(tt\d{7,10})/i.exec(item.url);
    if (imdbMatch?.[1]) {
      return `imdb:${imdbMatch[1].toLowerCase()}`;
    }
    const normTitle = normalizeQuery(item.title);
    return `meta:${item.kind ?? ""}:${normTitle}:${item.year ?? ""}`;
  };

  const listedRows = (rows: LibraryRow[]): LibraryRow[] =>
    rows.flatMap((row) => {
      const rowSeen = new Set<string>();
      const rowTitles = new Map<string, Array<{ year?: number }>>();
      const items = row.items.filter((item) => {
        if (!listed(item) || (item.image !== undefined && item.image.trim() === "")) return false;
        const key = canonicalItemKey(item);
        if (rowSeen.has(key)) return false;
        const titleKey = `${item.kind ?? ""}:${normalizeQuery(item.title)}`;
        const matches = rowTitles.get(titleKey);
        if (matches) {
          const isDuplicate = matches.some(
            (existing) => existing.year === undefined || item.year === undefined || existing.year === item.year
          );
          if (isDuplicate) return false;
          matches.push({ year: item.year });
        } else {
          rowTitles.set(titleKey, [{ year: item.year }]);
        }
        rowSeen.add(key);
        return true;
      });
      return items.length === row.items.length ? [row] : items.length > 0 ? [{ ...row, items }] : [];
    });

  const answers = <T>(remembered = ANSWERS_REMEMBERED) => {
    const known = new Map<string, { at: number; items: T[] }>();
    const asking = new Map<string, Promise<T[]>>();
    const find = async (key: string, ask: (source: LibrarySource) => Promise<T[]> | undefined): Promise<T[]> => {
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
      if (known.size > remembered) known.delete(known.keys().next().value!);
      return items;
    };
    return async (key: string, ask: (source: LibrarySource) => Promise<T[]> | undefined): Promise<T[]> => {
      const before = known.get(key);
      if (before && now() - before.at < ttlMs) return before.items;
      const going = asking.get(key);
      if (going) return going;
      const mine = find(key, ask).finally(() => asking.delete(key));
      asking.set(key, mine);
      return mine;
    };
  };
  const pool = new TitleIndex();
  const learn = (items: readonly LibraryItem[]) => pool.add(items);
  const lookedUp = new Map<string, LibraryItem>();
  const LOOKED_UP_KEPT = 2000;
  const pages = new Map<string, { at: number; value: unknown }>();
  const asking = new Map<string, Promise<unknown>>();
  const remember = <T>(key: string, ask: () => Promise<T>): Promise<T> => {
    const before = pages.get(key);
    if (before && now() - before.at < ttlMs) return Promise.resolve(before.value as T);
    let pending = asking.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = ask()
        .then((value) => {
          pages.delete(key);
          pages.set(key, { at: now(), value });
          if (pages.size > PAGES_REMEMBERED) pages.delete(pages.keys().next().value!);
          return value;
        })
        .finally(() => asking.delete(key));
      asking.set(key, pending);
    }
    return pending;
  };
  const similarTo = answers<LibraryItem>(LIKES_REMEMBERED);
  const aboutTitle = answers<TitleAbout>();
  const titleById = answers<LibraryItem>();
  const episodesOf = answers<EpisodeDetail>();
  const seasonsOf = answers<number>();

  const collect = (entry: Entry): Promise<void> => {
    entry.inflight ??= entry.source
      .load()
      .then((rows) => {
        entry.rows = rows.filter((row) => row.items.length > 0);
        learn(entry.rows.flatMap((row) => row.items));
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
        if (entry.rows.length === 0) waiting.push(attempt);
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
      if (!normalizeQuery(text)) return { items: [], exact: 0 };
      const quiet = withoutNoise(text);
      const noisy = quiet !== normalizeQuery(text);

      const seen = new Set<string>();
      const seenTitles = new Map<string, Array<{ year?: number }>>();
      const exact: LibraryItem[] = [];
      const closest: LibraryItem[] = [];
      const take = (items: LibraryItem[], into = exact) => {
        for (const item of items) {
          const key = canonicalItemKey(item);
          if (seen.has(key) || !listed(item, true) || (item.image !== undefined && item.image.trim() === "")) continue;
          const titleKey = `${item.kind ?? ""}:${normalizeQuery(item.title)}`;
          const matches = seenTitles.get(titleKey);
          if (matches) {
            const isDuplicate = matches.some(
              (existing) => existing.year === undefined || item.year === undefined || existing.year === item.year
            );
            if (isDuplicate) continue;
            matches.push({ year: item.year });
          } else {
            seenTitles.set(titleKey, [{ year: item.year }]);
          }
          seen.add(key);
          into.push(item);
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

      take(pool.find(text));
      const answered = (await Promise.all(noisy ? [ask(text), ask(quiet)] : [ask(text)])).flat();
      learn(answered);
      take(answered);
      if (noisy) take(pool.find(quiet));
      const rank = noisy && pool.find(text).length === 0 ? quiet : text;

      if (exact.length < ENOUGH_ANSWERS) {
        learn((await Promise.all(guessesFor(quiet).map(ask))).flat());
        take(pool.find(quiet));
      }
      if (exact.length < WANTED_ANSWERS) take(pool.find(quiet, "relaxed"));
      if (exact.length < WANTED_ANSWERS) take(pool.find(quiet, "loose"), closest);

      const ranked = rankByQuery(exact, rank);
      return { items: [...ranked, ...rankByQuery(closest, rank).slice(0, CLOSEST_MAX)].slice(0, MAX_ANSWERS), exact: Math.min(ranked.length, MAX_ANSWERS) };
    },
    async rows(section: LibrarySection | undefined, cursor: number) {
      const asked = entries.filter(({ source }) => source.shelves);
      const answers = await Promise.all(asked.map(({ source }) => remember(`rows|${source.id}|${section ?? ""}|${cursor}`, () => source.shelves!(section, cursor)).catch(() => null)));
      const got = answers.filter((answer): answer is NonNullable<typeof answer> => answer !== null);
      if (asked.length > 0 && got.length === 0) throw new Error("no place could be reached");
      learn(got.flatMap((answer) => answer.rows.flatMap((row) => row.items)));
      const nexts = got.flatMap((answer) => (answer.next === null ? [] : [answer.next]));
      return { rows: listedRows(got.flatMap((answer) => answer.rows)), next: nexts.length > 0 ? Math.max(...nexts) : null };
    },
    async more(rowId: string, page: number) {
      const answer = await remember(`more|${rowId}|${page}`, async () => {
        let asked = 0;
        let failed = 0;
        for (const { source } of entries) {
          if (!source.more) continue;
          asked++;
          try {
            const got = await source.more(rowId, page);
            if (got.items.length > 0 || !got.last) return got;
          } catch {
            failed++;
          }
        }
        if (asked > 0 && failed === asked) throw new Error("no place could be reached");
        return { items: [] as LibraryItem[], last: true };
      });
      learn(answer.items);
      return { items: answer.items.filter((item) => listed(item)), last: answer.last };
    },
    similar: async (link: string) => {
      const found = await similarTo(link, (source) => source.similar?.(link));
      learn(found);
      return found.filter((item) => listed(item));
    },
    about: async (link: string) => {
      const [found] = await aboutTitle(titleLink(link), async (source) => {
        const about = await source.about?.(link);
        return about ? [about] : [];
      });
      if (!found) return null;
      learn([...found.parts, ...found.similar]);
      return { ...found, parts: found.parts.filter((item) => listed(item)), similar: found.similar.filter((item) => listed(item)) };
    },
    title: async (id: string) => {
      const known = pool.get(id);
      const [found] = known ? [known] : await titleById(id, async (source) => {
        const item = await source.title?.(id);
        return item ? [item] : [];
      });
      if (!found) return null;
      if (!known) {
        lookedUp.delete(id);
        lookedUp.set(id, found);
        if (lookedUp.size > LOOKED_UP_KEPT) lookedUp.delete(lookedUp.keys().next().value!);
      }
      return listed(found) ? found : null;
    },
    known: (id: string) => pool.get(id) ?? lookedUp.get(id),
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
      const next =
        outcome === "none"
          ? { strikes: STRIKES_TO_HIDE, at: now(), hard: true }
          : kept && (kept.hard || now() - kept.at < STRIKE_GAP_MS)
            ? kept
            : { strikes: (kept?.strikes ?? 0) + 1, at: now(), hard: false };
      failures.delete(link);
      failures.set(link, next);
      if (failures.size > FAILURES_REMEMBERED) failures.delete(failures.keys().next().value!);
    },
  };
}
