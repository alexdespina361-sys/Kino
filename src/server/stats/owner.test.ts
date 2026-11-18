import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../accounts/persistence";
import { COOKIE } from "../accounts/routes";
import { AccountStore, playedBetween } from "../accounts/store";
import { buildApp } from "../app";
import type { FeedbackStore } from "../feedback/store";
import { LiveCount } from "./live";
import { countLive, originOf, OWNER_STATS, ownerStatsRoutes, type OwnerStatsView } from "./owner";
import { VisitCounter } from "./visits";

const TOKEN = "owner-page-key-of-at-least-24-characters";
const auth = { authorization: `Bearer ${TOKEN}` };
const PAGE = "https://owner.example";
const DAY = 24 * 3600 * 1000;
const at = Date.parse("2026-11-18T10:00:00Z");
const PHONE = "Mozilla/5.0 (Linux; Android 10; K) Chrome/156.0 Mobile Safari/537.36";

/** Reports as the feedback keeps them, as far as the owner's page reads them. */
const reports = (list: Array<{ id: string; createdAt: number; status: string; title: string; kind?: string; area?: string; email?: string; text?: string }>) =>
  ({ list: () => list.map((each) => ({ kind: "bug", area: "tv", ...each })) }) as unknown as FeedbackStore;

async function site(options: { token: string | undefined; origin?: string | undefined } = { token: TOKEN, origin: PAGE }) {
  const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), now: () => at - 2 * DAY, flushMs: 0 });
  accounts.createAccount("first.person@example.com", "hash");
  const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), now: () => at, flushMs: 0 });
  visits.count("203.0.113.7", PHONE, "ro");
  visits.watched(25 * 60);
  visits.watched(5 * 60 + 29);
  const live = new LiveCount(() => at);
  live.seen("203.0.113.7", PHONE, true);
  live.seen("203.0.113.8", PHONE, false);
  live.answered(200);
  live.answered(429);
  const feedback = reports([
    { id: "r1", createdAt: at - 3 * DAY, status: "done", title: "Old and closed", email: "sender@example.com", text: "the words of the report" },
    { id: "r2", createdAt: at - DAY, status: "in_review", title: "x".repeat(200) },
    { id: "r3", createdAt: at - 1000, status: "new", title: "The newest", kind: "idea", area: "phone" },
  ]);
  const server = Fastify();
  await server.register(ownerStatsRoutes, { ...options, accounts, visits, feedback, live, connected: () => ({ tvs: 2, phones: 3 }), maxAccounts: 500, now: () => at });
  return server;
}

