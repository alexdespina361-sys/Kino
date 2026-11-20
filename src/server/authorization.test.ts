import { createHash } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { PNG as PngImage } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { tagLabel } from "../shared";
import { MemoryPersistence } from "./accounts/persistence";
import { AccountStore, SESSION_TTL_MS } from "./accounts/store";
import { buildApp } from "./app";
import { FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { Registry } from "./sessions/registry";
import { VisitCounter } from "./stats/visits";

const cheap = { N: 1024, r: 8, p: 1 } as const;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const TOKEN = "the-teams-token-is-at-least-24-characters";
const OWNER_KEY = "the-owners-key-is-its-own-24-characters";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a picture")]);
const sha = (data: Buffer | undefined) => createHash("sha256").update(data ?? "").digest("hex");
function sticker(name: string): string {
  const [r = 0, g = 0, b = 0] = createHash("sha256").update(name).digest();
  const png = new PngImage({ width: 32, height: 32 });
  for (let at = 0; at < png.data.length; at += 4) png.data.set([r, g, b, 255], at);
  return PngImage.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 9 }).toString("base64");
}

const apps: FastifyInstance[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
});

type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
type Reply = LightMyRequestResponse & { data: any; said: string };

let nextAddress = 0;

class Client {
  cookie = "";
  readonly address = `10.${Math.floor(++nextAddress / 250)}.${nextAddress % 250}.1`;
  constructor(
    private readonly app: FastifyInstance,
    private readonly extra: Record<string, string> = {},
  ) {}

  async call(method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.address,
      headers: { ...this.extra, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
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
    return Object.assign(response, { data, said: `${method} ${url}${payload === undefined ? "" : ` ${JSON.stringify(payload)}`}` }) as Reply;
  }
  get = (url: string) => this.call("GET", url);
  post = (url: string, payload?: unknown) => this.call("POST", url, payload ?? {});
  delete = (url: string) => this.call("DELETE", url);
  static copy(app: FastifyInstance, from: Client): Client {
    const copy = new Client(app);
    copy.cookie = from.cookie;
    return copy;
  }
  get token(): string {
    return this.cookie.split("=")[1] ?? "";
  }
}

async function must(call: Promise<Reply>, statuses = [200, 201, 204]): Promise<any> {
  const reply = await call;
  expect(statuses, `${reply.said} was answered ${reply.statusCode} ${reply.body.slice(0, 200)}`).toContain(reply.statusCode);
  return reply.data;
}

interface Person {
  login: string;
  password: string;
  client: Client;
  account: string;
  profile: { id: string; name: string; tag: number };
  label: string;
}
type Slot = Record<string, string>;
interface Owner extends Person {
  tv: Client;
  friend: Person;
  asker: Person;
  ids: Record<string, string>;
  people: string[];
  words: string[];
  tokens: Array<{ text: string; pattern: RegExp }>;
}

interface Bare {
  app: FastifyInstance;
  store: AccountStore;
  persistence: MemoryPersistence;
  feedback: FeedbackStore;
  registry: Registry;
  clock: { now: number };
  team: Client;
}
interface World extends Bare {
  tess: Person;
  a: Owner;
  b: Owner;
  names: Map<string, string>;
}

const film = (name: string) => `https://filmpire.sc/watch/${name}`;

async function join(w: Bare, login: string): Promise<Person> {
  const client = new Client(w.app);
  const password = `the password of ${login}`;
  const made = await must(client.post("/api/auth/register", { email: login, password }), [201]);
  const profile = made.profiles[0];
  const settings = ["friends", "friendsGive", "friendsGet"].map((key) => ({ key, at: w.clock.now, value: true }));
  await must(client.post(`/api/profiles/${profile.id}/sync`, { since: 0, settings }), [200]);
  return { login, password, client, account: made.account.id, profile, label: tagLabel(profile.name, profile.tag) };
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function owner(w: Bare, tess: Person, login: string): Promise<Owner> {
  const me = await join(w, login);
  const { client, profile } = me;
  const at = w.clock.now;
  const mine = (rest = "") => `/api/profiles/${profile.id}/friends${rest}`;
  await must(
    client.post(`/api/profiles/${profile.id}/sync`, {
      since: 0,
      list: [{ key: `url:${film(login)}`, at, id: login, title: `secret-${login}-list`, url: film(login), description: `secret-${login}-description` }],
      listNames: [{ key: "weekend", at, name: `${login}'s weekend` }],
      ratings: [{ key: `rate:${login}`, at, title: `secret-${login}-rated`, url: film(login), score: 9, note: `secret-${login}-opinion`, ratedAt: at }],
      progress: [{ key: `url:${film(login)}`, at, title: `secret-${login}-watched`, url: film(login), position: 600, duration: 6000 }],
      watched: [{ key: `${login}|1|2`, at, show: `secret-${login}-show`, season: 1, episode: 2, position: 60, duration: 60, done: true }],
    }),
    [200],
  );
  const spare = (await must(client.post("/api/profiles", { name: `${profile.name} two` }), [201])).profiles[1].id as string;
  const tv = new Client(w.app);
  await must(tv.post("/api/auth/login", { email: login, password: me.password, device: "tv" }), [200]);
  const session = (await must(client.get("/api/sessions"))).find((each: { current: boolean }) => !each.current).id as string;

  const friend = await join(w, `${login}-friend`);
  const invited = await must(client.post(mine("/invites")), [201]);
  await must(friend.client.post(`/api/profiles/${friend.profile.id}/friends/accept`, { code: invited.code }), [201]);
  const asker = await join(w, `${login}-asker`);
  await must(asker.client.post(`/api/profiles/${asker.profile.id}/friends/requests`, { tag: me.label }), [201]);
  const code = (await must(client.post(mine("/invites")), [201])).code as string;
  const offered = (await must(tess.client.post(`/api/profiles/${tess.profile.id}/friends/invites`), [201])).code as string;

  const partyCode = w.registry.ensurePartyCode(w.registry.tvHello())!.code;
  const send = (body: object) => must(friend.client.post(`/api/profiles/${friend.profile.id}/friends/send`, { to: [profile.id], ...body }), [200]);
  await send({ kind: "plan", when: w.clock.now + DAY, note: `secret-${login}-plan` });
  await send({ kind: "recommend", title: `secret-${login}-title`, url: film(`${login}-gift`) });
  await send({ kind: "party", code: partyCode, endsAt: w.clock.now + 3600_000 });
  const inbox = (await must(client.get(mine()))).inbox as Array<{ id: string; kind: string }>;
  const item = (kind: string) => inbox.find((entry) => entry.kind === kind)!.id;

  const write = async (from: Person, to: Person, text: string) => {
    w.clock.now += 1000;
    const view = await must(from.client.post(`/api/profiles/${from.profile.id}/friends/${to.profile.id}/chat`, { text }), [201]);
    return { id: String(view.lines.at(-1).id), rev: String(view.rev) };
  };
  await write(friend, me, `secret-${login}-hello`);
  const answer = await write(me, friend, `secret-${login}-answer`);
  const made = async (who: Person) =>
    (await must(who.client.post(`/api/profiles/${who.profile.id}/stickers`, { data: sticker(`${who.login}-sticker`) }), [201])).id as string;
  const giveSticker = async (from: Person, to: Person, id: string) => {
    w.clock.now += 1000;
    await must(from.client.post(`/api/profiles/${from.profile.id}/friends/${to.profile.id}/chat/sticker`, { id }), [201]);
  };
  const theirSticker = await made(friend);
  await giveSticker(friend, me, theirSticker);
  const ownSticker = await made(me);
  await giveSticker(me, friend, ownSticker);
  const again = await write(friend, me, `secret-${login}-again`);

  const reportKey = `${login}-report-key-`.padEnd(30, "x");
  const picture = { id: "pic1", name: "screen.png", mime: "image/png", role: "screenshot", data: PNG.toString("base64") };
  const filed = await must(client.post("/api/feedback", { key: reportKey, kind: "bug", area: "player", message: `secret-${login}-report`, attachments: [picture] }), [201]);
  await must(w.team.post(`/api/admin/feedback/${filed.id}/reply`, { text: `secret-${login}-question`, ask: true }), [201]);
  const link = await must(new Client(w.app).post("/api/link/start", { device: "tv" }), [201]);

  const ids: Record<string, string> = {
    profile: profile.id,
    spare,
    friend: friend.profile.id,
    requester: asker.profile.id,
    tessTag: tess.label,
    code,
    offered,
    plan: item("plan"),
    recommend: item("recommend"),
    party: item("party"),
    partyCode,
    mine: answer.id,
    theirs: again.id,
    chatRev: again.rev,
    session,
    report: String(filed.id),
    reportKey,
    file: "pic1",
    link: link.code,
    linkSecret: link.secret,
    sticker: ownSticker,
    theirSticker,
  };
  const people = [me.account, profile.id, spare, friend.account, friend.profile.id, asker.account, asker.profile.id];
  const secrets = [...people, code, offered, ids.plan!, ids.recommend!, ids.party!, partyCode, session, reportKey, link.code, link.secret, client.token, tv.token, ownSticker, theirSticker];
  return {
    ...me,
    tv,
    friend,
    asker,
    ids,
    people,
    words: [`secret-${login}-`, `${login}'s weekend`],
    tokens: secrets.map((text) => ({ text, pattern: new RegExp(`(?<![\\w-])${escapeRe(text)}(?![\\w-])`) })),
  };
}

async function world(): Promise<World> {
  const clock = { now: T0 };
  const persistence = new MemoryPersistence();
  const store = await AccountStore.open({ persistence, flushMs: 0, now: () => clock.now, stickers: { on: true } });
  const registry = new Registry({ now: () => clock.now });
  const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), now: () => clock.now });
  const app = await buildApp({ accounts: store, passwordCost: cheap, registry, feedback, signUpsPerHour: 1000, feedbackSendsPer10Min: 1000, feedbackAdminToken: TOKEN, ownerStatsToken: OWNER_KEY, ownerStatsOrigin: "https://owner.example" });
  apps.push(app);
  const bare: Bare = { app, store, persistence, feedback, registry, clock, team: new Client(app, { authorization: `Bearer ${TOKEN}` }) };
  const tess = await join(bare, "tess");
  const a = await owner(bare, tess, "alma");
  const b = await owner(bare, tess, "boris");
  const names = new Map<string, string>();
  for (const each of [a, b]) for (const [name, value] of Object.entries(each.ids)) names.set(value, `${each.login}.${name}`);
  return { ...bare, tess, a, b, names };
}

