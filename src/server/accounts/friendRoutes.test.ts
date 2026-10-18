import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_KEEP_MS,
  INVITE_TTL_MS,
  MAX_OPEN_INVITES,
  ONLINE_MS,
  PARTY_INVITE_KEEP_MS,
  PLAN_KEEP_AFTER_MS,
  PLAN_MAX_AHEAD_MS,
  PLAN_MIN_AHEAD_MS,
  PLAN_OPEN_PER_PAIR,
  PLAN_OPEN_PER_SENDER,
  type FriendsState,
} from "../../shared";
import { buildApp } from "../app";
import { Registry } from "../sessions/registry";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const cheap = { N: 1024, r: 8, p: 1 } as const;
const clock = { now: Date.now() };

async function start(persistence = new MemoryPersistence()) {
  const store = await AccountStore.open({ persistence, flushMs: 0, now: () => clock.now });
  // (The watch parties keep the same time as the accounts, so a code can be made to run out.)
  const registry = new Registry({ now: () => clock.now });
  const app = await buildApp({ accounts: store, passwordCost: cheap, registry });
  apps.push(app);
  return { app, store, persistence, registry };
}

/** A TV with a party open: the screen, and the code that brings others in. */
function openParty(registry: Registry) {
  const host = registry.tvHello();
  return { host, code: registry.ensurePartyCode(host)!.code };
}

/** One browser: it keeps its cookie, and sends it back. */
class Client {
  cookie = "";
  /** The address this browser is on (what its calls say they came to), when a test needs to say. */
  host = "";
  constructor(private readonly app: FastifyInstance) {}

  async call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<LightMyRequestResponse & { data: any }> {
    const response = await this.app.inject({
      method,
      url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.host ? { host: this.host } : {}) },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const set = response.headers["set-cookie"];
    const header = Array.isArray(set) ? set[0] : set;
    if (header) {
      const [pair = ""] = header.split(";");
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    let data: unknown;
    try {
      data = response.json();
    } catch {
      data = undefined;
    }
    return Object.assign(response, { data });
  }
  get = (url: string) => this.call("GET", url);
  post = (url: string, payload?: unknown) => this.call("POST", url, payload ?? {});
  delete = (url: string) => this.call("DELETE", url);
}

/** Somebody with an account, their first profile, and the means to change what that profile keeps and chooses. */
interface Person {
  client: Client;
  id: string;
  name: string;
  /** The number that goes with the name (see `tagLabel`). */
  tag: number;
  /** Change what the profile chooses (as its settings sync does). */
  choose(choices: Record<string, boolean>): Promise<void>;
  /** Put things in the profile's collections. */
  keep(items: Record<string, unknown[]>): Promise<void>;
  friends(): Promise<LightMyRequestResponse & { data: any }>;
  state(): Promise<FriendsState>;
}

async function person(app: FastifyInstance, login: string): Promise<Person> {
  const client = new Client(app);
  const registered = await client.post("/api/auth/register", { email: login, password: "x" });
  expect(registered.statusCode).toBe(201);
  return profileOf(client, registered.data.profiles[0]);
}

/** One of the profiles of a signed-in account. */
function profileOf(client: Client, profile: { id: string; name: string; tag: number }): Person {
  const sync = (body: Record<string, unknown>) => client.post(`/api/profiles/${profile.id}/sync`, { since: 0, ...body });
  const me: Person = {
    client,
    id: profile.id,
    name: profile.name,
    tag: profile.tag,
    async choose(choices) {
      clock.now += 1000;
      const settings = Object.entries(choices).map(([key, value]) => ({ key, at: clock.now, value }));
      expect((await sync({ settings })).statusCode).toBe(200);
    },
    async keep(items) {
      expect((await sync(items)).statusCode).toBe(200);
    },
    friends: () => client.get(`/api/profiles/${profile.id}/friends`),
    async state() {
      const response = await client.get(`/api/profiles/${profile.id}/friends`);
      expect(response.statusCode).toBe(200);
      return response.data as FriendsState;
    },
  };
  return me;
}

const url = (id: number) => `https://filmpire.sc/watch/${id}`;
const mine = (who: Person, path = "") => `/api/profiles/${who.id}/friends${path}`;

/** Two people with friends on, who are not yet friends. */
async function pair(choices: Record<string, boolean> = {}) {
  const world = await start();
  const alex = await person(world.app, "alex");
  const sam = await person(world.app, "sam");
  await alex.choose({ friends: true, ...choices });
  await sam.choose({ friends: true, ...choices });
  return { ...world, alex, sam };
}

/** Two people with friends on, who are friends. */
async function friends(choices: Record<string, boolean> = {}) {
  const world = await pair(choices);
  const made = await world.alex.client.post(mine(world.alex, "/invites"));
  expect(made.statusCode).toBe(201);
  const joined = await world.sam.client.post(mine(world.sam, "/accept"), { code: made.data.code });
  expect(joined.statusCode).toBe(201);
  return world;
}

describe("friends are off until they are turned on", () => {
  it("answers nothing about friends to a profile that has not turned them on, and tells why", async () => {
    const { app } = await start();
    const alex = await person(app, "alex");
    const refused = await alex.friends();
    expect(refused.statusCode).toBe(403);
    expect(refused.data).toEqual({ error: "friends_off" });
    expect((await alex.client.post(mine(alex, "/invites"))).statusCode).toBe(403);
    expect((await alex.client.post(mine(alex, "/send"), { to: ["x"], kind: "party", code: "123456", endsAt: 1 })).statusCode).toBe(403);

    await alex.choose({ friends: true });
    expect(await alex.state()).toEqual({ friends: [], inbox: [], activity: [], invites: [], requests: [], sent: [] });
    await alex.choose({ friends: false });
    expect((await alex.friends()).statusCode).toBe(403);
  });

  it("is for a signed-in person's own profiles only", async () => {
    const { app } = await start();
    const alex = await person(app, "alex");
    const sam = await person(app, "sam");
    await alex.choose({ friends: true });
    expect((await new Client(app).get(mine(alex))).statusCode).toBe(401);
    expect((await sam.client.get(mine(alex))).statusCode).toBe(404);
    expect((await sam.client.post(mine(alex, "/invites"))).statusCode).toBe(404);
    expect((await new Client(app).get(mine(alex, "/kept"))).statusCode).toBe(401);
    expect((await sam.client.get(mine(alex, "/kept"))).statusCode).toBe(404);
  });

  it("still lets a profile that turned them off see who its friends are, end a friendship, take back a code and throw away what it was sent, without turning on what it shares", async () => {
    const { alex, sam } = await friends();
    const { data: open } = await alex.client.post(mine(alex, "/invites"));
    await sam.client.post(mine(sam, "/send"), { to: [alex.id], kind: "recommend", title: "Dune", url: url(1) });
    const sent = (await alex.state()).inbox[0]!;
    await alex.keep({ list: [{ key: `url:${url(1)}`, at: 5000, id: "1", title: "Dune", url: url(1) }] });

    await alex.choose({ friends: false });
    // The page of friends and everything that adds to them or shares stays shut...
    expect((await alex.friends()).data).toEqual({ error: "friends_off" });
    expect((await alex.client.post(mine(alex, "/invites"))).statusCode).toBe(403);
    expect((await alex.client.post(mine(alex, "/accept"), { code: "ABCD2345" })).statusCode).toBe(403);
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code: "123456", endsAt: 1 })).statusCode).toBe(403);
    expect((await alex.client.get(mine(alex, `/${sam.id}/lists`))).statusCode).toBe(403);
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data).toEqual({ error: "not_shared" });
    // ...but who the friends are can be seen, and nothing else of them: not even what they have switched on or off.
    const kept = await alex.client.get(mine(alex, "/kept"));
    expect(kept.statusCode).toBe(200);
    expect(Object.keys(kept.data)).toEqual(["friends"]);
    expect(kept.data.friends).toEqual([{ id: sam.id, name: "Sam", avatar: expect.any(String), since: expect.any(Number) }]);

    expect((await alex.client.delete(mine(alex, `/invites/${open.code}`))).statusCode).toBe(204);
    expect((await alex.client.delete(mine(alex, `/inbox/${sent.id}`))).statusCode).toBe(204);
    expect((await alex.client.delete(mine(alex, `/${sam.id}`))).statusCode).toBe(204);
    expect((await alex.client.get(mine(alex, "/kept"))).data).toEqual({ friends: [] });

    // Friends back on afterwards: Sam is not one of them any more, and has not seen a thing in between.
    await alex.choose({ friends: true });
    expect((await alex.state()).friends).toEqual([]);
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).statusCode).toBe(404);
  });
});

