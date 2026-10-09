import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isPublicAddress } from "./resolvers/ip";
import { assertAllowedUrl } from "./resolvers/safe-fetch";

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

export interface ProxyOptions {
  allowPrivateNetwork?: boolean;
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

  const isAllowedAddress = options.allowPrivateNetwork ? () => true : isPublicAddress;
  try {
    assertAllowedUrl(targetUrl, isAllowedAddress);
  } catch {
    return reply.code(403).send({ error: "URL not allowed" });
  }

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

  const abortController = new AbortController();
  request.raw.socket?.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl.href, {
      method: "GET",
      headers,
      signal: abortController.signal,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upstream error";
    return reply.code(502).send({ error: "Upstream fetch failed", message });
  }

  // Set CORS headers
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "*");

  const contentType = upstreamResponse.headers.get("content-type") || "";
  const isM3u8 =
    contentType.includes("mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    targetUrl.pathname.endsWith(".m3u8");

  if (isM3u8) {
    const text = await upstreamResponse.text();
    // Verify it actually looks like an m3u8
    if (text.includes("#EXTM3U")) {
      const rewritten = rewriteM3u8(text, upstreamResponse.url || targetUrl.href, referer);
      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      return reply.code(upstreamResponse.status).send(rewritten);
    }
    reply.header("Content-Type", contentType || "text/plain");
    return reply.code(upstreamResponse.status).send(text);
  }

  // Subtitle conversion to WebVTT
  const isSubtitle =
    request.query.format === "vtt" ||
    targetUrl.pathname.endsWith(".srt") ||
    targetUrl.pathname.endsWith(".vtt") ||
    contentType.includes("vtt") ||
    contentType.includes("subrip");

  if (isSubtitle) {
    const rawText = await upstreamResponse.text();
    const vtt = srtToVtt(rawText);
    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.code(200).send(vtt);
  }

  // Immutable cache for video chunks to enable smooth browser buffering
  const isSegment =
    targetUrl.pathname.endsWith(".ts") ||
    targetUrl.pathname.endsWith(".m4s") ||
    targetUrl.pathname.includes("page-") ||
    contentType.includes("video/mp2t") ||
    contentType.includes("video/iso.segment");

  if (isSegment) {
    reply.header("Cache-Control", "public, max-age=86400, immutable");
  }

  // If the upstream content-type is text/html or generic, but this is a segment, override to video/mp2t
  let finalContentType = contentType;
  if (isSegment && (contentType.includes("text/html") || !contentType || contentType.includes("application/octet-stream"))) {
    finalContentType = "video/mp2t";
  }

  reply.code(upstreamResponse.status);
  if (finalContentType) {
    reply.header("Content-Type", finalContentType);
  }
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const val = upstreamResponse.headers.get(h);
    if (val) reply.header(h, val);
  }

  if (upstreamResponse.body) {
    return reply.send(Readable.fromWeb(upstreamResponse.body as any));
  }

  return reply.send();
}
