import type { AnimeHint, SkipTimes } from "../../shared";
import { believableSkipTimes } from "../../shared/skip";
import { remember } from "../boundedMap";

/**
 * AniSkip's times for an anime episode: where its opening, its "previously on" and its ending are, for the player's Skip button (client/tv/skip.ts). AniSkip
 * keeps what people sent in, by MyAnimeList id, episode and the length of the cut they watched; AniList says which MyAnimeList id a title is. Neither needs a key.
 *
 * Ported from Gemini's feat/anime-skip-times (4de6b18), and changed so that it can neither slow a film down nor skip its story:
 * - It is asked by the player once the episode plays and its length is known (`/api/anime/skip`), never during the look-up of the film (that waited for
 *   AniList and AniSkip, up to some 12 seconds, before a film could start).
 * - Two cuts of one episode can have their opening minutes apart (Frieren's first: 3-93 s in a 1560 s cut, 117-207 s in a 1510 s one), and AniSkip answers
 *   with any cut's times unless it is told the length. It is told, and a time whose cut is more than a few seconds longer or shorter is not taken.
 * - The MyAnimeList id is AniList's match only when its name is the title's, it says the season asked for, it has the episode and its episodes last about
 *   as long as this one; nothing is guessed. Of those, the show's own name and its own season come first: searched by its English name, Frieren's
 *   one-minute "mini anime" (named "Frieren: Beyond Journey's End Mini Anime") is AniList's first answer, and its second season the fourth.
 * - "Mixed" openings and endings (played over the story) are not taken: skipping them skips the story.
 * - What was not found is remembered for a while too, a question that is already being asked is not asked again, and AniList and AniSkip are each asked at
 *   most so many times a minute by the whole server (past that: nothing, and nothing remembered, so it is asked again later).
 */

export interface AnimeSkipLookup {
  /** The believable times for `hint`'s episode in a cut `length` seconds long, or null when they are not known. Never throws. */
  find(hint: AnimeHint, length: number): Promise<SkipTimes | null>;
}

export interface AnimeSkipOptions {
  /** The fetch to ask AniList and AniSkip with (tests answer for them). */
  fetch?: typeof fetch;
  /** How many times a minute each of them may be asked by this server (20 unless set; AniList allows 90, or 30 while it is under load). */
  perMinute?: number;
  now?: () => number;
}

const ANILIST = "https://graphql.anilist.co";
const ANISKIP = "https://api.aniskip.com/v2/skip-times";
const TIMEOUT_MS = 4000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** How long an answer is kept: AniList's shows of a title for a week, no show for six hours; times for a day, none for six hours; a failure for two minutes. */
const KEEP = { idFound: 7 * 24 * HOUR, idNone: 6 * HOUR, timesFound: 24 * HOUR, timesNone: 6 * HOUR, failed: 2 * MINUTE };
const MAX_KEPT = 4000;
/** How much longer or shorter than this video AniSkip's cut may be for its times to be taken: 10 s, or 1% of a longer video. */
const sameCut = (theirs: number, ours: number) => Math.abs(theirs - ours) <= Math.max(10, ours * 0.01);
/** AniSkip's kinds of times, and the part of an episode each is. ("mixed-op" and "mixed-ed" are not asked for: see above.) */
const KINDS = { op: "intro", recap: "recap", ed: "outro" } as const;
/** The countries an anime on AniList comes from (an animation from elsewhere that AniList lists is not what this is for). */
const COUNTRIES = new Set(["JP", "CN", "KR", "TW"]);
const FORMATS = new Set(["TV", "TV_SHORT", "ONA", "OVA", "MOVIE", "SPECIAL"]);
/** The formats that are a series (on TV, short, or made for the web), not an OVA, a special or a film. */
const SERIES = new Set(["TV", "TV_SHORT", "ONA"]);

/* ------------------------------ names ------------------------------ */

/** A name as words: no accents ("Pokémon" is "pokemon"), no apostrophes ("Journey's" is "journeys"), lower case, one space between words. */
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

