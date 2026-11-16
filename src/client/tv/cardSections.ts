import { useEffect, useMemo, useState } from "react";
import { LibrarySectionSchema, type LibraryRow, type LibrarySection, type LiveProgress } from "../../shared";
import { fetchTitle, titleIdOf } from "../shared/titleAddress";
import { cardsToLookUp } from "./pages";

/**
 * The sections of the titles of "Continue watching" that the rows loaded so far do not list (an anime found by a search, or watched from a page of its
 * row that is not loaded now): the page of a section asks the server once for each (`/api/library/title`, which asks TMDB), and this device remembers
 * the answer for good, as a title does not change section. Without it such a card went to Series or Movies, by its kind (the owner's report of 15 Nov:
 * anime in Series).
 */

const STORE = "kino.cardSections";
/** How many answers this device keeps (the newest). */
const KEEP = 400;
/** How many titles one look asks about at most (the cards are a few dozen at most; this is a guard, not a limit anybody meets). */
const PER_LOOK = 12;

function remembered(): Map<string, LibrarySection> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw).flatMap(([address, section]) => (LibrarySectionSchema.safeParse(section).success ? [[address, section as LibrarySection]] : [])));
  } catch {
    return new Map();
  }
}

function remember(known: ReadonlyMap<string, LibrarySection>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...known].slice(-KEEP))));
  } catch {
    // (A device that keeps nothing asks again on its next visit.)
  }
}

/** Titles asked about since the page loaded (one the server could not place is not asked about again until the next load). */
const asked = new Set<string>();

/** What the server said of the cards' titles, growing as answers come; `on` only on the page of a section (Home shows every card). */
export function useCardSections(progress: readonly LiveProgress[], rows: readonly LibraryRow[], on: boolean): ReadonlyMap<string, LibrarySection> {
  const [looked, setLooked] = useState(remembered);
  const wanted = useMemo(() => (on ? cardsToLookUp(progress, rows, looked).filter((address) => !asked.has(address)).slice(0, PER_LOOK) : []), [on, progress, rows, looked]);
  const key = wanted.join(" ");
  useEffect(() => {
    if (wanted.length === 0) return;
    let live = true;
    for (const address of wanted) asked.add(address);
    void Promise.all(
      wanted.map(async (address) => {
        const id = titleIdOf(address);
        const item = id ? await fetchTitle(id) : null;
        // (A title the server knows but says nothing more of is in the section of its kind.)
        return item ? ([address, item.section ?? (item.kind === "series" ? "series" : "movie")] as const) : null;
      }),
    ).then((answers) => {
      const found = answers.filter((answer): answer is readonly [string, LibrarySection] => answer !== null);
      if (found.length === 0) return;
      const next = new Map([...remembered(), ...found]);
      remember(next);
      if (live) setLooked(next);
    });
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return looked;
}
