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
    const token = "features-test-team-token-0123456789";
    app = await buildApp({ feedbackAdminToken: token });
    const answer = await app.inject("/api/features");
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ cat: false });
    // (The team's /api/health says the same; anyone's says only that the server is up.)
    expect((await app.inject({ url: "/api/health", headers: { authorization: `Bearer ${token}` } })).json<{ features: unknown }>().features).toEqual({ cat: false });
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

  it("hands the pages the KLIPY key for GIFs only when the host has one that looks like a key (the team's health says only that there is one)", async () => {
    const saved = process.env.KLIPY_KEY;
    try {
      delete process.env.KLIPY_KEY;
      app = await buildApp();
      expect((await app.inject("/api/features")).json()).not.toHaveProperty("gifs");
      await app.close();
      process.env.KLIPY_KEY = " Abc_def-1234567890 ";
      const token = "features-test-team-token-0123456789";
      app = await buildApp({ feedbackAdminToken: token });
      expect((await app.inject("/api/features")).json()).toEqual({ cat: false, gifs: "Abc_def-1234567890" });
      expect((await app.inject({ url: "/api/health", headers: { authorization: `Bearer ${token}` } })).json<{ features: unknown }>().features).toEqual({ cat: false, gifs: true });
      expect(JSON.stringify((await app.inject("/api/health")).json())).not.toContain("Abc_def");
      await app.close();
      for (const wrong of ["short", "has spaces in it", "<script>alert(1)</script>", "a/b/c/d/e/f/g"]) {
        process.env.KLIPY_KEY = wrong;
        app = await buildApp();
        expect((await app.inject("/api/features")).json(), wrong).not.toHaveProperty("gifs");
        await app.close();
      }
      app = await buildApp({ klipyKey: "fromTheOption123" });
      expect((await app.inject("/api/features")).json()).toEqual({ cat: false, gifs: "fromTheOption123" });
    } finally {
      if (saved === undefined) delete process.env.KLIPY_KEY;
      else process.env.KLIPY_KEY = saved;
    }
  });

  it("is told by the app's own option before the environment, and is never kept by a cache (the switch must work at the next load)", async () => {
    process.env.CAT_COMPANION = "off";
    app = await buildApp({ cat: true });
    const answer = await app.inject("/api/features");
    expect(answer.json()).toEqual({ cat: true });
    expect(answer.headers["cache-control"]).toBe("no-store");
  });
});