describe("making friends", () => {
  it("makes a code, shows who is behind it to whoever has it, and makes friends of them when they add it", async () => {
    const { alex, sam } = await pair();
    const made = await alex.client.post(mine(alex, "/invites"));
    expect(made.statusCode).toBe(201);
    expect(made.data.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(made.data.expiresAt).toBe(clock.now + INVITE_TTL_MS);
    expect((await alex.state()).invites).toEqual([made.data]);

    const peek = await sam.client.get(mine(sam, `/invites/${made.data.code}`));
    expect(peek.data).toEqual({ code: made.data.code, from: { name: "Alex", avatar: "fox" } });

    const typed = `${String(made.data.code).slice(0, 4)}-${String(made.data.code).slice(4)}`.toLowerCase();
    const joined = await sam.client.post(mine(sam, "/accept"), { code: typed });
    expect(joined.statusCode).toBe(201);
    expect(joined.data.friend).toMatchObject({ id: alex.id, name: "Alex", avatar: "fox", on: true, lists: true, ratings: true, activity: false, inbox: true });

    const seenBySam = await sam.state();
    const seenByAlex = await alex.state();
    expect(seenBySam.friends.map((friend) => friend.id)).toEqual([alex.id]);
    expect(seenByAlex.friends.map((friend) => friend.id)).toEqual([sam.id]);
    expect(seenByAlex.invites).toEqual([]);
    // The code is spent.
    expect((await sam.client.post(mine(sam, "/accept"), { code: made.data.code })).data).toEqual({ error: "invite_gone" });
  });

  it("does not make anybody their own friend, or a friend twice, and a code that was refused stays good", async () => {
    const { alex, sam } = await pair();
    const { data: first } = await alex.client.post(mine(alex, "/invites"));
    const own = await alex.client.post(mine(alex, "/accept"), { code: first.code });
    expect(own.statusCode).toBe(409);
    expect(own.data).toEqual({ error: "own_invite" });
    expect((await sam.client.post(mine(sam, "/accept"), { code: first.code })).statusCode).toBe(201);

    const { data: second } = await alex.client.post(mine(alex, "/invites"));
    const twice = await sam.client.post(mine(sam, "/accept"), { code: second.code });
    expect(twice.statusCode).toBe(409);
    expect(twice.data).toEqual({ error: "already_friends" });
  });

  it("takes back a code, and keeps only a few out at a time", async () => {
    const { alex, sam } = await pair();
    const { data: made } = await alex.client.post(mine(alex, "/invites"));
    expect((await sam.client.delete(mine(sam, `/invites/${made.code}`))).statusCode).toBe(404); // not hers to take back
    expect((await alex.client.delete(mine(alex, `/invites/${made.code}`))).statusCode).toBe(204);
    expect((await sam.client.post(mine(sam, "/accept"), { code: made.code })).statusCode).toBe(404);

    for (let i = 0; i < MAX_OPEN_INVITES + 2; i++) {
      clock.now += 1000;
      expect((await alex.client.post(mine(alex, "/invites"))).statusCode).toBe(201);
    }
    expect((await alex.state()).invites).toHaveLength(MAX_OPEN_INVITES);
  });

  it("is good for a week, and for nobody once the one who made it has friends turned off", async () => {
    const { alex, sam } = await pair();
    const { data: late } = await alex.client.post(mine(alex, "/invites"));
    clock.now += INVITE_TTL_MS;
    expect((await sam.client.post(mine(sam, "/accept"), { code: late.code })).statusCode).toBe(404);

    const { data: fresh } = await alex.client.post(mine(alex, "/invites"));
    await alex.choose({ friends: false });
    expect((await sam.client.get(mine(sam, `/invites/${fresh.code}`))).statusCode).toBe(404);
    expect((await sam.client.post(mine(sam, "/accept"), { code: fresh.code })).statusCode).toBe(404);
    await alex.choose({ friends: true });
    expect((await sam.client.post(mine(sam, "/accept"), { code: fresh.code })).statusCode).toBe(201);
  });

  it("slows down anybody who guesses codes", async () => {
    const { sam } = await pair();
    for (let i = 0; i < 10; i++) expect((await sam.client.post(mine(sam, "/accept"), { code: "ABCD2345" })).statusCode).toBe(404);
    const slowed = await sam.client.post(mine(sam, "/accept"), { code: "ABCD2345" });
    expect(slowed.statusCode).toBe(429);
    expect(Number(slowed.headers["retry-after"])).toBeGreaterThan(0);
    expect((await sam.client.get(mine(sam, "/invites/ABCD2345"))).statusCode).toBe(429);
  });

  it("refuses what is not a code", async () => {
    const { sam } = await pair();
    expect((await sam.client.post(mine(sam, "/accept"), {})).statusCode).toBe(400);
    expect((await sam.client.post(mine(sam, "/accept"), { code: "" })).statusCode).toBe(400);
  });

  it("does not count sending to friends against adding one: each has its own allowance", async () => {
    const { app, alex, sam } = await friends();
    const title = { to: [sam.id], kind: "recommend", title: "Dune", url: url(1) };
    for (let i = 0; i < 60; i++) expect((await alex.client.post(mine(alex, "/send"), title)).statusCode).toBe(200);
    expect((await alex.client.post(mine(alex, "/send"), title)).statusCode).toBe(429);

    const robin = await person(app, "robin");
    await robin.choose({ friends: true });
    const { data: made } = await robin.client.post(mine(robin, "/invites"));
    expect((await alex.client.post(mine(alex, "/accept"), { code: made.code })).statusCode).toBe(201);
  });

  it("ends a friendship for both, and says so to one who is not a friend", async () => {
    const { alex, sam } = await friends();
    expect((await sam.client.delete(mine(sam, `/${alex.id}`))).statusCode).toBe(204);
    expect((await alex.state()).friends).toEqual([]);
    expect((await sam.state()).friends).toEqual([]);
    expect((await sam.client.delete(mine(sam, `/${alex.id}`))).statusCode).toBe(404);
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).statusCode).toBe(404);
  });
});

