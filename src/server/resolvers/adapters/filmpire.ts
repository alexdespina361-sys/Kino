import { isHttpUrl, normalizeLang, type AlternateSource, type EpisodeRef, type SeriesInfo, type SubtitleTrack } from "../../../shared";
import { remember } from "../../boundedMap";
import { FILMPIRE_TMDB_API_KEY } from "../../library/filmpire";
import { providerFetch } from "../providerFetch";
import type { ResolveResult, SiteAdapter } from "../types";
import { signedRelayUrl } from "../../streamRelay/links";
import { streamAddress } from "./streamAddress";
import { decryptInThread } from "./wasmDecrypt";
import nacl from "tweetnacl";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** What is taken of a player's answer: no more streams, subtitles or episodes than a screen can use, however many the answer lists. */
const MAX_STREAMS = 12;
const MAX_SUBTITLES = 40;
const MAX_EPISODES = 400;

async function getJson<T = Record<string, unknown>>(get: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await get(url, {
    headers: { "user-agent": UA, accept: "application/json", ...headers },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

async function getText(get: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await get(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...headers,
    },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return res.text();
}

export async function decryptWasm(get: typeof fetch, encBase64: string, wasmUrl: string, referer: string): Promise<string[]> {
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

export interface BuzzResolvedStream {
  streamUrl: string;
  alternates: Array<{ name: string; url: string; type: "hls" | "mp4" }>;
  embedUrl: string;
}

function isSecurityBlock(err: unknown): boolean {
  if (!err) return false;
  if ((err as { code?: string }).code === "blocked") return true;
  const msg = String(err);
  return msg.includes("not permitted") || msg.includes("loopback") || msg.includes("private network") || msg.includes("Private address");
}

export interface VidLinkResolvedStream {
  streamUrl: string;
  type: "mp4" | "hls";
  qualities: Array<{ label: string; url: string; type: "mp4" | "hls" }>;
  captions: Array<{ label: string; url: string; lang?: string }>;
}

const VIDLINK_KEY = Buffer.from("c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd", "hex");
const ZERO_NONCE = new Uint8Array(24);

export function encryptVidLinkToken(mediaId: string): string {
  const timestamp = BigInt(Math.floor(Date.now() / 1000) + 480);
  const mediaIdBuf = Buffer.from(mediaId, "utf-8");
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(timestamp);
  const message = Buffer.concat([mediaIdBuf, tsBuf]);
  const ciphertext = nacl.secretbox(message, ZERO_NONCE, VIDLINK_KEY);
  const fullPayload = Buffer.concat([Buffer.from(ZERO_NONCE), Buffer.from(ciphertext)]);
  return fullPayload.toString("base64url");
}

export async function resolveVidLinkStream(
  get: typeof fetch,
  tmdbId: string,
  isTv: boolean,
  season?: string | null,
  episode?: string | null,
): Promise<VidLinkResolvedStream | null> {
  try {
    const token = encryptVidLinkToken(tmdbId);
    const s = season || "1";
    const e = episode || "1";
    const url = isTv
      ? `https://vidlink.pro/api/b/tv/${token}/${encodeURIComponent(s)}/${encodeURIComponent(e)}?multiLang=1`
      : `https://vidlink.pro/api/b/movie/${token}?multiLang=1`;

    const res = await get(url, {
      headers: {
        "user-agent": UA,
        origin: "https://vidlink.pro",
        referer: "https://vidlink.pro/",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      stream?: {
        type?: string;
        playlist?: string;
        qualities?: Record<string, { url?: string; type?: string }>;
        captions?: Array<{ url?: string; language?: string; type?: string }>;
      };
    };
    if (!data?.stream) return null;

    const qualities: Array<{ label: string; url: string; type: "mp4" | "hls" }> = [];
    if (data.stream.playlist && isHttpUrl(data.stream.playlist)) {
      qualities.push({ label: "Auto (HLS)", url: data.stream.playlist, type: "hls" });
    }
    if (data.stream.qualities) {
      const qKeys = Object.keys(data.stream.qualities).sort((a, b) => Number(b) - Number(a));
      for (const q of qKeys) {
        const item = data.stream.qualities[q];
        if (item?.url && isHttpUrl(item.url)) {
          qualities.push({
            label: `${q}p`,
            url: item.url,
            type: item.type === "hls" || item.url.includes(".m3u8") ? "hls" : "mp4",
          });
        }
      }
    }
    if (qualities.length === 0) return null;

    const captions: Array<{ label: string; url: string; lang?: string }> = [];
    for (const cap of data.stream.captions || []) {
      if (cap.url && isHttpUrl(cap.url)) {
        captions.push({
          label: cap.language || "Subtitle",
          url: cap.url,
          lang: cap.language,
        });
      }
    }

    return {
      streamUrl: qualities[0]!.url,
      type: qualities[0]!.type,
      qualities,
      captions,
    };
  } catch {
    return null;
  }
}

export async function resolveBuzzStream(
  get: typeof fetch,
  tmdbId: string,
  isTv: boolean,
  season?: string | null,
  episode?: string | null,
): Promise<BuzzResolvedStream | null> {
  const s = season || "1";
  const e = episode || "1";
  const embedUrl = isTv
    ? `https://vidsrc.buzz/embed/tv/${tmdbId}/${s}/${e}`
    : `https://vidsrc.buzz/embed/movie/${tmdbId}`;

  try {
    const res = await get(embedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        referer: "https://www.2embed.cc/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const qMatch = html.match(/var\s+Q\s*=\s*(\{[\s\S]*?\});/);
    if (!qMatch?.[1]) return null;
    const q = JSON.parse(qMatch[1]) as {
      t: string;
      ssr?: { servers?: Array<{ ref: string; name?: string }> };
    };
    const servers = q.ssr?.servers || [];
    if (servers.length === 0) return null;

    const playStreams: Array<{ name: string; url: string; type: "hls" | "mp4" }> = [];
    for (const srv of servers.slice(0, 3)) {
      try {
        const playUrl = `https://vidsrc.buzz/pl/api.php?a=play&ref=${encodeURIComponent(srv.ref)}&t=${encodeURIComponent(q.t)}`;
        const pRes = await get(playUrl, {
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            referer: embedUrl,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!pRes.ok) continue;
        const pData = (await pRes.json()) as { url?: string; type?: string };
        if (pData?.url) {
          const fullStream = new URL(pData.url, "https://vidsrc.buzz/").href;
          playStreams.push({
            name: srv.name || "Server",
            url: fullStream,
            type: pData.type === "mp4" ? "mp4" : "hls",
          });
        }
      } catch {
        // ignore individual server fail
      }
    }

    if (playStreams.length === 0) return null;
    return {
      streamUrl: playStreams[0]!.url,
      alternates: playStreams.slice(1),
      embedUrl,
    };
  } catch {
    return null;
  }
}

export interface FilmpireAdapterOptions {
  /** How the sites are asked. Default: `providerFetch()`, which goes to public addresses only and reads no more than a bounded answer. */
  fetch?: typeof fetch;
  /** What is looked for beside the stream (see `ExtrasLookup`). Default: the subtitle sites and the Romanian dub catalogue. */
  extras?: ExtrasLookup;
  /** How long the film waits for the extras once its stream is known (see `EXTRAS_GRACE_MS`). Tests shorten it. */
  extrasGraceMs?: number;
}

/** The title whose extras are wanted: its numbers, its name, and the episode when it is a series. */
export interface ExtrasAsk {
  imdbId?: string;
  tmdbId: string;
  title?: string;
  isTv: boolean;
  season?: number;
  episode?: number;
}

/**
 * What is looked for beside the stream, each on its own: the subtitles the subtitle site lists (through the proxy), the Romanian subtitles the Romanian
 * sites have (fetched and kept by `RomanianSubtitleManager`), and a Romanian dubbed source when the catalogue knows one. They are asked while the stream
 * is being found, not after it, and the film does not wait for them past a moment (see `EXTRAS_GRACE_MS`).
 */
export interface Extras {
  listed: Promise<SubtitleTrack[]>;
  romanian: Promise<SubtitleTrack[]>;
  dub: Promise<AlternateSource | undefined>;
}
export type ExtrasLookup = (ask: ExtrasAsk, get: typeof fetch) => Extras;

/**
 * How long after the stream is known the look-up waits for the extras. A viewer waits for the film, not for a fourth subtitle site; what has come by then
 * goes with the film, and the rest is for the next look (the Romanian sites' answers are kept once they come, so the next episode has them from the start).
 * The subtitle site's list takes a fraction of a second; the Romanian sites, which send whole archives, a few seconds when the title is new to them.
 */
export const EXTRAS_GRACE_MS = 4_000;

/** The subtitles the subtitle site (OpenSubtitles, through strem.io) lists for a title, as tracks through the proxy: no more than twelve in one language. */
export async function listedSubtitles(get: typeof fetch, imdbId: string, season?: number, episode?: number): Promise<SubtitleTrack[]> {
  const endpoint =
    season && episode
      ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
  const subData = await getJson<{ subtitles?: Array<{ id: string; url: string; lang: string; subtitleFileName?: string }> }>(get, endpoint);
  const rawList = subData?.subtitles ?? [];
  // Prioritize Romanian (ro, ron, rum) and English (en, eng) at the top so both are always included
  const sortedSubs = [...rawList].sort((a, b) => {
    const lA = normalizeLang(a.lang);
    const lB = normalizeLang(b.lang);
    const prioA = lA === "ro" ? 0 : lA === "en" ? 1 : 2;
    const prioB = lB === "ro" ? 0 : lB === "en" ? 1 : 2;
    return prioA - prioB;
  });

  const tracks: SubtitleTrack[] = [];
  const seenLangs = new Set<string>();
  for (const item of sortedSubs) {
    if (tracks.length >= MAX_SUBTITLES) break;
    if (!item.url) continue;
    const rawLang = (item.lang || "en").toLowerCase();
    const normalizedLang = ["ro", "ron", "rum"].includes(rawLang) ? "ro" : (["en", "eng"].includes(rawLang) ? "en" : rawLang);
    const count = [...seenLangs].filter((l) => l.startsWith(normalizedLang)).length;
    if (count >= 12) continue;
    seenLangs.add(`${normalizedLang}_${count}`);

    const langName = LANG_NAMES[rawLang] || LANG_NAMES[normalizedLang] || normalizedLang.toUpperCase();
    let label = langName;
    if (item.subtitleFileName) {
      const clean = item.subtitleFileName.replace(/\.(srt|vtt)$/i, "").trim();
      label = count === 0 ? `${langName} · ${clean}` : `${langName} (${count + 1}) · ${clean}`;
    } else if (count > 0) {
      label = `${langName} (${count + 1})`;
    }
    tracks.push({
      id: tracks.length,
      url: `/api/proxy?url=${encodeURIComponent(item.url)}&format=vtt`,
      label: label.slice(0, 100),
      lang: normalizedLang,
    });
  }
  return tracks;
}

/** The extras as the server looks for them: the subtitle site, the Romanian subtitle sites and the Romanian dub catalogue, all three at once. */
export const lookForExtras: ExtrasLookup = (ask, get) => ({
  listed: ask.imdbId ? listedSubtitles(get, ask.imdbId, ask.isTv ? ask.season : undefined, ask.isTv ? ask.episode : undefined) : Promise.resolve([]),
  romanian: (async () => {
    const { getRomanianSubtitleManager } = await import("../../subtitles/romanian");
    return getRomanianSubtitleManager().getSubtitles({ imdbId: ask.imdbId, tmdbId: ask.tmdbId, title: ask.title, season: ask.season, episode: ask.episode });
  })(),
  dub: (async () => {
    const { getRomanianDubSource } = await import("../../dubs/romanian");
    const roDub = await getRomanianDubSource({ tmdbId: ask.tmdbId, imdbId: ask.imdbId, title: ask.title ?? "", type: ask.isTv ? "tv" : "movie", season: ask.season, episode: ask.episode });
    return roDub ? { label: "Română (Dublat)", stream: roDub.stream, subtitles: roDub.subtitles } : undefined;
  })(),
});

/** What of the extras has come within `graceMs`: each that has not (or that failed) is as if it had found nothing. */
async function extrasByThen(extras: Extras, graceMs: number): Promise<[SubtitleTrack[], SubtitleTrack[], AlternateSource | undefined]> {
  let timer: NodeJS.Timeout | undefined;
  const over = new Promise<void>((done) => {
    timer = setTimeout(done, graceMs);
  });
  const byThen = <T>(value: Promise<T>, fallback: T): Promise<T> => Promise.race([value.catch(() => fallback), over.then(() => fallback)]);
  try {
    return await Promise.all([byThen(extras.listed, []), byThen(extras.romanian, []), byThen(extras.dub, undefined)]);
  } finally {
    clearTimeout(timer);
  }
}

export function createFilmpireAdapter(options: FilmpireAdapterOptions = {}): SiteAdapter {
  const get = options.fetch ?? providerFetch();
  const extras = options.extras ?? lookForExtras;
  const extrasGraceMs = options.extrasGraceMs ?? EXTRAS_GRACE_MS;
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

      let s = url.searchParams.get("s") || url.searchParams.get("season");
      let e = url.searchParams.get("e") || url.searchParams.get("episode");
      let isTv = Boolean(
        (s && e) ||
        url.pathname.includes("/tv") ||
        url.pathname.includes("/series") ||
        url.searchParams.get("type") === "series" ||
        url.searchParams.get("type") === "tv"
      );
      let contentType = isTv ? "tv" : "movie";

      // 2. Fetch metadata from TMDB
      let title = "Filmpire Video";
      let tmdbImdbId: string | undefined;
      let rawShowTitle: string | undefined;
      /** Whether TMDB says the title is animated (genre 16); unknown when TMDB did not answer, or said nothing of its genres. */
      let animated: boolean | undefined;
      try {
        const tmdbUrl = (cType: string) =>
          `https://api.themoviedb.org/3/${cType}/${id}?append_to_response=external_ids&api_key=${FILMPIRE_TMDB_API_KEY}`;
        let tmdbData: {
          title?: string;
          name?: string;
          imdb_id?: string;
          external_ids?: { imdb_id?: string };
          genres?: Array<{ id?: number }>;
        };
        try {
          tmdbData = await fetchJson<{
            title?: string;
            name?: string;
            imdb_id?: string;
            external_ids?: { imdb_id?: string };
            genres?: Array<{ id?: number }>;
          }>(tmdbUrl(contentType));
        } catch (initialErr) {
          const is404 = (initialErr as { status?: number })?.status === 404 || String(initialErr).includes("HTTP 404");
          const isExplicitMovie = url.pathname.includes("/movie") || url.searchParams.get("type") === "movie";
          if (!isTv && is404 && !isExplicitMovie) {
            tmdbData = await fetchJson<{
              title?: string;
              name?: string;
              imdb_id?: string;
              external_ids?: { imdb_id?: string };
              genres?: Array<{ id?: number }>;
            }>(tmdbUrl("tv"));
            isTv = true;
            contentType = "tv";
            s = s || "1";
            e = e || "1";
          } else {
            throw initialErr;
          }
        }
        if (tmdbData.title || tmdbData.name) {
          rawShowTitle = tmdbData.title || tmdbData.name;
          title = rawShowTitle || title;
          if (s && e) title += ` · S${s} E${e}`;
        }
        if (tmdbData.imdb_id) tmdbImdbId = tmdbData.imdb_id;
        else if (tmdbData.external_ids?.imdb_id) tmdbImdbId = tmdbData.external_ids.imdb_id;
        if (Array.isArray(tmdbData.genres)) animated = tmdbData.genres.some((genre) => genre?.id === 16);
      } catch {
        // Non-fatal if TMDB is unreachable
      }

      // The extras (see `ExtrasLookup`) are asked for now, while the sites of the stream are asked, when TMDB has said which title this is; otherwise once
      // the stream's answer has said (below). The season and episode are the link's: a series without them is at its first.
      const askExtras = (imdbId: string | undefined): Extras =>
        extras({ imdbId, tmdbId: id, title: rawShowTitle, isTv, ...(isTv ? { season: Number(s || "1"), episode: Number(e || "1") } : {}) }, get);
      let pendingExtras: Extras | undefined = tmdbImdbId ? askExtras(tmdbImdbId) : undefined;

      // (An anime site is asked only for what can be an anime: a show that TMDB says is not animated is not looked for there, at any step.)
      const fallbackAnime = async (): Promise<ResolveResult | null> => {
        if (!rawShowTitle || animated === false) return null;
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
                ...(res.media.series
                  ? {
                      series: {
                        ...res.media.series,
                        season: targetSeason,
                        episode: targetEpisode,
                      },
                    }
                  : {}),
              },
            };
          }
          return null;
        } catch {
          return null;
        }
      };

      const buildBuzzResult = async (buzz: BuzzResolvedStream): Promise<ResolveResult> => {
        const imdbId = tmdbImdbId;
        pendingExtras ??= askExtras(imdbId);
        const [listed, roSubs, dub] = pendingExtras
          ? await extrasByThen(pendingExtras, extrasGraceMs)
          : [[], [], undefined];
        const allSubs = [...roSubs, ...listed];
        allSubs.sort((a, b) => {
          const lA = normalizeLang(a.lang);
          const lB = normalizeLang(b.lang);
          const pA = lA === "ro" ? 0 : lA === "en" ? 1 : 2;
          const pB = lB === "ro" ? 0 : lB === "en" ? 1 : 2;
          return pA - pB;
        });
        const subList = allSubs.length > 0 ? allSubs.slice(0, MAX_SUBTITLES) : undefined;
        if (subList) {
          subList.forEach((sub, idx) => {
            sub.id = idx;
          });
        }

        let sInfo: SeriesInfo | undefined;
        if (isTv) {
          const currS = Number(s || "1");
          const currE = Number(e || "1");
          sInfo = {
            season: currS,
            episode: currE,
            next: {
              season: currS,
              episode: currE + 1,
              url: `https://filmpire.sc/watch/${id}?s=${currS}&e=${currE + 1}`,
            },
          };
        }

        const proxiedUrl = streamAddress(buzz.streamUrl, buzz.embedUrl, process.env, false);
        const alternates: AlternateSource[] = buzz.alternates.map((alt) => ({
          label: alt.name,
          stream: {
            url: streamAddress(alt.url, buzz.embedUrl, process.env, false),
            type: alt.type,
            directUrl: alt.url,
          },
          subtitles: subList,
        }));

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

        if (dub) alternates.unshift(dub);

        return {
          status: "success",
          resolver: "filmpire",
          media: {
            title,
            stream: {
              url: proxiedUrl,
              type: "hls",
              directUrl: buzz.streamUrl,
            },
            ...(subList ? { subtitles: subList } : {}),
            ...(alternates.length > 0 ? { alternates } : {}),
            ...(sInfo ? { series: sInfo } : {}),
            page: url.href,
          },
        };
      };

      const buildVidLinkResult = async (vl: VidLinkResolvedStream): Promise<ResolveResult> => {
        const imdbId = tmdbImdbId;
        pendingExtras ??= askExtras(imdbId);
        const [listed, roSubs, dub] = pendingExtras
          ? await extrasByThen(pendingExtras, extrasGraceMs)
          : [[], [], undefined];

        const vlSubs: SubtitleTrack[] = (vl.captions || []).map((c, i) => {
          const normLang = normalizeLang(c.lang) || "en";
          return {
            id: i,
            url: `/api/proxy?url=${encodeURIComponent(c.url)}&format=vtt`,
            label: c.label || normLang.toUpperCase(),
            lang: normLang,
          };
        });

        const combinedSubs = [...roSubs, ...listed, ...vlSubs];
        const seenSubUrls = new Set<string>();
        const uniqueSubs: SubtitleTrack[] = [];
        for (const sub of combinedSubs) {
          if (!seenSubUrls.has(sub.url)) {
            seenSubUrls.add(sub.url);
            uniqueSubs.push(sub);
          }
        }
        uniqueSubs.sort((a, b) => {
          const lA = normalizeLang(a.lang);
          const lB = normalizeLang(b.lang);
          const pA = lA === "ro" ? 0 : lA === "en" ? 1 : 2;
          const pB = lB === "ro" ? 0 : lB === "en" ? 1 : 2;
          return pA - pB;
        });
        const subList = uniqueSubs.length > 0 ? uniqueSubs.slice(0, MAX_SUBTITLES) : undefined;
        if (subList) {
          subList.forEach((sub, idx) => {
            sub.id = idx;
          });
        }

        let sInfo: SeriesInfo | undefined;
        if (isTv) {
          const currS = Number(s || "1");
          const currE = Number(e || "1");
          sInfo = {
            season: currS,
            episode: currE,
            next: {
              season: currS,
              episode: currE + 1,
              url: `https://filmpire.sc/watch/${id}?s=${currS}&e=${currE + 1}`,
            },
          };
        }

        const primary = vl.qualities[0]!;
        const proxiedUrl = streamAddress(primary.url, "none", process.env, false);
        const alternates: AlternateSource[] = vl.qualities.slice(1).map((q) => ({
          label: q.label,
          stream: {
            url: streamAddress(q.url, "none", process.env, false),
            type: q.type,
            directUrl: q.url,
          },
          subtitles: subList,
        }));

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

        if (dub) alternates.unshift(dub);

        return {
          status: "success",
          resolver: "filmpire",
          media: {
            title,
            stream: {
              url: proxiedUrl,
              type: primary.type,
              directUrl: primary.url,
            },
            ...(subList ? { subtitles: subList } : {}),
            ...(alternates.length > 0 ? { alternates } : {}),
            ...(sInfo ? { series: sInfo } : {}),
            page: url.href,
          },
        };
      };

      const fallbackStreams = async (): Promise<ResolveResult | null> => {
        try {
          const vl = await resolveVidLinkStream(get, id, isTv, s, e);
          if (vl) return await buildVidLinkResult(vl);
        } catch {
          // ignore
        }
        try {
          const buzz = await resolveBuzzStream(get, id, isTv, s, e);
          if (buzz) return await buildBuzzResult(buzz);
        } catch {
          // ignore
        }
        try {
          const alt = await fallbackAnime();
          if (alt) return alt;
        } catch {
          // ignore
        }
        return null;
      };

      // Special-case titles:
      // 1. Other Mommy (1400837): upstream has huge watermark "cinemacity", VidLink has clean release
      // 2. Cartoons & Anime (animated === true): skip slow 15s upstream retries and resolve via fast provider immediately
      if (id === "1400837" || animated === true) {
        const fastResult = await fallbackStreams();
        if (fastResult) return fastResult;
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
        } catch (err) {
          if (isSecurityBlock(err)) {
            return { status: "temporary_failure", reason: "Could not reach streaming server." };
          }
          const fb = await fallbackStreams();
          if (fb) return fb;
          return { status: "temporary_failure", reason: "Could not reach streaming server." };
        }
      }

      if (!containerUrl) {
        const fb = await fallbackStreams();
        if (fb) return fb;
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
            if (isSecurityBlock(err)) throw err;
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
        if (isSecurityBlock(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "temporary_failure", reason: `Could not load video player: ${msg}` };
        }
        const fb = await fallbackStreams();
        if (fb) return fb;
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
          const fb = await fallbackStreams();
          if (fb) return fb;
          return {
            status: config.rateLimited ? "temporary_failure" : "unsupported",
            reason: config.rateLimited
              ? "Upstream video provider is temporarily rate-limiting requests. Please wait a moment and try again."
              : "No video stream is currently available for this title.",
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
        if (isSecurityBlock(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "temporary_failure", reason: `Could not parse video player config: ${msg}` };
        }
        const fb = await fallbackStreams();
        if (fb) return fb;
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "temporary_failure", reason: `Could not parse video player config: ${msg}` };
      }

      // 6. Fetch stream API and decrypt URLs
      let streamUrls: string[] = [];
      let subtitles: SubtitleTrack[] = [];
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
        if (isSecurityBlock(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "temporary_failure", reason: `Could not retrieve video stream: ${msg}` };
        }
        const buzz = await resolveBuzzStream(get, id, isTv, s, e);
        if (buzz) return buildBuzzResult(buzz);
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

      if (streamUrls.length === 0) {
        const fb = await fallbackStreams();
        if (fb) return fb;
        return { status: "unsupported", reason: "No video streams found." };
      }

      // 6.5. The extras: the subtitle site's list, the Romanian sites' subtitles and a dubbed source, as far as they have come a moment after the stream
      // (started earlier when TMDB knew the title; now, with what the stream's answer says of it, otherwise). The Romanian ones first, then the player's own, then the site's list.
      const imdbId = apiImdbId || tmdbImdbId;
      pendingExtras ??= askExtras(imdbId);
      const [listed, romanian, dub] = await extrasByThen(pendingExtras, extrasGraceMs);
      subtitles = [...romanian, ...subtitles, ...listed];
      subtitles.sort((a, b) => {
        const lA = normalizeLang(a.lang);
        const lB = normalizeLang(b.lang);
        const pA = lA === "ro" ? 0 : lA === "en" ? 1 : 2;
        const pB = lB === "ro" ? 0 : lB === "en" ? 1 : 2;
        return pA - pB;
      });

      // Re-index subtitles sequentially so each track ID is unique and contiguous (capped at MAX_SUBTITLES)
      subtitles = subtitles.slice(0, MAX_SUBTITLES);
      subtitles.forEach((sub, idx) => {
        sub.id = idx;
      });

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
      const relayReferer = relayOwnsToken
        ? playerUrl
        : playerConfig?.apiToken
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

      // A Romanian dubbed source, when the catalogue knows one (see `lookForExtras`), is the first alternate.
      if (dub) alternates.unshift(dub);

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
