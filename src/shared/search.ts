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

/**
 * The titles that have every word of the query, the best match first. A word may be unfinished, have its neighbouring letters
 * swapped (a word of three letters too, when another word of the query is longer: "teh office"), or (when it is long enough) be a
 * letter or two off. A number is a year, and is what it is. Exact words come before those, a word of the title before its year, then the
 * titles that came first (the popular ones, as the places list them).
 */
export function searchItems(items: readonly LibraryItem[], query: string): LibraryItem[] {
  const q = normalizeQuery(query);
  const byId = new Map<string, LibraryItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  if (!q || byId.size === 0) return [];

  const index = new MiniSearch<LibraryItem>({ fields: ["title", "joined", "year"], extractField: fieldOf });
  index.addAll([...byId.values()]);
  const place = new Map([...byId.keys()].map((id, at) => [id, at]));
  const words = q.split(" ");
  const typed = new Set(words);
  const held = words.length > 1 && words.some((word) => word.length >= 4); // (a short word alone is too little to go on)
  const wordOrSwapped = (word: string): Query => ({ combineWith: "OR", queries: [word, ...(word.length >= (held ? 3 : 4) && !isNumber(word) ? swaps(word) : [])] });
  return index
    .search(
      { combineWith: "AND", queries: words.map(wordOrSwapped) },
      {
        boost: { title: 10, year: 3 },
        prefix: true,
        fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
        boostTerm: (term) => (typed.has(term) ? 1 : 0.5),
        boostDocument: (id) => 1 + (byId.size - (place.get(id) ?? byId.size)) / (byId.size * 10),
      },
    )
    .map((hit) => byId.get(hit.id)!);
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
