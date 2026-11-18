import { z } from "zod";
import { LibraryItemSchema, type LibraryItem } from "../../shared";

export const TITLE_PARAM = "title";

export interface TitleExtras {
  season?: number;
  episode?: number;
  at?: number;
  score?: number;
}

export type TitleOpening = Omit<TitleExtras, "score">;

const EXTRA_PARAMS = [
  ["season", "s", 1, 200],
  ["episode", "e", 1, 5000],
  ["at", "t", 1, 86_400],
  ["score", "r", 1, 10],
] as const;

const wholeIn = (value: string | null, min: number, max: number): number | undefined => {
  if (value === null || !/^\d{1,6}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
};

export function extrasOf(params: URLSearchParams, address: string | null): TitleExtras {
  const found: TitleExtras = {};
  for (const [name, param, min, max] of EXTRA_PARAMS) {
    const n = wholeIn(params.get(param), min, max);
    if (n !== undefined) found[name] = n;
  }
  const show = address?.startsWith("tv-") ?? false;
  const episode = show && found.season !== undefined && found.episode !== undefined;
  return {
    ...(episode ? { season: found.season, episode: found.episode } : {}),
    ...(found.at !== undefined && (episode || !show) ? { at: found.at } : {}),
    ...(found.score !== undefined ? { score: found.score } : {}),
  };
}

export function extrasQuery(extras: TitleExtras): string {
  return EXTRA_PARAMS.map(([name, param]) => (extras[name] !== undefined ? `&${param}=${extras[name]}` : "")).join("");
}

export const asksAnything = (extras: TitleExtras | undefined): boolean => extras !== undefined && EXTRA_PARAMS.some(([name]) => extras[name] !== undefined);

const OWN_ID = /^filmpire-(movie|tv)-(\d{1,10})$/;
const ADDRESS = /^(movie|tv)-(\d{1,10})$/;

export function addressOf(entry: { id: string; url: string; kind?: string }): string | null {
  const own = OWN_ID.exec(entry.id);
  if (own) return `${own[1]}-${own[2]}`;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }
  const watch = /^\/watch\/(\d{1,10})$/.exec(url.pathname);
  if (!watch) return null;
  const show = entry.kind === "series" || url.searchParams.has("s") || url.searchParams.has("e");
  return `${show ? "tv" : "movie"}-${watch[1]}`;
}

export function titleIdOf(address: string | null | undefined): string | null {
  const named = address ? ADDRESS.exec(address) : null;
  return named ? `filmpire-${named[1]}-${named[2]}` : null;
}

export const linkedTitle = (search: string = typeof location === "undefined" ? "" : location.search): string | null => titleIdOf(new URLSearchParams(search).get(TITLE_PARAM));

export type TitleAsk = { id: string | null; extras: TitleExtras } | null;

export function titleAsk(search: string = typeof location === "undefined" ? "" : location.search): TitleAsk {
  const params = new URLSearchParams(search);
  if (!params.has(TITLE_PARAM)) return null;
  const { score: _score, ...extras } = extrasOf(params, params.get(TITLE_PARAM));
  return { id: titleIdOf(params.get(TITLE_PARAM)), extras };
}

let link: { ask: TitleAsk; done: boolean; item?: Promise<LibraryItem | null> } | undefined;

export function pendingLink(search?: string): { id: string | null; extras: TitleExtras; item: Promise<LibraryItem | null> } | null {
  link ??= { ask: titleAsk(search), done: false };
  if (link.done || !link.ask) return null;
  const { id, extras } = link.ask;
  link.item ??= id ? fetchTitle(id) : Promise.resolve(null);
  return { id, extras, item: link.item };
}

export function dropLink(): void {
  if (link) link.done = true;
  else link = { ask: null, done: true };
}

export function withTitle(href: string, address: string | null): string {
  const url = new URL(href);
  for (const [, param] of EXTRA_PARAMS) url.searchParams.delete(param);
  if (address) url.searchParams.set(TITLE_PARAM, address);
  else url.searchParams.delete(TITLE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function showTitle(address: string | null): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  if (new URLSearchParams(location.search).get(TITLE_PARAM) === address) return;
  history.replaceState(history.state, "", withTitle(location.href, address));
}

const TitleAnswerSchema = z.object({ item: LibraryItemSchema.nullable() });

export async function askTitle(id: string): Promise<LibraryItem | null | undefined> {
  try {
    const res = await fetch(`/api/library/title?id=${encodeURIComponent(id)}`);
    if (!res.ok) return res.status === 400 ? null : undefined;
    const parsed = TitleAnswerSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.item : undefined;
  } catch {
    return undefined;
  }
}

export const fetchTitle = async (id: string): Promise<LibraryItem | null> => (await askTitle(id)) ?? null;
