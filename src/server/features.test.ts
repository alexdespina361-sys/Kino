import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("/api/features", () => {
  let app: FastifyInstance | undefined;
  const before = process.env.CAT_COMPANION;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (before === undefined) delete process.env.CAT_COMPANION;
    else process.env.CAT_COMPANION = before;
  });

  it("offers no cat unless the host turned it on", async () => {
    delete process.env.CAT_COMPANION;
    app = await buildApp();
    const answer = await app.inject("/api/features");
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ cat: false });
    expect((await app.inject("/api/health")).json<{ features: unknown }>().features).toEqual({ cat: false });
  });

  it("offers the cat when CAT_COMPANION is on, and takes it back when it is not", async () => {
    for (const value of ["on", "1", "true", "YES"]) {
      process.env.CAT_COMPANION = value;
      app = await buildApp();
      expect((await app.inject("/api/features")).json()).toEqual({ cat: true });
      await app.close();
    }
    for (const value of ["off", "0", "", "maybe"]) {
      process.env.CAT_COMPANION = value;
      app = await buildApp();
      expect((await app.inject("/api/features")).json()).toEqual({ cat: false });
      await app.close();
    }
    app = undefined;
  });

  it("is told by the app's own option before the environment, and is never kept by a cache (the switch must work at the next load)", async () => {
    process.env.CAT_COMPANION = "off";
    app = await buildApp({ cat: true });
    const answer = await app.inject("/api/features");
    expect(answer.json()).toEqual({ cat: true });
    expect(answer.headers["cache-control"]).toBe("no-store");
  });
});
