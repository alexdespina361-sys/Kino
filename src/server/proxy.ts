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

/** A playlist that comes out larger than any real one: a long film is some thousands of addresses (see `rewriteM3u8`). */
export class PlaylistTooLong extends Error {}

/** The most addresses a playlist is rewritten for, and the most it may come to (a line of a few bytes comes out as the address, and the referer, each time). */
const PLAYLIST_MAX_ADDRESSES = 20_000;
const PLAYLIST_MAX_BYTES = 16 * 1024 * 1024;
/** The page said to have asked, as long as an address of a page may be (it is written into every address of a playlist). */
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

  // (Counted outside `toProxyUrl`, which answers any failure with the address as it was; and as each address comes out, since one line can hold thousands.)
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
      // Tags that reference external resources via URI="..."
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

    // Media segment or sub-playlist URL
    push(rewritten(trimmed));
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
  /** A dedicated relay supplies signed links back to itself for every playlist resource. */
  rewriteUrl?: (target: URL) => string;
  /** Server-to-server relays send the provider's Referer without forwarding a browser Origin. */
  omitOrigin?: boolean;
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
  /**
   * How long the other end may take before it is given up on: to begin its answer, to send a playlist or a subtitle whole, and to send the next bytes of a film
   * (the time a screen takes to read what has come is not counted: only the wait for the other end). Without it 30 seconds; a test shortens it.
   */
  upstreamMs?: number;
}

const ANYWHERE = () => true;
const REDIRECTS = 5;
/** A piece that has not arrived whole by then is given up on (it is shared, so it is not tied to the screen that asked first). */
const PIECE_DEADLINE_MS = 60_000;
/** What `ProxyOptions.upstreamMs` is without it. */
const UPSTREAM_MS = 30_000;

/** The other end did not begin its answer, or did not send a text whole, in time (answered with 504 by `handleStreamProxy`). */
class UpstreamTooSlow extends Error {}
/** A server that carries no film still passes a subtitle on, which is some tens of kilobytes: a text beyond this is not one. */
const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;
/** The longest text (a playlist, a subtitle) a server that does carry film reads: a playlist of a long film is some hundreds of kilobytes. */
const TEXT_MAX_BYTES = 8 * 1024 * 1024;

/** Whether the address says it is a piece of a film (the other way to tell is by the type the other end gives, which is known only after asking). */
const isSegmentPath = (pathname: string): boolean => pathname.endsWith(".ts") || pathname.endsWith(".m4s") || pathname.includes("page-");

/**
 * What comes through here comes from anybody's server and goes out under this site's own address, so the browser is never told it is a page: only video
 * and audio keep the type they came with, whatever else is just a file; and no answer may be taken for a page by guessing (`nosniff`), nor run as one if it
 * ever ends up as one (`sandbox`, with no script allowed). Nothing that asks for these answers (a player, a subtitle track) looks at either.
 * Nor is any other site's page given leave to read them (no CORS headers): this site's own pages ask from this site, and a relay that is meant to be asked from
 * anywhere says so itself (`streamRelay/app.ts`).
 */
const FILE_TYPE = "application/octet-stream";
const TEXT_TYPE = "text/plain; charset=utf-8";
/**
 * The video or audio type ("video/mp4") of a header, lower-cased and without its parameters; undefined for anything else. Only this is passed on, never the
 * header as it came: a browser reads a header like `video/mp4;, text/html` as a list and keeps the last type. A type that says XML or JSON is no video either.
 */
const mediaTypeOf = (contentType: string): string | undefined => {
  const essence = contentType.split(";", 1)[0]!.trim().toLowerCase();
  return /^(?:video|audio)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(essence) && !/\+(?:xml|json)$/.test(essence) ? essence : undefined;
};
const inert = (reply: FastifyReply): void => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
};

/** Some sites send a piece of a film as a page or as plain bytes; a player wants to be told it is video. Whatever is not video or audio is told so. */
const pieceType = (contentType: string): string => mediaTypeOf(contentType) ?? "video/mp2t";

/** The status to answer with for one the other end gave: a number Fastify refuses (above 599) would end in an error of ours with the other end's connection left open. */
const statusFrom = (status: number): number => (status >= 200 && status <= 599 ? status : 502);

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

/**
 * The bytes of a body as they come. The request to the other end is ended (by `stop`) when it sends none for `ms`: the wait for the next bytes is timed,
 * not the time that whoever reads them takes, as a screen that has paused does not read for as long as it likes.
 */
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

/**
 * The text of an answer, or null when it is longer than `limit` bytes (what has come by then is dropped; leaving the loop ends the request to the other end).
 * All of it has to come within `ms`, however it comes (a few bytes at a time keep a connection from being silent, and from ever ending): else `UpstreamTooSlow`.
 */
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

