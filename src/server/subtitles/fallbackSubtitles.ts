import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLang } from "../../shared/lang";
import type { SubtitleTrack } from "../../shared/media";
import { MAX_ARCHIVE_BYTES, readCapped, siteFetch } from "./romanian";
import { extractSubtitlesFromZip } from "./unzip";

export interface FallbackSubtitleRecord {
  id: string;
  label: string;
  lang: string;
  vtt: string;
  source: "tvsubtitles" | "subdl";
  season?: number;
  episode?: number;
}

export interface FallbackSearchParams {
  title?: string;
  season?: number | string;
  episode?: number | string;
  imdbId?: string;
  tmdbId?: string | number;
}

const MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_KEPT_SEASONS = 60;
export const MAX_KEPT_CHARS = 64 * 1024 * 1024;
export const NOTHING_FOR = 6 * 60 * 60 * 1000;

async function pageText(res: Response): Promise<string> {
  return (await readCapped(res, MAX_PAGE_BYTES))?.toString("utf8") ?? "";
}

function mark(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

export function srtToVtt(srt: string): string {
  let clean = srt.replace(/^\uFEFF/, "").trim();
  if (clean.startsWith("WEBVTT")) return clean;
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${clean}`;
}

export function normalizeSearchTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\b(?:season|s)\s*\d+.*$/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTvSubtitlesLang(raw: string): string {
  const l = raw.toLowerCase().trim();
  if (l === "br") return "pt";
  if (l === "ua") return "uk";
  if (l === "gr") return "el";
  if (l === "cn") return "zh";
  if (l === "jp") return "ja";
  return normalizeLang(l) || l;
}

export class FallbackSubtitleManager {
  private cacheByTitleSeason = new Map<string, FallbackSubtitleRecord[]>();
  private subtitleById = new Map<string, string>();
  private keptChars = 0;
  private nothingSince = new Map<string, number>();
  private pending = new Map<string, Promise<FallbackSubtitleRecord[]>>();
  private dataDir?: string;
  private readonly get: typeof fetch;

  constructor(dataDir?: string, get: typeof fetch = siteFetch()) {
    this.dataDir = dataDir;
    this.get = get;
  }

  getVtt(subId: string): string | undefined {
    return this.subtitleById.get(subId);
  }

  async getSubtitles(params: FallbackSearchParams): Promise<SubtitleTrack[]> {
    const season = Number(params.season);
    const episode = Number(params.episode);
    if (!params.title || !Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 1) return [];
    const key = `${normalizeSearchTitle(params.title)}:s${season}`;
    if (!normalizeSearchTitle(params.title)) return [];
    const nothing = this.nothingSince.get(key);
    if (nothing !== undefined && Date.now() - nothing < NOTHING_FOR) return [];

    let seasonSubs = this.cacheByTitleSeason.get(key);
    if (seasonSubs) this.keep(key, seasonSubs);
    if (!seasonSubs) {
      let underway = this.pending.get(key);
      if (!underway) {
        underway = this.fetchAndCacheSeason(params.title, season, params).finally(() => {
          this.pending.delete(key);
        });
        this.pending.set(key, underway);
      }
      seasonSubs = await underway;
    }

    const episodeMatches = seasonSubs.filter((sub) => {
      if (sub.episode !== undefined) return sub.episode === episode;
      return seasonSubs!.filter((other) => other.lang === sub.lang && other.source === sub.source).length === 1;
    });

    return episodeMatches.map((sub, idx) => ({
      id: 8000 + idx,
      url: `/api/subtitles/fallback/${sub.id}.vtt`,
      label: sub.label.slice(0, 100),
      lang: sub.lang.slice(0, 20),
    }));
  }

  private async fetchAndCacheSeason(
    title: string,
    season: number,
    params: FallbackSearchParams,
  ): Promise<FallbackSubtitleRecord[]> {
    const key = `${normalizeSearchTitle(title)}:s${season}`;

    if (this.dataDir) {
      const diskSubs = await this.loadFromDisk(key);
      if (diskSubs && diskSubs.length > 0) {
        this.cacheRecords(key, diskSubs);
        return diskSubs;
      }
    }

    const records: FallbackSubtitleRecord[] = [];

    try {
      const tvSubs = await this.fetchTVSubtitlesSeason(title, season);
      records.push(...tvSubs);
    } catch {
    }

    if (process.env.SUBDL_API_KEY) {
      try {
        const subdlSubs = await this.fetchSubDLSeason(title, season, params);
        records.push(...subdlSubs);
      } catch {
      }
    }

    if (records.length > 0) {
      this.cacheRecords(key, records);
      if (this.dataDir) {
        void this.saveToDisk(key, records);
      }
    } else {
      this.nothingSince.set(key, Date.now());
      if (this.nothingSince.size > 2000) this.nothingSince.delete(this.nothingSince.keys().next().value!);
    }

    return records;
  }

  private cacheRecords(key: string, records: FallbackSubtitleRecord[]): void {
    this.forget(key);
    for (const r of records) {
      if (!this.subtitleById.has(r.id)) this.keptChars += r.vtt.length;
      this.subtitleById.set(r.id, r.vtt);
    }
    this.keep(key, records);
  }

  private keep(key: string, records: FallbackSubtitleRecord[]): void {
    this.cacheByTitleSeason.delete(key);
    this.cacheByTitleSeason.set(key, records);
    while (this.cacheByTitleSeason.size > 1 && (this.cacheByTitleSeason.size > MAX_KEPT_SEASONS || this.keptChars > MAX_KEPT_CHARS)) {
      const oldest = this.cacheByTitleSeason.keys().next().value!;
      if (oldest === key) break;
      this.forget(oldest);
    }
  }

  private forget(key: string): void {
    const records = this.cacheByTitleSeason.get(key);
    if (!records) return;
    this.cacheByTitleSeason.delete(key);
    for (const r of records) {
      const vtt = this.subtitleById.get(r.id);
      if (vtt === undefined) continue;
      this.keptChars -= vtt.length;
      this.subtitleById.delete(r.id);
    }
  }

  async fetchTVSubtitlesSeason(title: string, season: number): Promise<FallbackSubtitleRecord[]> {
    const records: FallbackSubtitleRecord[] = [];
    const normTitle = normalizeSearchTitle(title);

    const searchRes = await this.get("http://www.tvsubtitles.net/search2.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: `qs=${encodeURIComponent(normTitle)}`,
      signal: AbortSignal.timeout(6000),
    });
    if (!searchRes.ok) return [];
    const searchHtml = await pageText(searchRes);

    const showMatches = [...searchHtml.matchAll(/<a\s+href="\/tvshow-(\d+)\.html">([^<]+)<\/a>/g)];
    if (showMatches.length === 0) return [];

    const bestShow = showMatches.find((m) => {
      const rawCand = m[2] ?? "";
      const strippedCand = rawCand.replace(/\s*\(\d{4}(?:-\d{4})?\)\s*$/g, "").trim();
      return normalizeSearchTitle(strippedCand) === normTitle;
    });
    if (!bestShow) {
      return [];
    }
    const showId = bestShow[1] ?? '';

    const seasonUrl = `http://www.tvsubtitles.net/tvshow-${showId}-${season}.html`;
    const seasonRes = await this.get(seasonUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!seasonRes.ok) return [];
    const seasonHtml = await pageText(seasonRes);

    const packLinks = [...seasonHtml.matchAll(/<a\s+href="subtitle-(\d+)-(\d+)-([a-z]{2})\.html">/g)];
    if (packLinks.length === 0) return [];

    const targetLangs = new Set(["en", "ro"]);
    const priorityPacks = packLinks.filter((p) => targetLangs.has(p[3] ?? ""));
    const otherPacks = packLinks.filter((p) => !targetLangs.has(p[3] ?? ""));
    const packsToFetch = [...priorityPacks, ...otherPacks].slice(0, 6);

    await Promise.allSettled(
      packsToFetch.map(async (p) => {
        const rawLang = p[3] ?? 'en';
        const packPageUrl = `http://www.tvsubtitles.net/subtitle-${p[1]}-${p[2]}-${rawLang}.html`;
        const packRes = await this.get(packPageUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6000),
        });
        if (!packRes.ok) return;
        const packHtml = await pageText(packRes);

        const fnMatch = packHtml.match(/filename:\s*<\/b><\/td><td[^>]*>([^<]+\.zip)<\/td>/i) ||
          packHtml.match(/<b>filename:<\/b><\/td><td[^>]*>([^<]+\.zip)<\/td>/i) ||
          packHtml.match(/filename:[\s\S]*?([a-zA-Z0-9_ -]+\.zip)/i);
        if (!fnMatch || !fnMatch[1]) return;

        const zipFilename = fnMatch[1].trim();
        const zipUrl = `http://www.tvsubtitles.net/files/seasons/${encodeURIComponent(zipFilename)}`;
        const zipRes = await this.get(zipUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(10000),
        });
        if (!zipRes.ok) return;

        const zipBuf = await readCapped(zipRes, MAX_ARCHIVE_BYTES);
        if (!zipBuf) return;
        const extracted = extractSubtitlesFromZip(zipBuf);
        const normLang = normalizeTvSubtitlesLang(rawLang);

        for (const item of extracted) {
          if (item.season !== undefined && item.season !== season) continue;
          const epNum = item.episode;
          const cleanName = item.name.replace(/\.(srt|vtt)$/i, "").trim();
          const subId = `tvs_${showId}_s${season}e${epNum ?? 0}_${normLang}_${cleanName.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}_${mark(item.name)}`;
          records.push({
            id: subId,
            label: `${normLang.toUpperCase()} (TVSubtitles) · ${cleanName}`,
            lang: normLang,
            vtt: srtToVtt(item.text),
            source: "tvsubtitles",
            season,
            ...(epNum !== undefined ? { episode: epNum } : {}),
          });
        }
      }),
    );

    return records;
  }

  async fetchSubDLSeason(
    title: string,
    season: number,
    params: FallbackSearchParams,
  ): Promise<FallbackSubtitleRecord[]> {
    const apiKey = process.env.SUBDL_API_KEY;
    if (!apiKey) return [];

    const records: FallbackSubtitleRecord[] = [];
    const query = new URLSearchParams({
      api_key: apiKey,
      film_name: title,
      type: "tv",
      season_number: String(season),
      subs_per_page: "10",
    });
    if (params.imdbId) query.set("imdb_id", params.imdbId);
    if (params.tmdbId) query.set("tmdb_id", String(params.tmdbId));

    const apiRes = await this.get(`https://api.subdl.com/api/v1/subtitles?${query.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!apiRes.ok) return [];

    const json = JSON.parse((await pageText(apiRes)) || "null") as {
      status?: boolean;
      subtitles?: Array<{
        url?: string;
        lang?: string;
        release_name?: string;
        season?: number;
        episode?: number;
      }>;
    };

    if (!json?.status || !Array.isArray(json.subtitles)) return [];

    const toDownload = json.subtitles.slice(0, 3);
    await Promise.allSettled(
      toDownload.map(async (sub, idx) => {
        if (!sub.url) return;
        const dlUrl = sub.url.startsWith("http") ? sub.url : `https://dl.subdl.com${sub.url}`;
        const dlRes = await this.get(dlUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (!dlRes.ok) return;

        const zipBuf = await readCapped(dlRes, MAX_ARCHIVE_BYTES);
        if (!zipBuf) return;
        const extracted = extractSubtitlesFromZip(zipBuf);
        const normLang = normalizeLang(sub.lang) || "en";

        for (const item of extracted) {
          if (item.season !== undefined && item.season !== season) continue;
          const epNum = item.episode ?? sub.episode;
          const cleanName = (item.name || sub.release_name || `Subtitle ${idx + 1}`).replace(/\.(srt|vtt)$/i, "").trim();
          const subId = `subdl_${mark(dlUrl)}_s${season}e${epNum ?? 0}_${normLang}_${cleanName.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}_${mark(item.name)}`;
          records.push({
            id: subId,
            label: `${normLang.toUpperCase()} (SubDL) · ${cleanName}`,
            lang: normLang,
            vtt: srtToVtt(item.text),
            source: "subdl",
            season,
            ...(epNum !== undefined ? { episode: epNum } : {}),
          });
        }
      }),
    );

    return records;
  }

  private async loadFromDisk(key: string): Promise<FallbackSubtitleRecord[] | undefined> {
    if (!this.dataDir) return undefined;
    try {
      const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = path.join(this.dataDir, "subtitles", "fallback", `${cleanKey}.json`);
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as FallbackSubtitleRecord[];
    } catch {
      return undefined;
    }
  }

  private async saveToDisk(key: string, subs: FallbackSubtitleRecord[]): Promise<void> {
    if (!this.dataDir) return;
    try {
      const dir = path.join(this.dataDir, "subtitles", "fallback");
      await mkdir(dir, { recursive: true });
      const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = path.join(dir, `${cleanKey}.json`);
      await writeFile(filePath, JSON.stringify(subs), "utf8");
    } catch {
    }
  }
}

let defaultFallbackManager: FallbackSubtitleManager | undefined;

export function getFallbackSubtitleManager(dataDir?: string): FallbackSubtitleManager {
  if (!defaultFallbackManager) {
    const home = dataDir ?? process.env.DATA_DIR;
    defaultFallbackManager = new FallbackSubtitleManager(home === "memory" ? undefined : home);
  }
  return defaultFallbackManager;
}
