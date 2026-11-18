export function formatDay(at: number, language: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Date(at).toLocaleDateString(language === "en" ? "en-GB" : language, options);
  } catch {
    return new Date(at).toLocaleDateString("en-GB", options);
  }
}

export function ago(then: number, now: number, language: string): string {
  const seconds = Math.round((then - now) / 1000);
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

const localeOf = (language: string): string => (language === "en" ? "en-GB" : language);
const startOfDay = (at: number): number => new Date(at).setHours(0, 0, 0, 0);

export function dayWord(at: number, now: number, language: string): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  const dated: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const locale = localeOf(language);
  try {
    if (days >= -1 && days <= 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
    return new Date(at).toLocaleDateString(locale, days > 1 && days < 7 ? { weekday: "long" } : dated);
  } catch {
    return new Date(at).toLocaleDateString("en-GB", dated);
  }
}

export function dayChip(at: number, now: number, language: string): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (days === 0 || days === 1) {
    const word = dayWord(at, now, language);
    return word.charAt(0).toLocaleUpperCase(localeOf(language)) + word.slice(1);
  }
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric" };
  try {
    return new Date(at).toLocaleDateString(localeOf(language), options);
  } catch {
    return new Date(at).toLocaleDateString("en-GB", options);
  }
}

export function clockTime(at: number, language: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    return new Date(at).toLocaleTimeString(localeOf(language), options);
  } catch {
    return new Date(at).toLocaleTimeString("en-GB", options);
  }
}
