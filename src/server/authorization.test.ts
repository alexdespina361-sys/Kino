import { createHash } from "node:crypto";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { tagLabel } from "../shared";
import { MemoryPersistence } from "./accounts/persistence";
import { AccountStore, SESSION_TTL_MS } from "./accounts/store";
import { buildApp } from "./app";
import { FeedbackStore, MemoryFeedbackBackend } from "./feedback/store";
import { Registry } from "./sessions/registry";
import { VisitCounter } from "./stats/visits";

/**
 * Who may reach what. Two people, Alma and Boris, each get a full set of things that are theirs: a profile with what it watched, rated and listed, a second
 * profile, a second device, a friend, somebody who asked to be a friend, a code to give out, a plan, a title and a watch-party invitation in the inbox, a chat,
 * a feedback report with its picture, a TV waiting to be signed in. Every route that takes the name of one of those, or acts for an account, is then tried by
 * the other one (signed in, with profiles of their own) and by a visitor who is not signed in: with the first one's names, with their own profile put in the
 * first one's place and the first one's profile put over their own names. In every case
 *   - the answer is a refusal in the server's own words (a 404 from the router, for a path that is wrong, does not count) and it holds nothing of the other's;
 *   - nothing was changed anywhere (all that is kept is compared before and after, and read back as the one it belongs to);
 *   - the same request made by the one it is for does work, and touches nobody else (so the refusals are not a path or a body that was wrong).
 * The routes themselves are read from the server (see `registered`): one that is added and is in none of the lists below fails `every route`.
 */

const cheap = { N: 1024, r: 8, p: 1 } as const;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const TOKEN = "the-teams-token-is-at-least-24-characters";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a picture")]);
const sha = (data: Buffer | undefined) => createHash("sha256").update(data ?? "").digest("hex");

const apps: FastifyInstance[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
});

/* ------------------------------ browsers ------------------------------ */

type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `said` is the request as it was made (method, address and body): what an answer may repeat of it is not a leak. */
type Reply = LightMyRequestResponse & { data: any; said: string };

let nextAddress = 0;

/** One browser: it keeps its cookie, and sends it back, from an address of its own (the limits that count by address then count each browser apart). */
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
  /** The same browser as it was: the same cookie, from an address of its own. */
  static copy(app: FastifyInstance, from: Client): Client {
    const copy = new Client(app);
    copy.cookie = from.cookie;
    return copy;
  }
  /** What the cookie holds: the token that is the sign-in. */
  get token(): string {
    return this.cookie.split("=")[1] ?? "";
  }
}

/** What a call answered, when it has to be one of these (a setup that does not work should say so, not go on). */
async function must(call: Promise<Reply>, statuses = [200, 201, 204]): Promise<any> {
  const reply = await call;
  expect(statuses, `${reply.said} was answered ${reply.statusCode} ${reply.body.slice(0, 200)}`).toContain(reply.statusCode);
  return reply.data;
}

/* ------------------------------ the people and what is theirs ------------------------------ */

interface Person {
  login: string;
  password: string;
  client: Client;
  account: string;
  profile: { id: string; name: string; tag: number };
  /** How the others find the profile: its name and its tag. */
  label: string;
}
type Slot = Record<string, string>;
/** A person with everything that is theirs. `ids` names it all (a route's `:id`, `:fid`, `:code`... are filled from these). */
interface Owner extends Person {
  tv: Client;
  friend: Person;
  asker: Person;
  ids: Record<string, string>;
  /** The accounts and profiles around them: a document that is named by one of these is part of their world. */
  people: string[];
  /** Words only their things hold, and names only they have: an answer that holds one of them has shown them. */
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
  /** The team, with the token. */
  team: Client;
}
interface World extends Bare {
  /** Somebody who is nobody's friend, and gives a code to each of the two. */
  tess: Person;
  a: Owner;
  b: Owner;
  /** What a value is called (`alma.profile`), to say what an attempt was made of. */
  names: Map<string, string>;
}

const film = (name: string) => `https://filmpire.sc/watch/${name}`;

/** Someone with an account, a profile with friends turned on (and told what the friends watch), and the means to talk to the server. */
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