async function kept(w: World, only?: Owner): Promise<Map<string, string>> {
  await w.store.flush();
  const out = new Map<string, string>();
  for (const [key, doc] of w.persistence.docs) {
    const json = JSON.stringify(doc);
    const theirs =
      !only ||
      only.people.some((id) => key.includes(id)) ||
      (key.startsWith("session:") && only.people.some((id) => json.includes(`"accountId":"${id}"`))) ||
      (key.startsWith("finvite:") && only.people.some((id) => json.includes(id)));
    if (theirs) out.set(key, json);
  }
  for (const report of w.feedback.list()) {
    if (only && !only.people.includes(report.accountId ?? "")) continue;
    out.set(`report ${report.id}`, JSON.stringify(report));
    for (const file of report.files) out.set(`report ${report.id} file ${file.id}`, sha((await w.feedback.file(report.id, file.id))?.data));
  }
  return out;
}

async function seen(w: World, o: Owner): Promise<Record<string, unknown>> {
  const profile = `/api/profiles/${o.ids.profile}`;
  const answers = {
    me: await o.client.get("/api/me"),
    sessions: await o.client.get("/api/sessions"),
    data: await o.client.post(`${profile}/sync`, { since: 0 }),
    friends: await o.client.get(`${profile}/friends`),
    kept: await o.client.get(`${profile}/friends/kept`),
    link: await o.client.get(`/api/link/${o.ids.link}`),
    reports: await o.client.get("/api/feedback/mine"),
    report: await new Client(w.app).post("/api/feedback/check", { keys: [o.ids.reportKey] }),
  };
  return Object.fromEntries(Object.entries(answers).map(([name, reply]) => [name, [reply.statusCode, reply.data]]));
}

interface Snapshot {
  kept: Map<string, string>;
  shown: Record<string, unknown>;
}
const snapshot = async (w: World, o: Owner): Promise<Snapshot> => {
  const shown = await seen(w, o);
  return { kept: await kept(w, o), shown };
};

function differences(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).map((key) => `${key} (${before.has(key) ? (after.has(key) ? "changed" : "gone") : "new"})`);
}
const changes = (before: Snapshot, after: Snapshot): string[] => [
  ...differences(before.kept, after.kept),
  ...Object.keys(before.shown).filter((name) => JSON.stringify(before.shown[name]) !== JSON.stringify(after.shown[name])).map((name) => `what is shown for "${name}"`),
];

function leaks(text: string, o: Owner, sent = ""): string[] {
  return [
    ...o.words.filter((word) => text.includes(word) && !sent.includes(word)),
    ...o.tokens.filter((token) => !sent.includes(token.text) && token.pattern.test(text)).map((token) => token.text),
  ];
}

interface Row {
  route: string;
  method: Method;
  path: string;
  slots: Record<string, string | string[]>;
  open?: string[];
  secret?: boolean;
  body?: (slot: Slot, as: Owner) => unknown;
  ok?: (reply: Reply) => boolean;
  turned?: (reply: Reply) => boolean;
  anon?: (reply: Reply) => boolean;
}

