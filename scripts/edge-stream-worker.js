/**
 * Cloudflare Worker: Zero-Server-Bandwidth Edge Video Streaming Relay
 *
 * The film goes screen -> this worker -> the film's own place, and never through the Kino server, whose host charges for what it sends.
 * (A screen cannot ask the film's own place itself: most of them turn away a page of another website, and want to see their own player's address.
 * The worker is not a browser, so it sends the address they want to see, and no Origin.)
 *
 * Deployment:
 *   npx wrangler deploy scripts/edge-stream-worker.js --name kino-stream-edge --compatibility-date 2026-01-01
 *
 * Then set, in the host's environment variables (and do NOT set DIRECT_STREAMING: the relay is used first, and that one only makes a screen
 * ask a place that turns it away before it asks the relay):
 *   EDGE_STREAM_PROXY_URL = https://kino-stream-edge.<your-subdomain>.workers.dev
 *   PROXY_VIDEO = off          (so that the server itself never carries a film, whatever else goes wrong: see README)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", { status: 400, headers: CORS });
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response("Invalid target URL", { status: 400, headers: CORS });
    }
    if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
      return new Response("Invalid target URL", { status: 400, headers: CORS });
    }

    // (As the server's own proxy does: without being told, the film's own address is what it is shown.)
    const referer = url.searchParams.get("referer") || `${parsedTarget.origin}/`;

    // 2. Prepare upstream request headers
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    upstreamHeaders.set("Referer", referer);
    upstreamHeaders.set("Accept", "*/*");
    // Explicitly omit client Origin to bypass upstream Cloudflare WAF allowlist block

    const range = request.headers.get("Range");
    if (range) {
      upstreamHeaders.set("Range", range);
    }

    // 3. Fetch from upstream with edge caching
    let response;
    try {
      response = await fetch(parsedTarget.href, {
        method: request.method,
        headers: upstreamHeaders,
        cf: {
          cacheEverything: true,
          cacheTtl: 7200, // 2 hours edge cache for segments
        },
      });
    } catch {
      // (Said with the headers that let the player read it, so that the browser's console shows this and not "blocked by CORS".)
      return new Response("Could not reach the other end", { status: 502, headers: { ...CORS, "Cache-Control": "no-store" } });
    }

    const contentType = response.headers.get("content-type") || "";
    const isPlaylist = parsedTarget.pathname.endsWith(".m3u8") || contentType.toLowerCase().includes("mpegurl");

    // 4. For HLS playlists (.m3u8), rewrite paths so all segments route through this edge relay
    if (isPlaylist && response.ok) {
      const content = await response.text();
      const workerOrigin = url.origin;
      const lines = content.split("\n");
      const rewritten = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#EXT-X-VERSION") || trimmed.startsWith("#EXTM3U")) {
          return line;
        }
        if (trimmed.startsWith("#")) {
          return line.replace(/URI=["']([^"']+)["']/g, (_match, uri) => {
            const abs = new URL(uri, parsedTarget.href).href;
            return `URI="${workerOrigin}/?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
          });
        }
        const abs = new URL(trimmed, parsedTarget.href).href;
        return `${workerOrigin}/?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}`;
      });

      return new Response(rewritten.join("\n"), {
        status: response.status,
        headers: {
          ...CORS,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    // 5. Stream video chunks (.ts / .html / .m4s) with full CORS headers
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
    headers.delete("X-Frame-Options");
    // (Only an answer that said yes is for keeping: a player that asks again after a no has to be told again.)
    headers.set("Cache-Control", response.ok ? "public, max-age=86400" : "no-store");

    if (contentType.includes("text/html") || contentType.includes("octet-stream") || !contentType) {
      headers.set("Content-Type", "video/mp2t");
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