describe("asking to be friends by tag", () => {
  const tagOf = (who: Person) => `${who.name}#${who.tag}`;
  const peek = (from: Person, text: string) => from.client.get(mine(from, `/tags/${encodeURIComponent(text)}`));
  const ask = (from: Person, text: string) => from.client.post(mine(from, "/requests"), { tag: text });
  /** Somebody as it is shown to one who is not their friend. */
  const shown = (who: Person) => ({ id: who.id, name: who.name, avatar: expect.any(String), tag: who.tag });

  it("gives every profile a tag, and finds the profile a tag names however it is typed, showing who it is and no more", async () => {
    const { alex, sam } = await pair();
    expect([alex.tag, sam.tag]).toEqual([1, 1]);
    for (const typed of ["Sam#1", "sam#1", " SAM # 1 "]) {
      const found = await peek(alex, typed);
      expect(found.statusCode, typed).toBe(200);
      expect(found.data, typed).toEqual({ name: "Sam", avatar: expect.any(String), tag: 1 });
    }
  });

  it("does not find a tag nobody has, a profile that turned friends off, or what is not a tag; and slows down anybody who keeps guessing", async () => {
    const { alex, sam } = await pair();
    await sam.choose({ friends: false });
    for (const typed of ["Sam#1", "Nobody#1", "Sam#9", "Sam", "#1"]) {
      const missing = await peek(alex, typed);
      expect(missing.statusCode, typed).toBe(404);
      expect(missing.data, typed).toEqual({ error: "tag_gone" });
    }
    for (let i = 0; i < 5; i++) expect((await peek(alex, `Nobody#${i + 2}`)).statusCode).toBe(404);
    const slowed = await peek(alex, "Nobody#9");
    expect(slowed.statusCode).toBe(429);
    expect(Number(slowed.headers["retry-after"])).toBeGreaterThan(0);
    // (asking shares the allowance: guessing by asking is no way round it)
    expect((await ask(alex, "Nobody#9")).statusCode).toBe(429);
  });

  it("is no use to ask oneself, a friend, or nobody; and wants a tag to ask", async () => {
    const { alex, sam } = await friends();
    expect((await peek(alex, tagOf(alex))).data).toEqual({ error: "own_request" });
    expect((await peek(alex, tagOf(sam))).data).toEqual({ error: "already_friends" });
    const own = await ask(alex, tagOf(alex));
    expect(own.statusCode).toBe(409);
    expect(own.data).toEqual({ error: "own_request" });
    const twice = await ask(alex, tagOf(sam));
    expect(twice.statusCode).toBe(409);
    expect(twice.data).toEqual({ error: "already_friends" });
    expect((await ask(alex, "Nobody#1")).data).toEqual({ error: "tag_gone" });
    expect((await alex.client.post(mine(alex, "/requests"), {})).statusCode).toBe(400);
    expect((await alex.client.post(mine(alex, "/requests"), { tag: "" })).statusCode).toBe(400);
  });

  it("asks: the other sees who asked, nobody is a friend yet, and the one who asked sees who is yet to answer", async () => {
    const { alex, sam } = await pair();
    clock.now += 1000;
    const asked = await ask(alex, "sam#1");
    expect(asked.statusCode).toBe(201);
    expect(asked.data).toEqual({ status: "sent" });
    expect((await sam.state()).requests).toEqual([{ from: shown(alex), at: clock.now }]);
    expect((await alex.state()).sent).toEqual([{ to: shown(sam), at: clock.now }]);
    expect((await sam.state()).friends).toEqual([]);
    expect((await alex.state()).friends).toEqual([]);
    expect((await alex.state()).requests).toEqual([]);

    // Asking again does not ask twice.
    expect((await ask(alex, tagOf(sam))).statusCode).toBe(201);
    expect((await sam.state()).requests).toHaveLength(1);
  });

  it("makes friends of the two when the one asked says yes, and the request is gone from both", async () => {
    const { alex, sam } = await pair();
    await ask(alex, tagOf(sam));
    const yes = await sam.client.post(mine(sam, `/requests/${alex.id}/accept`));
    expect(yes.statusCode).toBe(201);
    expect(yes.data.friend).toMatchObject({ id: alex.id, name: "Alex", tag: 1, on: true });
    expect(await sam.state()).toMatchObject({ requests: [], sent: [] });
    expect(await alex.state()).toMatchObject({ requests: [], sent: [] });
    expect((await alex.state()).friends.map((friend) => friend.id)).toEqual([sam.id]);
    expect((await sam.state()).friends.map((friend) => friend.id)).toEqual([alex.id]);
    const again = await sam.client.post(mine(sam, `/requests/${alex.id}/accept`));
    expect(again.statusCode).toBe(404);
    expect(again.data).toEqual({ error: "request_gone" });
  });

  it("lets the one asked say no, and does not tell the one who asked", async () => {
    const { alex, sam } = await pair();
    await ask(alex, tagOf(sam));
    expect((await sam.client.delete(mine(sam, `/requests/${alex.id}`))).statusCode).toBe(204);
    expect((await sam.state()).requests).toEqual([]);
    expect((await alex.state()).sent).toEqual([]);
    expect((await sam.client.delete(mine(sam, `/requests/${alex.id}`))).statusCode).toBe(404);
    expect((await sam.client.post(mine(sam, `/requests/${alex.id}/accept`))).statusCode).toBe(404);
    // (and the one who was turned down may ask again)
    expect((await ask(alex, tagOf(sam))).statusCode).toBe(201);
    expect((await sam.state()).requests).toHaveLength(1);
  });

  it("takes two who ask each other as a yes from both", async () => {
    const { alex, sam } = await pair();
    await ask(alex, tagOf(sam));
    const back = await ask(sam, tagOf(alex));
    expect(back.statusCode).toBe(201);
    expect(back.data).toMatchObject({ status: "friends", friend: { id: alex.id, name: "Alex" } });
    expect(await alex.state()).toMatchObject({ friends: [{ id: sam.id }], requests: [], sent: [] });
    expect(await sam.state()).toMatchObject({ friends: [{ id: alex.id }], requests: [], sent: [] });
  });

  it("does not show or take a request from somebody who turned friends off after asking, and shows it again when they turn them on", async () => {
    const { alex, sam } = await pair();
    await ask(alex, tagOf(sam));
    await alex.choose({ friends: false });
    expect((await sam.state()).requests).toEqual([]);
    expect((await sam.client.post(mine(sam, `/requests/${alex.id}/accept`))).statusCode).toBe(404);
    expect((await ask(alex, tagOf(sam))).data).toEqual({ error: "friends_off" }); // (nor can they ask while they are off)
    await alex.choose({ friends: true });
    expect((await sam.state()).requests).toEqual([{ from: shown(alex), at: expect.any(Number) }]);
    expect((await sam.client.post(mine(sam, `/requests/${alex.id}/accept`))).statusCode).toBe(201);
  });

  it("can be turned down by a profile that has friends turned off, without turning them on", async () => {
    const { alex, sam } = await pair();
    await ask(alex, tagOf(sam));
    await sam.choose({ friends: false });
    expect((await sam.friends()).statusCode).toBe(403);
    expect((await sam.client.post(mine(sam, `/requests/${alex.id}/accept`))).statusCode).toBe(403);
    expect((await sam.client.delete(mine(sam, `/requests/${alex.id}`))).statusCode).toBe(204);
  });

  it("is for a signed-in person's own profiles only, and only so many a person may make in an hour", async () => {
    const { app, alex, sam } = await pair();
    expect((await ask(alex, tagOf(sam))).statusCode).toBe(201);
    expect((await new Client(app).post(mine(alex, "/requests"), { tag: tagOf(sam) })).statusCode).toBe(401);
    expect((await sam.client.post(mine(alex, "/requests"), { tag: tagOf(alex) })).statusCode).toBe(404);
    expect((await new Client(app).get(mine(alex, "/tags/Sam%231"))).statusCode).toBe(401);
    expect((await sam.client.get(mine(alex, "/tags/Sam%231"))).statusCode).toBe(404);
    expect((await new Client(app).delete(mine(sam, `/requests/${alex.id}`))).statusCode).toBe(401);
    expect((await alex.client.delete(mine(sam, `/requests/${alex.id}`))).statusCode).toBe(404);
    expect((await alex.client.post(mine(sam, `/requests/${alex.id}/accept`))).statusCode).toBe(404);

    for (let i = 0; i < 29; i++) expect((await ask(alex, tagOf(sam))).statusCode).toBe(201);
    expect((await ask(alex, tagOf(sam))).statusCode).toBe(429);
  });

  it("goes with a profile that is deleted: it asks no more and is not asked", async () => {
    const { app, sam, store } = await pair();
    const robin = await person(app, "robin");
    await robin.choose({ friends: true });
    const added = await robin.client.post("/api/profiles", { name: "Second" });
    const second = profileOf(robin.client, added.data.profiles.find((profile: { name: string }) => profile.name === "Second"));
    await second.choose({ friends: true });
    const third = await person(app, "third");
    await third.choose({ friends: true });
    await ask(second, tagOf(sam));
    await ask(third, tagOf(second));
    expect(store.friends.requestsTo(sam.id)).toHaveLength(1);
    expect(store.friends.requestsTo(second.id)).toHaveLength(1);

    expect((await robin.client.delete(`/api/profiles/${second.id}`)).statusCode).toBe(200);
    expect(store.friends.requestsTo(sam.id)).toEqual([]);
    expect(store.friends.requestsTo(second.id)).toEqual([]);
    expect((await third.state()).sent).toEqual([]);
  });
});

describe("the proof a screen gives of whose it is", () => {
  it("is made for the signed-in account that has the profile, once each time, whether or not friends are on", async () => {
    const { app, alex, sam } = await pair();
    const first = await alex.client.post(`/api/profiles/${alex.id}/screen`);
    expect(first.statusCode).toBe(200);
    expect(first.data.proof).toEqual(expect.any(String));
    const second = await alex.client.post(`/api/profiles/${alex.id}/screen`);
    expect(second.data.proof).not.toBe(first.data.proof);
    expect((await sam.client.post(`/api/profiles/${alex.id}/screen`)).statusCode).toBe(404);
    expect((await new Client(app).post(`/api/profiles/${alex.id}/screen`)).statusCode).toBe(401);
    await alex.choose({ friends: false });
    expect((await alex.client.post(`/api/profiles/${alex.id}/screen`)).statusCode).toBe(200);
  });
});