/** Everything that is somebody's, made through the routes the way a person would. */
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

  // a friend, somebody who asked to be one, a code still out, and a code from somebody else to take
  const friend = await join(w, `${login}-friend`);
  const invited = await must(client.post(mine("/invites")), [201]);
  await must(friend.client.post(`/api/profiles/${friend.profile.id}/friends/accept`, { code: invited.code }), [201]);
  const asker = await join(w, `${login}-asker`);
  await must(asker.client.post(`/api/profiles/${asker.profile.id}/friends/requests`, { tag: me.label }), [201]);
  const code = (await must(client.post(mine("/invites")), [201])).code as string;
  const offered = (await must(tess.client.post(`/api/profiles/${tess.profile.id}/friends/invites`), [201])).code as string;

  // what the friend sent: a plan, a title, an invitation to a party that is open
  const partyCode = w.registry.ensurePartyCode(w.registry.tvHello())!.code;
  const send = (body: object) => must(friend.client.post(`/api/profiles/${friend.profile.id}/friends/send`, { to: [profile.id], ...body }), [200]);
  await send({ kind: "plan", when: w.clock.now + DAY, note: `secret-${login}-plan` });
  await send({ kind: "recommend", title: `secret-${login}-title`, url: film(`${login}-gift`) });
  await send({ kind: "party", code: partyCode, endsAt: w.clock.now + 3600_000 });
  const inbox = (await must(client.get(mine()))).inbox as Array<{ id: string; kind: string }>;
  const item = (kind: string) => inbox.find((entry) => entry.kind === kind)!.id;

  // a chat: the friend writes, the owner answers, the friend writes again (so one line waits unread)
  const write = async (from: Person, to: Person, text: string) => {
    w.clock.now += 1000; // (a line is named by the time it was written: every one of these is told apart from everybody's)
    const view = await must(from.client.post(`/api/profiles/${from.profile.id}/friends/${to.profile.id}/chat`, { text }), [201]);
    return { id: String(view.lines.at(-1).id), rev: String(view.rev) };
  };
  await write(friend, me, `secret-${login}-hello`);
  const answer = await write(me, friend, `secret-${login}-answer`);
  const again = await write(friend, me, `secret-${login}-again`);

  // a feedback report, with a picture, that the team has asked a question about; and a TV that waits to be signed in
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
  };
  const people = [me.account, profile.id, spare, friend.account, friend.profile.id, asker.account, asker.profile.id];
  // (what only they have: not the numbers, which any answer may hold, and not the tag of somebody both of them know)
  const secrets = [...people, code, offered, ids.plan!, ids.recommend!, ids.party!, partyCode, session, reportKey, link.code, link.secret, client.token, tv.token];
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
  const store = await AccountStore.open({ persistence, flushMs: 0, now: () => clock.now });
  const registry = new Registry({ now: () => clock.now });
  const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), now: () => clock.now });
  const app = await buildApp({ accounts: store, passwordCost: cheap, registry, feedback, signUpsPerHour: 1000, feedbackSendsPer10Min: 1000, feedbackAdminToken: TOKEN });
  apps.push(app);
  const bare: Bare = { app, store, persistence, feedback, registry, clock, team: new Client(app, { authorization: `Bearer ${TOKEN}` }) };
  const tess = await join(bare, "tess");
  const a = await owner(bare, tess, "alma");
  const b = await owner(bare, tess, "boris");
  const names = new Map<string, string>();
  for (const each of [a, b]) for (const [name, value] of Object.entries(each.ids)) names.set(value, `${each.login}.${name}`);
  return { ...bare, tess, a, b, names };
}

/* ------------------------------ what is kept, and what a person is shown of it ------------------------------ */

/**
 * Everything that is kept, as text: every document the accounts keep (or those of one person's world), and the feedback reports with their pictures.
 * Comparing two of these says what was changed, added or taken away.
 */
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

/** What the person is shown of their own things, read the way their screens read it (none of it changes anything). */
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
const snapshot = async (w: World, o: Owner): Promise<Snapshot> => ({ kept: await kept(w, o), shown: await seen(w, o) });

