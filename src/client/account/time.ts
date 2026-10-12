/** "12 Oct 2026": the day something happened, in the language of the site (whose English is spelt the British way, so the day comes first). */
export function formatDay(at: number, language: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Date(at).toLocaleDateString(language === "en" ? "en-GB" : language, options);
  } catch {
    return new Date(at).toLocaleDateString("en-GB", options);
  }
}

/** "now", "5 minutes ago", "yesterday": how long ago something was, in the language of the site. */
export function ago(then: number, now: number, language: string): string {
  const seconds = Math.round((then - now) / 1000); // negative: in the past
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  } catch {
    format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "second");
}
