import type { StreamType, SubtitleTrack } from "../../shared";
import type { Candidate } from "./types";

export interface Extracted {
  title?: string;
  candidates: Candidate[];
}

/* ------------------------------ small helpers ------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=/>"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const inner = tag.replace(/^<\s*[a-z0-9]+/i, "");
  for (const match of inner.matchAll(pattern)) {
    result[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

/** HLS or MP4 from a MIME type, falling back to the URL's file extension. Anything else (webm, dash...) is null. */
export function streamTypeOf(url: string, mime?: string): StreamType | null {
  const m = mime?.toLowerCase() ?? "";
  if (m.includes("mpegurl")) return "hls";
  if (m === "video/mp4" || m === "video/x-m4v") return "mp4";
  if (m && m.startsWith("video/")) return null; // webm/ogg: not in our player contract
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "mp4";
  return null;
}

/** Absolute http(s) URL or null. blob:/data:/javascript: and unparsable values are dropped. */
function absolute(raw: string | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/* ------------------------------ strategies ------------------------------ */

function html5Video(html: string, base: URL): Candidate[] {
  const found: Candidate[] = [];
  for (const block of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>|<video\b([^>]*)\/?>/gi)) {
    const openTag = `<video ${block[1] ?? block[3] ?? ""}>`;
    const openAttrs = attributes(openTag);
    const directSrc = openAttrs.src || openAttrs["data-src"] || openAttrs["data-url"];
    const direct = absolute(directSrc, base);

    const subtitles: SubtitleTrack[] = [];
    for (const track of (block[2] ?? "").matchAll(/<track\b[^>]*>/gi)) {
      const attrs = attributes(track[0]);
      const src = attrs.src || attrs["data-src"] || attrs["data-url"];
      const trackUrl = absolute(src, base);
      if (trackUrl) {
        subtitles.push({
          id: subtitles.length,
          url: trackUrl,
          label: attrs.label || attrs.srclang || `Subtitle ${subtitles.length + 1}`,
          lang: attrs.srclang,
        });
      }
    }
    const subProp = subtitles.length > 0 ? { subtitles } : {};

    if (direct) {
      found.push({
        url: direct,
        type: streamTypeOf(direct) ?? "mp4",
        strategy: "html5-video",
        confidence: 0.99,
        ...subProp,
      });
    }
    for (const source of (block[2] ?? "").matchAll(/<source\b[^>]*>/gi)) {
      const attrs = attributes(source[0]);
      const src = attrs.src || attrs["data-src"] || attrs["data-url"];
      const url = absolute(src, base);
      const type = url ? streamTypeOf(url, attrs.type) : null;
      if (url && type) {
        found.push({
          url,
          type,
          strategy: "html5-video",
          confidence: 0.99,
          ...subProp,
        });
      }
    }
  }
  return found;
}

function walkJsonLd(node: unknown, out: { url: string; name?: string }[]): void {
  if (Array.isArray(node)) return node.forEach((child) => walkJsonLd(child, out));
  if (!node || typeof node !== "object") return;
  const object = node as Record<string, unknown>;
  const types = ([] as unknown[]).concat(object["@type"] ?? []);
  if (types.includes("VideoObject")) {
    const rawUrl = typeof object.contentUrl === "string" ? object.contentUrl : typeof object.embedUrl === "string" ? object.embedUrl : undefined;
    if (rawUrl) {
      out.push({ url: rawUrl, name: typeof object.name === "string" ? object.name : undefined });
    }
  }
  Object.values(object).forEach((child) => walkJsonLd(child, out));
}

function jsonLd(html: string, base: URL): { candidates: Candidate[]; title?: string } {
  const hits: { url: string; name?: string }[] = [];
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkJsonLd(JSON.parse(script[1]!), hits);
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  const candidates: Candidate[] = [];
  for (const hit of hits) {
    const url = absolute(hit.url, base);
    const type = url ? streamTypeOf(url) : null;
    if (url && type) candidates.push({ url, type, strategy: "json-ld", confidence: 0.9 });
  }
  return { candidates, title: hits.find((h) => h.name)?.name };
}

function metaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  return meta;
}

function openGraph(meta: Record<string, string>, base: URL): Candidate[] {
  const found: Candidate[] = [];
  for (const key of ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]) {
    const url = absolute(meta[key], base);
    // og:video often points at an HTML embed page, so only trust it when it is clearly media.
    const type = url ? streamTypeOf(url, meta["og:video:type"]) : null;
    if (url && type) found.push({ url, type, strategy: "open-graph", confidence: 0.86 });
  }
  return found;
}

/** Last resort: a plain media URL mentioned anywhere (inline JSON, player config, ...). Low confidence. */
function mediaUrlPattern(html: string, base: URL): Candidate[] {
  const unescaped = html.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\\u002f/gi, "/");
  const found: Candidate[] = [];
  for (const match of unescaped.matchAll(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi)) {
    const url = absolute(decodeEntities(match[0]), base);
    const type = url ? streamTypeOf(url) : null;
    if (url && type) found.push({ url, type, strategy: "url-pattern", confidence: 0.5 });
  }
  for (const match of unescaped.matchAll(/(?:^|["'\s=])(\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?)/gi)) {
    const url = absolute(decodeEntities(match[1]!), base);
    const type = url ? streamTypeOf(url) : null;
    if (url && type) found.push({ url, type, strategy: "url-pattern", confidence: 0.45 });
  }
  return found;
}

/* ------------------------------ public API ------------------------------ */

export function extractMedia(html: string, pageUrl: URL): Extracted {
  const meta = metaTags(html);
  const ld = jsonLd(html, pageUrl);
  const all = [
    ...html5Video(html, pageUrl),
    ...ld.candidates,
    ...openGraph(meta, pageUrl),
    ...mediaUrlPattern(html, pageUrl),
  ];

  // De-duplicate by URL, keeping the most confident strategy for each.
  const byUrl = new Map<string, Candidate>();
  for (const candidate of all) {
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.confidence > existing.confidence) byUrl.set(candidate.url, candidate);
  }
  const candidates = [...byUrl.values()].sort((a, b) => b.confidence - a.confidence);

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = ld.title ?? meta["og:title"] ?? (titleTag ? decodeEntities(titleTag).replace(/\s+/g, " ").trim() : undefined);
  return { title: title ? cleanTitle(title).slice(0, 300) || undefined : undefined, candidates };
}

/** The Internet Archive ends every page title with its own boilerplate; the TV and the phone should show just the name. */
const ARCHIVE_SUFFIX = /\s*:\s*Free Download, Borrow, and Streaming\s*:\s*Internet Archive\s*$/i;
const cleanTitle = (title: string) => title.replace(ARCHIVE_SUFFIX, "");
