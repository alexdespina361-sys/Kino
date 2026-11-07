import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import type { SubtitleTrack } from "../../shared";

export interface RomanianSubtitle {
  id: string;
  label: string;
  vtt: string;
  source: "subs.ro" | "subtitrari-noi" | "opensubtitles";
  release?: string;
}

export interface SubtitleSearchParams {
  imdbId?: string;
  tmdbId?: string | number;
  title?: string;
  year?: number | string;
  season?: number | string;
  episode?: number | string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const win1250Decoder = new TextDecoder("windows-1250", { fatal: false });

/**
 * Normalizes Romanian diacritics, converting legacy cedillas (ş, ţ, Ş, Ţ)
 * to standard comma-below characters (ș, ț, Ș, Ț).
 */
export function normalizeRomanianText(text: string): string {
  return text
    .replace(/\u015E/g, "Ș")
    .replace(/\u015F/g, "ș")
    .replace(/\u0162/g, "Ț")
    .replace(/\u0163/g, "ț");
}

/**
 * Decodes raw bytes of a subtitle file, automatically detecting UTF-8 vs Windows-1250 / ISO-8859-2.
 */
export function decodeSubtitleBytes(buf: Buffer | Uint8Array): string {
  const nodeBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const utf8 = utf8Decoder.decode(nodeBuf);
  // If UTF-8 contains replacement characters or unmapped 8-bit characters typical of CP1250:
  if (utf8.includes("\uFFFD") || (/[\x80-\xFF]/.test(utf8) && !/[ăîâșțĂÎÂȘȚşţŞŢ]/.test(utf8))) {
    try {
      const win = win1250Decoder.decode(nodeBuf);
      if (/[ăîâșțĂÎÂȘȚşţŞŢ]/.test(win)) {
        return normalizeRomanianText(win);
      }
    } catch {
      // fallback to utf8
    }
  }
  return normalizeRomanianText(utf8);
}

/**
 * Converts SRT subtitle format to standard WebVTT format.
 */
export function srtToVtt(srt: string): string {
  let clean = srt.replace(/^\uFEFF/, "").trim();
  if (clean.startsWith("WEBVTT")) return clean;
  // Convert timestamps 00:00:00,000 -> 00:00:00.000
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${clean}`;
}

/**
 * Extracts .srt files from a ZIP buffer in memory without external dependencies.
 */
export function extractSrtFromZip(zipBuf: Buffer): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];
  let pos = 0;
  while (pos < zipBuf.length - 4) {
    if (zipBuf.readUInt32LE(pos) === 0x04034b50) {
      const method = zipBuf.readUInt16LE(pos + 8);
      const cSize = zipBuf.readUInt32LE(pos + 18);
      const fnLen = zipBuf.readUInt16LE(pos + 26);
      const extraLen = zipBuf.readUInt16LE(pos + 28);
      const name = zipBuf.subarray(pos + 30, pos + 30 + fnLen).toString("utf8");
      const dataStart = pos + 30 + fnLen + extraLen;
      const data = zipBuf.subarray(dataStart, dataStart + cSize);
      if (name.toLowerCase().endsWith(".srt")) {
        try {
          const raw = method === 8 ? zlib.inflateRawSync(data) : data;
          const text = decodeSubtitleBytes(raw);
          if (text.length > 10) {
            files.push({ name, content: text });
          }
        } catch {
          // ignore corrupted individual zip entry
        }
      }
      pos = dataStart + cSize;
    } else {
      pos++;
    }
  }
  return files;
}

/**
 * Checks if a filename matches the requested season and episode.
 */
export function matchesEpisode(fileName: string, season: number, episode: number): boolean {
  const base = fileName.toLowerCase();
  const sep = "[\\s._-]*";
  const patterns = [
    new RegExp(`\\bs0*${season}e0*${episode}\\b`, "i"),
    new RegExp(`\\b${season}x0*${episode}\\b`, "i"),
    new RegExp(`\\bs(?:eason)?${sep}0*${season}\\b[\\s\\S]*?\\be(?:pisode)?${sep}0*${episode}\\b`, "i"),
    new RegExp(`\\bep(?:isode)?${sep}0*${episode}\\b`, "i"),
  ];
  return patterns.some((p) => p.test(base));
}

export class RomanianSubtitleManager {
  private cache = new Map<string, RomanianSubtitle[]>();
  private subtitleById = new Map<string, string>(); // subId -> vtt
  private dataDir?: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }

  getVtt(subId: string): string | undefined {
    return this.subtitleById.get(subId);
  }

  async getSubtitles(params: SubtitleSearchParams): Promise<SubtitleTrack[]> {
    const s = params.season ? Number(params.season) : undefined;
    const e = params.episode ? Number(params.episode) : undefined;
    const key = `${params.imdbId || params.tmdbId || params.title}:${s || 0}:${e || 0}`;

    let cached = this.cache.get(key);
    if (!cached && this.dataDir) {
      cached = await this.loadFromDisk(key);
      if (cached) {
        this.cache.set(key, cached);
        for (const sub of cached) this.subtitleById.set(sub.id, sub.vtt);
      }
    }

    if (!cached) {
      cached = await this.fetchAll(params);
      this.cache.set(key, cached);
      for (const sub of cached) this.subtitleById.set(sub.id, sub.vtt);
      if (this.dataDir && cached.length > 0) {
        void this.saveToDisk(key, cached);
      }
    }

    return cached.map((sub, idx) => ({
      id: 9000 + idx,
      url: `/api/subtitles/ro/${sub.id}.vtt`,
      label: sub.label,
      lang: "ron",
    }));
  }

  private async fetchAll(params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    const results: RomanianSubtitle[] = [];
    const seenHashes = new Set<string>();

    const addSub = (sub: RomanianSubtitle) => {
      // Basic fingerprint to avoid duplicates
      const hash = `${sub.vtt.length}_${sub.vtt.slice(50, 150)}`;
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        results.push(sub);
      }
    };

    // 1. Try Subs.ro (Top recommendation: Human translations & retail)
    try {
      const subsRoSubs = await this.fetchFromSubsRo(params);
      for (const s of subsRoSubs) addSub(s);
    } catch {
      // Non-fatal
    }

    // 2. Try Subtitrari-Noi (Strong Romanian translation community & retail)
    if (results.length < 5) {
      try {
        const subtNoiSubs = await this.fetchFromSubtitrariNoi(params);
        for (const s of subtNoiSubs) addSub(s);
      } catch {
        // Non-fatal
      }
    }

    // 3. Fallback to OpenSubtitles Stremio endpoint if needed
    if (results.length < 3 && params.imdbId) {
      try {
        const osSubs = await this.fetchFromOpenSubtitles(params);
        for (const s of osSubs) addSub(s);
      } catch {
        // Non-fatal
      }
    }

    return results.slice(0, 10);
  }

  private async fetchFromSubsRo(params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    const list: RomanianSubtitle[] = [];
    const imdbId = params.imdbId ? (params.imdbId.startsWith("tt") ? params.imdbId : `tt${params.imdbId}`) : undefined;
    const season = params.season ? Number(params.season) : undefined;
    const episode = params.episode ? Number(params.episode) : undefined;

    const pageRes = await fetch("https://subs.ro/cautare", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!pageRes.ok) return list;
    const pageHtml = await pageRes.text();
    const antispamMatch = pageHtml.match(/name="antispam"\s+value="([^"]+)"/);
    if (!antispamMatch) return list;
    const cookies = pageRes.headers.get("set-cookie") || "";

    const form = new URLSearchParams();
    form.set("antispam", antispamMatch[1]!);
    form.set("type", "subtitrari");
    if (imdbId) form.set("external_id", imdbId);
    if (params.title) form.set("titlu-film", params.title);
    form.set("limba", "ro");

    const searchRes = await fetch("https://subs.ro/ajax/search", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://subs.ro/cautare",
        Cookie: cookies,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!searchRes.ok) return list;
    const text = await searchRes.text();

    const matches = [...text.matchAll(/href="https:\/\/subs\.ro\/subtitrare\/([^\/]+)\/(\d+)"/g)];
    const chosenMatches = matches.slice(0, 3);

    for (const m of chosenMatches) {
      const slug = m[1]!;
      const id = m[2]!;
      // If series, filter by season in slug if present
      if (season && slug.includes("sezon") && !slug.includes(`sezonul-${season}`) && !slug.includes(`sezon-${season}`)) {
        continue;
      }

      try {
        const dlUrl = `https://subs.ro/subtitrare/descarca/${slug}/${id}`;
        const dlRes = await fetch(dlUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Referer: `https://subs.ro/subtitrare/${slug}/${id}`,
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!dlRes.ok) continue;
        const buf = Buffer.from(await dlRes.arrayBuffer());
        const extracted = extractSrtFromZip(buf);

        for (const item of extracted) {
          if (season && episode && !matchesEpisode(item.name, season, episode)) {
            continue;
          }
          const baseName = item.name.split("/").pop()?.replace(/\.srt$/i, "") || item.name;
          const subId = `subsro_${id}_${list.length + 1}`;
          list.push({
            id: subId,
            label: `Romanian (Subs.ro) · ${baseName}`,
            vtt: srtToVtt(item.content),
            source: "subs.ro",
            release: baseName,
          });
        }
      } catch {
        // continue next match
      }
    }
    return list;
  }

  private async fetchFromSubtitrariNoi(params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    const list: RomanianSubtitle[] = [];
    const query = params.title || (params.imdbId ? params.imdbId.replace(/^tt/, "") : undefined);
    if (!query) return list;

    const season = params.season ? Number(params.season) : undefined;
    const episode = params.episode ? Number(params.episode) : undefined;
    const isTv = Boolean(season && episode);

    const body = new URLSearchParams({
      search_q: "1",
      query_q: query,
      cautare: query,
      tip: isTv ? "1" : "2",
    });

    const res = await fetch("https://www.subtitrari-noi.ro/paginare_filme.php", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.subtitrari-noi.ro/",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return list;
    const html = await res.text();

    const zipMatches = [...html.matchAll(/href="(?:\d+-)?(https:\/\/subtitrari-noi\.ro\/Arhive\/[^"]+\.zip)"/g)];
    const chosenZips = zipMatches.slice(0, 2);

    for (const zm of chosenZips) {
      const zipUrl = zm[1]!;
      try {
        const dlRes = await fetch(zipUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Referer: "https://www.subtitrari-noi.ro/",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!dlRes.ok) continue;
        const buf = Buffer.from(await dlRes.arrayBuffer());
        const extracted = extractSrtFromZip(buf);

        for (const item of extracted) {
          if (season && episode && !matchesEpisode(item.name, season, episode)) {
            continue;
          }
          const baseName = item.name.split("/").pop()?.replace(/\.srt$/i, "") || item.name;
          const subId = `subtnoi_${list.length + 1}_${Math.random().toString(36).slice(2, 6)}`;
          list.push({
            id: subId,
            label: `Romanian (Retail / Subtitrari-Noi) · ${baseName}`,
            vtt: srtToVtt(item.content),
            source: "subtitrari-noi",
            release: baseName,
          });
        }
      } catch {
        // continue
      }
    }
    return list;
  }

  private async fetchFromOpenSubtitles(params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    const list: RomanianSubtitle[] = [];
    const imdbId = params.imdbId ? (params.imdbId.startsWith("tt") ? params.imdbId : `tt${params.imdbId}`) : undefined;
    if (!imdbId) return list;

    const season = params.season ? Number(params.season) : undefined;
    const episode = params.episode ? Number(params.episode) : undefined;

    const endpoint = season && episode
      ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;

    const res = await fetch(endpoint, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return list;
    const data = (await res.json()) as {
      subtitles?: Array<{ id: string; url: string; lang: string; subtitleFileName?: string }>;
    };

    const roSubs = (data.subtitles || []).filter((s) => s.lang === "ron" || s.lang === "ro" || s.lang === "rum");

    for (const item of roSubs.slice(0, 3)) {
      try {
        const subRes = await fetch(item.url, { signal: AbortSignal.timeout(6_000) });
        if (!subRes.ok) continue;
        const buf = Buffer.from(await subRes.arrayBuffer());
        const text = decodeSubtitleBytes(buf);
        const release = item.subtitleFileName?.replace(/\.(srt|vtt)$/i, "") || "OpenSubtitles";
        const subId = `os_${item.id || list.length + 1}`;
        list.push({
          id: subId,
          label: `Romanian · ${release}`,
          vtt: srtToVtt(text),
          source: "opensubtitles",
          release,
        });
      } catch {
        // continue
      }
    }
    return list;
  }

  private async loadFromDisk(key: string): Promise<RomanianSubtitle[] | undefined> {
    if (!this.dataDir) return undefined;
    try {
      const safeKey = Buffer.from(key).toString("hex");
      const filePath = path.join(this.dataDir, "subtitles", "ro", `${safeKey}.json`);
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as RomanianSubtitle[];
    } catch {
      return undefined;
    }
  }

  private async saveToDisk(key: string, subs: RomanianSubtitle[]): Promise<void> {
    if (!this.dataDir) return;
    try {
      const safeKey = Buffer.from(key).toString("hex");
      const dir = path.join(this.dataDir, "subtitles", "ro");
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safeKey}.json`);
      await writeFile(filePath, JSON.stringify(subs), "utf8");
    } catch {
      // non-fatal
    }
  }
}

let defaultManager: RomanianSubtitleManager | undefined;
export function getRomanianSubtitleManager(dataDir?: string): RomanianSubtitleManager {
  if (!defaultManager) {
    defaultManager = new RomanianSubtitleManager(dataDir ?? process.env.DATA_DIR);
  }
  return defaultManager;
}
