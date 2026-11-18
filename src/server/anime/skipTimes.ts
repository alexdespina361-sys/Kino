import type { AnimeHint, SkipTimes } from "../../shared";
import { believableSkipTimes } from "../../shared/skip";
import { remember } from "../boundedMap";

export interface AnimeSkipLookup {
  find(hint: AnimeHint, length: number): Promise<SkipTimes | null>;
}

export interface AnimeSkipOptions {
  fetch?: typeof fetch;
  perMinute?: number;
  now?: () => number;
}

const ANILIST = "https://graphql.anilist.co";
const ANISKIP = "https://api.aniskip.com/v2/skip-times";
const TIMEOUT_MS = 4000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const KEEP = { idFound: 7 * 24 * HOUR, idNone: 6 * HOUR, timesFound: 24 * HOUR, timesNone: 6 * HOUR, failed: 2 * MINUTE };
const MAX_KEPT = 4000;
const sameCut = (theirs: number, ours: number) => Math.abs(theirs - ours) <= Math.max(10, ours * 0.01);
const KINDS = { op: "intro", recap: "recap", ed: "outro" } as const;
const COUNTRIES = new Set(["JP", "CN", "KR", "TW"]);
const FORMATS = new Set(["TV", "TV_SHORT", "ONA", "OVA", "MOVIE", "SPECIAL"]);
const SERIES = new Set(["TV", "TV_SHORT", "ONA"]);

export function plainTitle(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function baseTitle(raw: string): string {
  return plainTitle(raw.replace(/\(\s*\d{4}\s*\)/g, " "))
    .replace(/\b(?:season|part|cour)\s*\d+\b.*$/, "")
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b.*$/, "")
    .trim();
}

const wordsOf = (name: string) => new Set(name.split(" ").filter(Boolean));

export function sameShow(asked: string, names: readonly string[]): boolean {
  const mine = baseTitle(asked);
  if (!mine) return false;
  const myWords = wordsOf(mine);
  return names.some((name) => {
    const theirs = baseTitle(name);
    if (!theirs) return false;
    if (theirs === mine) return true;
    const theirWords = wordsOf(theirs);
    const [small, big] = myWords.size <= theirWords.size ? [myWords, theirWords] : [theirWords, myWords];
    return small.size >= 2 && small.size * 2 >= big.size && [...small].every((word) => big.has(word));
  });
}

export function sameName(asked: string, names: readonly string[]): boolean {
  const mine = baseTitle(asked);
  return mine !== "" && names.some((name) => baseTitle(name) === mine);
}

export function saysAnotherSeason(asked: string, names: readonly string[]): boolean {
  for (let season = 2; season <= 10; season += 1) if (!namesSeason([asked], season) && namesSeason(names, season)) return true;
  return false;
}

export const lastsAsLong = (minutes: number | null, length: number) => minutes === null || (length >= minutes * 30 && length <= minutes * 120);

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export function namesSeason(names: readonly string[], season: number): boolean {
  const roman = ROMAN[season];
  return names.some((name) => {
    const plain = plainTitle(name);
    return (
      new RegExp(`\\bseason ${season}\\b`).test(plain) ||
      new RegExp(`\\b${ORDINAL(season)} season\\b`).test(plain) ||
      new RegExp(` ${season}$`).test(plain) ||
      (roman !== undefined && roman !== "" && new RegExp(` ${roman}$`).test(plain))
    );
  });
}

interface Kept<T> {
  value: T;
  until: number;
}

interface Found {
  idMal?: number | null;
  episodes?: number | null;
  duration?: number | null;
  format?: string | null;
  countryOfOrigin?: string | null;
  title?: { romaji?: string | null; english?: string | null } | null;
  synonyms?: Array<string | null> | null;
}

interface Candidate {
  id: number;
  episodes: number | null;
  minutes: number | null;
  exact: boolean;
  otherSeason: boolean;
  series: boolean;
}

const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

function choose(candidates: readonly Candidate[], episode: number, length: number): number | null {
  const rank = (candidate: Candidate) => (candidate.otherSeason ? 0 : 4) + (candidate.exact ? 2 : 0) + (candidate.series ? 1 : 0);
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (candidate.episodes !== null && episode > candidate.episodes) continue;
    if (!lastsAsLong(candidate.minutes, length)) continue;
    if (!best || rank(candidate) > rank(best)) best = candidate;
  }
  return best?.id ?? null;
}

const SEARCH = `query ($search: String) { Page(perPage: 8) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { idMal episodes duration format countryOfOrigin title { romaji english } synonyms } } }`;

function budget(perMinute: number, now: () => number) {
  const asked: number[] = [];
  return () => {
    const at = now();
    while (asked.length > 0 && asked[0]! <= at - MINUTE) asked.shift();
    if (asked.length >= perMinute) return false;
    asked.push(at);
    return true;
  };
}

class NoAnswer extends Error {}
class OutOfBudget extends Error {}

