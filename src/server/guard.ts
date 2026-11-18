import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAppStart } from "./accounts/google";
import { DayCount, RateLimiter } from "./accounts/rateLimit";

const MINUTE = 60_000;

const BASELINE_POLICY = "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";

export function securityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    stampHeaders(request, reply);
  });
}

function stampHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", BASELINE_POLICY);
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Permissions-Policy", "microphone=(), geolocation=(), payment=(), usb=()");
  if (request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
}

export function answerUnroutable(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  stampHeaders(request, reply);
  void reply.send(error);
}

const TITLE_ASKS = ["/api/library/about", "/api/library/title", "/api/library/episodes", "/api/library/seasons", "/api/anime/skip"];

const LIKE_ASKS = ["/api/library/similar"];

const BROWSE_ASKS = ["/api/library/rows", "/api/library/more", "/api/library/names"];

const FETCHES = new Set(["/api/proxy", "/api/resolve", "/api/library", "/api/library/search", ...BROWSE_ASKS, ...TITLE_ASKS, ...LIKE_ASKS, "/api/auth/google/callback"]);

const COUNTED_PREFIXES = ["/api/profiles/", "/api/link/"];
const COUNTED_ROUTES = new Set(["/api/feedback/mine", "/api/auth/google/start", "/api/auth/google/app-claim"]);
const counts = (route: string) => COUNTED_ROUTES.has(route) || COUNTED_PREFIXES.some((prefix) => route.startsWith(prefix));

export function isOwnOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const from = new URL(origin);
    return from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

export function sameSiteGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url ?? "";
    if (!route.startsWith("/api/") || request.method === "OPTIONS") return;
    const site = request.headers["sec-fetch-site"];
    const elsewhere = site === "cross-site" || site === "same-site";
    let refused: boolean;
    if (request.method === "GET" || request.method === "HEAD") {
      const navigation = request.headers["sec-fetch-mode"] === "navigate";
      const ahead = /prefetch|prerender/i.test(`${request.headers["sec-purpose"] ?? ""} ${request.headers.purpose ?? ""}`);
      const appTrip =
        route === "/api/auth/google/start" && navigation && !ahead && (request.headers["sec-fetch-dest"] ?? "document") === "document" && isAppStart((request.query ?? {}) as Record<string, unknown>);
      refused = elsewhere && !appTrip && (counts(route) || (FETCHES.has(route) && !navigation));
    } else {
      const { origin, host } = request.headers;
      refused = elsewhere || (site !== "same-origin" && origin !== undefined && !isOwnOrigin(origin, host));
    }
    if (refused) return reply.code(403).send({ error: "cross_site" });
  });
}

export interface FetchesPerMinute {
  resolve?: number;
  library?: number;
  similar?: number;
  search?: number;
  proxy?: number;
  browse?: number;
}

export interface FetchesPerDay {
  search: number;
  titles: number;
  browse: number;
}
export const FETCHES_PER_DAY: Readonly<FetchesPerDay> = { search: 3000, titles: 30_000, browse: 30_000 };

export function fetchLimits(
  app: FastifyInstance,
  { resolve = 60, library = 120, similar = 120, search = 60, proxy = 300, browse = 300 }: FetchesPerMinute,
  { video, perDay = FETCHES_PER_DAY }: { video: boolean; perDay?: FetchesPerDay },
): void {
  const days = new Map<string, DayCount>();
  days.set("/api/library/search", new DayCount(perDay.search, undefined, "fetch.searchPerDay"));
  const titlesToday = new DayCount(perDay.titles, undefined, "fetch.titlesPerDay");
  for (const route of [...TITLE_ASKS, ...LIKE_ASKS]) days.set(route, titlesToday);
  const browsedToday = new DayCount(perDay.browse, undefined, "fetch.browsePerDay");
  for (const route of BROWSE_ASKS) days.set(route, browsedToday);
  const limiters = new Map<string, RateLimiter>();
  limiters.set("/api/resolve", new RateLimiter(resolve, MINUTE));
  limiters.set("/api/library/search", new RateLimiter(search, MINUTE));
  const titles = new RateLimiter(library, MINUTE);
  for (const route of TITLE_ASKS) limiters.set(route, titles);
  const likes = new RateLimiter(similar, MINUTE);
  for (const route of LIKE_ASKS) limiters.set(route, likes);
  const shelves = new RateLimiter(browse, MINUTE);
  for (const route of BROWSE_ASKS) limiters.set(route, shelves);
  if (!video) limiters.set("/api/proxy", new RateLimiter(proxy, MINUTE));
  app.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url ?? "";
    const limiter = limiters.get(route);
    if (!limiter) return;
    const day = days.get(route);
    const wait = Math.max(limiter.wait(request.ip), day?.wait(request.ip) ?? 0);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return reply.header("Retry-After", seconds).code(429).send({ error: "rate_limited", retryAfter: seconds });
    }
    limiter.hit(request.ip);
    day?.hit(request.ip);
  });
}
