import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { weakness } from "../src/client/account/password";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, openProfilePage, openTvSettings, openTvSignIn, PHONE, test } from "./helpers";
import { TEST_ACCOUNT } from "./testAccount";

/**
 * "Continue with Google" on the phone and on a computer used as the TV. The server the other specs run against has no Google settings, so it is
 * the site with Google off; for Google on, these tests start a second one, whose Google is a fake on this machine (nothing here ever reaches
 * Google): the page where a person says yes or no, and the token endpoint, which checks what a real one checks (the client, its secret, the
 * code, PKCE) and answers with an ID token for whoever the test says is at Google.
 */

const CLIENT_ID = "kino-e2e.apps.googleusercontent.com";
/** (A made-up value for the fake: it is what the site has to send, and what must never be in its log.) */
const CLIENT_SECRET = "e2e-made-up-client-secret";
/** What the config's pages start with (playwright.config.ts), for the second site's address. */
const SEED = { "kino.fullscreen.left": "1", "kino.linkbox": "1" };
const TV_SIZE = { width: 1280, height: 720 };
const FIRE_TV = "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36";

const listen = (server: http.Server, port = 0) => new Promise<number>((resolve) => server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const s256 = (text: string) => createHash("sha256").update(text).digest("base64url");
const html = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

interface Person {
  sub: string;
  givenName: string;
}

let counter = 0;
/** A Google account nobody has used here yet (Google's numbers for people are long numbers). */
const newPerson = (givenName: string): Person => ({ sub: `1${Date.now()}${String(++counter).padStart(4, "0")}`, givenName });

/** Google, as far as the site sees it. */
class FakeGoogle {
  /** Who is signed in to Google in the browser: who says yes on its page. */
  person = newPerson("Ana");
  /** What each trip to Google asked for. */
  readonly asked: URLSearchParams[] = [];
  /** Everything that must never be in the site's log: the secret, and what each round trip carried. */
  readonly secrets = new Set<string>([CLIENT_SECRET]);
  private readonly codes = new Map<string, { challenge: string; nonce: string; redirectUri: string; person: Person }>();
  private readonly server = http.createServer((request, response) => void this.answer(request, response));
  private port = 0;

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }
  async start(): Promise<void> {
    this.port = await listen(this.server);
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  private async answer(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    if (request.method === "GET" && url.pathname === "/authorize") return this.authorize(url.searchParams, response);
    if (request.method === "POST" && url.pathname === "/token") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      return this.token(new URLSearchParams(body), response);
    }
    response.writeHead(404).end();
  }

  /** Google's page: "Continue as ...", or "Cancel". */
  private authorize(query: URLSearchParams, response: http.ServerResponse) {
    this.asked.push(query);
    const redirectUri = query.get("redirect_uri") ?? "";
    const state = query.get("state");
    const nonce = query.get("nonce");
    const challenge = query.get("code_challenge");
    const scopes = (query.get("scope") ?? "").split(" ");
    if (query.get("client_id") !== CLIENT_ID || query.get("response_type") !== "code" || query.get("code_challenge_method") !== "S256" || !scopes.includes("openid") || !state || !nonce || !challenge) {
      return response.writeHead(400, { "content-type": "text/plain" }).end("Bad request");
    }
    const code = `4/0e2e-${randomBytes(12).toString("base64url")}`;
    this.codes.set(code, { challenge, nonce, redirectUri, person: { ...this.person } });
    for (const each of [code, state, nonce, this.person.sub]) this.secrets.add(each);
    const back = (params: Record<string, string>) => {
      const to = new URL(redirectUri);
      for (const [name, value] of Object.entries(params)) to.searchParams.set(name, value);
      return html(to.href);
    };
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><title>Sign in - Google Accounts (fake)</title><h1>Choose an account</h1>` +
        `<a id="continue" href="${back({ code, state })}">Continue as ${html(this.person.givenName)}</a> <a id="cancel" href="${back({ error: "access_denied", state })}">Cancel</a>`,
    );
  }

  /** The token endpoint: a code once, for the client with its secret, the same way back, and the verifier of the challenge it was asked with. */
  private token(form: URLSearchParams, response: http.ServerResponse) {
    const code = form.get("code") ?? "";
    const found = this.codes.get(code);
    this.codes.delete(code);
    const verifier = form.get("code_verifier") ?? "";
    if (verifier) this.secrets.add(verifier);
    const right =
      found &&
      form.get("grant_type") === "authorization_code" &&
      form.get("client_id") === CLIENT_ID &&
      form.get("client_secret") === CLIENT_SECRET &&
      form.get("redirect_uri") === found.redirectUri &&
      s256(verifier) === found.challenge;
    if (!right) return response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "https://accounts.google.com",
      azp: CLIENT_ID,
      aud: CLIENT_ID,
      sub: found.person.sub,
      email: `person${found.person.sub}@example.com`,
      email_verified: true,
      name: `${found.person.givenName} Example`,
      given_name: found.person.givenName,
      nonce: found.nonce,
      iat: now,
      exp: now + 3600,
    };
    const idToken = `${json({ alg: "RS256", kid: "e2e", typ: "JWT" })}.${json(claims)}.${randomBytes(32).toString("base64url")}`;
    const accessToken = `ya29.e2e-${randomBytes(16).toString("base64url")}`;
    this.secrets.add(idToken);
    this.secrets.add(accessToken);
    this.secrets.add(claims.email);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ access_token: accessToken, expires_in: 3599, token_type: "Bearer", scope: "openid email profile", id_token: idToken }));
  }
}

/** The site with Google on: the same server as the one the other specs use (the same build), with Google's three settings, and the fake's two addresses. */
class SiteWithGoogle {
  /** All the server wrote. */
  log = "";
  private child: ChildProcess | undefined;
  private port = 0;

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(google: FakeGoogle): Promise<void> {
    const probe = http.createServer();
    this.port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    this.child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
      env: {
        ...process.env,
        PORT: String(this.port),
        HOST: "127.0.0.1",
        ALLOW_PRIVATE_NETWORK: "1",
        LIBRARY: "off",
        DATA_DIR: "memory",
        SIGNUPS_PER_HOUR: "1000",
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        GOOGLE_REDIRECT_URIS: `${this.origin}/api/auth/google/callback`,
        GOOGLE_AUTHORIZE_URL: `${google.origin}/authorize`,
        GOOGLE_TOKEN_URL: `${google.origin}/token`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk) => (this.log += String(chunk)));
    this.child.stderr!.on("data", (chunk) => (this.log += String(chunk)));
    const until = Date.now() + 60_000;
    for (;;) {
      const up = await fetch(`${this.origin}/api/health`).then(
        (answer) => answer.ok,
        () => false,
      );
      if (up) return;
      if (Date.now() > until || this.child.exitCode !== null) throw new Error(`The site with Google did not start:\n${this.log}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = once(this.child, "exit");
    this.child.kill();
    await exited;
  }
}