/** What differs between two states of what is kept. */
function differences(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).map((key) => `${key} (${before.has(key) ? (after.has(key) ? "changed" : "gone") : "new"})`);
}
const changes = (before: Snapshot, after: Snapshot): string[] => [
  ...differences(before.kept, after.kept),
  ...Object.keys(before.shown).filter((name) => JSON.stringify(before.shown[name]) !== JSON.stringify(after.shown[name])).map((name) => `what is shown for "${name}"`),
];

/** What an answer holds of somebody's: their words, and names that are theirs alone. (What the request itself said is not counted: an answer may repeat it.) */
function leaks(text: string, o: Owner, sent = ""): string[] {
  return [
    ...o.words.filter((word) => text.includes(word) && !sent.includes(word)),
    ...o.tokens.filter((token) => !sent.includes(token.text) && token.pattern.test(text)).map((token) => token.text),
  ];
}

/* ------------------------------ the routes ------------------------------ */

interface Row {
  /** The route as the server has it: `METHOD /path/:with/:names`. */
  route: string;
  method: Method;
  path: string;
  /** What fills each name of the path (and of the body): the owner's thing called so, then the others to try. The first is the one the owner's own request uses. */
  slots: Record<string, string | string[]>;
  /** Slots that are a name anybody may know or a secret whoever holds is meant to use (a code, a tag): only the caller's own is tried. */
  open?: string[];
  /** The body carries the password of the one who asks: the other's is tried as well. */
  secret?: boolean;
  body?: (slot: Slot, as: Owner) => unknown;
  /** What the owner's own request is answered (a success unless this says what). */
  ok?: (reply: Reply) => boolean;
  /** What a refusal looks like, when it is more than a 401, 403 or 404. */
  turned?: (reply: Reply) => boolean;
  /** What a visitor who is not signed in is answered, when that is not a refusal. */
  anon?: (reply: Reply) => boolean;
}

const row = (route: string, slots: Row["slots"] = {}, more: Partial<Row> = {}): Row => {
  const [method, path] = route.split(" ") as [Method, string];
  return { route, method, path, slots, ...more };
};

/** A refusal in the server's own words: not signed in, not allowed, or not there (the router's own 404 says "Not Found", with a space). */
const refusal = (reply: Reply) => [401, 403, 404].includes(reply.statusCode) && /^[A-Za-z]+(_[A-Za-z]+)*$/.test(reply.data?.error ?? "");
const succeeded = (reply: Reply) => reply.statusCode >= 200 && reply.statusCode < 300;
/** `send` answers 200 with who it reached: a refusal is that nobody was. */
const nobody = (reply: Reply) => refusal(reply) || (reply.statusCode === 200 && reply.data?.sent?.length === 0);

const FRIENDS = "/api/profiles/:id/friends";
const CHAT = `${FRIENDS}/:fid/chat`;
/** The profiles of the owner that ask (the second has friends off), and the other end: a friend, somebody who asked, or the profile itself. */
const asking = ["profile", "spare"];
const other = ["friend", "profile", "requester"];
const planted = { key: "url:planted", at: T0, id: "planted", title: "planted-by-somebody-else", url: film("planted") };

