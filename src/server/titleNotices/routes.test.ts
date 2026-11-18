import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { TitleNoticesSchema } from "../../shared";
import { MemoryPersistence } from "../accounts/persistence";
import { COOKIE, readCookie } from "../accounts/routes";
import { AccountStore } from "../accounts/store";
import { PushHub } from "../push/push";
import type { PushMessage, PushSender } from "../push/fcm";
import { TitleNoticeBook } from "./book";
import { followersOf } from "./followers";
import { titleNoticeRoutes } from "./routes";
import type { ShowNow, TitleSource } from "./source";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const DAY = 24 * 60 * 60 * 1000;

async function start({ withBook = true }: { withBook?: boolean } = {}) {
  const clock = { now: Date.parse("2026-11-10T12:00:00Z") };
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  const shows = new Map<number, ShowNow>();
  const source: TitleSource = { show: async (id) => shows.get(id) ?? null, film: async () => null, parts: async () => null, outAtHome: async () => false };
  const sent: PushMessage[] = [];
  const sender: PushSender = {
    send: async (message) => {
      sent.push(message);
      return "sent";
    },
  };
  const hub = new PushHub(store, sender);
  const book = await TitleNoticeBook.open({ persistence: new MemoryPersistence(), source, followers: () => followersOf(store), now: () => clock.now, flushMs: 0 });
  book.onTell((profile) => void hub.titleNotice(profile));
  const app = Fastify();
  apps.push(app);
  titleNoticeRoutes(
    app,
    {
      store,
      authenticate: (request: FastifyRequest) => {
        const token = readCookie(request.headers.cookie, COOKIE);
        const session = token ? store.getSession(token) : undefined;
        return session ? { accountId: session.accountId } : undefined;
      },
      signedOut: (reply: FastifyReply) => reply.code(401).send({ error: "signed_out" }),
      tooMany: (reply: FastifyReply, waitMs: number) => reply.code(429).send({ error: "rate_limited", retryAfter: Math.ceil(waitMs / 1000) }),
      invalid: (reply: FastifyReply) => reply.code(400).send({ error: "invalid_request" }),
      refused: (reply: FastifyReply, error) => reply.code(error === "not_found" ? 404 : 409).send({ error }),
    },
    withBook ? book : undefined,
  );
  await app.ready();

  const person = (login: string) => {
    const account = store.createAccount(login, "x");
    if (!account.ok) throw new Error("could not make the account");
    const profile = account.value.profiles[0]!;
    const session = store.createSession(account.value.id, "remote", "test");
    const url = `/api/profiles/${profile.id}/title-notices`;
    const call = async (method: "GET" | "POST", path = "", payload?: object) => {
      const response = await app.inject({ method, url: `${url}${path}`, headers: { cookie: `${COOKIE}=${session.token}` }, ...(payload ? { payload } : {}) });
      return { status: response.statusCode, items: response.statusCode === 200 ? TitleNoticesSchema.parse(response.json()).items : [] };
    };
    return { id: profile.id, sessionId: session.session.id, url, call };
  };
  const watches = (profileId: string, link: string, more: object = {}) =>
    store.sync(profileId, { since: 0, progress: [{ key: `url:${link}`, at: clock.now, title: "A Show", url: link, position: 100, duration: 1000, ...more }] });
  return { app, store, book, hub, clock, shows, sent, person, watches };
}

describe("who watches what, as the accounts have it", () => {
  it("is each profile's cards and ratings of titles the library numbers, the newest first, each title once", async () => {
    const { store, clock, person, watches } = await start();
    const ana = person("ana");
    watches(ana.id, "https://filmpire.sc/watch/7?s=2&e=3", { season: 2, episode: 3 });
    clock.now += 1000;
    watches(ana.id, "https://filmpire.sc/watch/603");
    clock.now += 1000;
    watches(ana.id, "https://somewhere.example/video.mp4");
    store.sync(ana.id, { since: 0, ratings: [{ key: "rate:x", at: clock.now, title: "Rated", url: "https://filmpire.sc/watch/9?s=1&e=1", score: 8, ratedAt: clock.now }] });
    store.sync(ana.id, { since: 0, list: [{ key: "url:https://filmpire.sc/watch/55", at: clock.now, id: "x", title: "Saved", url: "https://filmpire.sc/watch/55" }] });

    expect(followersOf(store)).toEqual([{ profile: ana.id, on: true, child: false, titles: [{ key: "tv-9", title: "Rated" }, { key: "movie-603", title: "A Show" }, { key: "tv-7", title: "A Show" }] }]);

    clock.now += 1000;
    store.sync(ana.id, { since: 0, progress: [{ key: "url:https://filmpire.sc/watch/603", at: clock.now, deleted: true }], settings: [{ key: "titleNotices", at: clock.now, value: false }, { key: "child", at: clock.now, value: true }] });
    expect(followersOf(store)).toMatchObject([{ on: false, child: true, titles: [{ key: "tv-9" }, { key: "tv-7" }] }]);
  });
});

describe("the notices, asked for by a screen", () => {
  it("are the profile's own: read, looked at, cleared, by the account that has the profile and nobody else", async () => {
    const { app, book, hub, clock, shows, sent, store, person, watches } = await start();
    const ana = person("ana");
    const bob = person("bob");
    expect(store.setPush(ana.sessionId, "ana-phone-token-0000000000", ana.id)).toBe(true);
    watches(ana.id, "https://filmpire.sc/watch/7?s=1&e=5", { season: 1, episode: 5 });
    shows.set(7, { name: "The Show", ended: false, last: { season: 1, episode: 5, day: "2026-11-01" } });
    await book.look();
    expect((await ana.call("GET")).items).toEqual([]);

    clock.now += 2 * DAY;
    shows.set(7, { name: "The Show", ended: false, last: { season: 1, episode: 6, day: "2026-11-09" } });
    await book.look();
    expect((await ana.call("GET")).items).toMatchObject([{ id: "tv-7", what: "episode", title: "The Show", season: 1, episode: 6, read: false }]);
    await hub.settled();
    expect(sent).toEqual([{ token: "ana-phone-token-0000000000", data: { kind: "title", name: "", friend: "", profile: ana.id }, collapseKey: "title", ttlSeconds: 86_400 }]);

    expect((await app.inject({ method: "GET", url: ana.url })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: ana.url, headers: { cookie: `${COOKIE}=nobody` } })).statusCode).toBe(401);
    expect((await bob.call("GET")).items).toEqual([]);
    const others = await app.inject({ method: "POST", url: `${ana.url}/seen`, headers: { cookie: (await bobCookie(store, "bob2")).cookie } });
    expect(others.statusCode).toBe(404);

    expect((await ana.call("POST", "/seen")).items).toMatchObject([{ id: "tv-7", read: true }]);
    expect((await ana.call("POST", "/dismiss", { id: "not a title" })).status).toBe(400);
    expect((await ana.call("POST", "/dismiss", { id: "tv-7" })).items).toEqual([]);
    expect((await ana.call("GET")).items).toEqual([]);
  });

  it("are none on a host that does not look for them", async () => {
    const { person } = await start({ withBook: false });
    const ana = person("ana");
    expect(await ana.call("GET")).toEqual({ status: 200, items: [] });
    expect(await ana.call("POST", "/seen")).toEqual({ status: 200, items: [] });
  });
});

async function bobCookie(store: AccountStore, login: string) {
  const account = store.createAccount(login, "x");
  if (!account.ok) throw new Error("could not make the account");
  return { cookie: `${COOKIE}=${store.createSession(account.value.id, "browser", "test").token}` };
}
