import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "./app";

type Health = { ok: boolean; segments: { hits: number; misses: number; keptMB: number } };

/** The team's token (see `teamGuard`): the counters of /api/health are asked with it. */
const TOKEN = "health-test-team-token-0123456789";
const team = { authorization: `Bearer ${TOKEN}` };
const withTeam = (options: AppOptions = {}) => buildApp({ ...options, feedbackAdminToken: TOKEN });
/** What the team is told: the short answer and the counters. */
const counters = async (app: FastifyInstance) => (await app.inject({ url: "/api/health", headers: team })).json<Record<string, unknown>>();

describe("/api/health", () => {
  let app: FastifyInstance | undefined;
  let upstream: Server | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    upstream?.closeAllConnections();
    await new Promise((resolve) => (upstream ? upstream.close(resolve) : resolve(undefined)));
    upstream = undefined;
  });

  it("says where the server keeps things, and for how long it has been up", async () => {
    app = await buildApp({ storage: "postgres" });
    const body = (await app.inject("/api/health")).json<{ ok: boolean; storage?: string; uptime: number }>();
    expect(body.ok).toBe(true);
    expect(body.storage).toBe("postgres");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.uptime)).toBe(true);
  });

  it("does not make up a place it was not told about", async () => {
    app = await buildApp();
    const body = (await app.inject("/api/health")).json<Record<string, unknown>>();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty("storage");
  });

  it("tells anyone only that it is up: the counters are the team's, asked with its token (judge #12)", async () => {
    app = await withTeam({ storage: "postgres" });
    const open = await app.inject("/api/health");
    expect(open.statusCode).toBe(200);
    expect(open.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(open.json()).sort()).toEqual(["ok", "storage", "uptime"]);
    const full = await counters(app);
    expect(full).toMatchObject({ ok: true, storage: "postgres" });
    for (const key of ["segments", "proxy", "subsync", "official", "feedback", "features"]) expect(full).toHaveProperty(key);
    // A wrong token is told so, not handed the short answer (a mistyped token is noticed), and tries are slowed per address.
    const wrong = await app.inject({ url: "/api/health", headers: { authorization: "Bearer not-the-token-but-long-enough" } });
    expect([wrong.statusCode, wrong.json()]).toEqual([401, { error: "unauthorized" }]);
    // (An answer the HEAD of an uptime monitor gets, too.)
    expect((await app.inject({ method: "HEAD", url: "/api/health" })).statusCode).toBe(200);
  });

  it("on a server with no team token, any request gets the short answer, whatever it brings", async () => {
    app = await buildApp();
    const asked = await app.inject({ url: "/api/health", headers: team });
    expect(asked.statusCode).toBe(200);
    expect(Object.keys(asked.json()).sort()).toEqual(["ok", "uptime"]);
  });

  it("counts the pieces of a film the proxy gave from memory and the ones it had to fetch", async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "5" });
      response.end("BYTES");
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const piece = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/seg-1.ts`;
    app = await withTeam({ allowPrivateNetwork: true });
    expect(((await counters(app)) as Health).segments).toEqual({ hits: 0, misses: 0, keptMB: 0 });
    for (let screen = 0; screen < 3; screen++) {
      expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).body).toBe("BYTES"); // (three screens, one film)
    }
    expect(((await counters(app)) as Health).segments).toEqual({ hits: 2, misses: 1, keptMB: 0 });
  });

  it("counts how much film the proxy sent on, which is most of what a host's bandwidth goes on", async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "5" });
      response.end("BYTES");
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const piece = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/seg-1.ts`;
    app = await withTeam({ allowPrivateNetwork: true });
    expect((await counters(app)).proxy).toEqual({ bytes: 0, requests: 0, refused: 0, video: "on" });
    for (let screen = 0; screen < 3; screen++) await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`);
    // (Three screens each had the five bytes, although the film's own place was asked once.)
    expect((await counters(app)).proxy).toEqual({ bytes: 15, requests: 3, refused: 0, video: "on" });
  });

  it("says when it carries no film, and how many asks for one it turned away", async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "5" });
      response.end("BYTES");
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const piece = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/seg-1.ts`;
    app = await withTeam({ allowPrivateNetwork: true, proxyVideo: false });
    for (let screen = 0; screen < 3; screen++) expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).statusCode).toBe(403);
    expect((await counters(app)).proxy).toEqual({ bytes: 0, requests: 3, refused: 3, video: "off" });
  });

  it("carries film from the hosts PROXY_EXEMPT_HOSTS names although it carries no film, and from no host when it names none", async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "5" });
      response.end("BYTES");
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const piece = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/seg-1.ts`;
    const before = process.env.PROXY_EXEMPT_HOSTS;
    try {
      // (As a host sets it: the whole server, from the setting to the answer.)
      process.env.PROXY_EXEMPT_HOSTS = "elsewhere.example, 127.0.0.1";
      app = await buildApp({ allowPrivateNetwork: true, proxyVideo: false });
      expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).body).toBe("BYTES");
      await app.close();
      delete process.env.PROXY_EXEMPT_HOSTS;
      app = await buildApp({ allowPrivateNetwork: true, proxyVideo: false });
      expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).statusCode).toBe(403);
      await app.close();
      // (And as an option, which is what a test or another program gives.)
      app = await buildApp({ allowPrivateNetwork: true, proxyVideo: false, proxyExemptHosts: ["127.0.0.1"] });
      expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).body).toBe("BYTES");
    } finally {
      if (before === undefined) delete process.env.PROXY_EXEMPT_HOSTS;
      else process.env.PROXY_EXEMPT_HOSTS = before;
    }
  });

  it("is told to carry no film by PROXY_VIDEO=off, which is how a host says it", async () => {
    const before = process.env.PROXY_VIDEO;
    process.env.PROXY_VIDEO = "off";
    try {
      app = await withTeam();
      expect(((await counters(app)).proxy as { video: string }).video).toBe("off");
    } finally {
      if (before === undefined) delete process.env.PROXY_VIDEO;
      else process.env.PROXY_VIDEO = before;
    }
  });
});