const row = (route: string, slots: Row["slots"] = {}, more: Partial<Row> = {}): Row => {
  const [method, path] = route.split(" ") as [Method, string];
  return { route, method, path, slots, ...more };
};

const refusal = (reply: Reply) => [401, 403, 404].includes(reply.statusCode) && /^[A-Za-z]+(_[A-Za-z]+)*$/.test(reply.data?.error ?? "");
const succeeded = (reply: Reply) => reply.statusCode >= 200 && reply.statusCode < 300;
const nobody = (reply: Reply) => refusal(reply) || (reply.statusCode === 200 && reply.data?.sent?.length === 0);

const FRIENDS = "/api/profiles/:id/friends";
const CHAT = `${FRIENDS}/:fid/chat`;
const asking = ["profile", "spare"];
const other = ["friend", "profile", "requester"];
const planted = { key: "url:planted", at: T0, id: "planted", title: "planted-by-somebody-else", url: film("planted") };

const ROWS: Row[] = [
  row("GET /api/me", {}, { anon: (reply) => reply.statusCode === 200 && reply.data.me === null }),
  row("POST /api/me/password", {}, { secret: true, body: (_, as) => ({ current: as.password, next: "a new password" }) }),
  row("POST /api/me/delete", {}, { secret: true, body: (_, as) => ({ password: as.password }) }),
  row("POST /api/me/child-pin", {}, { body: () => ({ next: "1234" }) }),
  row("POST /api/me/child-pin/check", {}, { body: () => ({ pin: "1234" }), ok: (reply) => [204, 404].includes(reply.statusCode) }),
  row("POST /api/auth/logout", {}, { anon: (reply) => reply.statusCode === 204 }),
  row("PUT /api/push", { pid: asking }, { body: (slot) => ({ token: "device-token-of-the-owners-phone-0000", profileId: slot.pid }), ok: (reply) => reply.statusCode === 204 }),
  row("DELETE /api/push", {}, { ok: (reply) => reply.statusCode === 204 }),
  row("POST /api/auth/google/app-ticket", {}, { body: () => ({ mode: "link", challenge: "c".repeat(43) }), ok: (reply) => [200, 400].includes(reply.statusCode) }),
  row("GET /api/sessions"),
  row("PATCH /api/sessions/:id", { id: "session" }, { body: () => ({ label: "Somebody else's name" }) }),
  row("DELETE /api/sessions/:id", { id: "session" }),
  row("DELETE /api/sessions"),
  row("POST /api/profiles", {}, { body: () => ({ name: "Another" }) }),
  row("PATCH /api/profiles/:id", { id: ["spare", "profile"] }, { body: () => ({ name: "Taken over" }) }),
  row("DELETE /api/profiles/:id", { id: ["spare", "profile"] }),
  row("POST /api/profiles/:id/sync", { id: asking }, { body: () => ({ since: 0, list: [planted] }) }),
  row("POST /api/profiles/:id/screen", { id: asking }),
  row("GET /api/profiles/:id/title-notices", { id: asking }),
  row("POST /api/profiles/:id/title-notices/seen", { id: asking }, { body: () => ({}) }),
  row("POST /api/profiles/:id/title-notices/dismiss", { id: asking }, { body: () => ({ id: "tv-1" }) }),
  row("GET /api/link/:code", { code: "link" }, { open: ["code"] }),
  row("POST /api/link/:code/approve", { code: "link" }, { open: ["code"] }),
  row("POST /api/link/:code/deny", { code: "link" }, { open: ["code"] }),
  row(`GET ${FRIENDS}`, { id: asking }),
  row(`GET ${FRIENDS}/kept`, { id: asking }),
  row(`POST ${FRIENDS}/invites`, { id: asking }),
  row(`DELETE ${FRIENDS}/invites/:code`, { id: ["profile"], code: "code" }),
  row(`GET ${FRIENDS}/invites/:code`, { id: asking, code: "code" }, { open: ["code"] }),
  row(`POST ${FRIENDS}/accept`, { id: asking, offered: "offered" }, { open: ["offered"], body: (slot) => ({ code: slot.offered }) }),
  row(`GET ${FRIENDS}/tags/:tag`, { id: asking, tag: "tessTag" }, { open: ["tag"] }),
  row(`POST ${FRIENDS}/requests`, { id: asking, tag: "tessTag" }, { open: ["tag"], body: (slot) => ({ tag: slot.tag }) }),
  row(`POST ${FRIENDS}/requests/:fid/accept`, { id: ["profile"], fid: ["requester", "friend", "profile"] }),
  row(`DELETE ${FRIENDS}/requests/:fid`, { id: ["profile"], fid: ["requester", "friend", "profile"] }),
  row(`DELETE ${FRIENDS}/:fid`, { id: ["profile"], fid: ["friend", "requester", "profile"] }),
  row(`GET ${FRIENDS}/:fid/lists`, { id: asking, fid: other }),
  row(`GET ${FRIENDS}/:fid/ratings`, { id: asking, fid: other }),
  row(`POST ${FRIENDS}/send`, { id: asking, fid: other }, { body: (slot) => ({ kind: "recommend", title: "Seen it?", url: film("seen-it"), to: [slot.fid] }), ok: (reply) => reply.data?.sent?.length === 1, turned: nobody }),
  row(`POST ${FRIENDS}/plans/:itemId/accept`, { id: ["profile"], itemId: ["plan", "recommend", "party"] }),
  row(`POST ${FRIENDS}/plans/:itemId/decline`, { id: ["profile"], itemId: ["plan", "recommend", "party"] }),
  row(`POST ${FRIENDS}/inbox/read`, { id: asking }),
  row(`DELETE ${FRIENDS}/inbox/:itemId`, { id: ["profile"], itemId: ["recommend", "plan", "party"] }),
  row("GET /api/profiles/:id/chats", { id: asking }),
  row(`GET ${CHAT}`, { id: asking, fid: other }),
  row(`POST ${CHAT}`, { id: asking, fid: other }, { body: () => ({ text: "hello" }) }),
  row(`DELETE ${CHAT}/:n`, { id: ["profile"], fid: other, n: ["mine", "theirs"] }),
  row(`PUT ${CHAT}/:n/reaction`, { id: ["profile"], fid: other, n: ["theirs", "mine"] }, { body: () => ({ reaction: "\u{1F525}" }) }),
  row(`PUT ${CHAT}/mute`, { id: asking, fid: other }, { body: () => ({ muted: true }) }),
  row(`GET ${CHAT}/report`, { id: asking, fid: other }),
  row(`POST ${CHAT}/report`, { id: asking, fid: other, rev: "chatRev" }, { open: ["rev"], body: (slot) => ({ rev: Number(slot.rev) }) }),
  row(`POST ${CHAT}/sticker`, { id: asking, fid: other, sid: ["sticker", "theirSticker"] }, { body: (slot) => ({ id: slot.sid }) }),
  row(`GET ${CHAT}/stickers/:sid`, { id: asking, fid: other, sid: ["theirSticker", "sticker"] }),
  row(`POST ${CHAT}/stickers/:sid/save`, { id: asking, fid: other, sid: ["theirSticker", "sticker"] }),
  row("GET /api/profiles/:id/stickers", { id: asking }),
  row("POST /api/profiles/:id/stickers", { id: asking }, { body: (_, as) => ({ data: sticker(`${as.login}-another`) }) }),
  row("GET /api/profiles/:id/stickers/:sid", { id: asking, sid: ["sticker", "theirSticker"] }),
  row("DELETE /api/profiles/:id/stickers/:sid", { id: asking, sid: ["sticker", "theirSticker"] }),
  row("POST /api/feedback/open", { report: "report" }, { body: (slot) => ({ id: slot.report }) }),
  row("POST /api/feedback/reply", { report: "report" }, { body: (slot) => ({ id: slot.report, text: "one more thing" }) }),
  row("GET /api/feedback/mine"),
];

