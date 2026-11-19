import { useCallback, useEffect, useMemo, useState } from "react";
import { LibrarySectionSchema, type LibraryRow, type LibrarySection, type LiveProgress, type LiveRating } from "../../shared";
import { fetchTitle, titleIdOf } from "../shared/titleAddress";
import { cardsToLookUp, ratingsToLookUp } from "./pages";

const STORE = "kino.cardSections";
const KEEP = 400;
const PER_LOOK = 12;

type Looked = ReadonlyMap<string, LibrarySection>;

function remembered(): Map<string, LibrarySection> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw).flatMap(([address, section]) => (LibrarySectionSchema.safeParse(section).success ? [[address, section as LibrarySection]] : [])));
  } catch {
    return new Map();
  }
}

function remember(known: Looked): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...known].slice(-KEEP))));
  } catch {
  }
}

const asked = new Set<string>();

function useLookedSections(toLookUp: (looked: Looked) => string[], on: boolean): Looked {
  const [looked, setLooked] = useState(remembered);
  const wanted = useMemo(() => (on ? toLookUp(looked).filter((address) => !asked.has(address)).slice(0, PER_LOOK) : []), [on, toLookUp, looked]);
  const key = wanted.join(" ");
  useEffect(() => {
    if (wanted.length === 0) return;
    let live = true;
    for (const address of wanted) asked.add(address);
    void Promise.all(
      wanted.map(async (address) => {
        const id = titleIdOf(address);
        const item = id ? await fetchTitle(id) : null;
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

export function useCardSections(progress: readonly LiveProgress[], rows: readonly LibraryRow[], on: boolean): Looked {
  return useLookedSections(useCallback((looked: Looked) => cardsToLookUp(progress, rows, looked), [progress, rows]), on);
}

export function useRatingSections(ratings: readonly LiveRating[], rows: readonly LibraryRow[], on: boolean): Looked {
  return useLookedSections(useCallback((looked: Looked) => ratingsToLookUp(ratings, rows, looked), [ratings, rows]), on);
}
