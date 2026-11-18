import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { LibraryItemsSchema, ratingsShown, type LibraryItem, type LiveRating } from "../../shared";
import { profileStore, useProfileData } from "../account/store";
import { t } from "../i18n";
import { feed } from "./feed";
import { FIRST_ASKS, knownOf, planRows, rootSeeds, type PersonalRow, type Seed } from "./taste";

/**
 * The rows of a profile's own: "Because you watched ...", "Because you loved ...", "Because you saved ...", "More like ..." and "You might like".
 * The library knows nothing of taste, only which titles are alike, so each row is the answer to one question: titles like this one. Which titles are
 * asked about, in what order, and what a row is made of is worked out in taste.ts; here the library is asked, and a page is given its rows.
 */

export { LOVED_FROM } from "./taste";
export type { PersonalRow, Seed } from "./taste";

/** How many titles the library is asked about in an hour, whatever the pages want: past it, what is not known is not asked. */
export const ASKS_IN_ALL = 150;
const HOUR_MS = 60 * 60_000;
/** A question that failed is asked again when a page of rows is next opened this long after it, not before (and never under a page that is open). */
export const ASK_AGAIN_MS = 60_000;

/** The name of a row over its titles. */
export function titleOfPersonal(row: Pick<PersonalRow, "why" | "title">): string {
  if (row.why === "picks") return t("rows.picks");
  return t(row.why === "loved" ? "rows.loved" : row.why === "saved" ? "rows.saved" : row.why === "like" ? "rows.moreLike" : "rows.because", { title: row.title });
}

/* ------------------------------ asking the library ------------------------------ */

export interface LikeThisOptions {
  fetch?: typeof fetch;
  /** Told of every title that comes, so the search finds it. */
  learn?: (items: readonly LibraryItem[]) => void;
  /** See `ASKS_IN_ALL`. */
  max?: number;
  now?: () => number;
}

/**
 * What the library said was like each title, kept for as long as the site is open: nothing found is kept too. A question that failed (the TV had
 * just woken, the library was busy) has no answer while the page is open: the rows after it are laid out without it, and a row that came late would
 * push them down the page. It is asked again when a page of rows is next opened (`refresh`).
 */
export function createLikeThis(options: LikeThisOptions = {}) {
  const ask = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const max = options.max ?? ASKS_IN_ALL;
  const now = options.now ?? (() => Date.now());
  const answers = new Map<string, readonly LibraryItem[]>();
  const asking = new Set<string>();
  const failed = new Map<string, number>();
  const kept = new Map<string, PersonalRow[]>();
  const listeners = new Set<() => void>();
  let asked = 0;
  let since = now();
  let version = 0;
  const tell = () => {
    version++;
    for (const listener of [...listeners]) listener();
  };
  const giveUp = (key: string) => {
    asking.delete(key);
    failed.set(key, now());
    tell();
  };
  return {
    get: (key: string) => answers.get(key),
    /** The answer; `null` when there is none to be had (it failed, or enough was asked); nothing while it is not known. */
    look: (key: string): readonly LibraryItem[] | null | undefined => answers.get(key) ?? (failed.has(key) ? null : undefined),
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Asks, unless it has been, or is being. */
    ask(seed: Seed) {
      if (answers.has(seed.key) || asking.has(seed.key) || failed.has(seed.key)) return;
      if (asked >= max) {
        // (Told a moment later: this may be called while a page is being drawn.)
        asking.add(seed.key);
        void Promise.resolve().then(() => giveUp(seed.key));
        return;
      }
      asked++;
      asking.add(seed.key);
      Promise.resolve()
        .then(() => ask(`/api/library/similar?url=${encodeURIComponent(seed.url)}`))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body: unknown) => {
          const parsed = LibraryItemsSchema.safeParse(body);
          const items = parsed.success ? parsed.data.items : [];
          asking.delete(seed.key);
          answers.set(seed.key, items);
          options.learn?.(items);
          tell();
        })
        .catch(() => giveUp(seed.key));
    },
    /**
     * A page of rows was opened: what failed a while ago may be asked again, and an hour that has passed since the count began begins it again.
     * (Not under a page that is open: see above.)
     */
    refresh() {
      const at = now();
      let changed = false;
      for (const [key, when] of [...failed]) {
        if (at - when >= ASK_AGAIN_MS) {
          failed.delete(key);
          changed = true;
        }
      }
      if (at - since >= HOUR_MS) {
        since = at;
        asked = 0;
      }
      if (changed) tell();
    },
    /** The rows a page was last given in full (see `useLikes`), by a name for the profile and the page. */
    kept: (page: string) => kept.get(page),
    keep: (page: string, rows: PersonalRow[]) => void kept.set(page, rows),
    reset() {
      answers.clear();
      asking.clear();
      failed.clear();
      kept.clear();
      asked = 0;
      since = now();
      tell();
    },
  };
}

