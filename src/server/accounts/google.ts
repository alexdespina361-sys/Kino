import { createHash, randomBytes } from "node:crypto";
import { request as plainRequest } from "node:http";
import { request as tlsRequest } from "node:https";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DeviceKindSchema, PROFILE_NAME_MAX, type DeviceKind, type GoogleOutcome, type Registration } from "../../shared";
import { remember } from "../boundedMap";
import { hashPassword, type PasswordCost } from "./password";
import { RateLimiter } from "./rateLimit";
import type { AccountStore } from "./store";

/**
 * "Continue with Google": signing in, and making an account, with a Google account (docs/google-sign-in.md). The server does it all, with Google's
 * authorization code and PKCE: the button is a link to `/api/auth/google/start`, which sends the browser to Google with a new flow of its own (a state, a nonce and
 * a code verifier kept here for 10 minutes, the state also in a cookie of this browser), and Google sends it back to `/api/auth/google/callback` with a code.
 * The code is taken to Google's token endpoint straight from here, with the client's secret and the verifier, and what Google answers over that connection
 * says who the person is: only `sub`, Google's own number for them, is kept (and `given_name`, once, is the name of the first profile of an account made now).
 * Nothing is matched by e-mail: a Google account signs in to the account it made or was connected to, and to no other.
 *
 * The flow is `signin` (the account of that Google account, made if there is none and new accounts may be made), `link` (connect it to the account that is
 * signed in) or `reauth` (the person signed in proves again who they are, which is how an account that has no password anybody knows is deleted). Every way
 * back ends at a page of this site with at most a word for it (`?google=`, see `GOOGLE_OUTCOMES`), and never with a code, a token or anything of the person's.
 * Without the three settings, or at an address that is not one of `GOOGLE_REDIRECT_URIS`, none of it is on.
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALLBACK = "/api/auth/google/callback";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** The addresses Google may send a browser back to, exactly as they are registered with Google: one for each address the site is served at. */
  redirectUris: string[];
  /** Google's, unless a test says otherwise (a fake on this machine: see `googleFromEnv`). */
  authorizeUrl?: string;
  tokenUrl?: string;
  /** How long Google's token endpoint is waited for (10 s unless set; tests wait less). */
  timeoutMs?: number;
}

const FLOW_COOKIE = "kino_oauth";
const FLOW_MS = 10 * 60_000;
const MAX_FLOWS = 2000;
/** How long a proof given by `reauth` lasts: the account has to be deleted in that time. */
export const REAUTH_MS = 5 * 60_000;
const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_MAX_BYTES = 64 * 1024;
/** How far apart the clocks of Google and of this server may be. */
const SKEW_MS = 60_000;
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MODES = ["signin", "link", "reauth"] as const;
type Mode = (typeof MODES)[number];

const isLoopback = (address: URL) => (address.protocol === "http:" || address.protocol === "https:") && LOOPBACK.has(address.hostname);

function parsed(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/** Whether this is an address Google may send a browser back to here: this site's own way back, over https (or plain http on this very machine), and nothing more. */
function isCallback(address: string): boolean {
  const url = parsed(address);
  return Boolean(url && (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url))) && url.pathname === GOOGLE_CALLBACK && !url.search && !url.hash && !url.username && !url.password);
}

/**
 * Google sign-in from the host's settings: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URIS` (a comma between addresses), all three or it is off.
 * `GOOGLE_AUTHORIZE_URL` and `GOOGLE_TOKEN_URL` send it to a fake Google instead; they are for tests, so they count only with `ALLOW_PRIVATE_NETWORK=1` (which no
 * deployed server has) and only for an address on this machine. (What is wrong is said without the secret.)
 */