/** A name without the year in brackets and without what says which season or part it is ("Attack on Titan Season 2" is "attack on titan"). */
export function baseTitle(raw: string): string {
  return plainTitle(raw.replace(/\(\s*\d{4}\s*\)/g, " "))
    .replace(/\b(?:season|part|cour)\s*\d+\b.*$/, "")
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b.*$/, "")
    .trim();
}

const wordsOf = (name: string) => new Set(name.split(" ").filter(Boolean));

/** Whether one of `names` is the show `asked` names: the same words, or one name with every word of the other (two words at least, and half of the longer). */
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

/** Whether one of `names` is the very name `asked` is (not only one that holds it, as "Frieren: Beyond Journey's End Mini Anime" holds Frieren's). */
export function sameName(asked: string, names: readonly string[]): boolean {
  const mine = baseTitle(asked);
  return mine !== "" && names.some((name) => baseTitle(name) === mine);
}

/** Whether one of `names` says a season from 2 to 10 that `asked` itself does not say ("Kaiju No. 8" says nothing of an eighth season, nor does AniList's). */
export function saysAnotherSeason(asked: string, names: readonly string[]): boolean {
  for (let season = 2; season <= 10; season += 1) if (!namesSeason([asked], season) && namesSeason(names, season)) return true;
  return false;
}

/** Whether a video `length` seconds long can be an episode of a show whose episodes AniList says last `minutes`: from half as long to twice as long. */
export const lastsAsLong = (minutes: number | null, length: number) => minutes === null || (length >= minutes * 30 && length <= minutes * 120);

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** Whether one of `names` says it is season `season` ("Season 2", "2nd Season", "... 2", "... II"). */
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

/* ------------------------------ the look-up ------------------------------ */

interface Kept<T> {
  value: T;
  until: number;
}

/** One of AniList's answers to a search. */
interface Found {
  idMal?: number | null;
  episodes?: number | null;
  /** How long an episode is, in minutes. */
  duration?: number | null;
  format?: string | null;
  countryOfOrigin?: string | null;
  title?: { romaji?: string | null; english?: string | null } | null;
  synonyms?: Array<string | null> | null;
}

/** One of AniList's answers that is named as the show asked for, and says the season asked for. Which of them it is depends on the episode and its length. */
interface Candidate {
  id: number;
  /** How many episodes it has, and how many minutes one lasts, where AniList says. */
  episodes: number | null;
  minutes: number | null;
  /** Its name is the title's very name (see `sameName`). */
  exact: boolean;
  /** Asked for a first season, it says another (see `saysAnotherSeason`). */
  otherSeason: boolean;
  series: boolean;
}

const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The candidate that is the episode asked for in a cut `length` seconds long: one that has the episode and whose episodes last about as long, and of those
 * one that is not another season, then one with the title's very name, then a series; AniList's order between equals.
 */
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

/** A budget of asks a minute, for the whole server. */
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

/** Thrown for an answer that says nothing (a refusal, an error): it is not remembered as "none", only as a failure. */
class NoAnswer extends Error {}
/** Thrown when the minute's asks are used up, or AniList asked to be left alone for a while: nothing is remembered, it is asked again next time. */
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

  /** AniList's MyAnimeList id for the show, season and episode in a cut `length` seconds long, or null when none of its answers is that show (see above). */
  const malId = async (hint: AnimeHint, length: number): Promise<number | null> => {
    const found = await candidatesFor(hint);
    return choose(found, hint.episode, length);
  };

  /**
   * AniList's answers that are named as `hint`'s show and say its season, in AniList's order: kept by title and season (not by episode or length, which
   * choose among them), so that every episode of a show is one question to AniList.
   */
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
      // (A failure is remembered a little while, so that a busy minute does not ask again for every screen; a budget that ran out is not: it is asked again next time.)
      if (!(error instanceof OutOfBudget)) remember(shows, key, { value: [], until: now() + KEEP.failed }, MAX_KEPT);
      return [];
    }
  };

  /** AniSkip's times for the episode in a cut `length` seconds long: for each part, the time sent in for the cut nearest that length, if it is the same cut. */
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
