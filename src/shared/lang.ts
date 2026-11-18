const THREE_TO_TWO: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", deu: "de", ger: "de", ita: "it", por: "pt", pob: "pt",
  ron: "ro", rum: "ro", rus: "ru", ara: "ar", tur: "tr", pol: "pl", nld: "nl", dut: "nl", alb: "sq",
  sqi: "sq", gre: "el", ell: "el", hun: "hu", cze: "cs", ces: "cs", srp: "sr", scc: "sr", hrv: "hr",
  bul: "bg", heb: "he", hin: "hi", chi: "zh", zho: "zh", jpn: "ja", kor: "ko", swe: "sv", nor: "no",
  dan: "da", fin: "fi", ukr: "uk", ind: "id", vie: "vi", tha: "th",
};

const WORD_TO_TWO: Record<string, string> = {
  english: "en",
  romanian: "ro",
  romana: "ro",
  "română": "ro",
  spanish: "es",
  "español": "es",
  french: "fr",
  "français": "fr",
  german: "de",
  deutsch: "de",
  italian: "it",
  italiano: "it",
  portuguese: "pt",
  "português": "pt",
  russian: "ru",
  "русский": "ru",
  japanese: "ja",
  chinese: "zh",
  "中文": "zh",
  korean: "ko",
  arabic: "ar",
  turkish: "tr",
  "türkçe": "tr",
  polish: "pl",
  vietnamese: "vi",
  "tiếng việt": "vi",
  indonesian: "id",
};

export function normalizeLang(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const raw = code.trim().toLowerCase();
  if (WORD_TO_TWO[raw]) return WORD_TO_TWO[raw];
  const base = raw.split(/[-_]/)[0];
  if (!base) return undefined;
  return WORD_TO_TWO[base] ?? THREE_TO_TWO[base] ?? base;
}

const displayNames = new Map<string, Intl.DisplayNames | null>();
function namer(locale: string): Intl.DisplayNames | null {
  let names = displayNames.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      names = null;
    }
    displayNames.set(locale, names);
  }
  return names;
}

export function languageName(code: string | undefined, locale = "en"): string | undefined {
  const trimmed = code?.trim().replace("_", "-");
  const base = normalizeLang(trimmed);
  const names = namer(locale);
  if (!base || !names) return undefined;
  try {
    const region = trimmed?.split("-")[1];
    const name = names.of(region && /^[a-z]{2}$/i.test(region) ? `${base}-${region.toUpperCase()}` : base);
    return name && name.toLowerCase() !== base ? name.replace(/^./u, (first) => first.toLocaleUpperCase(locale)) : undefined;
  } catch {
    return undefined;
  }
}

const GENERIC = /^(?:track|audio|subtitles?|text|sub|unknown|und)?\s*\d*$/i;
const isLanguageCode = (label: string) => /^[a-z]{2,3}(?:[-_][a-z0-9]{2,4})?$/i.test(label) && normalizeLang(label)?.length === 2;

export function trackLabel(label: string | undefined, lang: string | undefined, fallback: string): string {
  const own = label?.trim() ?? "";
  if (GENERIC.test(own)) return languageName(lang) ?? (own || fallback);
  return (isLanguageCode(own) ? languageName(own) : undefined) ?? own;
}

export function localTrackLabel(track: { label: string; lang?: string | undefined }, locale: string): string {
  const english = languageName(track.lang);
  if (english && track.label.trim().toLowerCase() === english.toLowerCase()) return languageName(track.lang, locale) ?? track.label;
  return track.label;
}
