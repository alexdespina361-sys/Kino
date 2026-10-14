/**
 * Cloudflare Worker: Zero-Server-Bandwidth Edge Video Streaming Relay
 * 
 * Deployment:
 *   npx wrangler deploy scripts/edge-stream-worker.js --name kino-stream-edge --compatibility-date 2026-01-01
 * 
 * Then set in Render environment variables:
 *   EDGE_STREAM_PROXY_URL = https://kino-stream-edge.<your-subdomain>.workers.dev
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", { status: 400 });
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response("Invalid target URL", { status: 400 });
    }

    const referer = url.searchParams.get("referer") || "https://stellarconductornexus.com/";

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
    const response = await fetch(parsedTarget.href, {
      method: request.method,
      headers: upstreamHeaders,
      cf: {
        cacheEverything: true,
        cacheTtl: 7200, // 2 hours edge cache for segments
      },
    });

    const isPlaylist = parsedTarget.pathname.endsWith(".m3u8");

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
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    // 5. Stream video chunks (.ts / .html / .m4s) with full CORS headers
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "*");
    headers.delete("X-Frame-Options");
    headers.set("Cache-Control", "public, max-age=86400");

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("octet-stream") || !contentType) {
      headers.set("Content-Type", "video/mp2t");
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
