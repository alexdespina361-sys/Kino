import { z } from "zod";
import type { EpisodeDetail, LibraryItem, LibraryRow } from "../../shared";
import type { LibrarySource } from "./library";

export const FILMPIRE_TMDB_API_KEY = process.env.TMDB_API_KEY ?? "90b2cae8d7161e8ba0f3836240d7d352";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const STILL_BASE = "https://image.tmdb.org/t/p/w300";

export interface FilmpireCategory {
  id: string;
  title: string;
  path: string;
  type: "movie" | "tv";
}

export const FILMPIRE_CATEGORIES: FilmpireCategory[] = [
  // Trending & Highlights
  { id: "trending-movies", title: "Trending Movies", path: "/trending/movie/week", type: "movie" },
  { id: "trending-tv", title: "Trending Series", path: "/trending/tv/week", type: "tv" },
  { id: "popular-movies", title: "Popular Movies", path: "/movie/popular?language=en-US&page=1", type: "movie" },
  { id: "popular-tv", title: "Popular Series", path: "/tv/popular?language=en-US&page=1", type: "tv" },
  { id: "top-rated-movies", title: "Top Rated Movies", path: "/movie/top_rated?language=en-US&page=1", type: "movie" },
  { id: "top-rated-tv", title: "Best Rated TV Series", path: "/tv/top_rated?language=en-US&page=1", type: "tv" },

  // Movies by Genre (from explore-movies)
  { id: "action-movies", title: "Action Movies", path: "/discover/movie?with_genres=28&sort_by=popularity.desc", type: "movie" },
  { id: "scifi-movies", title: "Sci-Fi Movies", path: "/discover/movie?with_genres=878&sort_by=popularity.desc", type: "movie" },
  { id: "comedy-movies", title: "Comedy Movies", path: "/discover/movie?with_genres=35&sort_by=popularity.desc", type: "movie" },
  { id: "horror-movies", title: "Horror Movies", path: "/discover/movie?with_genres=27&sort_by=popularity.desc", type: "movie" },
  { id: "animation-movies", title: "Animated Movies", path: "/discover/movie?with_genres=16&sort_by=popularity.desc", type: "movie" },
  { id: "thriller-movies", title: "Thriller Movies", path: "/discover/movie?with_genres=53&sort_by=popularity.desc", type: "movie" },
  { id: "adventure-movies", title: "Adventure Movies", path: "/discover/movie?with_genres=12&sort_by=popularity.desc", type: "movie" },
  { id: "crime-movies", title: "Crime Movies", path: "/discover/movie?with_genres=80&sort_by=popularity.desc", type: "movie" },
  { id: "fantasy-movies", title: "Fantasy Movies", path: "/discover/movie?with_genres=14&sort_by=popularity.desc", type: "movie" },
  { id: "drama-movies", title: "Drama Movies", path: "/discover/movie?with_genres=18&sort_by=popularity.desc", type: "movie" },
  { id: "mystery-movies", title: "Mystery Movies", path: "/discover/movie?with_genres=9648&sort_by=popularity.desc", type: "movie" },
  { id: "romance-movies", title: "Romance Movies", path: "/discover/movie?with_genres=10749&sort_by=popularity.desc", type: "movie" },
  { id: "family-movies", title: "Family Movies", path: "/discover/movie?with_genres=10751&sort_by=popularity.desc", type: "movie" },
  { id: "documentary-movies", title: "Documentary Movies", path: "/discover/movie?with_genres=99&sort_by=popularity.desc", type: "movie" },

  // Series by Genre (from explore-series)
  { id: "action-adventure-tv", title: "Action & Adventure Series", path: "/discover/tv?with_genres=10759&sort_by=popularity.desc", type: "tv" },
  { id: "scifi-fantasy-tv", title: "Sci-Fi & Fantasy Series", path: "/discover/tv?with_genres=10765&sort_by=popularity.desc", type: "tv" },
  { id: "animation-anime-tv", title: "Animation & Anime Series", path: "/discover/tv?with_genres=16&sort_by=popularity.desc", type: "tv" },
  { id: "comedy-tv", title: "Comedy Series", path: "/discover/tv?with_genres=35&sort_by=popularity.desc", type: "tv" },
  { id: "crime-tv", title: "Crime Series", path: "/discover/tv?with_genres=80&sort_by=popularity.desc", type: "tv" },
  { id: "drama-tv", title: "Drama Series", path: "/discover/tv?with_genres=18&sort_by=popularity.desc", type: "tv" },
  { id: "mystery-tv", title: "Mystery Series", path: "/discover/tv?with_genres=9648&sort_by=popularity.desc", type: "tv" },
  { id: "kids-tv", title: "Kids & Family Shows", path: "/discover/tv?with_genres=10762&sort_by=popularity.desc", type: "tv" },
  { id: "documentary-tv", title: "Docuseries", path: "/discover/tv?with_genres=99&sort_by=popularity.desc", type: "tv" },
];

