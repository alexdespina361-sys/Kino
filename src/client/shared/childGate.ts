import { useEffect, useMemo, useSyncExternalStore } from "react";
import { forChildren, type LibraryRow, type LiveListItem, type LiveProgress, type LiveRating } from "../../shared";
import { useProfileData } from "../account/store";
import { allRows, useFeed } from "./feed";
import { addressOf, askTitle, titleIdOf } from "./titleAddress";

/**
 * What a child's profile may see (the `child` setting; the rule is `forChildren` in shared/library.ts) of the titles that do not carry a word of it: the cards
 * of Continue watching, of the lists, of History and of the ratings keep a title's link and name, not its section. Such a title is judged by its address
 * (`movie-603`, `tv-1399`; see titleAddress.ts): as the rows loaded so far list it, else as the server says when asked once (`/api/library/title`). Until
 * then it is not shown, and a title that has no such address (a pasted link) is never shown: a child's profile shows what is known to be for children.
 */

/**
 * Where this device keeps the titles it was told are for children, each with when it was told. (Until 17 Nov they were kept for good, by address alone, in
 * `kino.childTitles`, which is let go: since then a cartoon TMDB calls for families is not for children when its age rating says otherwise, so a "yes" from
 * before, The Simpsons Movie's, is not one now.)
 */
const STORE = "kino.childTitles.2";
const OLD_STORE = "kino.childTitles";
/** How many titles this device remembers as for children (the newest). */
const KEEP = 600;
/** How long a "yes" is believed before the server is asked again (a rating can change; the server keeps its own answer as long: see filmpire.ts). */
export const YES_KEEP_MS = 14 * 24 * 3600 * 1000;
/**
 * How many titles one look asks the server about at most, and how long the next look waits after it: an address may ask 120 questions about titles a minute (the
 * server's `fetchLimits`), the whole household's screens together, and a title's own page needs some of them. This is 60 a minute at most.
 */
const PER_LOOK = 4;
const LOOK_GAP_MS = 4_000;
/** How many times a title the server would not answer for (too many asks, a place that could not be reached) is asked about, in one page load. */
const TRIES = 2;

/** A title as a card of the profile's has it: its id (or the card's key), its link, and whether it is a film or a show when the card says. */
export interface OwnTitle {
  id: string;
  url: string;
  kind?: string | undefined;
}

/** Says whether a child's profile may see a title that is not a library item (a card of this profile's): see above. */
export interface ChildGate {
  allows(entry: OwnTitle): boolean;
}

/**
 * What was kept (`STORE`), read: the titles this device was told are for children, with when, as long as that is less than `YES_KEEP_MS` ago. Only a yes is
 * kept: no answer is not a no (the server may not have been reached). Anything else in it (an older form, a time to come) is not believed.
 */
export function readYes(kept: string | null, now: number): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw: unknown = JSON.parse(kept ?? "[]");
    if (!Array.isArray(raw)) return out;
    for (const each of raw) {
      if (!Array.isArray(each) || typeof each[0] !== "string" || typeof each[1] !== "number") continue;
      const [address, at] = each as [string, number];
      if (at <= now && now - at < YES_KEEP_MS) out.set(address, at);
    }
  } catch {
    // (Nothing that can be read: nothing is believed.)
  }
  return out;
}

/** What is kept of the yes answers: the newest `KEEP`, oldest first. */
export const writeYes = (yes: ReadonlyMap<string, number>): string => JSON.stringify([...yes].sort((a, b) => a[1] - b[1]).slice(-KEEP));

function rememberedYes(): Map<string, number> {
  try {
    localStorage.removeItem(OLD_STORE);
    return readYes(localStorage.getItem(STORE), Date.now());
  } catch {
    return new Map();
  }
}

function keepYes(yes: ReadonlyMap<string, number>): void {
  try {
    localStorage.setItem(STORE, writeYes(yes));
  } catch {
    // (A device that keeps nothing asks again on its next visit.)
  }
}

/**
 * What every screen of the page knows of the server's answers, shared (a title one screen asked about is known to all of them): the yes answers, and how many
 * looks have ended (a look that brought no yes is still news: the titles after it are asked about next).
 */
interface Known {
  yes: ReadonlySet<string>;
  looks: number;
}
let known: Known | null = null;
const listeners = new Set<() => void>();
const currentKnown = (): Known => (known ??= { yes: new Set(rememberedYes().keys()), looks: 0 });
const subscribeKnown = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const tell = () => listeners.forEach((listener) => listener());
/** A look has ended: its yes answers count at once, the titles it got no answer for may be asked again, and the next look starts after a pause (see `LOOK_GAP_MS`). */
function looked(found: readonly string[], unanswered: readonly string[]): void {
  if (found.length > 0) {
    const before = currentKnown();
    const kept = rememberedYes();
    const now = Date.now();
    for (const address of found) kept.set(address, now);
    keepYes(kept);
    known = { ...before, yes: new Set([...before.yes, ...found]) };
    tell();
  }
  setTimeout(() => {
    for (const address of unanswered) if ((tries.get(address) ?? 0) < TRIES) asked.delete(address);
    looking = false;
    known = { ...currentKnown(), looks: currentKnown().looks + 1 };
    tell();
  }, LOOK_GAP_MS);
}
/** A look is under way, or its pause is not over: one at a time, for every screen of the page. */
let looking = false;

/** What the rows loaded so far say of their titles, by address (a title that one row shows as a cartoon is one, whatever a row that does not say its section shows). */
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

/** The titles asked about since the page loaded (one the server said no to is asked again on the next load), and how many times each was. */
const asked = new Set<string>();
const tries = new Map<string, number>();

/** The titles of a profile's own cards, as the gate judges them: Continue watching, the lists, the ratings. */
export const ownTitles = (progress: readonly LiveProgress[], list: readonly LiveListItem[], ratings: readonly LiveRating[]): OwnTitle[] => [
  ...progress.map((card) => ({ id: card.key, url: card.url })),
  ...list.map((item) => ({ id: item.id, url: item.url })),
  ...ratings.map((rating) => ({ id: rating.key, url: rating.url, kind: rating.kind })),
];

/**
 * The gate for a child's profile (`on`), growing as the server answers for the titles of `entries` the rows do not list; none for any other profile, which
 * sees everything.
 */
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
  // (Looked at again when the titles wanted change, and when a look's pause is over: `looks`.)
  useEffect(() => {
    if (looking) return;
    // (Another screen of the page may have asked about these in the same moment.)
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

/** A profile's own cards as a screen shows them: all of them, or on a child's profile only those known to be for children (see above). */
export interface ChildCards {
  child: boolean;
  progress: LiveProgress[];
  list: LiveListItem[];
  ratings: LiveRating[];
}

/** The phone's screens' way to the above: the profile's cards, judged against every row the library has brought so far. */
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