const PUBLIC: Record<string, string> = {
  "GET /ws": "the socket of the watch parties and pairings: it reads no cookie, and a screen is known as a profile only by a proof that is good once (accounts/screens.ts)",
  "GET /api/features": "the cat's flag, the site's KLIPY key (KLIPY puts it in every visitor's request) and whether personal stickers are on, the same for everybody",
  "GET /api/health": "to anybody, only that it is up (ok, uptime, where it keeps things); the counters only with the team's token",
  "GET /api/library": "the catalogue: the same for everybody",
  "GET /api/library/search": "the catalogue",
  "GET /api/library/rows": "the catalogue",
  "GET /api/library/more": "the catalogue",
  "GET /api/library/names": "the catalogue: what titles are called in the viewer's language (TMDB's names), the same for everybody and slowed per address",
  "GET /api/library/similar": "the catalogue",
  "GET /api/library/about": "the catalogue",
  "GET /api/library/title": "the catalogue",
  "GET /api/watching": "what people watch on Kino: titles only, no name and no count, the same for everybody (accounts/watching.ts)",
  "GET /api/library/episodes": "the catalogue",
  "GET /api/library/seasons": "the catalogue",
  "GET /api/library/unavailable": "the catalogue: what no source had, the same for everybody",
  "GET /api/resolve": "finds the video of a public page: no account is involved",
  "GET /api/anime/skip": "where an anime episode's opening and credits are (AniSkip), for the player: no account is involved",
  "GET /api/proxy": "carries a public page or file: no account is involved",
  "GET /api/subtitles/ro/:file": "serves converted Romanian subtitles: no account is involved",
  "GET /api/subtitles/fallback/:file": "serves converted fallback subtitles (TVSubtitles/SubDL): no account is involved",
  "GET /api/subtitles/official/:file": "serves the Kino Official subtitles: the same for everybody, no account is involved",
  "POST /api/official/offer":
    "open to every screen and slowed per address: only times are taken, for a subtitle site's file the server listed for a title of the library lately, and the text is the file's own, fetched by the server",
  "POST /api/auth/register": "makes a new account: there is nobody to be someone else yet",
  "POST /api/auth/login": "proves a name and a password, slowed per name and per address",
  "GET /api/auth/google/start": "sends the browser to Google with a flow of its own; connecting or confirming needs the browser's own session, and the answer is only a redirect (google.test.ts)",
  "GET /api/auth/google/callback":
    "Google's way back: it does something only for the browser that holds the flow's cookie, and connects or confirms only for the account that started the flow (google.test.ts)",
  "GET /api/auth/google/app-claim":
    "the Android app's way back from Google: it signs in only with a code that is good once, for two minutes, and the secret of the app that started the trip (google.test.ts)",
  "GET /api/build": "which build of the page the server serves now (the name of its script, as the page itself says it): the same for everybody",
  "GET /api/app/android": "which version of the Android app is the newest: the same for everybody",
  "GET /app/android/:file": "the Android app itself: the same for everybody",
  "GET /app/kino.apk": "the newest Android app under one address: the same for everybody",
  "POST /api/link/start": "a TV that is not signed in asks for a code to show (see 'signing a TV in')",
  "POST /api/link/poll": "that TV asks if the code was approved, with a secret only it holds (see 'signing a TV in')",
  "POST /api/feedback": "anybody may send a report: it belongs to the key its page made (see 'feedback that belongs to a key')",
  "POST /api/feedback/check": "asks after reports by their keys: a key is its report's owner (see 'feedback that belongs to a key')",
  "GET /api/subsync/:key": "shared subtitle timings, found by a hash of the subtitle file: the same for everybody, a TV has no account",
  "PUT /api/subsync/:key": "open to every screen and slowed per address; what is left is never trusted, the one who takes a timing checks it against the sound it hears",
  "OPTIONS /api/owner/stats": "the browser's question before the owner's page may ask: answered only to the one page the server names (OWNER_STATS_ORIGIN), and it says nothing of the site",
  "GET /fixtures/*": "the test films the repo ships",
  "GET /*": "the website's own files",
};

const TEAM: Array<{ route: string; body?: object; query?: string; ok: number }> = [
  { route: "GET /api/admin/feedback", ok: 200 },
  { route: "GET /api/admin/feedback/changes", query: "?wait=0", ok: 200 },
  { route: "GET /api/admin/feedback/:id", ok: 200 },
  { route: "GET /api/admin/feedback/:id/files/:file", ok: 200 },
  { route: "POST /api/admin/feedback/:id/reply", body: { text: "Thank you" }, ok: 201 },
  { route: "PATCH /api/admin/feedback/:id", body: { note: "seen" }, ok: 200 },
  { route: "GET /api/admin/stats", ok: 200 },
  { route: "GET /api/admin/unavailable", ok: 200 },
  { route: "GET /api/admin/official", ok: 200 },
  { route: "GET /api/admin/official/:id", ok: 404 },
  { route: "PUT /api/admin/official/:id", body: { lines: [[0, 100, "Hello"]] }, ok: 404 },
  { route: "DELETE /api/admin/official/:id", ok: 404 },
  { route: "GET /api/admin/stickers", ok: 200 },
  { route: "GET /api/admin/stickers/:sid", ok: 200 },
  { route: "DELETE /api/admin/stickers/:sid", ok: 200 },
  { route: "DELETE /api/admin/stickers", query: "?by=nobody", ok: 200 },
  { route: "DELETE /api/admin/feedback/:id", ok: 204 },
];

const OWNER = ["GET /api/owner/stats"];

