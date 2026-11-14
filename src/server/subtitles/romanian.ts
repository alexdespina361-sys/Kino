import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import type { SubtitleTrack } from "../../shared";
import { isPublicAddress } from "../resolvers/ip";

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

/**
 * How much is taken from a subtitle site, at most. The sites are other people's: an archive, a file or a page that is larger than any real one is not
 * read to its end, and a file that unpacks to more than a subtitle ever is, is left out. (Generous: a season's pack is a few megabytes, one subtitle a
 * few hundred kilobytes.)
 */
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 400;

/**
 * How many titles' subtitles are kept in memory, and how much text they may come to together. Past either, the titles asked about longest ago go (their
 * tracks answer 404 until the title is looked up again; what is under `dataDir` is read again then, not fetched).
 */
export const MAX_KEPT_TITLES = 300;
export const MAX_KEPT_CHARS = 64 * 1024 * 1024;

/**
 * What an answer holds, read up to `max` bytes: nothing when it says it is longer, or turns out to be. (`arrayBuffer()` and `text()` read whatever is
 * sent, to the end.)
 */
async function readCapped(res: Response, max: number): Promise<Buffer | undefined> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A page of a subtitle site as text, or nothing when it is larger than a page is (see `readCapped`). */
async function pageText(res: Response): Promise<string | undefined> {
  return (await readCapped(res, MAX_PAGE_BYTES))?.toString("utf8");
}

/**
 * Whether a subtitle file the subtitle site lists is at the site's own place (`*.strem.io`, over https). Its list is another party's words: a file it
 * says is somewhere else is not fetched, so the list cannot send this server to an address of its choosing.
 */
export function isListedFile(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "strem.io" || url.hostname.endsWith(".strem.io"));
  } catch {
    return false;
  }
}

/**
 * `fetch` for the subtitle sites. A site may answer with a redirect, and `fetch` on its own follows one wherever it leads: here every address on the way,
 * the first included, has to be a public one (by its name's addresses when it is a name), so a site's answer cannot have this server read from itself or
 * from the network it stands in. A cookie is not carried to another origin. (`send` and `isAllowed` are for tests.)
 */
export function siteFetch(send: typeof fetch = (...args) => fetch(...args), isAllowed: (address: string) => boolean = isPublicAddress): typeof fetch {
  const check = async (url: URL): Promise<void> => {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not a web address");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((found) => found.address);
    if (addresses.length === 0 || addresses.some((address) => !isAllowed(address))) throw new Error("address not allowed");
  };
  return async (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input));
    let ask: RequestInit = { ...init, redirect: "manual" };
    for (let hop = 0; hop <= 5; hop++) {
      await check(url);
      const res = await send(url, ask);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res;
      await res.body?.cancel().catch(() => {});
      const next = new URL(location, url);
      const headers = new Headers(ask.headers);
      if (next.origin !== url.origin) headers.delete("cookie");
      // (As a browser does: what was posted is asked for with GET where the redirect is not a 307 or a 308.)
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && ask.method === "POST")) {
        headers.delete("content-type");
        ask = { ...ask, method: "GET", body: undefined };
      }
      ask = { ...ask, headers };
      url = next;
    }
    throw new Error("too many redirects");
  };
}

/**
 * The name a subtitle is asked for by, made the episode's own. A site's pack holds a whole season and its files were numbered from one for every episode,
 * so two episodes had a subtitle of the same name: whichever was looked up last answered for both, and a browser that had kept the first (the files are
 * served to be kept) showed it for the second. (What was kept on disk under the old names is renamed as it is read.)
 */
