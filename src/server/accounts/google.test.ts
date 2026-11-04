import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../app";
import { googleFromEnv, postForm, profileNameOf, REAUTH_MS, type GoogleConfig } from "./google";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

/**
 * "Continue with Google" against a Google of this file's own: a server on 127.0.0.1 that answers the token endpoint the way Google does (and the ways it should not),
 * for codes this file gives out as Google's sign-in page would. Nothing here reaches the real Google: the address of its sign-in page is only read, never visited.
 */

const cheap = { N: 1024, r: 8, p: 1 } as const;
const CLIENT_ID = "kino-test-client.apps.example";
const CLIENT_SECRET = "test-client-secret-that-is-not-real";
const SITE = "kino.test";
const OTHER = "kino-other.test";
const FROM_GOOGLE = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
/** Google's number for a person is about 21 digits: these cannot turn up in an answer by chance. */
const ANA = "110248000000000000000001";
const BEN = "110248000000000000000002";

/* ------------------------------ a Google of our own ------------------------------ */

type Answer = "ok" | "status" | "slow" | "huge" | "html" | "broken" | "redirect" | "noToken";
interface Issued {
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const jwt = (claims: unknown) => `${b64({ alg: "RS256", kid: "test", typ: "JWT" })}.${b64(claims)}.${b64("not a real signature")}`;

class FakeGoogle {
  server!: Server;
  origin = "";
  answer: Answer = "ok";
  /** Google takes a code once; a test that has to see what this server does with one twice turns that off. */
  reusable = false;
  readonly codes = new Map<string, Issued>();
  readonly forms: URLSearchParams[] = [];
  /** How often the address a redirect of the token endpoint points to was asked for (it must never be: a redirect is not followed). */
  redirectedTo = 0;
  /** What must never reach a browser: the client's secret, the codes, the verifiers, the tokens and the people's numbers. */
  readonly secrets = new Set<string>([CLIENT_SECRET]);

