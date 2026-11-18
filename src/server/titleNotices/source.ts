import { z } from "zod";
import { FILMPIRE_TMDB_API_KEY } from "../library/filmpire";
import { providerFetch } from "../resolvers/providerFetch";

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const TIMEOUT_MS = 8_000;
const HOME_RELEASES = new Set([4, 5, 6]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AiredEpisode {
  season: number;
  episode: number;
  day?: string;
}

export interface ShowNow {
  name: string;
  image?: string;
  backdrop?: string;
  year?: number;
  ended: boolean;
  last: AiredEpisode | null;
  nextDay?: string;
}

export interface FilmNow {
  name: string;
  collection?: number;
}

export interface FilmPart {
  id: number;
  name: string;
  image?: string;
  backdrop?: string;
  year?: number;
  day?: string;
}

export interface TitleSource {
  show(id: number): Promise<ShowNow | null>;
  film(id: number): Promise<FilmNow | null>;
  parts(collection: number): Promise<FilmPart[] | null>;
  outAtHome(id: number, now: number): Promise<boolean>;
}

const EpisodeSchema = z.object({ season_number: z.number().int(), episode_number: z.number().int(), air_date: z.string().nullish() });
const ShowSchema = z.object({
  name: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  first_air_date: z.string().nullish(),
  status: z.string().nullish(),
  last_episode_to_air: EpisodeSchema.nullish().catch(null),
  next_episode_to_air: z.object({ air_date: z.string().nullish() }).nullish().catch(null),
});
const FilmSchema = z.object({ title: z.string().nullish(), belongs_to_collection: z.object({ id: z.number().int() }).nullish().catch(null) });
const PartsSchema = z.object({
  parts: z
    .array(z.object({ id: z.number().int(), title: z.string().nullish(), poster_path: z.string().nullish(), backdrop_path: z.string().nullish(), release_date: z.string().nullish() }))
    .catch([]),
});
const ReleaseDatesSchema = z.object({
  results: z.array(z.object({ release_dates: z.array(z.object({ type: z.number().optional(), release_date: z.string().optional() })).catch([]) })).catch([]),
});

const dayOf = (text: string | null | undefined): string | undefined => (text && DAY.test(text) ? text : undefined);
const yearOf = (text: string | null | undefined): number | undefined => (dayOf(text) ? Number(text!.slice(0, 4)) : undefined);
const pictures = (doc: { poster_path?: string | null | undefined; backdrop_path?: string | null | undefined }) => ({
  ...(doc.poster_path ? { image: `${IMAGE_BASE}${doc.poster_path}` } : {}),
  ...(doc.backdrop_path ? { backdrop: `${BACKDROP_BASE}${doc.backdrop_path}` } : {}),
});

export function showNowOf(raw: unknown): ShowNow {
  const doc = ShowSchema.parse(raw);
  const last = doc.last_episode_to_air;
  const year = yearOf(doc.first_air_date);
  const nextDay = dayOf(doc.next_episode_to_air?.air_date);
  const day = dayOf(last?.air_date);
  return {
    name: (doc.name ?? "").slice(0, 300),
    ...pictures(doc),
    ...(year ? { year } : {}),
    ended: doc.status === "Ended" || doc.status === "Canceled",
    last: last && last.season_number >= 1 && last.season_number <= 200 && last.episode_number >= 1 && last.episode_number <= 5000 ? { season: last.season_number, episode: last.episode_number, ...(day ? { day } : {}) } : null,
    ...(nextDay ? { nextDay } : {}),
  };
}

export function tmdbTitleSource(options: { fetch?: typeof fetch; apiKey?: string } = {}): TitleSource {
  const get = options.fetch ?? providerFetch();
  const apiKey = options.apiKey ?? FILMPIRE_TMDB_API_KEY;
  const ask = async (path: string): Promise<unknown | null> => {
    const res = await get(`${BASE_URL}/${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`the movie database: HTTP ${res.status}`);
    return res.json();
  };
  return {
    async show(id) {
      const raw = await ask(`tv/${id}?language=en-US`);
      return raw === null ? null : showNowOf(raw);
    },
    async film(id) {
      const raw = await ask(`movie/${id}?language=en-US`);
      if (raw === null) return null;
      const doc = FilmSchema.parse(raw);
      return { name: (doc.title ?? "").slice(0, 300), ...(doc.belongs_to_collection ? { collection: doc.belongs_to_collection.id } : {}) };
    },
    async parts(collection) {
      const raw = await ask(`collection/${collection}?language=en-US`);
      if (raw === null) return null;
      return PartsSchema.parse(raw).parts.map((part) => {
        const day = dayOf(part.release_date);
        const year = yearOf(part.release_date);
        return { id: part.id, name: (part.title ?? "").slice(0, 300), ...pictures(part), ...(year ? { year } : {}), ...(day ? { day } : {}) };
      });
    },
    async outAtHome(id, now) {
      const raw = await ask(`movie/${id}/release_dates`);
      if (raw === null) return false;
      const by = new Date(now).toISOString();
      return ReleaseDatesSchema.parse(raw).results.some((country) => country.release_dates.some((release) => release.type !== undefined && HOME_RELEASES.has(release.type) && !!release.release_date && release.release_date <= by));
    },
  };
}
