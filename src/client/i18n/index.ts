import { useSyncExternalStore } from "react";
import { UI_LANGUAGES, type UiLanguage } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";
import { en, type Dictionary } from "./en";

export type { Dictionary };

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type BaseKey<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : K;
export type Key = BaseKey<Extract<keyof typeof en, string>>;
export type Params = Record<string, string | number>;

export const DICTIONARIES: Partial<Record<UiLanguage, Dictionary>> & { en: Dictionary } = { en };
const LOADERS: Record<Exclude<UiLanguage, "en">, () => Promise<Dictionary>> = {
  ro: () => import("./ro").then((module) => module.ro),
  it: () => import("./it").then((module) => module.it),
};
const loading = new Map<UiLanguage, Promise<boolean>>();

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

export const hasKey = (key: string): key is Key => key in en || `${key}_other` in en;

export const LANGUAGE_KEY = "kino.lang";
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: "English", ro: "Română", it: "Italiano" };

export function detectLanguage(stored: string | undefined, browser: readonly string[]): UiLanguage {
  const known = (code: string | undefined): UiLanguage | undefined => UI_LANGUAGES.find((language) => language === code?.toLowerCase().slice(0, 2));
  return known(stored) ?? browser.map(known).find(Boolean) ?? "en";
}

export const screenLanguage = (): UiLanguage => detectLanguage(readStorage(LANGUAGE_KEY), typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));

let wanted: UiLanguage = screenLanguage();
let current: UiLanguage = DICTIONARIES[wanted] ? wanted : "en";
const listeners = new Set<() => void>();
const announce = () => {
  if (typeof document !== "undefined") document.documentElement.lang = current;
};
announce();

export const getLanguage = () => current;

export function setLanguage(language: UiLanguage, remember = true): void {
  if (language === wanted && language === current) return;
  wanted = language;
  if (remember) writeStorage(LANGUAGE_KEY, language);
  if (DICTIONARIES[language]) return show(language);
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

export const languageReady: Promise<void> = current === wanted ? Promise.resolve() : loadLanguage(wanted).then((here) => void (here && show(wanted)));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useLanguage = (): UiLanguage => useSyncExternalStore(subscribe, getLanguage, getLanguage);

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

export function rowKey(row: { id: string }): string | null {
  const own = /^(?:filmpire|archive)-(.+)$/.exec(row.id);
  return own ? `category.${own[1]}` : null;
}

export function rowTitle(row: { id: string; title: string }, language: UiLanguage = current): string {
  const key = rowKey(row);
  return key && hasKey(key) ? translate(language, key) : row.title;
}
