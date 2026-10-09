import type { EpisodeRef, SeriesInfo, SubtitleTrack } from "../../../shared";
import type { ResolveResult, SiteAdapter } from "../types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchJson<T = Record<string, unknown>>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "*/*", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function decryptWasm(encBase64: string, wasmUrl: string, referer: string): Promise<string[]> {
  const wasmRes = await fetch(wasmUrl, {
    headers: { "user-agent": UA, referer },
  });
  if (!wasmRes.ok) throw new Error(`Failed to fetch wasm from ${wasmUrl}`);
  const wasmBuf = await wasmRes.arrayBuffer();
  const mod = await WebAssembly.compile(wasmBuf);
  const inst = await WebAssembly.instantiate(mod, {});
  const ex = inst.exports as {
    alloc: (len: number) => number;
    decrypt: (ptr: number, len: number) => number;
    memory: WebAssembly.Memory;
  };

  const enc = Buffer.from(encBase64, "base64");
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const decrypted = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen));
  return decrypted.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("http"));
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

async function getHostToken(streamOrigin: string, playerUrl: string): Promise<string> {
  const cached = hostTokenCache.get(streamOrigin);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  try {
    const rawToken = await fetchText(`${streamOrigin}/generate.php`, { referer: playerUrl });
    let token = "";
    try {
      const parsed = JSON.parse(rawToken.trim()) as Record<string, string>;
      token = parsed.token || parsed.data || rawToken.trim();
    } catch {
      token = rawToken.trim();
    }
    if (token) {
      const exp = parseJwtExp(token) ?? (now + 2 * 3600 * 1000);
      hostTokenCache.set(streamOrigin, { token, expiresAt: exp });
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

export function createFilmpireAdapter(): SiteAdapter {
  return {
    id: "filmpire",
    domains: ["filmpire.sc", "filmpire.net", "filmpire.to", "filmpire.vip", "vidsrc.me", "screenfetch4.cyou"],
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
      const isTv = Boolean((s && e) || url.pathname.includes("/tv") || url.pathname.includes("/series"));
      const contentType = isTv ? "tv" : "movie";

      // 2. Fetch metadata from TMDB
      let title = "Filmpire Video";
      let tmdbImdbId: string | undefined;
      try {
        const tmdbData = await fetchJson<{ title?: string; name?: string; imdb_id?: string }>(
          `https://api.themoviedb.org/3/${contentType}/${id}?api_key=90b2cae8d7161e8ba0f3836240d7d352`,
        );
        if (tmdbData.title || tmdbData.name) {
          title = tmdbData.title || tmdbData.name || title;
          if (s && e) title += ` · S${s} E${e}`;
        }
        if (tmdbData.imdb_id) tmdbImdbId = tmdbData.imdb_id;
      } catch {
        // Non-fatal if TMDB is unreachable
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
          return { status: "temporary_failure", reason: "Could not reach streaming server." };
        }
      }

      if (!containerUrl) {
        return { status: "unsupported", reason: "Video source currently unavailable." };
      }

      // 4. Fetch container page (stellarconductornexus)
      let playerUrl: string;
      try {
        const landingHtml = await fetchText(containerUrl, { referer: "https://screenfetch4.cyou/" });
        const playerMatch = landingHtml.match(/"playerUrl"\s*:\s*"([^"]+)"/i);
        if (!playerMatch?.[1]) {
          throw new Error("Missing playerUrl");
        }
        playerUrl = new URL(playerMatch[1].replace(/\\u0026/g, "&"), containerUrl).href;
      } catch {
        return { status: "temporary_failure", reason: "Could not load video player." };
      }

      // 5. Fetch player page and extract CONFIG
      let streamApiUrl: string;
      let playerHtml = "";
      let seriesInfo: SeriesInfo | undefined;
      try {
        playerHtml = await fetchText(playerUrl, { referer: containerUrl });
        const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
        if (!configMatch?.[1]) {
          throw new Error("Missing window.CONFIG");
        }
        const config = JSON.parse(configMatch[1]) as {
          api?: string;
          apiToken: string;
          mediaType?: string;
          streamBase?: string;
        };

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
                  `https://api.themoviedb.org/3/tv/${id}/season/${currS}?api_key=90b2cae8d7161e8ba0f3836240d7d352`,
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
                episodes: allEpisodes.length > 0 ? allEpisodes.slice(0, 400) : undefined,
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
      } catch {
        return { status: "temporary_failure", reason: "Could not parse video player config." };
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
          streamUrls = await decryptWasm(raw, apiData.vs.wasm_url, playerUrl);
        } else if (Array.isArray(raw)) {
          streamUrls = raw.filter((u): u is string => typeof u === "string");
        }

        const rawSubs =
          apiData.data?.subtitles ||
          apiData.subtitles ||
          apiData.data?.tracks ||
          apiData.tracks ||
          [];
        for (const sub of rawSubs) {
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
      } catch {
        return { status: "temporary_failure", reason: "Could not retrieve video stream." };
      }

      if (subtitles.length === 0) {
        try {
          const trackMatch = playerHtml.match(/tracks\s*:\s*(\[[^\]]+\])/i);
          if (trackMatch?.[1]) {
            const parsed = JSON.parse(trackMatch[1]) as Array<{ file?: string; url?: string; label?: string; lang?: string; kind?: string }>;
            for (const t of parsed) {
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
              if (!item.url) continue;
              const langCode = (item.lang || "en").toLowerCase();
              const count = [...seenLangs].filter((l) => l.startsWith(langCode)).length;
              if (count >= 2) continue;
              seenLangs.add(`${langCode}_${count}`);

              const langName = LANG_NAMES[langCode] || langCode.toUpperCase();
              const label = count === 0 ? langName : `${langName} (SDH)`;
              subtitles.push({
                id: subtitles.length,
                url: `/api/proxy?url=${encodeURIComponent(item.url)}&format=vtt`,
                label,
                lang: langCode,
              });
            }
          }
        } catch {
          // Non-fatal if stremio is unreachable
        }
      }

      if (streamUrls.length === 0) {
        return { status: "unsupported", reason: "No video streams found." };
      }

      // 7. Request host token with cache & fallback across streams
      let chosenStream = streamUrls[0]!;
      let chosenToken = "";

      for (const sUrl of streamUrls) {
        try {
          const origin = new URL(sUrl).origin;
          const tok = await getHostToken(origin, playerUrl);
          if (tok) {
            chosenStream = sUrl;
            chosenToken = tok;
            break;
          }
        } catch {
          // try next stream
        }
      }

      // If no host gave a token via generate.php, use primary stream
      const delim = chosenStream.includes("?") ? "&" : "?";
      let finalStreamUrl = chosenStream;
      if (chosenToken) {
        finalStreamUrl = `${chosenStream}${delim}token=${encodeURIComponent(chosenToken)}&bypass_localize=true`;
      }

      // 8. Wrap through /api/proxy with referer so the TV player never hits CORS issues
      const proxiedUrl = `/api/proxy?url=${encodeURIComponent(finalStreamUrl)}&referer=${encodeURIComponent(playerUrl)}`;

      return {
        status: "success",
        resolver: "filmpire",
        media: {
          title,
          stream: {
            url: proxiedUrl,
            type: "hls",
          },
          subtitles: subtitles.length ? subtitles : undefined,
          series: seriesInfo,
        },
      };
    },
  };
}