const ROWS: Row[] = [
  // the account
  row("GET /api/me", {}, { anon: (reply) => reply.statusCode === 200 && reply.data.me === null }),
  row("POST /api/me/password", {}, { secret: true, body: (_, as) => ({ current: as.password, next: "a new password" }) }),
  row("POST /api/me/delete", {}, { secret: true, body: (_, as) => ({ password: as.password }) }),
  row("POST /api/auth/logout", {}, { anon: (reply) => reply.statusCode === 204 }),
  // the devices it is signed in on
  row("GET /api/sessions"),
  row("PATCH /api/sessions/:id", { id: "session" }, { body: () => ({ label: "Somebody else's name" }) }),
  row("DELETE /api/sessions/:id", { id: "session" }),
  row("DELETE /api/sessions"),
  // the profiles, and what they keep
  row("POST /api/profiles", {}, { body: () => ({ name: "Another" }) }),
  row("PATCH /api/profiles/:id", { id: ["spare", "profile"] }, { body: () => ({ name: "Taken over" }) }),
  row("DELETE /api/profiles/:id", { id: ["spare", "profile"] }),
  row("POST /api/profiles/:id/sync", { id: asking }, { body: () => ({ since: 0, list: [planted] }) }),
  row("POST /api/profiles/:id/screen", { id: asking }),
  // signing a TV in from a phone (the code is what the TV shows: whoever holds it may look at it; see "signing a TV in")
  row("GET /api/link/:code", { code: "link" }, { open: ["code"] }),
  row("POST /api/link/:code/approve", { code: "link" }, { open: ["code"] }),
  row("POST /api/link/:code/deny", { code: "link" }, { open: ["code"] }),
  // friends
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
  // chat
  row(`GET ${CHAT}`, { id: asking, fid: other }),
  row(`POST ${CHAT}`, { id: asking, fid: other }, { body: () => ({ text: "hello" }) }),
  row(`DELETE ${CHAT}/:n`, { id: ["profile"], fid: other, n: ["mine", "theirs"] }),
  row(`PUT ${CHAT}/mute`, { id: asking, fid: other }, { body: () => ({ muted: true }) }),
  row(`GET ${CHAT}/report`, { id: asking, fid: other }),
  row(`POST ${CHAT}/report`, { id: asking, fid: other, rev: "chatRev" }, { open: ["rev"], body: (slot) => ({ rev: Number(slot.rev) }) }),
  // feedback reports that belong to an account (the ones that belong to a key are tried further down)
  row("POST /api/feedback/open", { report: "report" }, { body: (slot) => ({ id: slot.report }) }),
  row("POST /api/feedback/reply", { report: "report" }, { body: (slot) => ({ id: slot.report, text: "one more thing" }) }),
  row("GET /api/feedback/mine"),
];

/** Routes anybody may call, and why that is all right. */
const PUBLIC: Record<string, string> = {
  "GET /ws": "the socket of the watch parties and pairings: it reads no cookie, and a screen is known as a profile only by a proof that is good once (accounts/screens.ts)",
  "GET /api/features": "one flag, the same for everybody",
  "GET /api/health": "counters, and whether the team has a token: nothing of an account or a report",
  "GET /api/library": "the catalogue: the same for everybody",
  "GET /api/library/search": "the catalogue",
  "GET /api/library/rows": "the catalogue",
  "GET /api/library/more": "the catalogue",
  "GET /api/library/similar": "the catalogue",
  "GET /api/library/about": "the catalogue",
  "GET /api/library/episodes": "the catalogue",
  "GET /api/library/seasons": "the catalogue",
  "GET /api/resolve": "finds the video of a public page: no account is involved",
  "GET /api/proxy": "carries a public page or file: no account is involved",
  "POST /api/auth/register": "makes a new account: there is nobody to be someone else yet",
  "POST /api/auth/login": "proves a name and a password, slowed per name and per address",
  "POST /api/link/start": "a TV that is not signed in asks for a code to show (see 'signing a TV in')",
  "POST /api/link/poll": "that TV asks if the code was approved, with a secret only it holds (see 'signing a TV in')",
  "POST /api/feedback": "anybody may send a report: it belongs to the key its page made (see 'feedback that belongs to a key')",
  "POST /api/feedback/check": "asks after reports by their keys: a key is its report's owner (see 'feedback that belongs to a key')",
  "GET /api/subsync/:key": "shared subtitle timings, found by a hash of the subtitle file: the same for everybody, a TV has no account",
  "PUT /api/subsync/:key": "open to every screen and slowed per address; what is left is never trusted, the one who takes a timing checks it against the sound it hears",
  "GET /fixtures/*": "the test films the repo ships",
  "GET /*": "the website's own files",
};

/** The team's side: a token and nothing else (see "the team's side"). The names in the path are filled from Alma's report; the last one takes the report away. */
const TEAM: Array<{ route: string; body?: object; query?: string; ok: number }> = [
  { route: "GET /api/admin/feedback", ok: 200 },
  { route: "GET /api/admin/feedback/changes", query: "?wait=0", ok: 200 },
  { route: "GET /api/admin/feedback/:id", ok: 200 },
  { route: "GET /api/admin/feedback/:id/files/:file", ok: 200 },
  { route: "POST /api/admin/feedback/:id/reply", body: { text: "Thank you" }, ok: 201 },
  { route: "PATCH /api/admin/feedback/:id", body: { note: "seen" }, ok: 200 },
  { route: "GET /api/admin/stats", ok: 200 },
  { route: "DELETE /api/admin/feedback/:id", ok: 204 },
];

