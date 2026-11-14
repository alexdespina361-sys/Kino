import { useSyncExternalStore } from "react";
import { UI_LANGUAGES, type UiLanguage } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";
import { en, type Dictionary } from "./en";

export type { Dictionary };

/**
 * The words of the website, in English, Romanian and Italian. Every piece of text goes through `t("some.key")`: the English
 * dictionary (en.ts) is the list of keys, and the other two must have every one of them (the compiler checks).
 *
 * A key may have forms for a count: `x_one`, `x_few`, `x_other`; `t("x", { count })` picks the form the language uses for that
 * number (Romanian says "1 titlu", "3 titluri", "20 de titluri").
 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type BaseKey<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : K;
export type Key = BaseKey<Extract<keyof typeof en, string>>;
export type Params = Record<string, string | number>;

/**
 * The words that are here. English always is: it is the list of keys, and what a word that is missing falls back to. Romanian and Italian are a file each,
 * downloaded when one of them is the language asked for, so that nobody downloads two languages they do not read.
 */
export const DICTIONARIES: Partial<Record<UiLanguage, Dictionary>> & { en: Dictionary } = { en };
const LOADERS: Record<Exclude<UiLanguage, "en">, () => Promise<Dictionary>> = {
  ro: () => import("./ro").then((module) => module.ro),
  it: () => import("./it").then((module) => module.it),
};
const loading = new Map<UiLanguage, Promise<boolean>>();

/** Have the words of a language at hand. False when they could not be had (no connection for a moment): they are asked for again the next time. */
export function loadLanguage(language: UiLanguage): Promise<boolean> {
  if (language === "en" || DICTIONARIES[language]) return Promise.resolve(true);
  let pending = loading.get(language);
  if (!pending) {
    pending = LOADERS[language]()
      .then(
        (dictionary) => {
          DICTIONARIES[language] = dictionary;
          return true;
        },
        () => false,
      )
      .finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** Whether `key` is one of the words (a server's error code, say, may be one nobody wrote a sentence for). */
export const hasKey = (key: string): key is Key => key in en || `${key}_other` in en;

export const LANGUAGE_KEY = "kino.lang";
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: "English", ro: "Română", it: "Italiano" };

/** The language of the person: what they chose on this device, else what the browser says, else English. */
export function detectLanguage(stored: string | undefined, browser: readonly string[]): UiLanguage {
  const known = (code: string | undefined): UiLanguage | undefined => UI_LANGUAGES.find((language) => language === code?.toLowerCase().slice(0, 2));
  return known(stored) ?? browser.map(known).find(Boolean) ?? "en";
}

/** The language of this screen when no profile says otherwise: what was chosen on it, else what its browser says. */
export const screenLanguage = (): UiLanguage => detectLanguage(readStorage(LANGUAGE_KEY), typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));

/** The language asked for, and the one on screen, which follows it as soon as its words are here (at once when they already are). */
let wanted: UiLanguage = screenLanguage();
let current: UiLanguage = DICTIONARIES[wanted] ? wanted : "en";
const listeners = new Set<() => void>();
const announce = () => {
  if (typeof document !== "undefined") document.documentElement.lang = current;
};
announce();

export const getLanguage = () => current;

/** Change the language of everything on screen. `remember: false` follows a profile's choice without making it this device's. */
export function setLanguage(language: UiLanguage, remember = true): void {
  if (language === wanted && language === current) return;
  wanted = language;
  if (remember) writeStorage(LANGUAGE_KEY, language);
  if (DICTIONARIES[language]) return show(language);
  // (Its words are on their way: the screen keeps the language it has until they are here, rather than show half of it in English.)
  void loadLanguage(language).then((here) => {
    if (here && wanted === language) show(language);
  });
}

function show(language: UiLanguage): void {
  if (language === current) return;
  current = language;
  announce();
  listeners.forEach((listener) => listener());
}

/** Done when the language this screen starts in is on it (or could not be had, and it starts in English): what the first drawing of the page waits for. */
export const languageReady: Promise<void> = current === wanted ? Promise.resolve() : loadLanguage(wanted).then((here) => void (here && show(wanted)));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The language, for a component that has to show again when it changes. */
export const useLanguage = (): UiLanguage => useSyncExternalStore(subscribe, getLanguage, getLanguage);

/** `t`, bound to the current language, re-rendering the component when the language changes. */
export function useT(): typeof t {
  useLanguage();
  return t;
}

const fill = (text: string, params: Params | undefined) => (params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text);

export function translate(language: UiLanguage, key: Key, params?: Params): string {
  const dictionary = (DICTIONARIES[language] ?? en) as Record<string, string>;
  const english = en as Record<string, string>;
  let text: string | undefined;
  if (typeof params?.count === "number") {
    const form = new Intl.PluralRules(language).select(params.count);
    text = dictionary[`${key}_${form}`] ?? dictionary[`${key}_other`] ?? english[`${key}_${form}`] ?? english[`${key}_other`];
  }
  text ??= dictionary[key] ?? english[key] ?? key;
  return fill(text, params);
}

export const t = (key: Key, params?: Params): string => translate(current, key, params);

/** The key of the name of a row of the library that this app lists itself (Filmpire's and the Internet Archive's), or null for any other. */
export function rowKey(row: { id: string }): string | null {
  const own = /^(?:filmpire|archive)-(.+)$/.exec(row.id);
  return own ? `category.${own[1]}` : null;
}

/** A row of the library as the person reads it: the places name their rows in English, so the ones this app knows are said in the language of the person, and any other keeps its own name. */
export function rowTitle(row: { id: string; title: string }, language: UiLanguage = current): string {
  const key = rowKey(row);
  return key && hasKey(key) ? translate(language, key) : row.title;
}
