import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodError } from "zod";
import {
  LinkPollSchema,
  LinkStartSchema,
  LoginSchema,
  NewPasswordSchema,
  NewProfileSchema,
  ProfilePatchSchema,
  RegisterSchema,
  SyncRequestSchema,
  type DeviceKind,
  type Me,
  type Registration,
  type SessionState,
} from "../../shared";
import { describeDevice } from "./device";
import { LinkRegistry } from "./links";
import { decoyHash, hashPassword, verifyPassword, type PasswordCost } from "./password";
import { RateLimiter } from "./rateLimit";
import { SESSION_TTL_MS, type AccountStore, type StoreError } from "./store";

export interface AccountRoutesOptions {
  store: AccountStore;
  links?: LinkRegistry;
  /** `closed` stops new accounts (the ones that exist carry on). */
  registration?: Registration;
  /** No new accounts beyond this many: a public server is not a place to store the whole internet's. */
  maxAccounts?: number;
  /** Tests use a cheaper password hash. */
  passwordCost?: PasswordCost;
}

const COOKIE = "kino_session";
const MINUTE = 60_000;

const PasswordChangeSchema = z.object({ current: z.string().min(1).max(200), next: NewPasswordSchema });
const ConfirmSchema = z.object({ password: z.string().min(1).max(200) });
const CreateProfileSchema = NewProfileSchema.partial({ avatar: true });

/** The messages the forms know how to word; anything else the person typed wrong is just "invalid". */
const FORM_ERRORS = new Set(["invalid_email", "weak_password", "invalid_name"]);

const STORE_STATUS: Record<StoreError, number> = { email_taken: 409, profile_limit: 409, name_taken: 409, last_profile: 409, not_found: 404 };

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const setCookie = (value: string, secure: boolean, maxAgeSeconds: number) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;

/**
 * Everything about accounts under /api: signing up and in, profiles, the devices somebody is signed in on, signing a TV in
 * from a phone, and keeping what each profile watched. A session is an httpOnly cookie, so a page's own scripts never see it.
 */
