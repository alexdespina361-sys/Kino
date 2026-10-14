import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { isHttpUrl, type Registration } from "../shared";
import type { PasswordCost } from "./accounts/password";
import { accountRoutes } from "./accounts/routes";
import { ScreenProofs, screenProfiles } from "./accounts/screens";
import type { AccountStore } from "./accounts/store";
import { createLibrary, type LibrarySource } from "./library/library";
import { handleStreamProxy } from "./proxy";
import { createResolver, type ResolveFn } from "./resolvers";
import { SegmentCache, type SegmentCacheOptions } from "./segmentCache";
import { Hub, type HubOptions } from "./websocket/hub";
import type { PairingStore } from "./sessions/pairings";
import { Registry } from "./sessions/registry";

export interface AppOptions {
  /** Accounts, profiles and what they watched. Without it the server has no sign-in and every screen just keeps its own history. The app closes it when it stops. */
  accounts?: AccountStore;
  /** Keeps the pairs of `registry` between restarts; without it a restart makes every phone and TV forget each other. The app writes what is left of it when it stops. */
  pairings?: PairingStore;
  /** Where all of that is kept ("Postgres", "a file", "memory only"): `/api/health` says so, which is how to tell whether a host keeps anything between restarts. */
  storage?: "postgres" | "file" | "memory";
  /** `closed` stops new accounts being made. */
  registration?: Registration;
  maxAccounts?: number;
  /** How many accounts one address may make in an hour (10 unless set). */
  signUpsPerHour?: number;
  /** How many proxies sit in front of the server (a host like Render has one), so a visitor's address and https are read from the right place. */
  trustProxy?: boolean | number;
  /** Tests use a cheaper password hash. */
  passwordCost?: PasswordCost;
  /** Built Vite app. Served at / and /tv. Omitted in tests/dev where Vite serves the UI. */
  clientDir?: string;
  /** Local test media served at /fixtures/. */
  fixturesDir?: string;
  registry?: Registry;
  /** URL -> media. Defaults to the real registry (adapters, then generic). Tests inject fakes. */
  resolve?: ResolveFn;
  /** Where the library's titles come from. None by default, so nothing here reaches the network unless asked. */
  librarySources?: LibrarySource[];
  /** The clock the library keeps its time by; tests move it. */
  libraryNow?: () => number;
  /** Let the resolver fetch loopback/LAN pages (local fixtures). Default false; env ALLOW_PRIVATE_NETWORK=1. */
  allowPrivateNetwork?: boolean;
  /** Socket liveness tuning; tests shorten it. */
  hub?: HubOptions;
  /** How much of a film the proxy keeps for the screens of a party (64 MB, 3 minutes unless set; env SEGMENT_CACHE_MB sets the size in megabytes). */
  segmentCache?: SegmentCacheOptions;
  logger?: boolean;
}

/** The size of the cache of film pieces from the environment (megabytes, a fraction will do), or nothing when it is not set to a number above zero. */
function segmentCacheFromEnv(): SegmentCacheOptions {
  const megabytes = Number(process.env.SEGMENT_CACHE_MB);
  return Number.isFinite(megabytes) && megabytes > 0 ? { maxBytes: Math.round(megabytes * 1024 * 1024) } : {};
}

const root = path.resolve(import.meta.dirname, "../..");

