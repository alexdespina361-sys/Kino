import { remember } from "../boundedMap";
import { providerFetch } from "../resolvers/providerFetch";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const HIANIME_BASE = "https://hianime.at";
const XOR_KEY = "otaku-embed-v1";

const MAX_SEARCH_CACHE = 500;
const MAX_EPISODE_CACHE = 500;
const MAX_SERVER_CACHE = 1000;
const CACHE_TTL_MS = 3600_000; // 1 hour

export interface HiAnimeSearchResult {
  title: string;
  href: string;
  id: string;
}

export interface HiAnimeEpisode {
  num: number;
  id: string;
  title?: string;
}

export interface HiAnimeServerInfo {
  type: "sub" | "dub";
  serverName: string;
  embedUrl: string;
}

export interface HiAnimeSubtitleTrack {
  lang: string;
  label: string;
  src: string;
  default?: boolean;
}

export interface HiAnimeStreamResult {
  src: string;
  subtitles: HiAnimeSubtitleTrack[];
  skip?: {
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  };
}

/** In-memory bounded caches for searches and episode lists to make repeated lookups instant */
const searchCache = new Map<string, { expires: number; results: HiAnimeSearchResult[] }>();
const episodeCache = new Map<string, { expires: number; episodes: HiAnimeEpisode[] }>();
const serverCache = new Map<string, { expires: number; servers: HiAnimeServerInfo[] }>();

/**
 * Deobfuscates the base64 config payload from ZokoAnime player (`window.__P = "..."`).
 * Upstream encrypts the JSON config by XORing byte-by-byte with "otaku-embed-v1".
 */
export function deobfuscateZokoBlob(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const keyBuf = Buffer.from(XOR_KEY, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ keyBuf[i % keyBuf.length]!;
  }
  return out.toString("utf8");
}

/**
 * Normalizes title for strict comparison (strips accents, lowercases, removes punctuation).
 */
