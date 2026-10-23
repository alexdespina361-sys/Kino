import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("keeps the subtitle aligner's model for good too (a changed one goes in a new numbered folder)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    await mkdir(path.join(dir, "subtitle-sync", "1"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
    await writeFile(path.join(dir, "subtitle-sync", "1", "whistle.cact"), "model");
    const app = await buildApp({ clientDir: dir });
    try {
      const model = await app.inject({ url: "/subtitle-sync/1/whistle.cact" });
      expect(model.statusCode).toBe(200);
      expect(model.headers["cache-control"]).toMatch(/max-age=31536000.*immutable/);
    } finally {
      await app.close();
    }
  });

  it("serves the wordmark's pictures as pictures, and does not keep them for good (they keep their names: a new logo has to show up)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
    await cp(new URL("../../public/branding", import.meta.url), path.join(dir, "branding"), { recursive: true }); // (public/ is copied as it is into the built page)
    const app = await buildApp({ clientDir: dir });
    try {
      for (const name of ["kino-cat-off.svg", "kino-cat-on.svg"]) {
        const picture = await app.inject({ url: `/branding/${name}` });
        expect(picture.statusCode).toBe(200);
        expect(picture.headers["content-type"]).toMatch(/^image\/svg\+xml/);
        expect(picture.headers["cache-control"]).not.toMatch(/immutable|31536000/);
      }
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
