import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { buildApp, isDeployed, type AppOptions } from "./app";
import { isOwnOrigin } from "./guard";
import type { ResolveFn } from "./resolvers";

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

describe("how often an address may ask for what makes the server fetch from another site", () => {
  const PAGE = "https://example.com/film";
  /** A resolver that answers at once and keeps what it was asked: what a refused ask must never reach. */
  const resolver = () => {
    const calls: string[] = [];
    const resolve: ResolveFn = async (url) => {
      calls.push(url);
      return { status: "unsupported", reason: "no" };
    };
    return { calls, resolve };
  };
  const codes = async (site: FastifyInstance, requests: InjectOptions[]) => {
    const found: number[] = [];
    for (const request of requests) found.push((await site.inject(request)).statusCode);
    return found;
  };
  const times = (count: number, request: InjectOptions) => Array.from({ length: count }, (): InjectOptions => ({ ...request }));

  it("turns an address away once it has asked more often than it may in a minute, and does not go and fetch for the ask", async () => {
    const { calls, resolve } = resolver();
    const site = await buildApp({ resolve, fetchesPerMinute: { resolve: 3 } });
    app = site;
    const answers: LightMyRequestResponse[] = [];
    for (let n = 1; n <= 5; n++) answers.push(await site.inject(`/api/resolve?url=${PAGE}/${n}`));
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 429, 429]);
    expect(calls).toEqual([`${PAGE}/1`, `${PAGE}/2`, `${PAGE}/3`]);
    // (The same words as every other limit of the site, and the answer is as safe as any other.)
    const refused = answers[3]!;
    expect(refused.json()).toEqual({ error: "rate_limited", retryAfter: expect.any(Number) });
    expect(refused.headers["retry-after"]).toBe(String(refused.json<{ retryAfter: number }>().retryAfter));
    expect(refused.headers["x-content-type-options"]).toBe("nosniff");
    expect(corsHeaders(refused.headers)).toEqual([]);
  });

  it("says how long to wait, lets the address ask again when the minute is over, and does not count the asks it turned away", async () => {
    let now = Date.parse("2026-11-02T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const { resolve } = resolver();
      const site = await buildApp({ resolve, fetchesPerMinute: { resolve: 2 } });
      app = site;
      const ask = () => site.inject(`/api/resolve?url=${PAGE}`);
      expect((await ask()).statusCode).toBe(200);
      now += 10_500;
      expect((await ask()).statusCode).toBe(200);
      const refused = await ask();
      expect([refused.statusCode, refused.headers["retry-after"], refused.json()]).toEqual([429, "50", { error: "rate_limited", retryAfter: 50 }]); // (49.5 seconds to the first ask's end)
      now += 40_000;
      expect((await ask()).statusCode).toBe(429); // (a try that is turned away is no reason to wait longer)
      now += 9_499;
      const nearly = await ask();
      expect([nearly.statusCode, nearly.headers["retry-after"]]).toEqual([429, "1"]);
      now += 1;
      expect((await ask()).statusCode).toBe(200); // (a minute after the first ask, which is the only one that has gone out of the count)
      expect((await ask()).statusCode).toBe(429);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps a count for each address, as the host's proxy says it is, and a visitor's own word about it does not give it another", async () => {
    const { resolve } = resolver();
    const behind = await buildApp({ resolve, trustProxy: 1, fetchesPerMinute: { resolve: 2 } });
    app = behind;
    const from = (address: string): InjectOptions => ({ url: `/api/resolve?url=${PAGE}`, headers: { "x-forwarded-for": address } });
    expect(await codes(behind, [from("198.51.100.7"), from("198.51.100.7"), from("198.51.100.7")])).toEqual([200, 200, 429]);
    expect(await codes(behind, [from("198.51.100.8"), from("198.51.100.8"), from("198.51.100.8")])).toEqual([200, 200, 429]); // (another visitor: its own two)
    expect(await codes(behind, [from("203.0.113.9, 198.51.100.7")])).toEqual([429]); // (the proxy saw 198.51.100.7: what is written before it is not believed)
    // With no proxy in front of the server, a header says nothing at all.
    await behind.close();
    const alone = await buildApp({ resolve, fetchesPerMinute: { resolve: 2 } });
    app = alone;
    expect(await codes(alone, [from("198.51.100.7"), from("198.51.100.8"), from("198.51.100.9")])).toEqual([200, 200, 429]);
  });

  it("counts the library's four questions about a title together, and the rest of what the library answers not at all", async () => {
    const { resolve } = resolver();
    const site = await buildApp({ resolve, fetchesPerMinute: { library: 4, resolve: 1, proxy: 1 }, proxyVideo: false });
    app = site;
    const title = `url=${encodeURIComponent(PAGE)}`;
    const questions = [`/api/library/similar?${title}`, `/api/library/about?${title}`, `/api/library/episodes?${title}&season=1`, `/api/library/seasons?${title}`];
    expect(await codes(site, questions.map((url) => ({ url })))).toEqual([200, 200, 200, 200]);
    // Whichever of them is asked next is the fifth.
    for (const url of questions) expect((await site.inject(url)).statusCode, url).toBe(429);
    // What takes no address of a title is not counted, nor is the rest of the api.
    for (const url of ["/api/library", "/api/library/search?q=a", "/api/library/rows", "/api/library/more?row=a&page=2", "/api/health", "/api/features"]) {
      for (let n = 0; n < 4; n++) expect((await site.inject(url)).statusCode, url).not.toBe(429);
    }
    // (...and a question about a title does not use up the resolver's allowance, nor the other way round.)
    expect((await site.inject(`/api/resolve?url=${encodeURIComponent(PAGE)}`)).statusCode).not.toBe(429);
  });

  it.each([
    ["/api/resolve?url=https://example.com/film", 60, {}],
    ["/api/library/about?url=https://example.com/film", 120, {}],
    ["/api/proxy", 300, { proxyVideo: false }],
  ] as const)("lets an address ask %s %i times in a minute, and not one more, unless it is told otherwise", async (url, may, options: AppOptions) => {
    const { resolve } = resolver();
    const site = await buildApp({ resolve, ...options });
    app = site;
    const found = await codes(site, times(may + 1, { url }));
    expect(found.slice(0, may).filter((code) => code === 429)).toEqual([]);
    expect(found[may]).toBe(429);
  });

  it("does not hold back the proxy while it carries film, which a player asks for one piece after another", async () => {
    const site = await buildApp({ proxyVideo: true, fetchesPerMinute: { proxy: 2 } });
    app = site;
    expect((await codes(site, times(10, { url: "/api/proxy" }))).filter((code) => code === 429)).toEqual([]);
    await site.close();
    const without = await buildApp({ proxyVideo: false, fetchesPerMinute: { proxy: 2 } });
    app = without;
    expect(await codes(without, times(4, { url: "/api/proxy" }))).toEqual([400, 400, 429, 429]); // (the first two reach the proxy itself, which wants an address)
  });

  it("counts a path written another way and a request for the headers alone as the asks they are", async () => {
    const { calls, resolve } = resolver();
    const site = await buildApp({ resolve, fetchesPerMinute: { resolve: 3 } });
    app = site;
    const found = await codes(site, [{ url: `/api/resolve?url=${PAGE}` }, { method: "HEAD", url: `/api/resolve?url=${PAGE}` }, { url: `/%61pi/resolve?url=${PAGE}` }, { url: `/api/resolve?url=${PAGE}` }]);
    expect(found).toEqual([200, 200, 200, 429]);
    expect(calls).toHaveLength(3);
  });

  it("does not count what was turned away for where it came from against the visitor whose browser it was sent from", async () => {
    const { resolve } = resolver();
    const site = await buildApp({ resolve, fetchesPerMinute: { resolve: 2 } });
    app = site;
    const elsewhere = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" };
    expect(await codes(site, times(5, { url: `/api/resolve?url=${PAGE}`, headers: elsewhere }))).toEqual([403, 403, 403, 403, 403]);
    expect(await codes(site, times(3, { url: `/api/resolve?url=${PAGE}`, headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" } }))).toEqual([200, 200, 429]);
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