describe("what a friend lets be seen", () => {
  const dune = { key: `url:${url(1)}`, at: 5000, id: "1", title: "Dune", url: url(1), year: 2021 };
  const alien = { key: `horror|url:${url(2)}`, at: 6000, list: "horror", id: "2", title: "Alien", url: url(2) };
  const named = { key: "horror", at: 5500, name: "Scary" };
  const rated = { key: `rate:${url(1)}`, at: 7000, title: "Dune", url: url(1), score: 9, note: "Huge.", ratedAt: 7000 };

  it("shows the lists and the ratings of a friend who shares them, and only theirs", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ list: [dune, alien], listNames: [named], ratings: [rated] });
    await sam.keep({ list: [{ ...dune, title: "Sam's own" }] });

    const lists = await sam.client.get(mine(sam, `/${alex.id}/lists`));
    expect(lists.statusCode).toBe(200);
    expect(lists.data.list.map((item: { title: string }) => item.title).sort()).toEqual(["Alien", "Dune"]);
    expect(lists.data.listNames).toMatchObject([{ key: "horror", name: "Scary" }]);

    const ratings = await sam.client.get(mine(sam, `/${alex.id}/ratings`));
    expect(ratings.data.ratings).toMatchObject([{ title: "Dune", score: 9, note: "Huge." }]);
  });

  it("does not show what was removed", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ list: [dune, alien], ratings: [rated] });
    await alex.keep({ list: [{ key: alien.key, at: 9000, deleted: true }], ratings: [{ key: rated.key, at: 9000, deleted: true }] });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data.list.map((item: { title: string }) => item.title)).toEqual(["Dune"]);
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).data.ratings).toEqual([]);
  });

  it("follows the friend's switches: lists, ratings, and friends altogether", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ list: [dune], ratings: [rated] });

    await alex.choose({ friendsLists: false });
    const noLists = await sam.client.get(mine(sam, `/${alex.id}/lists`));
    expect(noLists.statusCode).toBe(403);
    expect(noLists.data).toEqual({ error: "not_shared" });
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).statusCode).toBe(200);
    expect((await sam.state()).friends[0]).toMatchObject({ lists: false, ratings: true });

    await alex.choose({ friendsLists: true, friendsRatings: false });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).statusCode).toBe(200);
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).statusCode).toBe(403);
    expect((await sam.state()).friends[0]).toMatchObject({ lists: true, ratings: false });

    await alex.choose({ friendsRatings: true, friends: false });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).statusCode).toBe(403);
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).statusCode).toBe(403);
    expect((await sam.state()).friends[0]).toMatchObject({ on: false, lists: false, ratings: false, activity: false, inbox: false });
    // (They are still friends: turning friends back on brings it all back.)
    await alex.choose({ friends: true });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).statusCode).toBe(200);
  });

  it("does not show the ratings of a profile that turned ratings off, though they stay kept and the profile shares them", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ ratings: [rated] });
    await alex.choose({ ratings: false });
    const refused = await sam.client.get(mine(sam, `/${alex.id}/ratings`));
    expect(refused.statusCode).toBe(403);
    expect(refused.data).toEqual({ error: "not_shared" });
    expect((await sam.state()).friends[0]).toMatchObject({ lists: true, ratings: false });

    await alex.choose({ ratings: true });
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).data.ratings).toMatchObject([{ title: "Dune", score: 9 }]);
    expect((await sam.state()).friends[0]).toMatchObject({ ratings: true });
  });

  it("shows nothing of anybody who is not a friend", async () => {
    const { app, alex } = await pair();
    const robin = await person(app, "robin");
    await robin.choose({ friends: true });
    await alex.keep({ list: [dune] });
    expect((await robin.client.get(mine(robin, `/${alex.id}/lists`))).data).toEqual({ error: "not_friends" });
    expect((await robin.client.get(mine(robin, `/${alex.id}/ratings`))).statusCode).toBe(404);
  });
});

describe("what comes from a friend is made fit to show", () => {
  const own = "kino.example";
  /** What a friend could put in the pictures of their things: one that is fine, and ones that would make the browser of whoever looks call this site or something else. */
  const pictures = { fine: "https://image.tmdb.org/t/p/w342/a.jpg", ours: "https://kino.example/api/link/ABCD2345", oursAgain: "https://KINO.example:8443/api/me", path: "/api/profiles/x/friends/invites/AAAAAAAA", script: "javascript:alert(1)" };

  it("cleans the words and keeps only the pictures of other sites in a friend's lists, ratings and activity", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    sam.client.host = own;
    const dune = { key: `url:${url(1)}`, at: 5000, id: "1", title: "‮enuD​", url: url(1), image: pictures.ours, backdrop: pictures.fine };
    const alien = { key: `url:${url(2)}`, at: 5001, id: "2", title: "Alien", url: url(2), image: pictures.path, backdrop: pictures.script };
    const rated = { key: `rate:${url(1)}`, at: 7000, title: "Dune", url: url(1), score: 9, note: "Huge.‮\n\n", ratedAt: 7000, image: pictures.oursAgain, backdrop: pictures.fine };
    const watched = { key: `url:${url(3)}`, at: clock.now - 1000, title: `x${"́".repeat(8)} film`, url: url(3), position: 600, duration: 7200, image: pictures.ours, backdrop: pictures.fine };
    const names = [{ key: "scary", at: 5500, name: "‮Scary​" }, { key: "blank", at: 5501, name: "‮​" }];
    const hollow = { key: `url:${url(4)}`, at: 5002, id: "4", title: "‮​‌", url: url(4) };
    await alex.keep({ list: [dune, alien, hollow], listNames: names, ratings: [rated], progress: [watched] });

    const shown = (await sam.client.get(mine(sam, `/${alex.id}/lists`))).data;
    expect(shown.listNames.map((list: { name: string }) => list.name).sort()).toEqual(["?", "Scary"]); // (a name that is nothing to see is still a name)
    const lists = shown.list as Array<Record<string, unknown>>;
    const byTitle = (title: string) => lists.find((item) => item.title === title);
    expect(byTitle("enuD")).toMatchObject({ backdrop: pictures.fine });
    expect(byTitle("enuD")).not.toHaveProperty("image");
    expect(byTitle("Alien")).not.toHaveProperty("image");
    expect(byTitle("Alien")).not.toHaveProperty("backdrop");
    expect(byTitle("?")).toMatchObject({ id: "4" }); // (a title that is nothing to see is still a title)

    const rating =(await sam.client.get(mine(sam, `/${alex.id}/ratings`))).data.ratings[0];
    expect(rating).toMatchObject({ note: "Huge.", backdrop: pictures.fine });
    expect(rating).not.toHaveProperty("image");

    const [activity] = (await sam.state()).activity;
    expect(activity).toMatchObject({ title: `x${"́".repeat(4)} film`, backdrop: pictures.fine });
    expect(activity).not.toHaveProperty("image");

    // (What Alex keeps of his own is his: he is shown it as it is.)
    const alexsOwn = (await alex.client.post(`/api/profiles/${alex.id}/sync`, { since: 0 })).data;
    expect(alexsOwn.list.find((item: { key: string }) => item.key === dune.key)).toMatchObject({ title: "‮enuD​", image: pictures.ours });
  });

  it("makes addresses well formed: half of a pair in one would make a page throw when the title is opened", async () => {
    const { alex, sam } = await friends();
    const bad = "https://example.com/\ud800";
    await alex.keep({ list: [{ key: "url:half", at: 5000, id: "1", title: "Dune", url: bad }] });
    const shown = (await sam.client.get(mine(sam, `/${alex.id}/lists`))).data.list as Array<{ url: string }>;
    expect(shown.map((item) => item.url)).toEqual(["https://example.com/�"]);
    expect(() => encodeURIComponent(shown[0]!.url)).not.toThrow();
    // (and one cannot be sent to a friend in the first place)
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "Dune", url: bad })).statusCode).toBe(400);
  });

  it("does the same to what is in the inbox, and cleans the name of a friend", async () => {
    const { alex, sam } = await friends();
    sam.client.host = own;
    const sent = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "‮enuD", url: url(1), image: pictures.ours, backdrop: pictures.fine, note: "Loud.‮" });
    expect(sent.data.sent).toEqual([sam.id]);
    const renamed = await alex.client.call("PATCH", `/api/profiles/${alex.id}`, { name: "Al‮​ex" });
    expect(renamed.statusCode).toBe(200);

    const { inbox, friends: list } = await sam.state();
    expect(inbox).toMatchObject([{ title: "enuD", note: "Loud.", backdrop: pictures.fine }]);
    expect(inbox[0]).not.toHaveProperty("image");
    expect(list[0]!.name).toBe("Alex");
    // (...and so is the name that a code shows to whoever has it.)
    const { data: made } = await alex.client.post(mine(alex, "/invites"));
    expect((await sam.client.get(mine(sam, `/invites/${made.code}`))).data).toMatchObject({ from: { name: "Alex" } });
  });

  it("is told, when a title is sent, that a picture which is a path or is not on the web will not do", async () => {
    const { alex, sam } = await friends();
    for (const picture of [pictures.path, pictures.script, "//evil.example/a.gif"]) {
      const body = { to: [sam.id], kind: "recommend", title: "Dune", url: url(1), image: picture };
      expect((await alex.client.post(mine(alex, "/send"), body)).statusCode, picture).toBe(400);
    }
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "‮​", url: url(1) })).statusCode).toBe(400);
    expect((await sam.state()).inbox).toEqual([]);
  });
});