async function registered(): Promise<string[]> {
  const client = await mkdtemp(path.join(tmpdir(), "kino-authz-client-"));
  const fixtures = await mkdtemp(path.join(tmpdir(), "kino-authz-fixtures-"));
  folders.push(client, fixtures);
  await writeFile(path.join(client, "index.html"), "<!doctype html><title>Kino</title>");
  const routes = new Set<string>();
  const watch = (message: unknown) =>
    (message as { fastify: FastifyInstance }).fastify.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) routes.add(`${method} ${route.url}`);
    });
  subscribe("fastify.initialization", watch);
  try {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    apps.push(await buildApp({ accounts, visits, passwordCost: cheap, feedbackAdminToken: TOKEN, ownerStatsToken: OWNER_KEY, clientDir: client, fixturesDir: fixtures }));
  } finally {
    unsubscribe("fastify.initialization", watch);
  }
  return [...routes].filter((route) => !(route.startsWith("HEAD ") && routes.has(`GET ${route.slice(5)}`))).sort();
}

interface Attempt {
  values: Slot;
  as: Owner;
}

const slotKeys = (each: Row, name: string): string[] => [each.slots[name] ?? []].flat();
const ownValues = (each: Row, o: Owner): Slot => Object.fromEntries(Object.keys(each.slots).map((name) => [name, o.ids[slotKeys(each, name)[0]!]!]));
const theirValues = (each: Row, name: string, o: Owner): string[] => slotKeys(each, name).map((key) => o.ids[key]!);

function attempts(each: Row, on: Owner, by?: Owner): Attempt[] {
  const mine = by && ownValues(each, by);
  const options = (name: string): string[] => {
    const theirs = theirValues(each, name, on);
    const open = each.open?.includes(name);
    return mine ? [...new Set([mine[name]!, ...(open ? [] : theirs)])] : open ? theirs.slice(0, 1) : theirs;
  };
  const all = Object.keys(each.slots).reduce<Slot[]>((some, name) => some.flatMap((slot) => options(name).map((value) => ({ ...slot, [name]: value }))), [{}]);
  return all.filter((values) => each.secret || !mine || Object.keys(values).some((name) => values[name] !== mine[name])).map((values) => ({ values, as: each.secret ? on : (by ?? on) }));
}

function send(each: Row, client: Client, attempt: Attempt, method: Method = each.method): Promise<Reply> {
  const url = each.path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(attempt.values[name] ?? ""));
  const withBody = method === "POST" || method === "PUT" || method === "PATCH";
  return client.call(method, url, withBody ? (each.body?.(attempt.values, attempt.as) ?? {}) : undefined);
}

const describeAttempt = (w: World, each: Row, attempt: Attempt): string =>
  `${Object.entries(attempt.values).map(([name, value]) => `${name}=${w.names.get(value) ?? value}`).join(" ")}${each.secret ? ` with ${attempt.as.login}'s password` : ""}`.trim();

function judge(w: World, each: Row, who: string, signedIn: boolean, on: Owner, attempt: Attempt, reply: Reply, before: Map<string, string>, after: Map<string, string>): string[] {
  const head = reply.said.startsWith("HEAD ");
  const expected = !signedIn && each.anon ? each.anon : (each.turned ?? refusal);
  const what = `${who} against ${on.login}'s [${describeAttempt(w, each, attempt)}]: ${reply.said.slice(0, 200)}`;
  const problems: string[] = [];
  if (head ? ![401, 403, 404].includes(reply.statusCode) : !expected(reply)) problems.push(`${what} was answered ${reply.statusCode} ${reply.body.slice(0, 160)}`);
  if (!head) for (const shown of leaks(reply.body, on, reply.said)) problems.push(`${what} showed ${shown}`);
  for (const changed of differences(before, after)) problems.push(`${what} changed ${changed}`);
  return problems;
}

async function turnedAway(w: World, client: Client, on: Owner, who: string): Promise<string[]> {
  const problems: string[] = [];
  let state = await kept(w);
  for (const each of ROWS) {
    for (const attempt of attempts(each, on)) {
      const reply = await send(each, client, attempt);
      const next = await kept(w);
      problems.push(...judge(w, each, who, false, on, attempt, reply, state, next));
      state = next;
    }
  }
  return problems;
}

async function probe(each: Row): Promise<string[]> {
  const w = await world();
  const { a, b } = w;
  const problems: string[] = [];
  const first = [await snapshot(w, a), await snapshot(w, b)];
  let state = await kept(w);

  for (const { by, on } of [{ by: b, on: a }, { by: a, on: b }, { on: a }, { on: b }]) {
    const client = by?.client ?? new Client(w.app);
    for (const attempt of attempts(each, on, by)) {
      for (const method of each.method === "GET" && !each.anon ? (["GET", "HEAD"] as const) : [each.method]) {
        const reply = await send(each, client, attempt, method);
        const next = await kept(w);
        problems.push(...judge(w, each, by?.login ?? "a visitor", by !== undefined, on, attempt, reply, state, next));
        state = next;
      }
    }
  }
  const last = [await snapshot(w, a), await snapshot(w, b)];
  [a, b].forEach((o, n) => changes(first[n]!, last[n]!).forEach((changed) => problems.push(`after all the tries, ${changed} of ${o.login}'s was not as it was`)));

  for (const [doer, others] of [[a, b], [b, a]] as const) {
    const before = await snapshot(w, others);
    const reply = await send(each, doer.client, { values: ownValues(each, doer), as: doer });
    if (!(each.ok ?? succeeded)(reply)) problems.push(`${doer.login} could not do it for themselves: ${reply.said} was answered ${reply.statusCode} ${reply.body.slice(0, 160)}`);
    for (const shown of leaks(reply.body, others, reply.said)) problems.push(`${doer.login}'s own ${reply.said} showed ${shown} of ${others.login}'s`);
    changes(before, await snapshot(w, others)).forEach((changed) => problems.push(`${doer.login}'s own ${reply.said} changed ${changed} of ${others.login}'s`));
  }
  return problems;
}

describe("the routes of the server", () => {
  it("are every one in a row of the table, in the list of the public ones (with the reason) or in the team's: a route added later has to be put in one", async () => {
    const known = new Set([...ROWS.map((each) => each.route), ...Object.keys(PUBLIC), ...TEAM.map((each) => each.route), ...OWNER]);
    const routes = await registered();
    expect(routes.filter((route) => !known.has(route)), "routes that nobody has said anything about").toEqual([]);
    expect([...known].filter((route) => !routes.includes(route)), "rows and reasons for routes that are not there").toEqual([]);
  });
});

