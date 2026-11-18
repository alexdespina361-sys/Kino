import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../accounts/persistence";
import { AccountStore } from "../accounts/store";
import { buildApp } from "../app";
import { statsRoutes } from "./routes";
import { VisitCounter } from "./visits";

const TOKEN = "stats-token-of-at-least-24-characters";
const auth = { authorization: `Bearer ${TOKEN}` };
const DAY = 24 * 3600 * 1000;
const at = Date.parse("2026-11-01T10:00:00Z");

const PHONE = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/156.0 Mobile Safari/537.36";
const LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36";
const page = (agent = PHONE, extra: Record<string, string> = {}) => ({ accept: "text/html,application/xhtml+xml", "user-agent": agent, "accept-language": "ro", "sec-fetch-dest": "document", ...extra });

const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
});

async function siteFolder() {
  const dir = await mkdtemp(path.join(tmpdir(), "kino-stats-"));
  folders.push(dir);
  await mkdir(path.join(dir, "assets"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Kino</title>");
  await writeFile(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  return dir;
}

describe("the owner's stats", () => {
  async function app(adminToken: string | null = TOKEN) {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), now: () => at - 2 * DAY, flushMs: 0 });
    accounts.createAccount("first.person@example.com", "hash");
    const second = accounts.createAccount("second.person@example.com", "hash");
    if (!second.ok) throw new Error("could not create");
    accounts.createSession(second.value.id, "browser", "Chrome");
    const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), now: () => at, flushMs: 0 });
    visits.count("203.0.113.7", PHONE, "ro");
    visits.count("203.0.113.8", PHONE, "ro");
    const server = Fastify();
    await server.register(statsRoutes, { adminToken: adminToken ?? undefined, accounts, visits, maxAccounts: 3, now: () => at });
    return server;
  }

  it("has no such address while the team has no token", async () => {
    const server = await app(null);
    expect((await server.inject({ url: "/api/admin/stats", headers: auth })).statusCode).toBe(404);
    const short = await app("too-short");
    expect((await short.inject({ url: "/api/admin/stats", headers: { authorization: "Bearer too-short" } })).statusCode).toBe(404);
  });

  it("does not answer without the token, or with another, and slows down whoever keeps trying", async () => {
    const server = await app();
    expect((await server.inject({ url: "/api/admin/stats" })).statusCode).toBe(401);
    for (let i = 0; i < 9; i++) expect((await server.inject({ url: "/api/admin/stats", headers: { authorization: `Bearer ${TOKEN}x${i}` } })).statusCode).toBe(401);
    const blocked = await server.inject({ url: "/api/admin/stats", headers: auth });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("answers the owner with the counts, and keeps them out of any cache", async () => {
    const server = await app();
    const response = await server.inject({ url: "/api/admin/stats?days=3", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      at,
      zone: "UTC",
      accounts: {
        total: 2,
        profiles: 2,
        limit: 3,
        signUps: "open",
        made: { today: 0, week: 2, month: 2 },
        used: { today: 0, week: 1, month: 1 },
        devices: { browser: 1 },
      },
      visits: { since: "2026-11-01", visitors: { today: 2, week: 2, month: 2 }, loads: { today: 2, week: 2, month: 2 } },
      you: { address: "127.0.0.1", connection: "127.0.0.1", forwardedFor: null, cloudflare: null },
      days: [
        { day: "2026-10-30", newAccounts: 2, accounts: 2, visitors: 0, loads: 0 },
        { day: "2026-10-31", newAccounts: 0, accounts: 2, visitors: 0, loads: 0 },
        { day: "2026-11-01", newAccounts: 0, accounts: 2, visitors: 2, loads: 2 },
      ],
    });
    expect(response.body).not.toMatch(/example\.com|203\.0\.113|hash|Android/);
  });

  it("lists thirty days unless asked, and no more than 400", async () => {
    const server = await app();
    expect((await server.inject({ url: "/api/admin/stats", headers: auth })).json().days).toHaveLength(30);
    expect((await server.inject({ url: "/api/admin/stats?days=nonsense", headers: auth })).json().days).toHaveLength(30);
    expect((await server.inject({ url: "/api/admin/stats?days=99999", headers: auth })).json().days).toHaveLength(400);
    expect((await server.inject({ url: "/api/admin/stats?days=0", headers: auth })).json().days).toHaveLength(30);
    expect((await server.inject({ url: "/api/admin/stats?days=1", headers: auth })).json().days).toHaveLength(1);
  });

  it("says sign-ups are closed once there are as many accounts as are allowed", async () => {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), now: () => at, flushMs: 0 });
    accounts.createAccount("one@example.com", "hash");
    accounts.createAccount("two@example.com", "hash");
    const server = Fastify();
    await server.register(statsRoutes, { adminToken: TOKEN, accounts, maxAccounts: 2, now: () => at });
    const body = (await server.inject({ url: "/api/admin/stats", headers: auth })).json();
    expect(body.accounts).toMatchObject({ total: 2, limit: 2, signUps: "closed" });
    expect(body.visits).toBeUndefined();
  });
});