export function googleFromEnv(env: NodeJS.ProcessEnv, warn: (message: string) => void = () => {}): GoogleConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const listed = (env.GOOGLE_REDIRECT_URIS ?? "").split(",").map((each) => each.trim()).filter(Boolean);
  if (!clientId && !clientSecret && listed.length === 0) return undefined;
  const redirectUris = listed.filter((address) => {
    if (!isCallback(address)) warn(`GOOGLE_REDIRECT_URIS: ${address} is left out: it has to be https://<the site's address>${GOOGLE_CALLBACK}.`);
    return isCallback(address);
  });
  if (!clientId || !clientSecret || redirectUris.length === 0) {
    warn("Google sign-in is off: it needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URIS, all three.");
    return undefined;
  }
  const fake = (name: "GOOGLE_AUTHORIZE_URL" | "GOOGLE_TOKEN_URL"): string | undefined => {
    const value = env[name]?.trim();
    if (!value) return undefined;
    const url = parsed(value);
    if (env.ALLOW_PRIVATE_NETWORK === "1" && url && isLoopback(url)) return value;
    warn(`${name} is only for tests (ALLOW_PRIVATE_NETWORK=1 and an address on this machine): it is not used, Google's own is.`);
    return undefined;
  };
  const authorizeUrl = fake("GOOGLE_AUTHORIZE_URL");
  const tokenUrl = fake("GOOGLE_TOKEN_URL");
  return { clientId, clientSecret, redirectUris, ...(authorizeUrl ? { authorizeUrl } : {}), ...(tokenUrl ? { tokenUrl } : {}) };
}

/* ------------------------------ the token endpoint ------------------------------ */

export type Posted = { ok: true; body: unknown } | { ok: false; reason: "address" | "network" | "timeout" | "status" | "type" | "size" | "json" };

/**
 * A form sent to `address` (Google's token endpoint) and its answer, which has to be JSON: waited for `timeoutMs` at the most, no more than `maxBytes` of it taken,
 * and a redirect is not followed (it is an answer that is not 200). Over https, or plain http to this machine (a test's fake). Never throws.
 */
export function postForm(address: string, form: Record<string, string>, { timeoutMs = TOKEN_TIMEOUT_MS, maxBytes = TOKEN_MAX_BYTES } = {}): Promise<Posted> {
  const url = parsed(address);
  if (!url || !(url.protocol === "https:" || isLoopback(url))) return Promise.resolve({ ok: false, reason: "address" });
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Posted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sent.destroy();
      resolve(result);
    };
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "content-length": String(Buffer.byteLength(body)) };
    const sent = (url.protocol === "https:" ? tlsRequest : plainRequest)(url, { method: "POST", headers }, (answer) => {
      answer.on("error", () => finish({ ok: false, reason: "network" }));
      if (answer.statusCode !== 200) return finish({ ok: false, reason: "status" });
      if (!/^application\/json\b/i.test(String(answer.headers["content-type"] ?? ""))) return finish({ ok: false, reason: "type" });
      const chunks: Buffer[] = [];
      let size = 0;
      answer.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) return finish({ ok: false, reason: "size" });
        chunks.push(chunk);
      });
      answer.on("end", () => {
        try {
          finish({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
        } catch {
          finish({ ok: false, reason: "json" });
        }
      });
    });
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    sent.on("error", () => finish({ ok: false, reason: "network" }));
    sent.end(body);
  });
}

/** What an ID token says of the person, once everything in it that has to be right is. */
export interface GoogleClaims {
  sub: string;
  givenName?: string;
}

/**
 * The claims of the ID token Google answered with, or nothing when one of them is not what it has to be: Google's issuer, this client as the audience (and as the
 * party it was given to, when it says), not expired, the nonce of this flow, and a `sub` that looks like one. Its signature is not checked: it came straight from
 * Google's token endpoint over TLS, in answer to this client's secret, which is what OpenID Connect says makes that unnecessary.
 */
