import zlib from "node:zlib";

export interface ExtractedSubtitle {
  name: string;
  text: string;
  season?: number;
  episode?: number;
}

export const MAX_UNZIP_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_UNZIP_FILES = 500;
export const MAX_UNZIP_TOTAL_BYTES = 48 * 1024 * 1024;

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const win1250Decoder = new TextDecoder("windows-1250", { fatal: false });
const win1252Decoder = new TextDecoder("windows-1252", { fatal: false });

export function decodeSubtitleBuffer(buf: Buffer | Uint8Array): string {
  const nodeBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const utf8 = utf8Decoder.decode(nodeBuf);
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
    }
  }
  return utf8;
}

export function parseSeasonAndEpisode(fileName: string): { season?: number; episode?: number } | null {
  const clean = fileName.trim();

  const m1 = clean.match(/(?:s|season\s*)0*(\d+)[._ -]*(?:e|ep|episode\s*)0*(\d+)/i);
  if (m1 && m1[1] && m1[2]) {
    return { season: Number(m1[1]), episode: Number(m1[2]) };
  }

  const m2 = clean.match(/\b0*(\d+)x0*(\d+)\b/i);
  if (m2 && m2[1] && m2[2]) {
    return { season: Number(m2[1]), episode: Number(m2[2]) };
  }

  const m3 = clean.match(/(?:e|ep|episode\s*)0*(\d+)\b/i);
  if (m3 && m3[1]) {
    const sMatch = clean.match(/(?:s|season\s*)0*(\d+)\b/i);
    return {
      ...(sMatch && sMatch[1] ? { season: Number(sMatch[1]) } : {}),
      episode: Number(m3[1]),
    };
  }

  const m4 = clean.match(/(?:[-_\s])0*(\d{1,3})(?:[-_\s.]|$)/);
  if (m4 && m4[1]) {
    const num = Number(m4[1]);
    if (num > 0 && num < 1000) {
      return { episode: num };
    }
  }

  return null;
}

export function extractSubtitlesFromZip(zipBuf: Buffer): ExtractedSubtitle[] {
  const results: ExtractedSubtitle[] = [];
  let pos = 0;
  let unpacked = 0;

  while (pos < zipBuf.length - 4 && results.length < MAX_UNZIP_FILES) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig === 0x04034b50) {
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
        }
      }
      pos = dataStart + cSize;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      break;
    } else {
      pos++;
    }
  }

  return results;
}

export async function extractSubtitlesFromRar(rarBuf: Buffer): Promise<ExtractedSubtitle[]> {
  try {
    const { createExtractorFromData } = await import("node-unrar-js");
    const arrayBuffer = rarBuf.buffer.slice(
      rarBuf.byteOffset,
      rarBuf.byteOffset + rarBuf.byteLength,
    ) as ArrayBuffer;
    const extractor = await createExtractorFromData({ data: arrayBuffer });
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders].filter(
      (f) =>
        !f.flags.directory &&
        (f.name.toLowerCase().endsWith(".srt") || f.name.toLowerCase().endsWith(".vtt")) &&
        !f.name.toLowerCase().startsWith("__macosx"),
    );
    if (fileHeaders.length === 0) return [];

    const extracted = extractor.extract({ files: fileHeaders.slice(0, MAX_UNZIP_FILES).map((f) => f.name) });
    const results: ExtractedSubtitle[] = [];
    let unpacked = 0;

    for (const f of extracted.files) {
      if (f.extraction && (f.fileHeader.name.toLowerCase().endsWith(".srt") || f.fileHeader.name.toLowerCase().endsWith(".vtt"))) {
        const raw = Buffer.from(f.extraction);
        unpacked += raw.length;
        if (unpacked > MAX_UNZIP_TOTAL_BYTES) break;
        const text = decodeSubtitleBuffer(raw);
        if (text.length > 10) {
          const parsed = parseSeasonAndEpisode(f.fileHeader.name);
          results.push({
            name: f.fileHeader.name,
            text,
            ...(parsed?.season !== undefined ? { season: parsed.season } : {}),
            ...(parsed?.episode !== undefined ? { episode: parsed.episode } : {}),
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function extractSubtitlesFromArchive(buf: Buffer): Promise<ExtractedSubtitle[]> {
  if (buf.length < 4) return [];

  if (buf[0] === 0x31 || buf.subarray(0, 50).includes(Buffer.from("-->"))) {
    const text = decodeSubtitleBuffer(buf);
    if (text.includes("-->")) {
      return [{ name: "subtitle.srt", text }];
    }
  }

  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    return extractSubtitlesFromZip(buf);
  }

  if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) {
    return extractSubtitlesFromRar(buf);
  }

  return [];
}

