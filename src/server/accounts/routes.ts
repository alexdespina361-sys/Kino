import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodError } from "zod";
import {
  ChildPinChangeSchema,
  ChildPinSchema,
  LinkPollSchema,
  LinkStartSchema,
  LoginSchema,
  NewPasswordSchema,
  NewProfileSchema,
  ProfilePatchSchema,
  RegisterSchema,
  SessionRenameSchema,
  SyncRequestSchema,
  type DeviceKind,
  type Me,
  type Registration,
  type SessionState,
} from "../../shared";
import { chatRoutes, type ChatReporter } from "./chatRoutes";
import { stickerRoutes } from "./stickerRoutes";
import { describeDevice } from "./device";
import { friendRoutes, type PartyLookup } from "./friendRoutes";
import { googleRoutes, type GoogleConfig } from "./google";
import { LinkRegistry } from "./links";
import { decoyHash, hashPassword, verifyPassword, type PasswordCost } from "./password";
import { DayCount, RateLimiter } from "./rateLimit";
import type { ScreenProofs } from "./screens";
import { PUSH_TOKEN_PATTERN, SESSION_TTL_MS, type AccountStore, type StoreError } from "./store";

export interface AccountRoutesOptions {
  store: AccountStore;
  links?: LinkRegistry;
  registration?: Registration;
  maxAccounts?: number;
  signUpsPerHour?: number;
  signUpsPerDay?: number;
  syncWritesPerDay?: number;
  slowChecksPer15Min?: number;
  passwordCost?: PasswordCost;
  parties?: PartyLookup;
  screens?: ScreenProofs;
  chatReport?: ChatReporter;
  titleNotices?: TitleNoticeBook;
  google?: GoogleConfig;
}

import type { TitleNoticeBook } from "../titleNotices/book";
import { titleNoticeRoutes } from "../titleNotices/routes";

export const COOKIE = "kino_session";
const MINUTE = 60_000;

export const DEFAULT_MAX_ACCOUNTS = 2000;
export const DEFAULT_SIGNUPS_PER_DAY = 100;
export const SYNC_WRITES_A_DAY = 100_000;
const carriesChanges = (sync: SyncRequestParsed): boolean =>
  sync.progress.length + sync.watched.length + sync.list.length + sync.listNames.length + sync.ratings.length + sync.settings.length + sync.saved.length > 0;
type SyncRequestParsed = ReturnType<typeof SyncRequestSchema.parse>;

export interface SignUpLimits {
  wait(ip: string): number;
  hit(ip: string): void;
  notMade(): void;
}
export const signUpsNow = (registration: Registration, accounts: number, maxAccounts: number): Registration => (registration === "closed" || accounts >= maxAccounts ? "closed" : "open");

const PasswordChangeSchema = z.object({ current: z.string().max(200), next: NewPasswordSchema });
const ConfirmSchema = z.object({ password: z.string().max(200) });
const PinCheckSchema = z.object({ pin: ChildPinSchema });
const CreateProfileSchema = NewProfileSchema.partial({ avatar: true });
const PushDeviceSchema = z.object({ token: z.string().regex(PUSH_TOKEN_PATTERN), profileId: z.string().min(1).max(64) });

const FORM_ERRORS = new Set(["invalid_email", "weak_password", "invalid_name"]);

const STORE_STATUS: Record<StoreError, number> = { email_taken: 409, google_taken: 409, profile_limit: 409, name_taken: 409, last_profile: 409, not_found: 404 };

