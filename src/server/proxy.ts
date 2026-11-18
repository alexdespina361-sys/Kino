import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Agent, fetch, type Response } from "undici";
import { isPublicAddress } from "./resolvers/ip";
import { SafeFetchError, assertAllowedUrl, guardedLookup } from "./resolvers/safe-fetch";
import type { Opened, Piece, SegmentCache } from "./segmentCache";

export function srtToVtt(srt: string): string {
  let clean = srt.replace(/^\uFEFF/, "").trim();
  if (clean.startsWith("WEBVTT")) return clean;
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${clean}`;
}

export class PlaylistTooLong extends Error {}

const PLAYLIST_MAX_ADDRESSES = 20_000;
const PLAYLIST_MAX_BYTES = 16 * 1024 * 1024;
const REFERER_MAX_LENGTH = 2048;

export function rewriteM3u8(content: string, playlistUrl: string, referer?: string, rewriteUrl?: (target: URL) => string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let addresses = 0;
  let size = 0;

  const toProxyUrl = (target: string): string => {
    try {
      const url = new URL(target, playlistUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return target;
      if (rewriteUrl) return rewriteUrl(url);
      const abs = url.href;
      let res = `/api/proxy?url=${encodeURIComponent(abs)}`;
      if (referer) res += `&referer=${encodeURIComponent(referer)}`;
      return res;
    } catch {
      return target;
    }
  };

  let counted = 0;
  const grow = (by: number): void => {
    size += by;
    if (size > PLAYLIST_MAX_BYTES) throw new PlaylistTooLong();
  };
  const rewritten = (target: string): string => {
    if (++addresses > PLAYLIST_MAX_ADDRESSES) throw new PlaylistTooLong();
    const address = toProxyUrl(target);
    counted += address.length;
    grow(address.length);
    return address;
  };
  const push = (line: string): void => {
    grow(line.length + 1 - counted);
    counted = 0;
    out.push(line);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      push(line);
      continue;
    }

    if (trimmed.startsWith("#")) {
      if (trimmed.startsWith("#EXT")) {
        const rewrittenTag = line.replace(/URI=["']([^"']+)["']/g, (_match, uri: string) => {
          return `URI="${rewritten(uri)}"`;
        });
        push(rewrittenTag);
      } else {
        push(line);
      }
      continue;
    }

    push(rewritten(trimmed));
  }

  return out.join("\n");
}

export interface ProxyStats {
  bytes: number;
  requests: number;
  refused: number;
}

export interface ProxyOptions {
  rewriteUrl?: (target: URL) => string;
  omitOrigin?: boolean;
  video?: boolean;
  exemptHosts?: readonly string[];
  allowPrivateNetwork?: boolean;
  isAllowedAddress?: (address: string) => boolean;
  segments?: SegmentCache;
  stats?: ProxyStats;
  upstreamMs?: number;
}

export function exemptHostsFrom(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase().replace(/^\*?\.+/, "").replace(/\.+$/, ""))
    .filter((name) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name))
    .slice(0, 20);
}

export function isExemptHost(hostname: string, exempt: readonly string[] | undefined): boolean {
  const host = hostname.toLowerCase();
  return (exempt ?? []).some((name) => host === name || host.endsWith(`.${name}`));
}

const ANYWHERE = () => true;
const REDIRECTS = 5;
const PIECE_DEADLINE_MS = 60_000;
const UPSTREAM_MS = 30_000;

class UpstreamTooSlow extends Error {}
const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;
const CUE_TIMES = /\d{1,2}:\d{2}[.,]\d{1,3}[ \t]*-->/;
const QUIET_ERROR_MAX_BYTES = 512;
const TEXT_MAX_BYTES = 8 * 1024 * 1024;

const isSegmentPath = (pathname: string): boolean => pathname.endsWith(".ts") || pathname.endsWith(".m4s") || pathname.includes("page-");

const FILE_TYPE = "application/octet-stream";
const TEXT_TYPE = "text/plain; charset=utf-8";
const mediaTypeOf = (contentType: string): string | undefined => {
  const essence = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return /^(?:video|audio)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(essence) && !/\+(?:xml|json)$/.test(essence) ? essence : undefined;
};
const inert = (reply: FastifyReply): void => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
};

const pieceType = (contentType: string): string => mediaTypeOf(contentType) ?? "video/mp2t";

const statusFrom = (status: number): number => (status >= 200 && status <= 599 ? status : 502);

const pools = new WeakMap<(address: string) => boolean, Agent>();
function poolFor(isAllowedAddress: (address: string) => boolean): Agent {
  let pool = pools.get(isAllowedAddress);
  if (!pool) {
    pool = new Agent({ connect: { lookup: guardedLookup(isAllowedAddress) } });
    pools.set(isAllowedAddress, pool);
  }
  return pool;
}

export async function openUpstream(
  target: URL,
  headers: Record<string, string>,
  isAllowedAddress: (address: string) => boolean,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let url = target;
  for (let hop = 0; ; hop++) {
    assertAllowedUrl(url, isAllowedAddress);
    const response = await fetch(url.href, { method: "GET", headers, signal, redirect: "manual", dispatcher: poolFor(isAllowedAddress) });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return { response, url };
    await response.body?.cancel();
    if (hop >= REDIRECTS) throw new SafeFetchError("too_many_redirects", "too many redirects");
    url = new URL(location, url);
  }
}

function isRefusal(error: unknown): boolean {
  for (let wrapped = error, depth = 0; wrapped && depth < 5; depth++) {
    if (wrapped instanceof SafeFetchError) return wrapped.code === "blocked" || wrapped.code === "invalid_url";
    wrapped = (wrapped as { cause?: unknown }).cause;
  }
  return false;
}

interface Handover {
  response: Response;
  url: URL;
  control: AbortController;
}

async function* untilDone(body: AsyncIterable<Uint8Array>, done: () => void): AsyncGenerator<Uint8Array> {
  try {
    yield* body;
  } finally {
    done();
  }
}

async function openPiece(
  target: URL,
  headers: Record<string, string>,
  isAllowedAddress: (address: string) => boolean,
  limit: number,
  handOver: (answer: Handover) => void,
): Promise<Opened | null> {
  const control = new AbortController();
  const deadline = setTimeout(() => control.abort(), PIECE_DEADLINE_MS);
  let answer: { response: Response; url: URL };
  try {
    answer = await openUpstream(target, headers, isAllowedAddress, control.signal);
  } catch (error) {
    clearTimeout(deadline);
    throw error;
  }
  const { response } = answer;
  const length = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  const shared =
    response.body !== null && response.headers.has("content-length") && Number.isInteger(length) && length <= limit && (!encoding || encoding === "identity") && response.status !== 206;
  if (!shared || !response.body) {
    clearTimeout(deadline);
    handOver({ ...answer, control });
    return null;
  }
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", length, stream: untilDone(response.body, () => clearTimeout(deadline)) };
}

async function* counted(body: AsyncIterable<Uint8Array>, stats?: ProxyStats): AsyncGenerator<Uint8Array> {
  for await (const chunk of body) {
    if (stats) stats.bytes += chunk.length;
    yield chunk;
  }
}

async function* untilSilent(body: AsyncIterable<Uint8Array>, ms: number, stop: AbortController): AsyncGenerator<Uint8Array> {
  const bytes = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const timer = setTimeout(() => stop.abort(), ms);
      let next: IteratorResult<Uint8Array>;
      try {
        next = await bytes.next();
      } finally {
        clearTimeout(timer);
      }
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await bytes.return?.();
  }
}

async function textUpTo(response: Response, limit: number, ms: number, stop: AbortController): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, ms);
  try {
    for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > limit) return null;
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    throw late ? new UpstreamTooSlow() : error;
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendPiece(reply: FastifyReply, piece: Piece, stats?: ProxyStats): FastifyReply {
  if (piece.status >= 200 && piece.status < 300) reply.header("Cache-Control", "public, max-age=86400, immutable");
  reply.code(statusFrom(piece.status)).header("Content-Type", pieceType(piece.contentType)).header("Content-Length", String(piece.length));
  return reply.send(Readable.from(counted(piece.read(), stats), { objectMode: false }));
}

export async function handleStreamProxy(
  request: FastifyRequest<{ Querystring: { url?: string; referer?: string; format?: string } }>,
  reply: FastifyReply,
  options: ProxyOptions = {},
): Promise<FastifyReply> {
  try {
    return await proxyRequest(request, reply, options);
  } catch (error) {
    if (!(error instanceof UpstreamTooSlow)) throw error;
    return reply.code(504).header("Content-Type", TEXT_TYPE).send("The other end is too slow");
  }
}

async function proxyRequest(
  request: FastifyRequest<{ Querystring: { url?: string; referer?: string; format?: string } }>,
  reply: FastifyReply,
  options: ProxyOptions,
): Promise<FastifyReply> {
  inert(reply);
  const upstreamMs = options.upstreamMs ?? UPSTREAM_MS;
  const rawUrl = request.query.url;
  if (typeof rawUrl !== "string" || !rawUrl) {
    return reply.code(400).send({ error: "Missing 'url' query parameter" });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return reply.code(400).send({ error: "Invalid URL" });
  }

  const isAllowedAddress = options.isAllowedAddress ?? (options.allowPrivateNetwork ? ANYWHERE : isPublicAddress);
  try {
    assertAllowedUrl(targetUrl, isAllowedAddress);
  } catch {
    return reply.code(403).send({ error: "URL not allowed" });
  }
  const referer = request.query.referer || targetUrl.origin;
  if (typeof referer !== "string") return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
  let refererOrigin = "";
  if (referer !== "none") {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
    }
  }
  if (referer.length > REFERER_MAX_LENGTH) return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
  const stats = options.stats;
  if (stats) stats.requests += 1;

  const isUpstreamMedia = isExemptHost(targetUrl.hostname, options.exemptHosts);
  const video = options.video !== false;
  const turnAway = (): FastifyReply => {
    if (stats) stats.refused += 1;
    request.log.info({ host: targetUrl.hostname.slice(0, 100) }, "proxy-refused");
    return reply.code(403).send({ error: "VIDEO_NOT_CARRIED" });
  };
  if (!video && !isUpstreamMedia && isSegmentPath(targetUrl.pathname)) return turnAway();

  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    referer,
    accept: "*/*",
  };
  if (!options.omitOrigin && refererOrigin) headers.origin = refererOrigin;
  if (referer === "none" || (referer === targetUrl.origin && targetUrl.hostname.includes("hakunaymatata.com"))) {
    delete headers.referer;
    delete headers.origin;
    if (targetUrl.hostname.includes("hakunaymatata.com")) {
      delete headers["user-agent"];
    }
  }

  if (request.headers.range) {
    headers.range = request.headers.range;
  }

  const handed: { answer?: Handover } = {};
  if (options.segments && !request.headers.range && request.method !== "HEAD" && isSegmentPath(targetUrl.pathname)) {
    const segments = options.segments;
    const piece = await segments.get(targetUrl.href, () =>
      openPiece(targetUrl, headers, isAllowedAddress, segments.maxPiece, (answer) => {
        handed.answer = answer;
      }),
    );
    if (piece) return sendPiece(reply, piece, stats);
  }

  const abortController = handed.answer?.control ?? new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });

  let upstreamResponse: Response;
  let upstreamUrl: URL;
  let silent = false;
  const waiting = setTimeout(() => {
    silent = true;
    abortController.abort();
  }, upstreamMs);
  try {
    ({ response: upstreamResponse, url: upstreamUrl } = handed.answer ?? (await openUpstream(targetUrl, headers, isAllowedAddress, abortController.signal)));
  } catch (err: unknown) {
    if (silent) throw new UpstreamTooSlow();
    if (isRefusal(err)) return reply.code(403).send({ error: "URL not allowed" });
    const message = err instanceof Error ? err.message : "Upstream error";
    return reply.code(502).send({ error: "Upstream fetch failed", message });
  } finally {
    clearTimeout(waiting);
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  const isM3u8 =
    contentType.toLowerCase().includes("mpegurl") ||
    targetUrl.pathname.endsWith(".m3u8");

  const isSubtitle =
    request.query.format === "vtt" ||
    targetUrl.pathname.endsWith(".srt") ||
    targetUrl.pathname.endsWith(".vtt") ||
    contentType.includes("vtt") ||
    contentType.includes("subrip");

  if (!video && !isUpstreamMedia && (isM3u8 || !isSubtitle)) {
    await upstreamResponse.body?.cancel();
    return turnAway();
  }

  if (!upstreamResponse.ok) {
    reply.code(statusFrom(upstreamResponse.status)).header("Cache-Control", "no-store").header("Content-Type", TEXT_TYPE);
    const text = await textUpTo(upstreamResponse, video ? 64 * 1024 : QUIET_ERROR_MAX_BYTES, upstreamMs, abortController);
    const message = text ?? `Upstream returned HTTP ${upstreamResponse.status}`;
    if (stats) stats.bytes += Buffer.byteLength(message);
    return reply.send(message);
  }

  if (isM3u8) {
    const text = await textUpTo(upstreamResponse, TEXT_MAX_BYTES, upstreamMs, abortController);
    if (text === null) return reply.code(502).header("Content-Type", TEXT_TYPE).send("The playlist is too long");
    if (text.includes("#EXTM3U")) {
      let rewritten: string;
      try {
        rewritten = rewriteM3u8(text, upstreamUrl.href, referer, options.rewriteUrl);
      } catch (error) {
        if (error instanceof PlaylistTooLong) return reply.code(502).header("Content-Type", TEXT_TYPE).send("The playlist is too long");
        throw error;
      }
      reply.header("Cache-Control", "no-store");
      if (stats) stats.bytes += Buffer.byteLength(rewritten);
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      return reply.code(statusFrom(upstreamResponse.status)).send(rewritten);
    }
    if (stats) stats.bytes += Buffer.byteLength(text);
    reply.header("Content-Type", TEXT_TYPE);
    return reply.code(statusFrom(upstreamResponse.status)).send(text);
  }

  if (isSubtitle) {
    const rawText = await textUpTo(upstreamResponse, video ? TEXT_MAX_BYTES : SUBTITLE_MAX_BYTES, upstreamMs, abortController);
    if (rawText === null) return video ? reply.code(502).header("Content-Type", TEXT_TYPE).send("The subtitle is too long") : turnAway();
    const vtt = srtToVtt(rawText);
    if (!video && !isUpstreamMedia && !CUE_TIMES.test(vtt)) return turnAway();
    if (stats) stats.bytes += Buffer.byteLength(vtt);
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.code(200).send(vtt);
  }

  const isSegment = isSegmentPath(targetUrl.pathname) || contentType.includes("video/mp2t") || contentType.includes("video/iso.segment");

  if (isSegment && upstreamResponse.ok) {
    reply.header("Cache-Control", "public, max-age=86400, immutable");
  }

  const finalContentType = isSegment ? pieceType(contentType) : (mediaTypeOf(contentType) ?? FILE_TYPE);

  reply.code(statusFrom(upstreamResponse.status)).header("Content-Type", finalContentType);
  const packed = (upstreamResponse.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity";
  for (const h of packed ? ["accept-ranges"] : ["content-length", "content-range", "accept-ranges"]) {
    const val = upstreamResponse.headers.get(h);
    if (val) reply.header(h, val);
  }

  if (request.method === "HEAD") {
    abortController.abort();
    return reply.send();
  }

  if (upstreamResponse.body) {
    return reply.send(Readable.from(counted(untilSilent(Readable.fromWeb(upstreamResponse.body as any), upstreamMs, abortController), stats), { objectMode: false }));
  }

  return reply.send();
}
