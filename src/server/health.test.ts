import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

type Health = { ok: boolean; segments: { hits: number; misses: number; keptMB: number } };

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

  it("counts the pieces of a film the proxy gave from memory and the ones it had to fetch", async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "5" });
      response.end("BYTES");
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    const piece = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/seg-1.ts`;
    app = await buildApp({ allowPrivateNetwork: true });
    expect((await app.inject("/api/health")).json<Health>().segments).toEqual({ hits: 0, misses: 0, keptMB: 0 });
    for (let screen = 0; screen < 3; screen++) {
      expect((await app.inject(`/api/proxy?url=${encodeURIComponent(piece)}`)).body).toBe("BYTES"); // (three screens, one film)
    }
    expect((await app.inject("/api/health")).json<Health>().segments).toEqual({ hits: 2, misses: 1, keptMB: 0 });
  });
});