export interface FilmpireSourceOptions {
  apiKey?: string;
  categories?: FilmpireCategory[];
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const TmdbItemSchema = z.object({
  id: z.number().int(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  overview: z.string().optional(),
  media_type: z.enum(["movie", "tv", "person"]).optional(),
});

const TmdbResponseSchema = z.object({
  results: z.array(z.unknown()),
});

const TmdbSeasonSchema = z.object({
  episodes: z.array(
    z.object({
      season_number: z.number().int().optional(),
      episode_number: z.number().int(),
      name: z.string().optional(),
      overview: z.string().optional(),
      still_path: z.string().nullable().optional(),
      runtime: z.number().nullable().optional(),
    }),
  ),
});

function toLibraryItem(raw: unknown, defaultType?: "movie" | "tv"): LibraryItem | null {
  const parsed = TmdbItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data;
  if (doc.media_type === "person") return null;

  const title = (doc.title || doc.name)?.trim();
  if (!title) return null;

  const isTv = doc.media_type ? doc.media_type === "tv" : (defaultType ? defaultType === "tv" : Boolean(doc.first_air_date));
  const rawDate = doc.release_date || doc.first_air_date;
  const year = rawDate ? Number.parseInt(rawDate.slice(0, 4), 10) : undefined;
  const validYear = Number.isInteger(year) && year! > 1800 ? year : undefined;

  const poster = doc.poster_path ? `${IMAGE_BASE}${doc.poster_path}` : (doc.backdrop_path ? `${IMAGE_BASE}${doc.backdrop_path}` : undefined);
  const backdrop = doc.backdrop_path ? `${BACKDROP_BASE}${doc.backdrop_path}` : undefined;
  const description = doc.overview ? doc.overview.trim().slice(0, 400) : undefined;
  const url = isTv ? `https://filmpire.sc/watch/${doc.id}?s=1&e=1` : `https://filmpire.sc/watch/${doc.id}`;

  return {
    id: `filmpire-${isTv ? "tv" : "movie"}-${doc.id}`,
    title: title.slice(0, 300),
    ...(validYear ? { year: validYear } : {}),
    ...(poster ? { image: poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(description ? { description } : {}),
    kind: isTv ? "series" : "movie",
    url,
  };
}

/** The TMDB id and kind of a title from its Filmpire link (`/watch/603`, or `/watch/1399?s=1&e=1` for a show), or null for any other link. */
function parseWatchLink(link: string): { id: number; type: "movie" | "tv" } | null {
  try {
    const url = new URL(link);
    const match = /^\/watch\/(\d+)$/.exec(url.pathname);
    if (!match || !/(^|\.)filmpire\.sc$/.test(url.hostname)) return null;
    return { id: Number(match[1]), type: url.searchParams.has("s") ? "tv" : "movie" };
  } catch {
    return null;
  }
}

export function filmpireSource(options: FilmpireSourceOptions = {}): LibrarySource {
  const apiKey = options.apiKey ?? FILMPIRE_TMDB_API_KEY;
  const categories = options.categories ?? FILMPIRE_CATEGORIES;
  const get = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const loadCategory = async (cat: FilmpireCategory): Promise<LibraryRow> => {
    const separator = cat.path.includes("?") ? "&" : "?";
    const fullUrl = `${BASE_URL}${cat.path}${separator}api_key=${apiKey}`;

    const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${cat.id}: HTTP ${res.status}`);
    const data = TmdbResponseSchema.parse(await res.json());

    const items = data.results
      .map((item) => toLibraryItem(item, cat.type))
      .filter((item): item is LibraryItem => item !== null);

    return {
      id: `filmpire-${cat.id}`,
      title: cat.title,
      source: "Filmpire",
      kind: cat.type === "tv" ? "series" : "movie",
      items,
    };
  };

  return {
    id: "filmpire",
    name: "Filmpire",
    async load() {
      const settled = await Promise.allSettled(categories.map(loadCategory));
      const loaded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (loaded.length === 0 && failed) throw failed.reason;
      return loaded;
    },
    async search(queryText: string): Promise<LibraryItem[]> {
      const q = queryText.trim();
      if (!q) return [];
      try {
        const fullUrl = `${BASE_URL}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}`;
        const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
        if (!res.ok) return [];
        const data = TmdbResponseSchema.parse(await res.json());
        return data.results
          .map((item) => toLibraryItem(item))
          .filter((item): item is LibraryItem => item !== null);
      } catch {
        return [];
      }
    },
    async similar(link: string): Promise<LibraryItem[]> {
      const title = parseWatchLink(link);
      if (!title) return [];
      try {
        const fullUrl = `${BASE_URL}/${title.type}/${title.id}/recommendations?api_key=${apiKey}&language=en-US&page=1`;
        const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
        if (!res.ok) return [];
        const data = TmdbResponseSchema.parse(await res.json());
        return data.results
          .map((item) => toLibraryItem(item, title.type))
          .filter((item): item is LibraryItem => item !== null);
      } catch {
        return [];
      }
    },
    async episodes(link: string, season: number): Promise<EpisodeDetail[]> {
      const title = parseWatchLink(link);
      if (title?.type !== "tv") return [];
      try {
        const fullUrl = `${BASE_URL}/tv/${title.id}/season/${season}?api_key=${apiKey}&language=en-US`;
        const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
        if (!res.ok) return [];
        return TmdbSeasonSchema.parse(await res.json()).episodes.map((episode) => {
          const name = episode.name?.trim();
          const overview = episode.overview?.trim();
          return {
            season,
            episode: episode.episode_number,
            ...(name ? { title: name.slice(0, 200) } : {}),
            ...(overview ? { overview: overview.slice(0, 400) } : {}),
            ...(episode.still_path ? { still: `${STILL_BASE}${episode.still_path}` } : {}),
            ...(episode.runtime && episode.runtime > 0 ? { runtime: Math.min(1000, Math.round(episode.runtime)) } : {}),
          };
        });
      } catch {
        return [];
      }
    },
  };
}
