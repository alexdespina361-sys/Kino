import { useCallback, useEffect, useState } from "react";
import type { UiLanguage } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";

export interface ChangeNote {
  version: string;
  date: string;
  en: readonly string[];
  ro: readonly string[];
  it: readonly string[];
}

export const LATEST = { version: "0.4.21", date: "2026-11-19" } as const;

export const SEEN_KEY = "kino.seenVersion";

const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);

export function newer(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let at = 0; at < Math.max(x.length, y.length); at++) {
    const step = (x[at] ?? 0) - (y[at] ?? 0);
    if (step !== 0) return step > 0;
  }
  return false;
}

export const freshFor = (shown: string | undefined, latest: string = LATEST.version): boolean => shown !== undefined && newer(latest, shown);

export function useNews(): { fresh: boolean; seen: () => void } {
  const [fresh, setFresh] = useState(() => freshFor(readStorage(SEEN_KEY)));
  useEffect(() => {
    if (readStorage(SEEN_KEY) === undefined) writeStorage(SEEN_KEY, LATEST.version);
  }, []);
  const seen = useCallback(() => {
    writeStorage(SEEN_KEY, LATEST.version);
    setFresh(false);
  }, []);
  return { fresh, seen };
}

export const linesOf = (note: ChangeNote, language: UiLanguage): readonly string[] => note[language] ?? note.en;

export function dayOf(date: string, language: UiLanguage, short = false): string {
  const day = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  const options: Intl.DateTimeFormatOptions = short ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(language, options).format(day);
  } catch {
    return date;
  }
}

let asked: Promise<readonly ChangeNote[]> | null = null;

export function loadNotes(): Promise<readonly ChangeNote[]> {
  asked ??= import("./notes").then(
    (module) => module.CHANGELOG,
    (error: unknown) => {
      asked = null;
      throw error;
    },
  );
  return asked;
}

export type NotesState = { status: "loading" } | { status: "ready"; notes: readonly ChangeNote[] } | { status: "failed" };

export function useNotes(): NotesState & { retry: () => void } {
  const [state, setState] = useState<NotesState>({ status: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadNotes().then(
      (notes) => live && setState({ status: "ready", notes }),
      () => live && setState({ status: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  const retry = useCallback(() => setTries((count) => count + 1), []);
  return { ...state, retry };
}
