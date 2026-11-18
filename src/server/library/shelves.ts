import type { LibrarySection } from "../../shared";

export interface FilmpireCategory {
  id: string;
  title: string;
  path: string;
  type: "movie" | "tv";
  section?: LibrarySection;
}

type Type = FilmpireCategory["type"];
type Animated = Extract<LibrarySection, "cartoon" | "anime">;

export const ANIMATION_GENRE = 16;

export const UNSCRIPTED_TV_GENRES = [10763, 10766, 10767] as const;

const live = (type: Type): LibrarySection => (type === "movie" ? "movie" : "series");
export const sectionOfCategory = (cat: FilmpireCategory): LibrarySection => cat.section ?? live(cat.type);

const DISCOVER: Record<Type, string> = {
  movie: "/discover/movie?include_adult=false&language=en-US",
  tv: "/discover/tv?include_adult=false&language=en-US",
};
const DATE: Record<Type, string> = { movie: "primary_release_date", tv: "first_air_date" };

const shelf = (type: Type, id: string, title: string, query: string, section: LibrarySection = live(type)): FilmpireCategory => {
  const without = section === live(type)
    ? (type === "tv" ? `&without_genres=${ANIMATION_GENRE},${UNSCRIPTED_TV_GENRES.join(",")}` : `&without_genres=${ANIMATION_GENRE}`)
    : "";
  return {
    id,
    title,
    type,
    section,
    path: `${DISCOVER[type]}&${query}${without}`,
  };
};
const decade = (type: Type, start: number) => `${DATE[type]}.gte=${start}-01-01&${DATE[type]}.lte=${start + 9}-12-31`;
const before = (type: Type, year: number) => `${DATE[type]}.lte=${year}-12-31`;
const byVotes = "sort_by=vote_count.desc";
const byScore = (floor: number) => `vote_count.gte=${floor}&sort_by=vote_average.desc`;

const MOVIE_FLOOR: Record<number, number> = { 1930: 200, 1940: 300, 1950: 500, 1960: 600, 1970: 1200, 1980: 2000, 1990: 3000, 2000: 4000, 2010: 5000 };
const TV_FLOOR: Record<number, number> = { 1960: 100, 1970: 150, 1980: 200, 1990: 400, 2000: 800, 2010: 1500 };

