import { useEffect, useState } from "react";
import { AGE_COUNTRIES, TitleAboutAnswerSchema, titleLink, type LibraryItem, type TitleAbout, type UiLanguage } from "../../shared";

const learned = new Map<string, TitleAbout>();

export function useAbout(link: string | undefined): TitleAbout | null | undefined {
  const key = link === undefined ? undefined : titleLink(link);
  const [answer, setAnswer] = useState<{ key: string; about: TitleAbout | null }>();

  useEffect(() => {
    if (key === undefined || link === undefined || learned.has(key)) return;
    let live = true;
    fetch(`/api/library/about?url=${encodeURIComponent(link)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => {
        const parsed = TitleAboutAnswerSchema.safeParse(body);
        const about = parsed.success ? parsed.data.about : null;
        if (about) learned.set(key, about);
        if (live) setAnswer({ key, about });
      })
      .catch(() => live && setAnswer({ key, about: null }));
    return () => {
      live = false;
    };
  }, [key, link]);

  if (key === undefined) return null;
  return learned.get(key) ?? (answer?.key === key ? answer.about : undefined);
}

const HOME_COUNTRY: Record<UiLanguage, string> = { en: "US", ro: "RO", it: "IT" };

export function ageOf(ages: TitleAbout["ages"], language: UiLanguage): { country: string; rating: string } | undefined {
  for (const country of [HOME_COUNTRY[language], "US", "GB", ...AGE_COUNTRIES]) {
    const rating = ages[country];
    if (rating) return { country, rating };
  }
  return undefined;
}

export interface AboutRow {
  id: "parts" | "similar";
  items: LibraryItem[];
}

export function aboutRows(about: TitleAbout | null | undefined): AboutRow[] {
  if (!about) return [];
  const rows: AboutRow[] = [
    { id: "parts", items: about.parts },
    { id: "similar", items: about.similar },
  ];
  return rows.filter((row) => row.items.length > 0);
}
