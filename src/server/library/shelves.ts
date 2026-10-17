/**
 * The shelves of the library: further TMDB queries, made from small tables, that the page asks for a few at a time as it is scrolled
 * (see `shelfPlan`). The 31 categories of `filmpire.ts` are the first rows; these are what comes after, and what finds the older titles
 * the popular lists never reach: a window of dates sorted by the number of votes ("known by many") or, with a floor of votes, by
 * the score. Nothing here is about a title or a franchise.
 */

export interface FilmpireCategory {
  id: string;
  title: string;
  /** The TMDB path and query, without the key and without `page`. */
  path: string;
  type: "movie" | "tv";
}

type Type = FilmpireCategory["type"];

const DISCOVER: Record<Type, string> = {
  movie: "/discover/movie?include_adult=false&language=en-US",
  tv: "/discover/tv?include_adult=false&language=en-US",
};
const DATE: Record<Type, string> = { movie: "primary_release_date", tv: "first_air_date" };

const shelf = (type: Type, id: string, title: string, query: string): FilmpireCategory => ({ id, title, type, path: `${DISCOVER[type]}&${query}` });
const decade = (type: Type, start: number) => `${DATE[type]}.gte=${start}-01-01&${DATE[type]}.lte=${start + 9}-12-31`;
const before = (type: Type, year: number) => `${DATE[type]}.lte=${year}-12-31`;
const byVotes = "sort_by=vote_count.desc";
const byScore = (floor: number) => `vote_count.gte=${floor}&sort_by=vote_average.desc`;

/** How many votes a title of a decade needs to count among its best (the older the decade, the fewer people have voted on anything). */
const MOVIE_FLOOR: Record<number, number> = { 1930: 200, 1940: 300, 1950: 500, 1960: 600, 1970: 1200, 1980: 2000, 1990: 3000, 2000: 4000, 2010: 5000 };
const TV_FLOOR: Record<number, number> = { 1960: 100, 1970: 150, 1980: 200, 1990: 400, 2000: 800, 2010: 1500 };

/** [id word, TMDB genre, name, votes a title needs to be among the best of its genre]. */
const MOVIE_GENRES: ReadonlyArray<readonly [string, number, string, number]> = [
  ["action", 28, "Action", 3000],
  ["adventure", 12, "Adventure", 3000],
  ["animation", 16, "Animated", 3000],
  ["comedy", 35, "Comedy", 3000],
  ["crime", 80, "Crime", 3000],
  ["documentary", 99, "Documentary", 300],
  ["drama", 18, "Drama", 3000],
  ["family", 10751, "Family", 2000],
  ["fantasy", 14, "Fantasy", 3000],
  ["horror", 27, "Horror", 2500],
  ["mystery", 9648, "Mystery", 2500],
  ["romance", 10749, "Romance", 2500],
  ["scifi", 878, "Sci-Fi", 3000],
  ["thriller", 53, "Thriller", 3000],
  ["war", 10752, "War", 1500],
  ["western", 37, "Western", 800],
];
/** The genres that have classics, hidden gems: the same words, TMDB's numbers. */
const CLASSIC_GENRES = ["action", "adventure", "animation", "comedy", "crime", "drama", "fantasy", "horror", "mystery", "romance", "scifi", "thriller", "war", "western"];
const GEM_GENRES = ["comedy", "drama", "horror", "scifi", "thriller", "animation"];
const movieGenre = (word: string) => MOVIE_GENRES.find(([key]) => key === word)!;

const TV_GENRES: ReadonlyArray<readonly [string, number, string, number]> = [
  ["action-adventure", 10759, "Action & Adventure", 300],
  ["animation", 16, "Animation & Anime", 300],
  ["comedy", 35, "Comedy", 300],
  ["crime", 80, "Crime", 300],
  ["documentary", 99, "Documentary", 100],
  ["drama", 18, "Drama", 300],
  ["family", 10751, "Family", 150],
  ["kids", 10762, "Kids", 100],
  ["mystery", 9648, "Mystery", 300],
  ["reality", 10764, "Reality", 150],
  ["scifi-fantasy", 10765, "Sci-Fi & Fantasy", 300],
  ["war-politics", 10768, "War & Politics", 100],
];
const TV_GEM_GENRES = ["comedy", "drama", "crime"];
const tvGenre = (word: string) => TV_GENRES.find(([key]) => key === word)!;

const MOVIE_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010];
const MOVIE_BEST_DECADES = [1930, 1940, ...MOVIE_DECADES];
const TV_DECADES = [1970, 1980, 1990, 2000, 2010];
const TV_BEST_DECADES = [1960, ...TV_DECADES];

/** [language, name of its films, name of its series (none: no row of series)]. */
const WORLD: ReadonlyArray<readonly [string, string, string | null]> = [
  ["fr", "French Cinema", "French Series"],
  ["es", "Spanish-Language Cinema", "Spanish-Language Series"],
  ["it", "Italian Cinema", null],
  ["de", "German Cinema", "German Series"],
  ["ja", "Japanese Cinema", "Japanese Dramas"],
  ["ko", "Korean Cinema", "Korean Dramas"],
  ["hi", "Indian Cinema", "Indian Series"],
  ["zh", "Chinese Cinema", null],
  ["ru", "Russian Cinema", null],
  ["tr", "Turkish Cinema", "Turkish Series"],
];

