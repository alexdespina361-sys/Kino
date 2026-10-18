import MiniSearch, { type Query } from "minisearch";
import type { LibraryItem, LibraryRow } from "./library";

/**
 * Looking for a title among titles: what was typed is matched word by word, a word that is still being typed counts, a word that is
 * one slip of the keyboard away from a title's counts too ("strager things" finds Stranger Things), and a title typed without its
 * spaces or hyphens ("spiderman") is found. The server uses it on what places answer with, the TV and the phone on what is on screen.
 */

/** Without accents or apostrophes, in lower case: what titles and words are compared as ("Marvel's", "Amélie" → "marvels", "amelie"). */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/['’ʼ]/g, "").toLowerCase();

/** The short names people type for a title, when one begins a search. */
const ALIASES: Record<string, string> = {
  lotr: "lord of the rings",
  got: "game of thrones",
  hp: "harry potter",
  aot: "attack on titan",
  twd: "walking dead",
  himym: "how i met your mother",
  tbbt: "big bang theory",
  bcs: "better call saul",
  mha: "my hero academia",
  jjk: "jujutsu kaisen",
  sao: "sword art online",
};

/** What was typed with a short name at its start spelled out, otherwise as typed (but for the spaces around it). */
export function spelledOut(query: string): string {
  const text = query.trim();
  const [first = "", ...rest] = text.split(/\s+/);
  const key = fold(first);
  return Object.hasOwn(ALIASES, key) ? [ALIASES[key], ...rest].join(" ") : text;
}

/** What was typed as it is looked for: folded, a short name spelled out, anything that is not a letter or a digit a single space. */
export function normalizeQuery(query: string): string {
  return fold(spelledOut(query)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The titles of the rows, each title once, in row order. */
export function itemsOf(rows: readonly LibraryRow[]): LibraryItem[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => row.items.filter((item) => !seen.has(item.id) && seen.add(item.id)));
}

/** What a title is looked for by: its words, all of them as one (`spiderman` for "Spider-Man"), and its year. */
function fieldOf(item: LibraryItem, field: string): string {
  if (field === "title") return fold(item.title);
  if (field === "joined") return fold(item.title).replace(/[^\p{L}\p{N}]+/gu, "");
  if (field === "year") return String(item.year ?? "");
  return item.id;
}

/** A word with each pair of neighbouring letters swapped, one pair at a time: the commonest slip of the fingers ("thigns"), which a count of letters changed would take for two. */
function swaps(word: string): string[] {
  const letters = [...word];
  const swapped: string[] = [];
  for (let at = 0; at + 1 < letters.length; at++) {
    if (letters[at] !== letters[at + 1]) swapped.push([...letters.slice(0, at), letters[at + 1]!, letters[at]!, ...letters.slice(at + 2)].join(""));
  }
  return swapped;
}

const isNumber = (word: string) => /^\d+$/.test(word);

/** Words that say what is wanted and no part of what a title is called: "harry potter full movie", "watch dune online". */
const NOISE = new Set(["movie", "movies", "film", "films", "series", "show", "shows", "tv", "full", "watch", "online", "free", "hd", "streaming", "season", "seasons", "episode", "episodes"]);

/** Words that are in a great many titles and tell nothing about which: no title is close to "the farewell" for having "the". */
const COMMON = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "with", "is", "it", "my", "me", "you", "we", "la", "le", "el", "de", "les", "der", "die", "das", "il", "lo", "los", "las", "un", "una", "et"]);

/** What was typed without those words (the query as it is when there would be nothing left, or none of them). */
export function withoutNoise(query: string): string {
  const words = normalizeQuery(query).split(" ").filter(Boolean);
  const kept = words.filter((word) => !NOISE.has(word));
  return kept.length > 0 && kept.length < words.length ? kept.join(" ") : normalizeQuery(query);
}

/** How a title is looked for: as typed (`strict`), a letter more forgiven (`relaxed`), or by any of the words, half of them at least (`loose`). */
export type Tier = "strict" | "relaxed" | "loose";

/** The titles of one index are remembered up to this many; when there are more, the oldest tenth goes. */
const CAPACITY = 30000;
/** A search that finds fewer than this many titles looks further (a tier more forgiving at a time). */
const WANTED = 6;
/** The closest others (titles with only some of the words) are shown up to this many: past the first few they are no help. */
export const CLOSEST_MAX = 30;

