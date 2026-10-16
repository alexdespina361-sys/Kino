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
/** The keyboard's rows, then the row under them: the two keys that move the caret (one column each), Space (two), Delete and Clear (one each). */
export const KEYBOARD_SHAPE = [...Array.from({ length: KEYBOARD_KEYS.length / KEYBOARD_COLUMNS }, () => KEYBOARD_COLUMNS), 5];

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

/** The search box: what was typed, and where the caret stands in it (0 is before the first character, the length is after the last). */
export interface SearchBox {
  text: string;
  caret: number;
}

/** What can be done to the box: type a character at the caret, take the one before it (Backspace) or the one after it (Delete), move the caret, or empty the box. */
export type BoxEdit =
  | { kind: "type"; char: string }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "move"; to: "left" | "right" | "start" | "end" | number }
  | { kind: "clear" };

/** Does a pair of UTF-16 units that make one character (an emoji typed on a narrow screen's own keyboard) start at `at`? */
const startsPair = (text: string, at: number) => at + 1 < text.length && (text.charCodeAt(at) & 0xfc00) === 0xd800 && (text.charCodeAt(at + 1) & 0xfc00) === 0xdc00;

/** A place in the text, off the middle of a pair (back to where it starts) and never off the text. */
function snap(text: string, at: number): number {
  const to = Math.max(0, Math.min(at, text.length));
  return to > 0 && startsPair(text, to - 1) ? to - 1 : to;
}

/** The place one character before `caret`, and the one after it: a pair counts as one, so a key never cuts an emoji in half. */
const stepBack = (text: string, caret: number) => (caret <= 0 ? 0 : startsPair(text, caret - 2) ? caret - 2 : caret - 1);
const stepOn = (text: string, caret: number) => (caret >= text.length ? text.length : startsPair(text, caret) ? caret + 2 : caret + 1);

/** The text without a leading space or a double one (a letter taken out from between two spaces leaves two), the caret keeping its place among the characters that are left. */
function tidy(text: string, caret: number): SearchBox {
  let kept = "";
  let at = caret;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (kept === "" || kept.endsWith(" "))) {
      if (i < caret) at--;
      continue;
    }
    kept += text[i];
  }
  return { text: kept, caret: Math.max(0, Math.min(at, kept.length)) };
}

/**
 * The box after an edit. The text stays what `appendTo` keeps it (no leading or double spaces, not longer than `max`), but a character
 * goes in where the caret is and not only at the end, so a slip in the middle of a title is mended without typing it all again.
 */
export function editBox(box: SearchBox, edit: BoxEdit, max = 60): SearchBox {
  const { text } = box;
  const caret = snap(text, box.caret);
  switch (edit.kind) {
    case "type":
      if (text.length >= max) return { text, caret };
      if (edit.char === " " && (caret === 0 || text[caret - 1] === " " || text[caret] === " ")) return { text, caret };
      return { text: text.slice(0, caret) + edit.char + text.slice(caret), caret: caret + edit.char.length };
    case "backspace":
      return caret === 0 ? { text, caret } : tidy(text.slice(0, stepBack(text, caret)) + text.slice(caret), stepBack(text, caret));
    case "delete":
      return caret === text.length ? { text, caret } : tidy(text.slice(0, caret) + text.slice(stepOn(text, caret)), caret);
    case "move": {
      const to = edit.to === "left" ? stepBack(text, caret) : edit.to === "right" ? stepOn(text, caret) : edit.to === "start" ? 0 : edit.to === "end" ? text.length : edit.to;
      return { text, caret: snap(text, to) };
    }
    case "clear":
      return { text: "", caret: 0 };
  }
}
