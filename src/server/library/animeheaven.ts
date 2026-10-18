import type { EpisodeDetail, LibraryItem, LibraryKind, LibraryRow } from "../../shared";
import { FILMPIRE_TMDB_API_KEY } from "./filmpire";
import type { LibrarySource } from "./library";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BASE = "https://animeheaven.me";

export interface AnimeHeavenSourceOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  tmdbApiKey?: string;
}

export function parseAnimeHeavenLink(link: string): { slug: string } | null {
  try {
    const url = new URL(link);
    if (!/(^|\.)animeheaven\.me$/i.test(url.hostname)) return null;
    for (const [key, val] of url.searchParams.entries()) {
      if (val === "" && /^[a-z0-9]{4,10}$/i.test(key)) {
        return { slug: key };
      }
      if (key === "slug" || key === "id") {
        return { slug: val };
      }
    }
    const match = /anime\.php\?([a-z0-9]+)/i.exec(url.search);
    return match ? { slug: match[1]! } : null;
  } catch {
    return null;
  }
}

interface TmdbEpisodeInfo {
  name?: string;
  overview?: string;
  still?: string;
  runtime?: number;
}

interface TmdbSeasonCacheEntry {
  expires: number;
  episodes: Map<number, TmdbEpisodeInfo>;
  backdrop?: string;
  poster?: string;
}

const tmdbCache = new Map<string, TmdbSeasonCacheEntry>();

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function detectSeasonFromTitle(title: string): { cleanTitle: string; season: number } {
  const seasonMatch =
    title.match(/\bseason\s*(\d+)\b/i) ||
    title.match(/\b(\d+)(?:nd|rd|th|st)\s*season\b/i) ||
    title.match(/\bpart\s*(\d+)\b/i);

  const season = seasonMatch ? parseInt(seasonMatch[1]!, 10) : 1;
  const cleanTitle = title
    .replace(/\s*\((?:Dub|Sub|TV|Movie)\)/gi, "")
    .replace(/\b(?:Season\s*\d+|\d+(?:nd|rd|th|st)\s*Season|Part\s*\d+)\b/gi, "")
    .replace(/\s*:\s*$/, "")
    .trim();

  return { cleanTitle: cleanTitle || title, season };
}