export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, options) => {
  const { store } = options;
  const links = options.links ?? new LinkRegistry();
  const registration = options.registration ?? "open";
  const maxAccounts = options.maxAccounts ?? 500;

  // Guessing is slowed per address that is being tried, which is what protects an account whichever machine the guesses come
  // from; the per-visitor limits are loose, as behind some hosts every visitor can look like the same address.
  const failedByEmail = new RateLimiter(10, 15 * MINUTE);
  const failedByIp = new RateLimiter(100, 15 * MINUTE);
  const signUpByIp = new RateLimiter(10, 60 * MINUTE);
  const linkStartByIp = new RateLimiter(60, 5 * MINUTE);
  const linkPollByIp = new RateLimiter(900, MINUTE);
  const linkLookupByAccount = new RateLimiter(30, 5 * MINUTE);
  const syncByAccount = new RateLimiter(600, MINUTE);

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  /* ------------------------------ helpers ------------------------------ */

  const authenticate = (request: FastifyRequest) => {
    const token = readCookie(request.headers.cookie, COOKIE);
    const session = token ? store.getSession(token) : undefined;
    return token && session ? { accountId: session.accountId, sessionId: session.id, token } : undefined;
  };
  const signedOut = (reply: FastifyReply) => reply.code(401).send({ error: "signed_out" });
  const tooMany = (reply: FastifyReply, waitMs: number) => {
    const seconds = Math.max(1, Math.ceil(waitMs / 1000));
    return reply.header("Retry-After", seconds).code(429).send({ error: "rate_limited", retryAfter: seconds });
  };
  const invalid = (reply: FastifyReply, error: ZodError) => {
    const message = error.issues[0]?.message ?? "";
    return reply.code(400).send({ error: FORM_ERRORS.has(message) ? message : "invalid_request" });
  };
  const refused = (reply: FastifyReply, error: StoreError) => reply.code(STORE_STATUS[error]).send({ error });

  const meOf = (accountId: string): Me => {
    const account = store.getAccount(accountId);
    return { account: { id: account?.id ?? accountId, email: account?.email ?? "" }, profiles: store.profilesOf(accountId) };
  };
  const registrationNow = (): Registration => (registration === "closed" || store.countAccounts() >= maxAccounts ? "closed" : "open");

  /** A new session for this device, remembered by the cookie that goes back with the answer. */
  const signIn = (request: FastifyRequest, reply: FastifyReply, accountId: string, kind: DeviceKind, label = describeDevice(request.headers["user-agent"])) => {
    const { token } = store.createSession(accountId, kind, label);
    reply.header("Set-Cookie", setCookie(token, request.protocol === "https", Math.floor(SESSION_TTL_MS / 1000)));
  };
  const signOutCookie = (request: FastifyRequest, reply: FastifyReply) => reply.header("Set-Cookie", setCookie("", request.protocol === "https", 0));

  /** Check somebody's password, counting a wrong one against the account and the visitor. */
  async function passwordIsRight(email: string, ip: string, password: string): Promise<{ right: boolean; wait: number }> {
    const wait = Math.max(failedByEmail.wait(email), failedByIp.wait(ip));
    if (wait > 0) return { right: false, wait };
    const account = store.findByEmail(email);
    // An address nobody has is checked against a stand-in, so it takes as long as a wrong password and tells nothing.
    const right = await verifyPassword(password, account?.hash ?? (await decoyHash()));
    if (!account || !right) {
      failedByEmail.hit(email);
      failedByIp.hit(ip);
      return { right: false, wait: 0 };
    }
    failedByEmail.reset(email);
    return { right: true, wait: 0 };
  }

  /* ------------------------------ signing up and in ------------------------------ */

  app.get("/api/me", async (request, reply) => {
    const auth = authenticate(request);
    const state: SessionState = { me: auth ? meOf(auth.accountId) : null, registration: registrationNow() };
    return reply.send(state);
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (registrationNow() === "closed") return reply.code(403).send({ error: "registration_closed" });
    const wait = signUpByIp.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    signUpByIp.hit(request.ip);
    const created = store.createAccount(parsed.data.email, await hashPassword(parsed.data.password, options.passwordCost));
    if (!created.ok) return refused(reply, created.error);
    signIn(request, reply, created.value.id, parsed.data.device ?? "browser");
    return reply.code(201).send(meOf(created.value.id));
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { right, wait } = await passwordIsRight(parsed.data.email, request.ip, parsed.data.password);
    if (wait > 0) return tooMany(reply, wait);
    const account = store.findByEmail(parsed.data.email);
    if (!right || !account) return reply.code(401).send({ error: "invalid_credentials" });
    signIn(request, reply, account.id, parsed.data.device ?? "browser");
    return reply.send(meOf(account.id));
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, COOKIE);
    if (token) store.endSessionByToken(token);
    signOutCookie(request, reply);
    return reply.code(204).send();
  });

  /* ------------------------------ the account ------------------------------ */

  app.post("/api/me/password", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = PasswordChangeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const account = store.getAccount(auth.accountId);
    if (!account) return signedOut(reply);
    const { right, wait } = await passwordIsRight(account.email, request.ip, parsed.data.current);
    if (wait > 0) return tooMany(reply, wait);
    if (!right) return reply.code(401).send({ error: "invalid_credentials" });
    store.setPasswordHash(account.id, await hashPassword(parsed.data.next, options.passwordCost));
    // Everywhere else has to sign in again with the new one: that is half of why people change a password.
    store.revokeAll(account.id, auth.sessionId);
    return reply.code(204).send();
  });

  app.post("/api/me/delete", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = ConfirmSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const account = store.getAccount(auth.accountId);
    if (!account) return signedOut(reply);
    const { right, wait } = await passwordIsRight(account.email, request.ip, parsed.data.password);
    if (wait > 0) return tooMany(reply, wait);
    if (!right) return reply.code(401).send({ error: "invalid_credentials" });
    store.deleteAccount(account.id);
    signOutCookie(request, reply);
    return reply.code(204).send();
  });

  /* ------------------------------ devices ------------------------------ */

  app.get("/api/sessions", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    return reply.send(store.listSessions(auth.accountId, auth.sessionId));
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    return store.revokeSession(auth.accountId, request.params.id) ? reply.code(204).send() : refused(reply, "not_found");
  });

  /** Sign out everywhere but here. */
  app.delete("/api/sessions", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    store.revokeAll(auth.accountId, auth.sessionId);
    return reply.code(204).send();
  });

  /* ------------------------------ profiles ------------------------------ */

  app.post("/api/profiles", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = CreateProfileSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const added = store.addProfile(auth.accountId, parsed.data.name, parsed.data.avatar ?? store.freeAvatar(auth.accountId));
    return added.ok ? reply.code(201).send(meOf(auth.accountId)) : refused(reply, added.error);
  });

  app.patch<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = ProfilePatchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const changed = store.updateProfile(auth.accountId, request.params.id, parsed.data);
    return changed.ok ? reply.send(meOf(auth.accountId)) : refused(reply, changed.error);
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const removed = store.deleteProfile(auth.accountId, request.params.id);
    return removed.ok ? reply.send(meOf(auth.accountId)) : refused(reply, removed.error);
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/sync", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    if (!store.ownsProfile(auth.accountId, request.params.id)) return refused(reply, "not_found");
    const wait = syncByAccount.wait(auth.accountId);
    if (wait > 0) return tooMany(reply, wait);
    syncByAccount.hit(auth.accountId);
    const parsed = SyncRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const answer = store.sync(request.params.id, parsed.data);
    return answer ? reply.send(answer) : refused(reply, "not_found");
  });

  /* ------------------------------ signing a TV in from a phone ------------------------------ */

  // The TV, which is not signed in yet, asks for a code to show...
  app.post("/api/link/start", async (request, reply) => {
    const wait = linkStartByIp.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    const parsed = LinkStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    linkStartByIp.hit(request.ip);
    const started = links.start(parsed.data.device ?? "tv", describeDevice(request.headers["user-agent"]));
    return started ? reply.code(201).send(started) : reply.code(503).send({ error: "busy" });
  });

  // ...and asks every couple of seconds whether anybody has approved it. The secret is what makes this answer the TV's alone.
  app.post("/api/link/poll", async (request, reply) => {
    const wait = linkPollByIp.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    linkPollByIp.hit(request.ip);
    const parsed = LinkPollSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const claim = links.claim(parsed.data.code, parsed.data.secret);
    if (claim.status !== "approved") return reply.send({ status: claim.status });
    signIn(request, reply, claim.accountId, claim.kind, claim.label);
    return reply.send({ status: "approved", me: meOf(claim.accountId) });
  });

  // The signed-in phone looks at the request, and approves it or not.
  const lookedUp = (request: FastifyRequest, reply: FastifyReply) => {
    const auth = authenticate(request);
    if (!auth) return void signedOut(reply);
    const wait = linkLookupByAccount.wait(auth.accountId);
    if (wait > 0) return void tooMany(reply, wait);
    linkLookupByAccount.hit(auth.accountId);
    return auth;
  };

  app.get<{ Params: { code: string } }>("/api/link/:code", async (request, reply) => {
    if (!lookedUp(request, reply)) return reply;
    const view = links.peek(request.params.code);
    return view ? reply.send(view) : reply.code(404).send({ error: "link_gone" });
  });

  app.post<{ Params: { code: string } }>("/api/link/:code/approve", async (request, reply) => {
    const auth = lookedUp(request, reply);
    if (!auth) return reply;
    return links.approve(request.params.code, auth.accountId) ? reply.code(204).send() : reply.code(404).send({ error: "link_gone" });
  });

  app.post<{ Params: { code: string } }>("/api/link/:code/deny", async (request, reply) => {
    if (!lookedUp(request, reply)) return reply;
    return links.deny(request.params.code) ? reply.code(204).send() : reply.code(404).send({ error: "link_gone" });
  });
};
