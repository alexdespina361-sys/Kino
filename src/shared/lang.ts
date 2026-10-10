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

const displayNames = new Map<string, Intl.DisplayNames | null>();
/** One namer per language of the reader, made when first asked for; null in an environment without `Intl.DisplayNames`. */
function namer(locale: string): Intl.DisplayNames | null {
  let names = displayNames.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      names = null; // labels stay as the source wrote them
    }
    displayNames.set(locale, names);
  }
  return names;
}

/**
 * "ro" / "ron" / "pt-BR" -> "Romanian" / "Romanian" / "Brazilian Portuguese" (or "Română" for a Romanian reader, with `locale`);
 * undefined when the code is not one we can name.
 */
export function languageName(code: string | undefined, locale = "en"): string | undefined {
  const trimmed = code?.trim().replace("_", "-");
  const base = normalizeLang(trimmed);
  const names = namer(locale);
  if (!base || !names) return undefined;
  try {
    const region = trimmed?.split("-")[1];
    const name = names.of(region && /^[a-z]{2}$/i.test(region) ? `${base}-${region.toUpperCase()}` : base);
    return name && name.toLowerCase() !== base ? name.replace(/^./u, (first) => first.toLocaleUpperCase(locale)) : undefined; // Romanian and Italian write language names in lower case; a menu starts them with a capital
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

/**
 * A track's label in the language of the page: a label that only names the language of the track ("English") is said in the
 * reader's language ("Engleză"); anything with more to it (a release name, "Commentary") stays as the file wrote it.
 */
export function localTrackLabel(track: { label: string; lang?: string | undefined }, locale: string): string {
  const english = languageName(track.lang);
  if (english && track.label.trim().toLowerCase() === english.toLowerCase()) return languageName(track.lang, locale) ?? track.label;
  return track.label;
}
