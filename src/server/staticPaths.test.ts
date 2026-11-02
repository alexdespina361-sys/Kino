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

const SECRET = "not-for-the-web-0f3a";

/** A built page with a file next to it (outside the folder it is served from) that no address may reach. */
async function site() {
  dir = await mkdtemp(path.join(tmpdir(), "kino-paths-"));
  const client = path.join(dir, "client");
  const fixtures = path.join(dir, "fixtures");
  await mkdir(path.join(client, "assets"), { recursive: true });
  await mkdir(fixtures);
  await writeFile(path.join(dir, "secret.txt"), SECRET);
  await writeFile(path.join(client, "index.html"), "<!doctype html><title>Kino</title>");
  await writeFile(path.join(client, "assets", "index-abc123.js"), "console.log(1)");
  await writeFile(path.join(fixtures, "sample.txt"), "a fixture");
  return buildApp({ clientDir: client, fixturesDir: fixtures });
}

describe("what the static folders give out", () => {
  it("never gives out a file from outside the folder, however the address is written", async () => {
    const app = await site();
    try {
      const ways = [
        "/../secret.txt",
        "/..%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/%2e%2e%2fsecret.txt",
        "/%2E%2E%2Fsecret.txt",
        "/assets/../../secret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/..%5csecret.txt",
        "/assets/..%5c..%5csecret.txt",
        "/%252e%252e/secret.txt",
        "/....//secret.txt",
        "/.%2e/secret.txt",
        "//secret.txt",
        "/fixtures/../../secret.txt",
        "/fixtures/%2e%2e/%2e%2e/secret.txt",
        "/fixtures/..%2f..%2fsecret.txt",
        "/fixtures/..%5c..%5csecret.txt",
        "/assets/index-abc123.js%00.png",
        "/%00/../secret.txt",
      ];
      for (const url of ways) {
        for (const accept of ["*/*", "text/html"]) {
          const answer = await app.inject({ url, headers: { accept } });
          expect(answer.body, `${url} (${accept})`).not.toContain(SECRET);
          // (A page that is not found is the page itself for a browser that asks for a page: that is no file of the disk.)
          expect([200, 400, 403, 404], `${url} (${accept})`).toContain(answer.statusCode);
        }
      }
    } finally {
      await app.close();
    }
  });

  it("gives out what is inside, and not the folder itself nor the files of the project around it", async () => {
    const app = await site();
    try {
      expect((await app.inject({ url: "/assets/index-abc123.js" })).statusCode).toBe(200);
      expect((await app.inject({ url: "/fixtures/sample.txt" })).statusCode).toBe(200);
      for (const url of ["/assets/", "/assets", "/fixtures/", "/package.json", "/src/server/index.ts", "/.env", "/.git/config", "/node_modules/", "/dist/client/index.html"]) {
        const answer = await app.inject({ url });
        expect(answer.statusCode, url).toBe(404);
        expect(answer.body, url).not.toContain("<title>");
      }
    } finally {
      await app.close();
    }
  });
});