export type LikeThis = ReturnType<typeof createLikeThis>;

/** What the TV and the phone ask the library. */
export const likeThis: LikeThis = createLikeThis({ learn: (items) => feed.learn(items) });

/**
 * The first of the profile's titles are asked about as soon as they are its titles, whatever page is open: a film that has just begun is one, and
 * by the time the library is back on the screen the rows it is in are known (a page that had to wait for them would be without its rows meanwhile).
 */
export function warm(store: LikeThis, data: Pick<ReturnType<typeof profileStore.getSnapshot>, "progress" | "list" | "ratings" | "settings" | "waiting">): void {
  if (data.waiting) return;
  for (const seed of rootSeeds(data.progress, ratingsShown(data.settings) ? data.ratings : [], data.list, FIRST_ASKS)) store.ask(seed);
}
if (typeof window !== "undefined") {
  let last = "";
  const look = () => {
    const data = profileStore.getSnapshot();
    // (Only when the titles change: the store tells of every few seconds of a film that is playing.)
    const names = `${data.scope}\n${data.waiting}\n${rootSeeds(data.progress, ratingsShown(data.settings) ? data.ratings : [], data.list, FIRST_ASKS).map((seed) => seed.key).join("\n")}`;
    if (names === last) return;
    last = names;
    warm(likeThis, data);
  };
  profileStore.subscribe(look);
  look();
}

/** What a page wants of the profile's rows. */
export interface LikesOptions {
  /** How many rows it has a place for (`personalSlots`): the library is asked for no more than these need, so a page asks as it is scrolled. */
  want: number;
  /** The titles the page shows (a section's, the sections the profile watches, a child's): the rows are made of these only. The same function while it says the same. */
  keep?: ((item: LibraryItem) => boolean) | undefined;
  /** Without the row of what the profile might like (a child's profile). */
  picks?: boolean;
  /** A name for the page (Home, a section): the rows it was last given are kept under it, for a page that opens again before the library has answered. */
  page?: string;
  /**
   * Whether the page is on the screen (it is, unless told). While it is, the rows are made from what the profile had watched, saved and scored when it
   * came to the screen: a title saved from a row stays in its row, and no row moves under the finger. Away from it they follow the profile.
   */
  showing?: boolean;
}

const NO_RATINGS: readonly LiveRating[] = [];

/** The rows of the profile in use for a page, in the order they keep (the scores count only while ratings are on). */
export function useLikes(options: LikesOptions, store: LikeThis = likeThis): PersonalRow[] {
  const { scope, progress, list, ratings, settings, waiting } = useProfileData();
  const scored = ratingsShown(settings) ? ratings : NO_RATINGS;
  const live = useMemo(() => ({ scope, roots: rootSeeds(progress, scored, list), known: knownOf(progress, list, scored) }), [scope, progress, scored, list]);
  const showing = options.showing !== false;
  const held = useRef(live);
  const shown = useRef(false);
  if (!showing || !shown.current || waiting || held.current.scope !== scope || held.current.roots.length === 0) held.current = live;
  shown.current = showing;
  const { roots, known } = held.current;
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);
  const { want, keep, picks } = options;
  const plan = useMemo(
    () => planRows(roots, store.look, known, { want, keep, picks }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` says that an answer came
    [roots, known, want, keep, picks, version, store],
  );
  useEffect(() => {
    for (const seed of plan.ask) store.ask(seed);
  }, [plan, store]);
  // A page that comes to the screen may ask again what failed a while ago.
  useEffect(() => {
    if (showing) store.refresh();
  }, [showing, store]);
  // A page that opens again while the first answers are on their way (the library after a film that was just begun: its title is one of the first now)
  // has the rows it had, until the new ones are whole: without them the remote, which is put back on the row it left, would have no such row.
  const name = `${scope}\n${options.page ?? ""}\n${options.picks !== false}`;
  const waitingFirst = plan.rows.length === 0 && plan.ask.length > 0;
  useEffect(() => {
    if (!waitingFirst) store.keep(name, plan.rows);
  }, [waitingFirst, name, plan, store]);
  return waitingFirst ? (store.kept(name) ?? plan.rows) : plan.rows;
}