export function readIdToken(idToken: string, expected: { clientId: string; nonce: string; now: number }): GoogleClaims | undefined {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!claims || typeof claims !== "object") return undefined;
  const { iss, aud, azp, exp, nonce, sub, given_name: givenName } = claims as Record<string, unknown>;
  if (typeof iss !== "string" || !ISSUERS.has(iss)) return undefined;
  if (aud !== expected.clientId) return undefined;
  if (azp !== undefined && azp !== expected.clientId) return undefined;
  if (typeof exp !== "number" || exp * 1000 <= expected.now - SKEW_MS) return undefined;
  if (typeof nonce !== "string" || nonce !== expected.nonce) return undefined;
  if (typeof sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(sub)) return undefined;
  return { sub, ...(typeof givenName === "string" ? { givenName } : {}) };
}

/** The name of the first profile of an account made with Google: the person's first name as Google has it, made fit for a profile (letters, digits, a few marks; 16 at most), or "Me". */
export function profileNameOf(givenName: string | undefined): string {
  const cleaned = (givenName ?? "").slice(0, 200).normalize("NFC").replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ").replace(/\s+/g, " ").trim();
  let name = "";
  for (const letter of cleaned) {
    if (name.length + letter.length > PROFILE_NAME_MAX) break;
    name += letter;
  }
  return name.trim() || "Me";
}

/* ------------------------------ the routes ------------------------------ */

interface Flow {
  nonce: string;
  verifier: string;
  redirectUri: string;
  mode: Mode;
  device: DeviceKind;
  next: "/" | "/tv";
  /** `link` and `reauth`: the account that asked, which has to be the one signed in when the browser comes back. */
  accountId?: string;
  startedAt: number;
  /** A round trip for the Android app (see `AppTrip`). */
  app?: AppTrip;
}

/**
 * The Android app shows the site in a WebView, which Google does not sign anybody in from (`disallowed_useragent`): its "Continue with Google" goes out to the
 * phone's browser (a Custom Tab), and comes back to the app with a code that only the app can use. The app makes a secret of its own and gives the start its hash
 * (`app=`, as PKCE does); the way back does not sign the browser in, connect or confirm anything, but leaves what came of it under a one-time code, and sends
 * the browser to the app (`appAddress`: an Android intent for this app's package alone, so no other app on the phone can be given it, the judge, 17 Nov), which
 * brings the code and its secret to `/api/auth/google/app-claim` in its WebView: that is where it is signed in. A code caught all the same is no use without the
 * secret. Connecting Google, or confirming who is here, needs the WebView's own session: the WebView asks for a ticket first (`/api/auth/google/app-ticket`, this
 * site's own page only), the browser starts with the ticket, and the claim is done only by that very session, still signed in (the judge, 17 Nov: done in the
 * browser, a stolen ticket, or one of a session ended since, would have connected somebody's Google account to the account).
 */
interface AppTrip {
  challenge: string;
  /** `link` and `reauth`: the WebView's session, the only one that may claim what comes of it. */
  sessionId?: string;
}

/** What the claim does once the app proved it is the one that started: sign the WebView in, connect a Google account to the WebView's, or confirm its session. */
type HandoffThen =
  | { kind: "signIn"; accountId: string }
  // (A Google account with no account here: it is made when the app claims it, not before - see the claim.)
  | { kind: "signUp"; sub: string; name: string }
  | { kind: "link" | "reauth"; accountId: string; sessionId: string; sub: string };

/** What a round trip of the app came to, kept for the app to claim (see `AppTrip`). */
interface Handoff {
  challenge: string;
  next: "/" | "/tv";
  device: DeviceKind;
  then?: HandoffThen;
  outcome?: GoogleOutcome;
  at: number;
}

/** The app's own address scheme and package (android/app/src/main/AndroidManifest.xml, android/app/build.gradle). */
export const APP_SCHEME = "kino4tv";
export const APP_PACKAGE = "com.kino4tv.app";

/**
 * Where the browser is sent back to the app: an intent for the app's package alone (Chrome, and the other browsers of Android, open an `intent:` address only in
 * the app it names; another app that says it opens `kino4tv:` addresses is not asked). A browser on a phone without the app goes to the site.
 *
 * `trip` is the start of the app's hash (`app=`, or the ticket's), which only the app and this site know: the app takes a way back only with its own trip's,
 * so another app that opens the app with a made-up code cannot use up the secret of a trip on its way (the judge, 17 Nov).
 */