export function defaultClientDir(): string {
  return process.env.CLIENT_DIR ?? path.join(root, "dist/client");
}
export function defaultFixturesDir(): string {
  return process.env.FIXTURES_DIR ?? path.join(root, "fixtures");
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  // A number is "this many proxies in front of me" (Fastify no longer reads a bare number as that, so spell it out).
  const proxies = options.trustProxy;
  const trustProxy = typeof proxies === "number" ? (_address: string, hop: number) => hop < proxies : proxies;
  const app = Fastify({ logger: options.logger ?? false, ...(trustProxy === undefined ? {} : { trustProxy }) });
  await app.register(fastifyCompress, {
    threshold: 1024,
  });
  const registry = options.registry ?? new Registry();
  const accounts = options.accounts;
  // (A screen that is signed in tells the watch party whose it is by a proof the accounts give it: see accounts/screens.ts.)
  const screens = accounts && new ScreenProofs(() => accounts.clock());
  if (accounts) {
    app.addHook("onClose", async () => accounts.close());
    await app.register(accountRoutes, {
      store: accounts,
      ...(options.registration ? { registration: options.registration } : {}),
      ...(options.maxAccounts ? { maxAccounts: options.maxAccounts } : {}),
      ...(options.signUpsPerHour ? { signUpsPerHour: options.signUpsPerHour } : {}),
      ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}),
      ...(screens ? { screens } : {}),
      // (What friends are invited to: the screen whose party a code is open with, and the code a party is joined with now.)
      parties: {
        hostOf: (code) => registry.hostOfPartyCode(code)?.publicId,
        running: (host) => {
          const device = registry.deviceByPublicId(host);
          return (device && registry.runningParty(device)) || undefined;
        },
      },
    });
  }
  const resolve =
    options.resolve ??
    createResolver({
      log: app.log,
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
    });
  const library = createLibrary({ sources: options.librarySources ?? [], log: app.log, ...(options.libraryNow ? { now: options.libraryNow } : {}) });
  // Every try at playing something tells the library how it went, so the titles a place lists but has no video of stop being offered.
  const resolveForPlay: ResolveFn = async (url, isPrefetch) => {
    const result = await resolve(url, isPrefetch);
    if (result.status === "success") library.played(url, "found");
    else if (result.status === "unsupported") library.played(url, "none");
    else if (result.status === "temporary_failure") library.played(url, "failed");
    return result;
  };
  const hub = new Hub(registry, resolveForPlay, { ...options.hub, ...(accounts && screens ? { profiles: screenProfiles(accounts, screens) } : {}) });
  // Hooks run last-registered first: the pairs are written before the accounts close the database they share.
  if (options.pairings) {
    const pairings = options.pairings;
    app.addHook("onClose", async () => pairings.close());
  }
  app.addHook("onClose", async () => hub.dispose());

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.get("/ws", { websocket: true }, (socket, request) => {
    // Connection diagnostics (no tokens/ids): who is knocking, via which host, and how it ends.
    const { host, origin } = request.headers;
    request.log.info({ host, origin, ip: request.headers["x-forwarded-for"] ?? request.ip }, "ws connected");
    socket.on("close", (code, reason) => request.log.info({ code, reason: reason.toString() }, "ws closed"));
    hub.handleConnection(socket);
  });
  // Screens watching a film together ask for the same pieces of it: the proxy fetches each once and shares it (see `SegmentCache`).
  const segments = new SegmentCache(options.segmentCache ?? segmentCacheFromEnv());
  // (`uptime`, in seconds, tells a server that was only just started - it slept, or was restarted - from one that has been up all along.
  // `segments` counts the asks for a piece of a film that the proxy answered itself (`hits`) and the ones it had to take to the film's own place
  // (`misses`): with screens watching together, the hits are the share of the load that was not multiplied by the number of screens.)
  app.get("/api/health", async () => ({
    ok: true,
    ...(options.storage ? { storage: options.storage } : {}),
    uptime: Math.round(process.uptime()),
    segments: { hits: segments.hits, misses: segments.misses, keptMB: Math.round(segments.keptBytes / 1024 / 1024) },
  }));
  app.get("/api/library", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return library.get();
  });
  app.get<{ Querystring: { q?: string } }>("/api/library/search", async (request, reply) => {
    const q = request.query.q ?? "";
    const items = await library.search(q);
    const topItem = items[0];
    if (topItem?.url && process.env.PRELOAD_SEARCH !== "0" && isHttpUrl(topItem.url)) {
      const timer = setTimeout(() => {
        resolve(topItem.url, true).catch(() => {});
      }, 200);
      timer.unref?.();
    }
    return reply.send({ items });
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/similar", async (request, reply) => {
    const link = request.query.url ?? "";
    if (!link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const items = await library.similar(link);
    // Only an answer is kept by the browser: none may be a place that could not be reached just now.
    reply.header("Cache-Control", items.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ items });
  });
  app.get<{ Querystring: { url?: string; season?: string } }>("/api/library/episodes", async (request, reply) => {
    const link = request.query.url ?? "";
    const season = Number(request.query.season);
    if (!link || link.length > 2048 || !Number.isInteger(season) || season < 0 || season > 200) return reply.code(400).send({ error: "Missing 'url' or 'season' parameter" });
    const episodes = await library.episodes(link, season);
    reply.header("Cache-Control", episodes.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ episodes });
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/seasons", async (request, reply) => {
    const link = request.query.url ?? "";
    if (!link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const seasons = await library.seasons(link);
    // Only an answer is kept by the browser: no seasons may be a place that could not be reached just now.
    reply.header("Cache-Control", seasons.length > 0 ? "public, max-age=3600" : "no-store");
    return reply.send({ seasons });
  });
  app.options("/api/proxy", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "*");
    return reply.send();
  });
  app.get<{ Querystring: { url?: string } }>("/api/resolve", async (request, reply) => {
    const rawUrl = request.query.url;
    if (!rawUrl) return reply.code(400).send({ error: "Missing 'url' parameter" });
    const result = await resolve(rawUrl);
    return reply.send(result);
  });
  app.get<{ Querystring: { url?: string; referer?: string } }>("/api/proxy", { compress: false }, async (request, reply) => {
    return handleStreamProxy(request, reply, {
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
      segments,
    });
  });

  const fixturesDir = options.fixturesDir;
  if (fixturesDir && existsSync(fixturesDir)) {
    await app.register(fastifyStatic, { root: fixturesDir, prefix: "/fixtures/", decorateReply: false });
  }

  const clientDir = options.clientDir && path.resolve(options.clientDir);
  if (clientDir && existsSync(path.join(clientDir, "index.html"))) {
    const assetsDir = path.join(clientDir, "assets") + path.sep;
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/",
      // Vite names the files in /assets after what is in them, so a changed file has a new name and an old one can be kept for good.
      // The page itself is always checked again, which is how a new build reaches a screen that still has the old one.
      setHeaders: (reply, filePath) => {
        if (filePath.startsWith(assetsDir)) {
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          reply.header("Cache-Control", "no-cache, must-revalidate");
        } else {
          reply.header("Cache-Control", "public, max-age=86400");
        }
      },
    });
    // One SPA: "/" is the phone, "/tv" is the receiver. Both are index.html.
    app.setNotFoundHandler((request, reply) => {
      const isPage = request.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/ws");
      if (isPage && request.headers.accept?.includes("text/html")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }
  return app;
}
