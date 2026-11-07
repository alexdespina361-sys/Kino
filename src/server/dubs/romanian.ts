/**
 * Registry, detector, and stream resolver for Romanian-dubbed content.
 * Matches movies and TV series that are available with Romanian dubbing (theatrical, Disney,
 * Cartoon Network, Netflix, or community dubbed releases), attaching dub tracks/alternates
 * and badging titles with "Ro Dub" in the catalog and detail hero.
 */

export interface DubLookupInfo {
  tmdbId?: number | string;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: "movie" | "tv";
  isAnimation?: boolean;
}

export function normalizeDubTitle(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (ș->s, ț->t, ă->a, î->i, â->a)
    .replace(/\s*\((?:dublat[^\)]*|subtitrat[^\)]*|tv|film|movie|\d{4})\)/gi, "")
    .replace(/\b(?:film|movie|serial|desene|dublat|in romana|subtitrat)\b/gi, "")
    .replace(/[-–—_.:,'!?&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Curated list of TMDB IDs for animated and family features officially released with Romanian dubs.
 * Includes Disney, Pixar, DreamWorks, Illumination, Sony Pictures Animation, Blue Sky, and animated series.
 */
const KNOWN_DUBBED_TMDB_IDS = new Set<number>([
  // Shrek & Puss in Boots
  808, 10527, 819, 10192, 6477, 76600,
  // Cars & Planes
  920, 49013, 260514, 157353, 237756,
  // Ice Age
  425, 38757, 8355, 57800, 278154,
  // Toy Story & Lightyear
  862, 863, 10193, 301528, 718789,
  // The Lion King
  8587, 861, 860, 420818, 1011985,
  // Kung Fu Panda
  9502, 49444, 140300, 1011985,
  // Despicable Me & Minions
  20352, 93456, 324852, 211672, 438148, 519182,
  // How to Train Your Dragon
  10191, 82702, 166428,
  // Madagascar
  953, 10527, 8073, 227306,
  // Finding Nemo & Dory
  12, 127380,
  // Inside Out
  150540, 1022789,
  // Frozen
  109445, 330457,
  // Moana / Vaiana
  277834, 1241982,
  // Zootopia
  269149,
  // Coco, Encanto, Luca, Soul, Turning Red, Elemental
  354912, 568124, 508947, 508442, 508943, 976573,
  // Classic / Golden Disney
  408, 10882, 11360, 10895, 11224, 10530, 10693, 11886, 12092, 11244,
  10144, 87, 10545, 10020, 9986, 9292, 9741, 10674, 9928, 9739,
  10567, 11688, 9012, 10501, 10688, 13700, 11802,
  // Pixar Classics: Wall-E, Up, Ratatouille, Monsters Inc, Incredibles
  10681, 14160, 2062, 585, 9806, 260513, 9487,
  // Tangled, Wreck-It Ralph, Big Hero 6
  38757, 82690, 404368, 177572,
  // Spider-Verse
  324857, 569094,
  // Hotel Transylvania
  76492, 159824, 400155, 639721,
  // Secret Life of Pets & Sing
  328111, 429617, 284052, 438695,
  // Rio, Ferdinand, Croods, Boss Baby, Bad Guys
  60420, 172391, 364689, 49519, 529203, 381284, 49519, 629542,
  // Animated series (TMDB TV IDs)
  // Sonic Boom (61845), Gravity Falls (40075), Phineas and Ferb (4783), Ben 10 (2210), SpongeBob (387)
  61845, 40075, 4783, 2210, 387, 246, 38757, 1408, 4614, 46298, 65334,
]);

/**
 * Normalized keyword tokens of franchises or titles that have official Romanian dubs.
 */
const KNOWN_DUBBED_TITLES = new Set<string>([
  "shrek",
  "shrek 2",
  "shrek the third",
  "shrek al treilea",
  "shrek forever after",
  "shrek pentru totdeauna",
  "puss in boots",
  "motanul incaltat",
  "puss in boots the last wish",
  "cars",
  "cars 2",
  "cars 3",
  "masini",
  "masini 2",
  "masini 3",
  "ice age",
  "epoca de gheata",
  "toy story",
  "povestea jucariilor",
  "lightyear",
  "the lion king",
  "regele leu",
  "kung fu panda",
  "despicable me",
  "sunt un mic ticalos",
  "minions",
  "minionii",
  "how to train your dragon",
  "cum sa ti dregi dragonul",
  "madagascar",
  "finding nemo",
  "in cautarea lui nemo",
  "finding dory",
  "in cautarea lui dory",
  "inside out",
  "intors pe dos",
  "inside out 2",
  "intors pe dos 2",
  "frozen",
  "regatul de gheata",
  "frozen 2",
  "frozen ii",
  "moana",
  "vaiana",
  "zootopia",
  "zootropolis",
  "coco",
  "encanto",
  "luca",
  "soul",
  "suflet",
  "turning red",
  "rosu aprins",
  "elemental",
  "elementar",
  "ratatouille",
  "wall e",
  "up",
  "deasupra tuturor",
  "monsters inc",
  "compania monstrilor",
  "monsters university",
  "universitatea monstrilor",
  "the incredibles",
  "incredibilii",
  "tangled",
  "o poveste incalcita",
  "aladdin",
  "beauty and the beast",
  "frumoasa si bestia",
  "the little mermaid",
  "mica sirena",
  "mulan",
  "tarzan",
  "hercules",
  "spider man into the spider verse",
  "omul paianjen prin univers",
  "spider man across the spider verse",
  "hotel transylvania",
  "hotel transilvania",
  "the secret life of pets",
  "singuri acasa",
  "sing",
  "hai sa cantam",
  "rio",
  "the croods",
  "familia crood",
  "the boss baby",
  "cine i sef acasa",
  "the bad guys",
  "baietii rai",
  "sonic boom",
  "sonic prime",
  "gravity falls",
  "ciudateni",
  "phineas and ferb",
  "phineas si ferb",
  "ben 10",
  "spongebob squarepants",
  "spongebob pantaloni patrati",
  "avatar the last airbender",
  "avatar legenda lui aang",
  "the legend of korra",
  "legenda lui korra",
  "the amazing world of gumball",
  "uimitoarea lume a lui gumball",
  "adventure time",
  "sa nceapa aventura",
  "regular show",
  "un show obisnuit",
  "teen titans go",
  "haideti tineri titani",
  "we bare bears",
  "aventurile fratilor ursi",
  "miraculous",
  "miraculos buburuza si motan noir",
  "paw patrol",
  "patrula catelusilor",
  "ducktales",
  "povesti cu mac mac",
  "kim possible",
  "totally spies",
  "spioanele",
  "winx club",
  "clubul winx",
  "pokemon",
  "star wars the clone wars",
  "star wars rebels",
  "harry potter",
  "the chronicles of narnia",
  "cronicile din narnia",
]);

/**
 * Memory LRU cache for dynamic probe lookups.
 */
const dynamicDubCache = new Map<string, { hasDub: boolean; expires: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** A lookup that failed (no answer in time, an error page) is not asked again for a while either: each would cost a title page its wait. */
const FAILED_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;

function getCached(key: string): boolean | undefined {
  const item = dynamicDubCache.get(key);
  if (!item) return undefined;
  if (Date.now() > item.expires) {
    dynamicDubCache.delete(key);
    return undefined;
  }
  return item.hasDub;
}

function setCached(key: string, hasDub: boolean, ttl = CACHE_TTL_MS): void {
  if (dynamicDubCache.size >= MAX_CACHE_SIZE) {
    const firstKey = dynamicDubCache.keys().next().value;
    if (firstKey) dynamicDubCache.delete(firstKey);
  }
  dynamicDubCache.set(key, { hasDub, expires: Date.now() + ttl });
}

/**
 * Whether a curated name counts for this title. A one-word name ("up", "cars", "coco", "sing", "rio", "soul") is also the start or
 * the middle of the names of many films that have nothing to do with it (Up in the Air, Rio Bravo, Sing Street, Coco Before Chanel):
 * it counts only for an animated title. A name of more words is particular enough by itself.
 */
const counts = (name: string, info: DubLookupInfo): boolean => name.includes(" ") || info.isAnimation === true;

/**
 * Fast synchronous check using the static curated catalog.
 * Useful for library preloads, shelves, and quick badge lookups.
 */
export function hasRomanianDubSync(info: DubLookupInfo): boolean {
  if (info.tmdbId) {
    const numId = Number(info.tmdbId);
    if (!Number.isNaN(numId) && KNOWN_DUBBED_TMDB_IDS.has(numId)) {
      return true;
    }
  }

  const normTitle = normalizeDubTitle(info.title);
  if (normTitle && KNOWN_DUBBED_TITLES.has(normTitle) && counts(normTitle, info)) {
    return true;
  }

  if (info.originalTitle) {
    const normOrig = normalizeDubTitle(info.originalTitle);
    if (normOrig && KNOWN_DUBBED_TITLES.has(normOrig) && counts(normOrig, info)) {
      return true;
    }
  }

  // Check prefix / franchise matches
  for (const franchise of KNOWN_DUBBED_TITLES) {
    if (!counts(franchise, info)) continue;
    if (normTitle.startsWith(franchise + " ") || normTitle.includes(" " + franchise + " ")) {
      return true;
    }
  }

  return false;
}

/**
 * Probes public Romanian dubbed hubs (e.g. DesenFlix) to verify whether an online dubbed release exists.
 */
async function probeOnlineDubHub(title: string): Promise<boolean> {
  const query = normalizeDubTitle(title);
  if (!query || query.length < 3) return false;

  const cached = getCached(query);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(`https://desenflix.online/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=3`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kino/2.0" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      setCached(query, false, FAILED_TTL_MS);
      return false;
    }
    const posts = (await res.json()) as Array<{ title?: { rendered?: string }; dfx_media?: { original_title?: string } }>;
    if (!Array.isArray(posts) || posts.length === 0) {
      setCached(query, false);
      return false;
    }

    const normTarget = query.toLowerCase();
    const hasMatch = posts.some((p) => {
      const rendered = (p.title?.rendered ?? "").toLowerCase();
      const orig = (p.dfx_media?.original_title ?? "").toLowerCase();
      const isDub = rendered.includes("dublat") || rendered.includes("ro dub");
      const titleMatches = rendered.includes(normTarget) || orig.includes(normTarget);
      return isDub && titleMatches;
    });

    setCached(query, hasMatch);
    return hasMatch;
  } catch {
    setCached(query, false, FAILED_TTL_MS);
    return false;
  }
}

/**
 * Asynchronously determines whether a Romanian dub is available for the given title.
 * Performs instant local lookup first, falling back to a quick external probe when suitable.
 */
export async function hasRomanianDub(info: DubLookupInfo): Promise<boolean> {
  if (hasRomanianDubSync(info)) {
    return true;
  }

  // For animation or cartoons, probe the online Romanian dub catalog
  if (info.isAnimation || (info.title && /\b(?:animation|cartoon|desene|disney|pixar|anime)\b/i.test(info.title))) {
    const onlineFound = await probeOnlineDubHub(info.title);
    if (onlineFound) return true;
    if (info.originalTitle && info.originalTitle !== info.title) {
      const origFound = await probeOnlineDubHub(info.originalTitle);
      if (origFound) return true;
    }
  }

  return false;
}

/**
 * Attempts to retrieve a Romanian-dubbed alternate stream for the title/episode.
 */
export async function getRomanianDubSource(info: DubLookupInfo & { season?: number; episode?: number }): Promise<{ stream: { url: string; type: "hls" | "mp4" }; subtitles?: any[] } | null> {
  // Off unless RO_DUB_SOURCES=on. What this finds is not yet a source the player can play: the link is the embed host's player page
  // (`embed_frame_url`), handed over as "hls"; and the post is the first of the search's with a player in it, not one checked to be this
  // title (or this episode: the season and episode are not looked at). Offered as "Română (Dublat)" it would be a source that fails, or
  // another film; and it made every resolve of an animated title wait for two more lookups.
  if (process.env.RO_DUB_SOURCES !== "on") return null;
  // If not known to have a Romanian dub, return null
  const hasDub = await hasRomanianDub(info);
  if (!hasDub) return null;

  // Search DesenFlix for matching post
  try {
    const query = normalizeDubTitle(info.title);
    const res = await fetch(`https://desenflix.online/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=3`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kino/2.0" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const posts = (await res.json()) as Array<{ content?: { rendered?: string }; title?: { rendered?: string } }>;
    if (!Array.isArray(posts) || posts.length === 0) return null;

    // Look for iframe player or direct video in the post
    for (const post of posts) {
      const content = post.content?.rendered || "";
      const iframeMatch = /<iframe[^>]+src=["']([^"']+)["']/i.exec(content);
      if (iframeMatch?.[1]) {
        const embedUrl = iframeMatch[1];
        // If it's a byseraguci or similar player embed, we can resolve its stream or proxy it
        if (/byseraguci\.com\/e\/([a-zA-Z0-9]+)/i.test(embedUrl)) {
          const codeMatch = /byseraguci\.com\/e\/([a-zA-Z0-9]+)/i.exec(embedUrl);
          if (codeMatch?.[1]) {
            const code = codeMatch[1];
            // Get embed details
            const detailRes = await fetch(`https://byseraguci.com/api/videos/${code}/embed/details`, {
              headers: {
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://desenflix.online/",
                "X-Embed-Origin": "desenflix.online",
              },
              signal: AbortSignal.timeout(3000),
            });
            if (detailRes.ok) {
              const details = (await detailRes.json()) as { embed_frame_url?: string };
              if (details.embed_frame_url) {
                // Returns the playable embed/stream link
                return {
                  stream: {
                    url: details.embed_frame_url,
                    type: "hls",
                  },
                };
              }
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return null;
}
