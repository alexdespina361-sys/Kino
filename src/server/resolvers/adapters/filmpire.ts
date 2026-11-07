import { isHttpUrl, type AlternateSource, type EpisodeRef, type SeriesInfo, type SubtitleTrack } from "../../../shared";
import { remember } from "../../boundedMap";
import { FILMPIRE_TMDB_API_KEY } from "../../library/filmpire";
import { providerFetch } from "../providerFetch";
import type { ResolveResult, SiteAdapter } from "../types";
import { signedRelayUrl } from "../../streamRelay/links";
import { streamAddress } from "./streamAddress";
import { decryptInThread } from "./wasmDecrypt";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** What is taken of a player's answer: no more streams, subtitles or episodes than a screen can use, however many the answer lists. */
const MAX_STREAMS = 12;
const MAX_SUBTITLES = 60;
const MAX_EPISODES = 400;

async function getJson<T = Record<string, unknown>>(get: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await get(url, {
    headers: { "user-agent": UA, accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json() as Promise<T>;
}

async function getText(get: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await get(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function decryptWasm(get: typeof fetch, encBase64: string, wasmUrl: string, referer: string): Promise<string[]> {
  const wasmRes = await get(wasmUrl, {
    headers: { "user-agent": UA, referer },
  });
  if (!wasmRes.ok) throw new Error(`Failed to fetch wasm from ${wasmUrl}`);
  const wasm = new Uint8Array(await wasmRes.arrayBuffer());
  const decrypted = await decryptInThread(wasm, Buffer.from(encBase64, "base64"));
  return decrypted.split("\n").map((s) => s.trim()).filter(isHttpUrl);
}

const LANG_NAMES: Record<string, string> = {
  eng: "English", en: "English",
  ron: "Romanian", rum: "Romanian", ro: "Romanian",
  spa: "Spanish", es: "Spanish",
  fre: "French", fra: "French", fr: "French",
  deu: "German", ger: "German", de: "German",
  ita: "Italian", it: "Italian",
  por: "Portuguese", pt: "Portuguese", pob: "Portuguese (BR)",
  rus: "Russian", ru: "Russian",
  ara: "Arabic", ar: "Arabic",
  tur: "Turkish", tr: "Turkish",
  pol: "Polish", pl: "Polish",
  nld: "Dutch", nl: "Dutch",
  alb: "Albanian", sqi: "Albanian", sq: "Albanian",
  gre: "Greek", ell: "Greek", el: "Greek",
  hun: "Hungarian", hu: "Hungarian",
  cze: "Czech", ces: "Czech", cs: "Czech",
  srp: "Serbian", scc: "Serbian", sr: "Serbian",
  hrv: "Croatian", hr: "Croatian",
  bul: "Bulgarian", bg: "Bulgarian",
  heb: "Hebrew", he: "Hebrew",
  hin: "Hindi", hi: "Hindi",
  chi: "Chinese", zho: "Chinese", zh: "Chinese",
  jpn: "Japanese", ja: "Japanese",
  kor: "Korean", ko: "Korean",
  swe: "Swedish", sv: "Swedish",
  nor: "Norwegian", no: "Norwegian",
  dan: "Danish", da: "Danish",
  fin: "Finnish", fi: "Finnish",
  ukr: "Ukrainian", uk: "Ukrainian",
  ind: "Indonesian", id: "Indonesian",
  vie: "Vietnamese", vi: "Vietnamese",
  tha: "Thai", th: "Thai",
};

interface CachedHostToken {
  token: string;
  expiresAt: number;
}
const hostTokenCache = new Map<string, CachedHostToken>();
/** The tokens are kept by the origin of a stream's address, which the site chooses: no more than this many are kept (the oldest go first). */
const MAX_HOST_TOKENS = 100;
/** A token longer than this cannot be part of an address that a screen takes (2048 characters). */
const MAX_TOKEN_CHARS = 1900;

function parseJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"));
      if (typeof payload.exp === "number") {
        return payload.exp * 1000;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function getHostToken(
  get: typeof fetch,
  streamOrigin: string,
  playerUrl: string,
  apiToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cached = hostTokenCache.get(streamOrigin);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  try {
    const genUrl = apiToken
      ? `${streamOrigin}/generate.php?api_token=${encodeURIComponent(apiToken)}`
      : `${streamOrigin}/generate.php`;

    let rawToken = "";
    const relay = env.EDGE_STREAM_PROXY_URL?.trim();
    const key = env.EDGE_STREAM_PROXY_KEY;

    if (relay && key && key.length >= 32) {
      try {
        const relayGenUrl = signedRelayUrl(
          relay,
          { url: genUrl, referer: playerUrl, expires: now + 300_000, hostToken: false },
          key,
        );
        const relayed = (await getText(get, relayGenUrl)).trim();
        let extracted = "";
        try {
          const parsed = JSON.parse(relayed) as Record<string, string>;
          extracted = parsed.token || parsed.data || relayed;
        } catch {
          extracted = relayed;
        }
        if (extracted && extracted.includes(".")) {
          rawToken = extracted;
        }
      } catch {
        // Fall back to direct fetch if relay fails
      }
    }

    if (!rawToken) {
      rawToken = await getText(get, genUrl, { referer: playerUrl });
    }

    let token = "";
    try {
      const parsed = JSON.parse(rawToken.trim()) as Record<string, string>;
      token = parsed.token || parsed.data || rawToken.trim();
    } catch {
      token = rawToken.trim();
    }
    if (token && token.length <= MAX_TOKEN_CHARS) {
      const exp = parseJwtExp(token) ?? (now + 2 * 3600 * 1000);
      remember(hostTokenCache, streamOrigin, { token, expiresAt: exp }, MAX_HOST_TOKENS);
      return token;
    }
  } catch {
    // If rate-limited or fetch failed, fallback to existing cached token if any
    if (cached?.token) {
      return cached.token;
    }
  }
  return cached?.token || "";
}

export interface FilmpireAdapterOptions {
  /** How the sites are asked. Default: `providerFetch()`, which goes to public addresses only and reads no more than a bounded answer. */
  fetch?: typeof fetch;
}

export function createFilmpireAdapter(options: FilmpireAdapterOptions = {}): SiteAdapter {
  const get = options.fetch ?? providerFetch();
  const fetchJson = <T = Record<string, unknown>>(url: string, headers: Record<string, string> = {}): Promise<T> => getJson<T>(get, url, headers);
  const fetchText = (url: string, headers: Record<string, string> = {}): Promise<string> => getText(get, url, headers);
  return {
    id: "filmpire",
    domains: ["filmpire.sc", "filmpire.cc", "www.filmpire.cc", "filmpire.net", "filmpire.to", "filmpire.vip", "vidsrc.me", "screenfetch4.cyou"],
    async resolve(url: URL): Promise<ResolveResult> {
      // 1. Parse movie / series info
      const pathMatch = url.pathname.match(/\/(?:watch|movie|tv|series|embed)\/([a-zA-Z0-9_-]+)/i);
      const queryId = url.searchParams.get("tmdb") || url.searchParams.get("id");
      const id = pathMatch?.[1] || queryId;

      if (!id) {
        return { status: "invalid_url" };
      }

      const s = url.searchParams.get("s") || url.searchParams.get("season");
      const e = url.searchParams.get("e") || url.searchParams.get("episode");
      const isTv = Boolean(
        (s && e) ||
        url.pathname.includes("/tv") ||
        url.pathname.includes("/series") ||
        url.searchParams.get("type") === "series" ||
        url.searchParams.get("type") === "tv"
      );
      const contentType = isTv ? "tv" : "movie";

      // 2. Fetch metadata from TMDB
      let title = "Filmpire Video";
      let tmdbImdbId: string | undefined;
      let rawShowTitle: string | undefined;
      try {
        const tmdbData = await fetchJson<{ title?: string; name?: string; imdb_id?: string }>(
          `https://api.themoviedb.org/3/${contentType}/${id}?api_key=${FILMPIRE_TMDB_API_KEY}`,
        );
        if (tmdbData.title || tmdbData.name) {
          rawShowTitle = tmdbData.title || tmdbData.name;
          title = rawShowTitle || title;
          if (s && e) title += ` · S${s} E${e}`;
        }
        if (tmdbData.imdb_id) tmdbImdbId = tmdbData.imdb_id;
      } catch {
        // Non-fatal if TMDB is unreachable
      }

      const fallbackAnime = async (): Promise<ResolveResult | null> => {
        if (!rawShowTitle) return null;
        try {
          const { animeHeavenSource } = await import("../../library/animeheaven");
          const { createAnimeHeavenAdapter } = await import("./animeheaven");
          const ah = animeHeavenSource({ fetch: get });
          if (!ah.search || !ah.episodes) return null;
          let results = await ah.search(rawShowTitle);
          if (rawShowTitle.toLowerCase().includes("jujutsu")) {
            const extra = await ah.search("sorcery fight");
            const seenUrls = new Set(results.map((r) => r.url));
            for (const item of extra) {
              if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                results.push(item);
              }
            }
          }
          if (results.length === 0) return null;

          const targetSeason = Number(s || "1");
          const targetEpisode = Number(e || "1");

          const extractAnimeSeason = (tTitle: string): number => {
            const t = tTitle.toLowerCase();
            if (/\b(?:season\s*2|2nd\s*season|second\s*season|part\s*2)\b/i.test(t)) return 2;
            if (/\b(?:season\s*3|3rd\s*season|third\s*season|part\s*3|culling\s*game)\b/i.test(t)) return 3;
            if (/\b(?:season\s*4|4th\s*season|fourth\s*season|part\s*4|final\s*season)\b/i.test(t)) return 4;
            if (/\b(?:season\s*5|5th\s*season|fifth\s*season|part\s*5)\b/i.test(t)) return 5;
            const sMatch = t.match(/\b(?:season|part)\s*(\d+)\b/i) || t.match(/\b(\d+)(?:st|nd|rd|th)\s*season\b/i);
            if (sMatch) return Number(sMatch[1]);
            if (/\b(?:movie|film|special|ova)\b/i.test(t) || /\b0\b/.test(t)) return 0;
            return 1;
          };

          const matchedSeasonList = results.filter((r) => extractAnimeSeason(r.title) === targetSeason);
          let matched = matchedSeasonList[0];
          if (!matched && targetSeason > 1) {
            matched = results.find(
              (r) =>
                r.title.toLowerCase().includes(`season ${targetSeason}`) ||
                r.title.toLowerCase().includes(`${targetSeason}nd season`) ||
                r.title.toLowerCase().includes(`${targetSeason}rd season`) ||
                r.title.toLowerCase().includes(`${targetSeason}th season`),
            );
          }
          if (!matched && targetSeason === 1) {
            matched = results.find((r) => extractAnimeSeason(r.title) === 1);
          }
          if (!matched || extractAnimeSeason(matched.title) !== targetSeason) return null;

          const eps = await ah.episodes(matched.url, 1);
          const targetEp = eps.find((ep) => ep.episode === targetEpisode);
          if (!targetEp?.url) return null;

          const ahAdapter = createAnimeHeavenAdapter({ fetch: get });
          const res = await ahAdapter.resolve(new URL(targetEp.url));
          if (res.status === "success") {
            return {
              ...res,
              media: {
                ...res.media,
                title,
                page: url.href,
              },
            };
          }
          return null;
        } catch {
          return null;
        }
      }

      // 3. Request embed player from screenfetch4 / vidsrc
      const tvQuery = s && e ? `&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}` : "";
      let containerUrl: string | undefined;

      try {
        const sfData = await fetchJson<{ src?: string }>(
          `https://screenfetch4.cyou/vs_src.php?type=${contentType}&id=${id}${tvQuery}`,
          { referer: `https://screenfetch4.cyou/embed/${contentType}?tmdb=${id}&o=https%3A%2F%2Ffilmpire.sc` },
        );
        containerUrl = sfData.src;
      } catch {
        // Fallback to vidsrc.me
        try {
          const vsData = await fetchJson<{ src?: string }>(
            `https://vidsrc.me/vs_src.php?type=${contentType}&id=${id}${tvQuery}`,
            { referer: `https://vidsrc.me/embed/${contentType}/${id}` },
          );
          containerUrl = vsData.src;
        } catch {
          const alt = await fallbackAnime();
          if (alt) return alt;
          return { status: "temporary_failure", reason: "Could not reach streaming server." };
        }
      }

      if (!containerUrl) {
        const alt = await fallbackAnime();
        if (alt) return alt;
        return { status: "unsupported", reason: "Video source currently unavailable." };
      }

      // 4. Fetch container page (stellarconductornexus)
      let playerUrl: string;
      try {
        let landingHtml = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            landingHtml = await fetchText(containerUrl, { referer: "https://screenfetch4.cyou/" });
            if (landingHtml) break;
          } catch (err) {
            if (attempt === 2) throw err;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        const playerMatch = landingHtml.match(/"playerUrl"\s*:\s*"([^"]+)"/i);
        if (!playerMatch?.[1]) {
          throw new Error(`Missing playerUrl in container (len ${landingHtml.length})`);
        }
        playerUrl = new URL(playerMatch[1].replace(/\\u0026/g, "&"), containerUrl).href;
      } catch (err) {
        const alt = await fallbackAnime();
        if (alt) return alt;
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "temporary_failure", reason: `Could not load video player: ${msg}` };
      }

      // 5. Fetch player page and extract CONFIG
      let streamApiUrl: string;
      let playerHtml = "";
      let seriesInfo: SeriesInfo | undefined;
      let playerConfig: { api?: string; apiToken: string; mediaType?: string; streamBase?: string } | undefined;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            playerHtml = await fetchText(playerUrl, { referer: containerUrl });
            if (playerHtml) break;
          } catch (err) {
            if (attempt === 2) throw err;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
        if (!configMatch?.[1]) {
          const titleTag = playerHtml.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
          throw new Error(`Missing window.CONFIG (title: "${titleTag}", len ${playerHtml.length})`);
        }
        const config = JSON.parse(configMatch[1]) as {
          api?: string;
          apiToken?: string;
          rateLimited?: boolean;
          mediaType?: string;
          streamBase?: string;
        };

        if (config.rateLimited || !config.apiToken) {
          const alt = await fallbackAnime();
          if (alt) return alt;
          return {
            status: "temporary_failure",
            reason: "Upstream video provider is temporarily rate-limiting requests. Please wait a moment and try again.",
          };
        }

        playerConfig = config as { api?: string; apiToken: string; mediaType?: string; streamBase?: string };
        if (config.mediaType === "tv" || config.streamBase || isTv) {
          const targetSeason = s || "1";
          const targetEpisode = e || "1";
          const streamBase = (config.streamBase || config.api || "").replace(/\\u0026/g, "&");
          streamApiUrl = `${streamBase}&season=${encodeURIComponent(targetSeason)}&episode=${encodeURIComponent(targetEpisode)}&stream_urls&api_token=${config.apiToken}`;

          // Fetch full seasons and episodes map for series navigation & next episode resolution
          try {
            const epsJson = await fetchJson<{ data?: { title?: string; eps?: Record<string, string[] | number[]> } }>(
              `${streamBase}&api_token=${config.apiToken}`,
              { referer: playerUrl },
            );
            if (epsJson.data?.title && title === "Filmpire Video") {
              title = `${epsJson.data.title} · S${targetSeason} E${targetEpisode}`;
            }
            const epsMap = epsJson.data?.eps;
            if (epsMap) {
              const currS = Number(targetSeason);
              const currE = Number(targetEpisode);
              const seasonNums = Object.keys(epsMap).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
              let nextS: number | undefined;
              let nextE: number | undefined;

              if (seasonNums.includes(currS)) {
                const epNums = (epsMap[String(currS)] || []).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
                const eIdx = epNums.indexOf(currE);
                if (eIdx !== -1 && eIdx < epNums.length - 1) {
                  nextS = currS;
                  nextE = epNums[eIdx + 1];
                } else {
                  const sIdx = seasonNums.indexOf(currS);
                  if (sIdx !== -1 && sIdx < seasonNums.length - 1) {
                    const nextSeasonNum = seasonNums[sIdx + 1]!;
                    const nextSeasonEps = (epsMap[String(nextSeasonNum)] || []).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
                    if (nextSeasonEps.length > 0) {
                      nextS = nextSeasonNum;
                      nextE = nextSeasonEps[0];
                    }
                  }
                }
              }

              // Fetch episode names from TMDB for current season if available
              const tmdbNames = new Map<number, string>();
              try {
                const tmdbSeason = await fetchJson<{ episodes?: Array<{ episode_number?: number; name?: string }> }>(
                  `https://api.themoviedb.org/3/tv/${id}/season/${currS}?api_key=${FILMPIRE_TMDB_API_KEY}`,
                );
                if (tmdbSeason.episodes) {
                  for (const ep of tmdbSeason.episodes) {
                    if (ep.episode_number && ep.name) {
                      tmdbNames.set(ep.episode_number, ep.name);
                    }
                  }
                }
              } catch {
                // Non-fatal if TMDB season lookup fails
              }

              const allEpisodes: EpisodeRef[] = [];
              for (const sNum of seasonNums) {
                const epNums = (epsMap[String(sNum)] || []).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
                for (const epNum of epNums) {
                  if (allEpisodes.length >= MAX_EPISODES) break;
                  const epTitle = sNum === currS && tmdbNames.has(epNum)
                    ? tmdbNames.get(epNum)
                    : `S${sNum}:E${epNum}`;
                  allEpisodes.push({
                    season: sNum,
                    episode: epNum,
                    title: epTitle,
                    url: `https://filmpire.sc/watch/${id}?s=${sNum}&e=${epNum}`,
                  });
                }
              }

              const nextTitle = nextS !== undefined && nextE !== undefined
                ? (nextS === currS && tmdbNames.has(nextE) ? tmdbNames.get(nextE) : `S${nextS}:E${nextE}`)
                : undefined;

              seriesInfo = {
                season: currS,
                episode: currE,
                next: nextS !== undefined && nextE !== undefined ? {
                  season: nextS,
                  episode: nextE,
                  url: `https://filmpire.sc/watch/${id}?s=${nextS}&e=${nextE}`,
                  title: nextTitle,
                } : undefined,
                episodes: allEpisodes.length > 0 ? allEpisodes : undefined,
              };
            }
          } catch {
            // Non-fatal if eps map fails
          }

          if (!seriesInfo) {
            seriesInfo = {
              season: Number(targetSeason),
              episode: Number(targetEpisode),
              next: {
                season: Number(targetSeason),
                episode: Number(targetEpisode) + 1,
                url: `https://filmpire.sc/watch/${id}?s=${targetSeason}&e=${Number(targetEpisode) + 1}`,
                title: `S${targetSeason}:E${Number(targetEpisode) + 1}`,
              },
            };
          }
        } else {
          const cleanApi = (config.api || "").replace(/\\u0026/g, "&");
          streamApiUrl = `${cleanApi}&api_token=${config.apiToken}`;
        }
      } catch (err) {
        const alt = await fallbackAnime();
        if (alt) return alt;
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "temporary_failure", reason: `Could not parse video player config: ${msg}` };
      }

      // 6. Fetch stream API and decrypt URLs
      let streamUrls: string[] = [];
      const subtitles: SubtitleTrack[] = [];
      let apiImdbId: string | undefined;
      try {
        const apiData = await fetchJson<{
          data?: {
            title?: string;
            imdb_id?: string;
            stream_urls?: string | string[];
            subtitles?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
            tracks?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
          };
          subtitles?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
          tracks?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
          vs?: { wasm_url?: string };
        }>(streamApiUrl, { referer: playerUrl });

        if (apiData.data?.title && (title === "Filmpire Video" || !title)) {
          title = apiData.data.title;
          if (seriesInfo) title += ` · S${seriesInfo.season} E${seriesInfo.episode}`;
        }
        apiImdbId = apiData.data?.imdb_id;
        const raw = apiData.data?.stream_urls;
        if (typeof raw === "string" && apiData.vs?.wasm_url) {
          streamUrls = await decryptWasm(get, raw, apiData.vs.wasm_url, playerUrl);
        } else if (Array.isArray(raw)) {
          streamUrls = raw.filter((u): u is string => typeof u === "string" && isHttpUrl(u));
        }
        streamUrls = streamUrls.slice(0, MAX_STREAMS);

        const rawSubs =
          apiData.data?.subtitles ||
          apiData.subtitles ||
          apiData.data?.tracks ||
          apiData.tracks ||
          [];
        for (const sub of rawSubs) {
          if (subtitles.length >= MAX_SUBTITLES) break;
          const subUrl = sub.file || sub.url;
          if (subUrl && typeof subUrl === "string") {
            const absSub = subUrl.startsWith("http") ? subUrl : new URL(subUrl, playerUrl).href;
            subtitles.push({
              id: subtitles.length,
              url: `/api/proxy?url=${encodeURIComponent(absSub)}&referer=${encodeURIComponent(playerUrl)}`,
              label: sub.label || sub.lang || `Subtitle ${subtitles.length + 1}`,
              lang: sub.lang,
            });
          }
        }
      } catch (err) {
        const alt = await fallbackAnime();
        if (alt) return alt;
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "temporary_failure", reason: `Could not retrieve video stream: ${msg}` };
      }

      if (subtitles.length === 0) {
        try {
          const trackMatch = playerHtml.match(/tracks\s*:\s*(\[[^\]]+\])/i);
          if (trackMatch?.[1]) {
            const parsed = JSON.parse(trackMatch[1]) as Array<{ file?: string; url?: string; label?: string; lang?: string; kind?: string }>;
            for (const t of parsed) {
              if (subtitles.length >= MAX_SUBTITLES) break;
              if (t.kind && t.kind !== "captions" && t.kind !== "subtitles") continue;
              const subUrl = t.file || t.url;
              if (subUrl && typeof subUrl === "string") {
                const absSub = subUrl.startsWith("http") ? subUrl : new URL(subUrl, playerUrl).href;
                subtitles.push({
                  id: subtitles.length,
                  url: `/api/proxy?url=${encodeURIComponent(absSub)}&referer=${encodeURIComponent(playerUrl)}`,
                  label: t.label || t.lang || `Subtitle ${subtitles.length + 1}`,
                  lang: t.lang,
                });
              }
            }
          }
        } catch {
          // ignore track parse failures
        }
      }

      // Fetch multilingual subtitles via IMDb ID from OpenSubtitles
      const imdbId = apiImdbId || tmdbImdbId;
      if (imdbId) {
        try {
          const subSeason = seriesInfo?.season ?? s;
          const subEpisode = seriesInfo?.episode ?? e;
          const stremioEndpoint = (isTv || seriesInfo) && subSeason && subEpisode
            ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${subSeason}:${subEpisode}.json`
            : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
          const subData = await fetchJson<{
            subtitles?: Array<{ id: string; url: string; lang: string; subtitleFileName?: string }>;
          }>(stremioEndpoint);
          if (subData?.subtitles?.length) {
            const seenLangs = new Set<string>();
            for (const item of subData.subtitles) {
              if (subtitles.length >= MAX_SUBTITLES) break;
              if (!item.url) continue;
              const langCode = (item.lang || "en").toLowerCase();
              const count = [...seenLangs].filter((l) => l.startsWith(langCode)).length;
              if (count >= 12) continue;
              seenLangs.add(`${langCode}_${count}`);

              const langName = LANG_NAMES[langCode] || langCode.toUpperCase();
              let label = langName;
              if (item.subtitleFileName) {
                const clean = item.subtitleFileName.replace(/\.(srt|vtt)$/i, "").trim();
                label = count === 0 ? `${langName} · ${clean}` : `${langName} (${count + 1}) · ${clean}`;
              } else if (count > 0) {
                label = `${langName} (${count + 1})`;
              }
              subtitles.push({
                id: subtitles.length,
                url: `/api/proxy?url=${encodeURIComponent(item.url)}&format=vtt`,
                label: label.slice(0, 100),
                lang: langCode,
              });
            }
          }
        } catch {
          // Non-fatal if stremio is unreachable
        }
      }

      // 6.5. Fetch high-quality Romanian subtitles (Subs.ro & Subtitrari-Noi) with caching
      try {
        const { getRomanianSubtitleManager } = await import("../../subtitles/romanian");
        const roManager = getRomanianSubtitleManager();
        const roSubs = await roManager.getSubtitles({
          imdbId,
          tmdbId: id,
          title: rawShowTitle,
          season: (seriesInfo?.season ?? s) || undefined,
          episode: (seriesInfo?.episode ?? e) || undefined,
        });
        if (roSubs.length > 0) {
          subtitles.unshift(...roSubs);
        }
      } catch {
        // Non-fatal if Romanian subtitle fetch encounters an error
      }

      // Re-index subtitles sequentially so each track ID is unique and contiguous
      subtitles.forEach((sub, idx) => {
        sub.id = idx;
      });

      if (streamUrls.length === 0) {
        const alt = await fallbackAnime();
        if (alt) return alt;
        return { status: "unsupported", reason: "No video streams found." };
      }

      // 7. Request host token with cache & fallback across streams
      let chosenStream = streamUrls[0]!;
      let chosenToken = "";
      // The dedicated relay obtains its own IP-bound token. A website-issued token cannot authorize another machine's media requests.
      const relayOwnsToken = Boolean(process.env.EDGE_STREAM_PROXY_URL?.trim() && process.env.EDGE_STREAM_PROXY_KEY);

      if (!relayOwnsToken) {
        for (const sUrl of streamUrls) {
          try {
            const origin = new URL(sUrl).origin;
            const tok = await getHostToken(get, origin, playerUrl, playerConfig?.apiToken);
            if (tok) {
              chosenStream = sUrl;
              chosenToken = tok;
              break;
            }
          } catch {
            // try next stream
          }
        }
      }

      // 8. Stream delivery:
      // When a dedicated relay is configured (EDGE_STREAM_PROXY_URL), the relay streams media chunks using its own IP-bound token (hostToken: true).
      // Video bandwidth stays entirely on the dedicated relay (Oracle Cloud), keeping website bandwidth (Render) near zero.
      const relayReferer = playerConfig?.apiToken
        ? `${playerUrl}${playerUrl.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(playerConfig.apiToken)}`
        : playerUrl;
      const delim = chosenStream.includes("?") ? "&" : "?";
      const finalStreamUrl = chosenToken
        ? `${chosenStream}${delim}token=${encodeURIComponent(chosenToken)}&bypass_localize=true`
        : chosenStream;
      const proxiedUrl = streamAddress(finalStreamUrl, relayReferer, process.env, relayOwnsToken);

      // 9. Generate alternates for the other decrypted stream URLs (multiple sources support)
      const alternates: AlternateSource[] = [];
      for (const sUrl of streamUrls) {
        if (sUrl === chosenStream) continue;
        if (alternates.length >= 4) break;
        try {
          const origin = new URL(sUrl).origin;
          const hostName = new URL(sUrl).hostname.split(".")[0] || "Server";
          const altToken = relayOwnsToken ? "" : await getHostToken(get, origin, playerUrl, playerConfig?.apiToken);
          const altDelim = sUrl.includes("?") ? "&" : "?";
          const altFinalUrl = altToken
            ? `${sUrl}${altDelim}token=${encodeURIComponent(altToken)}&bypass_localize=true`
            : sUrl;
          alternates.push({
            label: `Server ${alternates.length + 2} (${hostName})`,
            stream: {
              url: streamAddress(altFinalUrl, relayReferer, process.env, relayOwnsToken),
              type: "hls",
              directUrl: altFinalUrl,
            },
            subtitles,
          });
        } catch {
          // ignore failed alternate
        }
      }

      if (rawShowTitle && isTv && alternates.length < 4) {
        try {
          const altAnime = await fallbackAnime();
          if (altAnime?.status === "success") {
            alternates.push({
              label: `Server ${alternates.length + 2} (AnimeHeaven)`,
              stream: altAnime.media.stream,
            });
          }
        } catch {
          // ignore
        }
      }

      // Check if Romanian dub stream or alternate source is available
      try {
        const { getRomanianDubSource } = await import("../../dubs/romanian");
        const seasonNum = seriesInfo?.season ?? (s ? Number(s) : undefined);
        const episodeNum = seriesInfo?.episode ?? (e ? Number(e) : undefined);
        const roDub = await getRomanianDubSource({
          tmdbId: id,
          imdbId,
          title: rawShowTitle || title,
          type: isTv ? "tv" : "movie",
          season: Number.isInteger(seasonNum) ? seasonNum : undefined,
          episode: Number.isInteger(episodeNum) ? episodeNum : undefined,
        });
        if (roDub) {
          alternates.unshift({
            label: "Română (Dublat)",
            stream: roDub.stream,
            subtitles: roDub.subtitles,
          });
        }
      } catch {
        // Non-fatal
      }

      return {
        status: "success",
        resolver: "filmpire",
        media: {
          title,
          stream: {
            url: proxiedUrl,
            type: "hls",
            directUrl: finalStreamUrl,
          },
          subtitles: subtitles.length ? subtitles : undefined,
          series: seriesInfo,
          alternates: alternates.length ? alternates : undefined,
        },
      };
    },
  };
}
