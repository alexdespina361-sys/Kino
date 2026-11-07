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

/**
 * Romanian subtitles for a title, from the Romanian subtitle sites (Subs.ro, Subtitrari-Noi) and, when those have few, OpenSubtitles. The sites send whole
 * archives, which are unpacked here and kept (in memory, and under `dataDir` when there is one), so a title is asked about once; the tracks point at
 * `/api/subtitles/ro/:id.vtt`, answered from what is kept. The two Romanian sites are asked at once, and the archives each lists are fetched at once: a
 * look-up for a title new to them takes as long as the slowest archive, not the sum of them all.
 */
export class RomanianSubtitleManager {
  private cache = new Map<string, RomanianSubtitle[]>();
  private subtitleById = new Map<string, string>(); // subId -> vtt
  /** The titles being asked about now: a second ask for one of them (a screen and the look-up made ahead for it) waits for the first. */
  private pending = new Map<string, Promise<RomanianSubtitle[]>>();
  private dataDir?: string;
  private readonly get: typeof fetch;

  constructor(dataDir?: string, get: typeof fetch = (...args) => fetch(...args)) {
    this.dataDir = dataDir;
    this.get = get;
  }

  getVtt(subId: string): string | undefined {
    return this.subtitleById.get(subId);
  }

  async getSubtitles(params: SubtitleSearchParams): Promise<SubtitleTrack[]> {
    const s = params.season ? Number(params.season) : undefined;
    const e = params.episode ? Number(params.episode) : undefined;
    const key = `${params.imdbId || params.tmdbId || params.title}:${s || 0}:${e || 0}`;

    let cached = this.cache.get(key);
    if (!cached) {
      let underway = this.pending.get(key);
      if (!underway) {
        underway = this.find(key, params).finally(() => this.pending.delete(key));
        this.pending.set(key, underway);
      }
      cached = await underway;
    }

    return cached.map((sub, idx) => ({
      id: 9000 + idx,
      url: `/api/subtitles/ro/${sub.id}.vtt`,
      label: sub.label,
      lang: "ron",
    }));
  }

  /** What is kept for `key` on disk, else what the sites have, kept from then on. */
  private async find(key: string, params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    let subs = this.dataDir ? await this.loadFromDisk(key) : undefined;
    if (!subs) {
      subs = await this.fetchAll(params);
      if (this.dataDir && subs.length > 0) void this.saveToDisk(key, subs);
    }
    this.cache.set(key, subs);
    for (const sub of subs) this.subtitleById.set(sub.id, sub.vtt);
    return subs;
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
    const quietly = (found: Promise<RomanianSubtitle[]>): Promise<RomanianSubtitle[]> => found.catch(() => []);

    // 1 and 2. Subs.ro (human translations and retail) and Subtitrari-Noi (translation community and retail), asked at once; Subs.ro's come first, and
    // Subtitrari-Noi's only while Subs.ro's are few.
    const [subsRoSubs, subtNoiSubs] = await Promise.all([quietly(this.fetchFromSubsRo(params)), quietly(this.fetchFromSubtitrariNoi(params))]);
    for (const s of subsRoSubs) addSub(s);
    if (results.length < 5) for (const s of subtNoiSubs) addSub(s);

    // 3. Fallback to OpenSubtitles Stremio endpoint if needed
    if (results.length < 3 && params.imdbId) {
      for (const s of await quietly(this.fetchFromOpenSubtitles(params))) addSub(s);
    }

    return results.slice(0, 10);
  }

