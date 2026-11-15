import zlib from "node:zlib";

export interface ExtractedSubtitle {
  name: string;
  text: string;
  season?: number;
  episode?: number;
}

export const MAX_UNZIP_FILE_BYTES = 4 * 1024 * 1024; // 4MB per subtitle max
export const MAX_UNZIP_FILES = 500;
/** All an archive may unpack to (a season pack of 30 episodes in five languages is a few MB): past it, the rest is left out. */
export const MAX_UNZIP_TOTAL_BYTES = 48 * 1024 * 1024;

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const win1250Decoder = new TextDecoder("windows-1250", { fatal: false });
const win1252Decoder = new TextDecoder("windows-1252", { fatal: false });

/**
 * Decodes raw bytes into a string, automatically handling UTF-8, Windows-1250 (Central/Eastern European),
 * and Windows-1252 (Western European).
 */
export function decodeSubtitleBuffer(buf: Buffer | Uint8Array): string {
  const nodeBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const utf8 = utf8Decoder.decode(nodeBuf);
  // If UTF-8 contains replacement chars (\uFFFD), try Windows-1250 or Windows-1252
  if (utf8.includes("\uFFFD")) {
    try {
      const win50 = win1250Decoder.decode(nodeBuf);
      if (/[ăîâșțĂÎÂȘȚşţŞŢąęłńóśźżčšž]/.test(win50)) {
        return win50;
      }
      const win52 = win1252Decoder.decode(nodeBuf);
      if (!win52.includes("\uFFFD")) {
        return win52;
      }
    } catch {
      // fallback
    }
  }
  return utf8;
}

/**
 * Extracts season and episode numbers from a subtitle filename.
 * Handles patterns:
 * - "Sakamoto Days - 1x01 - Pilot.srt" -> { season: 1, episode: 1 }
 * - "Show.Name.S02E05.WEB.srt" -> { season: 2, episode: 5 }
 * - "Season 3 Episode 12.srt" -> { season: 3, episode: 12 }
 * - "Episode 04.srt" -> { episode: 4 }
 * - "Show - 06.srt" -> { episode: 6 }
 */
export function parseSeasonAndEpisode(fileName: string): { season?: number; episode?: number } | null {
  const clean = fileName.trim();

  // Pattern 1: S01E02 or S1E2 or Season 1 Episode 2
  const m1 = clean.match(/(?:s|season\s*)0*(\d+)[._ -]*(?:e|ep|episode\s*)0*(\d+)/i);
  if (m1 && m1[1] && m1[2]) {
    return { season: Number(m1[1]), episode: Number(m1[2]) };
  }

  // Pattern 2: 1x02 or 01x02
  const m2 = clean.match(/\b0*(\d+)x0*(\d+)\b/i);
  if (m2 && m2[1] && m2[2]) {
    return { season: Number(m2[1]), episode: Number(m2[2]) };
  }

  // Pattern 3: Ep 02 or Episode 2 (with optional season prefix)
  const m3 = clean.match(/(?:e|ep|episode\s*)0*(\d+)\b/i);
  if (m3 && m3[1]) {
    const sMatch = clean.match(/(?:s|season\s*)0*(\d+)\b/i);
    return {
      ...(sMatch && sMatch[1] ? { season: Number(sMatch[1]) } : {}),
      episode: Number(m3[1]),
    };
  }

  // Pattern 4: " - 05 - " or " - 05." (common in anime releases like "[Subs] Title - 05 [1080p].srt")
  const m4 = clean.match(/(?:[-_\s])0*(\d{1,3})(?:[-_\s.]|$)/);
  if (m4 && m4[1]) {
    const num = Number(m4[1]);
    if (num > 0 && num < 1000) {
      return { episode: num };
    }
  }

  return null;
}

/**
 * Extracts .srt and .vtt subtitle files from a PKZIP archive Buffer without any external dependencies.
 */
export function extractSubtitlesFromZip(zipBuf: Buffer): ExtractedSubtitle[] {
  const results: ExtractedSubtitle[] = [];
  let pos = 0;
  let unpacked = 0;

  while (pos < zipBuf.length - 4 && results.length < MAX_UNZIP_FILES) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig === 0x04034b50) {
      // Local file header
      if (pos + 30 > zipBuf.length) break;
      const method = zipBuf.readUInt16LE(pos + 8);
      const cSize = zipBuf.readUInt32LE(pos + 18);
      const fnLen = zipBuf.readUInt16LE(pos + 26);
      const extraLen = zipBuf.readUInt16LE(pos + 28);
      const name = zipBuf.subarray(pos + 30, pos + 30 + fnLen).toString("utf8");
      const dataStart = pos + 30 + fnLen + extraLen;
      const data = zipBuf.subarray(dataStart, dataStart + cSize);

      const lowerName = name.toLowerCase();
      if ((lowerName.endsWith(".srt") || lowerName.endsWith(".vtt")) && !lowerName.startsWith("__macosx")) {
        try {
          if (method !== 8 && data.length > MAX_UNZIP_FILE_BYTES) {
            throw new Error("entry exceeds max file bytes");
          }
          const raw = method === 8
            ? zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIP_FILE_BYTES })
            : data;
          unpacked += raw.length;
          if (unpacked > MAX_UNZIP_TOTAL_BYTES) break;
          const text = decodeSubtitleBuffer(raw);
          if (text.length > 10) {
            const parsed = parseSeasonAndEpisode(name);
            results.push({
              name,
              text,
              ...(parsed?.season !== undefined ? { season: parsed.season } : {}),
              ...(parsed?.episode !== undefined ? { episode: parsed.episode } : {}),
            });
          }
        } catch {
          // ignore corrupted or unreadable individual entry
        }
      }
      pos = dataStart + cSize;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      // Central directory or end of central directory reached
      break;
    } else {
      pos++;
    }
  }

  return results;
}