export async function fetchTmdbAnimeSeasonDetails(
  title: string,
  targetSeason: number,
  apiKey: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ episodes: Map<number, TmdbEpisodeInfo>; backdrop?: string; poster?: string } | null> {
  const cacheKey = `${title.toLowerCase()}|${targetSeason}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached;
  }

  try {
    const { cleanTitle, season: detectedSeason } = detectSeasonFromTitle(title);
    const seasonToFetch = targetSeason > 1 ? targetSeason : detectedSeason;

    const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}&language=en-US`;
    const searchRes = await fetcher(searchUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as { results?: Array<{ id: number; name: string; backdrop_path?: string | null; poster_path?: string | null }> };
    const show = searchData.results?.[0];
    if (!show?.id) return null;

    const backdrop = show.backdrop_path ? `https://image.tmdb.org/t/p/w780${show.backdrop_path}` : undefined;
    const poster = show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined;

    const seasonUrl = `https://api.themoviedb.org/3/tv/${show.id}/season/${seasonToFetch}?api_key=${apiKey}&language=en-US`;
    const seasonRes = await fetcher(seasonUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!seasonRes.ok) return null;
    const seasonData = (await seasonRes.json()) as {
      episodes?: Array<{
        episode_number: number;
        name?: string | null;
        overview?: string | null;
        still_path?: string | null;
        runtime?: number | null;
      }>;
    };

    const episodesMap = new Map<number, TmdbEpisodeInfo>();
    if (seasonData.episodes) {
      for (const ep of seasonData.episodes) {
        episodesMap.set(ep.episode_number, {
          name: ep.name ? decodeHtmlEntities(ep.name) : undefined,
          overview: ep.overview ? decodeHtmlEntities(ep.overview) : undefined,
          still: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : undefined,
          runtime: ep.runtime && ep.runtime > 0 ? ep.runtime : undefined,
        });
      }
    }

    const entry = {
      expires: Date.now() + 3600_000,
      episodes: episodesMap,
      backdrop,
      poster,
    };
    tmdbCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

export function animeHeavenSource(options: AnimeHeavenSourceOptions = {}): LibrarySource {
  const get = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const tmdbApiKey = options.tmdbApiKey ?? FILMPIRE_TMDB_API_KEY;

  const fetchHtml = async (path: string): Promise<string> => {
    const url = path.startsWith("http") ? path : `${BASE}/${path.replace(/^\//, "")}`;
    const res = await get(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AnimeHeaven error: HTTP ${res.status}`);
    return res.text();
  };

  const animeProbeCache = new Map<string, { at: number; hasEpisodes: boolean }>();

  const probeAnimeEpisodes = async (slug: string): Promise<boolean> => {
    const cached = animeProbeCache.get(slug);
    if (cached && Date.now() - cached.at < 3600_000) return cached.hasEpisodes;
    try {
      const animeHtml = await fetchHtml(`anime.php?${slug}`);
      const hasEpisodes = /<a[^>]+id\s*=\s*['"][a-f0-9]{32}['"]/i.test(animeHtml);
      animeProbeCache.set(slug, { at: Date.now(), hasEpisodes });
      return hasEpisodes;
    } catch {
      return false;
    }
  };

  const parseItemCards = (html: string): LibraryItem[] => {
    const items: LibraryItem[] = [];
    const seen = new Set<string>();

    const p1Blocks = [...html.matchAll(/<div class=['"]p1['"]>([\s\S]*?)<\/div>/gi)];
    for (const m of p1Blocks) {
      const block = m[1]!;
      const slug = block.match(/href=['"]anime\.php\?([a-z0-9]+)['"]/i)?.[1];
      if (!slug || seen.has(slug)) continue;

      const imgPath = block.match(/<img[^>]+src=['"]([^'"]+)['"]/i)?.[1];
      if (!imgPath) continue; // Must have an image

      const rawTitle = (
        block.match(/alt=['"]([^'"]+)['"]/i)?.[1] ||
        block.match(/class=['"]similarname[^'"]*['"]>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1] ||
        block.match(/class=['"]c['"][^>]*>([^<]+)<\/a>/i)?.[1]
      )?.replace(/Anime Poster/i, "").trim();

      if (!rawTitle) continue;
      seen.add(slug);

      const image = imgPath.startsWith("http") ? imgPath : `${BASE}/${imgPath.replace(/^\//, "")}`;
      items.push({
        id: `animeheaven-series-${slug}`,
        title: decodeHtmlEntities(rawTitle),
        kind: "series",
        image,
        url: `${BASE}/anime.php?${slug}&s=1&e=1`,
      });
    }

    return items;
  };

  return {
    id: "animeheaven",
    name: "AnimeHeaven",
    async load(): Promise<LibraryRow[]> {
      const [popularHtml, newHtml] = await Promise.all([
        fetchHtml("popular.php").catch(() => ""),
        fetchHtml("new.php").catch(() => ""),
      ]);

      const rows: LibraryRow[] = [];
      if (popularHtml) {
        const popItems = parseItemCards(popularHtml);
        if (popItems.length > 0) {
          rows.push({
            id: "animeheaven-popular",
            title: "Trending Anime",
            source: "AnimeHeaven",
            kind: "series",
            items: popItems.slice(0, 30),
          });
        }
      }

      if (newHtml) {
        const newItems = parseItemCards(newHtml);
        if (newItems.length > 0) {
          rows.push({
            id: "animeheaven-new",
            title: "New Anime Releases",
            source: "AnimeHeaven",
            kind: "series",
            items: newItems.slice(0, 30),
          });
        }
      }

      return rows;
    },
    async search(query: string): Promise<LibraryItem[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        const html = await fetchHtml(`search.php?s=${encodeURIComponent(q)}`);
        const candidates = parseItemCards(html);
        if (candidates.length === 0) return [];

        const verified = await Promise.all(
          candidates.slice(0, 15).map(async (item) => {
            const slug = parseAnimeHeavenLink(item.url)?.slug;
            if (!slug) return null;
            const hasEp = await probeAnimeEpisodes(slug);
            return hasEp ? item : null;
          })
        );

        return verified.filter((item): item is LibraryItem => item !== null && Boolean(item.image));
      } catch {
        return [];
      }
    },
    async seasons(link: string): Promise<number[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed) return [];
      return [1];
    },
    async episodes(link: string, season: number): Promise<EpisodeDetail[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed || season !== 1) return [];

      try {
        const html = await fetchHtml(`anime.php?${parsed.slug}`);

        // 1. Extract show metadata from page
        const titleMatch =
          /<div class=['"]infotitle[^'"]*['"]>([\s\S]*?)<\/div>/i.exec(html) ||
          /<meta\s+property=['"]og:title['"]\s+content=['"]([^'"]+)['"]/i.exec(html);
        const rawTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]!.replace(/<[^>]+>/g, "")) : "";

        const posterMatch =
          /<img[^>]+class=['"]posterimg['"][^>]+src=['"]([^'"]+)['"]/i.exec(html) ||
          /<meta\s+property=['"]og:image['"]\s+content=['"]([^'"]+)['"]/i.exec(html);
        let showPoster = posterMatch ? posterMatch[1]!.trim() : undefined;
        if (showPoster && !showPoster.startsWith("http")) {
          showPoster = `${BASE}/${showPoster.replace(/^\//, "")}`;
        }

        const descMatch = /<div class=['"]infodes[^'"]*['"]>([\s\S]*?)<\/div>/i.exec(html);
        const showOverview = descMatch ? decodeHtmlEntities(descMatch[1]!.replace(/<[^>]+>/g, "")) : undefined;

        // 2. Parse episode links
        const epMatches = [...html.matchAll(/<a[^>]+id\s*=\s*['"]([a-f0-9]{32})['"][^>]*>([\s\S]*?)<\/a>/g)];
        const rawEpisodes: Array<{ epNum: number; key: string }> = [];

        for (const m of epMatches) {
          const key = m[1]!;
          const epNum = Number(m[2]!.match(/watch2[^>]*>(\d+)<\/div>/)?.[1] || "1");
          rawEpisodes.push({ epNum, key });
        }
        rawEpisodes.sort((a, b) => a.epNum - b.epNum);

        // 3. Attempt TMDB enrichment
        const tmdbData = rawTitle
          ? await fetchTmdbAnimeSeasonDetails(rawTitle, season, tmdbApiKey, get, timeoutMs)
          : null;

        const result: EpisodeDetail[] = [];
        for (const ep of rawEpisodes) {
          const tmdbEp = tmdbData?.episodes.get(ep.epNum);
          const still = tmdbEp?.still || tmdbData?.backdrop || tmdbData?.poster || showPoster;
          const overview = tmdbEp?.overview || showOverview;
          const title = tmdbEp?.name ? tmdbEp.name : `Episode ${ep.epNum}`;

          result.push({
            season: 1,
            episode: ep.epNum,
            title,
            ...(overview ? { overview: overview.slice(0, 400) } : {}),
            ...(still ? { still } : {}),
            ...(tmdbEp?.runtime ? { runtime: tmdbEp.runtime } : {}),
            url: `${BASE}/anime.php?${parsed.slug}&s=1&e=${ep.epNum}&key=${ep.key}`,
          });
        }

        return result;
      } catch {
        return [];
      }
    },
    async similar(link: string): Promise<LibraryItem[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed) return [];
      try {
        const html = await fetchHtml(`anime.php?${parsed.slug}`);
        // Similar anime items appear under <div class='similarimg'>
        const simIdx = html.indexOf("class='similarimg'") || html.indexOf('class="similarimg"');
        if (simIdx !== -1) {
          return parseItemCards(html.slice(simIdx));
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}
