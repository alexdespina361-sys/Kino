import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { handleStreamProxy } from "./proxy";
import { createResolver, type ResolveFn } from "./resolvers";
import { Hub, type HubOptions } from "./websocket/hub";
import { Registry } from "./sessions/registry";

export interface AppOptions {
  /** Built Vite app. Served at / and /tv. Omitted in tests/dev where Vite serves the UI. */
  clientDir?: string;
  /** Local test media served at /fixtures/. */
  fixturesDir?: string;
  registry?: Registry;
  /** URL -> media. Defaults to the real registry (adapters, then generic). Tests inject fakes. */
  resolve?: ResolveFn;
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
  const app = Fastify({ logger: options.logger ?? false });
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

  const clientDir = options.clientDir;
  if (clientDir && existsSync(path.join(clientDir, "index.html"))) {
    await app.register(fastifyStatic, { root: clientDir, prefix: "/" });
    // One SPA: "/" is the phone, "/tv" is the receiver. Both are index.html.
    app.setNotFoundHandler((request, reply) => {
      const isPage = request.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/ws");
      if (isPage && request.headers.accept?.includes("text/html")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }
  return app;
}
