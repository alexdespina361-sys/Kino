import type { LibraryItem, LibraryRow } from "../../shared";

/** Titles already on screen that contain what was typed: instant, before the server is asked. Each title once, in row order. */
export function matchLocal(rows: readonly LibraryRow[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const found: LibraryItem[] = [];
  for (const row of rows) {
    for (const item of row.items) {
      if (!seen.has(item.id) && item.title.toLowerCase().includes(q)) {
        seen.add(item.id);
        found.push(item);
      }
    }
  }
  return found;
}

/** What was matched on screen, then what the server found beyond it, each title once. */
export function mergeItems(first: readonly LibraryItem[], more: readonly LibraryItem[]): LibraryItem[] {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...more.filter((item) => !seen.has(item.id) && seen.add(item.id))];
}

/** The letters, then the digits: six keys to a row, which is what the TV's keyboard is laid out in. */
export const KEYBOARD_KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
export const KEYBOARD_COLUMNS = 6;
/** The keyboard's rows, then the row of the two wide keys. */
export const KEYBOARD_SHAPE = [...Array.from({ length: KEYBOARD_KEYS.length / KEYBOARD_COLUMNS }, () => KEYBOARD_COLUMNS), 2];

/** What a physical key adds to the search box, if anything (`null`: not a character for it). */
export function typedCharacter(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): string | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  return /^[a-zA-Z0-9]$/.test(event.key) ? event.key.toLowerCase() : event.key === " " ? " " : null;
}

/** The box's text after a key: no leading space, no double spaces, and not longer than a title could be. */
export function appendTo(text: string, char: string): string {
  if (char === " " && (text === "" || text.endsWith(" "))) return text;
  return (text + char).slice(0, 60);
}
