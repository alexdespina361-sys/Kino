import { useEffect, useState } from "react";
import { z } from "zod";
import { isWanted, LibraryItemSchema, type LibraryItem, type LibrarySection } from "../../shared";

export const WATCHING_MIN = 4;
export const WATCHING_AFTER = 1;
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

export function watchingRow(items: readonly LibraryItem[] | undefined, wanted: ReadonlySet<LibrarySection> | null | undefined): readonly LibraryItem[] {
  const shown = (items ?? NONE).filter((item) => isWanted(wanted, item));
  return shown.length >= WATCHING_MIN ? shown : NONE;
}

export function forgetWatching(): void {
  kept = undefined;
  asking = undefined;
}
