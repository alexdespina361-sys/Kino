import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LibraryItemsSchema, ratingsShown, titleLink, type LibraryItem, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { useProfileData } from "../account/store";
import { feed } from "./feed";
import { dislikedKeys, isKnown, knownOf, LOVED_FROM, MAX_ASKS, picksOf, savedSeeds, type Seed } from "./taste";

/**
 * Rows of "Because you watched ..." and "Because you loved ...": the titles the library says are like what a profile watched lately or
 * scored high. The library knows nothing of taste, only which titles are alike, so each row is the answer to one question: titles like this one.
 * And one row of what the profile might like, put together from more such answers (taste.ts): titles like several of the ones it watched, loved or
 * saved to watch, without anything it has seen, started, saved or scored.
 */

export { LOVED_FROM } from "./taste";
export type { Seed } from "./taste";
/** How many titles a page has a row of titles like. */
export const MAX_BECAUSE = 3;
/** A row after the first is worth showing with this many titles that are new to the page. */
export const MIN_NEXT = 4;

/** A row: the titles like `title`, none of them started or saved. */
export interface Because {
  key: string;
  title: string;
  why: "watched" | "loved";
  items: LibraryItem[];
}

/**
 * The titles to ask for titles like, the most recently watched first and then, in turn, one that was scored high and one that was watched: each
 * title once (a title that was watched and scored high is said to be loved). Scores count when they are for the whole title, not for a season; a
 * title that was watched and scored low is not asked about (more like it is not what its score says).
 */
export function seedsOf(progress: readonly LiveProgress[], ratings: readonly LiveRating[], max = MAX_BECAUSE): Seed[] {
  const loved = new Map<string, Seed>();
  for (const rating of [...ratings].sort((a, b) => b.ratedAt - a.ratedAt)) {
    const key = titleLink(rating.url);
    if (rating.season === undefined && rating.score >= LOVED_FROM && !loved.has(key)) loved.set(key, { key, title: rating.title, url: rating.url, why: "loved" });
  }
  const disliked = dislikedKeys(ratings);
  const watched = new Map<string, Seed>();
  for (const card of progress) {
    const key = titleLink(card.url);
    if (!watched.has(key) && !disliked.has(key)) watched.set(key, { key, title: card.title, url: card.url, why: loved.has(key) ? "loved" : "watched" });
  }
  // (the order of `progress` is the newest first)
  const first = [...watched.values()];
  const second = [...loved.values()];
  const seeds: Seed[] = [];
  const taken = new Set<string>();
  for (let at = 0; seeds.length < max && (at < first.length || at < second.length); at++) {
    for (const seed of [first[at], second[at]]) {
      if (seed && seeds.length < max && !taken.has(seed.key)) {
        taken.add(seed.key);
        seeds.push(seed);
      }
    }
  }
  return seeds;
}

/**
 * Every title a page asks the library about (`MAX_ASKS` at most): the ones that have a row of their own first (`seedsOf`, `MAX_BECAUSE` of them), then,
 * in turn, a title the profile saved to watch and the next one it watched or loved. The row of what it might like is made of all their answers.
 */
export function askedSeeds(progress: readonly LiveProgress[], ratings: readonly LiveRating[], list: readonly LiveListItem[], max = MAX_ASKS): Seed[] {
  const base = seedsOf(progress, ratings, Math.max(max, MAX_BECAUSE));
  const out = base.slice(0, MAX_BECAUSE);
  const rest = base.slice(MAX_BECAUSE);
  const saved = savedSeeds(list, ratings, new Set(base.map((seed) => seed.key)));
  for (let at = 0; out.length < max && (at < saved.length || at < rest.length); at++) {
    for (const seed of [saved[at], rest[at]]) if (seed && out.length < max) out.push(seed);
  }
  return out.slice(0, max);
}

