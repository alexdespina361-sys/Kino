import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "./app";

let dir: string | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** The app with a built page, a file of the page and a folder of test media, which is every way a file is served. */
async function served(options: AppOptions = {}): Promise<FastifyInstance> {
  dir = await mkdtemp(path.join(tmpdir(), "kino-app-"));
  await mkdir(path.join(dir, "assets"));
  await mkdir(path.join(dir, "media"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
  await writeFile(path.join(dir, "media", "sample.txt"), "film");
  app = await buildApp({ clientDir: dir, fixturesDir: path.join(dir, "media"), ...options });
  return app;
}

describe("what every answer tells the browser", () => {
  const SAFE = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "microphone=(), geolocation=(), payment=(), usb=()",
  };
  const KINDS: Array<[string, InjectOptions]> = [
    ["the page", { url: "/" }],
    ["a file of the page", { url: "/assets/index-abc123.js" }],
    ["a file of the test media", { url: "/fixtures/sample.txt" }],
    ["the page standing in for a path of its own", { url: "/tv", headers: { accept: "text/html" } }],
    ["the headers of the page alone", { method: "HEAD", url: "/" }],
    ["an answer of the api", { url: "/api/health" }],
    ["an answer of a plugin's route", { method: "POST", url: "/api/feedback/check", payload: { keys: [] } }],
    ["a request that cannot be read", { method: "POST", url: "/api/feedback/check", headers: { "content-type": "application/json" }, payload: "{" }],
    ["a route that is not there", { url: "/api/nothing" }],
    ["a file that is not there", { url: "/assets/missing.js" }],
    ["the proxy turning a request away", { url: "/api/proxy" }],
  ];

  it("tells a browser, with a page, a file, a miss or a refusal alike, not to guess, not to tell where it came from, not to be framed and not to ask for what nothing here uses", async () => {
    const site = await served();
    for (const [name, request] of KINDS) {
      const answer = await site.inject(request);
      for (const [header, value] of Object.entries(SAFE)) expect(answer.headers[header], `${name}: ${header}`).toBe(value);
      expect(answer.headers["strict-transport-security"], name).toBeUndefined(); // (this visit was over http)
    }
    // (...and a page the browser already has comes back in a few bytes with them as well)
    const tag = String((await site.inject("/")).headers.etag);
    const kept = await site.inject({ url: "/", headers: { "if-none-match": tag } });
    expect(kept.statusCode).toBe(304);
    for (const [header, value] of Object.entries(SAFE)) expect(kept.headers[header], header).toBe(value);
  });

  it("leaves the camera, full screen, the wake lock and the clipboard to the page, which scans a code and plays a film with them", async () => {
    const policy = String((await (await served()).inject("/")).headers["permissions-policy"]);
    for (const feature of ["camera", "fullscreen", "screen-wake-lock", "clipboard-read", "clipboard-write"]) expect(policy, feature).not.toContain(feature);
  });

  it("tells a browser to come back only over https when the host's proxy says the visit came over https", async () => {
    const site = await served({ trustProxy: 1 });
    for (const [name, request] of KINDS) {
      const answer = await site.inject({ ...request, headers: { ...request.headers, "x-forwarded-proto": "https" } });
      expect(answer.headers["strict-transport-security"], name).toBe("max-age=31536000");
    }
    for (const protocol of ["http", undefined]) {
      const answer = await site.inject({ url: "/", headers: protocol ? { "x-forwarded-proto": protocol } : {} });
      expect(answer.headers["strict-transport-security"], String(protocol)).toBeUndefined();
    }
  });

  it("does not take a visitor's own word for https when nothing in front of the server vouches for it", async () => {
    const site = await served();
    expect((await site.inject({ url: "/", headers: { "x-forwarded-proto": "https" } })).headers["strict-transport-security"]).toBeUndefined();
  });

  it("leaves the proxy's own protection of what comes through it as it is", async () => {
    // (What the proxy passes on goes out under this site's address: it says itself that no script may run in it, and a hook may not weaken that.)
    const answer = await (await served()).inject({ url: "/api/proxy" });
    expect(answer.statusCode).toBe(400);
    expect(answer.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.headers["x-frame-options"]).toBe("DENY");
  });

  it("lets a route that says one of them itself keep its own", async () => {
    const site = await buildApp();
    app = site;
    site.get("/own-policy", async (_request, reply) => reply.header("Referrer-Policy", "same-origin").send("ok"));
    const answer = await site.inject("/own-policy");
    expect(answer.headers["referrer-policy"]).toBe("same-origin");
    expect(answer.headers["x-frame-options"]).toBe("DENY");
  });
});