/** Who the server says is signed in on this page, and whether it says Google is on. */
const sessionOf = (page: Page) => page.evaluate(() => fetch("/api/me").then((answer) => answer.json())) as Promise<{ me: { account: { id: string; email: string; google?: true; googleOnly?: true } } | null; google?: boolean }>;
/** What kind of device the server thinks this page's session is. */
const deviceOf = (page: Page) =>
  page.evaluate(async () => ((await (await fetch("/api/sessions")).json()) as { kind: string; current: boolean }[]).find((session) => session.current)?.kind);

/** The addresses the page has been at, in order (an address the page changed itself, as well as one it was sent to). */
function addresses(page: Page): string[] {
  const seen: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) seen.push(frame.url());
  });
  return seen;
}

/** Off to Google with `button`, the person's answer on Google's page, and the browser on its way back to the site. */
async function viaGoogle(page: Page, google: FakeGoogle, button: Locator | (() => Promise<void>), answer: "continue" | "cancel" = "continue"): Promise<void> {
  await (typeof button === "function" ? button() : button.click());
  await page.waitForURL((url) => url.origin === google.origin && url.pathname === "/authorize");
  await page.locator(`#${answer}`).click();
}

async function signUpWithPassword(page: Page, account: { email: string; password: string }) {
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  if (weakness(account.email, account.password)) await page.getByTestId("auth-agree").click();
}