export function readCookie(header: string | undefined, name: string): string | undefined {
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

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, options) => {
  const { store } = options;
  const links = options.links ?? new LinkRegistry();
  const registration = options.registration ?? "open";
  const maxAccounts = options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS;

  const failedByEmail = new RateLimiter(10, 15 * MINUTE, undefined, "login.failedByName");
  const failedByIp = new RateLimiter(100, 15 * MINUTE, undefined, "login.failedByIp");
  const signUpByIp = new RateLimiter(options.signUpsPerHour ?? 10, 60 * MINUTE, undefined, "signUp.byIp");
  const signUpsSite = new DayCount(options.signUpsPerDay ?? Math.max(DEFAULT_SIGNUPS_PER_DAY, 10 * (options.signUpsPerHour ?? 0)), undefined, "signUp.siteDay");
  const signUps: SignUpLimits = {
    wait: (ip) => Math.max(signUpByIp.wait(ip), signUpsSite.wait("all")),
    hit: (ip) => {
      signUpByIp.hit(ip);
      signUpsSite.hit("all");
    },
    notMade: () => signUpsSite.undo("all"),
  };
  const linkStartByIp = new RateLimiter(60, 5 * MINUTE, undefined, "link.startByIp");
  const linkPollByIp = new RateLimiter(900, MINUTE);
  const linkLookupByAccount = new RateLimiter(30, 5 * MINUTE, undefined, "link.lookupByAccount");
  const syncByAccount = new RateLimiter(600, MINUTE);
  const syncWritesByAccount = new DayCount(options.syncWritesPerDay ?? SYNC_WRITES_A_DAY, undefined, "sync.writesByAccountDay");
  const pushByAccount = new RateLimiter(30, 10 * MINUTE, undefined, "push.devicesByAccount");
  const wrongPinByAccount = new RateLimiter(5, 15 * MINUTE, undefined, "childPin.wrongByAccount");
  const slowChecksByIp = new RateLimiter(options.slowChecksPer15Min ?? 150, 15 * MINUTE, undefined, "password.slowChecksByIp");
  const slowCheck = (ip: string): number => {
    const wait = slowChecksByIp.wait(ip);
    if (wait === 0) slowChecksByIp.hit(ip);
    return wait;
  };

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

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
    const google = account?.google ? { google: true as const, ...(account.google.only ? { googleOnly: true as const } : {}) } : {};
    const pin = account?.childPin ? { childPin: true as const } : {};
    return { account: { id: account?.id ?? accountId, email: account?.email ?? "", ...google, ...pin }, profiles: store.profilesOf(accountId) };
  };
  const registrationNow = (): Registration => signUpsNow(registration, store.countAccounts(), maxAccounts);

  const signIn = (request: FastifyRequest, reply: FastifyReply, accountId: string, kind: DeviceKind, label = describeDevice(request.headers["user-agent"])) => {
    const { token } = store.createSession(accountId, kind, label);
    reply.header("Set-Cookie", setCookie(token, request.protocol === "https", Math.floor(SESSION_TTL_MS / 1000)));
  };
  const signOutCookie = (request: FastifyRequest, reply: FastifyReply) => reply.header("Set-Cookie", setCookie("", request.protocol === "https", 0));

  const google = googleRoutes(app, { store, authenticate, signIn, readCookie, registrationNow, signUps, passwordCost: options.passwordCost }, options.google);

  async function passwordIsRight(email: string, ip: string, password: string): Promise<{ right: boolean; wait: number }> {
    const wait = Math.max(failedByEmail.wait(email), failedByIp.wait(ip)) || slowCheck(ip);
    if (wait > 0) return { right: false, wait };
    failedByEmail.hit(email);
    const account = store.findByEmail(email);
    const right = await verifyPassword(password, account?.hash ?? (await decoyHash()));
    if (!account || !right) {
      failedByIp.hit(ip);
      return { right: false, wait: 0 };
    }
    failedByEmail.reset(email);
    return { right: true, wait: 0 };
  }

  async function pinIsRight(accountId: string, ip: string, pin: string): Promise<{ right: boolean; wait: number; none?: true }> {
    const hash = store.getAccount(accountId)?.childPin;
    if (!hash) return { right: true, wait: 0, none: true };
    const wait = Math.max(wrongPinByAccount.wait(accountId), failedByIp.wait(ip)) || slowCheck(ip);
    if (wait > 0) return { right: false, wait };
    wrongPinByAccount.hit(accountId);
    if (await verifyPassword(pin, hash)) {
      wrongPinByAccount.reset(accountId);
      return { right: true, wait: 0 };
    }
    failedByIp.hit(ip);
    return { right: false, wait: 0 };
  }

  app.get("/api/me", async (request, reply) => {
    const auth = authenticate(request);
    if (auth) reply.header("Set-Cookie", setCookie(auth.token, request.protocol === "https", Math.floor(SESSION_TTL_MS / 1000)));
    const state: SessionState = { me: auth ? meOf(auth.accountId) : null, registration: registrationNow(), ...(google.here(request) ? { google: true } : {}) };
    return reply.send(state);
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (registrationNow() === "closed") return reply.code(403).send({ error: "registration_closed" });
    const wait = signUps.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    signUps.hit(request.ip);
    const hash = await hashPassword(parsed.data.password, options.passwordCost);
    if (registrationNow() === "closed") {
      signUps.notMade();
      return reply.code(403).send({ error: "registration_closed" });
    }
    const created = store.createAccount(parsed.data.email, hash, parsed.data.name);
    if (!created.ok) {
      signUps.notMade();
      return refused(reply, created.error);
    }
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

  app.put("/api/push", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = PushDeviceSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const wait = pushByAccount.wait(auth.accountId);
    if (wait > 0) return tooMany(reply, wait);
    pushByAccount.hit(auth.accountId);
    if (!store.setPush(auth.sessionId, parsed.data.token, parsed.data.profileId)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.delete("/api/push", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const wait = pushByAccount.wait(auth.accountId);
    if (wait > 0) return tooMany(reply, wait);
    pushByAccount.hit(auth.accountId);
    store.clearPush(auth.sessionId);
    return reply.code(204).send();
  });

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
    const slow = slowCheck(request.ip);
    if (slow > 0) return tooMany(reply, slow);
    store.setPasswordHash(account.id, await hashPassword(parsed.data.next, options.passwordCost));
    store.revokeAll(account.id, auth.sessionId);
    return reply.code(204).send();
  });

  app.post("/api/me/delete", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const account = store.getAccount(auth.accountId);
    if (!account) return signedOut(reply);
    if (account.google?.only) {
      if (!store.confirmedNow(auth.sessionId)) return reply.code(403).send({ error: "reauth_required" });
    } else {
      const parsed = ConfirmSchema.safeParse(request.body);
      if (!parsed.success) return invalid(reply, parsed.error);
      const { right, wait } = await passwordIsRight(account.email, request.ip, parsed.data.password);
      if (wait > 0) return tooMany(reply, wait);
      if (!right) return reply.code(401).send({ error: "invalid_credentials" });
    }
    store.deleteAccount(account.id);
    signOutCookie(request, reply);
    return reply.code(204).send();
  });

  app.post("/api/me/child-pin/check", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = PinCheckSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { right, wait, none } = await pinIsRight(auth.accountId, request.ip, parsed.data.pin);
    if (none) return reply.code(404).send({ error: "no_pin" });
    if (wait > 0) return tooMany(reply, wait);
    return right ? reply.code(204).send() : reply.code(401).send({ error: "wrong_pin" });
  });

  app.post("/api/me/child-pin", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = ChildPinChangeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const account = store.getAccount(auth.accountId);
    if (!account) return signedOut(reply);
    const { next, pin, password } = parsed.data;
    if (account.childPin) {
      if (pin !== undefined) {
        const checked = await pinIsRight(account.id, request.ip, pin);
        if (checked.wait > 0) return tooMany(reply, checked.wait);
        if (!checked.right) return reply.code(401).send({ error: "wrong_pin" });
      } else if (password !== undefined && !account.google?.only) {
        const checked = await passwordIsRight(account.email, request.ip, password);
        if (checked.wait > 0) return tooMany(reply, checked.wait);
        if (!checked.right) return reply.code(401).send({ error: "invalid_credentials" });
      } else if (account.google?.only && store.confirmedNow(auth.sessionId)) {
        store.spendConfirmation(auth.sessionId);
      } else {
        return reply.code(403).send({ error: account.google?.only ? "reauth_required" : "pin_required" });
      }
    }
    const slow = next === null ? 0 : slowCheck(request.ip);
    if (slow > 0) return tooMany(reply, slow);
    store.setChildPin(account.id, next === null ? undefined : await hashPassword(next, options.passwordCost));
    return reply.send(meOf(account.id));
  });

  app.get("/api/sessions", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    return reply.send(store.listSessions(auth.accountId, auth.sessionId));
  });

  app.patch<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    const parsed = SessionRenameSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    if (!store.renameSession(auth.accountId, request.params.id, parsed.data.label)) return refused(reply, "not_found");
    return reply.send(store.listSessions(auth.accountId, auth.sessionId));
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    return store.revokeSession(auth.accountId, request.params.id) ? reply.code(204).send() : refused(reply, "not_found");
  });

  app.delete("/api/sessions", async (request, reply) => {
    const auth = authenticate(request);
    if (!auth) return signedOut(reply);
    store.revokeAll(auth.accountId, auth.sessionId);
    return reply.code(204).send();
  });

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
    const writes = carriesChanges(parsed.data);
    const overToday = writes ? syncWritesByAccount.wait(auth.accountId) : 0;
    if (overToday > 0) return tooMany(reply, overToday);
    const answer = store.sync(request.params.id, parsed.data);
    if (answer && writes) syncWritesByAccount.hit(auth.accountId);
    return answer ? reply.send(answer) : refused(reply, "not_found");
  });

  app.post("/api/link/start", async (request, reply) => {
    const wait = linkStartByIp.wait(request.ip);
    if (wait > 0) return tooMany(reply, wait);
    const parsed = LinkStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    linkStartByIp.hit(request.ip);
    const started = links.start(parsed.data.device ?? "tv", describeDevice(request.headers["user-agent"]), request.ip);
    return started ? reply.code(201).send(started) : reply.code(503).send({ error: "busy" });
  });

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

  const friendHelpers = {
    store,
    authenticate,
    signedOut,
    tooMany,
    invalid,
    refused,
    ...(options.parties ? { parties: options.parties } : {}),
    ...(options.screens ? { screens: options.screens } : {}),
  };
  friendRoutes(app, friendHelpers);
  chatRoutes(app, friendHelpers, { chat: store.chats, stickers: store.stickers, ...(options.chatReport ? { report: options.chatReport } : {}) });
  stickerRoutes(app, friendHelpers, store.stickers);
  titleNoticeRoutes(app, friendHelpers, options.titleNotices);
};
