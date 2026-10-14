import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Agent, fetch, type Response } from "undici";
import { isPublicAddress } from "./resolvers/ip";
import { SafeFetchError, assertAllowedUrl, guardedLookup } from "./resolvers/safe-fetch";
import type { Opened, Piece, SegmentCache } from "./segmentCache";

export function srtToVtt(srt: string): string {
  let clean = srt.replace(/^\uFEFF/, "").trim();
  if (clean.startsWith("WEBVTT")) return clean;
  // Convert timestamps 00:00:00,000 -> 00:00:00.000
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${clean}`;
}

export function rewriteM3u8(content: string, playlistUrl: string, referer?: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];

  const toProxyUrl = (target: string): string => {
    try {
      const abs = new URL(target, playlistUrl).href;
      let res = `/api/proxy?url=${encodeURIComponent(abs)}`;
      if (referer) res += `&referer=${encodeURIComponent(referer)}`;
      return res;
    } catch {
      return target;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith("#")) {
      // Tags that reference external resources via URI="..."
      if (trimmed.startsWith("#EXT-X-KEY:") || trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-MEDIA:")) {
        const rewrittenTag = line.replace(/URI=["']([^"']+)["']/g, (_match, uri: string) => {
          return `URI="${toProxyUrl(uri)}"`;
        });
        out.push(rewrittenTag);
      } else {
        out.push(line);
      }
      continue;
    }

    // Media segment or sub-playlist URL
    out.push(toProxyUrl(trimmed));
  }

  return out.join("\n");
}

/**
 * What the proxy has sent on to the screens since the server started, for `/api/health`: the films are most of what a host's bandwidth goes on
 * (an hour of 1080p is about 2 GB), and this says how much of it there was. It counts what goes out (a piece that a few screens ask for is
 * counted for each), not what the proxy fetches.
 */
export interface ProxyStats {
  bytes: number;
  requests: number;
  /** The asks turned away because this server carries no film (see `ProxyOptions.video`). */
  refused: number;
}

export interface ProxyOptions {
  /**
   * False when this server is not to carry film (env `PROXY_VIDEO=off`), for a host that charges for what it sends: a playlist, a piece of a
   * film or a file is turned away (403, whoever asks, and the player's own second try through here included), and only a subtitle goes through.
   * Whatever the film's own address is, it is then the screen that asks for it (directly, or through a relay: see scripts/edge-stream-worker.js).
   */
  video?: boolean;
  allowPrivateNetwork?: boolean;
  /** Which addresses may be gone to (a test narrows it to one that is on this machine); without it, any public one, or any at all with `allowPrivateNetwork`. */
  isAllowedAddress?: (address: string) => boolean;
  /** The pieces of a film that screens watching together ask for: each is fetched once and shared (see `SegmentCache`). Without it every request is its own fetch. */
  segments?: SegmentCache;
  /** Counts what is sent on (see `ProxyStats`). */
  stats?: ProxyStats;
}

const ANYWHERE = () => true;
const REDIRECTS = 5;
/** A piece that has not arrived whole by then is given up on (it is shared, so it is not tied to the screen that asked first). */
const PIECE_DEADLINE_MS = 60_000;
/** A server that carries no film still passes a subtitle on, which is some tens of kilobytes: a text beyond this is not one. */
const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;

/** Whether the address says it is a piece of a film (the other way to tell is by the type the other end gives, which is known only after asking). */
const isSegmentPath = (pathname: string): boolean => pathname.endsWith(".ts") || pathname.endsWith(".m4s") || pathname.includes("page-");

const corsHeaders = (reply: FastifyReply): void => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "*");
};

/** Some sites send a piece of a film as a page or as plain bytes; a player wants to be told it is video. */
const pieceType = (contentType: string): string =>
  !contentType || contentType.includes("text/html") || contentType.includes("application/octet-stream") ? "video/mp2t" : contentType;

/**
 * One pool of connections for each rule about addresses. The pool looks at the address a name leads to when it connects (see `guardedLookup`),
 * which is the only place a name can be told from a private address: `localhost`, or a name that anyone can point at 127.0.0.1 or at a machine
 * on the host's own network, passes a look at the text of the address.
 */
const pools = new WeakMap<(address: string) => boolean, Agent>();
function poolFor(isAllowedAddress: (address: string) => boolean): Agent {
  let pool = pools.get(isAllowedAddress);
  if (!pool) {
    pool = new Agent({ connect: { lookup: guardedLookup(isAllowedAddress) } });
    pools.set(isAllowedAddress, pool);
  }
  return pool;
}

/** The answer to a GET of `target`. Redirects are followed here, not by `fetch`, so that each address on the way is looked at as the first one was. */
async function openUpstream(
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

/** Whether this is the refusal of an address (it may be wrapped: `fetch` reports a refused connection as a failed fetch, with the reason as its cause). */
function isRefusal(error: unknown): boolean {
  for (let wrapped = error, depth = 0; wrapped && depth < 5; depth++) {
    if (wrapped instanceof SafeFetchError) return wrapped.code === "blocked" || wrapped.code === "invalid_url";
    wrapped = (wrapped as { cause?: unknown }).cause;
  }
  return false;
}

/** What the other end answered when it is not one to share: the ordinary way carries on with that answer, instead of asking again. */
interface Handover {
  response: Response;
  url: URL;
  /** Ends the request to the other end. */
  control: AbortController;
}

/** The bytes of a body as they come; `done` is called when they have all come or whoever reads them has let go. */
async function* untilDone(body: AsyncIterable<Uint8Array>, done: () => void): AsyncGenerator<Uint8Array> {
  try {
    yield* body;
  } finally {
    done();
  }
}

/**
 * A piece of a film, opened to be shared: only one that says how long it is (within `limit`), is not compressed (so that the length is the
 * length of what is passed on) and is not part of a file. Any other is handed over with `handOver`, as it is, for the ordinary way to carry on
 * with. The request to the other end belongs to the piece, not to the screen that asked first: it ends when the piece has come or has taken too long.
 */
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

/** The bytes of a body as they go out, counted (see `ProxyStats`). */
async function* counted(body: AsyncIterable<Uint8Array>, stats?: ProxyStats): AsyncGenerator<Uint8Array> {
  for await (const chunk of body) {
    if (stats) stats.bytes += chunk.length;
    yield chunk;
  }
}

/** The text of an answer, or null when it is longer than `limit` bytes (what has come by then is dropped; leaving the loop ends the request to the other end). */
async function textUpTo(response: Response, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A shared piece, to whoever asked: from its first byte, as far as it has come. */
function sendPiece(reply: FastifyReply, piece: Piece, stats?: ProxyStats): FastifyReply {
  corsHeaders(reply);
  // (Only a piece that came is for keeping: an answer that said no, or that the site gave up on, is asked for again next time.)
  if (piece.status >= 200 && piece.status < 300) reply.header("Cache-Control", "public, max-age=86400, immutable");
  reply.code(piece.status).header("Content-Type", pieceType(piece.contentType)).header("Content-Length", String(piece.length));
  return reply.send(Readable.from(counted(piece.read(), stats), { objectMode: false }));
}

export async function handleStreamProxy(
  request: FastifyRequest<{ Querystring: { url?: string; referer?: string; format?: string } }>,
  reply: FastifyReply,
  options: ProxyOptions = {},
): Promise<FastifyReply> {
  const rawUrl = request.query.url;
  if (!rawUrl) {
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
  const stats = options.stats;
  if (stats) stats.requests += 1;

  // (A server that carries no film says no before it asks anyone, when the address is plainly a piece of one: see `ProxyOptions.video`.)
  const video = options.video !== false;
  const turnAway = (): FastifyReply => {
    if (stats) stats.refused += 1;
    corsHeaders(reply);
    return reply.code(403).send({ error: "VIDEO_NOT_CARRIED" });
  };
  if (!video && isSegmentPath(targetUrl.pathname)) return turnAway();

  const referer = request.query.referer || targetUrl.origin;
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    referer,
    origin: new URL(referer).origin,
    accept: "*/*",
  };

  if (request.headers.range) {
    headers.range = request.headers.range;
  }

  // Screens watching together ask for the same pieces of a film a few seconds apart: the place they come from is asked once.
  // (A part of a file, asked for with a range, is not a piece to share.)
  const handed: { answer?: Handover } = {};
  if (options.segments && !request.headers.range && isSegmentPath(targetUrl.pathname)) {
    const segments = options.segments;
    const piece = await segments.get(targetUrl.href, () =>
      openPiece(targetUrl, headers, isAllowedAddress, segments.maxPiece, (answer) => {
        handed.answer = answer;
      }),
    );
    if (piece) return sendPiece(reply, piece, stats);
  }

  // (An answer that was looked at and found not to be one to share is carried on with, not asked for again.)
  const abortController = handed.answer?.control ?? new AbortController();
  // (On the response, not on the socket: a browser keeps one connection for hundreds of pieces, and a listener per piece on it was never taken off.)
  reply.raw.once("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });

  let upstreamResponse: Response;
  let upstreamUrl: URL;
  try {
    ({ response: upstreamResponse, url: upstreamUrl } = handed.answer ?? (await openUpstream(targetUrl, headers, isAllowedAddress, abortController.signal)));
  } catch (err: unknown) {
    if (isRefusal(err)) return reply.code(403).send({ error: "URL not allowed" });
    const message = err instanceof Error ? err.message : "Upstream error";
    return reply.code(502).send({ error: "Upstream fetch failed", message });
  }

  corsHeaders(reply);

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

  // (A server that carries no film passes a subtitle on and nothing else: whatever the address, a playlist or a file is not one.)
  if (!video && (isM3u8 || !isSubtitle)) {
    await upstreamResponse.body?.cancel();
    return turnAway();
  }

  if (isM3u8) {
    const text = await upstreamResponse.text();
    // Verify it actually looks like an m3u8
    if (text.includes("#EXTM3U")) {
      const rewritten = rewriteM3u8(text, upstreamUrl.href, referer);
      if (stats) stats.bytes += Buffer.byteLength(rewritten);
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      return reply.code(upstreamResponse.status).send(rewritten);
    }
    if (stats) stats.bytes += Buffer.byteLength(text);
    reply.header("Content-Type", contentType || "text/plain");
    return reply.code(upstreamResponse.status).send(text);
  }

  // Subtitle conversion to WebVTT
  if (isSubtitle) {
    const rawText = video ? await upstreamResponse.text() : await textUpTo(upstreamResponse, SUBTITLE_MAX_BYTES);
    if (rawText === null) return turnAway();
    const vtt = srtToVtt(rawText);
    if (stats) stats.bytes += Buffer.byteLength(vtt);
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.code(200).send(vtt);
  }

  // Immutable cache for video chunks to enable smooth browser buffering (not for an answer that said no: a player asking again must be told again)
  const isSegment = isSegmentPath(targetUrl.pathname) || contentType.includes("video/mp2t") || contentType.includes("video/iso.segment");

  if (isSegment && upstreamResponse.ok) {
    reply.header("Cache-Control", "public, max-age=86400, immutable");
  }

  // If the upstream content-type is text/html or generic, but this is a segment, override to video/mp2t
  const finalContentType = isSegment ? pieceType(contentType) : contentType;

  reply.code(upstreamResponse.status);
  if (finalContentType) {
    reply.header("Content-Type", finalContentType);
  }
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const val = upstreamResponse.headers.get(h);
    if (val) reply.header(h, val);
  }

  if (upstreamResponse.body) {
    return reply.send(Readable.from(counted(Readable.fromWeb(upstreamResponse.body as any), stats), { objectMode: false }));
  }

  return reply.send();
}
