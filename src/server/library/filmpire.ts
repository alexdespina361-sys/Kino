import { z } from "zod";
import { AGE_COUNTRIES, sectionOf, type EpisodeDetail, type LibraryItem, type LibraryRow, type LibrarySection, type TitleAbout } from "../../shared";
import { remember } from "../boundedMap";
import { hasRomanianDub, hasRomanianDubSync, romanianDubsOn } from "../dubs/romanian";
import { providerFetch } from "../resolvers/providerFetch";
import type { LibrarySource } from "./library";
import { ANIMATION_GENRE, animated, SHELF_GROUPS, sectionOfCategory, shelfPlan, UNSCRIPTED_TV_GENRES, type FilmpireCategory } from "./shelves";

export type { FilmpireCategory };

export const FILMPIRE_TMDB_API_KEY = process.env.TMDB_API_KEY ?? "90b2cae8d7161e8ba0f3836240d7d352";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const STILL_BASE = "https://image.tmdb.org/t/p/w300";

/** TMDB gives twenty titles to a page and will not go past the 500th; a row is asked for this many pages at most (300 titles). */
export const MAX_PAGE = 15;
/** How many shelves one question about the rows after the first ones brings. */
export const SHELF_BATCH = 5;

/** Today as TMDB writes a date, to tell what has not come out yet. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Stands for today in a category's path: `pageUrl` writes the day each question is asked. (Written once as the server started, the date stayed that day for as
 * long as it ran - days - and what came out since was left out of the rows.)
 */
export const TODAY = "{today}";

const MOVIE_DISCOVER_FILTER = `primary_release_date.lte=${TODAY}&vote_count.gte=10`;
const TV_DISCOVER_FILTER = `first_air_date.lte=${TODAY}&vote_count.gte=5`;

/** What the lists of Movies and Series that TMDB can sort by genre are asked not to have: animation is in the Cartoons and the Anime (the trending, popular and top lists cannot be asked that way, so `askPage` takes it out of them). */
const NO_ANIMATION = `without_genres=${ANIMATION_GENRE}`;

/**
 * The first rows of the library: Home's and, among them, the first of each page of a section (Movies, Series, Cartoons, Anime), in the
 * order Home lists them. A category is in the section it says, else in the live-action one of its type.
 */
