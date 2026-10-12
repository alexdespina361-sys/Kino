import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("/api/health", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
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
});