export const appAddress = (code: string, challenge: string, origin: string, next: string) =>
  `intent://google?code=${code}&trip=${challenge.slice(0, APP_TRIP_LENGTH)}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(new URL(next, origin).toString())};end`;
/** How much of the app's hash comes back with the way back. */
export const APP_TRIP_LENGTH = 16;
const APP_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a start is a round trip of the app (`AppTrip`): a sign-in with the hash of the app's secret (`app=`, and no other mode), or one with a ticket. The app opens
 * it in a Custom Tab, which Chrome says comes from another site (the app is its referrer: `Sec-Fetch-Site: cross-site`), so the gate lets these in when they are a
 * navigation (guard.ts): what comes of one goes to this app's package alone, and is no use without the secret only the app knows, or the ticket only its WebView was
 * given. A start of another mode, or with no `app=`, is still only this site's own button (the owner, 17 Nov: "cross_site" in the app's browser).
 */
export function isAppStart(query: Record<string, unknown>): boolean {
  if (typeof query.ticket === "string" && query.ticket !== "") return true;
  const mode = MODES.find((each) => each === query.mode) ?? "signin";
  return mode === "signin" && typeof query.app === "string" && APP_CHALLENGE.test(query.app);
}
const HANDOFF_MS = 2 * 60_000;
const TICKET_MS = 5 * 60_000;

export interface GoogleHelpers {
  store: AccountStore;
  authenticate(request: FastifyRequest): { accountId: string; sessionId: string } | undefined;
  signIn(request: FastifyRequest, reply: FastifyReply, accountId: string, kind: DeviceKind): void;
  readCookie(header: string | undefined, name: string): string | undefined;
  registrationNow(): Registration;
  /** The sign-ups of an address, counted with the ones made with a password. */
  signUpByIp: RateLimiter;
  passwordCost?: PasswordCost | undefined;
}

const secret = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const flowCookie = (value: string, secure: boolean, maxAgeSeconds: number) =>
  `${FLOW_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;

/**
 * The address Google sends this browser back to: the one of `redirectUris` at the very origin the request came to (each address of the site has its own), or none,
 * and then Google sign-in is not on here. It is picked from the list, never made from the request.
 */
function redirectFor(config: GoogleConfig, request: FastifyRequest): string | undefined {
  const here = parsed(`${request.protocol}://${request.host}`);
  if (!here || here.pathname !== "/" || here.username || here.password || here.search || here.hash) return undefined;
  return config.redirectUris.find((address) => parsed(address)?.origin === here.origin);
}