/** Every route the server has when it is made the way `index.ts` makes it, as `METHOD /path` (the HEAD that goes with each GET left out). */
async function registered(): Promise<string[]> {
  const client = await mkdtemp(path.join(tmpdir(), "kino-authz-client-"));
  const fixtures = await mkdtemp(path.join(tmpdir(), "kino-authz-fixtures-"));
  folders.push(client, fixtures);
  await writeFile(path.join(client, "index.html"), "<!doctype html><title>Kino</title>");
  const routes = new Set<string>();
  // (A route is told of while it is made, so the listener goes on to the server as it is born: Fastify says so on this channel.)
  const watch = (message: unknown) =>
    (message as { fastify: FastifyInstance }).fastify.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) routes.add(`${method} ${route.url}`);
    });
  subscribe("fastify.initialization", watch);
  try {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), flushMs: 0 });
    apps.push(await buildApp({ accounts, visits, passwordCost: cheap, feedbackAdminToken: TOKEN, clientDir: client, fixturesDir: fixtures }));
  } finally {
    unsubscribe("fastify.initialization", watch);
  }
  return [...routes].filter((route) => !(route.startsWith("HEAD ") && routes.has(`GET ${route.slice(5)}`))).sort();
}

/* ------------------------------ one request, made of what the row says ------------------------------ */

interface Attempt {
  values: Slot;
  /** Whose password the body carries (when it carries one). */
  as: Owner;
}

const slotKeys = (each: Row, name: string): string[] => [each.slots[name] ?? []].flat();
const ownValues = (each: Row, o: Owner): Slot => Object.fromEntries(Object.keys(each.slots).map((name) => [name, o.ids[slotKeys(each, name)[0]!]!]));
const theirValues = (each: Row, name: string, o: Owner): string[] => slotKeys(each, name).map((key) => o.ids[key]!);

/**
 * What `by` (signed in, with their own things; or nobody) can try against `on`: every way of filling the names of the row with `on`'s things and `by`'s own, but
 * the one that is all `by`'s own, which is not an attack (it is `by` asking for what is theirs).
 */
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

/** What is wrong with the answer to one try against `on`'s things, by someone signed in or not: it is no refusal, it shows something of `on`'s, or it changed something. */
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

/** Every row, asked in the name of `on`'s things by somebody who is not signed in (or whose sign-in is over): all of it is turned away and nothing changes. */
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

/** One row, in a world of its own: tried by the other one and by a visitor, then asked for by the ones it is for. What is wrong, as sentences. */
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

  // the ones it is for can do it, and nobody else's things are touched or shown by it
  for (const [doer, others] of [[a, b], [b, a]] as const) {
    const before = await snapshot(w, others);
    const reply = await send(each, doer.client, { values: ownValues(each, doer), as: doer });
    if (!(each.ok ?? succeeded)(reply)) problems.push(`${doer.login} could not do it for themselves: ${reply.said} was answered ${reply.statusCode} ${reply.body.slice(0, 160)}`);
    for (const shown of leaks(reply.body, others, reply.said)) problems.push(`${doer.login}'s own ${reply.said} showed ${shown} of ${others.login}'s`);
    changes(before, await snapshot(w, others)).forEach((changed) => problems.push(`${doer.login}'s own ${reply.said} changed ${changed} of ${others.login}'s`));
  }
  return problems;
}

/* ------------------------------ the tests ------------------------------ */

