/**
 * The subtitle languages a profile wants listed first in the subtitle menus, in its order (the setting `subtitleLanguages`). Chosen on the phone's
 * settings and on the TV's (the owner, 15 Nov 2026: "allow subtitle picking on tv/pc too not just phone"); the rules are here so that both keep the
 * same list. Pure, so it can be tested without a screen.
 */

/** Subtitle languages people choose from, besides the ones the site is written in. */
export const COMMON_LANGUAGES = ["en", "ro", "it", "es", "fr", "de", "pt", "hu", "bg", "el", "tr", "pl", "nl", "ru", "uk", "ar", "he", "sv", "cs", "hr", "sr", "sq", "hi", "zh", "ja", "ko"] as const;

/** How many can be chosen (what the setting holds, shared/account.ts). */
export const MAX_SUBTITLE_LANGUAGES = 12;

/** The list as it is kept: none chosen is no setting at all, so that the defaults (which follow the site's language) apply again. */
export const keptLanguages = (list: readonly string[]): string[] | undefined => (list.length > 0 ? [...list] : undefined);

/** A language pressed where every language is a button (the TV's page): added at the end when it is not chosen and there is room, taken out when it is. */
export function toggleLanguage(chosen: readonly string[], code: string): string[] {
  if (chosen.includes(code)) return chosen.filter((other) => other !== code);
  return chosen.length < MAX_SUBTITLE_LANGUAGES ? [...chosen, code] : [...chosen];
}

/** One of the chosen moved `by` places (the phone's arrows); one that would leave the list stays where it is. */
export function moveLanguage(chosen: readonly string[], index: number, by: number): string[] {
  const to = index + by;
  if (index < 0 || index >= chosen.length || to < 0 || to >= chosen.length) return [...chosen];
  const list = [...chosen];
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item!);
  return list;
}

/** Every language there is to press, in one order that never changes as some are chosen: the common ones, then any chosen that is not among them. */
export function pickableLanguages(chosen: readonly string[]): string[] {
  const common: readonly string[] = COMMON_LANGUAGES;
  return [...common, ...chosen.filter((code) => !common.includes(code))];
}

/** The languages' names in the site's language (the browser's own names for them), or the code in capitals where it has none. */
export function languageNamer(uiLanguage: string): (code: string) => string {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([uiLanguage], { type: "language" });
  } catch {
    names = undefined;
  }
  return (code) => {
    try {
      return names?.of(code) ?? code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  };
}
