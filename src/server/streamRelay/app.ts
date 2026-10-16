import Fastify from "fastify";
import { handleStreamProxy, type ProxyStats } from "../proxy";
import { isPublicAddress } from "../resolvers/ip";
import { assertAllowedUrl } from "../resolvers/safe-fetch";
import { signedRelayUrl, verifyRelayLink } from "./links";
import { HostTokens } from "./tokens";

export function buildStreamRelay(options: { key: string; isAllowedAddress?: (address: string) => boolean }) {
  if (options.key.length < 32) throw new Error("STREAM_RELAY_KEY must contain at least 32 characters");
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  // No request URL logging: signed URLs and provider tokens are credentials.
  const app = Fastify({ logger: false });
  const tokens = new HostTokens(allowed);
  const stats: ProxyStats = { bytes: 0, requests: 0, refused: 0 };
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Range");
    reply.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
  });
  app.get("/health", async () => ({ ok: true, role: "stream-relay", ...stats }));
  app.options("/api/proxy", async (_request, reply) => reply.code(204).send());
  app.get<{ Querystring: Record<string, unknown> }>("/api/proxy", async (request, reply) => {
    const link = verifyRelayLink(request.query, options.key);
    if (!link) return reply.code(403).send({ error: "INVALID_RELAY_LINK" });
    let target: URL;
    try {
      target = new URL(link.url);
      assertAllowedUrl(target, allowed);
      const referer = new URL(link.referer);
      assertAllowedUrl(referer, allowed);
    } catch {
      return reply.code(403).send({ error: "URL_NOT_ALLOWED" });
    }
    try {
      if (link.hostToken) target = await tokens.authorize(target, link.referer);
    } catch (error) {
      return reply.code(502).send({ error: "UPSTREAM_TOKEN_FAILED", message: error instanceof Error ? error.message : "Token unavailable" });
    }
    // Relative links stay on the relay's own origin, including master variants, keys, audio, subtitles and initialization pieces.
    request.query = { url: target.href, referer: link.referer };
    return handleStreamProxy(request as Parameters<typeof handleStreamProxy>[0], reply, {
      video: true, omitOrigin: true, isAllowedAddress: allowed, stats,
      rewriteUrl: (resource) => {
        // Only the original playlist endpoint needs a token. Propagate the mode to child /pl/ playlists on the same host.
        const hostToken = link.hostToken && resource.origin === target.origin && resource.pathname.startsWith("/pl/") && resource.pathname.endsWith(".m3u8");
        if (hostToken) resource.searchParams.delete("token");
        const signed = signedRelayUrl("http://relay/api/proxy", { url: resource.href, referer: link.referer, expires: link.expires, hostToken }, options.key);
        return signed.slice("http://relay".length);
      },
    });
  });
  return app;
}