describe("the routes of the server", () => {
  it("are every one in a row of the table, in the list of the public ones (with the reason) or in the team's: a route added later has to be put in one", async () => {
    const known = new Set([...ROWS.map((each) => each.route), ...Object.keys(PUBLIC), ...TEAM.map((each) => each.route)]);
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

/** A server with nobody in it but what a question about the team's side needs. */
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
    /** Ends Alma's sign-in on a device (or all), and hands over copies of the cookies that were good until then. */
    end(w: World): Promise<Client[]>;
    /** Alma's browser is still signed in after it. */
    browser: boolean;
    /** Boris is still signed in, and nothing of his has changed. */
    boris: boolean;
  }
  const ends: End[] = [
    { name: "signed out", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.tv.post("/api/auth/logout"), [204]); return [old]; } },
    { name: "ended from another device", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.delete(`/api/sessions/${w.a.ids.session}`), [204]); return [old]; } },
    { name: "signed out everywhere else", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.delete("/api/sessions"), [204]); return [old]; } },
    { name: "ended by a new password", browser: true, boris: true, end: async (w) => { const old = Client.copy(w.app, w.a.tv); await must(w.a.client.post("/api/me/password", { current: w.a.password, next: "another password" }), [204]); return [old]; } },
    { name: "too old", browser: false, boris: false, end: async (w) => { const old = Client.copy(w.app, w.a.client); w.clock.now += SESSION_TTL_MS + 1; await old.get("/api/me"); return [old]; } }, // (one that is too old is let go the first time it is used)
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
    return client.call(method, `${route.replace(":id", w.a.ids.report!).replace(":file", w.a.ids.file!)}${query}`, entry.body);
  };

  it("takes the team's token as a Bearer and nothing else: not a sign-in, not the token of one", { timeout: 60_000 }, async () => {
    const w = await world();
    const before = await kept(w);
    const shown = await seen(w, w.a);
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

    // with the token it is all there to read and to change, and the last route takes the report away
    for (const entry of TEAM) expect((await call(w, w.team, entry)).statusCode, entry.route).toBe(entry.ok);
    expect((await call(w, w.team, TEAM.find((entry) => entry.route === "GET /api/admin/feedback/:id")!)).statusCode).toBe(404);
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
    // somebody signed in who reads the code may look at it, and say yes or no (the phone says what is asking: that is the check)...
    expect(await must(b.client.get(`/api/link/${a.ids.link}`))).toMatchObject({ code: a.ids.link, kind: "tv" });
    // ...but the code is not enough to be the screen: the answer is for the one with the secret
    for (const secret of [b.ids.linkSecret, "x".repeat(32)]) {
      expect((await new Client(w.app).post("/api/link/poll", { code: a.ids.link, secret })).data).toEqual({ status: "gone" });
    }
    // saying yes signs the screen in as the one who said it, and nothing of the other's goes with it
    await must(b.client.post(`/api/link/${a.ids.link}/approve`), [204]);
    const screen = new Client(w.app);
    const polled = await screen.post("/api/link/poll", { code: a.ids.link, secret: a.ids.linkSecret });
    expect(polled.data).toMatchObject({ status: "approved", me: { account: { id: b.account } } });
    expect(leaks(polled.body, a)).toEqual([]);
    expect((await screen.get("/api/me")).data.me.account.id).toBe(b.account);
    // that is given once; and saying no is the same, and is told once
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
    // numbers go up one by one, so a number alone must not open anything (nor a key that is nobody's)
    for (const [who, client] of [["a visitor", new Client(w.app)], ["Boris", b.client], ["Alma", a.client]] as const) {
      for (const tried of [{ id }, { id, text: "more" }, { id, key: "not-a-key-of-any-report-at-all" }]) {
        for (const route of ["open", "reply"]) {
          const reply = await client.post(`/api/feedback/${route}`, tried);
          expect([reply.statusCode, reply.data.error], `${who} ${route} ${JSON.stringify(tried)}`).toEqual([404, "not_found"]);
        }
      }
    }
    expect(differences(before, await kept(w))).toEqual([]);
    // Boris's own key with Alma's number is Boris's report, not hers
    const own = JSON.stringify(await must(b.client.post("/api/feedback/open", { key: b.ids.reportKey, id: a.ids.report })));
    expect(own).toContain("secret-boris-report");
    expect(leaks(own, a)).toEqual([]);
    // the key is the report's owner, from any page; the account that sent one reads it on every device of its own
    expect(await must(new Client(w.app).post("/api/feedback/open", { key }))).toMatchObject({ id, message: "secret-page-report" });
    expect(await must(a.tv.post("/api/feedback/open", { id: a.ids.report }))).toMatchObject({ id: a.ids.report });
    // what is listed for an account is its own, and a report sent from no account is on no list
    for (const o of [a, b]) {
      const listed = await must(o.client.get("/api/feedback/mine"));
      expect(listed.items.map((item: { id: string }) => item.id)).toEqual([o.ids.report]);
    }
    // asking after keys tells of those keys only
    const checked = await must(b.client.post("/api/feedback/check", { keys: [b.ids.reportKey, "not-a-key-of-any-report-at-all"] }));
    expect(checked.items.map((item: { key: string }) => item.key)).toEqual([b.ids.reportKey]);
  });
});

