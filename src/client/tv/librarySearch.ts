import { itemsOf, rankByQuery, searchItems, type LibraryItem, type LibraryRow } from "../../shared";

/** Titles already on screen that match what was typed (a slip of a letter or an unfinished word included), best first: instant, before the server is asked. Each title once. */
export function matchLocal(rows: readonly LibraryRow[], query: string): LibraryItem[] {
  return rankByQuery(searchItems(itemsOf(rows), query), query);
}

/** What is shown, as far as it still matches the words as they are now: while the server is asked again, the list does not empty and fill up with every letter. */
export function keepMatching(shown: readonly LibraryItem[], query: string): LibraryItem[] {
  return searchItems(shown, query);
}

/** What was matched on screen, then what the server found beyond it, each title once. */
export function mergeItems(first: readonly LibraryItem[], more: readonly LibraryItem[]): LibraryItem[] {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...more.filter((item) => !seen.has(item.id) && seen.add(item.id))];
}

/** What was found on screen and what the server found, each title once, the likeliest to be what was typed first. */
export function mergeAnswers(first: readonly LibraryItem[], more: readonly LibraryItem[], query: string): LibraryItem[] {
  return rankByQuery(mergeItems(first, more), query);
}

/** The letters, then the digits: six keys to a row, which is what the TV's keyboard is laid out in. */
export const KEYBOARD_KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
export const KEYBOARD_COLUMNS = 6;
/** The keyboard's rows, then the row of the three wide keys (Space, Delete, Clear). */
export const KEYBOARD_SHAPE = [...Array.from({ length: KEYBOARD_KEYS.length / KEYBOARD_COLUMNS }, () => KEYBOARD_COLUMNS), 3];

/** What a physical key adds to the search box, if anything (`null`: not a character for it). */
export function typedCharacter(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): string | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  return /^[a-zA-Z0-9]$/.test(event.key) ? event.key.toLowerCase() : event.key === " " ? " " : null;
}

/** The box's text after a key: no leading space, no double spaces, and not longer than a title could be (or than `max`). */
export function appendTo(text: string, char: string, max = 60): string {
  if (char === " " && (text === "" || text.endsWith(" "))) return text;
  return (text + char).slice(0, max);
}
