import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { MemoryPersistence } from "../accounts/persistence";
import { AccountStore } from "../accounts/store";
import { AppReleases, readRelease } from "./appRelease";
import { FcmSender, fcmFromEnv, serviceJwt, type FcmConfig, type PushMessage, type PushResult, type PushSender } from "./fcm";
import { PushHub, QUIET_MS, UPDATE_TOPIC } from "./push";

/**
 * The Android app's notifications and updates, against a Firebase of this file's own (a server on 127.0.0.1): nothing here reaches Google.
 */

const cheap = { N: 1024, r: 8, p: 1 } as const;
const clock = { now: 1_800_000_000_000 };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

/** A Firebase of our own: the token endpoint and `messages:send`, with what each was sent kept. */
class FakeFirebase {
  server!: Server;
  origin = "";
  tokens: URLSearchParams[] = [];
  sent: Array<{ auth: string; body: any }> = [];
  /** What `messages:send` answers next (then 200). */
  answers: number[] = [];
  /** What the token endpoint answers. */
  tokenStatus = 200;

  async start() {
    this.server = createServer(async (request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/token") {
        this.tokens.push(new URLSearchParams(text));
        response.writeHead(this.tokenStatus, { "content-type": "application/json" });
        return response.end(JSON.stringify({ access_token: `access-${this.tokens.length}`, expires_in: 3600, token_type: "Bearer" }));
      }
      this.sent.push({ auth: String(request.headers.authorization), body: JSON.parse(text) });
      const status = this.answers.shift() ?? 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(status === 200 ? JSON.stringify({ name: "projects/kino-test/messages/1" }) : JSON.stringify({ error: { code: status, status: status === 404 ? "NOT_FOUND" : "X", details: [{ errorCode: status === 404 ? "UNREGISTERED" : "X" }] } }));
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  reset() {
    this.tokens = [];
    this.sent = [];
    this.answers = [];
    this.tokenStatus = 200;
  }
}

const firebase = new FakeFirebase();
beforeAll(() => firebase.start());
afterAll(() => new Promise<void>((resolve) => firebase.server.close(() => resolve())));
beforeEach(() => {
  firebase.reset();
  clock.now = 1_800_000_000_000;
});

const config = (): FcmConfig => ({ projectId: "kino-test", clientEmail: "push@kino-test.iam.gserviceaccount.example", privateKey, tokenUrl: `${firebase.origin}/token`, sendUrl: `${firebase.origin}/send`, timeoutMs: 2000 });

describe("the Firebase sender", () => {
  it("proves itself with a JWT signed by the service account's key, for Firebase messaging only and an hour at most", () => {
    const jwt = serviceJwt(config(), clock.now);
    const [head, body, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual({
      iss: "push@kino-test.iam.gserviceaccount.example",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: `${firebase.origin}/token`,
      iat: clock.now / 1000,
      exp: clock.now / 1000 + 3600,
    });
    expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(createPublicKey(publicKey), Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("trades it for an access token once, keeps it while it lasts, and sends a data message with the high priority Android wakes the app for", async () => {
    const sender = new FcmSender(config(), () => clock.now);
    expect(await sender.send({ token: "device-1", data: { kind: "chat", name: "Sam" }, collapseKey: "chat-pro_sam", ttlSeconds: 60 })).toBe("sent");
    expect(await sender.send({ topic: UPDATE_TOPIC, data: { kind: "update", version: "2" } })).toBe("sent");
    expect(firebase.tokens).toHaveLength(1);
    expect(firebase.tokens[0]!.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(firebase.sent.map((each) => each.auth)).toEqual(["Bearer access-1", "Bearer access-1"]);
    expect(firebase.sent[0]!.body).toEqual({ message: { token: "device-1", data: { kind: "chat", name: "Sam" }, android: { priority: "high", ttl: "60s", collapse_key: "chat-pro_sam" } } });
    expect(firebase.sent[1]!.body.message.topic).toBe(UPDATE_TOPIC);
    clock.now += 56 * 60_000; // (a little before the hour is up, a new one)
    await sender.send({ token: "device-1", data: {} });
    expect(firebase.tokens).toHaveLength(2);
  });

  it("says a token Firebase does not know is gone, and anything else failed (keeping the token); a refused access token is asked for again", async () => {
    const sender = new FcmSender(config(), () => clock.now);
    firebase.answers = [404, 500, 401];
    expect(await sender.send({ token: "device-old", data: {} })).toBe("gone");
    expect(await sender.send({ token: "device-1", data: {} })).toBe("failed");
    expect(await sender.send({ token: "device-1", data: {} })).toBe("failed");
    expect(await sender.send({ token: "device-1", data: {} })).toBe("sent");
    expect(firebase.tokens).toHaveLength(2);
    firebase.tokenStatus = 400;
    expect(await new FcmSender(config(), () => clock.now).send({ token: "device-1", data: {} })).toBe("failed");
  });

  it("is on only with a readable key of a service account, and a fake Firebase only on this machine for tests", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kino-fcm-"));
    try {
      const file = path.join(dir, "key.json");
      writeFileSync(file, JSON.stringify({ type: "service_account", project_id: "kino-513800", client_email: "a@b.example", private_key: privateKey }));
      const warned: string[] = [];
      const on = fcmFromEnv({ FCM_SERVICE_ACCOUNT_FILE: file, FCM_SEND_URL: "http://127.0.0.1:9/send" }, (message) => warned.push(message));
      expect(on?.sendUrl).toBe("https://fcm.googleapis.com/v1/projects/kino-513800/messages:send");
      expect(on?.tokenUrl).toBe("https://oauth2.googleapis.com/token");
      expect(warned.join(" ")).not.toContain("PRIVATE KEY");
      expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT_FILE: file, FCM_SEND_URL: "http://127.0.0.1:9/send", ALLOW_PRIVATE_NETWORK: "1" })?.sendUrl).toBe("http://127.0.0.1:9/send");
      expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT_FILE: file, FCM_SEND_URL: "https://evil.example/send", ALLOW_PRIVATE_NETWORK: "1" })?.sendUrl).toContain("fcm.googleapis.com");
      expect(fcmFromEnv({})).toBeUndefined();
      expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT_FILE: path.join(dir, "none.json") })).toBeUndefined();
      writeFileSync(file, JSON.stringify({ project_id: "kino-513800" }));
      expect(fcmFromEnv({ FCM_SERVICE_ACCOUNT_FILE: file })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------ who is told of what ------------------------------ */

/** A sender that keeps what it was given, and answers what it is told to. */
class KeptSender implements PushSender {
  sent: PushMessage[] = [];
  answer: PushResult = "sent";
  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    return this.answer;
  }
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** Two friends, Ana and Sam, each on an account of their own; Ana's phone has the app. */
async function friends(sender: PushSender | null = new KeptSender()) {
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  const hub = new PushHub(store, sender ?? undefined);
  const anaAccount = store.createAccount("ana", "x");
  const samAccount = store.createAccount("sam", "x");
  if (!anaAccount.ok || !samAccount.ok) throw new Error("accounts");
  const ana = store.profilesOf(anaAccount.value.id)[0]!.id;
  const sam = store.profilesOf(samAccount.value.id)[0]!.id;
  const code = store.friends.createInvite(sam);
  expect(store.friends.redeem(ana, code.code).ok).toBe(true);
  const phone = store.createSession(anaAccount.value.id, "remote", "Ana's phone");
  expect(store.setPush(phone.session.id, "ana-phone-token-0000000000", ana)).toBe(true);
  return { store, hub, ana, sam, phone, anaAccount: anaAccount.value.id };
}

describe("what the app is told of", () => {
  it("a friend's message, once in a while for the same friend, with their name and nothing of what they wrote", async () => {
    const sender = new KeptSender();
    const { store, hub, ana, sam } = await friends(sender);
    expect(store.chats.send(sam, ana, "the secret plan").ok).toBe(true);
    await hub.settled();
    expect(sender.sent).toEqual([{ token: "ana-phone-token-0000000000", data: { kind: "chat", name: store.profileCard(sam)!.name, friend: sam, profile: ana }, collapseKey: `chat-${sam}`, ttlSeconds: 86_400 }]);
    expect(JSON.stringify(sender.sent)).not.toContain("secret plan");
    clock.now += 1000;
    store.chats.send(sam, ana, "and another");
    await hub.settled();
    expect(sender.sent).toHaveLength(1);
    clock.now += QUIET_MS;
    store.chats.send(sam, ana, "still there?");
    await hub.settled();
    expect(sender.sent).toHaveLength(2);
    // (What Ana writes is not told to Ana.)
    clock.now += QUIET_MS;
    store.chats.send(ana, sam, "yes");
    await hub.settled();
    expect(sender.sent).toHaveLength(2);
  });

  it("nothing of a friend Ana muted, and nothing once the phone signed out or is on another profile", async () => {
    const sender = new KeptSender();
    const { store, hub, ana, sam, phone, anaAccount } = await friends(sender);
    expect(store.chats.mute(ana, sam, true).ok).toBe(true);
    store.chats.send(sam, ana, "hello?");
    await hub.settled();
    expect(sender.sent).toHaveLength(0);
    store.chats.mute(ana, sam, false);
    const other = store.addProfile(anaAccount, "Kid", "fox");
    if (!other.ok) throw new Error("profile");
    store.setPush(phone.session.id, "ana-phone-token-0000000000", other.value.id);
    clock.now += QUIET_MS;
    store.chats.send(sam, ana, "hello?");
    await hub.settled();
    expect(sender.sent).toHaveLength(0);
    store.setPush(phone.session.id, "ana-phone-token-0000000000", ana);
    store.endSessionByToken(phone.token);
    clock.now += QUIET_MS;
    store.chats.send(sam, ana, "hello?");
    await hub.settled();
    expect(sender.sent).toHaveLength(0);
    expect(store.pushTokensOf(ana)).toEqual([]);
  });

  it("an inbox item, the same one again only once it was read; a token Firebase no longer knows is let go", async () => {
    const sender = new KeptSender();
    const { store, hub, ana, sam } = await friends(sender);
    store.friends.deliver(ana, sam, { kind: "together" });
    await hub.settled();
    expect(sender.sent.map((message) => message.data.kind)).toEqual(["together"]);
    clock.now += QUIET_MS;
    store.friends.deliver(ana, sam, { kind: "together" }); // (unread: the same invitation, not told again)
    await hub.settled();
    expect(sender.sent).toHaveLength(1);
    sender.answer = "gone";
    store.friends.deliver(ana, sam, { kind: "recommend", title: "Dune", url: "https://filmpire.sc/watch/438631" });
    await hub.settled();
    expect(sender.sent.at(-1)!.data).toEqual({ kind: "recommend", name: store.profileCard(sam)!.name, friend: sam, profile: ana });
    expect(JSON.stringify(sender.sent.at(-1))).not.toContain("Dune");
    expect(store.pushTokensOf(ana)).toEqual([]);
    expect(hub.counts.gone).toBe(1);
  });

  it("is nothing at all without a sender", async () => {
    const { store, hub, ana, sam } = await friends(null);
    expect(hub.on).toBe(false);
    expect(store.chats.send(sam, ana, "hi").ok).toBe(true);
    expect(await hub.appUpdate(3)).toBe(false);
  });
});

/* ------------------------------ the routes ------------------------------ */

async function site(options: { push?: PushSender; androidAppDir?: string } = {}) {
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  const app = await buildApp({ accounts: store, passwordCost: cheap, ...options });
  apps.push(app);
  return { app, store };
}

describe("the routes of the app", () => {
  it("PUT /api/push keeps the device with its sign-in for one of the account's profiles, DELETE forgets it, and signing out does too", async () => {
    const { app, store } = await site({ push: new KeptSender() });
    const signedUp = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "ana", password: "correct horse", device: "remote" } });
    const cookie = String(signedUp.headers["set-cookie"]).split(";")[0]!;
    const profile = signedUp.json().profiles[0].id;
    const put = (payload: object) => app.inject({ method: "PUT", url: "/api/push", headers: { cookie }, payload });
    expect((await put({ token: "ana-phone-token-0000000000", profileId: profile })).statusCode).toBe(204);
    expect(store.pushTokensOf(profile)).toEqual(["ana-phone-token-0000000000"]);
    expect((await put({ token: "ana-phone-token-0000000000", profileId: "pro_nobody" })).statusCode).toBe(404);
    expect((await put({ token: "bad token!", profileId: profile })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/push", payload: { token: "ana-phone-token-0000000000", profileId: profile } })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/push", headers: { cookie } })).statusCode).toBe(204);
    expect(store.pushTokensOf(profile)).toEqual([]);
    await put({ token: "ana-phone-token-0000000000", profileId: profile });
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(store.pushTokensOf(profile)).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/features" })).json().push).toBe(true);
  });

  it("offers the newest build from the folder, tells the apps of it once (also after a restart), and serves the APK", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kino-app-"));
    try {
      const apk = Buffer.from("PK\u0003\u0004 not really an apk");
      writeFileSync(path.join(dir, "kino-3.apk"), apk);
      const release = { versionCode: 3, versionName: "0.1.2", file: "kino-3.apk", sha256: "a".repeat(64), size: apk.length, notes: "Chat notifications" };
      writeFileSync(path.join(dir, "android.json"), JSON.stringify(release));
      const sender = new KeptSender();
      const { app } = await site({ push: sender, androidAppDir: dir });
      expect((await app.inject({ method: "GET", url: "/api/app/android" })).json()).toEqual({ versionCode: 3, versionName: "0.1.2", size: apk.length, sha256: "a".repeat(64), url: "/app/android/kino-3.apk", notes: "Chat notifications" });
      const file = await app.inject({ method: "GET", url: "/app/android/kino-3.apk" });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("application/vnd.android.package-archive");
      expect(file.rawPayload.equals(apk)).toBe(true);
      expect((await app.inject({ method: "GET", url: "/app/android/kino-2.apk" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/app/android/..%2Fandroid.json" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/app/kino.apk" })).headers.location).toBe("/app/android/kino-3.apk");
      expect(sender.sent).toEqual([{ topic: UPDATE_TOPIC, data: { kind: "update", version: "3" }, collapseKey: "update", ttlSeconds: 7 * 86_400 }]);
      // (A restart does not send it again.)
      const again = new KeptSender();
      await new AppReleases(dir, new PushHub((await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 })), again)).start();
      expect(again.sent).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("offers nothing when the folder has no release, or an APK that is not the one the release says", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kino-app-"));
    try {
      writeFileSync(path.join(dir, "kino-3.apk"), "short");
      writeFileSync(path.join(dir, "android.json"), JSON.stringify({ versionCode: 3, versionName: "0.1.2", file: "kino-3.apk", sha256: "a".repeat(64), size: 9999 }));
      const { app } = await site({ androidAppDir: dir });
      expect((await app.inject({ method: "GET", url: "/api/app/android" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/app/android/kino-3.apk" })).statusCode).toBe(404);
      expect(readRelease({ versionCode: 3, versionName: "x", file: "../kino-3.apk", sha256: "a".repeat(64), size: 1 })).toBeUndefined();
      expect(readRelease({ versionCode: 0, versionName: "x", file: "kino-3.apk", sha256: "a".repeat(64), size: 1 })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