describe("counting the people who open the site", () => {
  const asks = (agent = PHONE, extra: Record<string, string> = {}) => ({ accept: "*/*", "user-agent": agent, "accept-language": "ro", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", ...extra });
  const ME = "/api/me";

  async function site(options: { trustProxy?: number } = {}) {
    const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const server = await buildApp({ clientDir: await siteFolder(), visits, accounts, feedbackAdminToken: TOKEN, ...options });
    const today = () => [...visits.records().days.values()].reduce((sum, each) => ({ visitors: sum.visitors + each.visitors, loads: sum.loads + each.loads }), { visitors: 0, loads: 0 });
    return { server, visits, today };
  }

  it("counts a browser in which the page started: a person once however often, and every start", async () => {
    const { server, today } = await site();
    expect((await server.inject({ url: ME, headers: asks() })).statusCode).toBe(200);
    await server.inject({ url: ME, headers: asks() });
    await server.inject({ url: `${ME}?x=1`, headers: asks() });
    expect(today()).toEqual({ visitors: 1, loads: 3 });
    await server.inject({ url: ME, headers: asks(LAPTOP) });
    expect(today()).toEqual({ visitors: 2, loads: 4 });
    await server.inject({ url: ME, headers: { "user-agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4) AppleWebKit/538.1 TV Safari/538.1", "accept-language": "ro" } });
    expect(today()).toEqual({ visitors: 3, loads: 5 });
    await server.close();
  });

  it("does not count a program that fetches the page and runs nothing, whatever browser it says it is", async () => {
    const { server, today } = await site();
    for (const url of ["/", "/tv", "/tv/", "/?party=ABCD"]) {
      const answer = await server.inject({ url, headers: page() });
      expect(answer.statusCode, url).toBe(200);
      await server.inject({ url, headers: page(PHONE, { "if-none-match": String(answer.headers.etag) }) });
    }
    expect(today()).toEqual({ visitors: 0, loads: 0 });
    await server.close();
  });

  it("does not count what is not the site's own page asking", async () => {
    const { server, today } = await site();
    const refused: Array<[string, { url: string; method?: "GET" | "HEAD" | "POST"; headers?: Record<string, string> }]> = [
      ["a file of the site", { url: "/assets/app-abc123.js", headers: asks() }],
      ["another question of the api", { url: "/api/health", headers: asks() }],
      ["a path the site does not have (the page answers it all the same)", { url: "/wp-login.php", headers: page() }],
      ["a deeper path", { url: "/api/me/anything", headers: asks() }],
      ["the notice about the count", { url: "/privacy.html", headers: page() }],
      ["a request that is not a GET", { url: ME, method: "HEAD", headers: asks() }],
      ["the question typed as an address", { url: ME, headers: page(PHONE, { "sec-fetch-site": "none" }) }],
      ["the question from another site's page", { url: ME, headers: asks(PHONE, { "sec-fetch-site": "cross-site" }) }],
      ["the question from a page of a sister address", { url: ME, headers: asks(PHONE, { "sec-fetch-site": "same-site" }) }],
      ["the question as a picture or a frame", { url: ME, headers: asks(PHONE, { "sec-fetch-dest": "image" }) }],
      ["Do Not Track", { url: ME, headers: asks(PHONE, { dnt: "1" }) }],
      ["Global Privacy Control", { url: ME, headers: asks(PHONE, { "sec-gpc": "1" }) }],
      ["a search engine", { url: ME, headers: asks("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)") }],
      ["a link preview", { url: ME, headers: asks("WhatsApp/2.23.20 A") }],
      ["a script", { url: ME, headers: asks("curl/8.4.0") }],
      ["a headless test browser", { url: ME, headers: asks("Mozilla/5.0 HeadlessChrome/156.0 Safari/537.36") }],
      ["a request with no browser named", { url: ME, headers: { accept: "*/*", "user-agent": "" } }],
    ];
    for (const [, request] of refused) await server.inject(request);
    expect(today()).toEqual({ visitors: 0, loads: 0 });
    await server.inject({ url: ME, headers: asks() });
    expect(today()).toEqual({ visitors: 1, loads: 1 });
    await server.close();
  });

  it("does not count a question that was not answered", async () => {
    const { server, today } = await site();
    await server.inject({ url: "/api/nothing-here", headers: asks() });
    await server.inject({ url: ME, method: "POST", headers: asks() });
    expect(today()).toEqual({ visitors: 0, loads: 0 });
    await server.close();
  });

  it("tells visitors apart by the address behind Cloudflare and the host's proxy, and by nothing a visitor can send when there is no proxy", async () => {
    const behind = await site({ trustProxy: 1 });
    await behind.server.inject({ url: ME, headers: asks(PHONE, { "x-forwarded-for": "203.0.113.7, 172.70.1.2" }) });
    await behind.server.inject({ url: ME, headers: asks(PHONE, { "x-forwarded-for": "203.0.113.8, 172.70.1.2" }) });
    await behind.server.inject({ url: ME, headers: asks(PHONE, { "x-forwarded-for": "203.0.113.8, 172.70.1.2" }) });
    expect(behind.today()).toEqual({ visitors: 2, loads: 3 });
    await behind.server.close();

    const alone = await site();
    await alone.server.inject({ url: ME, headers: asks(PHONE, { "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "203.0.113.7" }) });
    await alone.server.inject({ url: ME, headers: asks(PHONE, { "x-forwarded-for": "203.0.113.8", "cf-connecting-ip": "203.0.113.8" }) });
    expect(alone.today()).toEqual({ visitors: 1, loads: 2 });
    await alone.server.close();
  });

  it("writes the counts when the server stops, and the owner reads them from the same server", async () => {
    const persistence = new MemoryPersistence();
    const visits = await VisitCounter.open({ persistence });
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const server = await buildApp({ clientDir: await siteFolder(), visits, accounts, feedbackAdminToken: TOKEN });
    await server.inject({ url: ME, headers: asks() });
    await server.inject({ url: ME, headers: asks(LAPTOP) });

    const stats = (await server.inject({ url: "/api/admin/stats?days=1", headers: auth })).json();
    expect(stats.visits.visitors.today).toBe(2);
    expect(stats.days).toEqual([{ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), newAccounts: 0, accounts: 0, visitors: 2, loads: 2 }]);
    expect(persistence.docs.size).toBe(0);
    await server.close();
    expect([...persistence.docs.keys()].map((key) => key.split(":")[0]).sort()).toEqual(["seen", "visits"]);
  });

  it("counts nobody when no counter is given, and the owner's address is not found without the team's token", async () => {
    const server = await buildApp({ clientDir: await siteFolder() });
    expect((await server.inject({ url: "/", headers: page() })).statusCode).toBe(200);
    expect((await server.inject({ url: "/api/admin/stats", headers: auth })).statusCode).toBe(404);
    await server.close();
  });
});
describe("which address a request is read as", () => {
  const HOST_PROXY = "10.8.0.4";

  async function addressOf(headers: Record<string, string>, trustProxy?: number) {
    const server = await buildApp({ feedbackAdminToken: TOKEN, ...(trustProxy === undefined ? {} : { trustProxy }) });
    const response = await server.inject({ url: "/api/admin/stats", headers: { ...auth, ...headers }, remoteAddress: HOST_PROXY });
    await server.close();
    expect(response.statusCode).toBe(200);
    return response.json().you;
  }

  it("is the visitor's, behind the host's proxy alone, behind Cloudflare too, and behind two Cloudflare machines or a proxy inside the host", async () => {
    expect(await addressOf({ "x-forwarded-for": "203.0.113.9" }, 1)).toMatchObject({ address: "203.0.113.9", connection: HOST_PROXY });
    expect((await addressOf({ "x-forwarded-for": "203.0.113.9, 172.70.1.2" }, 1)).address).toBe("203.0.113.9");
    expect((await addressOf({ "x-forwarded-for": "203.0.113.9, 172.70.1.2, 104.16.0.3" }, 1)).address).toBe("203.0.113.9");
    expect((await addressOf({ "x-forwarded-for": "203.0.113.9, 172.70.1.2, 10.9.9.9" }, 1)).address).toBe("203.0.113.9");
    expect((await addressOf({ "x-forwarded-for": "2a02:2f0e:1::7, 2606:4700::6810:1" }, 1)).address).toBe("2a02:2f0e:1:0::");
    expect((await addressOf({ "x-forwarded-for": "2a02:2f0e:1:9:8:7:6:5" }, 1)).address).toBe("2a02:2f0e:1:9::");
  });

  it("falls back to Cloudflare's own address when that is all the list has (the visitor is missing from it: as it was read before)", async () => {
    expect((await addressOf({ "x-forwarded-for": "172.70.1.2" }, 1)).address).toBe("172.70.1.2");
  });

  it("is never one a visitor wrote: what comes before the proxies' own addresses is not read", async () => {
    expect((await addressOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 172.70.1.2" }, 1)).address).toBe("203.0.113.9");
    expect((await addressOf({ "x-forwarded-for": "6.6.6.6, 173.245.48.1, 198.51.100.7" }, 1)).address).toBe("198.51.100.7");
    expect((await addressOf({ "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "6.6.6.6" }, 1)).address).toBe("198.51.100.7");
  });

  it("is the connection's own when no proxy is said to be in front, however it is written", async () => {
    expect((await addressOf({ "x-forwarded-for": "203.0.113.9, 172.70.1.2" })).address).toBe(HOST_PROXY);
    expect((await addressOf({ "x-forwarded-for": "203.0.113.9" }, 0)).address).toBe(HOST_PROXY);
  });

  it("shows how it was read, which is how a host whose proxies give their own address is found out", async () => {
    expect(await addressOf({ "x-forwarded-for": "203.0.113.9, 172.70.1.2", "cf-connecting-ip": "203.0.113.9" }, 1)).toEqual({
      address: "203.0.113.9",
      connection: HOST_PROXY,
      forwardedFor: "203.0.113.9, 172.70.1.2",
      cloudflare: "203.0.113.9",
    });
  });
});