const MOVIE_GENRES: ReadonlyArray<readonly [string, number, string, number]> = [
  ["action", 28, "Action", 3000],
  ["adventure", 12, "Adventure", 3000],
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
const CLASSIC_GENRES = ["action", "adventure", "comedy", "crime", "drama", "fantasy", "horror", "mystery", "romance", "scifi", "thriller", "war", "western"];
const GEM_GENRES = ["comedy", "drama", "horror", "scifi", "thriller"];
const movieGenre = (word: string) => MOVIE_GENRES.find(([key]) => key === word)!;

const TV_GENRES: ReadonlyArray<readonly [string, number, string, number]> = [
  ["action-adventure", 10759, "Action & Adventure", 300],
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

const ANIME_KEYWORD = 210024;

export const animated = (section: Animated, genre?: number) =>
  `with_genres=${ANIMATION_GENRE}${genre ? `,${genre}` : ""}${section === "anime" ? "&with_original_language=ja" : `&without_keywords=${ANIME_KEYWORD}`}`;

const ANIMATED_NAME: Record<Animated, { tv: string; movie: string; word: string }> = {
  cartoon: { tv: "Cartoon Series", movie: "Cartoon Movies", word: "Cartoon" },
  anime: { tv: "Anime Series", movie: "Anime Movies", word: "Anime" },
};
const ANIMATED_DECADES: Record<Animated, readonly number[]> = { cartoon: [1980, 1990, 2000, 2010], anime: [1990, 2000, 2010, 2020] };
const ANIMATED_GENRES: Record<Animated, Record<"tv" | "movie", ReadonlyArray<readonly [string, number, string]>>> = {
  cartoon: {
    tv: [["comedy", 35, "Comedy"], ["action-adventure", 10759, "Action & Adventure"], ["scifi-fantasy", 10765, "Sci-Fi & Fantasy"]],
    movie: [["comedy", 35, "Comedy"], ["adventure", 12, "Adventure"], ["fantasy", 14, "Fantasy"]],
  },
  anime: {
    tv: [["action-adventure", 10759, "Action & Adventure"], ["scifi-fantasy", 10765, "Sci-Fi & Fantasy"], ["comedy", 35, "Comedy"], ["drama", 18, "Drama"]],
    movie: [["adventure", 12, "Adventure"], ["fantasy", 14, "Fantasy"], ["drama", 18, "Drama"]],
  },
};
const ANIMATED_FLOOR: Record<Animated, Record<"tv" | "movie", number>> = { cartoon: { tv: 100, movie: 500 }, anime: { tv: 100, movie: 300 } };
const ANIMATED_SECTIONS: readonly Animated[] = ["cartoon", "anime"];
const TYPES: readonly Type[] = ["tv", "movie"];

const ANIMATED_DECADE_SHELVES = ANIMATED_SECTIONS.flatMap((section) =>
  TYPES.flatMap((type) =>
    ANIMATED_DECADES[section].map((start) =>
      shelf(type, `${section}-${type === "tv" ? "tv" : "movies"}-${start}s`, `${ANIMATED_NAME[section][type]} of the ${start}s`, `${animated(section)}&${decade(type, start)}&${byVotes}`, section),
    ),
  ),
);
const ANIMATED_GENRE_SHELVES = ANIMATED_SECTIONS.flatMap((section) =>
  TYPES.flatMap((type) =>
    ANIMATED_GENRES[section][type].map(([word, genre, name]) =>
      shelf(type, `best-${section}-${word}-${type === "tv" ? "tv" : "movies"}`, `Best ${ANIMATED_NAME[section].word} ${name} ${type === "tv" ? "Series" : "Movies"}`, `${animated(section, genre)}&${byScore(ANIMATED_FLOOR[section][type])}`, section),
    ),
  ),
);
const ANIMATED_OTHER_SHELVES = [
  shelf("tv", "classic-cartoons", "Classic Cartoons", `${animated("cartoon")}&${before("tv", 1989)}&${byVotes}`, "cartoon"),
  shelf("movie", "classic-cartoon-movies", "Classic Cartoon Movies", `${animated("cartoon")}&${before("movie", 1979)}&${byVotes}`, "cartoon"),
  shelf("tv", "hidden-gems-cartoons", "Hidden Gem Cartoon Series", `${animated("cartoon")}&${GEMS.tv}`, "cartoon"),
  shelf("movie", "hidden-gems-cartoon-movies", "Hidden Gem Cartoon Movies", `${animated("cartoon")}&${GEMS.movie}`, "cartoon"),
  shelf("tv", "best-cartoons-tv", "Best Cartoon Series", `${animated("cartoon")}&${byScore(300)}`, "cartoon"),
  shelf("movie", "best-cartoons-movies", "Best Cartoon Movies", `${animated("cartoon")}&${byScore(1500)}`, "cartoon"),
  shelf("movie", "world-fr-cartoon-movies", "French Animation", `with_genres=${ANIMATION_GENRE}&with_original_language=fr&${byVotes}`, "cartoon"),
  shelf("tv", "world-zh-cartoon-tv", "Chinese Animation", `with_genres=${ANIMATION_GENRE}&with_original_language=zh&${byVotes}`, "cartoon"),
  shelf("tv", "anime-tv", "Anime Series", `${animated("anime")}&${byVotes}`, "anime"),
  shelf("movie", "anime-movies", "Anime Movies", `${animated("anime")}&${byVotes}`, "anime"),
  shelf("tv", "classic-anime", "Classic Anime", `${animated("anime")}&${before("tv", 1999)}&${byVotes}`, "anime"),
  shelf("tv", "hidden-gems-anime", "Hidden Gem Anime Series", `${animated("anime")}&${GEMS.tv}`, "anime"),
  shelf("movie", "hidden-gems-anime-movies", "Hidden Gem Anime Movies", `${animated("anime")}&${GEMS.movie}`, "anime"),
  shelf("tv", "best-anime-tv", "Best Anime Series", `${animated("anime")}&${byScore(200)}`, "anime"),
  shelf("movie", "best-anime-movies", "Best Anime Movies", `${animated("anime")}&${byScore(600)}`, "anime"),
];

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
    ...WORLD.flatMap(([language, , series]) => (series ? [shelf("tv", `world-${language}-tv`, series, `with_original_language=${language}&vote_count.gte=50&${byVotes}`)] : [])),
  ],
  [
    shelf("movie", "cult-classics", "Cult Classics", `${before("movie", 2005)}&vote_average.gte=7&vote_count.gte=1500&vote_count.lte=7000&${byVotes}`),
    ...WORLD.map(([language, films]) => shelf("movie", `world-${language}-movies`, films, `with_original_language=${language}&vote_count.gte=100&${byVotes}`)),
  ],
  ANIMATED_DECADE_SHELVES,
  ANIMATED_GENRE_SHELVES,
  ANIMATED_OTHER_SHELVES,
];

export const FILMPIRE_SHELVES: readonly FilmpireCategory[] = SHELF_GROUPS.flat();

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

export function shelfPlan(section?: LibrarySection, groups: ReadonlyArray<readonly FilmpireCategory[]> = SHELF_GROUPS): FilmpireCategory[] {
  const wanted = (cat: FilmpireCategory) => !section || sectionOfCategory(cat) === section;
  const queues = groups.map((group, at) => shuffled(group.filter(wanted), at + 1)).filter((queue) => queue.length > 0);
  const out: FilmpireCategory[] = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round++) {
    for (const queue of queues) if (round < queue.length) out.push(queue[round]!);
  }
  return out;
}
