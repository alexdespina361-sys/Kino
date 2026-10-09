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