describe("a profile of one cannot speak as a profile of the other", () => {
  it("what Boris sends to Alma's friend is from Boris, and as Alma it is turned away", async () => {
    const w = await world();
    const { a, b } = w;
    const mine = (o: Owner, rest: string) => `/api/profiles/${o.ids.profile}/friends${rest}`;
    // as himself he may ask Alma's friend to be a friend: it arrives as his and as nobody else's
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
    // a title as himself to a friend who is not his gets nowhere either, and says so the way it does for everybody
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
    // somebody who only asked, somebody Alma never met, and a friend of Boris's: nothing
    for (const who of [a.asker, w.tess, w.b.friend]) {
      for (const part of ["lists", "ratings", "chat", "chat/report"]) {
        const reply = await read(who, part);
        expect([reply.statusCode, reply.data.error], `${who.login} ${part}`).toEqual([404, "not_friends"]);
      }
    }
    // a friend: what Alma shares (that is what friends are for), and not Boris's
    const lists = JSON.stringify(await must(read(a.friend, "lists")));
    expect(lists).toContain("secret-alma-list");
    expect(JSON.stringify(await must(read(a.friend, "ratings")))).toContain("secret-alma-opinion");
    expect(leaks(lists, w.b)).toEqual([]);
    // inside the friendship too, a line is taken back by the one who wrote it, and a plan is answered and cleared by the one it was put to
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
    // what she turns off is not shown, one thing at a time
    await choose(["friendsLists", false]);
    expect((await read(a.friend, "lists")).data).toEqual({ error: "not_shared" });
    expect((await read(a.friend, "ratings")).statusCode).toBe(200);
    await choose(["friendsRatings", false]);
    expect((await read(a.friend, "ratings")).data).toEqual({ error: "not_shared" });
    // with friends off altogether nothing of hers is shown, no word reaches her and nothing is sent
    await choose(["friendsLists", true], ["friendsRatings", true], ["friends", false]);
    expect((await read(a.friend, "lists")).data).toEqual({ error: "not_shared" });
    const word = await a.friend.client.post(`/api/profiles/${a.friend.profile.id}/friends/${a.ids.profile}/chat`, { text: "hi" });
    expect([word.statusCode, word.data.error]).toEqual([403, "chat_off"]);
    const sent = await must(a.friend.client.post(`/api/profiles/${a.friend.profile.id}/friends/send`, { to: [a.ids.profile], kind: "together" }), [200]);
    expect(sent).toEqual({ sent: [], declined: [a.ids.profile] });
    // she still sees who her friends are, and can take one off without turning anything on; and then it is over for both
    const friends = await must(a.client.get(`/api/profiles/${a.ids.profile}/friends/kept`));
    expect(friends.friends.map((friend: { id: string }) => friend.id)).toEqual([a.ids.friend]);
    await must(a.client.delete(`/api/profiles/${a.ids.profile}/friends/${a.ids.friend}`), [204]);
    for (const part of ["lists", "ratings", "chat"]) expect((await read(a.friend, part)).data, part).toEqual({ error: "not_friends" });
    // and what they wrote to each other goes with the friendship
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
    // a code that is nobody's counts against whoever tried it, and ten of those close the door, to the right code too
    for (let n = 0; n < 10; n++) expect((await peek(b, `WRONG${n}ABC`)).data, `guess ${n}`).toEqual({ error: "invite_gone" });
    const locked = await peek(b, code);
    expect([locked.statusCode, locked.data.error]).toEqual([429, "rate_limited"]);
    // somebody else is not kept waiting by it
    expect((await peek(w.tess, code)).statusCode).toBe(200);
  });

  // (friends/send tells an open party from a closed one, so a code that no party is open with is a wrong guess, as it is for invite codes and tags)
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
