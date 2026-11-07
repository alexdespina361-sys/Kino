import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { handleStreamProxy, type ProxyStats } from "../proxy";
import { isPublicAddress } from "../resolvers/ip";
import { assertAllowedUrl } from "../resolvers/safe-fetch";
import { signedRelayUrl, verifyRelayLink } from "./links";
import { HostTokens } from "./tokens";

/**
 * What the relay writes down when it cannot pass a piece of a film on: the status it answered with, which host and which file it was asked for, and
 * what it had to say. Never the address asked (a signed link, with the site's token in it): the host and the file's name are enough to tell a token
 * that was refused from a playlist that is gone from a host that did not answer.
 */
export interface RelayFailure {
  status: number;
  host?: string;
  file?: string;
  error?: string;
}
export type RelayLog = (failure: RelayFailure) => void;

const toJournal: RelayLog = (failure) => console.log(JSON.stringify({ time: new Date().toISOString(), msg: "relay-failure", ...failure }));

/** The name of the file an address ends in, without its query. */
const fileOf = (url: URL): string => url.pathname.split("/").filter(Boolean).pop() ?? "";

export function buildStreamRelay(options: { key: string; isAllowedAddress?: (address: string) => boolean; log?: RelayLog }) {
  if (options.key.length < 32) throw new Error("STREAM_RELAY_KEY must contain at least 32 characters");
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const log = options.log ?? toJournal;
  // No request URL logging: signed URLs and provider tokens are credentials. (Failures are written down by `log`, without the address.)
  const app = Fastify({ logger: false });
  const tokens = new HostTokens(allowed);
  const stats: ProxyStats = { bytes: 0, requests: 0, refused: 0 };
  /** What each request is for, once its link has been read: for the line about a failure. */
  const targets = new WeakMap<FastifyRequest, URL>();
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Range");
    reply.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
  });
  // An answer that says no is written down, with what it said when that is a short text (what the site answered, or this relay's own reason), never the address.
  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode < 400 || request.method === "OPTIONS") return payload;
    const target = targets.get(request);
    const said = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8", 0, 200) : undefined;
    log({
      status: reply.statusCode,
      ...(target && { host: target.hostname, file: fileOf(target) }),
      ...(said && { error: said.replace(/\s+/g, " ").trim().slice(0, 160) }),
    });
    return payload;
  });
  app.get("/health", async () => ({ ok: true, role: "stream-relay", ...stats }));

  const proxyHandler = async (request: FastifyRequest<{ Querystring: Record<string, unknown> }>, reply: FastifyReply) => {
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
    targets.set(request, target);
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
  };

  app.options("/api/proxy", async (_request, reply) => reply.code(204).send());
  app.options("/", async (_request, reply) => reply.code(204).send());
  app.get<{ Querystring: Record<string, unknown> }>("/api/proxy", proxyHandler);
  app.get<{ Querystring: Record<string, unknown> }>("/", proxyHandler);
  return app;
}