/**
 * Titles to look for a title among. One index that is made once and takes more titles as they are met (the server remembers every title it
 * has listed, the screens every one they were sent), instead of one made from the titles on the screen at each question.
 */
export class TitleIndex {
  private readonly index = new MiniSearch<LibraryItem>({ fields: ["title", "joined", "year"], extractField: fieldOf });
  private readonly titles = new Map<string, LibraryItem>();
  /** When each was added, the first to be met being the likeliest to be the popular ones (the places list those first). */
  private readonly order = new Map<string, number>();
  private count = 0;
  private readonly capacity: number;

  constructor(items: Iterable<LibraryItem> = [], capacity = CAPACITY) {
    this.capacity = capacity;
    this.add(items);
  }

  get size(): number {
    return this.titles.size;
  }

  /** Takes the titles that are not in yet (a title is known by its id). */
  add(items: Iterable<LibraryItem>): void {
    for (const item of items) {
      if (this.titles.has(item.id)) continue;
      this.index.add(item);
      this.titles.set(item.id, item);
      this.order.set(item.id, this.count++);
    }
    if (this.titles.size > this.capacity) {
      // (the oldest go, down to nine tenths of the capacity, so that this is not done again at every few titles)
      for (const id of [...this.titles.keys()].slice(0, this.titles.size - this.capacity + Math.ceil(this.capacity / 10))) {
        this.index.discard(id);
        this.titles.delete(id);
        this.order.delete(id);
      }
    }
  }

  /** Takes an item out of the index. */
  remove(id: string): void {
    if (!this.titles.has(id)) return;
    this.index.discard(id);
    this.titles.delete(id);
    this.order.delete(id);
  }

  /** Takes items that match a condition out of the index. */
  discardWhere(predicate: (item: LibraryItem) => boolean): void {
    for (const [id, item] of this.titles) {
      if (predicate(item)) {
        this.index.discard(id);
        this.titles.delete(id);
        this.order.delete(id);
      }
    }
  }

  /**
   * The titles that have the words of the query, the best match first. A word may be unfinished, have its neighbouring letters swapped (a word
   * of three letters too, when another word of the query is longer: "teh office"), or (when it is long enough) be a letter or two off; the looser
   * tiers forgive one more letter and the last wants only half of the words. A number is a year, and is what it is. Exact words come before
   * those, a word of the title before its year, then the titles that came first.
   */
  find(query: string, tier: Tier = "strict"): LibraryItem[] {
    const q = normalizeQuery(query);
    if (!q || this.titles.size === 0) return [];
    const words = q.split(" ");
    const typed = new Set(words);
    const held = words.length > 1 && words.some((word) => word.length >= 4); // (a short word alone is too little to go on)
    const spellings = (word: string): string[] => [word, ...(word.length >= (held ? 3 : 4) && !isNumber(word) ? swaps(word) : [])];
    const wordOrSwapped = (word: string): Query => ({ combineWith: "OR", queries: spellings(word) });
    const base = {
      boost: { title: 10, year: 3 },
      prefix: true,
      boostTerm: (term: string) => (typed.has(term) ? 1 : 0.5),
      boostDocument: (id: string) => 1 + 0.1 * (1 - Math.min(1, (this.order.get(id) ?? 0) / Math.max(1, this.count))),
    };
    if (tier === "strict") return this.index.search({ combineWith: "AND", queries: words.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 5 ? 0.2 : false) }).map((hit) => this.titles.get(hit.id)!);
    if (tier === "relaxed") return this.index.search({ combineWith: "AND", queries: words.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 4 ? 0.25 : false) }).map((hit) => this.titles.get(hit.id)!);
    const significant = words.filter((word) => !NOISE.has(word) && !COMMON.has(word) && word.length >= 2);
    if (significant.length === 0) return [];
    const need = Math.ceil(significant.length / 2);
    // (a hit counts the words it has, not the spellings of one word it matched: a long word is asked in each of its swapped spellings too)
    const wordOf = new Map<string, number>();
    significant.forEach((word, at) => spellings(word).forEach((spelling) => wordOf.has(spelling) || wordOf.set(spelling, at)));
    return this.index
      .search({ combineWith: "OR", queries: significant.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 5 ? 0.2 : false) })
      .filter((hit) => significant.length === 1 || new Set(hit.queryTerms.flatMap((term) => (wordOf.has(term) ? [wordOf.get(term)!] : []))).size >= need)
      .map((hit) => this.titles.get(hit.id)!);
  }

  /**
   * What `find` finds in the tiers in turn, until there are enough. `exact` is how many of the first have all the words (the strict and the
   * relaxed tier): the rest have only some of them, the closest others.
   */
  search(query: string, wanted = WANTED): { items: LibraryItem[]; exact: number } {
    const seen = new Set<string>();
    const take = (items: LibraryItem[], into: LibraryItem[]) => {
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        into.push(item);
      }
    };
    const exact: LibraryItem[] = [];
    const closest: LibraryItem[] = [];
    take(this.find(query, "strict"), exact);
    if (exact.length < wanted) take(this.find(query, "relaxed"), exact);
    if (exact.length < wanted) take(this.find(query, "loose"), closest);
    const ranked = rankByQuery(exact, query);
    return { items: [...ranked, ...rankByQuery(closest, query).slice(0, CLOSEST_MAX)], exact: ranked.length };
  }
}