describe("recommendations and invitations to a party", () => {
  const dune = { kind: "recommend", title: "Dune", url: url(1), image: "https://img/dune.jpg", year: 2021, type: "movie", note: "Watch it loud." };

  it("puts a title in the inbox of a friend, who can see who it is from, mark it read, and throw it away", async () => {
    const { alex, sam } = await friends();
    const sent = await alex.client.post(mine(alex, "/send"), { to: [sam.id], ...dune });
    expect(sent.statusCode).toBe(200);
    expect(sent.data).toEqual({ sent: [sam.id], declined: [] });

    const { inbox } = await sam.state();
    expect(inbox).toMatchObject([{ kind: "recommend", from: alex.id, title: "Dune", url: url(1), year: 2021, type: "movie", note: "Watch it loud.", read: false }]);
    expect((await alex.state()).inbox).toEqual([]);

    expect((await sam.client.post(mine(sam, "/inbox/read"))).statusCode).toBe(204);
    expect((await sam.state()).inbox[0]).toMatchObject({ read: true });
    expect((await alex.client.delete(mine(alex, `/inbox/${inbox[0]!.id}`))).statusCode).toBe(404); // not hers
    expect((await sam.client.delete(mine(sam, `/inbox/${inbox[0]!.id}`))).statusCode).toBe(204);
    expect((await sam.state()).inbox).toEqual([]);
  });

  it("invites to a watch party with its code, and says the party is open", async () => {
    const { alex, sam, registry } = await friends();
    const { code } = openParty(registry);
    const invited = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code, endsAt: clock.now + 600_000 });
    expect(invited.data.sent).toEqual([sam.id]);
    const [item] = (await sam.state()).inbox;
    expect(item).toMatchObject({ kind: "party", from: alex.id, code, open: true, endsAt: clock.now + 600_000, read: false });
    expect(item).not.toHaveProperty("host"); // (which screen it is on is for the server)
  });

  it("refuses an invitation to a code no party is open with, and delivers nothing", async () => {
    const { alex, sam, registry } = await friends();
    const { host, code } = openParty(registry);
    registry.closeParty(host);
    const refused = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code, endsAt: clock.now + 600_000 });
    expect(refused.statusCode).toBe(409);
    expect(refused.data).toEqual({ error: "party_closed" });
    expect((await sam.state()).inbox).toEqual([]);
  });

  it("keeps an invitation good when the party's code is renewed: it carries the code the party has now, for as long as the party has guests", async () => {
    const { alex, sam, registry } = await friends();
    const { host, code } = openParty(registry);
    expect(registry.joinParty(registry.tvHello(), code).ok).toBe(true);
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code, endsAt: clock.now + 600_000 });

    clock.now += 11 * 60_000; // (the code ran out; the party did not)
    expect(registry.partyCodeOf(host)).toBeNull();
    const [item] = (await sam.state()).inbox;
    expect(item).toMatchObject({ kind: "party", open: true });
    expect(item).toMatchObject({ code: registry.partyCodeOf(host)!.code, endsAt: clock.now + 600_000 });
    expect((item as { code: string }).code).not.toBe(code);
    expect(registry.hostOfPartyCode((item as { code: string }).code)).toBe(host);
  });

  it("says an invitation's party is over once nobody is in it and its code has run out (or it was ended), and keeps what was sent", async () => {
    const { alex, sam, registry } = await friends();
    const { host, code } = openParty(registry);
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code, endsAt: clock.now + 600_000 });
    expect(((await sam.state()).inbox[0] as { open: boolean }).open).toBe(true);

    clock.now += 11 * 60_000;
    const [over] = (await sam.state()).inbox;
    expect(over).toMatchObject({ kind: "party", open: false, code, from: alex.id });
    expect(registry.hostOfPartyCode(code)).toBeUndefined();
    expect(registry.partyCodeOf(host)).toBeNull(); // (looking at the invitation did not open the party again)

    // An ended party is over too, even with the code still in date.
    const second = openParty(registry);
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code: second.code, endsAt: clock.now + 600_000 });
    registry.closeParty(second.host);
    expect(((await sam.state()).inbox[0] as { open: boolean }).open).toBe(false);
  });

  it("asks a friend who tells what they watch to watch together, and takes the request away once they invite back", async () => {
    const { alex, sam, registry } = await friends({ friendsGive: true, friendsGet: true });
    const asked = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "together" });
    expect(asked.data).toEqual({ sent: [sam.id], declined: [] });
    expect((await sam.state()).inbox).toMatchObject([{ kind: "together", from: alex.id, read: false }]);
    expect((await sam.state()).friends[0]).toMatchObject({ activity: true, inbox: true });

    // Asking again does not pile requests up.
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "together" });
    expect((await sam.state()).inbox).toHaveLength(1);

    // Sam answers by inviting Alex to a party: Alex has the invitation and Sam no longer has the request.
    const { code } = openParty(registry);
    const invited = await sam.client.post(mine(sam, "/send"), { to: [alex.id], kind: "party", code, endsAt: clock.now + 600_000 });
    expect(invited.data.sent).toEqual([alex.id]);
    expect((await sam.state()).inbox).toEqual([]);
    expect((await alex.state()).inbox).toMatchObject([{ kind: "party", from: sam.id, code, open: true }]);
  });

  it("takes a request to watch together to any friend who takes things, though they tell nothing of what they watch, and not to one who does not take things", async () => {
    const { alex, sam } = await friends(); // (what they watch is not told by default)
    expect((await alex.state()).friends[0]).toMatchObject({ activity: false, inbox: true });
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "together" })).data).toEqual({ sent: [sam.id], declined: [] });
    expect((await sam.state()).inbox).toMatchObject([{ kind: "together", from: alex.id, read: false }]);
    await sam.client.delete(mine(sam, `/inbox/${(await sam.state()).inbox[0]!.id}`));
    await sam.choose({ friendsInbox: false });
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "together" })).data).toEqual({ sent: [], declined: [sam.id] });
    expect((await sam.state()).inbox).toEqual([]);
  });

  it("sends to several friends at once, and tells who is not taking things", async () => {
    const { app, alex, sam } = await friends();
    const robin = await person(app, "robin");
    await robin.choose({ friends: true, friendsInbox: false });
    const { data: made } = await robin.client.post(mine(robin, "/invites"));
    await alex.choose({ friends: true });
    await alex.client.post(mine(alex, "/accept"), { code: made.code });
    const stranger = await person(app, "stranger");
    await stranger.choose({ friends: true });

    const sent = await alex.client.post(mine(alex, "/send"), { to: [sam.id, robin.id, stranger.id, sam.id, "nobody"], ...dune });
    expect(sent.data.sent).toEqual([sam.id]);
    expect(sent.data.declined.sort()).toEqual([robin.id, stranger.id, "nobody"].sort());
    expect((await robin.state()).inbox).toEqual([]);
    expect((await stranger.state()).inbox).toEqual([]);

    await sam.choose({ friends: false });
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], ...dune })).data).toEqual({ sent: [], declined: [sam.id] });
  });

  it("refuses what is not a recommendation or an invitation: no link, or one that is no web address, or a made-up kind", async () => {
    const { alex, sam } = await friends();
    for (const body of [
      { to: [sam.id], kind: "recommend", title: "Dune", url: "javascript:alert(1)" },
      { to: [sam.id], kind: "recommend", title: "Dune", url: "file:///etc/passwd" },
      { to: [sam.id], kind: "recommend", title: "", url: url(1) },
      { to: [sam.id], kind: "recommend", title: "Dune", url: url(1), note: "x".repeat(201) },
      { to: [sam.id], kind: "party", code: "12", endsAt: 1 },
      { to: [], kind: "recommend", title: "Dune", url: url(1) },
      { to: [sam.id], kind: "advert", title: "Dune", url: url(1) },
      { kind: "recommend", title: "Dune", url: url(1) },
    ]) {
      expect((await alex.client.post(mine(alex, "/send"), body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await sam.state()).inbox).toEqual([]);
  });

  it("does not send the same title twice: it moves up and is new again", async () => {
    const { alex, sam } = await friends();
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], ...dune });
    await sam.client.post(mine(sam, "/inbox/read"));
    clock.now += 1000;
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], ...dune, note: "Again!" });
    expect((await sam.state()).inbox).toMatchObject([{ title: "Dune", note: "Again!", read: false }]);
  });

  it("leaves what an unfriended friend sent out of the inbox", async () => {
    const { alex, sam } = await friends();
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], ...dune });
    await sam.client.delete(mine(sam, `/${alex.id}`));
    expect((await sam.state()).inbox).toEqual([]);
  });
});

