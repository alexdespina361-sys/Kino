import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("/api/features", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("answers with nothing turned on by default, never from a cache, and offers no cat even where the host still has its old switch", async () => {
    const saved = process.env.CAT_COMPANION;
    try {
      process.env.CAT_COMPANION = "on"; // (the cat is gone: a page of an older Kino reads the missing `cat` as off)
      const token = "features-test-team-token-0123456789";
      app = await buildApp({ feedbackAdminToken: token, klipyKey: "" });
      const answer = await app.inject("/api/features");
      expect(answer.statusCode).toBe(200);
      expect(answer.json()).toEqual({});
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect((await app.inject({ url: "/api/health", headers: { authorization: `Bearer ${token}` } })).json<{ features: unknown }>().features).toEqual({});
    } finally {
      if (saved === undefined) delete process.env.CAT_COMPANION;
      else process.env.CAT_COMPANION = saved;
    }
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
      expect((await app.inject("/api/features")).json()).toEqual({ gifs: "Abc_def-1234567890" });
      expect((await app.inject({ url: "/api/health", headers: { authorization: `Bearer ${token}` } })).json<{ features: unknown }>().features).toEqual({ gifs: true });
      expect(JSON.stringify((await app.inject("/api/health")).json())).not.toContain("Abc_def");
      await app.close();
      for (const wrong of ["short", "has spaces in it", "<script>alert(1)</script>", "a/b/c/d/e/f/g"]) {
        process.env.KLIPY_KEY = wrong;
        app = await buildApp();
        expect((await app.inject("/api/features")).json(), wrong).not.toHaveProperty("gifs");
        await app.close();
      }
      app = await buildApp({ klipyKey: "fromTheOption123" });
      expect((await app.inject("/api/features")).json()).toEqual({ gifs: "fromTheOption123" });
    } finally {
      if (saved === undefined) delete process.env.KLIPY_KEY;
      else process.env.KLIPY_KEY = saved;
    }
  });
});