/** A screen's own form (a computer used as the TV, or a TV's browser) opened from the profile's page, making an account with a name and a password. */
async function signUpOnScreen(screen: Page, account: { email: string; password: string }) {
  await openTvSignIn(screen);
  await screen.getByTestId("tv-signin-email").click();
  await screen.getByTestId("auth-switch").click();
  await expect(screen.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await screen.getByTestId("auth-email").fill(account.email);
  await screen.getByTestId("auth-password").fill(account.password);
  await screen.getByTestId("auth-submit").click();
  if (weakness(account.email, account.password)) await screen.getByTestId("auth-agree").click();
}

const newPhone = (browser: Browser) => openDevice(browser, PHONE, SEED);

test.describe("with Google sign-in off", () => {
  test("the phone's form and the TV's have no Google button, the Security page has no Google, and /api/me says nothing of Google", async ({ browser, request }) => {
    expect(await (await request.get("/api/me")).json()).not.toHaveProperty("google");

    const phone = await openDevice(browser, PHONE);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("auth-form")).toBeVisible();
    await expect(phone.getByTestId("google-button")).toHaveCount(0);
    await signUpWithPassword(phone, { email: `Robert ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(phone.getByTestId("menu-security")).toBeVisible();
    await expect(phone.getByTestId("menu-google")).toHaveCount(0); // (the profile does not offer what the site cannot do)
    await phone.getByTestId("menu-security").click();
    await expect(phone.getByTestId("password-current")).toBeVisible();
    await expect(phone.getByTestId("google-connect")).toHaveCount(0);
    await expect(phone.getByTestId("google-connected")).toHaveCount(0);

    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await expect(tv.getByTestId("auth-email")).toBeFocused();
    await expect(tv.getByTestId("google-button")).toHaveCount(0);
  });
});

test.describe("with Google sign-in on", () => {
  const google = new FakeGoogle();
  const site = new SiteWithGoogle();

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
    await google.start();
    await site.start(google);
  });
  test.afterAll(async () => {
    await site.stop();
    await google.stop();
  });
  // Whatever a test did, the server wrote no code, token, state, verifier, secret, Google number or e-mail in its log.
  test.afterEach(() => {
    expect([...google.secrets].filter((secret) => site.log.includes(secret))).toEqual([]);
  });

  test("the phone's form has the button in both its modes, a TV's own browser has none, and /api/me says it is on", async ({ browser }) => {
    expect((await (await fetch(`${site.origin}/api/me`)).json()).google).toBe(true);

    const phone = await newPhone(browser);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("google-button")).toHaveText(en["auth.google"]);
    await phone.getByTestId("auth-switch").click();
    await expect(phone.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
    await expect(phone.getByTestId("google-button")).toBeVisible();

    // A TV's own browser (a Fire TV's): Google's pages are no place for a remote, so its form is as it was.
    const fireTv = await openDevice(browser, { viewport: TV_SIZE, userAgent: FIRE_TV }, SEED);
    await fireTv.goto(`${site.origin}/tv`);
    await expect(fireTv.getByTestId("tv-browse")).toBeVisible();
    await openTvSignIn(fireTv);
    await fireTv.getByTestId("tv-signin-email").click();
    await expect(fireTv.getByTestId("auth-form")).toBeVisible();
    await expect(fireTv.getByTestId("google-button")).toHaveCount(0);
  });

  test("a phone makes an account with Google, comes back signed in with a profile named after the person, and the same Google account is the same account next time", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Ana");
    const phone = await newPhone(browser);
    const seen = addresses(phone);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"));
    await phone.waitForURL(`${site.origin}/`);
    expect(seen.filter((address) => address.startsWith(site.origin) && address.includes("google="))).toEqual([]); // (a sign-in that worked says nothing)
    // What went to Google: this site's way back, the three scopes, a flow of its own, PKCE.
    const asked = google.asked.at(-1)!;
    expect(asked.get("redirect_uri")).toBe(`${site.origin}/api/auth/google/callback`);
    expect(asked.get("scope")).toBe("openid email profile");
    expect(asked.get("code_challenge_method")).toBe("S256");

    // (The server logs its requests, the start of this one too, but not the way back, whose address has the code in it.)
    expect(site.log).toContain("/api/auth/google/start?device=remote");
    expect(site.log).not.toContain("/api/auth/google/callback");

    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Ana");
    await expect(phone.getByTestId("account-card")).toContainText(en["account.signedInGoogle"]);
    await expect(phone.getByTestId("menu-google")).toHaveCount(0); // (an account made with Google has Google: its profile offers nothing to connect)
    const first = (await sessionOf(phone)).me!;
    expect(first.account).toMatchObject({ google: true, googleOnly: true });
    expect(first.account.email).toMatch(/^g-[a-z2-7]{12}$/); // (a login nobody chose: Google's e-mail is not kept)
    expect(await deviceOf(phone)).toBe("remote");

    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"));
    await phone.waitForURL(`${site.origin}/`);
    expect((await sessionOf(phone)).me?.account.id).toBe(first.account.id);
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Ana");
  });

  test("saying no at Google comes back to the phone's page, which says so once, and the form is there to use", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Ana");
    const phone = await newPhone(browser);
    const seen = addresses(phone);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"), "cancel");
    await expect(phone.getByTestId("account-toast")).toHaveText(en["google.denied"]);
    expect(seen).toContain(`${site.origin}/?google=denied`);
    await expect(phone).toHaveURL(`${site.origin}/`); // (the word is taken out of the address: a reload does not say it again)
    expect((await sessionOf(phone)).me).toBeNull();

    await phone.getByTestId("account-button").click();
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password };
    await signUpWithPassword(phone, account);
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Robert/);
  });

  test("a computer used as the TV signs in with Google from its own form, with the remote, and comes back to the TV's page signed in as a TV", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Bogdan");
    const tv = await openDevice(browser, { viewport: TV_SIZE }, SEED);
    await tv.goto(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    // The page lands on the name, as it did before; Google's button is one Up away.
    await expect(tv.getByTestId("auth-email")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("google-button")).toBeFocused();
    await viaGoogle(tv, google, () => tv.keyboard.press("Enter"));
    await tv.waitForURL(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Bogdan/);
    expect(await deviceOf(tv)).toBe("tv");
    await openProfilePage(tv);
    await expect(tv.getByTestId("tv-profile-settings")).toBeVisible();
    await expect(tv.getByTestId("tv-profile-google")).toHaveCount(0); // (an account made with Google has Google: its profile offers nothing to connect)
  });

  test("saying no at Google comes back to the TV's page, which says so", async ({ browser }) => {
    google.person = newPerson("Bogdan");
    const tv = await openDevice(browser, { viewport: TV_SIZE }, SEED);
    await tv.goto(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await viaGoogle(tv, google, tv.getByTestId("google-button"), "cancel");
    await expect(tv.getByTestId("tv-account-toast")).toHaveText(en["google.denied"]);
    await expect(tv).toHaveURL(`${site.origin}/tv`);
    expect((await sessionOf(tv)).me).toBeNull();
  });

  test("an account with a password connects Google on its Security page, and signs in with Google after that", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Someone");
    const phone = await newPhone(browser);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await signUpWithPassword(phone, { email: `Linda ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Linda/);
    const id = (await sessionOf(phone)).me!.account.id;

    await phone.getByTestId("menu-security").click();
    await expect(phone.getByTestId("google-connected")).toHaveCount(0);
    await viaGoogle(phone, google, phone.getByTestId("google-connect"));
    await expect(phone.getByTestId("account-toast")).toHaveText(en["google.linked"]);
    await expect(phone).toHaveURL(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-security").click();
    await expect(phone.getByTestId("google-connected")).toBeVisible();
    await expect(phone.getByTestId("password-current")).toBeVisible(); // (the password is still the account's)

    await phone.getByTestId("page-back").first().click();
    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"));
    await phone.waitForURL(`${site.origin}/`);
    expect((await sessionOf(phone)).me?.account.id).toBe(id);
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Linda/); // (not a new account named after the person at Google)
  });

  test("the phone's profile offers an account with a password to connect Google, and the line is gone once it is connected", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Someone");
    const phone = await newPhone(browser);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await signUpWithPassword(phone, { email: `Mira ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Mira/);
    const id = (await sessionOf(phone)).me!.account.id;

    // On the profile itself, not behind Password & security: between Devices and that page.
    const line = phone.getByTestId("menu-google");
    await expect(line).toContainText(en["account.googleConnect"]);
    const order = await phone.getByTestId("account-screen").locator("[data-testid^='menu-']").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
    expect(order.slice(order.indexOf("menu-devices"))).toEqual(["menu-devices", "menu-google", "menu-security"]);

    await viaGoogle(phone, google, line);
    await expect(phone.getByTestId("account-toast")).toHaveText(en["google.linked"]);
    await expect(phone).toHaveURL(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Mira/);
    await expect(phone.getByTestId("menu-security")).toBeVisible();
    await expect(phone.getByTestId("menu-google")).toHaveCount(0);

    // A Google account belongs to one account at most: another account is told so, and keeps its line.
    const other = await newPhone(browser);
    await other.goto(`${site.origin}/`);
    await other.getByTestId("account-button").click();
    await signUpWithPassword(other, { email: `Nora ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(other.getByTestId("account-profile-name")).toHaveText(/^Nora/);
    await viaGoogle(other, google, other.getByTestId("menu-google"));
    await expect(other.getByTestId("account-toast")).toHaveText(en["google.taken"]);
    await other.getByTestId("account-button").click();
    await expect(other.getByTestId("menu-google")).toBeVisible();
    expect((await sessionOf(other)).me!.account.id).not.toBe(id);
  });

  test("the TV's profile page offers an account with a password a button to connect Google, which the remote reaches after the others, and it is gone once connected", async ({ browser }) => {
    test.setTimeout(90_000);
    google.person = newPerson("Someone");
    const tv = await openDevice(browser, { viewport: TV_SIZE }, SEED);
    await tv.goto(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();

    // Nobody is signed in: the page offers signing in, which is what a guest has come for.
    await openProfilePage(tv);
    await expect(tv.getByTestId("tv-profile-signin")).toBeVisible();
    await expect(tv.getByTestId("tv-profile-google")).toHaveCount(0);

    await signUpOnScreen(tv, { email: `Mira ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Mira/);

    // The Settings' Profile group has the line too, with Manage profiles and signing a TV in.
    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-connect-google")).toContainText(en["account.googleConnect"]);
    await tv.getByTestId("tv-account-back").click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");

    const connect = tv.getByTestId("tv-profile-google");
    await expect(connect).toContainText(en["account.googleConnect"]);
    // (The remote still starts at Settings: this button is the last.)
    await tv.getByTestId("tv-profile-settings").focus();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-profile-feedback")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(connect).toBeFocused();
    await viaGoogle(tv, google, () => tv.keyboard.press("Enter"));
    await tv.waitForURL(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-account-toast")).toHaveText(en["google.linked"]);

    await openProfilePage(tv);
    await expect(tv.getByTestId("tv-profile-settings")).toBeVisible();
    await expect(tv.getByTestId("tv-profile-google")).toHaveCount(0);
    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-manage-profiles")).toBeVisible();
    await expect(tv.getByTestId("tv-connect-google")).toHaveCount(0);
  });

  test("a TV's own browser is not offered Google on its profile page, signed in with a password", async ({ browser }) => {
    test.setTimeout(60_000);
    const fireTv = await openDevice(browser, { viewport: TV_SIZE, userAgent: FIRE_TV }, SEED);
    await fireTv.goto(`${site.origin}/tv`);
    await expect(fireTv.getByTestId("tv-browse")).toBeVisible();
    await signUpOnScreen(fireTv, { email: `Mira ${Date.now().toString(36)}${++counter}`, password: TEST_ACCOUNT.password });
    await expect(fireTv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Mira/);
    await openProfilePage(fireTv);
    await expect(fireTv.getByTestId("tv-profile-settings")).toBeVisible();
    await expect(fireTv.getByTestId("tv-profile-google")).toHaveCount(0);
    await openTvSettings(fireTv);
    await expect(fireTv.getByTestId("tv-manage-profiles")).toBeVisible();
    await expect(fireTv.getByTestId("tv-connect-google")).toHaveCount(0);
  });

  test("an account made with Google has no password to change, and is deleted only once the person has signed in to Google again", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Dana");
    const phone = await newPhone(browser);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"));
    await phone.waitForURL(`${site.origin}/`);

    // The word for "confirmed" in an address that somebody else made deletes nothing: the page only deletes when this tab went to Google to delete.
    const deletes: string[] = [];
    phone.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/me/delete") deletes.push(request.url());
    });
    await phone.goto(`${site.origin}/?google=reauth`);
    await expect(phone).toHaveURL(`${site.origin}/`);
    await phone.waitForTimeout(500);
    expect(deletes).toEqual([]);
    expect((await sessionOf(phone)).me).not.toBeNull();

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-security").click();
    await expect(phone.getByTestId("google-only")).toHaveText(en["account.googleOnly"]);
    await expect(phone.getByTestId("password-current")).toHaveCount(0);
    await expect(phone.getByTestId("google-connect")).toHaveCount(0);

    // No at Google: nothing is deleted.
    await phone.getByTestId("delete-account").click();
    await viaGoogle(phone, google, phone.getByTestId("delete-google"), "cancel");
    await expect(phone.getByTestId("account-toast")).toHaveText(en["google.denied"]);
    expect((await sessionOf(phone)).me).not.toBeNull();

    // Yes at Google (which is asked to have the person sign in again): the account is gone.
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-security").click();
    await phone.getByTestId("delete-account").click();
    await viaGoogle(phone, google, phone.getByTestId("delete-google"));
    expect(google.asked.at(-1)!.get("max_age")).toBe("0");
    await expect(phone.getByTestId("account-toast")).toHaveText(en["account.deleted"]);
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    expect((await sessionOf(phone)).me).toBeNull();
    expect(deletes).toHaveLength(1);
  });

  test("a phone signed in with Google signs a TV in with the TV's code, and the question does not show the account's made-up login", async ({ browser }) => {
    test.setTimeout(60_000);
    google.person = newPerson("Eva");
    const phone = await newPhone(browser);
    await phone.goto(`${site.origin}/`);
    await phone.getByTestId("account-button").click();
    await viaGoogle(phone, google, phone.getByTestId("google-button"));
    await phone.waitForURL(`${site.origin}/`);

    const tv = await openDevice(browser, { viewport: TV_SIZE }, SEED);
    await tv.goto(`${site.origin}/tv`);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await openTvSignIn(tv);
    const code = tv.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const shown = (await code.textContent())!.trim();

    await phone.goto(`${site.origin}/?link=${shown.replace("-", "")}`);
    await expect(phone.getByTestId("link-code")).toHaveText(shown);
    const [before, after] = en["link.approveBodyGoogle"].split("{device}");
    const question = phone.getByTestId("link-approve");
    await expect(question).toContainText(before!);
    await expect(question).toContainText(after!);
    await expect(question).not.toContainText((await sessionOf(phone)).me!.account.email);
    await phone.getByTestId("link-approve-button").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Eva/, { timeout: 15_000 });
  });
});
