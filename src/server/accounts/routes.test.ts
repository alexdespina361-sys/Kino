import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { describeDevice } from "./device";
import { LinkRegistry } from "./links";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const cheap = { N: 1024, r: 8, p: 1 } as const;

async function start(options: { registration?: "open" | "closed"; maxAccounts?: number; persistence?: MemoryPersistence } = {}) {
  const store = await AccountStore.open({ persistence: options.persistence ?? new MemoryPersistence(), flushMs: 0 });
  const app = await buildApp({
    accounts: store,
    passwordCost: cheap,
    ...(options.registration ? { registration: options.registration } : {}),
    ...(options.maxAccounts ? { maxAccounts: options.maxAccounts } : {}),
  });
  apps.push(app);
  return { app, store };
}

/** One browser: it keeps its cookie, and sends it back. */
class Client {
  cookie = "";
  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string> = {},
  ) {}

  async call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<LightMyRequestResponse & { data: any }> {
    const response = await this.app.inject({
      method,
      url,
      headers: { ...this.headers, ...(this.cookie ? { cookie: this.cookie } : {}) },
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
  patch = (url: string, payload: unknown) => this.call("PATCH", url, payload);
  delete = (url: string) => this.call("DELETE", url);
}

const credentials = { email: "alex@example.com", password: "correct horse" };

async function signedUp(app: FastifyInstance, email = credentials.email) {
  const client = new Client(app, { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36" });
  const response = await client.post("/api/auth/register", { email, password: credentials.password });
  expect(response.statusCode).toBe(201);
  return { client, me: response.data };
}

describe("signing up and in", () => {
  it("makes an account, signs in with a cookie scripts cannot read, and answers who is signed in", async () => {
    const { app } = await start();
    const client = new Client(app);
    expect((await client.get("/api/me")).data).toEqual({ me: null, registration: "open" });

    const registered = await client.post("/api/auth/register", { email: " Alex@Example.com ", password: credentials.password });
    expect(registered.statusCode).toBe(201);
    expect(registered.data.account.email).toBe("alex@example.com");
    expect(registered.data.profiles).toMatchObject([{ name: "Alex", avatar: "fox" }]);
    const cookie = String(registered.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
    expect(registered.headers["cache-control"]).toBe("no-store");

    expect((await client.get("/api/me")).data.me.account.email).toBe("alex@example.com");
  });

  it("marks the cookie Secure when the visitor came over https through a proxy it trusts", async () => {
    const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const app = await buildApp({ accounts: store, passwordCost: cheap, trustProxy: 1 });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: credentials, headers: { "x-forwarded-proto": "https" } });
    expect(String(response.headers["set-cookie"])).toMatch(/; Secure/);
  });

  it("signs in on another device, and out again", async () => {
    const { app } = await start();
    await signedUp(app);
    const other = new Client(app);
    expect((await other.post("/api/auth/login", { email: credentials.email, password: "wrong password" })).data).toEqual({ error: "invalid_credentials" });
    expect((await other.post("/api/auth/login", { email: "nobody@example.com", password: credentials.password })).statusCode).toBe(401);
    const login = await other.post("/api/auth/login", { ...credentials, device: "remote" });
    expect(login.statusCode).toBe(200);
    expect((await other.get("/api/me")).data.me).not.toBeNull();

    expect((await other.post("/api/auth/logout")).statusCode).toBe(204);
    expect((await other.get("/api/me")).data.me).toBeNull();
  });

  it("asks for a real address and a password worth having, and for each address only once", async () => {
    const { app } = await start();
    const client = new Client(app);
    expect((await client.post("/api/auth/register", { email: "nope", password: credentials.password })).data).toEqual({ error: "invalid_email" });
    expect((await client.post("/api/auth/register", { email: "a@b.co", password: "short" })).data).toEqual({ error: "weak_password" });
    expect((await client.post("/api/auth/register", { nonsense: true })).statusCode).toBe(400);
    await signedUp(app);
    const again = await client.post("/api/auth/register", credentials);
    expect(again.statusCode).toBe(409);
    expect(again.data).toEqual({ error: "email_taken" });
  });

  it("can be closed to newcomers, or full", async () => {
    const closed = await start({ registration: "closed" });
    expect((await new Client(closed.app).get("/api/me")).data.registration).toBe("closed");
    const refused = await new Client(closed.app).post("/api/auth/register", credentials);
    expect(refused).toMatchObject({ statusCode: 403, data: { error: "registration_closed" } });

    const full = await start({ maxAccounts: 1 });
    await signedUp(full.app);
    expect((await new Client(full.app).get("/api/me")).data.registration).toBe("closed");
    expect((await new Client(full.app).post("/api/auth/register", { email: "b@example.com", password: credentials.password })).statusCode).toBe(403);
  });

  it("slows down someone guessing a password, whoever they guess from", async () => {
    const { app } = await start();
    await signedUp(app);
    const guesser = new Client(app);
    for (let i = 0; i < 10; i++) expect((await guesser.post("/api/auth/login", { email: credentials.email, password: `guess ${i}` })).statusCode).toBe(401);
    const blocked = await guesser.post("/api/auth/login", credentials);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("answers without a session as signed out", async () => {
    const { app } = await start();
    const client = new Client(app);
    for (const url of ["/api/sessions"]) expect((await client.get(url)).statusCode).toBe(401);
    expect((await client.post("/api/profiles", { name: "X" })).statusCode).toBe(401);
    expect((await client.post("/api/profiles/pro_x/sync", { since: 0 })).statusCode).toBe(401);
  });
});

describe("the account", () => {
  it("changes the password, signs the other devices out, and keeps this one", async () => {
    const { app } = await start();
    const { client } = await signedUp(app);
    const tv = new Client(app);
    await tv.post("/api/auth/login", credentials);

    expect((await client.post("/api/me/password", { current: "not it", next: "a brand new one" })).statusCode).toBe(401);
    expect((await client.post("/api/me/password", { current: credentials.password, next: "short" })).data).toEqual({ error: "weak_password" });
    expect((await client.post("/api/me/password", { current: credentials.password, next: "a brand new one" })).statusCode).toBe(204);

    expect((await client.get("/api/me")).data.me).not.toBeNull();
    expect((await tv.get("/api/me")).data.me).toBeNull();
    expect((await new Client(app).post("/api/auth/login", credentials)).statusCode).toBe(401);
    expect((await new Client(app).post("/api/auth/login", { ...credentials, password: "a brand new one" })).statusCode).toBe(200);
  });

  it("deletes the account only for whoever knows the password", async () => {
    const { app, store } = await start();
    const { client } = await signedUp(app);
    expect((await client.post("/api/me/delete", { password: "not it" })).statusCode).toBe(401);
    expect(store.countAccounts()).toBe(1);
    expect((await client.post("/api/me/delete", { password: credentials.password })).statusCode).toBe(204);
    expect(store.countAccounts()).toBe(0);
    expect((await client.get("/api/me")).data.me).toBeNull();
    expect((await new Client(app).post("/api/auth/login", credentials)).statusCode).toBe(401);
  });

  it("lists the devices, and ends one, or all but this", async () => {
    const { app } = await start();
    const { client } = await signedUp(app);
    const phone = new Client(app, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Safari/604.1" });
    await phone.post("/api/auth/login", { ...credentials, device: "remote" });
    const tv = new Client(app);
    await tv.post("/api/auth/login", { ...credentials, device: "tv" });

    const list = (await client.get("/api/sessions")).data as Array<{ id: string; kind: string; label: string; current: boolean }>;
    expect(list.map((s) => [s.kind, s.label, s.current]).sort()).toEqual([
      ["browser", "Chrome on Windows", true],
      ["remote", "Safari on iPhone", false],
      ["tv", "Browser", false],
    ]);

    const phoneSession = list.find((s) => s.kind === "remote")!;
    expect((await client.delete(`/api/sessions/${phoneSession.id}`)).statusCode).toBe(204);
    expect((await phone.get("/api/me")).data.me).toBeNull();
    expect((await client.delete(`/api/sessions/${phoneSession.id}`)).statusCode).toBe(404);

    expect((await client.delete("/api/sessions")).statusCode).toBe(204);
    expect((await tv.get("/api/me")).data.me).toBeNull();
    expect((await client.get("/api/me")).data.me).not.toBeNull();
  });
});

describe("profiles", () => {
  it("makes, renames and removes them, up to five", async () => {
    const { app } = await start();
    const { client, me } = await signedUp(app);
    const first = me.profiles[0].id as string;

    const added = await client.post("/api/profiles", { name: "Kids" });
    expect(added.statusCode).toBe(201);
    expect(added.data.profiles.map((p: { name: string; avatar: string }) => [p.name, p.avatar])).toEqual([["Alex", "fox"], ["Kids", "cat"]]);

    expect((await client.post("/api/profiles", { name: "kids" })).data).toEqual({ error: "name_taken" });
    expect((await client.post("/api/profiles", { name: "   " })).data).toEqual({ error: "invalid_name" });
    expect((await client.post("/api/profiles", { name: "Way too long a name to fit" })).data).toEqual({ error: "invalid_name" });

    const renamed = await client.patch(`/api/profiles/${first}`, { name: "Alexandra", avatar: "robot" });
    expect(renamed.data.profiles[0]).toMatchObject({ name: "Alexandra", avatar: "robot" });

    for (const name of ["Two", "Three", "Four"]) expect((await client.post("/api/profiles", { name })).statusCode).toBe(201);
    expect((await client.post("/api/profiles", { name: "Six" })).data).toEqual({ error: "profile_limit" });

    const kids = added.data.profiles[1].id as string;
    expect((await client.delete(`/api/profiles/${kids}`)).data.profiles).toHaveLength(4);
    expect((await client.delete(`/api/profiles/${kids}`)).statusCode).toBe(404);
  });

  it("keeps one account out of another's profiles", async () => {
    const { app } = await start();
    const mine = await signedUp(app);
    const theirs = await signedUp(app, "sam@example.com");
    const theirProfile = theirs.me.profiles[0].id as string;
    expect((await mine.client.patch(`/api/profiles/${theirProfile}`, { name: "Hacked" })).statusCode).toBe(404);
    expect((await mine.client.delete(`/api/profiles/${theirProfile}`)).statusCode).toBe(404);
    expect((await mine.client.post(`/api/profiles/${theirProfile}/sync`, { since: 0 })).statusCode).toBe(404);
  });
});

describe("keeping what was watched", () => {
  const film = (at: number, position: number) => ({ key: "url:https://x/film", at, title: "Film", url: "https://x/film", position, duration: 100 });

  it("shares a profile's progress between two devices", async () => {
    const { app } = await start();
    const { client: phone, me } = await signedUp(app);
    const profile = me.profiles[0].id as string;
    const tv = new Client(app);
    await tv.post("/api/auth/login", credentials);

    const at = Date.now();
    const sent = await phone.post(`/api/profiles/${profile}/sync`, { since: 0, progress: [film(at, 40)], settings: [{ key: "lang", at, value: "ro" }] });
    expect(sent.data).toMatchObject({ rev: 1, progress: [], settings: [] });

    const received = await tv.post(`/api/profiles/${profile}/sync`, { since: 0 });
    expect(received.data).toMatchObject({ rev: 1, progress: [{ title: "Film", position: 40 }], settings: [{ key: "lang", value: "ro" }] });

    const later = await tv.post(`/api/profiles/${profile}/sync`, { since: 1, progress: [film(at + 5000, 90)] });
    expect(later.data.rev).toBe(2);
    expect((await phone.post(`/api/profiles/${profile}/sync`, { since: 1 })).data.progress).toMatchObject([{ position: 90 }]);
  });

  it("refuses what is not a sync", async () => {
    const { app } = await start();
    const { client, me } = await signedUp(app);
    const profile = me.profiles[0].id as string;
    expect((await client.post(`/api/profiles/${profile}/sync`, { since: -1 })).statusCode).toBe(400);
    expect((await client.post(`/api/profiles/${profile}/sync`, { since: 0, progress: [{ key: "x" }] })).statusCode).toBe(400);
    expect((await client.post(`/api/profiles/${profile}/sync`, { since: 0, settings: [{ key: "evil", at: 1, value: 1 }] })).statusCode).toBe(400);
  });

  it("is still there after the server restarts", async () => {
    const persistence = new MemoryPersistence();
    const first = await start({ persistence });
    const { client, me } = await signedUp(first.app);
    const profile = me.profiles[0].id as string;
    await client.post(`/api/profiles/${profile}/sync`, { since: 0, progress: [film(Date.now(), 12)] });
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);

    const second = await start({ persistence });
    const again = new Client(second.app);
    // the cookie from before still works
    again.cookie = client.cookie;
    expect((await again.get("/api/me")).data.me.account.email).toBe(credentials.email);
    expect((await again.post(`/api/profiles/${profile}/sync`, { since: 0 })).data.progress).toMatchObject([{ position: 12 }]);
  });
});

describe("signing a TV in from a phone", () => {
  async function tvAsksForCode(app: FastifyInstance) {
    const tv = new Client(app, { "user-agent": "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/94.0 Safari/537.36" });
    const started = await tv.post("/api/link/start", { device: "tv" });
    expect(started.statusCode).toBe(201);
    return { tv, ...(started.data as { code: string; secret: string; expiresAt: number }) };
  }

  it("lets a signed-in phone approve a TV, which is then signed in as that account", async () => {
    const { app } = await start();
    const { client: phone } = await signedUp(app);
    const { tv, code, secret } = await tvAsksForCode(app);

    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await tv.post("/api/link/poll", { code, secret })).data).toEqual({ status: "waiting" });
    expect((await tv.get("/api/me")).data.me).toBeNull();

    const seen = await phone.get(`/api/link/${code}`);
    expect(seen.data).toMatchObject({ code, kind: "tv", label: "Chrome on LG TV" });
    expect((await phone.post(`/api/link/${code}/approve`)).statusCode).toBe(204);

    const done = await tv.post("/api/link/poll", { code, secret });
    expect(done.data).toMatchObject({ status: "approved", me: { account: { email: credentials.email }, profiles: [{ name: "Alex" }] } });
    expect((await tv.get("/api/me")).data.me.account.email).toBe(credentials.email);
    const devices = (await phone.get("/api/sessions")).data as Array<{ kind: string; label: string }>;
    expect(devices.map((d) => [d.kind, d.label])).toContainEqual(["tv", "Chrome on LG TV"]);

    // handed over once only
    expect((await tv.post("/api/link/poll", { code, secret })).data).toEqual({ status: "gone" });
  });

  it("gives nothing to anyone who has only the code from the screen, or when the phone says no", async () => {
    const { app } = await start();
    const { client: phone } = await signedUp(app);
    const { tv, code, secret } = await tvAsksForCode(app);

    const onlookerClient = new Client(app);
    expect((await onlookerClient.post("/api/link/poll", { code, secret: "guess" })).data).toEqual({ status: "gone" });
    expect((await onlookerClient.get(`/api/link/${code}`)).statusCode).toBe(401);
    expect((await onlookerClient.post(`/api/link/${code}/approve`)).statusCode).toBe(401);

    expect((await phone.post(`/api/link/${code}/deny`)).statusCode).toBe(204);
    expect((await tv.post("/api/link/poll", { code, secret })).data).toEqual({ status: "denied" });
    expect((await tv.get("/api/me")).data.me).toBeNull();
    expect((await phone.post(`/api/link/${code}/approve`)).statusCode).toBe(404);
  });

  it("forgets a request that was not approved in time", async () => {
    let clock = 1_000_000;
    const links = new LinkRegistry(() => clock);
    const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const app = await buildApp({ accounts: store, passwordCost: cheap });
    apps.push(app);
    // the registry used by the app is its own; test the expiry on one built the same way
    const started = links.start("tv", "TV")!;
    expect(links.peek(started.code)).toBeDefined();
    clock += 5 * 60_000 + 1;
    expect(links.peek(started.code)).toBeUndefined();
    expect(links.claim(started.code, started.secret)).toEqual({ status: "gone" });
  });

  it("accepts the code however it was typed", async () => {
    const links = new LinkRegistry();
    const started = links.start("tv", "TV")!;
    const typed = `${started.code.slice(0, 4).toLowerCase()}-${started.code.slice(4)}`;
    expect(links.peek(typed)?.code).toBe(started.code);
  });
});

describe("describeDevice", () => {
  it("names the browser and the system", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe("Safari on Mac");
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")).toBe("Firefox on Linux");
    expect(describeDevice("Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/5.0 Chrome/94 TV Safari/537.36")).toBe("Samsung Internet on Samsung TV");
    expect(describeDevice(undefined)).toBe("Browser");
  });
});
