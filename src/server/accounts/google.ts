import { createHash, randomBytes } from "node:crypto";
import { request as plainRequest } from "node:http";
import { request as tlsRequest } from "node:https";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DeviceKindSchema, PROFILE_NAME_MAX, type DeviceKind, type GoogleOutcome, type Registration } from "../../shared";
import { remember } from "../boundedMap";
import { hashPassword, type PasswordCost } from "./password";
import { RateLimiter } from "./rateLimit";
import type { SignUpLimits } from "./routes";
import type { AccountStore } from "./store";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALLBACK = "/api/auth/google/callback";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  authorizeUrl?: string;
  tokenUrl?: string;
  timeoutMs?: number;
}

const FLOW_COOKIE = "kino_oauth";
const FLOW_MS = 10 * 60_000;
const MAX_FLOWS = 2000;
export const FLOWS_PER_ADDRESS = 5;
export const REAUTH_MS = 5 * 60_000;
const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_MAX_BYTES = 64 * 1024;
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

function isCallback(address: string): boolean {
  const url = parsed(address);
  return Boolean(url && (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url))) && url.pathname === GOOGLE_CALLBACK && !url.search && !url.hash && !url.username && !url.password);
}

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

export type Posted = { ok: true; body: unknown } | { ok: false; reason: "address" | "network" | "timeout" | "status" | "type" | "size" | "json" };

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

export interface GoogleClaims {
  sub: string;
  givenName?: string;
}

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

export function profileNameOf(givenName: string | undefined): string {
  const cleaned = (givenName ?? "").slice(0, 200).normalize("NFC").replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ").replace(/\s+/g, " ").trim();
  let name = "";
  for (const letter of cleaned) {
    if (name.length + letter.length > PROFILE_NAME_MAX) break;
    name += letter;
  }
  return name.trim() || "Me";
}

interface Flow {
  nonce: string;
  verifier: string;
  redirectUri: string;
  mode: Mode;
  device: DeviceKind;
  next: "/" | "/tv";
  accountId?: string;
  startedAt: number;
  from: string;
  app?: AppTrip;
}

interface AppTrip {
  challenge: string;
  sessionId?: string;
}

type HandoffThen =
  | { kind: "signIn"; accountId: string }
  | { kind: "signUp"; sub: string; name: string }
  | { kind: "link" | "reauth"; accountId: string; sessionId: string; sub: string };

interface Handoff {
  challenge: string;
  next: "/" | "/tv";
  device: DeviceKind;
  then?: HandoffThen;
  outcome?: GoogleOutcome;
  at: number;
}

export const APP_SCHEME = "kino4tv";
export const APP_PACKAGE = "com.kino4tv.app";

export const appAddress = (code: string, challenge: string, origin: string, next: string) =>
  `intent://google?code=${code}&trip=${challenge.slice(0, APP_TRIP_LENGTH)}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(new URL(next, origin).toString())};end`;
export const APP_TRIP_LENGTH = 16;
const APP_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

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
  signUps: SignUpLimits;
  passwordCost?: PasswordCost | undefined;
}

const secret = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const flowCookie = (value: string, secure: boolean, maxAgeSeconds: number) =>
  `${FLOW_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;

function redirectFor(config: GoogleConfig, request: FastifyRequest): string | undefined {
  const here = parsed(`${request.protocol}://${request.host}`);
  if (!here || here.pathname !== "/" || here.username || here.password || here.search || here.hash) return undefined;
  return config.redirectUris.find((address) => parsed(address)?.origin === here.origin);
}

