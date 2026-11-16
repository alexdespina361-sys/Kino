import type { SkipTimes } from "../../shared/media";
import { remember } from "../boundedMap";
import { providerFetch } from "../resolvers/providerFetch";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_CACHE = 1000;

// In-memory bounded caches
const malIdCache = new Map<string, number>();
const skipCache = new Map<string, SkipTimes>();

export interface AnimeSkipOptions {
  title?: string;
  season?: number;
  episode?: number;
  malId?: number;
  providerSkip?: {
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  };
  fetcher?: typeof fetch;
}

export function cleanAnimeTitle(raw: string): string {
  return raw
    .replace(/\b(?:season|s)\s*\d+.*$/i, "")
    .replace(/\b(?:part|cour)\s*\d+.*$/i, "")
    .replace(/\s*\(\d{4}\)\s*/g, " ")
    .replace(/[^a-zA-Z0-9\s:–—'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves a MyAnimeList (MAL) ID from an anime title and optional season number using AniList GraphQL,
 * with fallback to Jikan v4.
 */
export async function resolveMalId(
  title: string,
  season?: number,
  fetcher: typeof fetch = providerFetch(),
): Promise<number | null> {
  const clean = cleanAnimeTitle(title);
  if (!clean) return null;

  const s = season && season > 1 ? season : 1;
  const cacheKey = `${clean.toLowerCase()}:s${s}`;
  const cached = malIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const searchTerms = [
    s > 1 ? `${clean} Season ${s}` : clean,
    s > 1 ? `${clean} ${s}` : clean,
    clean,
  ];

  // 1. Try AniList GraphQL (fast, accurate, maps directly to idMal)
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        idMal
        title { english romaji }
      }
    }
  `;

  for (const term of searchTerms) {
    try {
      const res = await fetcher("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "user-agent": UA,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ query, variables: { search: term } }),
        signal: AbortSignal.timeout(2500),
      });

      if (res.ok) {
        const json = (await res.json()) as { data?: { Media?: { idMal?: number } } };
        const idMal = json.data?.Media?.idMal;
        if (typeof idMal === "number" && idMal > 0) {
          remember(malIdCache, cacheKey, idMal, MAX_CACHE);
          return idMal;
        }
      }
    } catch {
      // try next term or fallback
    }
  }

  // 2. Fallback: Jikan v4 REST API
  try {
    const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchTerms[0]!)}&limit=1`;
    const jRes = await fetcher(jikanUrl, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (jRes.ok) {
      const jJson = (await jRes.json()) as { data?: Array<{ mal_id?: number }> };
      const mId = jJson.data?.[0]?.mal_id;
      if (typeof mId === "number" && mId > 0) {
        remember(malIdCache, cacheKey, mId, MAX_CACHE);
        return mId;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Fetches exact intro (OP), outro (ED) and recap intervals from AniSkip.
 */
export async function fetchAniSkipTimes(
  malId: number,
  episode: number,
  fetcher: typeof fetch = providerFetch(),
): Promise<SkipTimes | null> {
  const cacheKey = `${malId}:${episode}`;
  const cached = skipCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types=op&types=ed&types=recap&types=mixed-op&types=mixed-ed&episodeLength=0`;

  try {
    const res = await fetcher(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      found?: boolean;
      results?: Array<{
        skipType?: string;
        interval?: { startTime?: number; endTime?: number };
      }>;
    };

    if (!data.found || !Array.isArray(data.results)) return null;

    const op = data.results.find((r) => r.skipType === "op" || r.skipType === "mixed-op");
    const ed = data.results.find((r) => r.skipType === "ed" || r.skipType === "mixed-ed");
    const recap = data.results.find((r) => r.skipType === "recap");

    const validInterval = (int?: { startTime?: number; endTime?: number }) => {
      if (!int || typeof int.startTime !== "number" || typeof int.endTime !== "number") return undefined;
      if (int.startTime < 0 || int.endTime <= int.startTime) return undefined;
      return {
        start: Math.round(int.startTime * 100) / 100,
        end: Math.round(int.endTime * 100) / 100,
      };
    };

    const intro = validInterval(op?.interval);
    const outro = validInterval(ed?.interval);
    const recapInterval = validInterval(recap?.interval);

    if (!intro && !outro && !recapInterval) return null;

    const skipTimes: SkipTimes = {
      ...(intro ? { intro } : {}),
      ...(outro ? { outro } : {}),
      ...(recapInterval ? { recap: recapInterval } : {}),
    };

    remember(skipCache, cacheKey, skipTimes, MAX_CACHE);
    return skipTimes;
  } catch {
    return null;
  }
}

/**
 * Returns exact skip timers (intro, outro, recap) for an anime episode.
 * Combines provider embedded skip markers with AniSkip community timings.
 */
export async function getAnimeSkipTimes(options: AnimeSkipOptions): Promise<SkipTimes | undefined> {
  const fetcher = options.fetcher ?? providerFetch();
  const ep = options.episode && options.episode > 0 ? options.episode : 1;

  // 1. Check if provider already has both intro and outro
  const pIntro = options.providerSkip?.intro;
  const pOutro = options.providerSkip?.outro;
  const hasValidProviderSkip =
    pIntro && pOutro && pIntro.start >= 0 && pIntro.end > pIntro.start && pOutro.start >= 0 && pOutro.end > pOutro.start;

  if (hasValidProviderSkip) {
    return {
      intro: { start: pIntro.start, end: pIntro.end },
      outro: { start: pOutro.start, end: pOutro.end },
    };
  }

  // 2. Look up via AniSkip
  let malId = options.malId;
  if (!malId && options.title) {
    malId = (await resolveMalId(options.title, options.season, fetcher)) ?? undefined;
  }

  let aniSkip: SkipTimes | null = null;
  if (malId) {
    aniSkip = await fetchAniSkipTimes(malId, ep, fetcher);
  }

  // 3. Merge AniSkip with any partial provider skip data
  const finalIntro = aniSkip?.intro ?? (pIntro && pIntro.start >= 0 && pIntro.end > pIntro.start ? pIntro : undefined);
  const finalOutro = aniSkip?.outro ?? (pOutro && pOutro.start >= 0 && pOutro.end > pOutro.start ? pOutro : undefined);
  const finalRecap = aniSkip?.recap;

  if (!finalIntro && !finalOutro && !finalRecap) {
    return undefined;
  }

  return {
    ...(finalIntro ? { intro: finalIntro } : {}),
    ...(finalOutro ? { outro: finalOutro } : {}),
    ...(finalRecap ? { recap: finalRecap } : {}),
  };
}
