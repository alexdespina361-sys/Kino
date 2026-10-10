import { useSyncExternalStore } from "react";
import { UI_LANGUAGES, type UiLanguage } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";
import { en, type Dictionary } from "./en";
import { it } from "./it";
import { ro } from "./ro";

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

export const DICTIONARIES: Record<UiLanguage, Dictionary> = { en, ro, it };

/** Whether `key` is one of the words (a server's error code, say, may be one nobody wrote a sentence for). */
export const hasKey = (key: string): key is Key => key in en || `${key}_other` in en;

export const LANGUAGE_KEY = "kino.lang";
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: "English", ro: "Română", it: "Italiano" };

/** The language of the person: what they chose on this device, else what the browser says, else English. */
export function detectLanguage(stored: string | undefined, browser: readonly string[]): UiLanguage {
  const known = (code: string | undefined): UiLanguage | undefined => UI_LANGUAGES.find((language) => language === code?.toLowerCase().slice(0, 2));
  return known(stored) ?? browser.map(known).find(Boolean) ?? "en";
}

let current: UiLanguage = detectLanguage(readStorage(LANGUAGE_KEY), typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]));
const listeners = new Set<() => void>();
const announce = () => {
  if (typeof document !== "undefined") document.documentElement.lang = current;
};
announce();

export const getLanguage = () => current;

/** Change the language of everything on screen. `remember: false` follows a profile's choice without making it this device's. */
export function setLanguage(language: UiLanguage, remember = true): void {
  if (language === current) return;
  current = language;
  if (remember) writeStorage(LANGUAGE_KEY, language);
  announce();
  listeners.forEach((listener) => listener());
}

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
  const dictionary = DICTIONARIES[language] as Record<string, string>;
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
