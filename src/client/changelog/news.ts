import { useCallback, useEffect, useState } from "react";
import type { UiLanguage } from "../../shared";
import { readStorage, writeStorage } from "../shared/format";

/**
 * What changed in Kino, version by version ("Kino 0.4.2"), in words for the people who watch: the owner's ask of 14 Nov 2026 ("a changelog in the
 * profile, numbered like Kino 0.4.3, plain English"). The list itself (notes.ts) is a part of the page of its own, asked for only when someone opens it;
 * this file is what the profile's tile needs without it. Each new version goes first in notes.ts, and `LATEST` is changed to it (a test checks that the two agree).
 */
export interface ChangeNote {
  /** "0.4.2": shown as "Kino 0.4.2". */
  version: string;
  /** The day it was all on the site (YYYY-MM-DD). */
  date: string;
  /** The lines, the same ones in each language, most noticeable first. */
  en: readonly string[];
  ro: readonly string[];
  it: readonly string[];
}

/** The newest version: what the profile's tile says. */
export const LATEST = { version: "0.4.4", date: "2026-11-17" } as const;

/** The newest version this screen has shown its viewer (a screen's own: each TV, phone and computer keeps its own). */
export const SEEN_KEY = "kino.seenVersion";

const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);

/** Whether version `a` is later than `b` ("0.4.10" is later than "0.4.9"). */
export function newer(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let at = 0; at < Math.max(x.length, y.length); at++) {
    const step = (x[at] ?? 0) - (y[at] ?? 0);
    if (step !== 0) return step > 0;
  }
  return false;
}

/**
 * Whether the newest version is news to this screen: only when it showed an older one before. A screen that never showed any (a first visit, a cleared
 * browser) is not told, as everything is new to it: it notes the newest as seen, so that the next one is news. `seen()` is for when the page is opened.
 */
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

/** The lines of a version in the page's language. */
export const linesOf = (note: ChangeNote, language: UiLanguage): readonly string[] => note[language] ?? note.en;

/** "17 November 2026" (or "17 Nov" when `short`), in the page's language, for the day as written (no time zone moves it a day). */
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

/** The list, asked for once (a failed ask is asked again next time). */
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

/** The list for a page that shows it: loading, there, or not come (with `retry`). */
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