describe("plans to watch together", () => {
  const HOUR = 3_600_000;
  /** `from` puts a plan to `to` for a time `hours` from now (with a few words, if there are any). */
  const put = (from: Person, to: Person, hours: number, note?: string) =>
    from.client.post(mine(from, "/send"), { to: [to.id], kind: "plan", when: clock.now + hours * HOUR, ...(note ? { note } : {}) });
  /** The ids of what is in a bell, newest first. */
  const idsOf = async (who: Person) => (await who.state()).inbox.map((item) => item.id);
  const reply = (who: Person, itemId: string, yes: boolean) => who.client.post(mine(who, `/plans/${itemId}/${yes ? "accept" : "decline"}`));
  /** What the plans in a bell say, newest first: when (in hours from `start`) and the answer, if there is one. */
  const plansOf = async (who: Person, start: number) =>
    (await who.state()).inbox.map((item) => (item.kind === "plan" ? [(item.when - start) / HOUR, item.answer] : item.kind));

  it("puts a plan to a friend: its time and a few words, made fit to show, unread, and who it is from", async () => {
    const { alex, sam } = await friends();
    const when = clock.now + 2 * HOUR;
    const sent = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "plan", when, note: "After dinner.‮" });
    expect(sent.statusCode).toBe(200);
    expect(sent.data).toEqual({ sent: [sam.id], declined: [] });
    const { inbox } = await sam.state();
    expect(inbox).toMatchObject([{ kind: "plan", from: alex.id, when, note: "After dinner.", read: false }]);
    expect(inbox[0]).not.toHaveProperty("answer");
    expect(inbox[0]).not.toHaveProperty("host");
    expect((await alex.state()).inbox).toEqual([]);

    // The same time again takes the place of the plan, and is not announced twice.
    expect((await put(alex, sam, 2, "Or later.")).statusCode).toBe(200);
    const [again, ...rest] = (await sam.state()).inbox;
    expect(rest).toEqual([]);
    expect(again).toMatchObject({ id: inbox[0]!.id, when, note: "Or later.", read: false });
  });

  it("goes to any friend who takes invitations, though they tell nothing of what they watch, and to nobody else", async () => {
    const { app, alex, sam } = await friends(); // (what they watch is not told by default)
    expect((await put(alex, sam, 2)).data).toEqual({ sent: [sam.id], declined: [] });
    await sam.client.delete(mine(sam, `/inbox/${(await sam.state()).inbox[0]!.id}`));

    const stranger = await person(app, "stranger");
    await stranger.choose({ friends: true });
    expect((await put(alex, stranger, 2)).data).toEqual({ sent: [], declined: [stranger.id] }); // (not a friend)
    expect((await alex.client.post(mine(alex, "/send"), { to: ["nobody"], kind: "plan", when: clock.now + 2 * HOUR })).data).toEqual({ sent: [], declined: ["nobody"] });

    await sam.choose({ friendsInbox: false });
    expect((await put(alex, sam, 2)).data).toEqual({ sent: [], declined: [sam.id] });
    await sam.choose({ friendsInbox: true, friends: false });
    expect((await put(alex, sam, 2)).data).toEqual({ sent: [], declined: [sam.id] });
    await sam.choose({ friends: true });
    expect((await sam.state()).inbox).toEqual([]);
    expect((await stranger.state()).inbox).toEqual([]);
  });

  it("is for a time from five minutes to thirty days away, to the millisecond, and says which when it is not", async () => {
    const { alex, sam } = await friends();
    const at = (when: number) => alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "plan", when });
    for (const [when, error] of [
      [clock.now + PLAN_MIN_AHEAD_MS - 1, "plan_soon"],
      [clock.now - HOUR, "plan_soon"],
      [clock.now + PLAN_MAX_AHEAD_MS + 1, "plan_far"],
    ] as const) {
      const refused = await at(when);
      expect(refused.statusCode, error).toBe(400);
      expect(refused.data).toEqual({ error });
    }
    expect((await sam.state()).inbox).toEqual([]);
    expect((await at(clock.now + PLAN_MIN_AHEAD_MS)).data.sent).toEqual([sam.id]);
    expect((await at(clock.now + PLAN_MAX_AHEAD_MS)).data.sent).toEqual([sam.id]);
  });

  it("refuses what is not a plan: no time, a time that is no time, a note that is too long, or not exactly one friend", async () => {
    const { alex, sam } = await friends();
    const when = clock.now + 2 * HOUR;
    for (const body of [
      { to: [sam.id], kind: "plan" },
      { to: [sam.id], kind: "plan", when: "tomorrow" },
      { to: [sam.id], kind: "plan", when: 1.5 },
      { to: [sam.id], kind: "plan", when: 0 },
      { to: [sam.id], kind: "plan", when: -5 },
      { to: [sam.id], kind: "plan", when, note: "x".repeat(201) },
      { to: [sam.id, "someone"], kind: "plan", when },
      { to: [], kind: "plan", when },
      { kind: "plan", when },
    ]) {
      expect((await alex.client.post(mine(alex, "/send"), body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await sam.state()).inbox).toEqual([]);
  });

  it("holds a profile to three plans that wait on one friend and ten in all; the same time put again is not one more, and an answered one is no longer waiting", async () => {
    const { app, alex, sam } = await friends();
    for (const hours of Array.from({ length: PLAN_OPEN_PER_PAIR }, (_, i) => i + 1)) expect((await put(alex, sam, hours)).statusCode).toBe(200);
    const full = await put(alex, sam, 10);
    expect(full.statusCode).toBe(409);
    expect(full.data).toEqual({ error: "plan_full" });
    expect((await put(alex, sam, 2, "Again.")).statusCode).toBe(200);
    expect((await sam.state()).inbox).toHaveLength(PLAN_OPEN_PER_PAIR);

    expect((await reply(sam, (await sam.state()).inbox[0]!.id, false)).statusCode).toBe(204);
    expect((await put(alex, sam, 10)).statusCode).toBe(200);

    // Ten in all, over several friends.
    const others: Person[] = [];
    for (const name of ["b", "c", "d"]) {
      const other = await person(app, name);
      await other.choose({ friends: true });
      const { data: made } = await alex.client.post(mine(alex, "/invites"));
      expect((await other.client.post(mine(other, "/accept"), { code: made.code })).statusCode).toBe(201);
      others.push(other);
    }
    let waiting = PLAN_OPEN_PER_PAIR;
    for (const other of others) {
      for (let i = 0; i < PLAN_OPEN_PER_PAIR && waiting < PLAN_OPEN_PER_SENDER; i++, waiting++) expect((await put(alex, other, 20 + waiting)).statusCode).toBe(200);
    }
    expect(waiting).toBe(PLAN_OPEN_PER_SENDER);
    const [, , last] = others as [Person, Person, Person];
    expect((await put(alex, last, 40)).data).toEqual({ error: "plan_full" });
    expect((await put(alex, last, 20 + PLAN_OPEN_PER_SENDER - 1, "Changed.")).statusCode).toBe(200); // (the same time: not one more)
  });

  it("is answered by the friend it was put to: yes makes it a plan that is on and seen, no takes it away; the one who put it is told either way, in their bell", async () => {
    const { alex, sam } = await friends();
    const start = clock.now;
    await put(alex, sam, 2);
    await put(alex, sam, 3);
    const [no, yes] = await idsOf(sam); // (the newest first: the plan for three hours from now)

    expect((await reply(sam, yes!, true)).statusCode).toBe(204);
    expect((await reply(sam, no!, false)).statusCode).toBe(204);
    expect(await plansOf(sam, start)).toEqual([[2, "yes"]]);
    expect((await sam.state()).inbox).toMatchObject([{ id: yes, from: alex.id, answer: "yes", read: true }]);
    expect(await plansOf(alex, start)).toEqual([[3, "no"], [2, "yes"]]);
    expect((await alex.state()).inbox).toMatchObject([{ from: sam.id, read: false }, { from: sam.id, read: false }]);
  });

  it("is answered only while it waits for an answer from that profile: once, by its friend, and not after its time", async () => {
    const { app, alex, sam } = await friends();
    await put(alex, sam, 2);
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "Dune", url: url(1) });
    const items = (await sam.state()).inbox;
    const planId = items.find((item) => item.kind === "plan")!.id;
    const dune = items.find((item) => item.kind === "recommend")!.id;

    for (const [who, id] of [[alex, planId], [sam, "m_nothing"], [sam, dune]] as const) {
      for (const yes of [true, false]) {
        const refused = await reply(who, id, yes);
        expect(refused.statusCode).toBe(404);
        expect(refused.data).toEqual({ error: "plan_gone" });
      }
    }
    const robin = await person(app, "robin");
    await robin.choose({ friends: true });
    expect((await reply(robin, planId, true)).statusCode).toBe(404); // (it is not in Robin's bell)
    expect((await robin.client.post(mine(sam, `/plans/${planId}/accept`))).statusCode).toBe(404); // (nor is Sam's profile Robin's to answer for)
    expect((await new Client(app).post(mine(sam, `/plans/${planId}/accept`))).statusCode).toBe(401);
    expect(await plansOf(sam, 0)).toHaveLength(2);

    expect((await reply(sam, planId, true)).statusCode).toBe(204);
    for (const yes of [true, false]) expect((await reply(sam, planId, yes)).data).toEqual({ error: "plan_gone" }); // (answered once)
    expect((await sam.state()).inbox.find((item) => item.id === planId)).toMatchObject({ answer: "yes" });

    await put(alex, sam, 1, "A second one.");
    const second = (await sam.state()).inbox.find((item) => item.kind === "plan" && item.answer === undefined)!;
    clock.now += HOUR; // (its time has come: nobody can say yes to a time that is here)
    expect((await reply(sam, second.id, true)).data).toEqual({ error: "plan_gone" });
  });

  it("takes a no from a friend who is not taking things now, and tells nobody; a yes it refuses, so the two never hold different plans", async () => {
    const { alex, sam } = await friends();
    await put(alex, sam, 2);
    const [plan] = await idsOf(sam);
    await alex.choose({ friendsInbox: false });
    expect((await reply(sam, plan!, true)).data).toEqual({ error: "plan_gone" });
    expect(await plansOf(sam, 0)).toHaveLength(1);
    expect((await reply(sam, plan!, false)).statusCode).toBe(204);
    await alex.choose({ friendsInbox: true });
    expect((await alex.state()).inbox).toEqual([]);
    expect((await sam.state()).inbox).toEqual([]);

    // A profile that turned friends off answers nothing.
    await put(alex, sam, 3);
    const [again] = await idsOf(sam);
    await sam.choose({ friends: false });
    const off = await reply(sam, again!, true);
    expect(off.statusCode).toBe(403);
    expect(off.data).toEqual({ error: "friends_off" });
  });

  it("goes when the friends part, from both bells", async () => {
    const { alex, sam } = await friends();
    await put(alex, sam, 2);
    const [plan] = await idsOf(sam);
    await reply(sam, plan!, true);
    await put(alex, sam, 3);
    expect(await plansOf(alex, 0)).toHaveLength(1);
    expect((await sam.client.delete(mine(sam, `/${alex.id}`))).statusCode).toBe(204);
    expect((await sam.state()).inbox).toEqual([]);
    expect((await alex.state()).inbox).toEqual([]);
  });

  it("is let go of by the clock: at its time if nobody answered, a little after it if it is on, and half a day after the news that it is off", async () => {
    const { alex, sam } = await friends();
    const start = clock.now;
    await put(alex, sam, 1);
    await put(alex, sam, 2);
    await put(alex, sam, 3);
    const [third, second] = await idsOf(sam);
    await reply(sam, second!, true);
    await reply(sam, third!, false);
    expect(await plansOf(sam, start)).toEqual([[2, "yes"], [1, undefined]]);

    clock.now = start + HOUR;
    expect(await plansOf(sam, start)).toEqual([[2, "yes"]]);
    clock.now = start + 2 * HOUR + PLAN_KEEP_AFTER_MS - 1;
    expect(await plansOf(sam, start)).toEqual([[2, "yes"]]);
    expect(await plansOf(alex, start)).toEqual([[3, "no"], [2, "yes"]]);
    clock.now = start + 2 * HOUR + PLAN_KEEP_AFTER_MS;
    expect(await plansOf(sam, start)).toEqual([]);
    expect(await plansOf(alex, start)).toEqual([[3, "no"]]);
    clock.now = start + PARTY_INVITE_KEEP_MS;
    expect(await plansOf(alex, start)).toEqual([]);
  });

  it("is done when the two go to a party at its time: the invitation takes its place in both bells, and one sent too early leaves it", async () => {
    const { alex, sam, registry } = await friends();
    const start = clock.now;
    await put(alex, sam, 2);
    const [plan] = await idsOf(sam);
    await reply(sam, plan!, true);

    const early = openParty(registry);
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code: early.code, endsAt: clock.now + 600_000 })).statusCode).toBe(200);
    expect(await plansOf(sam, start)).toEqual(["party", [2, "yes"]]);
    expect(await plansOf(alex, start)).toEqual([[2, "yes"]]);

    clock.now = start + 2 * HOUR + 60_000; // (the time has come)
    const party = openParty(registry);
    expect((await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code: party.code, endsAt: clock.now + 600_000 })).statusCode).toBe(200);
    expect(await plansOf(sam, start)).toEqual(["party"]);
    expect(await plansOf(alex, start)).toEqual([]);
  });

  it("is still there after the server restarts, answered or not", async () => {
    const persistence = new MemoryPersistence();
    const first = await start(persistence);
    const alex = await person(first.app, "alex");
    const sam = await person(first.app, "sam");
    await alex.choose({ friends: true });
    await sam.choose({ friends: true });
    const { data: made } = await alex.client.post(mine(alex, "/invites"));
    await sam.client.post(mine(sam, "/accept"), { code: made.code });
    const begun = clock.now;
    await put(alex, sam, 2, "After dinner.");
    await put(alex, sam, 3);
    await reply(sam, (await sam.state()).inbox[1]!.id, true);
    await first.store.flush();

    const second = await start(persistence);
    const backSam = new Client(second.app);
    backSam.cookie = sam.client.cookie;
    expect(((await backSam.get(mine(sam))).data as FriendsState).inbox).toMatchObject([
      { kind: "plan", when: begun + 3 * HOUR, read: false },
      { kind: "plan", when: begun + 2 * HOUR, note: "After dinner.", answer: "yes", read: true },
    ]);
    const backAlex = new Client(second.app);
    backAlex.cookie = alex.client.cookie;
    expect(((await backAlex.get(mine(alex))).data as FriendsState).inbox).toMatchObject([{ kind: "plan", from: sam.id, when: begun + 2 * HOUR, answer: "yes" }]);
  });
});