/** The titles of the rows are the ones the profile has not started, saved or scored, and each title is in one row only. (A saved title has no row of its own.) */
export function becauseRows(
  seeds: readonly Seed[],
  answer: (key: string) => readonly LibraryItem[] | undefined,
  progress: readonly LiveProgress[],
  list: readonly LiveListItem[],
  ratings: readonly LiveRating[] = [],
): Because[] {
  const known = knownOf(progress, list, ratings);
  const shown = new Set<string>();
  const rows: Because[] = [];
  for (const seed of seeds) {
    if (seed.why === "saved" || rows.length >= MAX_BECAUSE) continue;
    const items = (answer(seed.key) ?? []).filter((item) => !isKnown(item, known) && item.title.toLowerCase() !== seed.title.toLowerCase() && !shown.has(item.id));
    if (items.length < (rows.length === 0 ? 1 : MIN_NEXT)) continue;
    for (const item of items) shown.add(item.id);
    rows.push({ key: seed.key, title: seed.title, why: seed.why, items });
  }
  return rows;
}

/* ------------------------------ asking the library ------------------------------ */

export interface LikeThisOptions {
  fetch?: typeof fetch;
  /** Told of every title that comes, so the search finds it. */
  learn?: (items: readonly LibraryItem[]) => void;
}

/** What the library said was like each title, kept for as long as the page is open: nothing found is kept too, and a question that failed is asked again. */
export function createLikeThis(options: LikeThisOptions = {}) {
  const ask = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const answers = new Map<string, readonly LibraryItem[]>();
  const asking = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const tell = () => {
    version++;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: (key: string) => answers.get(key),
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Asks, unless it has been, or is being. */
    ask(seed: Seed) {
      if (answers.has(seed.key) || asking.has(seed.key)) return;
      asking.add(seed.key);
      Promise.resolve()
        .then(() => ask(`/api/library/similar?url=${encodeURIComponent(seed.url)}`))
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          const parsed = LibraryItemsSchema.safeParse(body);
          const items = parsed.success ? parsed.data.items : [];
          asking.delete(seed.key);
          answers.set(seed.key, items);
          options.learn?.(items);
          tell();
        })
        .catch(() => asking.delete(seed.key)); // (not kept, so the next visit asks again)
    },
    reset() {
      answers.clear();
      asking.clear();
      tell();
    },
  };
}

export type LikeThis = ReturnType<typeof createLikeThis>;

/** What the TV and the phone ask the library. */
export const likeThis: LikeThis = createLikeThis({ learn: (items) => feed.learn(items) });

/** What a page shows of it. */
export interface Likes {
  /** The rows of "Because you ...". */
  because: Because[];
  /** What the profile might like, without the titles of those rows: the row under them on Home. */
  picks: LibraryItem[];
  /** ...and with them: the row of a page that has no rows of "Because you ..." (a section's). */
  pool: LibraryItem[];
}

const NO_RATINGS: readonly LiveRating[] = [];

/** The rows of "Because you ..." and what the profile in use might like (the scores count only while ratings are on). */
export function useLikes(store: LikeThis = likeThis): Likes {
  const { progress, list, ratings, settings } = useProfileData();
  const scored = ratingsShown(settings) ? ratings : NO_RATINGS;
  const seeds = useMemo(() => askedSeeds(progress, scored, list), [progress, scored, list]);
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);
  useEffect(() => {
    for (const seed of seeds) store.ask(seed);
  }, [seeds, store]);
  return useMemo(() => {
    const because = becauseRows(seeds, store.get, progress, list, scored);
    const known = knownOf(progress, list, scored);
    const shown = new Set(because.flatMap((row) => row.items.map((item) => item.id)));
    return { because, picks: picksOf(seeds, store.get, known, shown), pool: picksOf(seeds, store.get, known) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` says that an answer came
  }, [seeds, version, progress, list, scored, store]);
}

/** The rows of "Because you ..." alone. */
export const useBecause = (store: LikeThis = likeThis): Because[] => useLikes(store).because;
