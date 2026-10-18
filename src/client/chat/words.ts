import { useCallback } from "react";
import type { UiLanguage } from "../../shared";
import { CHAT_TEXT_MAX } from "../../shared/chat";
import { translate, useLanguage, type Key, type Params } from "../i18n";
import { chatEn } from "../i18n/chat.en";
import { chatIt } from "../i18n/chat.it";
import { chatRo } from "../i18n/chat.ro";
import type { ChatProblem } from "./state";

/*
 * The chat's words, until they are in the website's dictionaries (en.ts, ro.ts, it.ts spread chat.en.ts, chat.ro.ts and chat.it.ts into
 * themselves): then `Key` has them, `ChatWord` is `Key`, and this file is `useT` under another name.
 */
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type BaseKey<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : K;
export type ChatKey = BaseKey<Extract<keyof typeof chatEn, string>>;
export type ChatWord = ChatKey | Key;
export type ChatT = (key: ChatWord, params?: Params) => string;

const WORDS: Record<UiLanguage, Record<string, string>> = { en: chatEn, ro: chatRo, it: chatIt };
const english: Record<string, string> = chatEn;

/** The chat's own word for `key`, in `language`, or undefined when `key` is not one of them. Counted the way `translate` counts. */
function own(language: UiLanguage, key: string, params: Params | undefined): string | undefined {
  if (!(key in english) && !(`${key}_other` in english)) return undefined;
  const words = WORDS[language];
  let text: string | undefined;
  if (typeof params?.count === "number") {
    const form = new Intl.PluralRules(language).select(params.count);
    text = words[`${key}_${form}`] ?? words[`${key}_other`] ?? english[`${key}_${form}`] ?? english[`${key}_other`];
  }
  text ??= words[key] ?? english[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;
}

/** A word of the chat, or of the rest of the website, in `language`. */
export const chatWord = (language: UiLanguage, key: ChatWord, params?: Params): string => own(language, key, params) ?? translate(language, key as Key, params);

/** `t` for the chat's views: shows again when the language changes. */
export function useChatT(): ChatT {
  const language = useLanguage();
  return useCallback((key, params) => chatWord(language, key, params), [language]);
}

/** What to say of something that went wrong, quietly, in the words of the person. `report`: it went wrong while a report was made, where "gone" means there is nothing to send. */
export function problemText(t: ChatT, problem: ChatProblem, name: string, report = false): string {
  switch (problem) {
    case "offline":
      return t("error.offline");
    case "rate_limited":
      return t("chat.error.rate_limited");
    case "chat_off":
      return t("chat.error.chat_off", { name });
    case "friends_off":
      return t("error.friends_off");
    case "not_friends":
      return t("error.not_friends");
    case "too_long":
      return t("chat.error.too_long", { max: CHAT_TEXT_MAX });
    case "empty":
      return t("chat.error.empty");
    case "gone":
      return t(report ? "chat.reportNone" : "chat.error.gone");
    case "changed":
      return t("chat.reportChanged");
    default:
      return t("error.generic");
  }
}