  private async fetchFromSubsRo(params: SubtitleSearchParams): Promise<RomanianSubtitle[]> {
    const list: RomanianSubtitle[] = [];
    const imdbId = params.imdbId ? (params.imdbId.startsWith("tt") ? params.imdbId : `tt${params.imdbId}`) : undefined;
    const season = params.season ? Number(params.season) : undefined;
    const episode = params.episode ? Number(params.episode) : undefined;

    const pageRes = await this.get("https://subs.ro/cautare", {
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

    const searchRes = await this.get("https://subs.ro/ajax/search", {
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

    // (The archives are fetched at once, and their subtitles listed in the order the site gave them.)
    const archives = await Promise.all(
      chosenMatches.map(async (m): Promise<RomanianSubtitle[]> => {
        const slug = m[1]!;
        const id = m[2]!;
        // If series, filter by season in slug if present
        if (season && slug.includes("sezon") && !slug.includes(`sezonul-${season}`) && !slug.includes(`sezon-${season}`)) return [];
        try {
          const dlUrl = `https://subs.ro/subtitrare/descarca/${slug}/${id}`;
          const dlRes = await this.get(dlUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: `https://subs.ro/subtitrare/${slug}/${id}`,
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!dlRes.ok) return [];
          const buf = Buffer.from(await dlRes.arrayBuffer());
          const found: RomanianSubtitle[] = [];
          for (const item of extractSrtFromZip(buf)) {
            if (season && episode && !matchesEpisode(item.name, season, episode)) continue;
            const baseName = item.name.split("/").pop()?.replace(/\.srt$/i, "") || item.name;
            found.push({
              id: `subsro_${id}_${found.length + 1}`,
              label: `Romanian (Subs.ro) · ${baseName}`,
              vtt: srtToVtt(item.content),
              source: "subs.ro",
              release: baseName,
            });
          }
          return found;
        } catch {
          return [];
        }
      }),
    );
    for (const found of archives) list.push(...found);
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

    const res = await this.get("https://www.subtitrari-noi.ro/paginare_filme.php", {
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

    // (The archives are fetched at once, and their subtitles listed in the order the site gave them.)
    const archives = await Promise.all(
      chosenZips.map(async (zm, n): Promise<RomanianSubtitle[]> => {
        const zipUrl = zm[1]!;
        try {
          const dlRes = await this.get(zipUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              Referer: "https://www.subtitrari-noi.ro/",
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!dlRes.ok) return [];
          const buf = Buffer.from(await dlRes.arrayBuffer());
          const found: RomanianSubtitle[] = [];
          for (const item of extractSrtFromZip(buf)) {
            if (season && episode && !matchesEpisode(item.name, season, episode)) continue;
            const baseName = item.name.split("/").pop()?.replace(/\.srt$/i, "") || item.name;
            found.push({
              id: `subtnoi_${n + 1}_${found.length + 1}_${Math.random().toString(36).slice(2, 6)}`,
              label: `Romanian (Retail / Subtitrari-Noi) · ${baseName}`,
              vtt: srtToVtt(item.content),
              source: "subtitrari-noi",
              release: baseName,
            });
          }
          return found;
        } catch {
          return [];
        }
      }),
    );
    for (const found of archives) list.push(...found);
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

    const res = await this.get(endpoint, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return list;
    const data = (await res.json()) as {
      subtitles?: Array<{ id: string; url: string; lang: string; subtitleFileName?: string }>;
    };

    const roSubs = (data.subtitles || []).filter((s) => s.lang === "ron" || s.lang === "ro" || s.lang === "rum");

    // (The files are fetched at once, and listed in the order the site gave them.)
    const files = await Promise.all(
      roSubs.slice(0, 3).map(async (item, n): Promise<RomanianSubtitle | undefined> => {
        try {
          const subRes = await this.get(item.url, { signal: AbortSignal.timeout(6_000) });
          if (!subRes.ok) return undefined;
          const buf = Buffer.from(await subRes.arrayBuffer());
          const text = decodeSubtitleBytes(buf);
          const release = item.subtitleFileName?.replace(/\.(srt|vtt)$/i, "") || "OpenSubtitles";
          return { id: `os_${item.id || n + 1}`, label: `Romanian · ${release}`, vtt: srtToVtt(text), source: "opensubtitles", release };
        } catch {
          return undefined;
        }
      }),
    );
    for (const file of files) if (file) list.push(file);
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
