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
    const name = body.toLowerCase();
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name]! : match;
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

/* ------------------------------ scanning ------------------------------ */

// A page comes from whoever runs the site behind the link, and up to 2 MiB of it is read. A pattern such as `<video\b[^>]*>` that is tried at every
// `<video` and runs on to the end of the page when nothing closes the tag costs the whole page for each start, so a page made of nothing but
// `<video ` keeps the one thread busy for minutes. The scans below look at every character a bounded number of times: a tag cannot hold a `<`,
// and once a search for a closing tag has found none, no later search for it can.

const MAX_TAGS = 10_000;

export interface Tag {
  /** Everything between the tag's name and its `>`. */
  attrs: string;
  /** For the tags `wantInner` accepts and that have one: the text up to the next `</name>`. */
  inner?: string;
}

/** The `<name ...>` tags of `html`, in order (the first 10,000 of them: no page needs more, and each one costs a little); a tag that is given its inner text is consumed up to its closing tag. Exported for the tests. */
export function* tags(html: string, name: string, wantInner: (attrs: string) => boolean = () => false): Generator<Tag> {
  const open = new RegExp(`<${name}\\b([^<>]*)>`, "gi");
  const close = new RegExp(`</${name}>`, "gi");
  let closing = true;
  for (let tag = open.exec(html), count = 1; tag && count <= MAX_TAGS; tag = open.exec(html), count++) {
    const attrs = tag[1]!;
    if (!closing || !wantInner(attrs)) {
      yield { attrs };
      continue;
    }
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) {
      closing = false;
      yield { attrs };
      continue;
    }
    const inner = html.slice(open.lastIndex, end.index);
    open.lastIndex = close.lastIndex;
    yield { attrs, inner };
  }
}

/* ------------------------------ strategies ------------------------------ */

function html5Video(html: string, base: URL): Candidate[] {
  const found: Candidate[] = [];
  for (const block of tags(html, "video", () => true)) {
    const openTag = `<video ${block.attrs}>`;
    const openAttrs = attributes(openTag);
    const directSrc = openAttrs.src || openAttrs["data-src"] || openAttrs["data-url"];
    const direct = absolute(directSrc, base);
    const inner = block.inner ?? "";

    const subtitles: SubtitleTrack[] = [];
    for (const track of tags(inner, "track")) {
      const attrs = attributes(`<track${track.attrs}>`);
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
    for (const source of tags(inner, "source")) {
      const attrs = attributes(`<source${source.attrs}>`);
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

const JSON_LD_TYPE = /type\s*=\s*["']?application\/ld\+json/i;

function jsonLd(html: string, base: URL): { candidates: Candidate[]; title?: string } {
  const hits: { url: string; name?: string }[] = [];
  for (const script of tags(html, "script", (attrs) => JSON_LD_TYPE.test(attrs))) {
    if (script.inner === undefined) continue;
    try {
      walkJsonLd(JSON.parse(script.inner), hits);
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
  for (const tag of tags(html, "meta")) {
    const attrs = attributes(`<meta${tag.attrs}>`);
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

/** What a URL found in a page is made of; a run of these ends at white space, a quote, an angle bracket, a backslash or a parenthesis. */
const URL_RUN = /[^\s"'<>\\()]+/g;
const SCHEME = /https?:\/\//gi;
const AFTER_EQUALS = /=\/\//g;
const MEDIA_SUFFIX = /\.(?:m3u8|mp4)/gi;

/** Where a URL that has its start before `from` ends in this run: at the first `.m3u8` / `.mp4` with a character before it (and the query after it, if any). Null when there is none, and then there is none for a later start in the run either. */
function mediaEnd(run: string, from: number): number | null {
  MEDIA_SUFFIX.lastIndex = from + 1;
  const suffix = MEDIA_SUFFIX.exec(run);
  if (!suffix) return null;
  const end = suffix.index + suffix[0].length;
  return run[end] === "?" ? run.length : end;
}

/**
 * The media URLs written out in `text`, with how sure to be of each: `https://cdn.example/a.mp4` (wherever in a run it starts: 0.5), and `//cdn.example/a.mp4`
 * after a quote, white space, the start of the text or an equals sign (0.45). The same as `https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?` and
 * `(?:^|["'\s=])(\/\/ ...same)` find, without trying every start again to the end of a long run. Exported for the tests.
 */
export function mediaUrlsIn(text: string): { raw: string; confidence: number }[] {
  const found: { raw: string; confidence: number }[] = [];
  for (const [run] of text.matchAll(URL_RUN)) {
    SCHEME.lastIndex = 0;
    for (let scheme = SCHEME.exec(run); scheme; scheme = SCHEME.exec(run)) {
      const end = mediaEnd(run, scheme.index + scheme[0].length);
      if (end === null) break;
      found.push({ raw: run.slice(scheme.index, end), confidence: 0.5 });
      SCHEME.lastIndex = end;
    }
  }
  for (const run of text.matchAll(URL_RUN)) {
    const piece = run[0];
    const opens = run.index === 0 || /["'\s]/.test(text[run.index - 1]!);
    AFTER_EQUALS.lastIndex = 0;
    let lead = AFTER_EQUALS.exec(piece);
    let start = opens && piece.startsWith("//") ? 0 : lead ? lead.index + 1 : -1;
    while (start >= 0) {
      const end = mediaEnd(piece, start + 2);
      if (end === null) break;
      found.push({ raw: piece.slice(start, end), confidence: 0.45 });
      AFTER_EQUALS.lastIndex = end;
      lead = AFTER_EQUALS.exec(piece);
      start = lead ? lead.index + 1 : -1;
    }
  }
  return found;
}

/** Last resort: a plain media URL mentioned anywhere (inline JSON, player config, ...). Low confidence. */
function mediaUrlPattern(html: string, base: URL): Candidate[] {
  const unescaped = html.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\\u002f/gi, "/");
  const found: Candidate[] = [];
  for (const { raw, confidence } of mediaUrlsIn(unescaped)) {
    const url = absolute(decodeEntities(raw), base);
    const type = url ? streamTypeOf(url) : null;
    if (url && type) found.push({ url, type, strategy: "url-pattern", confidence });
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

  let titleTag: string | undefined;
  for (const tag of tags(html, "title", () => true)) {
    titleTag = tag.inner;
    break;
  }
  const title = ld.title ?? meta["og:title"] ?? (titleTag ? decodeEntities(titleTag).replace(/\s+/g, " ").trim() : undefined);
  return { title: title ? cleanTitle(title).slice(0, 300) || undefined : undefined, candidates };
}

/** The Internet Archive ends every page title with its own boilerplate; the TV and the phone should show just the name. */
const ARCHIVE_SUFFIX = /:\s*Free Download, Borrow, and Streaming\s*:\s*Internet Archive\s*$/i;
// (Not led by `\s*`: a title that is nothing but white space, which og:title and JSON-LD may be, would cost the square of its length.)
const cleanTitle = (title: string) => (ARCHIVE_SUFFIX.test(title) ? title.replace(ARCHIVE_SUFFIX, "").trimEnd() : title);
