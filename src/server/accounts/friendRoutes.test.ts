import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVITY_KEEP_MS, INVITE_TTL_MS, MAX_OPEN_INVITES, ONLINE_MS, type FriendsState } from "../../shared";
import { buildApp } from "../app";
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
  const app = await buildApp({ accounts: store, passwordCost: cheap });
  apps.push(app);
  return { app, store, persistence };
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
function profileOf(client: Client, profile: { id: string; name: string }): Person {
  const sync = (body: Record<string, unknown>) => client.post(`/api/profiles/${profile.id}/sync`, { since: 0, ...body });
  const me: Person = {
    client,
    id: profile.id,
    name: profile.name,
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
    expect(await alex.state()).toEqual({ friends: [], inbox: [], activity: [], invites: [] });
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
    const invitation = { to: [sam.id], kind: "party", code: "123456", endsAt: clock.now + 600_000 };
    for (let i = 0; i < 60; i++) expect((await alex.client.post(mine(alex, "/send"), invitation)).statusCode).toBe(200);
    expect((await alex.client.post(mine(alex, "/send"), invitation)).statusCode).toBe(429);

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

  it("invites to a watch party with its code", async () => {
    const { alex, sam } = await friends();
    const invited = await alex.client.post(mine(alex, "/send"), { to: [sam.id], kind: "party", code: "482731", endsAt: clock.now + 600_000 });
    expect(invited.data.sent).toEqual([sam.id]);
    expect((await sam.state()).inbox).toMatchObject([{ kind: "party", from: alex.id, code: "482731", read: false }]);
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
    await first.store.flush();

    const second = await start(persistence);
    const back = new Client(second.app);
    // (Sessions are kept too, so the same cookie still opens the same account.)
    back.cookie = sam.client.cookie;
    const state = (await back.get(mine(sam))).data as FriendsState;
    expect(state.friends.map((friend) => friend.name)).toEqual(["Alex"]);
    expect(state.inbox).toMatchObject([{ title: "Dune", from: alex.id }]);
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
