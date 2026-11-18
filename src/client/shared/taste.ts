import { titleLink, type LibraryItem, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";

/**
 * What a profile has seen, and what it might like of what it has not (the owner, 18 Nov 2026: "using a list + ratings + already seen content, some
 * carousels should contain unseen content that the user might like", and "reduced already seen content in library"). No taste is worked out here: the
 * library says which titles are like which (`/api/library/similar`), and these put its answers together: titles like several of the ones the profile
 * watched, loved or saved come first, and what it has seen, started, saved or scored is left out. Nothing of it leaves the screen it is worked out on.
 */

/** A score of this or more says "more like this"; one of this or less says "not like this". */
export const LOVED_FROM = 8;
export const DISLIKED_TO = 4;
/** How many titles a page asks the library for titles like, at most: each is a question the server may have to pass on. */
export const MAX_ASKS = 6;
/** The row of what the profile might like is worth showing with this many titles, and shows this many at most. */
export const PICKS_MIN = 5;
export const PICKS_MAX = 30;
/** A row of the library leaves out what the profile has seen while this many titles are left in it; a shorter one is as it is. */
export const UNSEEN_MIN = 6;

/** A title that "like this" is asked for, and why it was chosen. */
export interface Seed {
  /** The title's link without the season and episode: every episode of a show is one. */
  key: string;
  title: string;
  /** What the library is asked about. */
  url: string;
  why: "watched" | "loved" | "saved";
}

const keyOf = (url: string): string => titleLink(url);
const nameOf = (title: string): string => title.trim().toLowerCase();

/** The titles the profile scored low, as a whole (a score of one season says nothing of the show). */
export function dislikedKeys(ratings: readonly LiveRating[]): Set<string> {
  return new Set(ratings.filter((rating) => rating.season === undefined && rating.score <= DISLIKED_TO).map((rating) => keyOf(rating.url)));
}

/** What the profile has seen: what it played to the end (a show: to the end of its last episode) and what it gave a score. */
export function seenKeys(progress: readonly LiveProgress[], ratings: readonly LiveRating[]): Set<string> {
  const seen = new Set<string>();
  for (const card of progress) if (card.done) seen.add(keyOf(card.url));
  for (const rating of ratings) seen.add(keyOf(rating.url));
  return seen;
}

/** Whether a title of the library is one of `keys` (see `seenKeys`). */
export const isSeen = (item: { url: string }, keys: ReadonlySet<string>): boolean => keys.size > 0 && keys.has(keyOf(item.url));

/**
 * The titles of a row of the library without the ones the profile has seen, while enough are left for a row (`UNSEEN_MIN`); a row that would be
 * left short is as it was (what was seen is then most of what there is of its kind, and a row of three says less than one of ten). The same list
 * when nothing of it was seen.
 */
export function withoutSeen<T extends { url: string }>(items: readonly T[], seen: ReadonlySet<string>, min = UNSEEN_MIN): readonly T[] {
  if (seen.size === 0) return items;
  const left = items.filter((item) => !isSeen(item, seen));
  return left.length === items.length || left.length < min ? items : left;
}

/** What the profile knows already: what it started or finished, saved or scored. By link, and by name (a place may list a title under another link). */
export interface Known {
  keys: ReadonlySet<string>;
  names: ReadonlySet<string>;
}
export function knownOf(progress: readonly LiveProgress[], list: readonly LiveListItem[], ratings: readonly LiveRating[] = []): Known {
  const all = [...progress, ...list, ...ratings];
  return { keys: new Set(all.map((each) => keyOf(each.url))), names: new Set(all.map((each) => nameOf(each.title))) };
}
export const isKnown = (item: LibraryItem, known: Known): boolean => known.keys.has(keyOf(item.url)) || known.names.has(nameOf(item.title));

/**
 * The titles the profile saved to watch, the newest first, as titles to ask for titles like (`why: "saved"`): not the ones in `taken`, nor one it
 * scored low since.
 */
export function savedSeeds(list: readonly LiveListItem[], ratings: readonly LiveRating[], taken: ReadonlySet<string>): Seed[] {
  const disliked = dislikedKeys(ratings);
  const seeds = new Map<string, Seed>();
  for (const item of [...list].sort((a, b) => b.at - a.at)) {
    const key = keyOf(item.url);
    if (!taken.has(key) && !disliked.has(key) && !seeds.has(key)) seeds.set(key, { key, title: item.title, url: item.url, why: "saved" });
  }
  return [...seeds.values()];
}

/**
 * What the profile might like: the titles the library said were like the ones in `seeds`, each once, the ones several of them led to first (a
 * title like three the profile watched says more than one like a single one), one that was loved counting for more than one that was watched or
 * saved, and among equals the one the library put nearer the front of its answer. Never one the profile knows already, nor one in `shown` (the
 * rows of "Because you watched ..." over it on the page).
 */
export function picksOf(seeds: readonly Seed[], answer: (key: string) => readonly LibraryItem[] | undefined, known: Known, shown: ReadonlySet<string> = new Set(), max = PICKS_MAX): LibraryItem[] {
  const seedKeys = new Set(seeds.map((seed) => seed.key));
  const seedNames = new Set(seeds.map((seed) => nameOf(seed.title)));
  const found = new Map<string, { item: LibraryItem; points: number; front: number }>();
  for (const seed of seeds) {
    const items = answer(seed.key) ?? [];
    const weight = seed.why === "loved" ? 1.5 : 1;
    const counted = new Set<string>(); // (an answer that lists a title twice counts it once)
    items.forEach((item, index) => {
      const key = keyOf(item.url);
      if (counted.has(key) || shown.has(item.id) || seedKeys.has(key) || seedNames.has(nameOf(item.title)) || isKnown(item, known)) return;
      counted.add(key);
      const front = index / Math.max(1, items.length);
      const had = found.get(key);
      if (had) {
        had.points += weight;
        had.front = Math.min(had.front, front);
      } else found.set(key, { item, points: weight, front });
    });
  }
  return [...found.values()]
    .sort((a, b) => b.points - a.points || a.front - b.front)
    .slice(0, max)
    .map((each) => each.item);
}