export function googleRoutes(app: FastifyInstance, helpers: GoogleHelpers, config: GoogleConfig | undefined): { here(request: FastifyRequest): boolean } {
  const { store } = helpers;
  const flows = new Map<string, Flow>();
  const startsByIp = new RateLimiter(30, FLOW_MS, undefined, "google.startsByIp");
  const tickets = new Map<string, { mode: "link" | "reauth"; device: DeviceKind; next: "/" | "/tv"; accountId: string; sessionId: string; challenge: string; at: number }>();
  const handoffs = new Map<string, Handoff>();
  const claimsByIp = new RateLimiter(30, FLOW_MS, undefined, "google.claimsByIp");
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
    if (ticket) tickets.delete(ticketId);
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
    const auth = mode === "signin" || fresh ? undefined : helpers.authenticate(request);
    if (mode !== "signin" && !auth && !fresh) return back("failed");
    const now = store.clock();
    let oldestOfMine: string | undefined;
    let mine = 0;
    for (const [key, each] of flows) {
      if (now - each.startedAt > FLOW_MS) flows.delete(key);
      else if (each.from === request.ip) {
        mine++;
        oldestOfMine ??= key;
      }
    }
    if (mine >= FLOWS_PER_ADDRESS && oldestOfMine) flows.delete(oldestOfMine);
    if (flows.size >= MAX_FLOWS) return back("busy");
    startsByIp.hit(request.ip);

    const state = secret();
    const nonce = secret();
    const verifier = secret();
    const accountId = fresh?.accountId ?? auth?.accountId;
    flows.set(state, { nonce, verifier, redirectUri, mode, device, next, ...(accountId ? { accountId } : {}), ...(trip ? { app: trip } : {}), startedAt: now, from: request.ip });
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
      prompt: "select_account",
      ...(mode === "reauth" ? { max_age: "0" } : {}),
    }).toString();
    return reply.redirect(target.toString());
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/callback", { logLevel: "warn" }, async (request, reply) => {
    const query = request.query ?? {};
    reply.header("Set-Cookie", flowCookie("", request.protocol === "https", 0));
    const state = typeof query.state === "string" ? query.state : "";
    const flow = state ? flows.get(state) : undefined;
    if (flow) flows.delete(state);
    const next = flow?.next ?? "/";
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
    if (helpers.registrationNow() === "closed") return back("closed");
    if (flow.app) return toApp({ then: { kind: "signUp", sub: claims.sub, name: profileNameOf(claims.givenName) } });
    if (helpers.signUps.wait(request.ip) > 0) return back("busy");
    helpers.signUps.hit(request.ip);
    const hash = await hashPassword(secret(), helpers.passwordCost);
    if (helpers.registrationNow() === "closed") {
      helpers.signUps.notMade();
      return back("closed");
    }
    const made = store.createGoogleAccount(claims.sub, profileNameOf(claims.givenName), hash);
    if (!made.ok) {
      helpers.signUps.notMade();
      return refuse("the account was made a moment ago");
    }
    if (flow.app) return toApp({ then: { kind: "signIn", accountId: made.value.id } });
    helpers.signIn(request, reply, made.value.id, flow.device);
    return back();
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/auth/google/app-claim", { logLevel: "warn" }, async (request, reply) => {
    const query = request.query ?? {};
    const code = typeof query.code === "string" ? query.code : "";
    const handoff = code ? handoffs.get(code) : undefined;
    if (handoff) handoffs.delete(code);
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
      const found = store.findByGoogle(then.sub);
      if (found) {
        helpers.signIn(request, reply, found.id, handoff.device);
        return reply.redirect(next);
      }
      if (helpers.registrationNow() === "closed") return reply.redirect(`${next}?google=closed`);
      if (helpers.signUps.wait(request.ip) > 0) return reply.redirect(`${next}?google=busy`);
      helpers.signUps.hit(request.ip);
      const hash = await hashPassword(secret(), helpers.passwordCost);
      if (helpers.registrationNow() === "closed") {
        helpers.signUps.notMade();
        return reply.redirect(`${next}?google=closed`);
      }
      const made = store.createGoogleAccount(then.sub, then.name, hash);
      if (!made.ok) {
        helpers.signUps.notMade();
        return failed("the account was made a moment ago");
      }
      helpers.signIn(request, reply, made.value.id, handoff.device);
      return reply.redirect(next);
    }
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