describe("what the other one is shown and cannot reach", () => {
  it("each one's own screens hold their own things (so that an answer without them to the other proves something)", async () => {
    const w = await world();
    for (const [o, p] of [[w.a, w.b], [w.b, w.a]] as const) {
      const views = JSON.stringify(await seen(w, o));
      for (const word of ["list", "description", "rated", "opinion", "watched", "show", "plan", "title"]) expect(views, word).toContain(`secret-${o.login}-${word}`);
      for (const id of [o.ids.profile, o.ids.spare, o.ids.friend, o.ids.requester, o.ids.code, o.ids.plan, o.ids.partyCode, o.ids.session, o.ids.link]) expect(views, id).toContain(id);
      expect(leaks(views, p), `${p.login}'s things in ${o.login}'s screens`).toEqual([]);
    }
  });

  for (const each of ROWS) {
    it(each.route, { timeout: 60_000 }, async () => {
      expect(await probe(each)).toEqual([]);
    });
  }
});

async function lean(token?: string): Promise<FastifyInstance> {
  const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
  const app = await buildApp({ accounts, passwordCost: cheap, feedback, ...(token ? { feedbackAdminToken: token } : {}) });
  apps.push(app);
  return app;
}

describe("a sign-in that is over opens nothing", () => {
  interface End {
    name: string;
    end(w: World): Promise<Client[]>;
    browser: boolean;
    boris: boolean;
  }
  const ends: End[] = [
    { name: "signed out", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.tv.post("/api/auth/logout"), [204]); return [old]; } },
    { name: "ended from another device", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.delete(`/api/sessions/${w.a.ids.session}`), [204]); return [old]; } },
    { name: "signed out everywhere else", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.delete("/api/sessions"), [204]); return [old]; } },
    { name: "ended by a new password", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.post("/api/me/password", { current: w.a.password, next: "another password" }), [204]); return [old]; } },
    { name: "too old", browser: false, boris: false, end: async (w) => { const old = Client.copy(w.app, w.a.client); w.clock.now += SESSION_TTL_MS + 1; await old.get("/api/me"); return [old]; } },
    { name: "gone with the account", browser: false, boris: true, end: async (w) => { const old = [w.a.client, w.a.tv].map((each) => Client.copy(w.app, each)); await must(w.a.client.post("/api/me/delete", { password: w.a.password }), [204]); return old; } },
  ];
  for (const { name, end, browser, boris } of ends) {
    it(name, { timeout: 60_000 }, async () => {
      const w = await world();
      const before = await snapshot(w, w.b);
      const old = await end(w);
      expect((await w.a.client.get("/api/me")).data.me !== null, "Alma's browser is signed in").toBe(browser);
      expect((await w.b.client.get("/api/me")).data.me !== null, "Boris is signed in").toBe(boris);
      if (boris) expect(changes(before, await snapshot(w, w.b)), "Boris's things").toEqual([]);
      for (const client of old) expect(await turnedAway(w, client, w.a, `a sign-in that was ${name}`)).toEqual([]);
    });
  }

  it("an account made again under the same name has nothing of the old one", async () => {
    const w = await world();
    const old = Client.copy(w.app, w.a.client);
    await must(w.a.client.post("/api/me/delete", { password: w.a.password }), [204]);
    const again = new Client(w.app);
    await must(again.post("/api/auth/register", { email: w.a.login, password: "another password" }), [201]);
    expect((await old.get("/api/me")).data.me).toBeNull();
    const me = (await again.get("/api/me")).data.me;
    expect(me.account.id).not.toBe(w.a.account);
    for (const id of [w.a.ids.profile, w.a.ids.spare]) {
      expect((await again.get(`/api/profiles/${id}/friends`)).data).toEqual({ error: "not_found" });
      expect((await again.post(`/api/profiles/${id}/sync`, { since: 0 })).data).toEqual({ error: "not_found" });
    }
    expect(leaks(JSON.stringify([me, (await again.get("/api/sessions")).data]), w.a)).toEqual([]);
  });

  it("a password opens its own account and no other", async () => {
    const w = await world();
    const visitor = new Client(w.app);
    for (const [login, password] of [[w.a.login, w.b.password], [w.b.login, w.a.password], [w.a.login, ""], ["nobody-at-all", w.a.password]] as const) {
      const reply = await visitor.post("/api/auth/login", { email: login, password });
      expect([reply.statusCode, reply.data.error, reply.headers["set-cookie"]], `${login} with ${password}`).toEqual([401, "invalid_credentials", undefined]);
    }
    expect(visitor.cookie).toBe("");
  });
});

describe("the team's side", () => {
  const call = (w: World, client: Client, entry: (typeof TEAM)[number], more = "") => {
    const [method, route] = entry.route.split(" ") as [Method, string];
    const query = `${entry.query ?? ""}${more ? `${entry.query ? "&" : "?"}${more}` : ""}`;
    return client.call(method, `${route.replace(":sid", w.a.ids.sticker!).replace(":id", w.a.ids.report!).replace(":file", w.a.ids.file!)}${query}`, entry.body);
  };

  it("takes the team's token as a Bearer and nothing else: not a sign-in, not the token of one", { timeout: 60_000 }, async () => {
    const w = await world();
    const shown = await seen(w, w.a);
    const before = await kept(w);
    const sorts: Array<[string, Client, string?]> = [
      ["somebody signed in", w.b.client],
      ["a visitor", new Client(w.app)],
      ["a wrong token", new Client(w.app, { authorization: `Bearer ${TOKEN}x` })],
      ["the token of a session", new Client(w.app, { authorization: `Bearer ${w.b.client.token}` })],
      ["the right token anywhere but in a Bearer", new Client(w.app, { authorization: `Basic ${TOKEN}`, "x-api-key": TOKEN, "x-admin-token": TOKEN, cookie: `token=${TOKEN}` }), `token=${TOKEN}`],
    ];
    for (const [who, client, more] of sorts) {
      for (const entry of TEAM) {
        const reply = await call(w, client, entry, more);
        expect([reply.statusCode, reply.data?.error], `${who}: ${entry.route}`).toEqual([401, "unauthorized"]);
        expect(leaks(reply.body, w.a), `${who}: ${entry.route}`).toEqual([]);
      }
    }
    expect(differences(before, await kept(w))).toEqual([]);
    expect(await seen(w, w.a)).toEqual(shown);

    for (const entry of TEAM) expect((await call(w, w.team, entry)).statusCode, entry.route).toBe(entry.ok);
    expect((await call(w, w.team, TEAM.find((entry) => entry.route === "GET /api/admin/feedback/:id")!)).statusCode).toBe(404);
  });

  it("the owner's page has a key of its own: no sign-in, no team's token opens it, it opens nothing of the team's, and what it shows is nobody's own", { timeout: 60_000 }, async () => {
    const w = await world();
    const shown = await seen(w, w.a);
    const before = await kept(w);
    const sorts: Array<[string, Client]> = [
      ["somebody signed in", w.b.client],
      ["a visitor", new Client(w.app)],
      ["a wrong key", new Client(w.app, { authorization: `Bearer ${OWNER_KEY}x` })],
      ["the team's token", w.team],
      ["the token of a session", new Client(w.app, { authorization: `Bearer ${w.b.client.token}` })],
      ["the right key anywhere but in a Bearer", new Client(w.app, { authorization: `Basic ${OWNER_KEY}`, "x-api-key": OWNER_KEY, cookie: `token=${OWNER_KEY}` })],
    ];
    for (const [who, client] of sorts) {
      const reply = await client.get("/api/owner/stats");
      expect([reply.statusCode, reply.data?.error], who).toEqual([401, "unauthorized"]);
      for (const o of [w.a, w.b]) expect(leaks(reply.body, o), who).toEqual([]);
    }
    const owner = new Client(w.app, { authorization: `Bearer ${OWNER_KEY}` });
    const view = await owner.get("/api/owner/stats");
    expect(view.statusCode).toBe(200);
    expect(view.data.accounts.total).toBeGreaterThanOrEqual(2);
    for (const o of [w.a, w.b]) expect(leaks(view.body, o), `${o.login}'s things in the owner's counts`).toEqual([]);
    for (const entry of TEAM) expect((await call(w, owner, entry)).statusCode, entry.route).toBe(401);
    expect(differences(before, await kept(w))).toEqual([]);
    expect(await seen(w, w.a)).toEqual(shown);
  });

  it("slows down whoever keeps guessing the token", async () => {
    const app = await lean(TOKEN);
    const guesser = new Client(app, { authorization: "Bearer not-the-teams-token-at-all" });
    const answers: number[] = [];
    for (let n = 0; n < 11; n++) answers.push((await guesser.get("/api/admin/stats")).statusCode);
    expect(answers).toEqual([...Array<number>(10).fill(401), 429]);
    expect((await new Client(app, { authorization: `Bearer ${TOKEN}` }).get("/api/admin/stats")).statusCode).toBe(200);
  });

  for (const [name, token] of [["none", undefined], ["one that is too short", "short-token-not-24"]] as const) {
    it(`there is no team's side without a token that is long enough (${name})`, async () => {
      const app = await lean(token);
      const user = new Client(app);
      await must(user.post("/api/auth/register", { email: "somebody", password: "a password" }), [201]);
      for (const client of [user, new Client(app, { authorization: `Bearer ${token ?? TOKEN}` })]) {
        for (const entry of TEAM) {
          const [method, route] = entry.route.split(" ") as [Method, string];
          const reply = await client.call(method, `${route.replace(":id", "1").replace(":file", "pic1")}${entry.query ?? ""}`, entry.body);
          expect([reply.statusCode, reply.data?.error], entry.route).toEqual([404, "NOT_FOUND"]);
        }
      }
    });
  }
});