export const FILMPIRE_CATEGORIES: FilmpireCategory[] = [
  // Trending & Highlights
  { id: "trending-movies", title: "Trending Movies", path: "/trending/movie/week", type: "movie" },
  { id: "trending-tv", title: "Trending Series", path: "/trending/tv/week", type: "tv" },
  { id: "popular-movies", title: "Popular Movies", path: "/movie/popular?language=en-US&page=1", type: "movie" },
  { id: "popular-tv", title: "Popular Series", path: "/tv/popular?language=en-US&page=1", type: "tv" },
  { id: "top-rated-movies", title: "Top Rated Movies", path: "/movie/top_rated?language=en-US&page=1", type: "movie" },
  { id: "top-rated-tv", title: "Best Rated TV Series", path: "/tv/top_rated?language=en-US&page=1", type: "tv" },

  // Movies by Genre (from explore-movies)
  { id: "action-movies", title: "Action Movies", path: `/discover/movie?with_genres=28&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "scifi-movies", title: "Sci-Fi Movies", path: `/discover/movie?with_genres=878&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "comedy-movies", title: "Comedy Movies", path: `/discover/movie?with_genres=35&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "horror-movies", title: "Horror Movies", path: `/discover/movie?with_genres=27&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "thriller-movies", title: "Thriller Movies", path: `/discover/movie?with_genres=53&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "adventure-movies", title: "Adventure Movies", path: `/discover/movie?with_genres=12&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "crime-movies", title: "Crime Movies", path: `/discover/movie?with_genres=80&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "fantasy-movies", title: "Fantasy Movies", path: `/discover/movie?with_genres=14&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "drama-movies", title: "Drama Movies", path: `/discover/movie?with_genres=18&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "mystery-movies", title: "Mystery Movies", path: `/discover/movie?with_genres=9648&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "romance-movies", title: "Romance Movies", path: `/discover/movie?with_genres=10749&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "family-movies", title: "Family Movies", path: `/discover/movie?with_genres=10751&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },
  { id: "documentary-movies", title: "Documentary Movies", path: `/discover/movie?with_genres=99&${NO_ANIMATION}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie" },

  // Series by Genre (from explore-series)
  { id: "action-adventure-tv", title: "Action & Adventure Series", path: `/discover/tv?with_genres=10759&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "scifi-fantasy-tv", title: "Sci-Fi & Fantasy Series", path: `/discover/tv?with_genres=10765&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "comedy-tv", title: "Comedy Series", path: `/discover/tv?with_genres=35&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "crime-tv", title: "Crime Series", path: `/discover/tv?with_genres=80&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "drama-tv", title: "Drama Series", path: `/discover/tv?with_genres=18&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "mystery-tv", title: "Mystery Series", path: `/discover/tv?with_genres=9648&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "kids-tv", title: "Kids & Family Shows", path: `/discover/tv?with_genres=10762&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },
  { id: "documentary-tv", title: "Docuseries", path: `/discover/tv?with_genres=99&${NO_ANIMATION}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv" },

  // Cartoons: the first rows of their page (the ones that come after are the shelves, see shelves.ts)
  { id: "cartoon-tv", title: "Popular Cartoon Series", path: `/discover/tv?${animated("cartoon")}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv", section: "cartoon" },
  { id: "cartoon-movies", title: "Popular Cartoon Movies", path: `/discover/movie?${animated("cartoon")}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie", section: "cartoon" },
  { id: "cartoon-top-tv", title: "Top Rated Cartoon Series", path: `/discover/tv?${animated("cartoon")}&vote_count.gte=300&sort_by=vote_average.desc`, type: "tv", section: "cartoon" },
  { id: "cartoon-top-movies", title: "Top Rated Cartoon Movies", path: `/discover/movie?${animated("cartoon")}&vote_count.gte=1000&sort_by=vote_average.desc`, type: "movie", section: "cartoon" },
  { id: "cartoon-kids-tv", title: "Kids' Cartoons", path: `/discover/tv?${animated("cartoon", 10762)}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv", section: "cartoon" },
  { id: "cartoon-family-movies", title: "Family Cartoon Movies", path: `/discover/movie?${animated("cartoon", 10751)}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie", section: "cartoon" },

  // Anime: the same, of Japanese animation
  { id: "anime-series", title: "Popular Anime Series", path: `/discover/tv?${animated("anime")}&${TV_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "tv", section: "anime" },
  { id: "anime-films", title: "Popular Anime Movies", path: `/discover/movie?${animated("anime")}&${MOVIE_DISCOVER_FILTER}&sort_by=popularity.desc`, type: "movie", section: "anime" },
  { id: "anime-top-tv", title: "Top Rated Anime Series", path: `/discover/tv?${animated("anime")}&vote_count.gte=200&sort_by=vote_average.desc`, type: "tv", section: "anime" },
  { id: "anime-top-movies", title: "Top Rated Anime Movies", path: `/discover/movie?${animated("anime")}&vote_count.gte=300&sort_by=vote_average.desc`, type: "movie", section: "anime" },
];

export interface FilmpireSourceOptions {
  apiKey?: string;
  categories?: FilmpireCategory[];
  /** The shelves that come after the categories as the page is scrolled, in groups (see `shelfPlan`). */
  shelves?: ReadonlyArray<readonly FilmpireCategory[]>;
  fetch?: typeof fetch;
  probeFetch?: typeof fetch;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  /** How many video checks run at once (see PROBES_AT_ONCE). */
  probesAtOnce?: number;
  /** Whether to probe data.vidsrc.sh during search and drop 404/unplayable items. Default: true when no custom fetch is passed or when probeFetch is given. */
  verifyPlayback?: boolean;
  filterTrash?: boolean;
  now?: () => number;
}

export interface ProbeRecord {
  status: 200 | 404;
  seasons?: number[];
  seasonCounts?: Record<number, number>;
  checkedAt: number;
}

const MAX_PROBE_CACHE = 2000;
/** How many shows keep the seasons the video check told of (they come from what is searched, so the oldest go once there are more). */
export const MAX_PRELOADED_SEASONS = 2000;
const preloadedSeasons = new Map<number, number[]>();
const preloadedSeasonCounts = new Map<number, Record<number, number>>();
/**
 * The episodes of each season the video check last told of for a show, if it told: what the look-up of an episode (resolvers/adapters/filmpire.ts)
 * goes by when its own check has no answer in time, so a part is played as the list cut it.
 */
export const playerSeasonCounts = (id: number): Record<number, number> | undefined => preloadedSeasonCounts.get(id);
/** Notes down what the video check told of a show's seasons (see `playerSeasonCounts`). */
export const rememberPlayerSeasons = (id: number, counts: Record<number, number>): void => void remember(preloadedSeasonCounts, id, counts, MAX_PRELOADED_SEASONS);
export const knownTvIds = new Set<number>();
const PROBE_TTL_MS = 6 * 60 * 60 * 1000;
/** A film that came out this long ago or less is listed only once it has a home release (see `watchableNow`); an older one is taken to have one. */
export const RECENT_FILM_MS = 365 * 24 * 60 * 60 * 1000;
const HOME_TTL_MS = 12 * 60 * 60 * 1000;
const HOME_CHECKS_AT_ONCE = 8;
const HOME_WAIT_MS = 4_000;
const HOME_TIMEOUT_MS = 3_000;
/** TMDB's release types a film can be watched at home from: digital (4), physical (5), TV (6). */
const HOME_RELEASES: ReadonlySet<number> = new Set([4, 5, 6]);

/** How many video checks run at once, for all the searches of a source together (a search checks its first page, twenty titles, at once). */
export const PROBES_AT_ONCE = 16;
/** How long a video check waits for its turn: one that is not had by then is not made, and its title is kept, as when the check cannot be made. */
export const PROBE_WAIT_MS = 2_000;

/** At most `size` at once. A turn that is not had within the wait is not had at all. */
export class Slots {
  private busy = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly size: number) {}

  /** A turn (call what it gives back when it is over), or nothing when none came in `waitMs`. */
  take(waitMs: number): Promise<(() => void) | undefined> {
    if (this.busy < this.size) {
      this.busy += 1;
      return Promise.resolve(this.over());
    }
    return new Promise((resolve) => {
      const turn = () => {
        clearTimeout(timer);
        this.busy += 1;
        resolve(this.over());
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(turn);
        if (at >= 0) this.waiting.splice(at, 1);
        resolve(undefined);
      }, waitMs);
      this.waiting.push(turn);
    });
  }

  private over(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.busy -= 1;
      this.waiting.shift()?.();
    };
  }
}

export async function probePlayback(
  id: number,
  type: "movie" | "tv",
  fetcher: typeof fetch,
  cache: Map<string, ProbeRecord>,
  now: () => number = Date.now,
  timeoutMs = 1500,
  slots?: Slots,
  slotWaitMs = PROBE_WAIT_MS,
): Promise<{ ok: boolean; seasons?: number[]; seasonCounts?: Record<number, number> }> {
  const key = `${type}:${id}`;
  const cached = cache.get(key);
  if (cached && now() - cached.checkedAt < PROBE_TTL_MS) {
    return { ok: cached.status === 200, seasons: cached.seasons, seasonCounts: cached.seasonCounts };
  }
  // (The time of the check starts with its turn. One that had none is no answer: nothing is written down, and the title stays.)
  const over = slots ? await slots.take(slotWaitMs) : () => {};
  if (!over) return { ok: true };
  try {
    return await checkPlayback(id, type, fetcher, cache, now, timeoutMs, key);
  } finally {
    over();
  }
}

