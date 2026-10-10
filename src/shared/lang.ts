/** ISO 639-2 (three letters, as subtitle sources often use) -> ISO 639-1 (two letters). The ones people actually watch in. */
const THREE_TO_TWO: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", deu: "de", ger: "de", ita: "it", por: "pt", pob: "pt",
  ron: "ro", rum: "ro", rus: "ru", ara: "ar", tur: "tr", pol: "pl", nld: "nl", dut: "nl", alb: "sq",
  sqi: "sq", gre: "el", ell: "el", hun: "hu", cze: "cs", ces: "cs", srp: "sr", scc: "sr", hrv: "hr",
  bul: "bg", heb: "he", hin: "hi", chi: "zh", zho: "zh", jpn: "ja", kor: "ko", swe: "sv", nor: "no",
  dan: "da", fin: "fi", ukr: "uk", ind: "id", vie: "vi", tha: "th",
};

/** "eng", "en-US", "EN" and "pob" all become comparable codes: "en", "en", "en", "pt". */
export function normalizeLang(code: string | undefined): string | undefined {
  const base = code?.trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return undefined;
  return THREE_TO_TWO[base] ?? base;
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return undefined; // an environment without it: labels stay as the source wrote them
  }
})();

/** "ro" / "ron" / "pt-BR" -> "Romanian" / "Romanian" / "Brazilian Portuguese"; undefined when the code is not one we can name. */
export function languageName(code: string | undefined): string | undefined {
  const trimmed = code?.trim().replace("_", "-");
  const base = normalizeLang(trimmed);
  if (!base || !languageNames) return undefined;
  try {
    const region = trimmed?.split("-")[1];
    const name = languageNames.of(region && /^[a-z]{2}$/i.test(region) ? `${base}-${region.toUpperCase()}` : base);
    return name && name.toLowerCase() !== base ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A label that says nothing a person could use: nothing, a number, "Track 2", "und". */
const GENERIC = /^(?:track|audio|subtitles?|text|sub|unknown|und)?\s*\d*$/i;
/** Looks like a language code. Three letters count only when they are one we know ("eng"), so "SDH" stays "SDH". */
const isLanguageCode = (label: string) => /^[a-z]{2,3}(?:[-_][a-z0-9]{2,4})?$/i.test(label) && normalizeLang(label)?.length === 2;

/**
 * What to call an audio or subtitle track in a menu: the label the file gave it, unless that is only a code or a number,
 * and then the name of its language ("Romanian"). `fallback` is used when nothing else is known ("Subtitle 2").
 */
export function trackLabel(label: string | undefined, lang: string | undefined, fallback: string): string {
  const own = label?.trim() ?? "";
  if (GENERIC.test(own)) return languageName(lang) ?? (own || fallback);
  return (isLanguageCode(own) ? languageName(own) : undefined) ?? own;
}
