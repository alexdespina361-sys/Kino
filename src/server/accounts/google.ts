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
}

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
  const startsByIp = new RateLimiter(30, FLOW_MS);

  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/start", async (request, reply) => {
    const query = request.query ?? {};
    const next = query.next === "/tv" ? "/tv" : "/";
    const device = DeviceKindSchema.safeParse(query.device).data ?? "browser";
    const mode = MODES.find((each) => each === query.mode) ?? "signin";
    const back = (outcome: GoogleOutcome) => reply.redirect(`${next}?google=${outcome}`);
    const redirectUri = config && redirectFor(config, request);
    if (!config || !redirectUri) return back("unavailable");
    if (startsByIp.wait(request.ip) > 0) return back("busy");
    const auth = mode === "signin" ? undefined : helpers.authenticate(request);
    if (mode !== "signin" && !auth) return back("failed");
    startsByIp.hit(request.ip);

    const state = secret();
    const nonce = secret();
    const verifier = secret();
    remember(flows, state, { nonce, verifier, redirectUri, mode, device, next, ...(auth ? { accountId: auth.accountId } : {}), startedAt: store.clock() }, MAX_FLOWS);
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
    const back = (outcome?: GoogleOutcome) => reply.redirect(outcome ? `${next}?google=${outcome}` : next);
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
    const auth = flow.mode === "signin" ? undefined : helpers.authenticate(request);
    if (flow.mode !== "signin" && (!auth || auth.accountId !== flow.accountId)) return refuse("not the account that started it");

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
      const linked = store.linkGoogle(flow.accountId!, claims.sub);
      return linked.ok ? back("linked") : refuse("the account has another Google account");
    }
    if (flow.mode === "reauth") {
      if (store.getAccount(flow.accountId!)?.google?.sub !== claims.sub) return refuse("another Google account");
      store.confirmSession(auth!.sessionId, store.clock() + REAUTH_MS);
      return back("reauth");
    }
    const found = store.findByGoogle(claims.sub);
    if (found) {
      helpers.signIn(request, reply, found.id, flow.device);
      return back();
    }
    // Nobody yet: an account is made, as one with a password would be (only while new ones may be, and not too many from one address).
    if (helpers.registrationNow() === "closed") return back("closed");
    if (helpers.signUpByIp.wait(request.ip) > 0) return back("busy");
    helpers.signUpByIp.hit(request.ip);
    const made = store.createGoogleAccount(claims.sub, profileNameOf(claims.givenName), await hashPassword(secret(), helpers.passwordCost));
    if (!made.ok) return refuse("the account was made a moment ago");
    helpers.signIn(request, reply, made.value.id, flow.device);
    return back();
  });

  return { here: (request) => Boolean(config && redirectFor(config, request)) };
}
