import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Registration } from "../shared";
import type { PasswordCost } from "./accounts/password";
import { accountRoutes } from "./accounts/routes";
import type { AccountStore } from "./accounts/store";
import { createLibrary, type LibrarySource } from "./library/library";
import { handleStreamProxy } from "./proxy";
import { createResolver, type ResolveFn } from "./resolvers";
import { Hub, type HubOptions } from "./websocket/hub";
import { Registry } from "./sessions/registry";

export interface AppOptions {
  /** Accounts, profiles and what they watched. Without it the server has no sign-in and every screen just keeps its own history. The app closes it when it stops. */
  accounts?: AccountStore;
  /** `closed` stops new accounts being made. */
  registration?: Registration;
  maxAccounts?: number;
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
  /** Let the resolver fetch loopback/LAN pages (local fixtures). Default false; env ALLOW_PRIVATE_NETWORK=1. */
  allowPrivateNetwork?: boolean;
  /** Socket liveness tuning; tests shorten it. */
  hub?: HubOptions;
  logger?: boolean;
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
  if (options.accounts) {
    const accounts = options.accounts;
    app.addHook("onClose", async () => accounts.close());
    await app.register(accountRoutes, {
      store: accounts,
      ...(options.registration ? { registration: options.registration } : {}),
      ...(options.maxAccounts ? { maxAccounts: options.maxAccounts } : {}),
      ...(options.passwordCost ? { passwordCost: options.passwordCost } : {}),
    });
  }
  const resolve =
    options.resolve ??
    createResolver({
      log: app.log,
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
    });
  const hub = new Hub(options.registry ?? new Registry(), resolve, options.hub);
  app.addHook("onClose", async () => hub.dispose());

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.get("/ws", { websocket: true }, (socket, request) => {
    // Connection diagnostics (no tokens/ids): who is knocking, via which host, and how it ends.
    const { host, origin } = request.headers;
    request.log.info({ host, origin, ip: request.headers["x-forwarded-for"] ?? request.ip }, "ws connected");
    socket.on("close", (code, reason) => request.log.info({ code, reason: reason.toString() }, "ws closed"));
    hub.handleConnection(socket);
  });
  app.get("/api/health", async () => ({ ok: true }));
  const library = createLibrary({ sources: options.librarySources ?? [], log: app.log });
  app.get("/api/library", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return library.get();
  });
  app.get<{ Querystring: { q?: string } }>("/api/library/search", async (request, reply) => {
    const q = request.query.q ?? "";
    const items = await library.search(q);
    return reply.send({ items });
  });
  app.get<{ Querystring: { url?: string } }>("/api/library/similar", async (request, reply) => {
    const link = request.query.url ?? "";
    if (!link || link.length > 2048) return reply.code(400).send({ error: "Missing 'url' parameter" });
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send({ items: await library.similar(link) });
  });
  app.get<{ Querystring: { url?: string; season?: string } }>("/api/library/episodes", async (request, reply) => {
    const link = request.query.url ?? "";
    const season = Number(request.query.season);
    if (!link || link.length > 2048 || !Number.isInteger(season) || season < 0 || season > 200) return reply.code(400).send({ error: "Missing 'url' or 'season' parameter" });
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send({ episodes: await library.episodes(link, season) });
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
  app.get<{ Querystring: { url?: string; referer?: string } }>("/api/proxy", async (request, reply) => {
    return handleStreamProxy(request, reply, {
      allowPrivateNetwork: options.allowPrivateNetwork ?? process.env.ALLOW_PRIVATE_NETWORK === "1",
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
        if (filePath.startsWith(assetsDir)) reply.header("Cache-Control", "public, max-age=31536000, immutable");
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
