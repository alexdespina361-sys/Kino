import { useEffect, useSyncExternalStore } from "react";
import { isNameLanguage, nameIdOf, NAMES_AT_ONCE, NamesAnswerSchema, type LocalName, type NameLanguage } from "../../shared";
import { getLanguage, useLanguage } from "../i18n";
import { readStorage, writeStorage } from "./format";

export interface Named {
  id?: string | undefined;
  url?: string | undefined;
  title: string;
  description?: string | undefined;
}

const GATHER_MS = 60;
const QUESTIONS_AT_ONCE = 2;
const AGAIN_MS = 30_000;
const TRIES = 3;
export const NAMES_ON_DEVICE = 4000;
const storageKey = (lang: NameLanguage) => `kino.names.${lang}`;

interface Book {
  said: Map<string, LocalName>;
  device: Map<string, string>;
  queue: Set<string>;
  tries: Map<string, number>;
  out: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  saving: ReturnType<typeof setTimeout> | undefined;
}

const books = new Map<NameLanguage, Book>();
const listeners = new Set<() => void>();
let version = 0;
const tell = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

type Asker = (lang: NameLanguage, ids: readonly string[]) => Promise<Record<string, LocalName> | null>;
const askServer: Asker = async (lang, ids) => {
  try {
    const res = await fetch(`/api/library/names?lang=${lang}&ids=${ids.join(",")}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const parsed = NamesAnswerSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.names : null;
  } catch {
    return null;
  }
};
let asker: Asker = askServer;

function bookOf(lang: NameLanguage): Book {
  let book = books.get(lang);
  if (book) return book;
  const device = new Map<string, string>();
  try {
    const kept = JSON.parse(readStorage(storageKey(lang)) ?? "{}") as unknown;
    if (kept && typeof kept === "object") for (const [id, name] of Object.entries(kept)) if (typeof name === "string") device.set(id, name.slice(0, 300));
  } catch {
  }
  book = { said: new Map(), device, queue: new Set(), tries: new Map(), out: 0, timer: undefined, saving: undefined };
  books.set(lang, book);
  return book;
}

function save(lang: NameLanguage, book: Book): void {
  if (book.saving) return;
  book.saving = setTimeout(() => {
    book.saving = undefined;
    const newest = [...book.device].slice(-NAMES_ON_DEVICE);
    writeStorage(storageKey(lang), JSON.stringify(Object.fromEntries(newest)));
  }, 2000);
}

function send(lang: NameLanguage, book: Book): void {
  book.timer = undefined;
  while (book.out < QUESTIONS_AT_ONCE && book.queue.size > 0) {
    const ids = [...book.queue].slice(0, NAMES_AT_ONCE).sort();
    for (const id of ids) book.queue.delete(id);
    book.out += 1;
    void asker(lang, ids).then((names) => {
      book.out -= 1;
      let changed = false;
      for (const id of ids) {
        const name = names?.[id];
        if (!name) {
          const tried = (book.tries.get(id) ?? 0) + 1;
          book.tries.set(id, tried);
          if (tried < TRIES) setTimeout(() => want(lang, book, id), AGAIN_MS * tried);
          continue;
        }
        const before = book.said.get(id) ?? (book.device.has(id) ? { title: book.device.get(id) } : undefined);
        book.said.set(id, name);
        book.device.delete(id);
        book.device.set(id, name.title ?? "");
        if (!before || (before.title ?? "") !== (name.title ?? "") || name.description) changed = true;
      }
      if (changed) {
        save(lang, book);
        tell();
      }
      if (book.queue.size > 0) send(lang, book);
    });
  }
}

function want(lang: NameLanguage, book: Book, id: string): void {
  if (book.said.has(id) || book.queue.has(id)) return;
  book.queue.add(id);
  book.timer ??= setTimeout(() => send(lang, book), GATHER_MS);
}

export const wantName = (lang: NameLanguage, id: string): void => want(lang, bookOf(lang), id);

export function shownIn(item: Named, lang: string): { title: string; description: string | undefined } {
  const id = isNameLanguage(lang) ? nameIdOf(item) : null;
  if (!id || !isNameLanguage(lang)) return { title: item.title, description: item.description };
  const book = bookOf(lang);
  const said = book.said.get(id);
  return { title: (said ? said.title : book.device.get(id)) || item.title, description: said?.description || item.description };
}

export const shownTitle = (item: Named): string => shownIn(item, getLanguage()).title;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const getVersion = () => version;

export function useShown(item: Named | null | undefined): { title: string; description: string | undefined } {
  const lang = useLanguage();
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const id = item && isNameLanguage(lang) ? nameIdOf(item) : null;
  useEffect(() => {
    if (id && isNameLanguage(lang)) wantName(lang, id);
  }, [id, lang]);
  return item ? shownIn(item, lang) : { title: "", description: undefined };
}

export function resetNames(ask: Asker = askServer): void {
  for (const book of books.values()) {
    clearTimeout(book.timer);
    clearTimeout(book.saving);
  }
  books.clear();
  asker = ask;
  version = 0;
}
