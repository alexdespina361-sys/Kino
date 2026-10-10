import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("serving the built page", () => {
  it("keeps the hashed files for good and checks the page itself again every time", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
    await writeFile(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
    const app = await buildApp({ clientDir: dir });
    try {
      const asset = await app.inject({ url: "/assets/index-abc123.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toMatch(/max-age=31536000.*immutable/);

      for (const url of ["/", "/index.html"]) {
        const page = await app.inject({ url });
        expect(page.statusCode).toBe(200);
        expect(page.headers["cache-control"]).not.toMatch(/immutable|31536000/);
      }

      // The page answers for paths of its own too (/tv, a link with a code): the same caution.
      const tv = await app.inject({ url: "/tv", headers: { accept: "text/html" } });
      expect(tv.statusCode).toBe(200);
      expect(tv.headers["cache-control"] ?? "").not.toMatch(/immutable|31536000/);
    } finally {
      await app.close();
    }
  });

  it("does not treat a folder named assets higher up as the assets", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    const inside = path.join(dir, "assets", "site");
    await mkdir(inside, { recursive: true });
    await writeFile(path.join(inside, "index.html"), "<!doctype html><title>Kino</title>");
    const app = await buildApp({ clientDir: inside });
    try {
      const page = await app.inject({ url: "/" });
      expect(page.statusCode).toBe(200);
      expect(page.headers["cache-control"]).not.toMatch(/immutable|31536000/);
    } finally {
      await app.close();
    }
  });
});
