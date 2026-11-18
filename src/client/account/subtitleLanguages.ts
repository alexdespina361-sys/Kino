export const COMMON_LANGUAGES = ["en", "ro", "it", "es", "fr", "de", "pt", "hu", "bg", "el", "tr", "pl", "nl", "ru", "uk", "ar", "he", "sv", "cs", "hr", "sr", "sq", "hi", "zh", "ja", "ko"] as const;

export const MAX_SUBTITLE_LANGUAGES = 12;

export const keptLanguages = (list: readonly string[]): string[] | undefined => (list.length > 0 ? [...list] : undefined);

export function toggleLanguage(chosen: readonly string[], code: string): string[] {
  if (chosen.includes(code)) return chosen.filter((other) => other !== code);
  return chosen.length < MAX_SUBTITLE_LANGUAGES ? [...chosen, code] : [...chosen];
}

export function moveLanguage(chosen: readonly string[], index: number, by: number): string[] {
  const to = index + by;
  if (index < 0 || index >= chosen.length || to < 0 || to >= chosen.length) return [...chosen];
  const list = [...chosen];
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item!);
  return list;
}

export function pickableLanguages(chosen: readonly string[]): string[] {
  const common: readonly string[] = COMMON_LANGUAGES;
  return [...common, ...chosen.filter((code) => !common.includes(code))];
}

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
