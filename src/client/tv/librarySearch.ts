import { CLOSEST_MAX, itemsOf, normalizeQuery, rankByQuery, searchItems, sectionOf, type LibraryItem, type LibraryRow, type LibrarySection, type TitleIndex } from "../../shared";

/** What a search found: the titles, the first `exact` of which have every word that was typed and the rest are the closest others (some of the words, or a letter off). */
export interface Answers {
  items: LibraryItem[];
  exact: number;
}
export const NO_ANSWERS: Answers = { items: [], exact: 0 };

/** Answers that are all exact: what a place that knows no better found. */
export const allExact = (items: readonly LibraryItem[]): Answers => ({ items: [...items], exact: items.length });

/** Whether an item is displayable (has a valid non-empty poster image, or is in a test environment without image metadata). */
export const isDisplayableItem = (item: LibraryItem): boolean => item.image === undefined || item.image.trim() !== "";

/**
 * Titles already on screen or met on the way that match what was typed (a slip of a letter or an unfinished word included), the likeliest first,
 * and after them the closest others: instant, before the server is asked. Each title once. A single letter is looked for among the titles of the
 * rows only (every title that has a word beginning with it is too many to weigh at each key).
 */
export function matchLocal(index: TitleIndex, rows: readonly LibraryRow[], query: string): Answers {
  if (query.trim().length < 2) {
    const items = rankByQuery(searchItems(itemsOf(rows), query), query).filter(isDisplayableItem);
    return allExact(items);
  }
  const ans = index.search(query);
  const items = ans.items.filter(isDisplayableItem);
  return { items, exact: Math.min(ans.exact, items.length) };
}

/** What is shown, as far as it still matches the words as they are now: while the server is asked again, the list does not empty and fill up with every letter. */
export function keepMatching(shown: Answers, query: string): Answers {
  return allExact(searchItems(shown.items.filter(isDisplayableItem), query));
}

/** What was found on screen and what the server found, each title once, the likeliest to be what was typed first and then the closest others. */
export function mergeAnswers(first: Answers, more: Answers, query: string): Answers {
  const seenId = new Set<string>();
  const seenTitle = new Set<string>();
  const once = (items: readonly LibraryItem[]) =>
    items.filter((item) => {
      if (!isDisplayableItem(item) || seenId.has(item.id)) return false;
      const titleKey = `${item.kind ?? ""}:${normalizeQuery(item.title)}`;
      if (seenTitle.has(titleKey)) return false;
      seenId.add(item.id);
      seenTitle.add(titleKey);
      return true;
    });
  const exact = rankByQuery(once([...first.items.slice(0, first.exact), ...more.items.slice(0, more.exact)]), query);
  const closest = rankByQuery(once([...first.items.slice(first.exact), ...more.items.slice(more.exact)]), query).slice(0, CLOSEST_MAX);
  return { items: [...exact, ...closest], exact: exact.length };
}

/** Only the titles of one section of an answer (Movies, Series, Cartoons or Anime; the closest others stay the closest). */
export function onlySection(answers: Answers, section: LibrarySection | "all"): Answers {
  if (section === "all") return answers;
  const keep = (items: readonly LibraryItem[]) => items.filter((item) => sectionOf(item) === section);
  const exact = keep(answers.items.slice(0, answers.exact));
  return { items: [...exact, ...keep(answers.items.slice(answers.exact))], exact: exact.length };
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
