import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { LibraryItemsSchema, ratingsShown, type LibraryItem, type LiveRating } from "../../shared";
import { profileStore, useProfileData } from "../account/store";
import { t } from "../i18n";
import { feed } from "./feed";
import { FIRST_ASKS, knownOf, planRows, rootSeeds, type PersonalRow, type Seed } from "./taste";

export { LOVED_FROM } from "./taste";
export type { PersonalRow, Seed } from "./taste";

export const ASKS_IN_ALL = 150;
const HOUR_MS = 60 * 60_000;
export const ASK_AGAIN_MS = 60_000;

export function titleOfPersonal(row: Pick<PersonalRow, "why" | "title">): string {
  if (row.why === "picks") return t("rows.picks");
  return t(row.why === "loved" ? "rows.loved" : row.why === "saved" ? "rows.saved" : row.why === "like" ? "rows.moreLike" : "rows.because", { title: row.title });
}

export interface LikeThisOptions {
  fetch?: typeof fetch;
  learn?: (items: readonly LibraryItem[]) => void;
  max?: number;
  now?: () => number;
}

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
    look: (key: string): readonly LibraryItem[] | null | undefined => answers.get(key) ?? (failed.has(key) ? null : undefined),
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    ask(seed: Seed) {
      if (answers.has(seed.key) || asking.has(seed.key) || failed.has(seed.key)) return;
      if (asked >= max) {
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

export const likeThis: LikeThis = createLikeThis({ learn: (items) => feed.learn(items) });

export function warm(store: LikeThis, data: Pick<ReturnType<typeof profileStore.getSnapshot>, "progress" | "list" | "ratings" | "settings" | "waiting">): void {
  if (data.waiting) return;
  for (const seed of rootSeeds(data.progress, ratingsShown(data.settings) ? data.ratings : [], data.list, FIRST_ASKS)) store.ask(seed);
}
if (typeof window !== "undefined") {
  let last = "";
  const look = () => {
    const data = profileStore.getSnapshot();
    const names = `${data.scope}\n${data.waiting}\n${rootSeeds(data.progress, ratingsShown(data.settings) ? data.ratings : [], data.list, FIRST_ASKS).map((seed) => seed.key).join("\n")}`;
    if (names === last) return;
    last = names;
    warm(likeThis, data);
  };
  profileStore.subscribe(look);
  look();
}

export interface LikesOptions {
  want: number;
  keep?: ((item: LibraryItem) => boolean) | undefined;
  picks?: boolean;
  page?: string;
  showing?: boolean;
}

const NO_RATINGS: readonly LiveRating[] = [];

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
  useEffect(() => {
    if (showing) store.refresh();
  }, [showing, store]);
  const name = `${scope}\n${options.page ?? ""}\n${options.picks !== false}`;
  const waitingFirst = plan.rows.length === 0 && plan.ask.length > 0;
  useEffect(() => {
    if (!waitingFirst) store.keep(name, plan.rows);
  }, [waitingFirst, name, plan, store]);
  return waitingFirst ? (store.kept(name) ?? plan.rows) : plan.rows;
}
