import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { buildApp, isDeployed, type AppOptions } from "./app";
import { isOwnOrigin } from "./guard";

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

/** The app with accounts that are kept in memory, as the tests of the account routes have it. */
async function withAccounts(options: AppOptions = {}): Promise<FastifyInstance> {
  const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  app = await buildApp({ accounts, passwordCost: { N: 1024, r: 8, p: 1 }, ...options });
  return app;
}

const corsHeaders = (headers: Record<string, unknown>) => Object.keys(headers).filter((name) => name.startsWith("access-control-"));

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

describe("where a request to the api comes from", () => {
  const HOST = "kino.24-7.ro";
  const sentTo = (site: FastifyInstance, method: "GET" | "HEAD" | "POST" | "OPTIONS", url: string, headers: Record<string, string> = {}) => site.inject({ method, url, headers: { host: HOST, ...headers } });

  it("turns away what changes something when the browser says it comes from another site, or from another name of this one", async () => {
    const site = await withAccounts();
    const registered = await site.inject({ method: "POST", url: "/api/auth/register", payload: { email: "alex@example.com", password: "correct horse" } });
    const cookie = String(registered.headers["set-cookie"]).split(";")[0]!;
    // A TV waits for a phone to approve its code; the approval needs no body, only the visitor's cookie, and that goes along with a page of any name of the site.
    const { code, secret } = (await site.inject({ method: "POST", url: "/api/link/start", payload: { device: "tv" } })).json<{ code: string; secret: string }>();
    const approve = (headers: Record<string, string>) => sentTo(site, "POST", `/api/link/${code}/approve`, { cookie, ...headers });
    const waiting = async () => (await site.inject({ method: "POST", url: "/api/link/poll", payload: { code, secret } })).json<{ status: string }>().status;

    const foreign: Record<string, Record<string, string>> = {
      "another site": { "sec-fetch-site": "cross-site" },
      "another name of this site": { "sec-fetch-site": "same-site" },
      "a page of a sibling name, as a browser words it": { "sec-fetch-site": "same-site", origin: "https://evil.24-7.ro" },
      "an older browser, from another site": { origin: "https://other.example" },
      "an older browser, from another name of this site": { origin: "https://evil.24-7.ro" },
      "a name that only ends like this one": { origin: "https://evil-kino.24-7.ro" },
      "this name at another port": { origin: `https://${HOST}:8443` },
      "a page with no origin of its own": { origin: "null" },
    };
    for (const [name, headers] of Object.entries(foreign)) {
      const answer = await approve(headers);
      expect([answer.statusCode, answer.json()], name).toEqual([403, { error: "cross_site" }]);
    }
    expect(await waiting()).toBe("waiting"); // (none of them approved it)
    expect((await approve({ "sec-fetch-site": "same-origin", origin: `https://${HOST}` })).statusCode).toBe(204);
    expect(await waiting()).toBe("approved");
  });

  it("lets a request through that comes from this very site, at whatever address and port it is served, and one that says nothing of where it comes from", async () => {
    const site = await withAccounts();
    const sends: Record<string, Record<string, string>> = {
      "a page of this site": { host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin" },
      "a page of the site's other address": { host: "kino4tv.com", origin: "https://kino4tv.com", "sec-fetch-site": "same-origin" },
      "a page on this machine, with its port": { host: "127.0.0.1:8788", origin: "http://127.0.0.1:8788", "sec-fetch-site": "same-origin" },
      "a page on this machine, by an address in brackets": { host: "[::1]:8788", origin: "http://[::1]:8788" },
      "an origin that leaves out the port the host spells": { host: `${HOST}:443`, origin: `https://${HOST}` },
      "a host in other letters": { host: "KINO.24-7.RO", origin: `https://${HOST}` },
      "an address that was typed": { host: HOST, "sec-fetch-site": "none" },
      "a script, or an old browser, that says nothing of it": { host: HOST },
    };
    for (const [name, headers] of Object.entries(sends)) {
      expect((await site.inject({ method: "POST", url: "/api/auth/logout", headers })).statusCode, name).toBe(204);
    }
  });

  it("looks at the route that answers and not at how its path was written", async () => {
    const site = await withAccounts();
    const answer = await sentTo(site, "POST", "/%61pi/auth/logout", { "sec-fetch-site": "cross-site" });
    expect(answer.statusCode).toBe(403);
  });

  it("leaves what only reads alone, whoever asks, and gives no other site leave to read it either", async () => {
    const site = await withAccounts();
    site.options("/api/preflight", async (_request, reply) => reply.code(204).send()); // (nothing in the api answers one; a question before a request is no change either)
    const foreign = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin: "https://other.example" };
    for (const url of ["/api/health", "/api/me", "/api/features"]) {
      const answer = await sentTo(site, "GET", url, foreign);
      expect(answer.statusCode, url).toBe(200);
      expect(corsHeaders(answer.headers), url).toEqual([]);
    }
    expect((await sentTo(site, "HEAD", "/api/health", foreign)).statusCode).toBe(200);
    expect((await sentTo(site, "OPTIONS", "/api/preflight", foreign)).statusCode).toBe(204);
  });

  it.each(["/api/proxy", "/api/resolve"])("turns away a page of another site that would have %s fetch for it, but not a visitor who follows a link there", async (url) => {
    const site = await buildApp();
    app = site;
    const asked = async (method: "GET" | "HEAD", headers: Record<string, string>) => (await sentTo(site, method, url, headers)).statusCode;
    const refused: Record<string, Record<string, string>> = {
      "a script of another site": { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
      "a picture or a film of another site": { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" },
      "a script of a sibling name": { "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" },
      "another site that does not say how": { "sec-fetch-site": "cross-site" },
    };
    for (const [name, headers] of Object.entries(refused)) expect(await asked("GET", headers), name).toBe(403);
    expect(await asked("HEAD", refused["a script of another site"]!)).toBe(403);
    // (Without an address to go to the answer is a 400 of the route's own: the request was let in.)
    const allowed: Record<string, Record<string, string>> = {
      "a link from another site": { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
      "a link from a sibling name": { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" },
      "a page of this site": { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
      "an address that was typed": { "sec-fetch-site": "none", "sec-fetch-mode": "navigate" },
      "a script, or an old browser, that says nothing of it": {},
    };
    for (const [name, headers] of Object.entries(allowed)) expect(await asked("GET", headers), name).toBe(400);
    expect(await asked("HEAD", allowed["a link from another site"]!)).toBe(400);
  });

  it("gives no website leave to read the proxy: a preflight is not answered and no answer has a CORS header", async () => {
    const site = await buildApp();
    app = site;
    const preflight = await sentTo(site, "OPTIONS", "/api/proxy", { origin: "https://other.example", "access-control-request-method": "GET" });
    expect(preflight.statusCode).toBe(404);
    expect(corsHeaders(preflight.headers)).toEqual([]);
    const answer = await sentTo(site, "GET", "/api/proxy", { origin: "https://other.example" });
    expect(answer.statusCode).toBe(400);
    expect(corsHeaders(answer.headers)).toEqual([]);
  });
});

describe("isDeployed", () => {
  it.each([
    [{}, false],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "test" }, false],
    [{ RENDER: "" }, false],
    [{ RENDER: "true" }, true],
    [{ NODE_ENV: "production" }, true],
    [{ RENDER: "true", NODE_ENV: "development" }, true],
  ])("%j: %s", (env, deployed) => {
    expect(isDeployed(env)).toBe(deployed);
  });
});

describe("isOwnOrigin", () => {
  it.each([
    ["https://kino.24-7.ro", "kino.24-7.ro", true],
    ["http://127.0.0.1:8788", "127.0.0.1:8788", true],
    ["http://[::1]:8788", "[::1]:8788", true],
    ["https://kino.24-7.ro", "kino.24-7.ro:443", true],
    ["https://KINO.24-7.RO", "kino.24-7.ro", true],
    ["https://evil.24-7.ro", "kino.24-7.ro", false],
    ["https://kino.24-7.ro.evil.example", "kino.24-7.ro", false],
    ["https://kino.24-7.ro@evil.example", "kino.24-7.ro", false],
    ["http://127.0.0.1:9999", "127.0.0.1:8788", false],
    ["https://kino.24-7.ro:8443", "kino.24-7.ro", false],
    ["null", "kino.24-7.ro", false],
    ["", "kino.24-7.ro", false],
    ["not an address", "kino.24-7.ro", false],
    ["https://kino.24-7.ro", undefined, false],
    ["https://kino.24-7.ro", "", false],
    ["https://kino.24-7.ro", "not a host", false],
  ])("%j sent to %j: %s", (origin, host, own) => {
    expect(isOwnOrigin(origin, host)).toBe(own);
  });
});