export function createAnimeSkipLookup(options: AnimeSkipOptions = {}): AnimeSkipLookup {
  const get = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const perMinute = options.perMinute ?? 20;
  const mayAskAniList = budget(perMinute, now);
  const mayAskAniSkip = budget(perMinute, now);
  let aniListRestsUntil = 0;
  const shows = new Map<string, Kept<Candidate[]>>();
  const times = new Map<string, Kept<SkipTimes | null>>();
  const asking = new Map<string, Promise<SkipTimes | null>>();

  const fresh = <T>(map: Map<string, Kept<T>>, key: string): Kept<T> | undefined => {
    const kept = map.get(key);
    if (kept && kept.until > now()) return kept;
    if (kept) map.delete(key);
    return undefined;
  };

  const malId = async (hint: AnimeHint, length: number): Promise<number | null> => {
    const found = await candidatesFor(hint);
    return choose(found, hint.episode, length);
  };

  const candidatesFor = async (hint: AnimeHint): Promise<Candidate[]> => {
    const key = `${plainTitle(hint.title)}|${hint.season}`;
    const kept = fresh(shows, key);
    if (kept) return kept.value;
    const title = hint.title.replace(/\(\s*\d{4}\s*\)/g, " ").replace(/\s+/g, " ").trim();
    const searches = [...new Set(hint.season > 1 ? [`${title} Season ${hint.season}`, `${title} ${hint.season}`] : [title])];
    try {
      for (const search of searches) {
        if (now() < aniListRestsUntil || !mayAskAniList()) throw new OutOfBudget();
        const answer = await get(ANILIST, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: SEARCH, variables: { search } }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (answer.status === 429) {
          const seconds = Number(answer.headers.get("retry-after"));
          aniListRestsUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) * 1000 : MINUTE);
          throw new NoAnswer();
        }
        if (!answer.ok) throw new NoAnswer();
        const body = (await answer.json()) as { data?: { Page?: { media?: Found[] | null } | null } | null };
        const candidates: Candidate[] = [];
        for (const found of body.data?.Page?.media ?? []) {
          const id = found?.idMal;
          if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || candidates.some((candidate) => candidate.id === id)) continue;
          if (found.countryOfOrigin && !COUNTRIES.has(found.countryOfOrigin)) continue;
          if (found.format && !FORMATS.has(found.format)) continue;
          const names = [found.title?.english, found.title?.romaji, ...(found.synonyms ?? [])].filter((name): name is string => typeof name === "string" && name.length > 0);
          if (!sameShow(hint.title, names)) continue;
          if (hint.season > 1 && !namesSeason(names, hint.season)) continue;
          candidates.push({
            id,
            episodes: positive(found.episodes),
            minutes: positive(found.duration),
            exact: sameName(hint.title, names),
            otherSeason: hint.season === 1 && saysAnotherSeason(hint.title, names),
            series: typeof found.format === "string" && SERIES.has(found.format),
          });
        }
        if (candidates.length > 0) {
          remember(shows, key, { value: candidates, until: now() + KEEP.idFound }, MAX_KEPT);
          return candidates;
        }
      }
      remember(shows, key, { value: [], until: now() + KEEP.idNone }, MAX_KEPT);
      return [];
    } catch (error) {
      if (!(error instanceof OutOfBudget)) remember(shows, key, { value: [], until: now() + KEEP.failed }, MAX_KEPT);
      return [];
    }
  };

  const aniSkip = async (id: number, episode: number, length: number): Promise<SkipTimes | null> => {
    const key = `${id}|${episode}|${Math.round(length)}`;
    const kept = fresh(times, key);
    if (kept) return kept.value;
    if (!mayAskAniSkip()) return null;
    try {
      const address = `${ANISKIP}/${id}/${episode}?types=op&types=ed&types=recap&episodeLength=${Math.round(length)}`;
      const answer = await get(address, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (answer.status === 404) {
        remember(times, key, { value: null, until: now() + KEEP.timesNone }, MAX_KEPT);
        return null;
      }
      if (!answer.ok) throw new NoAnswer();
      const body = (await answer.json()) as { found?: boolean; results?: Array<{ skipType?: string; episodeLength?: number; interval?: { startTime?: number; endTime?: number } }> };
      const found: SkipTimes = {};
      for (const [kind, part] of Object.entries(KINDS)) {
        const candidates = (body.found && Array.isArray(body.results) ? body.results : []).filter(
          (result) => result?.skipType === kind && typeof result.episodeLength === "number" && sameCut(result.episodeLength, length),
        );
        candidates.sort((a, b) => Math.abs(a.episodeLength! - length) - Math.abs(b.episodeLength! - length));
        const best = candidates[0]?.interval;
        if (typeof best?.startTime === "number" && typeof best.endTime === "number") found[part] = { start: best.startTime, end: best.endTime };
      }
      const believed = believableSkipTimes(found, length) ?? null;
      remember(times, key, { value: believed, until: now() + (believed ? KEEP.timesFound : KEEP.timesNone) }, MAX_KEPT);
      return believed;
    } catch {
      remember(times, key, { value: null, until: now() + KEEP.failed }, MAX_KEPT);
      return null;
    }
  };

  return {
    async find(hint, length) {
      if (!Number.isFinite(length) || length <= 0) return null;
      const key = `${plainTitle(hint.title)}|${hint.season}|${hint.episode}|${Math.round(length)}`;
      const already = asking.get(key);
      if (already) return already;
      const asked = (async () => {
        try {
          const id = await malId(hint, length);
          return id === null ? null : await aniSkip(id, hint.episode, length);
        } catch {
          return null;
        } finally {
          asking.delete(key);
        }
      })();
      asking.set(key, asked);
      return asked;
    },
  };
}