/** `/api/auth/google/start` and `/api/auth/google/callback`. They are there with Google off as well, and then only send the browser back saying so. Whether Google sign-in is on for a request is `here`. */
export function googleRoutes(app: FastifyInstance, helpers: GoogleHelpers, config: GoogleConfig | undefined): { here(request: FastifyRequest): boolean } {
  const { store } = helpers;
  const flows = new Map<string, Flow>();
  const startsByIp = new RateLimiter(30, FLOW_MS, undefined, "google.startsByIp");
  // (The app's: see `AppTrip`.)
  const tickets = new Map<string, { mode: "link" | "reauth"; device: DeviceKind; next: "/" | "/tv"; accountId: string; sessionId: string; challenge: string; at: number }>();
  const handoffs = new Map<string, Handoff>();
  const claimsByIp = new RateLimiter(30, FLOW_MS, undefined, "google.claimsByIp");
  // (Each ticket is counted, by the address and by the account: one account could otherwise make so many that the tickets of others are pushed out, the judge, 17 Nov.)
  const ticketsByAccount = new RateLimiter(10, FLOW_MS, () => store.clock(), "google.ticketsByAccount");

  app.post<{ Body: Record<string, unknown> }>("/api/auth/google/app-ticket", async (request, reply) => {
    const auth = helpers.authenticate(request);
    if (!auth) return reply.code(401).send({ error: "signed_out" });
    const body = request.body ?? {};
    const mode = body.mode === "link" || body.mode === "reauth" ? body.mode : undefined;
    const challenge = typeof body.challenge === "string" && APP_CHALLENGE.test(body.challenge) ? body.challenge : undefined;
    if (!config || !mode || !challenge) return reply.code(400).send({ error: "invalid_request" });
    if (startsByIp.wait(request.ip) > 0 || ticketsByAccount.wait(auth.accountId) > 0) return reply.code(429).send({ error: "rate_limited" });
    startsByIp.hit(request.ip);
    ticketsByAccount.hit(auth.accountId);
    const ticket = secret();
    const device = DeviceKindSchema.safeParse(body.device).data ?? "browser";
    remember(tickets, ticket, { mode, device, next: body.next === "/tv" ? "/tv" : "/", accountId: auth.accountId, sessionId: auth.sessionId, challenge, at: store.clock() }, MAX_FLOWS);
    return reply.send({ ticket });
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/start", async (request, reply) => {
    const query = request.query ?? {};
    const ticketId = typeof query.ticket === "string" ? query.ticket : "";
    const ticket = ticketId ? tickets.get(ticketId) : undefined;
    if (ticket) tickets.delete(ticketId); // (good once)
    const fresh = ticket && store.clock() - ticket.at <= TICKET_MS ? ticket : undefined;
    const next = fresh?.next ?? (query.next === "/tv" ? "/tv" : "/");
    const device = fresh?.device ?? DeviceKindSchema.safeParse(query.device).data ?? "browser";
    const mode = fresh?.mode ?? (ticketId ? "signin" : (MODES.find((each) => each === query.mode) ?? "signin"));
    const challenge = typeof query.app === "string" && APP_CHALLENGE.test(query.app) ? query.app : undefined;
    const trip: AppTrip | undefined = fresh ? { challenge: fresh.challenge, sessionId: fresh.sessionId } : challenge && mode === "signin" ? { challenge } : undefined;
    const back = (outcome: GoogleOutcome) => reply.redirect(`${next}?google=${outcome}`);
    const redirectUri = config && redirectFor(config, request);
    if (!config || !redirectUri) return back("unavailable");
    if (ticketId && !fresh) return back("failed");
    if (startsByIp.wait(request.ip) > 0) return back("busy");
    // (The app's browser has no session: a ticket says whose account it is.)
    const auth = mode === "signin" || fresh ? undefined : helpers.authenticate(request);
    if (mode !== "signin" && !auth && !fresh) return back("failed");
    startsByIp.hit(request.ip);

    const state = secret();
    const nonce = secret();
    const verifier = secret();
    const accountId = fresh?.accountId ?? auth?.accountId;
    remember(flows, state, { nonce, verifier, redirectUri, mode, device, next, ...(accountId ? { accountId } : {}), ...(trip ? { app: trip } : {}), startedAt: store.clock() }, MAX_FLOWS);
    reply.header("Set-Cookie", flowCookie(state, request.protocol === "https", FLOW_MS / 1000));
    const target = new URL(config.authorizeUrl ?? GOOGLE_AUTHORIZE_URL);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challengeOf(verifier),
      code_challenge_method: "S256",
      // (Proving it again is choosing the account again, and Google is asked for a fresh sign-in: `max_age=0`. Google has no `prompt=login`.)
      prompt: "select_account",
      ...(mode === "reauth" ? { max_age: "0" } : {}),
    }).toString();
    return reply.redirect(target.toString());
  });

  // (Its address has the code and the state in it: Fastify's line for each request is not written for this route, and what is written says why, not what.)
  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/callback", { logLevel: "warn" }, async (request, reply) => {
    const query = request.query ?? {};
    reply.header("Set-Cookie", flowCookie("", request.protocol === "https", 0));
    const state = typeof query.state === "string" ? query.state : "";
    const flow = state ? flows.get(state) : undefined;
    if (flow) flows.delete(state); // (good once, whatever comes of it)
    const next = flow?.next ?? "/";
    // (A round trip of the app goes back to the app, which claims what came of it in its WebView: see `AppTrip`.)
    const toApp = (handoff: Pick<Handoff, "then" | "outcome">) => {
      const code = secret();
      const origin = new URL(flow!.redirectUri).origin;
      remember(handoffs, code, { ...handoff, challenge: flow!.app!.challenge, next, device: flow!.device, at: store.clock() }, MAX_FLOWS);
      return reply.redirect(appAddress(code, flow!.app!.challenge, origin, next));
    };
    const back = (outcome?: GoogleOutcome) => (flow?.app ? toApp(outcome ? { outcome } : {}) : reply.redirect(outcome ? `${next}?google=${outcome}` : next));
    const refuse = (why: string) => {
      request.log.warn(`Google sign-in refused: ${why}.`);
      return back("failed");
    };
    if (!config) return back("unavailable");
    if (!flow) return refuse("no such flow");
    if (helpers.readCookie(request.headers.cookie, FLOW_COOKIE) !== state) return refuse("not the browser that started it");
    if (store.clock() - flow.startedAt > FLOW_MS) return refuse("too late");
    if (query.error !== undefined) return back(query.error === "access_denied" ? "denied" : "failed");
    const code = typeof query.code === "string" && query.code.length <= 2048 ? query.code : "";
    if (!code) return refuse("no code");
    // (The app's browser has no session: nothing is connected or confirmed here, but when the WebView claims it, by the session that asked for the ticket.)
    const auth = flow.mode === "signin" || flow.app ? undefined : helpers.authenticate(request);
    if (flow.mode !== "signin" && !flow.app && (!auth || auth.accountId !== flow.accountId)) return refuse("not the account that started it");
    if (flow.mode !== "signin" && flow.app && (!flow.accountId || !flow.app.sessionId)) return refuse("no session asked for it");

    const posted = await postForm(
      config.tokenUrl ?? GOOGLE_TOKEN_URL,
      { client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: flow.verifier, redirect_uri: flow.redirectUri, grant_type: "authorization_code" },
      config.timeoutMs ? { timeoutMs: config.timeoutMs } : {},
    );
    if (!posted.ok) return refuse(`the token endpoint (${posted.reason})`);
    const idToken = (posted.body as { id_token?: unknown } | null)?.id_token;
    const claims = typeof idToken === "string" ? readIdToken(idToken, { clientId: config.clientId, nonce: flow.nonce, now: store.clock() }) : undefined;
    if (!claims) return refuse("the ID token");

    if (flow.mode === "link") {
      const owner = store.findByGoogle(claims.sub);
      if (owner && owner.id !== flow.accountId) return back("taken");
      if (flow.app) return toApp({ then: { kind: "link", accountId: flow.accountId!, sessionId: flow.app.sessionId!, sub: claims.sub } });
      const linked = store.linkGoogle(flow.accountId!, claims.sub);
      return linked.ok ? back("linked") : refuse("the account has another Google account");
    }
    if (flow.mode === "reauth") {
      if (store.getAccount(flow.accountId!)?.google?.sub !== claims.sub) return refuse("another Google account");
      if (flow.app) return toApp({ then: { kind: "reauth", accountId: flow.accountId!, sessionId: flow.app.sessionId!, sub: claims.sub } });
      store.confirmSession(auth!.sessionId, store.clock() + REAUTH_MS);
      return back("reauth");
    }
    const found = store.findByGoogle(claims.sub);
    if (found) {
      if (flow.app) return toApp({ then: { kind: "signIn", accountId: found.id } });
      helpers.signIn(request, reply, found.id, flow.device);
      return back();
    }
    // Nobody yet: an account is made, as one with a password would be (only while new ones may be, and not too many from one address).
    if (helpers.registrationNow() === "closed") return back("closed");
    // (The app's trip makes the account only when the app claims it, with the secret only it knows: a page of another site that sent someone through Google's chooser
    // with a hash of its own - which the gate lets in, as the app's browser says it comes from another site - makes nothing. The judge, 17 Nov.)
    if (flow.app) return toApp({ then: { kind: "signUp", sub: claims.sub, name: profileNameOf(claims.givenName) } });
    if (helpers.signUpByIp.wait(request.ip) > 0) return back("busy");
    helpers.signUpByIp.hit(request.ip);
    const made = store.createGoogleAccount(claims.sub, profileNameOf(claims.givenName), await hashPassword(secret(), helpers.passwordCost));
    if (!made.ok) return refuse("the account was made a moment ago");
    if (flow.app) return toApp({ then: { kind: "signIn", accountId: made.value.id } });
    helpers.signIn(request, reply, made.value.id, flow.device);
    return back();
  });

  // The app's WebView brings the code its browser came back with, and the secret only the app knows: the WebView is signed in here (see `AppTrip`).
  // (Its address has the code and the secret in it: Fastify's line for each request is not written for this route.)
  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/app-claim", { logLevel: "warn" }, async (request, reply) => {
    const query = request.query ?? {};
    const code = typeof query.code === "string" ? query.code : "";
    const handoff = code ? handoffs.get(code) : undefined;
    if (handoff) handoffs.delete(code); // (good once, whatever comes of it)
    const next = handoff?.next ?? "/";
    const failed = (why: string) => {
      request.log.warn(`The app's Google sign-in refused: ${why}.`);
      return reply.redirect(`${next}?google=failed`);
    };
    if (claimsByIp.wait(request.ip) > 0) return reply.redirect(`${next}?google=busy`);
    claimsByIp.hit(request.ip);
    if (!handoff) return failed("no such code");
    if (store.clock() - handoff.at > HANDOFF_MS) return failed("too late");
    const verifier = typeof query.verifier === "string" ? query.verifier : "";
    if (!verifier || challengeOf(verifier) !== handoff.challenge) return failed("not the app that started it");
    const then = handoff.then;
    if (!then) return reply.redirect(handoff.outcome ? `${next}?google=${handoff.outcome}` : next);
    if (then.kind === "signIn") {
      if (!store.getAccount(then.accountId)) return failed("the account is gone");
      helpers.signIn(request, reply, then.accountId, handoff.device);
      return reply.redirect(next);
    }
    if (then.kind === "signUp") {
      // (Made by another trip since: signed in to it.)
      const found = store.findByGoogle(then.sub);
      if (found) {
        helpers.signIn(request, reply, found.id, handoff.device);
        return reply.redirect(next);
      }
      if (helpers.registrationNow() === "closed") return reply.redirect(`${next}?google=closed`);
      if (helpers.signUpByIp.wait(request.ip) > 0) return reply.redirect(`${next}?google=busy`);
      helpers.signUpByIp.hit(request.ip);
      const made = store.createGoogleAccount(then.sub, then.name, await hashPassword(secret(), helpers.passwordCost));
      if (!made.ok) return failed("the account was made a moment ago");
      helpers.signIn(request, reply, made.value.id, handoff.device);
      return reply.redirect(next);
    }
    // (Connecting and confirming: only by the session that asked for the ticket, still signed in to that account, here and now.)
    const auth = helpers.authenticate(request);
    if (!auth || auth.sessionId !== then.sessionId || auth.accountId !== then.accountId) return failed("not the session that asked for it");
    if (then.kind === "link") {
      const owner = store.findByGoogle(then.sub);
      if (owner && owner.id !== then.accountId) return reply.redirect(`${next}?google=taken`);
      return store.linkGoogle(then.accountId, then.sub).ok ? reply.redirect(`${next}?google=linked`) : failed("the account has another Google account");
    }
    if (store.getAccount(then.accountId)?.google?.sub !== then.sub) return failed("another Google account");
    store.confirmSession(auth.sessionId, store.clock() + REAUTH_MS);
    return reply.redirect(`${next}?google=reauth`);
  });

  return { here: (request) => Boolean(config && redirectFor(config, request)) };
}
