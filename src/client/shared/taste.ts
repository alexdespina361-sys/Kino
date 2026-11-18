import { titleLink, type LibraryItem, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";

/**
 * What a profile has seen, and what it might like of what it has not (the owner, 18 Nov 2026: "using a list + ratings + already seen content, some
 * carousels should contain unseen content that the user might like", "reduced already seen content in library"; and, the same day, of the first go at
 * it: "the first 5 lines are you might like / because you watched / etc then everything else is top movies, top series ... It should be continuously
 * mixed throughout the scroll, and it shouldn't be limited to 5. If a person watched 3 things we can generate so many because stuff").
 *
 * No taste is worked out here: the library says which titles are like which (`/api/library/similar`), and these put its answers in an order. Every
 * title the profile watched, loved or saved has a row of titles like it; the best of each row are asked about in turn ("More like ..."), and theirs
 * after them, for as long as the page is scrolled: three films watched are a dozen rows. The rows stand among the library's own, one after every two
 * of them (`personalAfter`). Nothing of it leaves the screen it is worked out on.
 */

/** A score of this or more says "more like this"; one of this or less says "not like this". */
export const LOVED_FROM = 8;
export const DISLIKED_TO = 4;
/** How many of the profile's own titles have a row (the newest of what it watched, loved and saved, in turn). */
export const ROOTS_MAX = 12;
/** The first of them are asked about before any row is laid out: the row of what several of them led to is made of their answers, once. */
export const FIRST_ASKS = 6;
/** That row is worth showing with this many titles, and shows this many at most. */
export const PICKS_MIN = 5;
export const PICKS_MAX = 20;
/** With fewer titles than this that several led to, it is filled up to this many from each title's own answer, which keeps its first `ROW_KEEPS` for its own row. */
export const PICKS_FILL = 12;
export const ROW_KEEPS = 6;
/** A row after the first is worth showing with this many titles that no row before it has. */
export const MIN_NEXT = 4;
/** How many of a row's titles are asked about in turn, for rows of their own. */
export const BRANCHES = 2;
/** How many questions are on their way at once, how many titles a page asks about in all, and after how many in a row that gave no row it stops. */
export const ASKS_AT_ONCE = 3;
export const ASKS_MAX = 40;
export const DRY_MAX = 6;
/** A row of the library leaves out what the profile has seen while this many titles are left in it; a shorter one is as it is. */
export const UNSEEN_MIN = 6;

/** A title that "like this" is asked for, and why: the profile watched it, loved it or saved it, or it is one of the best of a row before (`like`). */
export interface Seed {
  /** The title's link without the season and episode: every episode of a show is one. */
  key: string;
  title: string;
  /** What the library is asked about. */
  url: string;
  why: "watched" | "loved" | "saved" | "like";
}

/** A row of the profile's own: the titles like `title` (or, `why: "picks"`, the ones several of its titles led to), none of them known to it. */
export interface PersonalRow {
  /** `picks`, or `because:<key>`. */
  id: string;
  key: string;
  title: string;
  why: Seed["why"] | "picks";
  items: LibraryItem[];
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
 * The profile's own titles that get a row, in turn one it watched (the newest first), one it scored high and one it saved to watch: each title
 * once, a title both watched and scored high as loved. Scores count when they are for the whole title, not for a season; a title that was scored
 * low is not one (more like it is not what its score says).
 */
export function rootSeeds(progress: readonly LiveProgress[], ratings: readonly LiveRating[], list: readonly LiveListItem[] = [], max = ROOTS_MAX): Seed[] {
  const disliked = dislikedKeys(ratings);
  const loved = new Map<string, Seed>();
  for (const rating of [...ratings].sort((a, b) => b.ratedAt - a.ratedAt)) {
    const key = keyOf(rating.url);
    if (rating.season === undefined && rating.score >= LOVED_FROM && !loved.has(key)) loved.set(key, { key, title: rating.title, url: rating.url, why: "loved" });
  }
  const watched = new Map<string, Seed>();
  for (const card of progress) {
    const key = keyOf(card.url);
    if (!watched.has(key) && !disliked.has(key)) watched.set(key, { key, title: card.title, url: card.url, why: loved.has(key) ? "loved" : "watched" });
  }
  const saved = new Map<string, Seed>();
  for (const item of [...list].sort((a, b) => b.at - a.at)) {
    const key = keyOf(item.url);
    if (!saved.has(key) && !disliked.has(key)) saved.set(key, { key, title: item.title, url: item.url, why: "saved" });
  }
  // (the order of `progress` is the newest first)
  const turns = [[...watched.values()], [...loved.values()], [...saved.values()]];
  const seeds: Seed[] = [];
  const taken = new Set<string>();
  for (let at = 0; seeds.length < max && turns.some((turn) => at < turn.length); at++) {
    for (const turn of turns) {
      const seed = turn[at];
      if (seed && seeds.length < max && !taken.has(seed.key)) {
        taken.add(seed.key);
        seeds.push(seed);
      }
    }
  }
  return seeds;
}

/** What the library said of a title: its answer; `null` when it could not be had just now (no row, and nothing waits for it); nothing while it is on its way. */
export type Look = (key: string) => readonly LibraryItem[] | null | undefined;

export interface Plan {
  /** The rows there are so far, in the order they keep: one that is laid out never moves when a later answer comes. */
  rows: PersonalRow[];
  /** What to ask the library next: the titles the next rows wait for (the first few all at once, then `ASKS_AT_ONCE` at most). */
  ask: Seed[];
}

export interface PlanOptions {
  /** How many rows the page has a place for: no more are made, and nothing is asked that they do not need. */
  want: number;
  /** The titles the page shows (a section's, the sections a profile watches): the rows, and the titles asked about after them, are of these only. */
  keep?: ((item: LibraryItem) => boolean) | undefined;
  /** Without the row of what the profile might like. */
  picks?: boolean | undefined;
}

/**
 * The profile's rows, `want` of them at most, from what the library has answered so far.
 *
 * The order is the queue's and never an answer's: first the profile's own titles (`roots`), then for each row made, in turn, the best of its titles
 * that are in no row yet (`BRANCHES` of them, "More like ..."). A title waits for the answers before it, so what was laid out stays where it is, and
 * the rows for some answers are the first rows for those and more (the tests say so). Each title is in one row only, and never one the profile knows.
 *
 * Before any of it, the first few roots are all asked about (`FIRST_ASKS`): what two or more of them led to is the row of what the profile might like
 * (`picks`; filled from each of them in turn when that is little), made once and put first, and those titles are in no other row.
 */
export function planRows(roots: readonly Seed[], look: Look, known: Known, options: PlanOptions): Plan {
  const { want, keep } = options;
  const rows: PersonalRow[] = [];
  if (roots.length === 0 || want <= 0) return { rows, ask: [] };
  const first = roots.slice(0, FIRST_ASKS);
  const waiting = first.filter((seed) => look(seed.key) === undefined);
  if (waiting.length > 0) return { rows, ask: waiting };

  const rootKeys = new Set(roots.map((seed) => seed.key));
  const rootNames = new Set(roots.map((seed) => nameOf(seed.title)));
  const shown = new Set<string>();
  const fresh = (item: LibraryItem) =>
    !shown.has(keyOf(item.url)) && !rootKeys.has(keyOf(item.url)) && !rootNames.has(nameOf(item.title)) && !isKnown(item, known) && (!keep || keep(item));

  // What several of the first titles led to, the most of them first and then the ones nearer the front of an answer; a loved one counts for more.
  const led = new Map<string, { item: LibraryItem; seeds: number; points: number; front: number }>();
  const own: LibraryItem[][] = [];
  for (const seed of first) {
    const items = look(seed.key) ?? [];
    const counted = new Set<string>();
    const mine: LibraryItem[] = [];
    items.forEach((item, index) => {
      const key = keyOf(item.url);
      if (counted.has(key) || !fresh(item)) return;
      counted.add(key);
      mine.push(item);
      const had = led.get(key) ?? { item, seeds: 0, points: 0, front: 1 };
      had.seeds++;
      had.points += seed.why === "loved" ? 1.5 : 1;
      had.front = Math.min(had.front, index / Math.max(1, items.length));
      led.set(key, had);
    });
    own.push(mine);
  }
  const picks = [...led.values()]
    .filter((each) => each.seeds >= 2)
    .sort((a, b) => b.points - a.points || a.front - b.front)
    .slice(0, PICKS_MAX)
    .map((each) => each.item);
  // When the titles have little in common, the row is filled from each of them in turn: what an answer has past the start of its own row (`ROW_KEEPS`).
  if (picks.length < PICKS_FILL && own.filter((mine) => mine.length > 0).length >= 2) {
    const spare = own.map((mine) => mine.filter((item) => led.get(keyOf(item.url))!.seeds < 2).slice(ROW_KEEPS));
    for (let at = 0; picks.length < PICKS_FILL && spare.some((mine) => at < mine.length); at++) {
      for (const mine of spare) {
        const item = mine[at];
        if (item && picks.length < PICKS_FILL) picks.push(item);
      }
    }
  }
  if (options.picks !== false && picks.length >= PICKS_MIN) {
    for (const item of picks) shown.add(keyOf(item.url));
    rows.push({ id: "picks", key: "picks", title: "", why: "picks", items: picks });
  }

  const queue: Seed[] = [...roots];
  const queued = new Set(queue.map((seed) => seed.key));
  let dry = 0;
  let because = 0;
  for (let at = 0; at < queue.length && at < ASKS_MAX && rows.length < want && dry < DRY_MAX; at++) {
    const seed = queue[at]!;
    const answer = look(seed.key);
    if (answer === undefined) {
      // (It and the next ones that are known of already are asked about together: the rows after it wait for it.)
      return { rows, ask: queue.slice(at, ASKS_MAX).filter((each) => look(each.key) === undefined).slice(0, ASKS_AT_ONCE) };
    }
    const items = (answer ?? []).filter((item, index, all) => fresh(item) && keyOf(item.url) !== seed.key && nameOf(item.title) !== nameOf(seed.title) && all.findIndex((other) => keyOf(other.url) === keyOf(item.url)) === index);
    // (The first row is shown however few titles it has: it is what there is.)
    if (items.length < (because === 0 ? 1 : MIN_NEXT)) {
      dry++;
      continue;
    }
    dry = 0;
    because++;
    for (const item of items) shown.add(keyOf(item.url));
    rows.push({ id: `because:${seed.key}`, key: seed.key, title: seed.title, why: seed.why, items });
    for (const item of items.slice(0, BRANCHES)) {
      const key = keyOf(item.url);
      if (!queued.has(key)) {
        queued.add(key);
        queue.push({ key, title: item.title, url: item.url, why: "like" });
      }
    }
  }
  return { rows, ask: [] };
}

/**
 * Where the profile's rows stand among the library's: `personalAfter` is which one goes under the library's row `index` (0 is the ranking), if any.
 * The first under the ranking, then one under every second row, so that a page is the two kinds mixed all the way down. None is over the first row of
 * the library: a page opens with the remote on that row, and a row that came in over it a moment later would push it down the screen.
 */
export const personalAfter = (index: number): number | undefined => (index % 2 === 0 ? index / 2 : undefined);
/** How many of the profile's rows a page with this many of the library's rows has a place for. */
export const personalSlots = (libraryRows: number): number => Math.ceil(Math.max(0, libraryRows) / 2);
