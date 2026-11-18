import { titleLink, type LibraryItem, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";

export const LOVED_FROM = 8;
export const DISLIKED_TO = 4;
export const ROOTS_MAX = 12;
export const FIRST_ASKS = 6;
export const PICKS_MIN = 5;
export const PICKS_MAX = 20;
export const PICKS_FILL = 12;
export const ROW_KEEPS = 6;
export const MIN_NEXT = 4;
export const BRANCHES = 2;
export const ASKS_AT_ONCE = 3;
export const ASKS_MAX = 40;
export const DRY_MAX = 6;
export const UNSEEN_MIN = 6;

export interface Seed {
  key: string;
  title: string;
  url: string;
  why: "watched" | "loved" | "saved" | "like";
}

export interface PersonalRow {
  id: string;
  key: string;
  title: string;
  why: Seed["why"] | "picks";
  items: LibraryItem[];
}

const keyOf = (url: string): string => titleLink(url);
const nameOf = (title: string): string => title.trim().toLowerCase();

export function dislikedKeys(ratings: readonly LiveRating[]): Set<string> {
  return new Set(ratings.filter((rating) => rating.season === undefined && rating.score <= DISLIKED_TO).map((rating) => keyOf(rating.url)));
}

export function seenKeys(progress: readonly LiveProgress[], ratings: readonly LiveRating[]): Set<string> {
  const seen = new Set<string>();
  for (const card of progress) if (card.done) seen.add(keyOf(card.url));
  for (const rating of ratings) seen.add(keyOf(rating.url));
  return seen;
}

export const isSeen = (item: { url: string }, keys: ReadonlySet<string>): boolean => keys.size > 0 && keys.has(keyOf(item.url));

export function withoutSeen<T extends { url: string }>(items: readonly T[], seen: ReadonlySet<string>, min = UNSEEN_MIN): readonly T[] {
  if (seen.size === 0) return items;
  const left = items.filter((item) => !isSeen(item, seen));
  return left.length === items.length || left.length < min ? items : left;
}

export interface Known {
  keys: ReadonlySet<string>;
  names: ReadonlySet<string>;
}
export function knownOf(progress: readonly LiveProgress[], list: readonly LiveListItem[], ratings: readonly LiveRating[] = []): Known {
  const all = [...progress, ...list, ...ratings];
  return { keys: new Set(all.map((each) => keyOf(each.url))), names: new Set(all.map((each) => nameOf(each.title))) };
}
export const isKnown = (item: LibraryItem, known: Known): boolean => known.keys.has(keyOf(item.url)) || known.names.has(nameOf(item.title));

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

export type Look = (key: string) => readonly LibraryItem[] | null | undefined;

export interface Plan {
  rows: PersonalRow[];
  ask: Seed[];
}

export interface PlanOptions {
  want: number;
  keep?: ((item: LibraryItem) => boolean) | undefined;
  picks?: boolean | undefined;
}

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
      return { rows, ask: queue.slice(at, ASKS_MAX).filter((each) => look(each.key) === undefined).slice(0, ASKS_AT_ONCE) };
    }
    const items = (answer ?? []).filter((item, index, all) => fresh(item) && keyOf(item.url) !== seed.key && nameOf(item.title) !== nameOf(seed.title) && all.findIndex((other) => keyOf(other.url) === keyOf(item.url)) === index);
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

export const personalAfter = (index: number): number | undefined => (index % 2 === 0 ? index / 2 : undefined);
export const personalSlots = (libraryRows: number): number => Math.ceil(Math.max(0, libraryRows) / 2);