const GEMS = { movie: "vote_average.gte=7.2&vote_count.gte=400&vote_count.lte=3000&sort_by=vote_average.desc", tv: "vote_average.gte=7.5&vote_count.gte=150&vote_count.lte=1200&sort_by=vote_average.desc" };

/** Each group is one kind of shelf, in no order of its own (see `shelfPlan`); the groups of films and of series alternate. */
export const SHELF_GROUPS: ReadonlyArray<readonly FilmpireCategory[]> = [
  MOVIE_DECADES.map((start) => shelf("movie", `movies-${start}s`, `Movies of the ${start}s`, `${decade("movie", start)}&${byVotes}`)),
  TV_DECADES.map((start) => shelf("tv", `series-${start}s`, `Series of the ${start}s`, `${decade("tv", start)}&${byVotes}`)),
  CLASSIC_GENRES.map((word) => {
    const [, genre, name] = movieGenre(word);
    return shelf("movie", `classic-${word}-movies`, `Classic ${name} Movies`, `with_genres=${genre}&${before("movie", 1989)}&${byVotes}`);
  }),
  TV_GENRES.map(([word, genre, name, floor]) => shelf("tv", `best-${word}-tv`, `Best ${name} Series`, `with_genres=${genre}&${byScore(floor)}`)),
  MOVIE_GENRES.map(([word, genre, name, floor]) => shelf("movie", `best-${word}-movies`, `Best ${name} Movies`, `with_genres=${genre}&${byScore(floor)}`)),
  TV_BEST_DECADES.map((start) => shelf("tv", `best-series-${start}s`, `Best Series of the ${start}s`, `${decade("tv", start)}&${byScore(TV_FLOOR[start]!)}`)),
  MOVIE_BEST_DECADES.map((start) => shelf("movie", `best-movies-${start}s`, `Best Movies of the ${start}s`, `${decade("movie", start)}&${byScore(MOVIE_FLOOR[start]!)}`)),
  [
    shelf("tv", "hidden-gems-tv", "Hidden Gem Series", GEMS.tv),
    ...TV_GEM_GENRES.map((word) => {
      const [, genre, name] = tvGenre(word);
      return shelf("tv", `hidden-gems-${word}-tv`, `Hidden Gem ${name} Series`, `with_genres=${genre}&${GEMS.tv}`);
    }),
  ],
  [
    shelf("movie", "hidden-gems-movies", "Hidden Gem Movies", GEMS.movie),
    ...GEM_GENRES.map((word) => {
      const [, genre, name] = movieGenre(word);
      return shelf("movie", `hidden-gems-${word}-movies`, `Hidden Gem ${name} Movies`, `with_genres=${genre}&${GEMS.movie}`);
    }),
  ],
  [
    shelf("tv", "classic-series", "Classic Series", `${before("tv", 1989)}&${byVotes}`),
    shelf("tv", "miniseries", "Miniseries", `with_type=2&vote_count.gte=100&${byVotes}`),
    shelf("tv", "anime-tv", "Anime Series", `with_genres=16&with_original_language=ja&${byVotes}`),
    ...WORLD.flatMap(([language, , series]) => (series ? [shelf("tv", `world-${language}-tv`, series, `with_original_language=${language}${language === "ja" ? "&without_genres=16" : ""}&vote_count.gte=50&${byVotes}`)] : [])),
  ],
  [
    shelf("movie", "cult-classics", "Cult Classics", `${before("movie", 2005)}&vote_average.gte=7&vote_count.gte=1500&vote_count.lte=7000&${byVotes}`),
    shelf("movie", "anime-movies", "Anime Movies", `with_genres=16&with_original_language=ja&${byVotes}`),
    ...WORLD.map(([language, films]) => shelf("movie", `world-${language}-movies`, films, `with_original_language=${language}&vote_count.gte=100&${byVotes}`)),
  ],
];

export const FILMPIRE_SHELVES: readonly FilmpireCategory[] = SHELF_GROUPS.flat();

/** A small seeded shuffle: the same order every time, so a page asked for twice (or by two screens) is the same page. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  let state = (seed * 2654435761) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The order the shelves come in as the page is scrolled: one from each group in turn (films and series alternate, a decade is never
 * followed by another decade), each group in its own fixed shuffle. `kind` keeps only the films' or only the series'.
 */
export function shelfPlan(kind?: "movie" | "series", groups: ReadonlyArray<readonly FilmpireCategory[]> = SHELF_GROUPS): FilmpireCategory[] {
  const wanted = (cat: FilmpireCategory) => !kind || (kind === "movie") === (cat.type === "movie");
  const queues = groups.map((group, at) => shuffled(group.filter(wanted), at + 1)).filter((queue) => queue.length > 0);
  const out: FilmpireCategory[] = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round++) {
    for (const queue of queues) if (round < queue.length) out.push(queue[round]!);
  }
  return out;
}
