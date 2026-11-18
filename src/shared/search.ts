import MiniSearch, { type Query } from "minisearch";
import type { LibraryItem, LibraryRow } from "./library";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/['’ʼ]/g, "").toLowerCase();

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

export function spelledOut(query: string): string {
  const text = query.trim();
  const [first = "", ...rest] = text.split(/\s+/);
  const key = fold(first);
  return Object.hasOwn(ALIASES, key) ? [ALIASES[key], ...rest].join(" ") : text;
}

export function normalizeQuery(query: string): string {
  return fold(spelledOut(query)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function itemsOf(rows: readonly LibraryRow[]): LibraryItem[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => row.items.filter((item) => !seen.has(item.id) && seen.add(item.id)));
}

function fieldOf(item: LibraryItem, field: string): string {
  if (field === "title") return fold(item.title);
  if (field === "joined") return fold(item.title).replace(/[^\p{L}\p{N}]+/gu, "");
  if (field === "year") return String(item.year ?? "");
  return item.id;
}

function swaps(word: string): string[] {
  const letters = [...word];
  const swapped: string[] = [];
  for (let at = 0; at + 1 < letters.length; at++) {
    if (letters[at] !== letters[at + 1]) swapped.push([...letters.slice(0, at), letters[at + 1]!, letters[at]!, ...letters.slice(at + 2)].join(""));
  }
  return swapped;
}

const isNumber = (word: string) => /^\d+$/.test(word);

const NOISE = new Set(["movie", "movies", "film", "films", "series", "show", "shows", "tv", "full", "watch", "online", "free", "hd", "streaming", "season", "seasons", "episode", "episodes"]);

const COMMON = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "with", "is", "it", "my", "me", "you", "we", "la", "le", "el", "de", "les", "der", "die", "das", "il", "lo", "los", "las", "un", "una", "et"]);

export function withoutNoise(query: string): string {
  const words = normalizeQuery(query).split(" ").filter(Boolean);
  const kept = words.filter((word) => !NOISE.has(word));
  return kept.length > 0 && kept.length < words.length ? kept.join(" ") : normalizeQuery(query);
}

export type Tier = "strict" | "relaxed" | "loose";

const CAPACITY = 30000;
const WANTED = 6;
export const CLOSEST_MAX = 30;

export class TitleIndex {
  private words: MiniSearch<LibraryItem> | null = null;
  private readonly titles = new Map<string, LibraryItem>();
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

  add(items: Iterable<LibraryItem>): void {
    for (const item of items) {
      if (this.titles.has(item.id)) continue;
      this.words?.add(item);
      this.titles.set(item.id, item);
      this.order.set(item.id, this.count++);
    }
    if (this.titles.size > this.capacity) {
      for (const id of [...this.titles.keys()].slice(0, this.titles.size - this.capacity + Math.ceil(this.capacity / 10))) {
        this.words?.discard(id);
        this.titles.delete(id);
        this.order.delete(id);
      }
    }
  }

  get(id: string): LibraryItem | undefined {
    return this.titles.get(id);
  }

  remove(id: string): void {
    if (!this.titles.has(id)) return;
    this.words?.discard(id);
    this.titles.delete(id);
    this.order.delete(id);
  }

  discardWhere(predicate: (item: LibraryItem) => boolean): void {
    for (const [id, item] of this.titles) {
      if (predicate(item)) {
        this.words?.discard(id);
        this.titles.delete(id);
        this.order.delete(id);
      }
    }
  }

  private wordsNow(): MiniSearch<LibraryItem> {
    if (!this.words) {
      this.words = new MiniSearch<LibraryItem>({ fields: ["title", "joined", "year"], extractField: fieldOf });
      this.words.addAll([...this.titles.values()]);
    }
    return this.words;
  }

  find(query: string, tier: Tier = "strict"): LibraryItem[] {
    const q = normalizeQuery(query);
    if (!q || this.titles.size === 0) return [];
    const index = this.wordsNow();
    const words = q.split(" ");
    const typed = new Set(words);
    const held = words.length > 1 && words.some((word) => word.length >= 4);
    const spellings = (word: string): string[] => [word, ...(word.length >= (held ? 3 : 4) && !isNumber(word) ? swaps(word) : [])];
    const wordOrSwapped = (word: string): Query => ({ combineWith: "OR", queries: spellings(word) });
    const base = {
      boost: { title: 10, year: 3 },
      prefix: true,
      boostTerm: (term: string) => (typed.has(term) ? 1 : 0.5),
      boostDocument: (id: string) => 1 + 0.1 * (1 - Math.min(1, (this.order.get(id) ?? 0) / Math.max(1, this.count))),
    };
    if (tier === "strict") return index.search({ combineWith: "AND", queries: words.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 5 ? 0.2 : false) }).map((hit) => this.titles.get(hit.id)!);
    if (tier === "relaxed") return index.search({ combineWith: "AND", queries: words.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 4 ? 0.25 : false) }).map((hit) => this.titles.get(hit.id)!);
    const significant = words.filter((word) => !NOISE.has(word) && !COMMON.has(word) && word.length >= 2);
    if (significant.length === 0) return [];
    const need = Math.ceil(significant.length / 2);
    const wordOf = new Map<string, number>();
    significant.forEach((word, at) => spellings(word).forEach((spelling) => wordOf.has(spelling) || wordOf.set(spelling, at)));
    return index
      .search({ combineWith: "OR", queries: significant.map(wordOrSwapped) }, { ...base, fuzzy: (term) => (term.length >= 5 ? 0.2 : false) })
      .filter((hit) => significant.length === 1 || new Set(hit.queryTerms.flatMap((term) => (wordOf.has(term) ? [wordOf.get(term)!] : []))).size >= need)
      .map((hit) => this.titles.get(hit.id)!);
  }

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

export function searchItems(items: readonly LibraryItem[], query: string): LibraryItem[] {
  return new TitleIndex(items).find(query, "strict");
}

function comparable(words: string): string[] {
  const list = words.split(" ").filter(Boolean);
  return list.length > 1 && (list[0] === "the" || list[0] === "a" || list[0] === "an") ? list.slice(1) : list;
}

function nearness(item: LibraryItem, typed: readonly string[]): number {
  const words = typed.filter((word) => word !== String(item.year));
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

export function rankByQuery(items: readonly LibraryItem[], query: string): LibraryItem[] {
  const words = comparable(normalizeQuery(query));
  if (words.length === 0) return [...items];
  return items
    .map((item, at) => ({ item, at, near: nearness(item, words) }))
    .sort((a, b) => a.near - b.near || a.at - b.at)
    .map(({ item }) => item);
}

const MAX_GUESSES = 6;

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