describe("signing a TV in", () => {
  it("the code on the screen is for whoever reads it; the secret is the screen's alone", async () => {
    const w = await world();
    const { a, b } = w;
    expect(await must(b.client.get(`/api/link/${a.ids.link}`))).toMatchObject({ code: a.ids.link, kind: "tv" });
    for (const secret of [b.ids.linkSecret, "x".repeat(32)]) {
      expect((await new Client(w.app).post("/api/link/poll", { code: a.ids.link, secret })).data).toEqual({ status: "gone" });
    }
    await must(b.client.post(`/api/link/${a.ids.link}/approve`), [204]);
    const screen = new Client(w.app);
    const polled = await screen.post("/api/link/poll", { code: a.ids.link, secret: a.ids.linkSecret });
    expect(polled.data).toMatchObject({ status: "approved", me: { account: { id: b.account } } });
    expect(leaks(polled.body, a)).toEqual([]);
    expect((await screen.get("/api/me")).data.me.account.id).toBe(b.account);
    expect((await new Client(w.app).post("/api/link/poll", { code: a.ids.link, secret: a.ids.linkSecret })).data).toEqual({ status: "gone" });
    await must(a.client.post(`/api/link/${b.ids.link}/deny`), [204]);
    expect((await new Client(w.app).post("/api/link/poll", { code: b.ids.link, secret: b.ids.linkSecret })).data).toEqual({ status: "denied" });
  });
});

describe("feedback that belongs to a key", () => {
  it("is read by its key (from any page) or by the account that sent it, and by nobody else", { timeout: 60_000 }, async () => {
    const w = await world();
    const { a, b } = w;
    const key = "a-page-that-is-not-signed-in-key";
    const id = String((await must(new Client(w.app).post("/api/feedback", { key, kind: "idea", area: "unsure", message: "secret-page-report" }), [201])).id);
    const before = await kept(w);
    for (const [who, client] of [["a visitor", new Client(w.app)], ["Boris", b.client], ["Alma", a.client]] as const) {
      for (const tried of [{ id }, { id, text: "more" }, { id, key: "not-a-key-of-any-report-at-all" }]) {
        for (const route of ["open", "reply"]) {
          const reply = await client.post(`/api/feedback/${route}`, tried);
          expect([reply.statusCode, reply.data.error], `${who} ${route} ${JSON.stringify(tried)}`).toEqual([404, "not_found"]);
        }
      }
    }
    expect(differences(before, await kept(w))).toEqual([]);
    const own = JSON.stringify(await must(b.client.post("/api/feedback/open", { key: b.ids.reportKey, id: a.ids.report })));
    expect(own).toContain("secret-boris-report");
    expect(leaks(own, a)).toEqual([]);
    expect(await must(new Client(w.app).post("/api/feedback/open", { key }))).toMatchObject({ id, message: "secret-page-report" });
    expect(await must(a.tv.post("/api/feedback/open", { id: a.ids.report }))).toMatchObject({ id: a.ids.report });
    for (const o of [a, b]) {
      const listed = await must(o.client.get("/api/feedback/mine"));
      expect(listed.items.map((item: { id: string }) => item.id)).toEqual([o.ids.report]);
    }
    const checked = await must(b.client.post("/api/feedback/check", { keys: [b.ids.reportKey, "not-a-key-of-any-report-at-all"] }));
    expect(checked.items.map((item: { key: string }) => item.key)).toEqual([b.ids.reportKey]);
  });
});