describe("the owner's page: its answer", () => {
  it("is not there without a key long enough, and does not answer without it or with another", async () => {
    expect((await (await site({ token: undefined })).inject({ url: OWNER_STATS, headers: auth })).statusCode).toBe(404);
    expect((await (await site({ token: "short" })).inject({ url: OWNER_STATS, headers: { authorization: "Bearer short" } })).statusCode).toBe(404);
    const server = await site();
    expect((await server.inject({ url: OWNER_STATS })).statusCode).toBe(401);
    for (let i = 0; i < 9; i++) expect((await server.inject({ url: OWNER_STATS, headers: { authorization: `Bearer ${TOKEN}${i}` } })).statusCode).toBe(401);
    // (whoever keeps trying is told to wait, as with the team's key)
    expect((await server.inject({ url: OWNER_STATS, headers: auth })).statusCode).toBe(429);
  });

  it("has who is here, the accounts, the visits, the minutes watched, the reports and how the server answered: counts, and nothing that says who", async () => {
    const server = await site();
    const response = await server.inject({ url: `${OWNER_STATS}?days=3`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const view = response.json<OwnerStatsView>();
    expect(view.now).toEqual({ people: 2, signedIn: 1, guests: 1, tvs: 2, phones: 3 });
    expect(view.accounts).toMatchObject({ total: 1, limit: 500, pushDevices: 0 });
    expect(view.accounts!.made).toEqual({ today: 0, week: 1, month: 1 });
    expect(view.visits!.visitors.today).toBe(1);
    expect(view.watched).toEqual({ minutes: { today: 30, week: 30, month: 30 } });
    expect(view.feedback).toMatchObject({ total: 3, open: 2, fresh: 1, received: { today: 1, week: 3, month: 3 } });
    expect(view.feedback!.latest.map((each) => [each.id, each.kind, each.area, each.status])).toEqual([
      ["r3", "idea", "phone", "new"],
      ["r2", "bug", "tv", "in_review"],
      ["r1", "bug", "tv", "done"],
    ]);
    expect(Object.keys(view.feedback!.latest[0]!).sort()).toEqual(["area", "at", "id", "kind", "status"]);
    expect(view.answers).toHaveLength(24);
    expect(view.answers!.at(-1)).toMatchObject({ requests: 2, limited: 1 });
    expect(view.odd).toEqual([]);
    expect(view.days.map((day) => [day.day, day.minutes])).toEqual([
      ["2026-11-16", 0],
      ["2026-11-17", 0],
      ["2026-11-18", 30],
    ]);
    // Not an address of anybody, not the words of a report, not the address the server was asked from.
    expect(response.body).not.toContain("example.com");
    expect(response.body).not.toContain("the words of the report");
    for (const heading of ["Old and closed", "The newest", "xxx"]) expect(response.body).not.toContain(heading);
    expect(response.body).not.toContain("203.0.113");
  });

  it("lists thirty days unless asked, ninety at most", async () => {
    const server = await site();
    expect((await server.inject({ url: OWNER_STATS, headers: auth })).json<OwnerStatsView>().days).toHaveLength(30);
    expect((await server.inject({ url: `${OWNER_STATS}?days=4000`, headers: auth })).json<OwnerStatsView>().days).toHaveLength(90);
    expect((await server.inject({ url: `${OWNER_STATS}?days=nonsense`, headers: auth })).json<OwnerStatsView>().days).toHaveLength(30);
  });
});

describe("the owner's page: in the site", () => {
  it("is part of the site only with a key, counts who is here from then on, and can be asked by the page that is named", async () => {
    const off = await buildApp({});
    expect((await off.inject({ url: OWNER_STATS, headers: auth })).statusCode).toBe(404);
    await off.close();
    const on = await buildApp({ ownerStatsToken: TOKEN, ownerStatsOrigin: PAGE });
    await on.inject({ url: "/api/health", headers: { "user-agent": PHONE } });
    // (a page of another site: the site's own guard against other sites' requests does not turn this one away)
    const response = await on.inject({ url: OWNER_STATS, headers: { ...auth, origin: PAGE, "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(PAGE);
    const view = response.json<OwnerStatsView>();
    expect(view.now).toEqual({ people: 1, signedIn: 0, guests: 1, tvs: 0, phones: 0 });
    expect(view.answers!.at(-1)!.requests).toBe(1); // (the owner's own look is not one of them)
    const asked = await on.inject({ method: "OPTIONS", url: OWNER_STATS, headers: { origin: PAGE, "access-control-request-method": "GET", "access-control-request-headers": "authorization", "sec-fetch-site": "cross-site" } });
    expect(asked.statusCode).toBe(204);
    await on.close();
  });
});

describe("the owner's page: read from another site's page", () => {
  it("lets a browser give the answer to the one page that is named, and to no other", async () => {
    const server = await site();
    const named = await server.inject({ url: OWNER_STATS, headers: { ...auth, origin: PAGE } });
    expect(named.headers["access-control-allow-origin"]).toBe(PAGE);
    expect(named.headers.vary).toContain("Origin");
    const other = await server.inject({ url: OWNER_STATS, headers: { ...auth, origin: "https://other.example" } });
    expect(other.statusCode).toBe(200); // (the key is what keeps the numbers; the browser is what keeps another page from reading them)
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await server.inject({ url: OWNER_STATS, headers: auth })).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers what a browser asks first only for that page, and names no page when none is set", async () => {
    const server = await site();
    const asked = await server.inject({ method: "OPTIONS", url: OWNER_STATS, headers: { origin: PAGE, "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    expect(asked.statusCode).toBe(204);
    expect(asked.headers["access-control-allow-origin"]).toBe(PAGE);
    expect(asked.headers["access-control-allow-headers"]).toBe("Authorization");
    expect(asked.headers["access-control-allow-methods"]).toBe("GET");
    expect((await server.inject({ method: "OPTIONS", url: OWNER_STATS, headers: { origin: "https://other.example" } })).statusCode).toBe(404);
    const closed = await site({ token: TOKEN });
    expect((await closed.inject({ method: "OPTIONS", url: OWNER_STATS, headers: { origin: PAGE } })).statusCode).toBe(404);
    expect((await closed.inject({ url: OWNER_STATS, headers: { ...auth, origin: PAGE } })).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("takes an origin as a browser writes it, and nothing else", () => {
    expect(originOf("https://owner.example")).toBe("https://owner.example");
    expect(originOf(" https://owner.example/ ")).toBe("https://owner.example");
    expect(originOf("http://localhost:5173")).toBe("http://localhost:5173");
    for (const wrong of [undefined, "", "*", "owner.example", "https://owner.example/stats", "https://owner.example?x=1", "ftp://owner.example", "null"]) expect(originOf(wrong), String(wrong)).toBeUndefined();
  });
});

describe("the owner's page: who is counted as here", () => {
  async function counted() {
    const live = new LiveCount(() => at);
    const server = Fastify();
    countLive(server, live);
    server.get("/api/library", async () => ({ ok: true }));
    server.get("/api/refuses", async (_request, reply) => reply.code(403).send({}));
    server.get("/tv", async () => "page");
    server.get("/assets/app.js", async () => "script");
    server.get(OWNER_STATS, async () => ({}));
    return { live, server };
  }

  it("counts a person who asks the site's own api or opens one of its pages, signed in when they bring a session", async () => {
    const { live, server } = await counted();
    await server.inject({ url: "/api/library?x=1", headers: { "user-agent": PHONE }, remoteAddress: "203.0.113.7" });
    await server.inject({ url: "/tv/", headers: { "user-agent": PHONE, cookie: `${COOKIE}=abc` }, remoteAddress: "203.0.113.8" });
    await server.inject({ url: "/api/refuses", headers: { "user-agent": PHONE }, remoteAddress: "203.0.113.7" });
    expect(live.now()).toEqual({ people: 2, signedIn: 1, guests: 1 });
    expect(live.answers(1)[0]).toMatchObject({ requests: 3, refused: 1 });
  });

  it("does not count a file of the page, the owner's own look, a program that says what it is, nor a browser that asks not to be tracked", async () => {
    const { live, server } = await counted();
    await server.inject({ url: "/assets/app.js", headers: { "user-agent": PHONE } });
    await server.inject({ url: OWNER_STATS, headers: { "user-agent": PHONE } });
    expect(live.answers(1)[0]!.requests).toBe(0);
    await server.inject({ url: "/api/library", headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } });
    await server.inject({ url: "/api/library", headers: { "user-agent": "curl/8.4.0" } });
    await server.inject({ url: "/api/library", headers: { "user-agent": "" } });
    await server.inject({ url: "/api/library", headers: { "user-agent": PHONE, dnt: "1" } });
    await server.inject({ url: "/api/library", headers: { "user-agent": PHONE, "sec-gpc": "1" } });
    expect(live.now().people).toBe(0);
    expect(live.answers(1)[0]!.requests).toBe(5); // (the answers are counted: they name nobody)
  });
});

describe("minutes watched", () => {
  const card = (position: number, at: number, extra: Record<string, unknown> = {}) => ({ key: "url:https://x/film", at, title: "Film", url: "https://x/film", position, duration: 6000, ...extra });

  it("is what a film's card moved on by between two writings of it, when that is no more than the time between them", () => {
    expect(playedBetween(card(100, 1000), card(130, 31_000))).toBe(30);
    expect(playedBetween(card(100, 1000), card(160, 31_000))).toBe(60); // (half a minute of slack: the clocks of two screens)
    expect(playedBetween(card(100, 1000), card(900, 31_000))).toBe(0); // (a jump ahead is no watching)
    expect(playedBetween(card(100, 1000), card(40, 31_000))).toBe(0); // (nor is going back)
    expect(playedBetween(card(100, 31_000), card(130, 1000))).toBe(0);
    expect(playedBetween(card(100, 1000), card(130, 31_000, { url: "https://x/other" }))).toBe(0); // (another episode: it begins at its own start)
    expect(playedBetween(card(100, 1000), { key: "url:https://x/film", at: 31_000, deleted: true })).toBe(0);
    expect(playedBetween({ key: "k", at: 1 }, { key: "k", at: 2 })).toBe(0);
  });

  it("is told as a profile's progress comes in: seconds only, a film's first card none, and never faster than time goes", async () => {
    let clock = at;
    const store = await AccountStore.open({ persistence: new MemoryPersistence(), now: () => clock, flushMs: 0 });
    const created = store.createAccount("alex.popescu@example.com", "hash");
    if (!created.ok) throw new Error("could not create");
    const profile = store.profilesOf(created.value.id)[0]!;
    const told: number[] = [];
    store.onWatched((seconds) => told.push(seconds));
    store.sync(profile.id, { since: 0, progress: [card(0, clock)] });
    expect(told).toEqual([]);
    clock += 30_000;
    store.sync(profile.id, { since: 0, progress: [card(30, clock)] });
    expect(told).toEqual([30]);
    // A screen that says it played an hour in the next ten seconds is not believed at all (a jump ahead is no watching)...
    clock += 10_000;
    store.sync(profile.id, { since: 0, progress: [card(3630, clock)] });
    expect(told).toEqual([30]);
    // ...and one whose clock is set as far ahead as the server lets a card be, to pass for more, is believed for the time that went by here and a minute's slack.
    const other = (position: number, when: number) => ({ ...card(position, when), key: "url:https://x/other", url: "https://x/other" });
    store.sync(profile.id, { since: 0, progress: [other(0, clock - 40_000)] });
    clock += 10_000;
    store.sync(profile.id, { since: 0, progress: [other(100, clock + 60_000)] });
    expect(told).toEqual([30, 80]);
    // The same card again adds nothing.
    store.sync(profile.id, { since: 0, progress: [other(100, clock + 60_000)] });
    expect(told).toHaveLength(2);
  });

  it("is added up for the day with the visits, and is still there after a restart", async () => {
    const persistence = new MemoryPersistence();
    const visits = await VisitCounter.open({ persistence, now: () => at, flushMs: 0 });
    visits.watched(90);
    visits.watched(45.4);
    visits.watched(-5);
    visits.watched(Number.NaN);
    expect(visits.records().days.get("2026-11-18")).toEqual({ visitors: 0, loads: 0, watched: 135 });
    await visits.flush();
    const again = await VisitCounter.open({ persistence, now: () => at, flushMs: 0 });
    expect(again.records().days.get("2026-11-18")?.watched).toBe(135);
  });
});
