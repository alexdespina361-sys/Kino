import { z } from "zod";
import type { LibraryItem, LibraryRow } from "../../shared";
import type { LibrarySource } from "./library";

export const FILMPIRE_TMDB_API_KEY = "90b2cae8d7161e8ba0f3836240d7d352";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export interface FilmpireCategory {
  id: string;
  title: string;
  path: string;
  type: "movie" | "tv";
}

export const FILMPIRE_CATEGORIES: FilmpireCategory[] = [
  { id: "trending-movies", title: "Trending Movies", path: "/trending/movie/week", type: "movie" },
  { id: "trending-tv", title: "Trending Series", path: "/trending/tv/week", type: "tv" },
  { id: "popular-movies", title: "Popular Movies", path: "/movie/popular?language=en-US&page=1", type: "movie" },
  { id: "popular-tv", title: "Popular Series", path: "/tv/popular?language=en-US&page=1", type: "tv" },
  { id: "top-rated-movies", title: "Top Rated Movies", path: "/movie/top_rated?language=en-US&page=1", type: "movie" },
  { id: "animation-tv", title: "Animation & Anime", path: "/discover/tv?with_genres=16", type: "tv" },
  { id: "action-movies", title: "Action & Sci-Fi", path: "/discover/movie?with_genres=878", type: "movie" },
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
  const description = doc.overview ? doc.overview.trim().slice(0, 400) : undefined;
  const url = isTv ? `https://filmpire.sc/watch/${doc.id}?s=1&e=1` : `https://filmpire.sc/watch/${doc.id}`;

  return {
    id: `filmpire-${isTv ? "tv" : "movie"}-${doc.id}`,
    title: title.slice(0, 300),
    ...(validYear ? { year: validYear } : {}),
    ...(poster ? { image: poster } : {}),
    ...(description ? { description } : {}),
    url,
  };
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
  };
}
