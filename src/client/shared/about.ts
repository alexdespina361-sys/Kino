import { useEffect, useState } from "react";
import { AGE_COUNTRIES, TitleAboutAnswerSchema, titleLink, type LibraryItem, type TitleAbout, type UiLanguage } from "../../shared";

/**
 * What the movie database knows of a title besides its tile (genres, who made it, the cast, the age rating, the other parts of its collection, titles like it),
 * for the title's own page on the TV and on the phone. The server is asked when a page opens, once for each title that is opened and never for one that is not.
 */

/** What was learned of each title, for as long as the page is open. Only an answer is kept: none may be a place that could not be reached just then, and the title is asked about again the next time its page opens. */
const learned = new Map<string, TitleAbout>();

/**
 * The answer about the title a link plays: `undefined` while it is being asked for, and `null` when nothing is known of it (a title of a place that has no such
 * thing, a title nobody knows, a place that could not be reached): the page is then as it was. No link, no question.
 */
export function useAbout(link: string | undefined): TitleAbout | null | undefined {
  const key = link === undefined ? undefined : titleLink(link); // (every episode of a show is one title)
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

/** The country whose age ratings a reader of each language knows best. */
const HOME_COUNTRY: Record<UiLanguage, string> = { en: "US", ro: "RO", it: "IT" };

/** The age rating to show a reader: their own country's when the title has one, else the US's, else Britain's, else whichever country there is. */
export function ageOf(ages: TitleAbout["ages"], language: UiLanguage): { country: string; rating: string } | undefined {
  for (const country of [HOME_COUNTRY[language], "US", "GB", ...AGE_COUNTRIES]) {
    const rating = ages[country];
    if (rating) return { country, rating };
  }
  return undefined;
}

/** A row of titles a page lists under what it is about. */
export interface AboutRow {
  id: "parts" | "similar";
  items: LibraryItem[];
}

/** The rows of a title's page after its episodes, in the order they are walked: the other parts of its collection, then titles like it. A row with no title is not one. */
export function aboutRows(about: TitleAbout | null | undefined): AboutRow[] {
  if (!about) return [];
  const rows: AboutRow[] = [
    { id: "parts", items: about.parts },
    { id: "similar", items: about.similar },
  ];
  return rows.filter((row) => row.items.length > 0);
}