describe("what friends watch", () => {
  const card = (id: number, seconds: number, extra: Record<string, unknown> = {}) => ({
    key: `url:${url(id)}`,
    at: clock.now - 60_000 * id,
    title: `Film ${id}`,
    url: url(id),
    position: seconds,
    duration: 7200,
    ...extra,
  });

  it("tells a friend who gives it to a friend who gets it, the latest first", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    await alex.keep({ progress: [card(1, 600), card(2, 900, { done: true }), card(3, 20)] });
    const { activity, friends: list } = await sam.state();
    expect(list[0]).toMatchObject({ activity: true });
    // (The third was tried for twenty seconds and left: that is not watching it.)
    expect(activity).toMatchObject([{ friend: alex.id, title: "Film 1", url: url(1) }, { friend: alex.id, title: "Film 2", done: true }]);
    expect(activity.every((item) => item.friend === alex.id)).toBe(true);
  });

  it("needs the one to give it and the other to get it", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ progress: [card(1, 600)] });
    await sam.keep({ progress: [card(5, 600)] });

    await alex.choose({ friendsGive: true });
    expect((await sam.state()).activity).toEqual([]); // given, but not got
    expect((await sam.state()).friends[0]).toMatchObject({ activity: false });
    await sam.choose({ friendsGet: true });
    expect((await sam.state()).activity).toMatchObject([{ friend: alex.id, title: "Film 1" }]);
    expect((await sam.state()).friends[0]).toMatchObject({ activity: true });
    // Giving is not getting: Alex hears nothing of Sam, who gives nothing and watched something too.
    expect((await alex.state()).activity).toEqual([]);

    await alex.choose({ friendsGive: false });
    expect((await sam.state()).activity).toEqual([]);
    await alex.choose({ friendsGive: true, friendsGet: true });
    await sam.choose({ friendsGive: true });
    expect((await alex.state()).activity).toMatchObject([{ friend: sam.id, title: "Film 5" }]);
  });

  it("is off to begin with: nothing is given or got until it is turned on", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ progress: [card(1, 600)] });
    expect((await sam.state()).activity).toEqual([]);
    expect((await sam.state()).friends[0]).toMatchObject({ activity: false });
  });

  it("is only about the last two weeks", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    await alex.keep({ progress: [card(1, 600), card(2, 600, { at: clock.now - ACTIVITY_KEEP_MS - 1000 })] });
    expect((await sam.state()).activity.map((item) => item.title)).toEqual(["Film 1"]);
  });

  it("says how far into it they are, in whole percent: all of it for what was finished, nothing for a length that is not known", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    const episode = card(3, 1500, { key: "show:The Long Night", title: "The Long Night", url: "https://shows.example/watch/7?s=2&e=5", season: 2, episode: 5, duration: 2400 });
    await alex.keep({ progress: [card(1, 600), card(2, 900, { done: true }), episode, card(4, 100, { duration: 0 })] });
    const byTitle = Object.fromEntries((await sam.state()).activity.map((item) => [item.title, item]));
    expect(byTitle["Film 1"]).toMatchObject({ percent: 8 }); // (600 of 7200 seconds)
    expect(byTitle["Film 2"]).toMatchObject({ percent: 100, done: true });
    expect(byTitle["The Long Night"]).toMatchObject({ percent: 63, season: 2, episode: 5 });
    expect(byTitle["Film 4"]).not.toHaveProperty("percent");
  });
});

