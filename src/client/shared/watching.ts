import { useEffect, useState } from "react";
import { z } from "zod";
import { isWanted, LibraryItemSchema, type LibraryItem, type LibrarySection } from "../../shared";

/**
 * What people watch on Kino (server/accounts/watching.ts): a row of Home, on the TV and the phone, after the library's second row. Titles only, as the
 * library knows them: nobody is named and nothing is counted. Not on a child's profile, not on the page of a section, and not with fewer than
 * `WATCHING_MIN` titles of the sections the profile watches (a row of two looks like a mistake). A profile can leave its own watching out of it in its
 * settings (`publicWatching`); the row itself is shown either way.
 */
export const WATCHING_MIN = 4;
/** After which of the library's rows (from 0) the row comes. */
export const WATCHING_AFTER = 1;
/** The same for everybody, and the server works it out at most every quarter of an hour: asked again after ten minutes. */
const KEEP_MS = 10 * 60_000;

const AnswerSchema = z.object({ items: z.array(LibraryItemSchema).max(50) });
const NONE: readonly LibraryItem[] = [];
let kept: { at: number; items: readonly LibraryItem[] } | undefined;
let asking: Promise<readonly LibraryItem[]> | undefined;

async function ask(): Promise<readonly LibraryItem[]> {
  try {
    const res = await fetch("/api/watching");
    if (!res.ok) return kept?.items ?? NONE;
    const parsed = AnswerSchema.safeParse(await res.json());
    if (!parsed.success) return kept?.items ?? NONE;
    kept = { at: Date.now(), items: parsed.data.items };
    return kept.items;
  } catch {
    return kept?.items ?? NONE;
  }
}

/** The titles of the row, asked of the server while `on` (Home, a profile that is not a child's). */
export function useWatching(on: boolean): readonly LibraryItem[] {
  const [items, setItems] = useState<readonly LibraryItem[]>(() => (on && kept ? kept.items : NONE));
  useEffect(() => {
    if (!on) {
      setItems(NONE);
      return;
    }
    let live = true;
    if (kept && Date.now() - kept.at < KEEP_MS) setItems(kept.items);
    else void (asking ??= ask().finally(() => (asking = undefined))).then((got) => live && setItems(got));
    return () => {
      live = false;
    };
  }, [on]);
  return items;
}

/** The row's titles for a profile that watches `wanted` (null: every section), or none when too few are left. */
export function watchingRow(items: readonly LibraryItem[] | undefined, wanted: ReadonlySet<LibrarySection> | null | undefined): readonly LibraryItem[] {
  const shown = (items ?? NONE).filter((item) => isWanted(wanted, item));
  return shown.length >= WATCHING_MIN ? shown : NONE;
}

/** (For the tests: forget what was asked.) */
export function forgetWatching(): void {
  kept = undefined;
  asking = undefined;
}