describe("a profile of one cannot speak as a profile of the other", () => {
  it("what Boris sends to Alma's friend is from Boris, and as Alma it is turned away", async () => {
    const w = await world();
    const { a, b } = w;
    const mine = (o: Owner, rest: string) => `/api/profiles/${o.ids.profile}/friends${rest}`;
    await must(b.client.post(mine(b, "/requests"), { tag: a.friend.label }), [201]);
    const asked = await must(a.friend.client.get(`/api/profiles/${a.friend.profile.id}/friends`));
    expect(asked.requests.map((request: { from: { id: string } }) => request.from.id)).toEqual([b.ids.profile]);

    const before = await kept(w);
    const tries: Array<[string, () => Promise<Reply>, number, string]> = [
      ["a request as Alma", () => b.client.post(mine(a, "/requests"), { tag: a.friend.label }), 404, "not_found"],
      ["a title as Alma", () => b.client.post(mine(a, "/send"), { to: [a.ids.friend], kind: "together" }), 404, "not_found"],
      ["a word as Alma", () => b.client.post(`${mine(a, "")}/${a.ids.friend}/chat`, { text: "hello, it is not Alma" }), 404, "not_found"],
      ["a report of Alma's chat as Alma", () => b.client.post(`${mine(a, "")}/${a.ids.friend}/chat/report`, { rev: Number(a.ids.chatRev) }), 404, "not_found"],
      ["a word as himself, to a friend who is not his", () => b.client.post(`${mine(b, "")}/${a.ids.friend}/chat`, { text: "hello" }), 404, "not_friends"],
    ];
    for (const [what, run, status, error] of tries) {
      const reply = await run();
      expect([reply.statusCode, reply.data.error], what).toEqual([status, error]);
    }
    expect(await must(b.client.post(mine(b, "/send"), { to: [a.ids.friend], kind: "together" }), [200])).toEqual({ sent: [], declined: [a.ids.friend] });
    expect(differences(before, await kept(w))).toEqual([]);
  });
});

describe("what a friendship gives", () => {
  it("a friend reads what is shared and no more, the others nothing, and it all ends with the friendship", { timeout: 60_000 }, async () => {
    const w = await world();
    const { a } = w;
    const read = (who: Person, part: string) => who.client.get(`/api/profiles/${who.profile.id}/friends/${a.ids.profile}/${part}`);
    const choose = async (...choices: Array<[string, boolean]>) => {
      w.clock.now += 5000;
      await must(a.client.post(`/api/profiles/${a.ids.profile}/sync`, { since: 0, settings: choices.map(([key, value]) => ({ key, at: w.clock.now, value })) }), [200]);
    };
    for (const who of [a.asker, w.tess, w.b.friend]) {
      for (const part of ["lists", "ratings", "chat", "chat/report"]) {
        const reply = await read(who, part);
        expect([reply.statusCode, reply.data.error], `${who.login} ${part}`).toEqual([404, "not_friends"]);
      }
    }
    const lists = JSON.stringify(await must(read(a.friend, "lists")));
    expect(lists).toContain("secret-alma-list");
    expect(JSON.stringify(await must(read(a.friend, "ratings")))).toContain("secret-alma-opinion");
    expect(leaks(lists, w.b)).toEqual([]);
    const before = await kept(w);
    const own = `/api/profiles/${a.ids.profile}/friends`;
    const theirs = `/api/profiles/${a.friend.profile.id}/friends`;
    const refused: Array<[string, Promise<Reply>, number, string]> = [
      ["Alma takes back her friend's line", a.client.delete(`${own}/${a.ids.friend}/chat/${a.ids.theirs}`), 404, "gone"],
      ["her friend takes back Alma's line", a.friend.client.delete(`${theirs}/${a.ids.profile}/chat/${a.ids.mine}`), 404, "gone"],
      ["her friend answers the plan he put to her", a.friend.client.post(`${theirs}/plans/${a.ids.plan}/accept`), 404, "plan_gone"],
      ["her friend clears her inbox", a.friend.client.delete(`${theirs}/inbox/${a.ids.plan}`), 404, "not_found"],
    ];
    for (const [what, reply, status, error] of refused) expect([(await reply).statusCode, (await reply).data.error], what).toEqual([status, error]);
    expect(differences(before, await kept(w))).toEqual([]);
    await choose(["friendsLists", false]);
    expect((await read(a.friend, "lists")).data).toEqual({ error: "not_shared" });
    expect((await read(a.friend, "ratings")).statusCode).toBe(200);
    await choose(["friendsRatings", false]);
    expect((await read(a.friend, "ratings")).data).toEqual({ error: "not_shared" });
    await choose(["friendsLists", true], ["friendsRatings", true], ["friendsOff", true]);
    expect((await read(a.friend, "lists")).data).toEqual({ error: "not_shared" });
    const word = await a.friend.client.post(`/api/profiles/${a.friend.profile.id}/friends/${a.ids.profile}/chat`, { text: "hi" });
    expect([word.statusCode, word.data.error]).toEqual([403, "chat_off"]);
    const sent = await must(a.friend.client.post(`/api/profiles/${a.friend.profile.id}/friends/send`, { to: [a.ids.profile], kind: "together" }), [200]);
    expect(sent).toEqual({ sent: [], declined: [a.ids.profile] });
    const friends = await must(a.client.get(`/api/profiles/${a.ids.profile}/friends/kept`));
    expect(friends.friends.map((friend: { id: string }) => friend.id)).toEqual([a.ids.friend]);
    await must(a.client.delete(`/api/profiles/${a.ids.profile}/friends/${a.ids.friend}`), [204]);
    for (const part of ["lists", "ratings", "chat"]) expect((await read(a.friend, part)).data, part).toEqual({ error: "not_friends" });
    expect(JSON.stringify([...(await kept(w, a)).values()])).not.toContain("secret-alma-hello");
  });
});

describe("a code that is given out", () => {
  it("shows who it is from to whoever holds it, and only that; ten wrong ones and the account waits", async () => {
    const w = await world();
    const { a, b } = w;
    const peek = (who: Person, code: string) => who.client.get(`/api/profiles/${who.profile.id}/friends/invites/${code}`);
    const code = a.ids.code!;
    const shown = await must(peek(w.tess, code));
    expect(Object.keys(shown).sort()).toEqual(["code", "from"]);
    expect(Object.keys(shown.from).sort()).toEqual(["avatar", "name"]);
    for (let n = 0; n < 10; n++) expect((await peek(b, `WRONG${n}ABC`)).data, `guess ${n}`).toEqual({ error: "invite_gone" });
    const locked = await peek(b, code);
    expect([locked.statusCode, locked.data.error]).toEqual([429, "rate_limited"]);
    expect((await peek(w.tess, code)).statusCode).toBe(200);
  });

  it("a party code that no party is open with counts as a wrong guess too, and ten of them make the account wait", async () => {
    const w = await world();
    const { a, b } = w;
    const ask = (code: string) => b.client.post(`/api/profiles/${b.profile.id}/friends/send`, { to: [w.tess.profile.id], kind: "party", code, endsAt: w.clock.now + 3600_000 });
    const open = new Set([a.ids.partyCode, b.ids.partyCode]);
    const closed = Array.from({ length: 12 }, (_, n) => String(100_000 + n)).filter((code) => !open.has(code)).slice(0, 10);
    for (const code of closed) expect((await ask(code)).data, code).toEqual({ error: "party_closed" });
    const locked = await ask(a.ids.partyCode!);
    expect([locked.statusCode, locked.data.error]).toEqual([429, "rate_limited"]);
  });
});
