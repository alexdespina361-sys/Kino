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
/** What a browser sends when a person opens a page. */
const page = (agent = PHONE, extra: Record<string, string> = {}) => ({ accept: "text/html,application/xhtml+xml", "user-agent": agent, "accept-language": "ro", "sec-fetch-dest": "document", ...extra });

const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
});

/** A site folder: the page, and a file of the kind Vite names after what is in it. */
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
      visits: { since: "2026-11-01", visitors: { today: 2, week: 2, month: 2 }, loads: { today: 2, week: 2, month: 2 }, addressFrom: { cloudflare: 0, forwarded: 0, connection: 2 } },
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
    expect(body.visits).toBeUndefined(); // (no counter: nothing to tell)
  });
});

describe("counting the people who open the site", () => {
  async function site(options: { trustProxy?: number } = {}) {
    const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const server = await buildApp({ clientDir: await siteFolder(), visits, feedbackAdminToken: TOKEN, ...options });
    const today = () => [...visits.records().days.values()].reduce((sum, each) => ({ visitors: sum.visitors + each.visitors, loads: sum.loads + each.loads }), { visitors: 0, loads: 0 });
    return { server, visits, today };
  }

  it("counts the phone's page and the TV's, a person once however often, and every load", async () => {
    const { server, today } = await site();
    await server.inject({ url: "/", headers: page() });
    await server.inject({ url: "/", headers: page() });
    await server.inject({ url: "/tv", headers: page() });
    await server.inject({ url: "/tv/", headers: page() });
    await server.inject({ url: "/?party=ABCD", headers: page() }); // (a query is still the page)
    expect(today()).toEqual({ visitors: 1, loads: 5 });
    await server.inject({ url: "/", headers: page(LAPTOP) });
    expect(today()).toEqual({ visitors: 2, loads: 6 });
    await server.close();
  });

  it("counts a page the browser already has, which the server answers with a 304", async () => {
    const { server, today } = await site();
    const first = await server.inject({ url: "/", headers: page() });
    expect(first.statusCode).toBe(200);
    const again = await server.inject({ url: "/", headers: page(PHONE, { "if-none-match": String(first.headers.etag) }) });
    expect(again.statusCode).toBe(304);
    expect(today().loads).toBe(2);
    await server.close();
  });

  it("does not count what is not a person opening a page", async () => {
    const { server, today } = await site();
    const refused: Array<[string, { url: string; method?: "GET" | "HEAD" | "POST"; headers?: Record<string, string> }]> = [
      ["a file of the site", { url: "/assets/app-abc123.js", headers: page() }],
      ["the api", { url: "/api/health", headers: page() }],
      ["a path the site does not have (the page answers it all the same)", { url: "/wp-login.php", headers: page() }],
      ["a deeper path", { url: "/tv/anything", headers: page() }],
      ["a request that is not a GET", { url: "/", method: "HEAD", headers: page() }],
      ["something that is not asking for a page", { url: "/", headers: { ...page(), accept: "application/json" } }],
      ["a frame", { url: "/", headers: page(PHONE, { "sec-fetch-dest": "iframe" }) }],
      ["a prefetch", { url: "/", headers: page(PHONE, { "sec-purpose": "prefetch" }) }],
      ["Do Not Track", { url: "/", headers: page(PHONE, { dnt: "1" }) }],
      ["Global Privacy Control", { url: "/", headers: page(PHONE, { "sec-gpc": "1" }) }],
      ["a search engine", { url: "/", headers: page("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)") }],
      ["a link preview", { url: "/", headers: page("WhatsApp/2.23.20 A") }],
      ["a script", { url: "/", headers: page("curl/8.4.0") }],
      ["a headless test browser", { url: "/", headers: page("Mozilla/5.0 HeadlessChrome/156.0 Safari/537.36") }],
      ["a request with no browser named", { url: "/", headers: { accept: "text/html", "user-agent": "" } }],
    ];
    for (const [, request] of refused) await server.inject(request);
    expect(today()).toEqual({ visitors: 0, loads: 0 });
    // and the same page, asked for as a person does, is counted: nothing above was refused for being wrong in some other way
    await server.inject({ url: "/", headers: page() });
    expect(today()).toEqual({ visitors: 1, loads: 1 });
    await server.close();
  });

  it("does not count a page that was not served", async () => {
    const { server, today } = await site();
    await server.inject({ url: "/api/nothing-here", headers: page() });
    await server.inject({ url: "/", method: "POST", headers: page() });
    expect(today()).toEqual({ visitors: 0, loads: 0 });
    await server.close();
  });

  it("tells visitors apart by the address Cloudflare saw when a proxy of the host is in front, and by nothing a visitor can send when there is none", async () => {
    const behind = await site({ trustProxy: 1 });
    await behind.server.inject({ url: "/", headers: page(PHONE, { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }) });
    await behind.server.inject({ url: "/", headers: page(PHONE, { "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "10.0.0.1" }) });
    await behind.server.inject({ url: "/", headers: page(PHONE, { "x-forwarded-for": "198.51.100.5, 10.0.0.1" }) }); // (no Cloudflare: the first address)
    await behind.server.inject({ url: "/", headers: page(PHONE, { "x-forwarded-for": "198.51.100.6, 10.0.0.1" }) });
    expect(behind.today()).toEqual({ visitors: 4, loads: 4 });
    // (and it can be seen where the addresses came from, which is how a host whose proxy gives its own is found out)
    expect(behind.visits.records().sources).toEqual({ cloudflare: 2, forwarded: 2, connection: 0 });
    await behind.server.close();

    const alone = await site();
    await alone.server.inject({ url: "/", headers: page(PHONE, { "cf-connecting-ip": "203.0.113.7" }) });
    await alone.server.inject({ url: "/", headers: page(PHONE, { "cf-connecting-ip": "203.0.113.8" }) });
    expect(alone.today()).toEqual({ visitors: 1, loads: 2 });
    expect(alone.visits.records().sources).toEqual({ cloudflare: 0, forwarded: 0, connection: 2 });
    await alone.server.close();
  });

  it("writes the counts when the server stops, and the owner reads them from the same server", async () => {
    const persistence = new MemoryPersistence();
    const visits = await VisitCounter.open({ persistence }); // (the real delay: only stopping writes it)
    const server = await buildApp({ clientDir: await siteFolder(), visits, feedbackAdminToken: TOKEN });
    await server.inject({ url: "/", headers: page() });
    await server.inject({ url: "/tv", headers: page(LAPTOP) });

    const stats = (await server.inject({ url: "/api/admin/stats?days=1", headers: auth })).json();
    expect(stats.visits.visitors.today).toBe(2);
    expect(stats.days).toEqual([{ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), visitors: 2, loads: 2 }]);
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
