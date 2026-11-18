import { useEffect, useMemo, useSyncExternalStore } from "react";
import { forChildren, type LibraryRow, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { useProfileData } from "../account/store";
import { allRows, useFeed } from "./feed";
import { addressOf, askTitle, titleIdOf } from "./titleAddress";

const STORE = "kino.childTitles";
const KEEP = 600;
const PER_LOOK = 4;
const LOOK_GAP_MS = 4_000;
const TRIES = 2;

export interface OwnTitle {
  id: string;
  url: string;
  kind?: string | undefined;
}

export interface ChildGate {
  allows(entry: OwnTitle): boolean;
}

function rememberedYes(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((each): each is string => typeof each === "string") : []);
  } catch {
    return new Set();
  }
}

function keepYes(addresses: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify([...addresses].slice(-KEEP)));
  } catch {
  }
}

interface Known {
  yes: ReadonlySet<string>;
  looks: number;
}
let known: Known | null = null;
const listeners = new Set<() => void>();
const currentKnown = (): Known => (known ??= { yes: rememberedYes(), looks: 0 });
const subscribeKnown = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const tell = () => listeners.forEach((listener) => listener());
function looked(found: readonly string[], unanswered: readonly string[]): void {
  if (found.length > 0) {
    const before = currentKnown();
    const yes = new Set([...rememberedYes(), ...before.yes, ...found]);
    keepYes(yes);
    known = { ...before, yes };
    tell();
  }
  setTimeout(() => {
    for (const address of unanswered) if ((tries.get(address) ?? 0) < TRIES) asked.delete(address);
    looking = false;
    known = { ...currentKnown(), looks: currentKnown().looks + 1 };
    tell();
  }, LOOK_GAP_MS);
}
let looking = false;

export function childTitlesOfRows(rows: readonly LibraryRow[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const row of rows) {
    for (const item of row.items) {
      const address = addressOf(item);
      if (address && out.get(address) !== true) out.set(address, forChildren(item, row));
    }
  }
  return out;
}

const asked = new Set<string>();
const tries = new Map<string, number>();

export const ownTitles = (progress: readonly LiveProgress[], list: readonly LiveListItem[], ratings: readonly LiveRating[]): OwnTitle[] => [
  ...progress.map((card) => ({ id: card.key, url: card.url })),
  ...list.map((item) => ({ id: item.id, url: item.url })),
  ...ratings.map((rating) => ({ id: rating.key, url: rating.url, kind: rating.kind })),
];

export function useChildGate(entries: readonly OwnTitle[], rows: readonly LibraryRow[], on: boolean): ChildGate | undefined {
  const { yes, looks } = useSyncExternalStore(subscribeKnown, currentKnown, currentKnown);
  const fromRows = useMemo(() => (on ? childTitlesOfRows(rows) : new Map<string, boolean>()), [on, rows]);
  const wanted = useMemo(() => {
    if (!on) return [];
    const out = new Set<string>();
    for (const entry of entries) {
      const address = addressOf(entry);
      if (address && !fromRows.has(address) && !yes.has(address) && !asked.has(address)) out.add(address);
    }
    return [...out].slice(0, PER_LOOK);
  }, [on, entries, fromRows, looks]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = wanted.join(" ");
  useEffect(() => {
    if (looking) return;
    const fresh = wanted.filter((address) => !asked.has(address));
    if (fresh.length === 0) return;
    looking = true;
    for (const address of fresh) {
      asked.add(address);
      tries.set(address, (tries.get(address) ?? 0) + 1);
    }
    void Promise.all(
      fresh.map(async (address) => {
        const id = titleIdOf(address);
        const item = id ? await askTitle(id) : null;
        return [address, item === undefined ? undefined : item !== null && forChildren(item)] as const;
      }),
    ).then((answers) =>
      looked(
        answers.filter(([, may]) => may === true).map(([address]) => address),
        answers.filter(([, may]) => may === undefined).map(([address]) => address),
      ),
    );
  }, [key, looks]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(
    () =>
      on
        ? {
            allows: (entry) => {
              const address = addressOf(entry);
              if (!address) return false;
              return fromRows.get(address) ?? yes.has(address);
            },
          }
        : undefined,
    [on, fromRows, yes],
  );
}

export interface ChildCards {
  child: boolean;
  progress: LiveProgress[];
  list: LiveListItem[];
  ratings: LiveRating[];
}

export function useChildCards(): ChildCards {
  const { progress, list, ratings, settings } = useProfileData();
  const child = settings.child === true;
  const feeding = useFeed();
  const rows = useMemo(() => allRows(feeding.data), [feeding.data]);
  const entries = useMemo(() => (child ? ownTitles(progress, list, ratings) : []), [child, progress, list, ratings]);
  const gate = useChildGate(entries, rows, child);
  return useMemo(
    () =>
      gate
        ? {
            child,
            progress: progress.filter((card) => gate.allows({ id: card.key, url: card.url })),
            list: list.filter((item) => gate.allows({ id: item.id, url: item.url })),
            ratings: ratings.filter((rating) => gate.allows({ id: rating.key, url: rating.url, kind: rating.kind })),
          }
        : { child, progress, list, ratings },
    [gate, child, progress, list, ratings],
  );
}
