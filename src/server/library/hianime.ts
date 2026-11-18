import { remember } from "../boundedMap";
import { providerFetch } from "../resolvers/providerFetch";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const HIANIME_BASE = "https://hianime.at";
const XOR_KEY = "otaku-embed-v1";

const MAX_SEARCH_CACHE = 500;
const MAX_EPISODE_CACHE = 500;
const MAX_SERVER_CACHE = 1000;
const MAX_AIRED_CACHE = 500;
const CACHE_TTL_MS = 3600_000;

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

const searchCache = new Map<string, { expires: number; results: HiAnimeSearchResult[] }>();
const episodeCache = new Map<string, { expires: number; episodes: HiAnimeEpisode[] }>();
const serverCache = new Map<string, { expires: number; servers: HiAnimeServerInfo[] }>();
const airedCache = new Map<string, { expires: number; time: number | null }>();

export function deobfuscateZokoBlob(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const keyBuf = Buffer.from(XOR_KEY, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ keyBuf[i % keyBuf.length]!;
  }
  return out.toString("utf8");
}

export function normalizeAnimeTitle(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const sidebarIdx = html.indexOf('id="main-sidebar"');
  if (sidebarIdx !== -1) {
    const wrapStart = html.indexOf('class="film_list-wrap"');
    if (wrapStart === -1 || wrapStart > sidebarIdx) {
      remember(searchCache, cleanQuery, { expires: Date.now() + CACHE_TTL_MS, results: [] }, MAX_SEARCH_CACHE);
      return [];
    }
    searchHtml = html.slice(wrapStart, sidebarIdx);
  } else {
    const wrapStart = html.indexOf('class="film_list-wrap"');
    if (wrapStart !== -1) {
      searchHtml = html.slice(wrapStart);
    }
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

export async function getHiAnimeAiredTime(
  href: string,
  fetcher: typeof fetch = providerFetch(),
): Promise<number | null> {
  if (!href) return null;
  const cached = airedCache.get(href);
  if (cached && cached.expires > Date.now()) {
    return cached.time;
  }

  try {
    const res = await fetcher(href, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/Aired:[\s\S]{0,160}?<span[^>]*class="name"[^>]*>([^<]+)<\/span>/i);
    const raw = match?.[1]?.split(/\bto\b/i)[0]?.trim();
    const parsed = raw ? Date.parse(raw) : Number.NaN;
    const time = Number.isFinite(parsed) ? parsed : null;
    remember(airedCache, href, { expires: Date.now() + 6 * CACHE_TTL_MS, time }, MAX_AIRED_CACHE);
    return time;
  } catch {
    return null;
  }
}

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
      }
    }
  }

  remember(serverCache, episodeId, { expires: Date.now() + 1800_000, servers }, MAX_SERVER_CACHE);
  return servers;
}

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

  const isZokoServer = (s: HiAnimeServerInfo): boolean => {
    if (s.serverName.toLowerCase() === "zokoanime") return true;
    try {
      return /(^|\.)zokoanime\./i.test(new URL(s.embedUrl).hostname);
    } catch {
      return false;
    }
  };

  const zokoServers = servers.filter(isZokoServer);
  if (zokoServers.length === 0) {
    return null;
  }

  const rankedPrimary = [
    ...zokoServers.filter((s) => s.type === mode),
    ...zokoServers.filter((s) => s.type !== mode),
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
    }
  }

  if (!primaryServer || !primaryResult) {
    return null;
  }

  const otherMode = primaryServer.type === "dub" ? "sub" : "dub";
  let alternate: { stream: HiAnimeStreamResult; embedUrl: string; type: "sub" | "dub" } | undefined;
  const rankedOther = zokoServers.filter((s) => s.type === otherMode);

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
