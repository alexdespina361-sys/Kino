import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LibraryItemsSchema, titleLink, type LibraryItem, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { useProfileData } from "../account/store";
import { feed } from "./feed";

/**
 * Rows of "Because you watched ..." and "Because you loved ...": the titles the library says are like what a profile watched lately or
 * scored high. The library knows nothing of taste, only which titles are alike, so each row is the answer to one question: titles like this one.
 */

/** A score of this or more says "more like this". */
export const LOVED_FROM = 8;
/** How many titles a page asks for titles like. */
export const MAX_BECAUSE = 3;
/** A row after the first is worth showing with this many titles that are new to the page. */
export const MIN_NEXT = 4;

/** A title that "like this" is asked for, and why it was chosen. */
export interface Seed {
  /** The title's link without the season and episode: every episode of a show is one. */
  key: string;
  title: string;
  /** What the library is asked about. */
  url: string;
  why: "watched" | "loved";
}

/** A row: the titles like `title`, none of them started or saved. */
export interface Because {
  key: string;
  title: string;
  why: "watched" | "loved";
  items: LibraryItem[];
}

/**
 * The titles to ask for titles like, the most recently watched first and then, in turn, one that was scored high and one that was watched: each
 * title once (a title that was watched and scored high is said to be loved). Scores count when they are for the whole title, not for a season.
 */
export function seedsOf(progress: readonly LiveProgress[], ratings: readonly LiveRating[], max = MAX_BECAUSE): Seed[] {
  const loved = new Map<string, Seed>();
  for (const rating of [...ratings].sort((a, b) => b.ratedAt - a.ratedAt)) {
    const key = titleLink(rating.url);
    if (rating.season === undefined && rating.score >= LOVED_FROM && !loved.has(key)) loved.set(key, { key, title: rating.title, url: rating.url, why: "loved" });
  }
  const watched = new Map<string, Seed>();
  for (const card of progress) {
    const key = titleLink(card.url);
    if (!watched.has(key)) watched.set(key, { key, title: card.title, url: card.url, why: loved.has(key) ? "loved" : "watched" });
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

/** The titles of the rows are the ones the profile has not started or saved, and each title is in one row only. */
export function becauseRows(
  seeds: readonly Seed[],
  answer: (key: string) => readonly LibraryItem[] | undefined,
  progress: readonly LiveProgress[],
  list: readonly LiveListItem[],
): Because[] {
  const known = new Set([...progress, ...list].map((each) => each.title.toLowerCase()));
  const shown = new Set<string>();
  const rows: Because[] = [];
  for (const seed of seeds) {
    const items = (answer(seed.key) ?? []).filter((item) => !known.has(item.title.toLowerCase()) && item.title.toLowerCase() !== seed.title.toLowerCase() && !shown.has(item.id));
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

/** The rows of "Because you ..." for the profile in use (the scores count only while ratings are on). */
export function useBecause(store: LikeThis = likeThis): Because[] {
  const { progress, list, ratings, settings } = useProfileData();
  const ratingsOn = settings.ratings ?? true;
  const seeds = useMemo(() => seedsOf(progress, ratingsOn ? ratings : []), [progress, ratings, ratingsOn]);
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);
  useEffect(() => {
    for (const seed of seeds) store.ask(seed);
  }, [seeds, store]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` says that an answer came
  return useMemo(() => becauseRows(seeds, store.get, progress, list), [seeds, version, progress, list, store]);
}