  async open() {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** What Google's sign-in page does when the person picks their account: a code for this flow. */
  issue(issued: Issued): string {
    const code = `4/0A${randomBytes(18).toString("base64url")}`;
    this.codes.set(code, issued);
    this.secrets.add(code);
    if (typeof issued.claims.sub === "string" && issued.claims.sub) this.secrets.add(issued.claims.sub);
    return code;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.on("error", () => {});
    if (request.url === "/elsewhere") {
      this.redirectedTo++;
      return void response.writeHead(200, { "content-type": "application/json" }).end("{}");
    }
    if (request.method !== "POST" || request.url !== "/token") return void response.writeHead(404).end();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    this.forms.push(form);
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    this.secrets.add(verifier);
    const issued = this.codes.get(code);
    const right =
      issued &&
      form.get("client_id") === CLIENT_ID &&
      form.get("client_secret") === CLIENT_SECRET &&
      form.get("grant_type") === "authorization_code" &&
      form.get("redirect_uri") === issued.redirectUri &&
      s256(verifier) === issued.challenge;
    if (!right) return void response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
    if (!this.reusable) this.codes.delete(code);
    const idToken = jwt(issued.claims);
    const access = `ya29.${randomBytes(12).toString("base64url")}`;
    this.secrets.add(idToken);
    this.secrets.add(access);
    const body = JSON.stringify({ access_token: access, expires_in: 3599, scope: "openid email profile", token_type: "Bearer", id_token: idToken });
    const json = { "content-type": "application/json; charset=utf-8" };
    switch (this.answer) {
      case "ok":
        return void response.writeHead(200, json).end(body);
      case "status":
        return void response.writeHead(500, json).end(body);
      case "slow":
        return void setTimeout(() => response.writeHead(200, json).end(body), 1500);
      case "huge":
        // (Sent in pieces with no length said, as a stream that does not end where it should would be.)
        response.writeHead(200, json);
        response.write(body.slice(0, -1));
        response.write(`, "padding": "${"x".repeat(70 * 1024)}"`);
        return void response.end("}");
      case "html":
        return void response.writeHead(200, { "content-type": "text/html" }).end(body);
      case "broken":
        return void response.writeHead(200, json).end(body.slice(0, -1));
      case "redirect":
        return void response.writeHead(302, { ...json, location: `${this.origin}/elsewhere` }).end(body);
      case "noToken":
        return void response.writeHead(200, json).end(JSON.stringify({ access_token: access, token_type: "Bearer" }));
    }
  }
}

const google = new FakeGoogle();
beforeAll(() => google.open());
afterAll(() => new Promise<void>((resolve) => google.server.close(() => resolve())));

/* ------------------------------ the site, and browsers ------------------------------ */

const clock = { now: 0 };
const apps: FastifyInstance[] = [];
/** Every answer a browser of these tests was given, to look for what must never be in one. */
const answers: LightMyRequestResponse[] = [];
beforeEach(() => {
  clock.now = Date.UTC(2026, 10, 5, 12);
  google.answer = "ok";
  google.reusable = false;
  google.redirectedTo = 0;
  google.forms.length = 0;
});
afterEach(async () => {
  const seen = answers.splice(0);
  for (const answer of seen) {
    const text = `${JSON.stringify(answer.headers)}\n${answer.body}`;
    for (const secret of google.secrets) expect(text.includes(secret), `an answer had a secret in it: ${text.slice(0, 200)}`).toBe(false);
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const config = (more: Partial<GoogleConfig> = {}): GoogleConfig => ({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUris: [`https://${SITE}/api/auth/google/callback`, `https://${OTHER}/api/auth/google/callback`, "http://127.0.0.1:8787/api/auth/google/callback"],
  tokenUrl: `${google.origin}/token`,
  timeoutMs: 300,
  ...more,
});

async function site(options: Omit<AppOptions, "google"> & { google?: GoogleConfig | null } = {}) {
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  const { google: given, ...rest } = options;
  const app = await buildApp({ accounts: store, passwordCost: cheap, trustProxy: 1, signUpsPerHour: 1000, ...(given === null ? {} : { google: given ?? config() }), ...rest });
  apps.push(app);
  return { app, store };
}

let addresses = 0;
const nextAddress = () => `203.0.${(++addresses >> 8) & 255}.${addresses & 255}`;

/** One browser, at one address of the site: it keeps its cookies (every one goes everywhere, which the server does not mind) and comes from an address of its own. */
class Browser {
  readonly jar = new Map<string, string>();
  constructor(
    private readonly app: FastifyInstance,
    private readonly host = SITE,
    private readonly https = true,
    readonly address = nextAddress(),
  ) {}

  async send(method: "GET" | "POST", url: string, payload?: object, headers: Record<string, string> = {}): Promise<LightMyRequestResponse & { data: any }> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.app.inject({
      method,
      url,
      headers: { host: this.host, "x-forwarded-for": this.address, ...(this.https ? { "x-forwarded-proto": "https" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(payload === undefined ? {} : { payload }),
    });
    answers.push(response);
    for (const line of [response.headers["set-cookie"] ?? []].flat()) {
      const [pair = ""] = line.split(";");
      const eq = pair.indexOf("=");
      const [name, value] = [pair.slice(0, eq), pair.slice(eq + 1)];
      if (!value || /Max-Age=0(;|$)/.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    let data: unknown;
    try {
      data = response.json();
    } catch {
      data = undefined;
    }
    return Object.assign(response, { data });
  }
  get = (url: string, headers?: Record<string, string>) => this.send("GET", url, undefined, headers);
  post = (url: string, payload: object = {}) => this.send("POST", url, payload);
}

const claimsFor = (nonce: string, sub: string) => ({
  iss: "https://accounts.google.com",
  azp: CLIENT_ID,
  aud: CLIENT_ID,
  sub,
  email: "ana.pop@gmail.example",
  email_verified: true,
  at_hash: "x",
  nonce,
  name: "Ana Pop",
  picture: "https://pictures.example/ana.png",
  given_name: "Ana",
  family_name: "Pop",
  iat: Math.floor(clock.now / 1000),
  exp: Math.floor(clock.now / 1000) + 3600,
});

interface Trip {
  mode?: "signin" | "link" | "reauth";
  device?: string;
  next?: string;
  sub?: string;
  /** Claims of the ID token instead of (or besides) the right ones; `undefined` leaves one out. */
  claims?: Record<string, unknown>;
  /** Something that happens while the person is at Google. */
  meanwhile?: () => void | Promise<void>;
}

/** A sign-in with Google, the way a browser goes through it: the button, Google's page (where the person picks their account), and the way back. */
async function viaGoogle(browser: Browser, trip: Trip = {}) {
  const query = new URLSearchParams({ device: trip.device ?? "remote", next: trip.next ?? "/", ...(trip.mode ? { mode: trip.mode } : {}) });
  const start = await browser.get(`/api/auth/google/start?${query}`, { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate" });
  expect(start.statusCode).toBe(302);
  const to = new URL(String(start.headers.location));
  const state = to.searchParams.get("state") ?? "";
  const claims: Record<string, unknown> = { ...claimsFor(to.searchParams.get("nonce") ?? "", trip.sub ?? ANA), ...trip.claims };
  for (const [name, value] of Object.entries(claims)) if (value === undefined) delete claims[name];
  const code = google.issue({ challenge: to.searchParams.get("code_challenge") ?? "", redirectUri: to.searchParams.get("redirect_uri") ?? "", claims });
  await trip.meanwhile?.();
  const back = await browser.get(`/api/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, FROM_GOOGLE);
  return { start, to, state, code, back, where: String(back.headers.location) };
}

/** A browser signed in with a password, on an account of that name. */
async function withPassword(app: FastifyInstance, login = "robert", password = "correct horse") {
  const browser = new Browser(app);
  expect((await browser.post("/api/auth/register", { email: login, password })).statusCode).toBe(201);
  return browser;
}

const meOf = async (browser: Browser) => (await browser.get("/api/me")).data.me;

/* ------------------------------ the tests ------------------------------ */

describe("signing in with Google", () => {
  it("makes an account for a new Google account: the browser goes to Google with a flow of its own and comes back signed in, with a profile named after the person", async () => {
    const { app, store } = await site();
    const browser = new Browser(app);
    expect((await browser.get("/api/me")).data).toEqual({ me: null, registration: "open", google: true });
    const { start, to, state, back, where } = await viaGoogle(browser);

    expect(`${to.origin}${to.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(to.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: `https://${SITE}/api/auth/google/callback`,
      scope: "openid email profile",
      state,
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(start.headers["set-cookie"]).toBe(`kino_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    expect(start.headers["cache-control"]).toBe("no-store");

    // What went to the token endpoint: the code with this client's secret and the verifier of the challenge Google was shown.
    const [form] = google.forms;
    expect(form && Object.fromEntries(form)).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: expect.any(String), code_verifier: expect.stringMatching(/^[\w-]{43}$/), redirect_uri: `https://${SITE}/api/auth/google/callback`, grant_type: "authorization_code" });
    expect(s256(form!.get("code_verifier")!)).toBe(to.searchParams.get("code_challenge"));

    expect([back.statusCode, where]).toEqual([302, "/"]);
    const cookies = [back.headers["set-cookie"] ?? []].flat();
    expect(cookies).toContain("kino_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
    expect(cookies.some((line) => line.startsWith("kino_session=") && line.includes("HttpOnly"))).toBe(true);
    expect(browser.jar.has("kino_oauth")).toBe(false);

    const me = await meOf(browser);
    expect(me.account).toEqual({ id: expect.any(String), email: expect.stringMatching(/^g-[a-z2-7]{12}$/), google: true, googleOnly: true });
    expect(me.profiles).toMatchObject([{ name: "Ana", avatar: "fox", tag: 1 }]);
    expect((await browser.get("/api/sessions")).data).toMatchObject([{ kind: "remote", current: true }]);
    // Of the person, only Google's number for them is kept: not their address, their names or their picture.
    const kept = JSON.stringify(store.getAccount(me.account.id));
    expect(kept).toContain(`"google":{"sub":"${ANA}","only":true}`);
    for (const word of ["gmail", "Pop", "picture", "email_verified"]) expect(kept).not.toContain(word);
  });

  it("signs the same Google account in to the same account again, from another device and as that device (no second account)", async () => {
    const { app, store } = await site();
    const phone = new Browser(app);
    await viaGoogle(phone);
    clock.now += 1000; // (so the list of devices has the TV first)
    const tv = new Browser(app);
    const { where } = await viaGoogle(tv, { device: "tv", next: "/tv" });
    expect(where).toBe("/tv");
    expect((await meOf(tv)).account.id).toBe((await meOf(phone)).account.id);
    expect(store.countAccounts()).toBe(1);
    expect((await tv.get("/api/sessions")).data.map((session: { kind: string; current: boolean }) => [session.kind, session.current])).toEqual([
      ["tv", true],
      ["remote", false],
    ]);
  });

  it("each address of the site has its own way back, and one on this machine over plain http has a cookie that is not Secure", async () => {
    const { app } = await site();
    const other = await viaGoogle(new Browser(app, OTHER));
    expect(other.to.searchParams.get("redirect_uri")).toBe(`https://${OTHER}/api/auth/google/callback`);
    expect(other.where).toBe("/");
    const local = new Browser(app, "127.0.0.1:8787", false);
    const here = await viaGoogle(local);
    expect(here.to.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8787/api/auth/google/callback");
    expect(String(here.start.headers["set-cookie"])).toBe(`kino_oauth=${here.state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600`);
    expect(here.where).toBe("/");
  });

  it("connects Google to an account with a password, which then signs in with either", async () => {
    const { app, store } = await site();
    const browser = await withPassword(app);
    const { where } = await viaGoogle(browser, { mode: "link" });
    expect(where).toBe("/?google=linked");
    const me = await meOf(browser);
    expect(me.account).toEqual({ id: me.account.id, email: "robert", google: true });
    expect(store.countAccounts()).toBe(1);

    const elsewhere = new Browser(app);
    await viaGoogle(elsewhere);
    expect((await meOf(elsewhere)).account.id).toBe(me.account.id);
    expect((await new Browser(app).post("/api/auth/login", { email: "robert", password: "correct horse" })).statusCode).toBe(200);
    // (Connecting it again is no change.)
    expect((await viaGoogle(browser, { mode: "link" })).where).toBe("/?google=linked");
  });

  it("deletes an account made with Google only after the person signed in to Google again on that device a moment before, and then that Google account is free again", async () => {
    const { app, store } = await site();
    const browser = new Browser(app);
    await viaGoogle(browser);
    const id = (await meOf(browser)).account.id;
    expect((await browser.post("/api/me/delete", { password: "" })).data).toEqual({ error: "reauth_required" });
    expect((await browser.post("/api/me/delete", {})).statusCode).toBe(403);
    expect(store.getAccount(id)).toBeDefined();

    const again = await viaGoogle(browser, { mode: "reauth" });
    expect(again.to.searchParams.get("prompt")).toBe("select_account");
    expect(again.to.searchParams.get("max_age")).toBe("0");
    expect(again.where).toBe("/?google=reauth");
    expect((await browser.post("/api/me/delete", {})).statusCode).toBe(204);
    expect(store.getAccount(id)).toBeUndefined();
    expect(await meOf(browser)).toBeNull();

    await viaGoogle(browser);
    const fresh = await meOf(browser);
    expect(fresh.account.id).not.toBe(id);
    expect(store.countAccounts()).toBe(1);
  });

  it("the proof of signing in again lasts five minutes, on that device only", async () => {
    const { app } = await site();
    const phone = new Browser(app);
    await viaGoogle(phone);
    const laptop = new Browser(app);
    await viaGoogle(laptop);
    await viaGoogle(phone, { mode: "reauth" });
    expect((await laptop.post("/api/me/delete")).statusCode).toBe(403);
    clock.now += REAUTH_MS + 1;
    expect((await phone.post("/api/me/delete")).statusCode).toBe(403);
    await viaGoogle(phone, { mode: "reauth" });
    expect((await phone.post("/api/me/delete")).statusCode).toBe(204);
  });

  it("an account with a password is still deleted with its password, Google or not", async () => {
    const { app } = await site();
    const browser = await withPassword(app);
    await viaGoogle(browser, { mode: "link" });
    expect((await browser.post("/api/me/delete", { password: "wrong" })).statusCode).toBe(401);
    expect((await browser.post("/api/me/delete", { password: "correct horse" })).statusCode).toBe(204);
  });
});

describe("what a sign-in with Google does not take", () => {
  it("a way back without the cookie of the browser that started it, or with another one's: nothing is made, and the flow is used up", async () => {
    const { app, store } = await site();
    // Somebody starts a sign-in with their own Google account and sends the way back, code and all, to somebody else.
    const attacker = new Browser(app);
    const start = await attacker.get("/api/auth/google/start?device=remote&next=/");
    const to = new URL(String(start.headers.location));
    const state = to.searchParams.get("state")!;
    const code = google.issue({ challenge: to.searchParams.get("code_challenge")!, redirectUri: to.searchParams.get("redirect_uri")!, claims: claimsFor(to.searchParams.get("nonce")!, BEN) });
    const link = `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(code)}`;

    const victim = new Browser(app);
    expect((await victim.get(link, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    expect(await meOf(victim)).toBeNull();
    // (Their own flow's cookie is no better.)
    await victim.get("/api/auth/google/start?device=remote&next=/");
    expect(victim.jar.get("kino_oauth")).not.toBe(state);
    expect((await victim.get(link, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    // And the flow is gone: not even the browser that started it can finish it now.
    expect((await attacker.get(link, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    expect(store.countAccounts()).toBe(0);
    expect(google.forms).toHaveLength(0);
  });

  it("a state nobody gave out, one that was used, and one that is too old", async () => {
    const { app, store } = await site();
    const browser = new Browser(app);
    browser.jar.set("kino_oauth", "made-up-state");
    expect((await browser.get("/api/auth/google/callback?state=made-up-state&code=4/0Amadeup", FROM_GOOGLE)).headers.location).toBe("/?google=failed");

    google.reusable = true; // (only this server's own memory of the flow can turn the second one away)
    const used = await viaGoogle(browser);
    expect(used.where).toBe("/");
    await browser.post("/api/auth/logout");
    browser.jar.set("kino_oauth", used.state);
    expect((await browser.get(`/api/auth/google/callback?state=${used.state}&code=${encodeURIComponent(used.code)}`, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    expect(await meOf(browser)).toBeNull();

    const late = await viaGoogle(browser, { sub: BEN, meanwhile: () => void (clock.now += 10 * 60_000 + 1000) });
    expect(late.where).toBe("/?google=failed");
    expect(store.countAccounts()).toBe(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ["another issuer", { iss: "https://accounts.google.example" }],
    ["another audience", { aud: "someone-elses-client" }],
    ["audiences of which this client is one", { aud: [CLIENT_ID, "another"] }],
    ["another authorized party", { azp: "someone-elses-client" }],
    ["another flow's nonce", { nonce: "the-nonce-of-another-flow" }],
    ["no nonce", { nonce: undefined }],
    ["one that has expired", { exp: Math.floor(Date.UTC(2026, 10, 5, 12) / 1000) - 61 }],
    ["no expiry", { exp: undefined }],
    ["no sub", { sub: undefined }],
    ["an empty sub", { sub: "" }],
    ["a sub that is not one", { sub: "1102 48</script>" }],
  ])("an ID token with %s is not taken", async (_what, claims) => {
    const { app, store } = await site();
    const browser = new Browser(app);
    expect((await viaGoogle(browser, { claims })).where).toBe("/?google=failed");
    expect(await meOf(browser)).toBeNull();
    expect(store.countAccounts()).toBe(0);
  });

  it("takes an ID token of either way Google writes its name, and one that expired less than a minute ago (the two clocks may differ that much)", async () => {
    const { app, store } = await site();
    expect((await viaGoogle(new Browser(app), { claims: { iss: "accounts.google.com" } })).where).toBe("/");
    expect((await viaGoogle(new Browser(app), { sub: BEN, claims: { exp: Math.floor(clock.now / 1000) - 30, azp: undefined } })).where).toBe("/");
    expect(store.countAccounts()).toBe(2);
  });

  // (RIGHT is the right claims for the flow: a token is three parts whatever is in them, and its second part is an object.)
  it.each(["not-a-token", "header.RIGHT", "header.RIGHT.signature.more", `header.${b64("null")}.signature`, `header.${b64("[]")}.signature`, "header.!!.signature"])(
    "an ID token that is not one (%s) is not taken",
    async (shape) => {
      const { app } = await site();
      const browser = new Browser(app);
      const start = await browser.get("/api/auth/google/start?device=remote&next=/");
      const to = new URL(String(start.headers.location));
      const token = shape.replace("RIGHT", b64(claimsFor(to.searchParams.get("nonce")!, ANA)));
      const answer = await withToken(token, () => browser.get(`/api/auth/google/callback?state=${to.searchParams.get("state")}&code=4/0Aany`, FROM_GOOGLE));
      expect([answer.statusCode, answer.headers.location]).toEqual([302, "/?google=failed"]);
      expect(await meOf(browser)).toBeNull();
    },
  );

  it("takes the same token in its right shape (what the test above changes is all that is wrong with it)", async () => {
    const { app } = await site();
    const browser = new Browser(app);
    const start = await browser.get("/api/auth/google/start?device=remote&next=/");
    const to = new URL(String(start.headers.location));
    const token = `header.${b64(claimsFor(to.searchParams.get("nonce")!, ANA))}.signature`;
    expect((await withToken(token, () => browser.get(`/api/auth/google/callback?state=${to.searchParams.get("state")}&code=4/0Aany`, FROM_GOOGLE))).headers.location).toBe("/");
  });

  it.each<[Answer, string]>([
    ["status", "an answer that is not 200"],
    ["slow", "an answer that takes longer than it may"],
    ["huge", "an answer bigger than 64 KB"],
    ["html", "an answer that is not JSON"],
    ["broken", "JSON that does not parse"],
    ["noToken", "no ID token in it"],
    ["redirect", "a redirect, which is not followed"],
  ])("Google's token endpoint giving %s (%s) signs nobody in", async (answer) => {
    const { app, store } = await site();
    google.answer = answer;
    const browser = new Browser(app);
    expect((await viaGoogle(browser)).where).toBe("/?google=failed");
    expect(await meOf(browser)).toBeNull();
    expect(store.countAccounts()).toBe(0);
    expect(google.redirectedTo).toBe(0);
  });

  it("says that the person said no at Google, and that something else went wrong there", async () => {
    const { app } = await site();
    const browser = new Browser(app);
    const start = await browser.get("/api/auth/google/start?device=remote&next=/tv");
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    expect((await browser.get(`/api/auth/google/callback?error=access_denied&state=${state}`, FROM_GOOGLE)).headers.location).toBe("/tv?google=denied");
    const again = new URL(String((await browser.get("/api/auth/google/start?device=remote&next=/")).headers.location)).searchParams.get("state");
    expect((await browser.get(`/api/auth/google/callback?error=server_error&state=${again}`, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    expect(browser.jar.has("kino_oauth")).toBe(false);
    expect(google.forms).toHaveLength(0);
  });

  it("does not take a missing or an overlong code to Google", async () => {
    const { app } = await site();
    const browser = new Browser(app);
    for (const code of ["", "&code=", `&code=${"x".repeat(2049)}`]) {
      const start = await browser.get("/api/auth/google/start?device=remote&next=/");
      const state = new URL(String(start.headers.location)).searchParams.get("state");
      expect((await browser.get(`/api/auth/google/callback?state=${state}${code}`, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    }
    expect(google.forms).toHaveLength(0);
  });

  it("sends the browser back to the phone's page or the TV's, and nowhere else", async () => {
    const { app } = await site();
    for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example", "/tv/../../x", "javascript:alert(1)", "/tv?x=1", ""]) {
      const browser = new Browser(app);
      expect((await viaGoogle(browser, { next })).where, next).toBe("/");
      expect((await new Browser(app, "elsewhere.test").get(`/api/auth/google/start?next=${encodeURIComponent(next)}`)).headers.location, next).toBe("/?google=unavailable");
    }
    expect((await new Browser(app).get("/api/auth/google/start?next=/tv&next=https://evil.example")).headers.location).not.toMatch(/evil/);
    expect((await viaGoogle(new Browser(app), { next: "/tv", sub: BEN })).where).toBe("/tv");
  });

  it("is not on at an address that is not one of the site's, nor at one of them over plain http, nor for a Host that is more than an address", async () => {
    const { app } = await site();
    const odd = [`${SITE}/x`, `someone@${SITE}`, `${SITE}?x`, `${SITE}#x`].map((host) => new Browser(app, host));
    for (const browser of [new Browser(app, "elsewhere.test"), new Browser(app, SITE, false), new Browser(app, `${SITE}:8443`), ...odd]) {
      const start = await browser.get("/api/auth/google/start?device=remote&next=/");
      expect([start.statusCode, start.headers.location, start.headers["set-cookie"]]).toEqual([302, "/?google=unavailable", undefined]);
      expect((await browser.get("/api/me")).data).toEqual({ me: null, registration: "open" });
    }
  });

  it("with Google off, its two routes only send the browser back saying so, and /api/me says nothing of Google", async () => {
    const { app } = await site({ google: null });
    const browser = new Browser(app);
    const start = await browser.get("/api/auth/google/start?device=remote&next=/tv");
    expect([start.statusCode, start.headers.location, start.headers["set-cookie"]]).toEqual([302, "/tv?google=unavailable", undefined]);
    browser.jar.set("kino_oauth", "x");
    expect((await browser.get("/api/auth/google/callback?state=x&code=y", FROM_GOOGLE)).headers.location).toBe("/?google=unavailable");
    expect((await browser.get("/api/me")).data).toEqual({ me: null, registration: "open" });
    expect(google.forms).toHaveLength(0);
  });

  it("makes no account while new ones may not be made, past the most there may be, or past the address's sign-ups for the hour; one that has its account signs in all the same", async () => {
    const closed = await site({ registration: "closed" });
    expect((await viaGoogle(new Browser(closed.app))).where).toBe("/?google=closed");
    expect(closed.store.countAccounts()).toBe(0);

    const full = await site({ maxAccounts: 1 });
    const first = new Browser(full.app);
    expect((await viaGoogle(first)).where).toBe("/");
    expect((await viaGoogle(new Browser(full.app), { sub: BEN })).where).toBe("/?google=closed");
    expect((await viaGoogle(new Browser(full.app))).where).toBe("/"); // (Ana's account is there: she signs in)
    expect(full.store.countAccounts()).toBe(1);

    const busy = await site({ signUpsPerHour: 1 });
    const address = nextAddress();
    expect((await viaGoogle(new Browser(busy.app, SITE, true, address))).where).toBe("/");
    expect((await viaGoogle(new Browser(busy.app, SITE, true, address), { sub: BEN })).where).toBe("/?google=busy");
    expect((await new Browser(busy.app, SITE, true, address).post("/api/auth/register", { email: "carol", password: "x" })).statusCode).toBe(429); // (one count for both)
    expect(busy.store.countAccounts()).toBe(1);
  });

  it("connects a Google account to one account only", async () => {
    const { app, store } = await site();
    await viaGoogle(new Browser(app)); // (Ana's Google account made an account of its own)
    const robert = await withPassword(app);
    expect((await viaGoogle(robert, { mode: "link" })).where).toBe("/?google=taken");
    expect((await meOf(robert)).account.google).toBeUndefined();
    expect((await viaGoogle(robert, { mode: "link", sub: BEN })).where).toBe("/?google=linked");
    const carol = await withPassword(app, "carol");
    expect((await viaGoogle(carol, { mode: "link", sub: BEN })).where).toBe("/?google=taken");
    // (And an account that has one is not given a second.)
    expect((await viaGoogle(robert, { mode: "link", sub: "110248000000000000000003" })).where).toBe("/?google=failed");
    expect(store.findByGoogle(BEN)?.email).toBe("robert");
    expect(store.findByGoogle("110248000000000000000003")).toBeUndefined();
  });

  it("connects and confirms only for the account that started it, signed in when the browser comes back", async () => {
    const { app, store } = await site();
    const nobody = new Browser(app);
    const start = await nobody.get("/api/auth/google/start?device=remote&next=/&mode=link");
    expect([start.headers.location, start.headers["set-cookie"]]).toEqual(["/?google=failed", undefined]);
    expect((await nobody.get("/api/auth/google/start?device=remote&next=/&mode=reauth")).headers.location).toBe("/?google=failed");

    const robert = await withPassword(app);
    const carolCookie = (await withPassword(app, "carol")).jar.get("kino_session")!;
    expect((await viaGoogle(robert, { mode: "link", meanwhile: async () => void (await robert.post("/api/auth/logout")) })).where).toBe("/?google=failed");
    expect((await robert.post("/api/auth/login", { email: "robert", password: "correct horse" })).statusCode).toBe(200);
    expect((await viaGoogle(robert, { mode: "link", meanwhile: () => void robert.jar.set("kino_session", carolCookie) })).where).toBe("/?google=failed");
    expect(store.findByGoogle(ANA)).toBeUndefined();

    const ana = new Browser(app);
    await viaGoogle(ana);
    const anaCookie = ana.jar.get("kino_session")!;
    expect((await viaGoogle(ana, { mode: "reauth", meanwhile: () => void ana.jar.set("kino_session", carolCookie) })).where).toBe("/?google=failed");
    ana.jar.set("kino_session", anaCookie);
    expect((await viaGoogle(ana, { mode: "reauth", sub: BEN })).where).toBe("/?google=failed"); // (another Google account than the one it was made with)
    expect((await ana.post("/api/me/delete")).statusCode).toBe(403);
    expect(google.forms.length).toBeGreaterThan(0);
  });

  it("an account made with Google cannot be opened with the password form, whatever is tried", async () => {
    const { app } = await site();
    const ana = new Browser(app);
    await viaGoogle(ana);
    const login = (await meOf(ana)).account.email as string;
    for (const password of ["", " ", "password", login, ANA, CLIENT_SECRET, "null", "undefined"]) {
      const tried = await new Browser(app).post("/api/auth/login", { email: login, password });
      expect([tried.statusCode, tried.data], password).toEqual([401, { error: "invalid_credentials" }]);
    }
    expect((await ana.post("/api/me/password", { current: "", next: "mine now" })).statusCode).toBe(401);
  });

  it("keeps 2000 flows at the most: the oldest is let go", async () => {
    const { app } = await site();
    const first = new Browser(app);
    const start = await first.get("/api/auth/google/start?device=remote&next=/");
    const to = new URL(String(start.headers.location));
    for (let n = 0; n < 2000; n++) await new Browser(app).get("/api/auth/google/start?device=remote&next=/");
    const code = google.issue({ challenge: to.searchParams.get("code_challenge")!, redirectUri: to.searchParams.get("redirect_uri")!, claims: claimsFor(to.searchParams.get("nonce")!, ANA) });
    expect((await first.get(`/api/auth/google/callback?state=${to.searchParams.get("state")}&code=${encodeURIComponent(code)}`, FROM_GOOGLE)).headers.location).toBe("/?google=failed");
    expect((await viaGoogle(new Browser(app))).where).toBe("/");
  }, 30_000);

  it("lets an address start 30 sign-ins in ten minutes", async () => {
    const { app } = await site();
    const browser = new Browser(app);
    for (let n = 0; n < 30; n++) expect((await browser.get("/api/auth/google/start?device=remote&next=/")).headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    const over = await browser.get("/api/auth/google/start?device=remote&next=/");
    expect([over.headers.location, over.headers["set-cookie"]]).toEqual(["/?google=busy", undefined]);
    expect((await new Browser(app).get("/api/auth/google/start?device=remote&next=/")).headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("is started only from this site's own pages, and its way back is let in from another site only as a navigation", async () => {
    const { app } = await site();
    const browser = new Browser(app);
    for (const headers of [
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
      { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" },
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" },
    ]) {
      const refused = await browser.get("/api/auth/google/start?device=remote&next=/", headers);
      expect([refused.statusCode, refused.data, refused.headers["set-cookie"]]).toEqual([403, { error: "cross_site" }, undefined]);
    }
    expect((await browser.get("/api/auth/google/start?device=remote&next=/", { "sec-fetch-site": "none", "sec-fetch-mode": "navigate" })).statusCode).toBe(302);
    for (const headers of [
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" },
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
      { "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" },
    ]) {
      expect((await browser.get("/api/auth/google/callback?state=x&code=y", headers)).statusCode).toBe(403);
    }
    expect((await viaGoogle(browser)).where).toBe("/");
  });

  it("writes no code, state, token or secret in the server's log, and says why a sign-in was refused", async () => {
    const lines: string[] = [];
    const { app } = await site({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) } } });
    const browser = new Browser(app);
    const done = await viaGoogle(browser);
    const refused = await viaGoogle(new Browser(app), { claims: { nonce: "another" } });
    expect(refused.where).toBe("/?google=failed");
    const log = lines.join("");
    expect(log).toContain("Google sign-in refused: the ID token.");
    for (const secret of [...google.secrets, done.state, done.code, refused.state, refused.code]) expect(log.includes(secret), `the log has ${secret.slice(0, 12)}...`).toBe(false);
  });
});

/** The token endpoint answers once with this in place of the ID token it would make. */
async function withToken<T>(token: string, run: () => Promise<T>): Promise<T> {
  const handle = google.server.listeners("request")[0] as (request: IncomingMessage, response: ServerResponse) => void;
  google.server.removeAllListeners("request");
  google.server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== "/token") return handle(request, response);
    request.resume();
    request.on("end", () => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id_token: token, token_type: "Bearer" })));
  });
  try {
    return await run();
  } finally {
    google.server.removeAllListeners("request");
    google.server.on("request", handle);
  }
}

describe("the account's side of it", () => {
  it("keeps who is whose Google account across a restart, and lets it go with the account", async () => {
    const persistence = new MemoryPersistence();
    const store = await AccountStore.open({ persistence, flushMs: 0 });
    const made = store.createGoogleAccount(ANA, "Ana", "scrypt$1$1$1$c2FsdA$aGFzaA");
    expect(made.ok && made.value.email).toMatch(/^g-[a-z2-7]{12}$/);
    expect(store.createGoogleAccount(ANA, "Ana", "x")).toEqual({ ok: false, error: "google_taken" });
    const robert = store.createAccount("robert", "x");
    if (!robert.ok || !made.ok) throw new Error("not made");
    expect(store.linkGoogle(robert.value.id, ANA)).toEqual({ ok: false, error: "google_taken" });
    expect(store.linkGoogle(robert.value.id, BEN)).toEqual({ ok: true, value: null });
    expect(store.linkGoogle(robert.value.id, "110248000000000000000003")).toEqual({ ok: false, error: "google_taken" });
    await store.flush();

    const again = await AccountStore.open({ persistence, flushMs: 0 });
    expect(again.findByGoogle(ANA)?.id).toBe(made.value.id);
    expect(again.findByGoogle(BEN)?.id).toBe(robert.value.id);
    again.deleteAccount(made.value.id);
    expect(again.findByGoogle(ANA)).toBeUndefined();
    expect(again.createGoogleAccount(ANA, "Ana", "x").ok).toBe(true);
  });
});

describe("postForm", () => {
  it("sends a form only over https, or to this machine (and to nothing that is not an address)", async () => {
    expect(await postForm("ftp://127.0.0.1/token", { code: "x" })).toEqual({ ok: false, reason: "address" });
    expect(await postForm("not an address", { code: "x" })).toEqual({ ok: false, reason: "address" });
    expect(await postForm(`${google.origin}/elsewhere`, {})).toEqual({ ok: true, body: {} });
  });
});

describe("googleFromEnv", () => {
  const all = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_REDIRECT_URIS: `https://${SITE}/api/auth/google/callback, https://${OTHER}/api/auth/google/callback` };

  it("is on with all three settings and off without any one of them, and never says the secret", () => {
    const said: string[] = [];
    const warn = (message: string) => void said.push(message);
    expect(googleFromEnv({}, warn)).toBeUndefined();
    expect(said).toEqual([]); // (nothing set is nothing to say)
    expect(googleFromEnv(all, warn)).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUris: [`https://${SITE}/api/auth/google/callback`, `https://${OTHER}/api/auth/google/callback`] });
    for (const missing of Object.keys(all)) expect(googleFromEnv({ ...all, [missing]: " " }, warn), missing).toBeUndefined();
    expect(said.length).toBeGreaterThanOrEqual(3);
    expect(said.join("\n")).not.toContain(CLIENT_SECRET);
  });

  it("leaves out an address that is not this site's way back over https (plain http only on this machine)", () => {
    const said: string[] = [];
    const uris = [
      "http://kino.test/api/auth/google/callback",
      "https://kino.test/api/auth/google/elsewhere",
      "https://kino.test/api/auth/google/callback?x=1",
      "https://user:pw@kino.test/api/auth/google/callback",
      "not an address",
      "http://127.0.0.1:8787/api/auth/google/callback",
      `https://${SITE}/api/auth/google/callback`,
    ];
    const google = googleFromEnv({ ...all, GOOGLE_REDIRECT_URIS: uris.join(",") }, (message) => void said.push(message));
    expect(google?.redirectUris).toEqual(["http://127.0.0.1:8787/api/auth/google/callback", `https://${SITE}/api/auth/google/callback`]);
    expect(said).toHaveLength(5);
    expect(googleFromEnv({ ...all, GOOGLE_REDIRECT_URIS: uris.slice(0, 5).join(",") })).toBeUndefined();
  });

  it("goes to a fake Google only for tests: with ALLOW_PRIVATE_NETWORK=1, and only to an address on this machine", () => {
    const fake = { GOOGLE_AUTHORIZE_URL: "http://127.0.0.1:9999/auth", GOOGLE_TOKEN_URL: "http://127.0.0.1:9999/token" };
    expect(googleFromEnv({ ...all, ...fake, ALLOW_PRIVATE_NETWORK: "1" })).toMatchObject({ authorizeUrl: fake.GOOGLE_AUTHORIZE_URL, tokenUrl: fake.GOOGLE_TOKEN_URL });
    for (const env of [
      { ...all, ...fake },
      { ...all, ...fake, ALLOW_PRIVATE_NETWORK: "0" },
      { ...all, GOOGLE_AUTHORIZE_URL: "https://evil.example/auth", GOOGLE_TOKEN_URL: "https://evil.example/token", ALLOW_PRIVATE_NETWORK: "1" },
    ]) {
      const google = googleFromEnv(env);
      expect(google?.authorizeUrl).toBeUndefined();
      expect(google?.tokenUrl).toBeUndefined();
    }
  });
});

describe("profileNameOf", () => {
  it.each<[string | undefined, string]>([
    ["Ana", "Ana"],
    ["Ștefan", "Ștefan"],
    ["Jean-Luc", "Jean-Luc"],
    ["O’Brien", "O’Brien"],
    ["  Mary   Ann  ", "Mary Ann"],
    ["Zoë\u0000‮", "Zoë"],
    ["<b>Bo</b>", "b Bo b"],
    ["Maximiliano Alessandro", "Maximiliano Ales"],
    ["𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜", "𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜"],
    ["😀", "Me"],
    ["", "Me"],
    [undefined, "Me"],
  ])("%j is %j", (given, name) => {
    expect(profileNameOf(given)).toBe(name);
  });
});