describe("how far a friend got in the titles they keep and rate", () => {
  const SHOW = "https://shows.example/watch/7";
  const first = `${SHOW}?s=1&e=1`;
  const saved = (link: string, title: string) => ({ key: `url:${link}`, at: 5000, id: title, title, url: link });
  const rated = (link: string, title: string) => ({ key: `rate:${link}`, at: 7000, title, url: link, score: 9, ratedAt: 7000 });
  const watched = (extra: Record<string, unknown>) => ({ at: clock.now - 60_000, position: 600, duration: 7200, ...extra });
  const film = watched({ key: `url:${url(1)}`, title: "Film 1", url: url(1) });
  const episode = watched({ key: "show:The Long Night", title: "The Long Night", url: `${SHOW}?s=2&e=5`, season: 2, episode: 5, position: 1500, duration: 2400 });
  const stranger = watched({ key: `url:${url(9)}`, title: "Film 9", url: url(9) });

  it("is told with the lists and the ratings of a friend who tells what they watch: the latest episode of a show, how far into it, and only for the titles that are there", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    await alex.keep({ list: [saved(url(1), "Film 1"), saved(first, "The Long Night")], ratings: [rated(first, "The Long Night")], progress: [film, episode, stranger] });

    const lists = (await sam.client.get(mine(sam, `/${alex.id}/lists`))).data;
    expect(lists.progress).toHaveLength(2);
    expect(lists.progress).toContainEqual({ link: url(1), percent: 8 });
    expect(lists.progress).toContainEqual({ link: first, season: 2, episode: 5, percent: 63 }); // (the show is found by its first episode's address, whichever episode the card is of)
    const ratings = (await sam.client.get(mine(sam, `/${alex.id}/ratings`))).data;
    expect(ratings.progress).toEqual([{ link: first, season: 2, episode: 5, percent: 63 }]);
  });

  it("is a finished title as finished, and the newest card when two are of the same title", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    const older = { ...film, key: `url:${url(1)}#older`, at: film.at - 60_000, position: 7000 };
    await alex.keep({ list: [saved(url(1), "Film 1")], progress: [older, { ...film, done: true }] });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data.progress).toEqual([{ link: url(1), percent: 100, done: true }]);
  });

  it("is not counted for a few seconds of a title and away again, but a title that was finished is, however short", async () => {
    const { alex, sam } = await friends({ friendsGive: true, friendsGet: true });
    await alex.keep({
      list: [saved(url(1), "Film 1"), saved(url(2), "Film 2"), saved(url(3), "Film 3")],
      progress: [
        { ...film, position: 20 }, // (20 seconds of the first film)
        { ...watched({ key: `url:${url(2)}`, title: "Film 2", url: url(2) }), position: 40, done: true }, // (the second was finished: all of it)
        { ...watched({ key: `url:${url(3)}`, title: "Film 3", url: url(3) }), position: 30, at: film.at - 1000 }, // (the third: also a few seconds)
      ],
    });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data.progress).toEqual([{ link: url(2), percent: 100, done: true }]);
  });

  it("is not told unless the friend gives what they watch and this profile gets it: the lists and the ratings come without it", async () => {
    const { alex, sam } = await friends();
    await alex.keep({ list: [saved(url(1), "Film 1")], ratings: [rated(url(1), "Film 1")], progress: [film] });
    for (const path of ["lists", "ratings"]) expect((await sam.client.get(mine(sam, `/${alex.id}/${path}`))).data, path).not.toHaveProperty("progress");

    await alex.choose({ friendsGive: true });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data).not.toHaveProperty("progress"); // (given, but not got)
    await sam.choose({ friendsGet: true });
    expect((await sam.client.get(mine(sam, `/${alex.id}/lists`))).data.progress).toHaveLength(1);
    await alex.choose({ friendsGive: false });
    expect((await sam.client.get(mine(sam, `/${alex.id}/ratings`))).data).not.toHaveProperty("progress");
  });
});

describe("who is online", () => {
  const onlineIn = async (who: Person) => (await who.state()).friends.map((friend) => Boolean(friend.online));

  it("is a friend whose screen has looked at its friends lately, and not before it has, or once it has not for a while", async () => {
    const { alex, sam } = await friends();
    expect(await onlineIn(sam)).toEqual([false]); // (alex has not looked yet; sam's own look is no sign of alex)
    await alex.state();
    expect(await onlineIn(sam)).toEqual([true]);
    expect(await onlineIn(alex)).toEqual([true]); // (sam looked a moment ago)

    clock.now += ONLINE_MS - 1000;
    expect(await onlineIn(sam)).toEqual([true]);
    clock.now += 2000; // (alex's last look is past ONLINE_MS now; sam's own was just made)
    expect(await onlineIn(sam)).toEqual([false]);
    await alex.state();
    expect(await onlineIn(sam)).toEqual([true]);
  });

  it("is never shown by a profile that chose not to be, and nobody is shown to it", async () => {
    const { alex, sam } = await friends();
    await alex.choose({ friendsPresence: false });
    await alex.state();
    await sam.state();
    expect(await onlineIn(sam)).toEqual([false]); // alex looks, but does not show
    expect(await onlineIn(alex)).toEqual([false]); // sam is there, but alex does not see
    await alex.choose({ friendsPresence: true });
    await alex.state();
    expect(await onlineIn(sam)).toEqual([true]);
    expect(await onlineIn(alex)).toEqual([true]);
  });

  it("is hidden at once when a profile turns it off, before its screen has looked again, and a look made before does not count after it is turned back on", async () => {
    const { alex, sam } = await friends();
    await alex.state();
    expect(await onlineIn(sam)).toEqual([true]);
    await alex.choose({ friendsPresence: false });
    expect(await onlineIn(sam)).toEqual([false]); // (the switch alone hides it)
    await alex.state(); // (the first look after it is off drops what was known)
    await alex.choose({ friendsPresence: true });
    expect(await onlineIn(sam)).toEqual([false]); // (not a screen of alex's has looked since)
    await alex.state();
    expect(await onlineIn(sam)).toEqual([true]);
  });

  it("is nobody who has friends turned off altogether, though they looked a moment ago", async () => {
    const { alex, sam } = await friends();
    await alex.state();
    await alex.choose({ friends: false });
    expect((await sam.state()).friends[0]).toMatchObject({ on: false });
    expect((await sam.state()).friends[0]).not.toHaveProperty("online");
  });
});

describe("keeping friends", () => {
  it("is still there after the server restarts", async () => {
    const persistence = new MemoryPersistence();
    const first = await start(persistence);
    const alex = await person(first.app, "alex");
    const sam = await person(first.app, "sam");
    await alex.choose({ friends: true });
    await sam.choose({ friends: true });
    const { data: made } = await alex.client.post(mine(alex, "/invites"));
    const { data: open } = await alex.client.post(mine(alex, "/invites"));
    await sam.client.post(mine(sam, "/accept"), { code: made.code });
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "Dune", url: url(1) });
    const robin = await person(first.app, "robin");
    await robin.choose({ friends: true });
    expect((await robin.client.post(mine(robin, "/requests"), { tag: `Sam#${sam.tag}` })).statusCode).toBe(201);
    await first.store.flush();

    const second = await start(persistence);
    const back = new Client(second.app);
    // (Sessions are kept too, so the same cookie still opens the same account.)
    back.cookie = sam.client.cookie;
    const state = (await back.get(mine(sam))).data as FriendsState;
    expect(state.friends.map((friend) => friend.name)).toEqual(["Alex"]);
    expect(state.inbox).toMatchObject([{ title: "Dune", from: alex.id }]);
    // A request that waits for an answer, and the tags, are kept too.
    expect(state.requests).toMatchObject([{ from: { id: robin.id, name: "Robin", tag: robin.tag } }]);
    const backRobin = new Client(second.app);
    backRobin.cookie = robin.client.cookie;
    expect(((await backRobin.get(mine(robin))).data as FriendsState).sent).toMatchObject([{ to: { id: sam.id, tag: sam.tag } }]);
    const backAlex = new Client(second.app);
    backAlex.cookie = alex.client.cookie;
    expect(((await backAlex.get(mine(alex))).data as FriendsState).invites.map((invite) => invite.code)).toEqual([open.code]);
  });

  /** Somebody's friend, who has sent them something. */
  async function befriend(of: Person, who: Person, title: string) {
    await who.choose({ friends: true });
    const { data: made } = await who.client.post(mine(who, "/invites"));
    expect((await of.client.post(mine(of, "/accept"), { code: made.code })).statusCode).toBe(201);
    await who.client.post(mine(who, "/send"), { to: [of.id], kind: "recommend", title, url: url(title.length) });
  }

  it("lets go of a profile that is deleted, with everything it had to do with friends", async () => {
    const { app, alex, sam, store } = await friends();
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "Dune", url: url(1) });
    // One account, two profiles: the second is the one that goes, and the first stays Sam's friend.
    const robin = await person(app, "robin");
    const added = await robin.client.post("/api/profiles", { name: "Second" });
    const second = profileOf(robin.client, added.data.profiles.find((profile: { name: string }) => profile.name === "Second"));
    await befriend(sam, second, "Alien");
    expect((await sam.state()).friends.map((friend) => friend.name).sort()).toEqual(["Alex", "Second"]);

    expect((await robin.client.delete(`/api/profiles/${second.id}`)).statusCode).toBe(200);
    const after = await sam.state();
    expect(after.friends.map((friend) => friend.name)).toEqual(["Alex"]);
    expect(after.inbox.map((item) => item.kind === "recommend" && item.title)).toEqual(["Dune"]);
    expect(store.friends.friendsOf(second.id)).toEqual([]);
  });

  it("lets go of an account that is deleted, with everything its profiles had to do with friends", async () => {
    const { app, alex, sam, store } = await friends();
    await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "recommend", title: "Dune", url: url(1) });
    const gone = await person(app, "gone");
    await befriend(sam, gone, "Alien");
    const open = await gone.client.post(mine(gone, "/invites"));
    expect((await sam.state()).friends).toHaveLength(2);

    expect((await gone.client.post("/api/me/delete", { password: "x" })).statusCode).toBe(204);
    const after = await sam.state();
    expect(after.friends.map((friend) => friend.name)).toEqual(["Alex"]);
    expect(after.inbox.map((item) => item.kind === "recommend" && item.title)).toEqual(["Dune"]);
    expect(store.friends.friendsOf(gone.id)).toEqual([]);
    expect(store.friends.peekInvite(open.data.code)).toBeUndefined();
  });
});