/** The titles that have every word of the query, the best match first (see `TitleIndex.find`): for titles met once, as the page's. */
export function searchItems(items: readonly LibraryItem[], query: string): LibraryItem[] {
  return new TitleIndex(items).find(query, "strict");
}

/** Words as they are compared: folded, nothing but letters and digits, and without "The" in front (when it is not all there is). */
function comparable(words: string): string[] {
  const list = words.split(" ").filter(Boolean);
  return list.length > 1 && (list[0] === "the" || list[0] === "a" || list[0] === "an") ? list.slice(1) : list;
}

/** How near a title is to what was typed: 0 it is that, 1 it begins with it, 2 every word typed begins one of its words, 3 it has it inside a word, 4 only a place's own matching brought it. */
function nearness(item: LibraryItem, typed: readonly string[]): number {
  const words = typed.filter((word) => word !== String(item.year)); // ("dune 2021": the year says which Dune, it is not part of the name)
  if (words.length === 0) return 4;
  const title = comparable(fold(item.title).replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  const said = words.join(" ");
  const is = title.join(" ");
  const joinedTitle = title.join("");
  const joinedSaid = words.join("");
  if (is === said || joinedTitle === joinedSaid) return 0;
  if (is.startsWith(said) || joinedTitle.startsWith(joinedSaid)) return 1;
  const free = [...title];
  const begun = words.every((word) => {
    const at = free.findIndex((own) => own.startsWith(word));
    if (at < 0) return false;
    free.splice(at, 1);
    return true;
  });
  if (begun) return 2;
  return joinedTitle.includes(joinedSaid) ? 3 : 4;
}

/**
 * The answers to a search put in the order they are likely what was meant: the title that is what was typed, then the titles that begin
 * with it ("boon" is The Boondocks before Baboon), then those with a word that does, then the rest. Within each the order the places gave
 * (the popular ones first) is kept. The same list is returned when nothing was typed.
 */
export function rankByQuery(items: readonly LibraryItem[], query: string): LibraryItem[] {
  const words = comparable(normalizeQuery(query));
  if (words.length === 0) return [...items];
  return items
    .map((item, at) => ({ item, at, near: nearness(item, words) }))
    .sort((a, b) => a.near - b.near || a.at - b.at)
    .map(({ item }) => item);
}

/** No more than this many other questions are put to a place for one search. */
const MAX_GUESSES = 6;

/**
 * Other things to ask a place whose own search forgives nothing (a word a letter off finds nothing there): the query without each of
 * its words (a slip in one leaves the rest to find the title), and for each of the two longest words the query with it cut to its first
 * letters or, when it is very long, to all but its last two (a slip is rarely in the first letters, and a place takes the last word as
 * one that is not finished). What comes back is only a pool to pick from; `searchItems` decides what matches.
 */
export function guessesFor(query: string): string[] {
  const words = normalizeQuery(query).split(" ");
  const distinct = [...new Set(words)];
  const without = (word: string) => words.filter((other) => other !== word);
  const longest = distinct.filter((word) => word.length >= 5).sort((a, b) => b.length - a.length).slice(0, 2);
  const guesses = [
    ...(distinct.length > 1 ? distinct.filter((word) => word.length >= 3).map((word) => without(word).join(" ")) : []),
    ...longest.map((word) => [...without(word), word.slice(0, 4)].join(" ")),
    ...longest.filter((word) => word.length >= 7).map((word) => [...without(word), word.slice(0, -2)].join(" ")),
  ];
  return [...new Set(guesses)].filter(Boolean).slice(0, MAX_GUESSES);
}