export function normalizeAnimeTitle(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Searches HiAnime for matching series/movies.
 */
export async function searchHiAnime(
  query: string,
  fetcher: typeof fetch = providerFetch(),
): Promise<HiAnimeSearchResult[]> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return [];

  const cached = searchCache.get(cleanQuery);
  if (cached && cached.expires > Date.now()) {
    return cached.results;
  }

  const searchUrl = `${HIANIME_BASE}/search?keyword=${encodeURIComponent(cleanQuery)}`;
  const res = await fetcher(searchUrl, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    return [];
  }

  const html = await res.text();
  let searchHtml = html;
  const wrapStart = html.indexOf('class="film_list-wrap"');
  if (wrapStart !== -1) {
    const sidebarIdx = html.indexOf('id="main-sidebar"', wrapStart);
    searchHtml = sidebarIdx !== -1 ? html.slice(wrapStart, sidebarIdx) : html.slice(wrapStart);
  }
  const matches = [...searchHtml.matchAll(/<h3 class="film-name">\s*<a href="([^"]+)"\s*title="([^"]+)"/g)];
  const results: HiAnimeSearchResult[] = [];
  const seenHrefs = new Set<string>();

  for (const m of matches) {
    const rawHref = m[1]?.trim() || "";
    const rawTitle = m[2]?.trim() || "";
    if (!rawHref || seenHrefs.has(rawHref)) continue;
    seenHrefs.add(rawHref);

    const href = rawHref.startsWith("http") ? rawHref : `${HIANIME_BASE}${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;
    const id = rawHref.split("-").pop() || "";
    if (id) {
      results.push({
        title: rawTitle
          .replace(/&#039;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&"),
        href,
        id,
      });
    }
  }

  remember(searchCache, cleanQuery, { expires: Date.now() + CACHE_TTL_MS, results }, MAX_SEARCH_CACHE);
  return results;
}

/**
 * Fetches the list of episodes for a given HiAnime anime ID.
 */
export async function getHiAnimeEpisodes(
  animeId: string,
  fetcher: typeof fetch = providerFetch(),
  referer?: string,
): Promise<HiAnimeEpisode[]> {
  const cached = episodeCache.get(animeId);
  if (cached && cached.expires > Date.now()) {
    return cached.episodes;
  }

  const epListUrl = `${HIANIME_BASE}/api/theme/episode/list/${encodeURIComponent(animeId)}`;
  const res = await fetcher(epListUrl, {
    headers: {
      "user-agent": UA,
      "x-requested-with": "XMLHttpRequest",
      referer: referer || `${HIANIME_BASE}/watch/${animeId}`,
    },
  });

  if (!res.ok) {
    return [];
  }

  const json = (await res.json()) as { status?: boolean; html?: string };
  const html = json.html || "";
  const items = html.split("<a ").filter((s) => s.includes("ep-item"));
  const episodes: HiAnimeEpisode[] = [];
  const seenNums = new Set<number>();

  for (const item of items) {
    const numMatch = item.match(/data-number="([^"]+)"/);
    const idMatch = item.match(/data-id="([0-9]+)"/);
    const titleMatch = item.match(/title="([^"]+)"/);
    if (numMatch && idMatch) {
      const epNum = parseInt(numMatch[1]!, 10);
      if (!Number.isNaN(epNum) && !seenNums.has(epNum)) {
        seenNums.add(epNum);
        episodes.push({
          num: epNum,
          id: idMatch[1]!,
          title: titleMatch?.[1]
            ?.replace(/&#039;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&"),
        });
      }
    }
  }

  episodes.sort((a, b) => a.num - b.num);
  remember(episodeCache, animeId, { expires: Date.now() + CACHE_TTL_MS, episodes }, MAX_EPISODE_CACHE);
  return episodes;
}

/**
 * Fetches the server list (ZokoAnime, MegaPlay, etc.) for a specific episode.
 */
export async function getHiAnimeServers(
  episodeId: string,
  fetcher: typeof fetch = providerFetch(),
  referer?: string,
): Promise<HiAnimeServerInfo[]> {
  const cached = serverCache.get(episodeId);
  if (cached && cached.expires > Date.now()) {
    return cached.servers;
  }

  const serverUrl = `${HIANIME_BASE}/api/theme/episode/servers?episodeId=${encodeURIComponent(episodeId)}`;
  const res = await fetcher(serverUrl, {
    headers: {
      "user-agent": UA,
      "x-requested-with": "XMLHttpRequest",
      referer: referer || `${HIANIME_BASE}/`,
    },
  });

  if (!res.ok) {
    return [];
  }

  const json = (await res.json()) as { status?: boolean; html?: string };
  const html = json.html || "";
  const matches = [
    ...html.matchAll(/class="[^"]*server-item[^"]*"[^>]*data-type="([^"]+)"[^>]*data-server-name="([^"]+)"[^>]*data-hash="([^"]+)"/g),
  ];

  const servers: HiAnimeServerInfo[] = [];
  for (const m of matches) {
    const type = m[1]?.toLowerCase() === "dub" ? "dub" : "sub";
    const serverName = m[2]?.trim() || "Server";
    const hash = m[3]?.trim();
    if (hash) {
      try {
        const embedUrl = Buffer.from(hash, "base64").toString("utf8");
        if (embedUrl.startsWith("http")) {
          servers.push({ type, serverName, embedUrl });
        }
      } catch {
        // ignore malformed base64
      }
    }
  }

  remember(serverCache, episodeId, { expires: Date.now() + 1800_000, servers }, MAX_SERVER_CACHE);
  return servers;
}

/**
 * Extracts raw stream URL and subtitles from a ZokoAnime embed player page.
 */
export async function extractZokoStream(
  embedUrl: string,
  fetcher: typeof fetch = providerFetch(),
): Promise<HiAnimeStreamResult | null> {
  const res = await fetcher(embedUrl, {
    headers: {
      "user-agent": UA,
      referer: `${HIANIME_BASE}/`,
    },
  });

  if (!res.ok) {
    return null;
  }

  const html = await res.text();
  const blobMatch = html.match(/window\.__P\s*=\s*"([^"]+)"/);
  if (!blobMatch?.[1]) {
    return null;
  }

  try {
    const jsonStr = deobfuscateZokoBlob(blobMatch[1]);
    const parsed = JSON.parse(jsonStr) as {
      src?: string;
      subtitles?: Array<{ lang?: string; label?: string; src?: string; default?: boolean }>;
      skip?: { intro?: { start: number; end: number }; outro?: { start: number; end: number } };
    };

    if (!parsed.src || !parsed.src.startsWith("http")) {
      return null;
    }

    const subtitles: HiAnimeSubtitleTrack[] = (parsed.subtitles || [])
      .filter((s): s is { lang: string; label?: string; src: string; default?: boolean } => Boolean(s.src && s.lang))
      .map((s) => ({
        lang: s.lang,
        label: s.label || s.lang.toUpperCase(),
        src: s.src,
        default: Boolean(s.default),
      }));

    return {
      src: parsed.src,
      subtitles,
      skip: parsed.skip,
    };
  } catch {
    return null;
  }
}

export interface ResolvedHiAnimeStream {
  stream: HiAnimeStreamResult;
  embedUrl: string;
  type: "sub" | "dub";
  alternate?: { stream: HiAnimeStreamResult; embedUrl: string; type: "sub" | "dub" };
  altDubStream?: { stream: HiAnimeStreamResult; embedUrl: string };
}

/**
 * Resolves a stream for a specific anime ID and episode number from HiAnime.
 */
export async function resolveHiAnimeEpisodeStream(
  animeId: string,
  episodeNum: number,
  options: { mode?: "sub" | "dub"; fetcher?: typeof fetch } = {},
): Promise<ResolvedHiAnimeStream | null> {
  const fetcher = options.fetcher ?? providerFetch();
  const mode = options.mode ?? "sub";

  const episodes = await getHiAnimeEpisodes(animeId, fetcher);
  const targetEp = episodes.find((ep) => ep.num === episodeNum);
  if (!targetEp) {
    return null;
  }

  const servers = await getHiAnimeServers(targetEp.id, fetcher);
  if (servers.length === 0) {
    return null;
  }

  const isZoko = (s: HiAnimeServerInfo) => s.serverName.toLowerCase() === "zokoanime";

  // Rank servers: ZokoAnime of wanted mode -> other servers of wanted mode -> ZokoAnime of other mode -> remaining.
  // Try each in turn and move on when Zoko extraction fails.
  const rankedPrimary = [
    ...servers.filter((s) => isZoko(s) && s.type === mode),
    ...servers.filter((s) => !isZoko(s) && s.type === mode),
    ...servers.filter((s) => isZoko(s) && s.type !== mode),
    ...servers.filter((s) => !isZoko(s) && s.type !== mode),
  ];

  let primaryServer: HiAnimeServerInfo | undefined;
  let primaryResult: HiAnimeStreamResult | null = null;
  const triedUrls = new Set<string>();

  for (const candidate of rankedPrimary) {
    if (triedUrls.has(candidate.embedUrl)) continue;
    triedUrls.add(candidate.embedUrl);
    try {
      const extracted = await extractZokoStream(candidate.embedUrl, fetcher);
      if (extracted) {
        primaryServer = candidate;
        primaryResult = extracted;
        break;
      }
    } catch {
      // try next server
    }
  }

  if (!primaryServer || !primaryResult) {
    return null;
  }

  // Check if opposite mode (dub if primary is sub, or sub if primary is dub) is available as alternate
  const otherMode = primaryServer.type === "dub" ? "sub" : "dub";
  let alternate: { stream: HiAnimeStreamResult; embedUrl: string; type: "sub" | "dub" } | undefined;
  const rankedOther = [
    ...servers.filter((s) => isZoko(s) && s.type === otherMode),
    ...servers.filter((s) => !isZoko(s) && s.type === otherMode),
  ];

  for (const otherServer of rankedOther) {
    if (triedUrls.has(otherServer.embedUrl)) continue;
    triedUrls.add(otherServer.embedUrl);
    try {
      const otherRes = await extractZokoStream(otherServer.embedUrl, fetcher);
      if (otherRes) {
        alternate = { stream: otherRes, embedUrl: otherServer.embedUrl, type: otherMode };
        break;
      }
    } catch {
      // non-fatal, try next server
    }
  }

  const altDubStream =
    primaryServer.type === "sub" && alternate?.type === "dub"
      ? { stream: alternate.stream, embedUrl: alternate.embedUrl }
      : undefined;

  return {
    stream: primaryResult,
    embedUrl: primaryServer.embedUrl,
    type: primaryServer.type,
    alternate,
    altDubStream,
  };
}