export function episodeId(id: string, season: number | undefined, episode: number | undefined): string {
  if (!season || !episode) return id;
  const suffix = `_s${season}e${episode}`;
  return id.endsWith(suffix) ? id : `${id}${suffix}`;
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
      // (A header cut short by the end of the archive, or more files than a pack has: what was found so far is the answer.)
      if (pos + 30 > zipBuf.length || files.length >= MAX_ARCHIVE_FILES) break;
      const method = zipBuf.readUInt16LE(pos + 8);
      const cSize = zipBuf.readUInt32LE(pos + 18);
      const fnLen = zipBuf.readUInt16LE(pos + 26);
      const extraLen = zipBuf.readUInt16LE(pos + 28);
      const name = zipBuf.subarray(pos + 30, pos + 30 + fnLen).toString("utf8");
      const dataStart = pos + 30 + fnLen + extraLen;
      const data = zipBuf.subarray(dataStart, dataStart + cSize);
      if (name.toLowerCase().endsWith(".srt")) {
        try {
          // (A file that unpacks to more than a subtitle is: `inflateRawSync` throws past the size, and the file is left out like a broken one.)
          if (method !== 8 && data.length > MAX_FILE_BYTES) throw new Error("too large");
          const raw = method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_FILE_BYTES }) : data;
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
  /** How much text `subtitleById` holds (see `MAX_KEPT_CHARS`). */
  private keptChars = 0;
  /** The titles being asked about now: a second ask for one of them (a screen and the look-up made ahead for it) waits for the first. */
  private pending = new Map<string, Promise<RomanianSubtitle[]>>();
  private dataDir?: string;
  private readonly get: typeof fetch;

  constructor(dataDir?: string, get: typeof fetch = siteFetch()) {
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
    if (cached) this.keep(key, cached); // (asked about again: the last to go)
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
    // (Each subtitle is asked for by a name of the episode's own: see `episodeId`.)
    const season = params.season ? Number(params.season) : undefined;
    const episode = params.episode ? Number(params.episode) : undefined;
    subs = subs.map((sub) => ({ ...sub, id: episodeId(sub.id, season, episode) }));
    this.keep(key, subs);
    return subs;
  }

  /** Keeps a title's subtitles as the newest, and lets the titles asked about longest ago go while there are too many of them or too much text (see `MAX_KEPT_TITLES`). */
  private keep(key: string, subs: RomanianSubtitle[]): void {
    this.forget(key);
    this.cache.set(key, subs);
    for (const sub of subs) {
      if (!this.subtitleById.has(sub.id)) this.keptChars += sub.vtt.length;
      this.subtitleById.set(sub.id, sub.vtt);
    }
    for (const oldest of this.cache.keys()) {
      if (oldest === key || (this.cache.size <= MAX_KEPT_TITLES && this.keptChars <= MAX_KEPT_CHARS)) break;
      this.forget(oldest);
    }
  }

  private forget(key: string): void {
    const subs = this.cache.get(key);
    if (!subs) return;
    this.cache.delete(key);
    for (const sub of subs) {
      // (A title asked about by its number and by its name is two titles here with the same subtitles: they stay while either does.)
      let heldElsewhere = false;
      for (const others of this.cache.values()) if (others.some((other) => other.id === sub.id)) heldElsewhere = true;
      if (heldElsewhere) continue;
      const vtt = this.subtitleById.get(sub.id);
      if (vtt !== undefined && this.subtitleById.delete(sub.id)) this.keptChars -= vtt.length;
    }
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
    const [subsRoSubs, subtNoiSubs, osSubs] = await Promise.all([quietly(this.fetchFromSubsRo(params)), quietly(this.fetchFromSubtitrariNoi(params)), params.imdbId ? quietly(this.fetchFromOpenSubtitles(params)) : Promise.resolve([])]);
    for (const s of subsRoSubs) addSub(s);
    for (const s of subtNoiSubs) addSub(s);
    for (const s of osSubs) addSub(s);

    // 3. Fallback to OpenSubtitles Stremio endpoint if needed
    if (false) {
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
    const pageHtml = (await pageText(pageRes)) ?? "";
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
      signal: AbortSignal.timeout(3_000),
    });
    if (!searchRes.ok) return list;
    const text = (await pageText(searchRes)) ?? "";

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
            signal: AbortSignal.timeout(4_000),
          });
          if (!dlRes.ok) return [];
          const buf = await readCapped(dlRes, MAX_ARCHIVE_BYTES);
          if (!buf) return [];
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
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return list;
    const html = (await pageText(res)) ?? "";

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
            signal: AbortSignal.timeout(4_000),
          });
          if (!dlRes.ok) return [];
          const buf = await readCapped(dlRes, MAX_ARCHIVE_BYTES);
          if (!buf) return [];
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
    // (The list names every language's files: longer than a page, so it is read up to what a file may be.)
    const answer = await readCapped(res, MAX_FILE_BYTES);
    if (answer === undefined) return list;
    const data = JSON.parse(answer.toString("utf8")) as {
      subtitles?: Array<{ id: string; url: string; lang: string; subtitleFileName?: string }>;
    };

    // (Only a file at the subtitle site's own place is fetched: see `isListedFile`.)
    const roSubs = (data.subtitles || []).filter((s) => (s.lang === "ron" || s.lang === "ro" || s.lang === "rum") && typeof s.url === "string" && isListedFile(s.url));

    // (The files are fetched at once, and listed in the order the site gave them.)
    const files = await Promise.all(
      roSubs.slice(0, 3).map(async (item, n): Promise<RomanianSubtitle | undefined> => {
        try {
          const subRes = await this.get(item.url, { signal: AbortSignal.timeout(6_000) });
          if (!subRes.ok) return undefined;
          const buf = await readCapped(subRes, MAX_FILE_BYTES);
          if (!buf) return undefined;
          const text = decodeSubtitleBytes(buf);
          const release = item.subtitleFileName?.replace(/\.(srt|vtt)$/i, "") || "OpenSubtitles";
          // (The site's own name for the file goes into an address: letters, digits, `_` and `-` of it only.)
          const name = String(item.id ?? "").replace(/[^\w-]/g, "").slice(0, 40);
          return { id: `os_${name || n + 1}`, label: `Romanian · ${release}`, vtt: srtToVtt(text), source: "opensubtitles", release };
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
    // (`DATA_DIR=memory` means nowhere, as it does for the accounts: not a folder of that name.)
    const home = dataDir ?? process.env.DATA_DIR;
    defaultManager = new RomanianSubtitleManager(home === "memory" ? undefined : home);
  }
  return defaultManager;
}