async function checkPlayback(
  id: number,
  type: "movie" | "tv",
  fetcher: typeof fetch,
  cache: Map<string, ProbeRecord>,
  now: () => number,
  timeoutMs: number,
  key: string,
): Promise<{ ok: boolean; seasons?: number[]; seasonCounts?: Record<number, number> }> {
  try {
    const res = await fetcher(`https://data.vidsrc.sh/api.php?type=${type}&tmdb=${id}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      if (cache.size >= MAX_PROBE_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { status: 404, checkedAt: now() });
      return { ok: false };
    }
    if (!res.ok) return { ok: true };
    const data = (await res.json()) as { status_code?: string | number; data?: { eps?: Record<string, unknown[]> } };
    const statusCode = String(data?.status_code ?? "");
    if (statusCode === "404") {
      if (cache.size >= MAX_PROBE_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { status: 404, checkedAt: now() });
      return { ok: false };
    }
    if (statusCode === "200") {
      let seasons: number[] | undefined;
      let seasonCounts: Record<number, number> | undefined;
      if (type === "tv" && data?.data?.eps) {
        seasons = Object.keys(data.data.eps)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1)
          .sort((a, b) => a - b);
        seasonCounts = {};
        for (const s of seasons) {
          const list = data.data.eps[String(s)];
          if (Array.isArray(list)) seasonCounts[s] = list.length;
        }
      }
      if (type === "tv") knownTvIds.add(id);
      if (cache.size >= MAX_PROBE_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(key, { status: 200, seasons, seasonCounts, checkedAt: now() });
      return { ok: true, seasons, seasonCounts };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

const TmdbItemSchema = z.object({
  id: z.number().int(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  overview: z.string().optional(),
  media_type: z.enum(["movie", "tv", "person"]).optional(),
  popularity: z.number().optional(),
  vote_count: z.number().optional(),
  /** What tells a cartoon or an anime from a film or a show: its genres, and where it was made. */
  genre_ids: z.array(z.number()).optional(),
  /** (A title's own page at TMDB, `/tv/1399`, says its genres this way instead of `genre_ids`.) */
  genres: z.array(z.object({ id: z.number().optional() }).passthrough()).optional().catch(undefined),
  original_language: z.string().optional(),
  origin_country: z.array(z.string()).optional(),
});

/**
 * The section of a title: animation is a Cartoon, or an Anime when it is Japanese (in its original language, or by its country); everything
 * else is a film or a show. Said by `LibraryItem.section` only when it is a Cartoon or an Anime.
 */
function animationOf(doc: z.infer<typeof TmdbItemSchema>): Extract<LibrarySection, "cartoon" | "anime"> | undefined {
  if (!hasGenre(doc, ANIMATION_GENRE)) return undefined;
  return doc.original_language === "ja" || doc.origin_country?.includes("JP") ? "anime" : "cartoon";
}

const hasGenre = (doc: z.infer<typeof TmdbItemSchema>, genre: number): boolean => Boolean(doc.genre_ids?.includes(genre) || doc.genres?.some((each) => each.id === genre));

/** TMDB's Family (films and shows) and Kids (shows) genres: animation filed under one of them is for children (`LibraryItem.kids`, the child profile's rule). */
const CHILDREN_GENRES = [10751, 10762] as const;
const forKids = (doc: z.infer<typeof TmdbItemSchema>): boolean => CHILDREN_GENRES.some((genre) => hasGenre(doc, genre));

/** Tells if a TV title is unscripted (News: 10763, Soap: 10766, Talk: 10767) which has no playback availability. Scripted content is kept. */
export const isUnscriptedTv = (doc: z.infer<typeof TmdbItemSchema>): boolean =>
  UNSCRIPTED_TV_GENRES.some((genre) => hasGenre(doc, genre));

/** How many titles of a page of TMDB's answers are taken: a page has twenty, and whatever more one says it has is not looked at (each title of a search's first page is checked for video). */
export const PAGE_TITLES = 20;

const TmdbResponseSchema = z.object({
  results: z.array(z.unknown()).transform((results) => results.slice(0, PAGE_TITLES)),
});

const TmdbSearchSchema = TmdbResponseSchema.extend({ total_pages: z.number().int().optional() });

/** A TMDB path with the page asked for (any `page` it had is replaced) and the key. */
export function pageUrl(path: string, page: number, apiKey: string): string {
  const [route = "", query = ""] = path.replaceAll(TODAY, today()).split("?");
  const rest = query.split("&").filter((part) => part && !part.startsWith("page=") && !part.startsWith("api_key="));
  return `${BASE_URL}${route}?${[...rest, `page=${page}`, `api_key=${apiKey}`].join("&")}`;
}

/** A search reads this many pages of TMDB's answers at most (twenty titles to a page): a word that begins many titles has more to show than the first twenty. */
const SEARCH_PAGES = 3;

const TmdbSeasonSchema = z.object({
  episodes: z.array(
    z.object({
      season_number: z.number().int().optional(),
      episode_number: z.number().int(),
      name: z.string().optional(),
      overview: z.string().optional(),
      still_path: z.string().nullable().optional(),
      runtime: z.number().nullable().optional(),
      air_date: z.string().nullable().optional(),
    }),
  ),
});

const TmdbShowSchema = z.object({
  seasons: z.array(z.object({ season_number: z.number().int(), episode_count: z.number().int().optional(), air_date: z.string().nullable().optional() })),
});
const TmdbReleaseDatesSchema = z.object({
  results: z.array(z.object({ release_dates: z.array(z.object({ type: z.number().optional(), release_date: z.string().nullish() })) })),
});
type TmdbEpisode = z.infer<typeof TmdbSeasonSchema>["episodes"][number];
/** A season of a show, and how many episodes it has. */
type ShowPart = { season: number; episodes: number };

/**
 * One title with what TMDB can append to its answer (`append_to_response`): the people, the age rating (a film's `release_dates`, a show's `content_ratings`)
 * and the titles like it, all in this one answer. Every field is optional: a title TMDB knows little of still has its page.
 */
const TmdbAboutSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  genres: z.array(z.object({ name: z.string() })).optional(),
  created_by: z.array(z.object({ name: z.string() })).optional(),
  belongs_to_collection: z.object({ id: z.number().int() }).nullish(),
  credits: z
    .object({
      cast: z.array(z.object({ name: z.string(), order: z.number().optional() })).optional(),
      crew: z.array(z.object({ name: z.string(), job: z.string().optional() })).optional(),
    })
    .optional(),
  release_dates: z
    .object({ results: z.array(z.object({ iso_3166_1: z.string(), release_dates: z.array(z.object({ certification: z.string().nullish(), type: z.number().optional() })) })) })
    .optional(),
  content_ratings: z.object({ results: z.array(z.object({ iso_3166_1: z.string(), rating: z.string().nullish() })) }).optional(),
  recommendations: z.object({ results: z.array(z.unknown()) }).optional(),
});

/** The titles of a collection (a film and its sequels). */
const TmdbCollectionSchema = z.object({ parts: z.array(z.unknown()) });

/** What a title's page lists of each kind at most. */
const ABOUT_MAX = { genres: 8, directors: 4, creators: 4, cast: 8, parts: 30, similar: 20 } as const;

/** The names in a list, each once, without the blank ones, no more than `max`. */
const namesOf = (list: ReadonlyArray<{ name: string }> | undefined, max: number): string[] => [...new Set((list ?? []).map((one) => one.name.trim().slice(0, 100)).filter(Boolean))].slice(0, max);

/** The age rating a country gives a title, as it writes it: a film's theatrical release first, else any release that has one. */
function ageIn(country: string, doc: z.infer<typeof TmdbAboutSchema>, type: "movie" | "tv"): string | undefined {
  if (type === "tv") return doc.content_ratings?.results.find((one) => one.iso_3166_1 === country)?.rating?.trim();
  const releases = doc.release_dates?.results.find((one) => one.iso_3166_1 === country)?.release_dates ?? [];
  return (releases.find((one) => one.certification && one.type === 3) ?? releases.find((one) => one.certification))?.certification?.trim();
}

/**
 * A tile of one of TMDB's titles. `listed` (a row, a search, the titles like another) also leaves out a show that is talk, news or a soap (hidden
 * for now: the owner, 17 Nov, undecided) and a stub nobody voted on; one title looked up by its id is never left out for those, so that a card
 * saved or sent in a chat, or a link to it, still opens (the judge, 17 Nov).
 */
function toLibraryItem(raw: unknown, defaultType?: "movie" | "tv", listed = true): LibraryItem | null {
  const parsed = TmdbItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data;
  if (doc.media_type === "person") return null;

  const title = (doc.title || doc.name)?.trim();
  if (!title) return null;

  const isTv = doc.media_type ? doc.media_type === "tv" : (defaultType ? defaultType === "tv" : Boolean(doc.first_air_date));
  if (listed && isTv && isUnscriptedTv(doc)) return null;
  if (isTv) knownTvIds.add(doc.id);
  const rawDate = doc.release_date || doc.first_air_date;
  if (rawDate && rawDate.slice(0, 10) > today()) return null; // not out yet: nothing to play
  if (listed && doc.vote_count === 0 && (!rawDate || (!doc.overview || doc.overview.trim().length < 20))) {
    return null;
  }
  const year = rawDate ? Number.parseInt(rawDate.slice(0, 4), 10) : undefined;
  const validYear = Number.isInteger(year) && year! > 1800 ? year : undefined;

  const poster = doc.poster_path ? `${IMAGE_BASE}${doc.poster_path}` : (doc.backdrop_path ? `${IMAGE_BASE}${doc.backdrop_path}` : undefined);
  const backdrop = doc.backdrop_path ? `${BACKDROP_BASE}${doc.backdrop_path}` : undefined;
  const description = doc.overview ? doc.overview.trim().slice(0, 400) : undefined;
  const url = isTv ? `https://filmpire.sc/watch/${doc.id}?s=1&e=1` : `https://filmpire.sc/watch/${doc.id}`;
  const section = animationOf(doc);
  const hasRoDub = romanianDubsOn() && hasRomanianDubSync({
    tmdbId: doc.id,
    type: isTv ? "tv" : "movie",
    title,
    originalTitle: doc.original_title || doc.original_name,
    year: validYear,
    isAnimation: section !== undefined,
  });

  return {
    id: `filmpire-${isTv ? "tv" : "movie"}-${doc.id}`,
    title: title.slice(0, 300),
    ...(validYear ? { year: validYear } : {}),
    ...(poster ? { image: poster } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(description ? { description } : {}),
    kind: isTv ? "series" : "movie",
    ...(section ? { section } : {}),
    url,
    ...(hasRoDub ? { hasRoDub: true } : {}),
    ...(section && forKids(doc) ? { kids: true as const } : {}), // (said of animation only: what a child profile may see, see `forChildren`)
  };
}

/** When a title came out, as TMDB writes it (a title without a date after the ones with). */
const releasedAt = (raw: unknown): string => {
  const found = TmdbItemSchema.safeParse(raw);
  return (found.success && (found.data.release_date || found.data.first_air_date)) || "9999";
};

/** The TMDB id and kind of a title from its Filmpire link (`/watch/603`, `/watch/1399?s=1&e=1`, or `/watch/1399?type=series`), or null for any other link. */
function parseWatchLink(link: string): { id: number; type: "movie" | "tv" } | null {
  try {
    const url = new URL(link);
    const match = /^\/watch\/(\d+)$/.exec(url.pathname);
    if (!match || !/(^|\.)filmpire\.(sc|cc)$/i.test(url.hostname)) return null;
    const id = Number(match[1]);
    const isTv =
      url.searchParams.has("s") ||
      url.searchParams.has("season") ||
      url.searchParams.has("e") ||
      url.searchParams.has("episode") ||
      url.searchParams.get("type") === "series" ||
      url.searchParams.get("type") === "tv" ||
      knownTvIds.has(id) ||
      preloadedSeasons.has(id) ||
      preloadedSeasonCounts.has(id);
    return { id, type: isTv ? "tv" : "movie" };
  } catch {
    return null;
  }
}

function isTrashItem(raw: unknown): boolean {
  const parsed = TmdbItemSchema.safeParse(raw);
  if (!parsed.success) return true;
  const doc = parsed.data;
  if (doc.media_type === "person") return true;
  const isTv = doc.media_type ? doc.media_type === "tv" : Boolean(doc.first_air_date);
  if (isTv && isUnscriptedTv(doc)) return true;
  const title = (doc.title || doc.name)?.trim();
  if (!title) return true;
  const lower = title.toLowerCase();
  if (lower.includes("podcast")) return true;
  if (!doc.poster_path && !doc.backdrop_path) {
    return true;
  }
  const rawDate = doc.release_date || doc.first_air_date;
  if (rawDate && rawDate.slice(0, 10) > today()) return true;
  if (doc.vote_count === 0 && (!rawDate || (!doc.overview || doc.overview.trim().length < 20))) {
    return true;
  }
  return false;
}

export function filmpireSource(options: FilmpireSourceOptions = {}): LibrarySource {
  const apiKey = options.apiKey ?? FILMPIRE_TMDB_API_KEY;
  const categories = options.categories ?? FILMPIRE_CATEGORIES;
  const get = options.fetch ?? providerFetch();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const probeCache = new Map<string, ProbeRecord>();
  const now = options.now ?? Date.now;
  const shouldVerify = options.verifyPlayback ?? (process.env.FILTER_UNPLAYABLE !== "0" && (!options.fetch || options.probeFetch !== undefined));
  const shouldFilterTrash = options.filterTrash ?? (process.env.FILTER_TRASH !== "0" && (!options.fetch || options.probeFetch !== undefined));
  const probeFetcher = options.probeFetch ?? get;
  const probeTimeout = options.probeTimeoutMs ?? 1500;
  const probeSlots = new Slots(options.probesAtOnce ?? PROBES_AT_ONCE);

  /**
   * What TMDB says of a show's seasons: those from 1 on with episodes, out by today, in order, with how many episodes each has. Remembered for six
   * hours, for so many shows. Null for a show TMDB does not know; it throws when TMDB cannot be asked, so that nothing is remembered.
   */
  const shows = new Map<number, { at: number; seasons: ShowPart[] }>();
  const showOf = async (id: number): Promise<ShowPart[] | null> => {
    const kept = shows.get(id);
    if (kept && now() - kept.at < PROBE_TTL_MS) return kept.seasons;
    // (A place that cannot be reached throws, so the question is asked again next time instead of "no seasons" being remembered.)
    const res = await get(`${BASE_URL}/tv/${id}?api_key=${apiKey}&language=en-US`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`seasons: HTTP ${res.status}`);
    knownTvIds.add(id);
    const day = today();
    const seasons = TmdbShowSchema.parse(await res.json())
      .seasons.filter((season) => season.season_number >= 1 && (season.episode_count ?? 0) > 0 && !(season.air_date && season.air_date > day)) // season 0 is the specials; a season not out yet has nothing to play
      .map((season) => ({ season: season.season_number, episodes: season.episode_count ?? 0 }))
      .sort((a, b) => a.season - b.season);
    remember(shows, id, { at: now(), seasons }, MAX_PRELOADED_SEASONS);
    return seasons;
  };
  /** The episodes of one season as TMDB has them; null for a season it does not know. */
  const seasonOf = async (id: number, season: number): Promise<TmdbEpisode[] | null> => {
    const res = await get(`${BASE_URL}/tv/${id}/season/${season}?api_key=${apiKey}&language=en-US`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`episodes: HTTP ${res.status}`);
    return TmdbSeasonSchema.parse(await res.json()).episodes;
  };
  /**
   * Whether a film can be watched at home yet: TMDB has a digital, physical or TV release of it (types 4, 5, 6) dated by now, in any country.
   * Remembered for twelve hours, for so many films. A question that has no answer says yes, and nothing is remembered: a bad moment of TMDB's
   * does not empty the rows.
   */
  const atHome = new Map<number, { at: number; yes: boolean }>();
  const homeSlots = new Slots(HOME_CHECKS_AT_ONCE);
  const outAtHome = async (id: number): Promise<boolean> => {
    const kept = atHome.get(id);
    if (kept && now() - kept.at < HOME_TTL_MS) return kept.yes;
    const over = await homeSlots.take(HOME_WAIT_MS);
    if (!over) return true; // (no turn in time: no answer)
    try {
      const res = await get(`${BASE_URL}/movie/${id}/release_dates?api_key=${apiKey}`, { signal: AbortSignal.timeout(HOME_TIMEOUT_MS), headers: { accept: "application/json" } });
      if (!res.ok) return true;
      const parsed = TmdbReleaseDatesSchema.safeParse(await res.json());
      if (!parsed.success) return true;
      const by = new Date(now()).toISOString();
      const yes = parsed.data.results.some((country) => country.release_dates.some((release) => release.type !== undefined && HOME_RELEASES.has(release.type) && !!release.release_date && release.release_date <= by));
      remember(atHome, id, { at: now(), yes }, MAX_PRELOADED_SEASONS);
      return yes;
    } catch {
      return true;
    } finally {
      over();
    }
  };
  /**
   * The titles of a list that can be watched now (the owner, 17 Nov: "content that isn't yet available isn't shown"): one with no date, or a date
   * still to come, is left out; so is a film out in the last year that has had no home release yet (the Madoka film Walpurgisnacht: Rising, in
   * Japan's cinemas and on no streaming service). Only for lists: one title looked up by its id is shown as it is.
   */
  const watchableNow = async (results: readonly unknown[], defaultType?: "movie" | "tv"): Promise<unknown[]> => {
    const day = today();
    const recent = new Date(now() - RECENT_FILM_MS).toISOString().slice(0, 10);
    const kept = await Promise.all(
      results.map(async (raw) => {
        const parsed = TmdbItemSchema.safeParse(raw);
        if (!parsed.success) return true; // (what is not a title is left out further on)
        const doc = parsed.data;
        const date = (doc.release_date || doc.first_air_date)?.slice(0, 10);
        if (!date || date > day) return false;
        const isFilm = doc.media_type ? doc.media_type === "movie" : defaultType ? defaultType === "movie" : !doc.first_air_date;
        return !isFilm || date < recent || (await outAtHome(doc.id));
      }),
    );
    return results.filter((_, at) => kept[at]);
  };
  /**
   * How a show TMDB keeps as season 1 alone is cut, from what the video check told of its seasons: the players' seasons when they are 1, 2, 3...
   * with none missing; else, for a season of more than 30 episodes, parts of 24 (an empty plan); else whole (null). Whether a show is cut goes by
   * TMDB's whole season, so it does not change as episodes come out.
   */
  const planFrom = (counts: Record<number, number> | undefined, total: number): ShowPart[] | null => {
    const told = Object.entries(counts ?? {})
      .map(([season, episodes]) => ({ season: Number(season), episodes }))
      .filter((part) => Number.isInteger(part.season) && part.season >= 1 && Number.isInteger(part.episodes) && part.episodes > 0)
      .sort((a, b) => a.season - b.season);
    if (told.length === 1 && told[0]!.season === 1) return null; // (the players have it as one season too: TMDB's, whole)
    // (with a season missing, a part would be called by a number the players give another)
    if (told.length > 1 && told.every((part, at) => part.season === at + 1)) return told;
    return total <= 30 ? null : [];
  };
  /** The last plan each show got from a real answer of the video check: what is used while the check has none (the judge, 17 Nov). */
  const plans = new Map<number, ShowPart[] | null>();
  const planOf = async (id: number, total: number): Promise<ShowPart[] | null> => {
    if (!shouldVerify) return planFrom(preloadedSeasonCounts.get(id), total);
    await probePlayback(id, "tv", probeFetcher, probeCache, now, 5000, probeSlots);
    // (A check with no answer - no turn in time, a timeout, a bad answer - writes nothing down: the show is then cut as its last answer said.)
    const record = probeCache.get(`tv:${id}`);
    if (record && now() - record.checkedAt < PROBE_TTL_MS) {
      if (record.status === 200 && record.seasonCounts) rememberPlayerSeasons(id, record.seasonCounts);
      const plan = planFrom(record.status === 200 ? record.seasonCounts : undefined, total);
      remember(plans, id, plan, MAX_PRELOADED_SEASONS);
      return plan;
    }
    if (plans.has(id)) return plans.get(id)!;
    // Never an answer: a season of 30 or fewer is listed whole, as most one-season shows are (a page of seasons does not fail for a busy
    // moment); a longer one fails and is asked again, rather than be cut one way for its seasons and another for its episodes.
    if (total <= 30) return null;
    throw new Error("parts: the video check gave no answer");
  };
  /**
   * The parts a show is played in when TMDB keeps it as one long season and the players number it in seasons (JJK: TMDB's one season of 59, the
   * players' seasons of 24 and more): see `planOf`. Cut over the episodes of TMDB's season 1 out by today (`season1`, the answer `episodes`
   * lists, when it has it): none is empty, and the episodes beyond the players' seasons follow as further parts of 24. Null for any other show,
   * which is listed as TMDB lists it. `seasons` and `episodes` both go by this, so the list of seasons and the episodes of each agree.
   */
  const partsOf = async (id: number, show: ShowPart[], season1?: TmdbEpisode[] | null): Promise<ShowPart[] | null> => {
    if (show.length !== 1 || show[0]!.season !== 1) return null;
    const plan = await planOf(id, show[0]!.episodes);
    if (!plan) return null;
    const day = today();
    const out = ((season1 === undefined ? await seasonOf(id, 1) : season1) ?? []).filter((episode) => !(episode.air_date && episode.air_date > day)).length;
    const parts: ShowPart[] = [];
    let from = 0;
    for (const part of plan) {
      if (from >= out) break;
      const episodes = Math.min(part.episodes, out - from);
      parts.push({ season: part.season, episodes });
      from += episodes;
    }
    for (let season = (plan.at(-1)?.season ?? 0) + 1; from < out; season += 1) {
      const episodes = Math.min(24, out - from);
      parts.push({ season, episodes });
      from += episodes;
    }
    return parts.length > 0 ? parts : null;
  };

  const shelfGroups = options.shelves ?? SHELF_GROUPS;
  const rowOf = (cat: FilmpireCategory, items: LibraryItem[]): LibraryRow => {
    const section = sectionOfCategory(cat);
    return {
      id: `filmpire-${cat.id}`,
      title: cat.title,
      source: "Filmpire",
      kind: cat.type === "tv" ? "series" : "movie",
      ...(section === "cartoon" || section === "anime" ? { section } : {}), // (a row of Movies or Series does not say: its kind does)
      items,
    };
  };
  /**
   * One page of a category or shelf, with only the titles that are in its section: TMDB cannot be asked for "animation, but not Japanese" (or
   * "not animation" for its trending and popular lists), so a page of Cartoons has some anime in it, and a page of Movies some cartoons, which are left out here.
   * `tidy` leaves out what looks like rubbish (the shelves and further pages: the first pages of the old categories were never sifted).
   */
  const askPage = async (cat: FilmpireCategory, page: number, tidy: boolean): Promise<{ items: LibraryItem[]; last: boolean }> => {
    const res = await get(pageUrl(cat.path, page, apiKey), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${cat.id}: HTTP ${res.status}`);
    const data = TmdbSearchSchema.parse(await res.json());
    const results = await watchableNow(tidy && shouldFilterTrash ? data.results.filter((item) => !isTrashItem(item)) : data.results, cat.type);
    const section = sectionOfCategory(cat);
    const items = results.map((item) => toLibraryItem(item, cat.type)).filter((item): item is LibraryItem => item !== null && sectionOf(item) === section);
    return { items, last: data.results.length === 0 || page >= Math.min(data.total_pages ?? MAX_PAGE, MAX_PAGE) };
  };
  const loadCategory = async (cat: FilmpireCategory): Promise<LibraryRow> => rowOf(cat, (await askPage(cat, 1, false)).items);
  const known = new Map([...categories, ...shelfGroups.flat()].map((cat) => [`filmpire-${cat.id}`, cat]));

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
    async shelves(section: LibrarySection | undefined, cursor: number) {
      const plan = shelfPlan(section, shelfGroups);
      const batch = plan.slice(cursor, cursor + SHELF_BATCH);
      if (batch.length === 0) return { rows: [], next: null };
      const settled = await Promise.allSettled(batch.map(async (cat) => rowOf(cat, (await askPage(cat, 1, true)).items)));
      const rows = settled.flatMap((r) => (r.status === "fulfilled" && r.value.items.length > 0 ? [r.value] : []));
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (rows.length === 0 && failed) throw failed.reason; // (a bad moment is not "nothing more": the page asks again)
      return { rows, next: cursor + batch.length < plan.length ? cursor + batch.length : null };
    },
    async more(rowId: string, page: number) {
      const cat = known.get(rowId);
      if (!cat || page < 2 || page > MAX_PAGE) return { items: [], last: true };
      return askPage(cat, page, true);
    },
    async search(queryText: string): Promise<LibraryItem[]> {
      const q = queryText.trim();
      if (!q) return [];
      try {
        const askSearchPage = async (page: number) => {
          const fullUrl = `${BASE_URL}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}&page=${page}`;
          const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
          return res.ok ? TmdbSearchSchema.parse(await res.json()) : null;
        };
        const first = await askSearchPage(1);
        if (!first) return [];
        // The rest of the pages are asked together once the first says there are any; one that cannot be had is left out.
        const rest = await Promise.all(Array.from({ length: Math.min(first.total_pages ?? 1, SEARCH_PAGES) - 1 }, (_, at) => askSearchPage(at + 2).catch(() => null)));

        const toItems = async (results: unknown[]) =>
          (await watchableNow(shouldFilterTrash ? results.filter((item) => !isTrashItem(item)) : results))
            .map((item) => toLibraryItem(item))
            .filter((item): item is LibraryItem => item !== null);
        const items = await toItems(first.results);
        const seen = new Set(items.map((item) => item.id));
        // (Only the first page is asked about at the provider, as before; for the others, what it was already found to lack stays out.)
        const further = (await toItems(rest.flatMap((page) => page?.results ?? []))).filter((item) => {
          const parsed = parseWatchLink(item.url);
          const record = shouldVerify && parsed ? probeCache.get(`${parsed.type}:${parsed.id}`) : undefined;
          return !seen.has(item.id) && seen.add(item.id) && !(record?.status === 404 && now() - record.checkedAt < PROBE_TTL_MS);
        });

        if (!shouldVerify || items.length === 0) return [...items, ...further];

        const probeResults = await Promise.all(
          items.map(async (item) => {
            const parsed = parseWatchLink(item.url);
            if (!parsed) return item;
            const probe = await probePlayback(parsed.id, parsed.type, probeFetcher, probeCache, now, probeTimeout, probeSlots);
            if (!probe.ok) return null;
            if (parsed.type === "tv" && probe.seasons && probe.seasons.length > 0) {
              remember(preloadedSeasons, parsed.id, probe.seasons, MAX_PRELOADED_SEASONS);
              if (probe.seasonCounts) remember(preloadedSeasonCounts, parsed.id, probe.seasonCounts, MAX_PRELOADED_SEASONS);
            }
            return item;
          }),
        );

        return [...probeResults.filter((item): item is LibraryItem => item !== null), ...further];
      } catch {
        return [];
      }
    },
    // (For these two a place that cannot be reached throws, and a title it does not know (404) is an answer: that way a bad moment is asked
    // again next time instead of an empty answer being remembered for hours.)
    async similar(link: string): Promise<LibraryItem[]> {
      const title = parseWatchLink(link);
      if (!title) return [];
      const fullUrl = `${BASE_URL}/${title.type}/${title.id}/recommendations?api_key=${apiKey}&language=en-US&page=1`;
      const res = await get(fullUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`similar: HTTP ${res.status}`);
      const data = TmdbResponseSchema.parse(await res.json());

      const candidateResults = await watchableNow(shouldFilterTrash ? data.results.filter((item) => !isTrashItem(item)) : data.results, title.type);

      const items = candidateResults
        .map((item) => toLibraryItem(item, title.type))
        .filter((item): item is LibraryItem => item !== null);

      if (!shouldVerify || items.length === 0) return items;

      const probeResults = await Promise.all(
        items.map(async (item) => {
          const parsed = parseWatchLink(item.url);
          if (!parsed) return item;
          const probe = await probePlayback(parsed.id, parsed.type, probeFetcher, probeCache, now, probeTimeout, probeSlots);
          if (!probe.ok) return null;
          if (parsed.type === "tv" && probe.seasons && probe.seasons.length > 0) {
            remember(preloadedSeasons, parsed.id, probe.seasons, MAX_PRELOADED_SEASONS);
            if (probe.seasonCounts) remember(preloadedSeasonCounts, parsed.id, probe.seasonCounts, MAX_PRELOADED_SEASONS);
          }
          return item;
        }),
      );

      return probeResults.filter((item): item is LibraryItem => item !== null);
    },
    /**
     * What TMDB knows of the title a link plays besides its tile, in one question (`append_to_response`), and a second for a film that is part of a collection: that
     * is all, and only when a page asks. A link that is not Filmpire's, and a title TMDB does not know, have none; a place that cannot be reached throws (as above).
     * The titles are not probed for a video, as the rows' are not: one that will not play leaves the lists when it is tried (see `LibraryService.played`).
     */
    /** A title by the id this place gives its tiles (`filmpire-movie-603`, `filmpire-tv-1399`): one question to TMDB, which says the rest. */
    async title(id: string): Promise<LibraryItem | null> {
      const match = /^filmpire-(movie|tv)-(\d{1,10})$/.exec(id);
      if (!match) return null;
      const type = match[1] as "movie" | "tv";
      const res = await get(`${BASE_URL}/${type}/${match[2]}?api_key=${apiKey}&language=en-US`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`title: HTTP ${res.status}`);
      return toLibraryItem(await res.json(), type, false);
    },
    async about(link: string): Promise<TitleAbout | null> {
      let title = parseWatchLink(link);
      if (!title) return null;
      const ask = (path: string, append = "") => get(`${BASE_URL}${path}?api_key=${apiKey}&language=en-US${append}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      let res = await ask(`/${title.type}/${title.id}`, `&append_to_response=credits,${title.type === "movie" ? "release_dates" : "content_ratings"},recommendations`);
      if (res.status === 404 && title.type === "movie" && !link.includes("type=movie")) {
        const tvRes = await ask(`/tv/${title.id}`, `&append_to_response=credits,content_ratings,recommendations`);
        if (tvRes.ok) {
          title = { id: title.id, type: "tv" };
          res = tvRes;
          knownTvIds.add(title.id);
        }
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`about: HTTP ${res.status}`);
      const doc = TmdbAboutSchema.parse(await res.json());
      const own = `filmpire-${title.type}-${title.id}`;
      const listed = async (results: readonly unknown[], type: "movie" | "tv", max: number, skip: ReadonlySet<string> = new Set()) =>
        (await watchableNow(shouldFilterTrash ? results.filter((item) => !isTrashItem(item)) : results, type))
          .map((item) => toLibraryItem(item, type))
          .filter((item): item is LibraryItem => item !== null && item.id !== own && !skip.has(item.id))
          .slice(0, max);

      let parts: LibraryItem[] = [];
      if (title.type === "movie" && doc.belongs_to_collection) {
        const collection = await ask(`/collection/${doc.belongs_to_collection.id}`);
        if (collection.ok) parts = await listed([...TmdbCollectionSchema.parse(await collection.json()).parts].sort((a, b) => releasedAt(a).localeCompare(releasedAt(b))), "movie", ABOUT_MAX.parts);
        else if (collection.status !== 404) throw new Error(`about: collection HTTP ${collection.status}`);
      }
      const similar = await listed(doc.recommendations?.results ?? [], title.type, ABOUT_MAX.similar, new Set(parts.map((item) => item.id))); // (a sequel is among the parts, not among the titles like it as well)

      const ages: Record<string, string> = {};
      for (const country of AGE_COUNTRIES) {
        const age = ageIn(country, doc, title.type);
        if (age) ages[country] = age.slice(0, 20);
      }
      const rawDate = doc.release_date || doc.first_air_date;
      const releaseYear = rawDate ? Number.parseInt(rawDate.slice(0, 4), 10) : undefined;
      const hasRoDub = romanianDubsOn() && await hasRomanianDub({
        tmdbId: title.id,
        type: title.type,
        title: doc.title || doc.name || "",
        originalTitle: doc.original_title || doc.original_name,
        year: Number.isInteger(releaseYear) ? releaseYear : undefined,
        isAnimation: doc.genres?.some((g) => g.name === "Animation"),
      });

      const about: TitleAbout = {
        genres: namesOf(doc.genres, ABOUT_MAX.genres).map((name) => name.slice(0, 40)),
        directors: title.type === "movie" ? namesOf(doc.credits?.crew?.filter((one) => one.job === "Director"), ABOUT_MAX.directors) : [], // (a show's crew is its episodes' directors: it has its creators)
        creators: namesOf(doc.created_by, ABOUT_MAX.creators),
        cast: namesOf([...(doc.credits?.cast ?? [])].sort((a, b) => (a.order ?? 1e6) - (b.order ?? 1e6)), ABOUT_MAX.cast),
        ages,
        parts,
        similar,
        ...(hasRoDub ? { hasRoDub: true } : {}),
      };
      const known = about.genres.length + about.directors.length + about.creators.length + about.cast.length + Object.keys(ages).length + parts.length + similar.length;
      return known > 0 ? about : null;
    },
    async episodes(link: string, season: number): Promise<EpisodeDetail[]> {
      const title = parseWatchLink(link);
      if (title?.type !== "tv") return [];
      const show = await showOf(title.id);
      if (!show) return [];
      // (A show of season 1 alone: its episodes are asked once, and the parts are cut over the same answer that is listed.)
      const alone = show.length === 1 && show[0]!.season === 1;
      const season1 = alone ? await seasonOf(title.id, 1) : undefined;
      const parts = alone ? await partsOf(title.id, show, season1) : null;
      const day = today();
      const detail = (episode: TmdbEpisode, number: number): EpisodeDetail => {
        const name = episode.name?.trim();
        const overview = episode.overview?.trim();
        return {
          season,
          episode: number,
          ...(name ? { title: name.slice(0, 200) } : {}),
          ...(overview ? { overview: overview.slice(0, 400) } : {}),
          ...(episode.still_path ? { still: `${STILL_BASE}${episode.still_path}` } : {}),
          ...(episode.runtime && episode.runtime > 0 ? { runtime: Math.min(1000, Math.round(episode.runtime)) } : {}),
          url: `https://filmpire.sc/watch/${title.id}?s=${season}&e=${number}`,
        };
      };

      if (parts) {
        // A show TMDB keeps as one long season is played in parts (see `partsOf`): a part is its share of TMDB's season 1, numbered from one, and
        // no episode is in two parts (the judge, 17 Nov: with season 1 listed whole, the parts after it listed its episodes again).
        const at = parts.findIndex((part) => part.season === season);
        if (at < 0) return [];
        const offset = parts.slice(0, at).reduce((sum, part) => sum + part.episodes, 0);
        return (season1 ?? [])
          .filter((episode) => !(episode.air_date && episode.air_date > day))
          .slice(offset, offset + parts[at]!.episodes)
          .map((episode, index) => detail(episode, index + 1));
      }

      // Any other show is listed as TMDB lists it, each season whole (a long one is shown 24 at a time by the page, not cut here: Bleach, 17 Nov).
      const episodes = await seasonOf(title.id, season);
      if (!episodes) return [];
      return episodes.filter((episode) => !(episode.air_date && episode.air_date > day)).map((episode) => detail(episode, episode.episode_number));
    },
    async seasons(link: string): Promise<number[]> {
      const title = parseWatchLink(link);
      if (title?.type !== "tv") return [];
      // (TMDB's list, always: the video check's own list of seasons once put Bleach at seasons 3 to 16 over TMDB's 1 and 2. The judge, 17 Nov.)
      const show = await showOf(title.id);
      if (!show) return [];
      const parts = await partsOf(title.id, show);
      return parts ? parts.map((part) => part.season) : show.map((part) => part.season);
    },
  };
}
