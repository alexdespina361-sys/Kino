import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
      for (const url of ["/tv/", "/tv?title=movie-603", "/?party=123456"]) expect((await app.inject({ url, headers: { accept: "text/html" } })).statusCode, url).toBe(200);
      // (A check that it is there, as an uptime monitor makes: the headers alone, whatever it accepts.)
      const checked = await app.inject({ method: "HEAD", url: "/tv", headers: { accept: "*/*" } });
      expect([checked.statusCode, checked.body]).toEqual([200, ""]);
      expect((await app.inject({ url: "/tv", headers: { accept: "*/*" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "HEAD", url: "/does-not-exist", headers: { accept: "*/*" } })).statusCode).toBe(404);

      // An address that is no page of the site gets the page all the same (it says so, and opens the library), with a 404 (the judge, 16 Nov).
      for (const url of ["/does-not-exist", "/tv/anything", "/remote?x=1"]) {
        const stray = await app.inject({ url, headers: { accept: "text/html" } });
        expect(stray.statusCode, url).toBe(404);
        expect(stray.body, url).toBe("<!doctype html><title>Kino</title>");
        expect(stray.headers["cache-control"] ?? "", url).not.toMatch(/immutable|31536000/);
      }
    } finally {
      await app.close();
    }
  });

  it("says which build it serves, never kept anywhere, and the new one once index.html is a new build; nothing while there is no page (the owner's ask, 17 Nov)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    const page = (script: string) => `<!doctype html><title>Kino</title><script type="module" crossorigin src="/assets/${script}.js"></script>`;
    await writeFile(path.join(dir, "index.html"), page("index-Ab1_c2-D"));
    const app = await buildApp({ clientDir: dir });
    try {
      const first = await app.inject({ url: "/api/build" });
      expect(first.statusCode).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      expect(first.json()).toEqual({ build: "index-Ab1_c2-D" });
      // (A deploy writes a new page: its time is another, and so is its script.)
      await writeFile(path.join(dir, "index.html"), page("index-Zz9"));
      await utimes(path.join(dir, "index.html"), new Date(), new Date(Date.now() + 5000));
      expect((await app.inject({ url: "/api/build" })).json()).toEqual({ build: "index-Zz9" });
      // (A page with no script of the app's names no build; one that is not there, while a build is made, neither.)
      await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
      await utimes(path.join(dir, "index.html"), new Date(), new Date(Date.now() + 10000));
      expect((await app.inject({ url: "/api/build" })).json()).toEqual({ build: null });
      await rm(path.join(dir, "index.html"));
      expect((await app.inject({ url: "/api/build" })).json()).toEqual({ build: null });
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

  it("does not serve a file whose name starts with a dot, nor one in a folder whose name does, from the page or from the test media", async () => {
    // (`CLIENT_DIR` and `FIXTURES_DIR` can point at any folder, a project's own among them.)
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    const page = path.join(dir, "page");
    const media = path.join(dir, "media");
    for (const folder of [page, media]) {
      await mkdir(path.join(folder, ".git"), { recursive: true });
      await writeFile(path.join(folder, ".env"), "SECRET=1");
      await writeFile(path.join(folder, ".git", "config"), "SECRET=2");
      await writeFile(path.join(folder, "sample.txt"), "film");
    }
    await writeFile(path.join(page, "index.html"), "<!doctype html><title>Kino</title>");
    const app = await buildApp({ clientDir: page, fixturesDir: media });
    try {
      for (const url of ["/.env", "/%2eenv", "/.git/config", "/fixtures/.env", "/fixtures/.git/config"]) {
        const answer = await app.inject({ url });
        expect(answer.statusCode, url).toBe(404);
        expect(answer.body, url).not.toContain("SECRET");
      }
      // (A browser that asks for such a path is told the same: it is no page of the site, so it is not shown the page either. See `looksLikePage`.)
      const asked = await app.inject({ url: "/.env", headers: { accept: "text/html" } });
      expect(asked.statusCode).toBe(404);
      expect(asked.body).not.toContain("SECRET");
      // (An address that is no file is the page's own to make sense of.)
      expect((await app.inject({ url: "/tv", headers: { accept: "text/html" } })).body).toBe("<!doctype html><title>Kino</title>");
      // (...and the files that are served still are.)
      expect((await app.inject({ url: "/sample.txt" })).body).toBe("film");
      expect((await app.inject({ url: "/fixtures/sample.txt" })).body).toBe("film");
    } finally {
      await app.close();
    }
  });

  it("serves the upscaler test page of Kino Labs as a page of its own, checked again every time, and sends its address without the last slash to it", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kino-client-"));
    await mkdir(path.join(dir, "labs", "upscale"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
    await writeFile(path.join(dir, "labs", "upscale", "index.html"), "<!doctype html><title>Kino Labs: upscaler test</title>");
    const app = await buildApp({ clientDir: dir });
    try {
      const page = await app.inject({ url: "/labs/upscale/", headers: { accept: "text/html" } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("upscaler test");
      expect(page.headers["cache-control"]).toMatch(/no-cache/);
      const bare = await app.inject({ url: "/labs/upscale", headers: { accept: "text/html" } });
      expect(bare.statusCode).toBe(301);
      expect(bare.headers.location).toBe("/labs/upscale/");
      // (The app's own addresses are the app's still.)
      expect((await app.inject({ url: "/tv", headers: { accept: "text/html" } })).body).toBe("<!doctype html><title>Kino</title>");
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
