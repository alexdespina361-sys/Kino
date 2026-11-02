import http from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * A built page with a file next to it (outside the folder it is served from) that no address may reach, listening on a port of its own: an address is written
 * as given only over a socket (`app.inject`, like any URL parser, tidies `..` away before the app sees it, and then it proves nothing about the app).
 */
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
  const app = await buildApp({ clientDir: client, fixturesDir: fixtures });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, port: (app.server.address() as AddressInfo).port };
}

/** One GET, with the address written exactly as given. */
function get(port: number, address: string, accept = "*/*"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: address, headers: { accept } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

describe("what the static folders give out", () => {
  it("never gives out a file from outside the folder, however the address is written", async () => {
    const { app, port } = await site();
    try {
      // (The file is really served at the address it has, so a 404 below says something.)
      expect(await get(port, "/assets/index-abc123.js")).toEqual({ status: 200, body: "console.log(1)" });
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
        "/..\\secret.txt",
        "/assets/..\\..\\secret.txt",
        "/fixtures/..\\..\\secret.txt",
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
        "/..;/secret.txt",
        "/%u002e%u002e/secret.txt",
        "/..%c0%af..%c0%afsecret.txt",
        "/%ef%bc%8e%ef%bc%8e/secret.txt",
        "/assets/index-abc123.js::$DATA",
        "/assets/index-abc123.js.",
        "/assets/index-abc123.js%20",
        "/secret.txt?/../..",
        "/assets/..%2f..%2fsecret.txt?x=1",
      ];
      for (const url of ways) {
        for (const accept of ["*/*", "text/html"]) {
          const answer = await get(port, url, accept);
          expect(answer.body, `${url} (${accept})`).not.toContain(SECRET);
          // (A page that is not found is the page itself for a browser that asks for a page: that is no file of the disk.)
          expect([200, 400, 403, 404], `${url} (${accept})`).toContain(answer.status);
        }
      }
    } finally {
      await app.close();
    }
  });

  it("gives out what is inside, and not the folder itself nor the files of the project around it", async () => {
    const { app, port } = await site();
    try {
      expect((await get(port, "/assets/index-abc123.js")).status).toBe(200);
      expect((await get(port, "/fixtures/sample.txt")).status).toBe(200);
      for (const url of ["/assets/", "/assets", "/fixtures/", "/package.json", "/src/server/index.ts", "/.env", "/.git/config", "/node_modules/", "/dist/client/index.html"]) {
        const answer = await get(port, url);
        expect(answer.status, url).toBe(404);
        expect(answer.body, url).not.toContain("<title>");
      }
    } finally {
      await app.close();
    }
  });
});