/** A shared piece, to whoever asked: from its first byte, as far as it has come. */
function sendPiece(reply: FastifyReply, piece: Piece, stats?: ProxyStats): FastifyReply {
  // (Only a piece that came is for keeping: an answer that said no, or that the site gave up on, is asked for again next time.)
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
    // (Nothing has been sent yet when the other end is too slow to answer or to send a text whole: the screen is told so.)
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
  // (A name given twice reaches a handler as a list.)
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
  // (What is said to be the page that asked, for the places that only answer to their own: a text that is not an address is turned away, not left to fail further on, and neither is a name given twice.)
  const referer = request.query.referer || targetUrl.origin;
  if (typeof referer !== "string") return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
  let refererOrigin: string;
  try {
    refererOrigin = new URL(referer).origin;
  } catch {
    return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
  }
  if (referer.length > REFERER_MAX_LENGTH) return reply.code(400).send({ error: "Invalid 'referer' query parameter" });
  const stats = options.stats;
  if (stats) stats.requests += 1;

  // (A server that carries no film says no before it asks anyone, when the address is plainly a piece of one: see `ProxyOptions.video`.)
  const video = options.video !== false;
  const turnAway = (): FastifyReply => {
    if (stats) stats.refused += 1;
    return reply.code(403).send({ error: "VIDEO_NOT_CARRIED" });
  };
  if (!video && isSegmentPath(targetUrl.pathname)) return turnAway();

  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    referer,
    accept: "*/*",
  };
  if (!options.omitOrigin) headers.origin = refererOrigin;

  if (request.headers.range) {
    headers.range = request.headers.range;
  }

  // Screens watching together ask for the same pieces of a film a few seconds apart: the place they come from is asked once.
  // (A part of a file, asked for with a range, is not a piece to share.)
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
  // (An other end that does not begin to answer is given up on, and the connection to it let go.)
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

  // (A server that carries no film passes a subtitle on and nothing else: whatever the address, a playlist or a file is not one.)
  if (!video && (isM3u8 || !isSubtitle)) {
    await upstreamResponse.body?.cancel();
    return turnAway();
  }

  if (!upstreamResponse.ok) {
    // (What the other end said is passed on as text, whatever it called it: it is for whoever reads the failure, not a page for a browser.)
    reply.code(statusFrom(upstreamResponse.status)).header("Cache-Control", "no-store").header("Content-Type", TEXT_TYPE);
    const text = await textUpTo(upstreamResponse, 64 * 1024, upstreamMs, abortController);
    const message = text ?? `Upstream returned HTTP ${upstreamResponse.status}`;
    if (stats) stats.bytes += Buffer.byteLength(message);
    return reply.send(message);
  }

  if (isM3u8) {
    // (Counted as it is decoded: a small answer on the wire can be a very large text.)
    const text = await textUpTo(upstreamResponse, TEXT_MAX_BYTES, upstreamMs, abortController);
    if (text === null) return reply.code(502).header("Content-Type", TEXT_TYPE).send("The playlist is too long");
    // Verify it actually looks like an m3u8
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

  // Subtitle conversion to WebVTT
  if (isSubtitle) {
    const rawText = await textUpTo(upstreamResponse, video ? TEXT_MAX_BYTES : SUBTITLE_MAX_BYTES, upstreamMs, abortController);
    if (rawText === null) return video ? reply.code(502).header("Content-Type", TEXT_TYPE).send("The subtitle is too long") : turnAway();
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

  // A segment that is not told to be video or audio (a page, a picture, anything) is video; any other file that is not is just a file.
  const finalContentType = isSegment ? pieceType(contentType) : (mediaTypeOf(contentType) ?? FILE_TYPE);

  reply.code(statusFrom(upstreamResponse.status)).header("Content-Type", finalContentType);
  // (The length and the part are those of what the other end sent, which `fetch` has unpacked if it came packed: they say nothing of what goes out then.)
  const packed = (upstreamResponse.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity";
  for (const h of packed ? ["accept-ranges"] : ["content-length", "content-range", "accept-ranges"]) {
    const val = upstreamResponse.headers.get(h);
    if (val) reply.header(h, val);
  }

  // (Whoever asks for the headers alone is not sent the film: the other end is let go, not read to its end for nothing.)
  if (request.method === "HEAD") {
    abortController.abort();
    return reply.send();
  }

  if (upstreamResponse.body) {
    return reply.send(Readable.from(counted(untilSilent(Readable.fromWeb(upstreamResponse.body as any), upstreamMs, abortController), stats), { objectMode: false }));
  }

  return reply.send();
}
