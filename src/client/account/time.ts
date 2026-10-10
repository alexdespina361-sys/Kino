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
