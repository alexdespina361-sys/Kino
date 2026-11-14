import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientMessageSchema, CommandSchema, DEFAULT_CAPTION_STYLE, parseClientMessage, parseServerMessage, ServerMessageSchema, type ServerMessage } from "../shared";
import { hashPassword } from "./accounts/password";
import { MemoryPersistence } from "./accounts/persistence";
import { AccountStore } from "./accounts/store";
import { buildApp } from "./app";
import type { LibrarySource } from "./library/library";
import {
  awkwardValues,
  bodyShapes,
  CORE_VALUES,
  DROP,
  FILE_JUNK,
  frameShapes,
  hashed,
  headerShapes,
  heavyValues,
  OVER_THE_LIMIT,
  PATH_JUNK,
  pathsIn,
  QUERY_JUNK,
  QUERY_STRINGS,
  replaceAt,
  sample,
  seeded,
  toJson,
  type BodyShape,
  type FrameShape,
  type Named,
} from "./robustnessInputs";
import { VisitCounter } from "./stats/visits";
import { buildStreamRelay } from "./streamRelay/app";
import { signedRelayUrl, type RelayLink } from "./streamRelay/links";
import { FRAME_BURST } from "./websocket/hub";

/**
 * The HTTP API and the WebSocket, asked for what no page asks for: every route with every method it has, signed out, signed in as an ordinary user and (for the
 * team's routes) with the team's token, each with the valid request and then with awkward ones (a path, a query, a body, a header, a field of a body made wrong).
 * What has to hold is the same everywhere: no answer from the 500s, JSON or nothing, no stack trace or file path in it, an answer within two seconds, and nothing
 * thrown that nobody caught. Everything is in-process (`app.inject`, `app.injectWS`); the only address a route is ever given to fetch is a server of this file's own.
 * The WebSocket is spoken to as a stranger, as a TV and as a phone (alone, paired, in a party): every message of the protocol made wrong field by field, and
 * frames that are no message at all. It has to take them in, answer a PING afterwards and close the connection only with a clean code. The stream relay (a small
 * app of its own) gets the same for its signed links.
 * What the sweep sends is fixed by `SEED` (see `robustnessInputs.ts`), so a failure is the same failure on every machine.
 */

const SEED = 20_261_102;
const TEAM_TOKEN = "team-token-of-the-sweep".padEnd(32, "-");
const PASSWORD = "sweep-password";
const cheap = { N: 1024, r: 8, p: 1 } as const;
/** An answer that takes longer than this is a finding, whatever it says. */
const SLOW_MS = 2000;
/** How many people with friends, chats and reports the signed-in passes are spread over (so that no limit per account is what answers). */
const WORLDS = 24;
const CANARY = "TEXT-OF-A-FILE-OUTSIDE-THE-SERVED-FOLDERS";
const ROOT = path.resolve(import.meta.dirname, "../..");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a picture")]);

/* ------------------------------ what a request is ------------------------------ */

interface Req {
  method: string;
  url: string;
  headers: Record<string, string>;
  payload?: string | Buffer;
}
interface Route {
  method: string;
  url: string;
  key: string;
}
type Pass = "out" | "user" | "team";

/** Somebody with an account, friends, a chat, an inbox, a report and the rest of what the routes take in their addresses. */
interface World {
  cookie: string;
  email: string;
  password: string;
  account: string;
  profile: string;
  /** A second profile of the account: the one that routes which take a profile away are given. */
  spare: string;
  friend: string;
  /** Another friend, for the route that ends a friendship (the friend above is the one the other routes ask about). */
  spareFriend: string;
  /** How the friend is asked for by tag. */
  tag: string;
  /** Somebody whose request to be friends is waiting. */
  asker: string;
  /** Another device of the account. */
  session: string;
  /** The friend's code (to be a friend of, which the profile already is) and the profile's own. */
  invite: string;
  ownInvite: string;
  inbox: string;
  plan: string;
  line: string;
  linkPeek: string;
  linkApprove: string;
  linkDeny: string;
  link: { code: string; secret: string };
  report: { key: string; id: string; file: string };
  doomed: string;
}

/* ------------------------------ the rig ------------------------------ */

const unhandled: string[] = [];
const trap = (error: unknown) => void unhandled.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));

let app: FastifyInstance;
let accounts: AccountStore;
let upstream: Server;
/** The sweep's own server, the only place a route is ever sent to. */
let origin = "";
/** A title's link: a page of that server, so that nothing which follows it (the library looks for its video) leaves this machine. */
let TITLE = "";
let tmp = "";
let hash = "";
const routes: Route[] = [];
const methodsOf = new Map<string, Set<string>>();
const worlds: World[] = [];

let addresses = 0;
/** A different visitor for every request (behind one proxy, as on the host), so that a limit per address is never what answers. */
function nextAddress(): string {
  addresses++;
  return `45.${(addresses >> 16) & 255}.${(addresses >> 8) & 255}.${addresses & 255}`;
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, who: { cookie?: string }, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-forwarded-for": nextAddress(), ...(who.cookie ? { cookie: who.cookie } : {}) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  const set = res.headers["set-cookie"];
  const header = Array.isArray(set) ? set[0] : set;
  let data: any;
  try {
    data = res.json();
  } catch {
    data = undefined;
  }
  return { status: res.statusCode, data, cookie: header?.split(";")[0] };
}

/** A call that has to have worked: the world is made of them. */
async function made(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, who: { cookie?: string }, payload: unknown, status: number) {
  const answer = await call(method, url, who, payload);
  if (answer.status !== status) throw new Error(`setting up: ${method} ${url} answered ${answer.status} ${JSON.stringify(answer.data)}, wanted ${status}`);
  return answer;
}

const library: LibrarySource = {
  id: "sweep",
  name: "The sweep's own library",
  load: async () => [{ id: "row1", title: "A row", source: "sweep", items: [{ id: "t1", title: "Casablanca", url: TITLE }] }],
  search: async () => [{ id: "t1", title: "Casablanca", url: TITLE }],
  similar: async () => [{ id: "t1", title: "Casablanca", url: TITLE }],
  about: async () => null,
  episodes: async () => [],
  seasons: async () => [1, 2],
  shelves: async () => ({ rows: [], next: null }),
  more: async () => ({ items: [{ id: "t2", title: "Another", url: TITLE }], last: true }),
};

async function signUp(login: string) {
  const answer = await made("POST", "/api/auth/register", {}, { email: login, password: PASSWORD, device: "browser" }, 201);
  const first = answer.data.profiles[0];
  return { cookie: answer.cookie as string, account: answer.data.account.id as string, profile: first.id as string, name: first.name as string, tag: first.tag as number };
}
type Person = Awaited<ReturnType<typeof signUp>>;

async function makeWorld(n: number): Promise<World> {
  const user = await signUp(`sweep-user-${n}`);
  const friend = await signUp(`sweep-friend-${n}`);
  const spareFriend = await signUp(`sweep-spare-friend-${n}`);
  const asker = await signUp(`sweep-asker-${n}`);
  const choices = { friends: true, friendsLists: true, friendsRatings: true, friendsGive: true, friendsGet: true, friendsInbox: true, friendsPresence: true, friendsMessages: true };
  for (const person of [user, friend, spareFriend, asker]) {
    const settings = Object.entries(choices).map(([key, value]) => ({ key, at: Date.now(), value }));
    await made("POST", `/api/profiles/${person.profile}/sync`, person, { since: 0, settings }, 200);
  }
  const mine = (person: Person, rest = "") => `/api/profiles/${person.profile}/friends${rest}`;
  for (const each of [friend, spareFriend]) {
    const invited = await made("POST", mine(user, "/invites"), user, undefined, 201);
    await made("POST", mine(each, "/accept"), each, { code: invited.data.code }, 201);
  }
  const theirs = await made("POST", mine(friend, "/invites"), friend, undefined, 201);
  const own = await made("POST", mine(user, "/invites"), user, undefined, 201);
  await made("POST", mine(asker, "/requests"), asker, { tag: `${user.name}#${user.tag}` }, 201);
  await made("POST", mine(friend, "/send"), friend, { to: [user.profile], kind: "recommend", title: "A film", url: TITLE }, 200);
  await made("POST", mine(friend, "/send"), friend, { to: [user.profile], kind: "plan", when: Date.now() + 86_400_000 }, 200);
  const inbox = (await made("GET", mine(user), user, undefined, 200)).data.inbox as Array<{ id: string; kind: string }>;
  const chat = await made("POST", mine(user, `/${friend.profile}/chat`), user, { text: "hello" }, 201);
  const links = await Promise.all([1, 2, 3, 4].map(() => made("POST", "/api/link/start", {}, { device: "tv" }, 201)));
  accounts.createSession(user.account, "tv", "Sweep TV");
  const spare = (await made("POST", "/api/profiles", user, { name: "Spare", avatar: "owl" }, 201)).data.profiles.find((profile: { name: string }) => profile.name === "Spare");
  const report = (key: string) => ({
    key,
    kind: "bug",
    area: "player",
    message: "It broke",
    answer: true,
    attachments: [{ id: "pic1", name: "a.png", mime: "image/png", role: "screenshot", data: PNG.toString("base64") }],
  });
  const key = `sweep${String(n).padStart(20, "0")}`;
  const sent = await made("POST", "/api/feedback", user, report(key), 201);
  const doomed = await made("POST", "/api/feedback", user, report(`doomed${String(n).padStart(19, "0")}`), 201);
  return {
    cookie: user.cookie,
    email: `sweep-user-${n}`,
    password: PASSWORD,
    account: user.account,
    profile: user.profile,
    spare: spare.id,
    friend: friend.profile,
    spareFriend: spareFriend.profile,
    tag: `${friend.name}#${friend.tag}`,
    asker: asker.profile,
    session: accounts.listSessions(user.account).find((session) => session.label === "Sweep TV")!.id,
    invite: theirs.data.code,
    ownInvite: own.data.code,
    inbox: inbox.find((item) => item.kind === "recommend")!.id,
    plan: inbox.find((item) => item.kind === "plan")!.id,
    line: String(chat.data.lines.at(-1).id),
    linkPeek: links[0]!.data.code,
    linkApprove: links[1]!.data.code,
    linkDeny: links[2]!.data.code,
    link: { code: links[3]!.data.code, secret: links[3]!.data.secret },
    report: { key, id: sent.data.id, file: "pic1" },
    doomed: doomed.data.id,
  };
}

let freshCount = 0;
/** A new account (signed in, with a second profile and a second device) for a route that takes something of the account away. */
function freshWorld(): World {
  const n = ++freshCount;
  const email = `fresh-${n}`;
  const created = accounts.createAccount(email, hash);
  if (!created.ok) throw new Error("could not make a fresh account");
  const spare = accounts.addProfile(created.value.id, "Spare", "owl");
  if (!spare.ok) throw new Error("could not make a spare profile");
  accounts.createSession(created.value.id, "tv", "Sweep TV");
  const { token } = accounts.createSession(created.value.id, "browser", "Sweep browser");
  const none = "nobody";
  return {
    ...(worlds[0] as World),
    cookie: `kino_session=${token}`,
    email,
    password: PASSWORD,
    account: created.value.id,
    profile: created.value.profiles[0]!.id,
    spare: spare.value.id,
    friend: none,
    spareFriend: none,
    tag: `${none}#1`,
    asker: none,
    session: accounts.listSessions(created.value.id).find((session) => session.label === "Sweep TV")!.id,
  };
}

beforeAll(async () => {
  process.on("uncaughtException", trap);
  process.on("unhandledRejection", trap);
  tmp = mkdtempSync(path.join(tmpdir(), "kino-robustness-"));
  const client = path.join(tmp, "served", "client");
  const fixtures = path.join(tmp, "served", "fixtures");
  for (const folder of [path.join(client, "assets"), path.join(client, "subtitle-sync", "1"), fixtures]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(client, "index.html"), "<!doctype html><title>sweep</title><div id=root></div>");
  writeFileSync(path.join(client, "assets", "app-1.js"), "export {};\n");
  writeFileSync(path.join(client, "subtitle-sync", "1", "README.md"), "model\n");
  writeFileSync(path.join(fixtures, "sample.mp4"), Buffer.alloc(4096, 7));
  writeFileSync(path.join(tmp, "served", "outside.txt"), CANARY);
  writeFileSync(path.join(tmp, "outside.txt"), CANARY);

  // The one place `/api/proxy` and `/api/resolve` are ever sent to: a page with a video, the video, a playlist and a subtitle file.
  upstream = createServer((request, response) => {
    const pathname = (request.url ?? "").split("?")[0];
    if (pathname === "/video.mp4") response.writeHead(200, { "content-type": "video/mp4", "content-length": 2048 }).end(Buffer.alloc(2048, 1));
    else if (pathname === "/page.html") response.writeHead(200, { "content-type": "text/html" }).end('<html><title>Sweep</title><video src="/video.mp4"></video></html>');
    else if (pathname === "/list.m3u8") response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4,\nsegment1.ts\n#EXT-X-ENDLIST\n");
    else if (pathname === "/sub.srt") response.writeHead(200, { "content-type": "application/x-subrip" }).end("1\n00:00:01,000 --> 00:00:02,000\nHello\n");
    else response.writeHead(404, { "content-type": "text/plain" }).end("not here");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  TITLE = `${origin}/page.html`;

  hash = await hashPassword(PASSWORD, cheap);
  accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  const visits = await VisitCounter.open({ persistence: new MemoryPersistence(), flushMs: 0 });
  // (Every route is told of as it is added: the hook is put on the app the moment Fastify makes it, before the first route.)
  const seen: Array<{ method: string | string[]; url: string }> = [];
  const onInit = ({ fastify }: any) => fastify.addHook("onRoute", (route: { method: string | string[]; url: string }) => seen.push({ method: route.method, url: route.url }));
  subscribe("fastify.initialization", onInit);
  try {
    app = await buildApp({
      accounts,
      visits,
      passwordCost: cheap,
      feedbackAdminToken: TEAM_TOKEN,
      feedbackSendsPer10Min: 1_000_000,
      signUpsPerHour: 1_000_000,
      maxAccounts: 1_000_000,
      trustProxy: 1,
      librarySources: [library],
      allowPrivateNetwork: true,
      cat: true,
      // (Google sign-in on, at the address the sweep's requests come to; its token endpoint is the sweep's own server, which has none: a code is never taken.)
      google: { clientId: "sweep-client", clientSecret: "sweep-secret", redirectUris: ["http://localhost/api/auth/google/callback"], tokenUrl: `${origin}/token`, timeoutMs: 500 },
      clientDir: client,
      fixturesDir: fixtures,
      hub: { maxFailedPairings: 1_000_000 },
    });
  } finally {
    unsubscribe("fastify.initialization", onInit);
  }
  await app.ready();

  const keyed = new Map<string, Route>();
  for (const { method, url } of seen) {
    for (const each of [method].flat()) {
      methodsOf.set(url, (methodsOf.get(url) ?? new Set<string>()).add(each));
      if (each !== "HEAD") keyed.set(`${each} ${url}`, { method: each, url, key: `${each} ${url}` });
    }
  }
  // (What no route answers - a page of the app, an address that is nothing - is answered by the not-found handler of the app.)
  for (const [method, url] of [["GET", "/tv"], ["GET", "/no/such/place"], ["POST", "/no/such/place"]] as const) keyed.set(`${method} ${url}`, { method, url, key: `${method} ${url}` });
  routes.push(...[...keyed.values()].sort((a, b) => a.key.localeCompare(b.key)));

  for (let n = 1; n <= WORLDS; n++) worlds.push(await makeWorld(n));
}, 60_000);

afterAll(async () => {
  process.off("uncaughtException", trap);
  process.off("unhandledRejection", trap);
  await app?.close();
  await new Promise((resolve) => (upstream ? upstream.close(resolve) : resolve(undefined)));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/* ------------------------------ what each route takes ------------------------------ */

interface Spec {
  /** The team's routes: asked with the team's token in the third pass. */
  team?: boolean;
  /** A new account for every request: the route takes something of the account away. */
  fresh?: boolean;
  /** Takes big things: the biggest bodies and values are tried on it. */
  heavy?: boolean;
  params?: Record<string, (w: World) => string>;
  query?: (w: World) => Record<string, string>;
  body?: (w: World) => unknown;
  headers?: Record<string, string>;
  /** The answers besides 2xx and 3xx that the valid request gets by going through the whole route (a refusal that is meant). */
  ok?: number[];
}

const profile = { id: (w: World) => w.profile };
const withFriend = { ...profile, fid: (w: World) => w.friend };
let registered = 0;
let reported = 0;
const syncBody = () => ({
  since: 0,
  progress: [{ key: "k1", at: 1, title: "A film", url: TITLE, position: 10, duration: 100 }],
  watched: [{ key: "w1", at: 1, show: "A show", season: 1, episode: 1, position: 10, duration: 100, done: false }],
  list: [{ key: "l1", at: 1, id: "t1", title: "A film", url: TITLE }],
  listNames: [{ key: "mine", at: 1, name: "Mine" }],
  ratings: [{ key: "rate:x", at: 1, title: "A film", url: TITLE, score: 7, ratedAt: 1 }],
  settings: [{ key: "lang", at: 1, value: "en" }],
});
const feedbackBody = () => ({
  key: `again${String(++reported).padStart(20, "0")}`,
  kind: "bug",
  area: "player",
  title: "Sweep",
  message: "It broke",
  details: { steps: "play it" },
  severity: "minor",
  frequency: "once",
  answer: true,
  attachments: [{ id: "pic1", name: "a.png", mime: "image/png", role: "screenshot", data: PNG.toString("base64") }],
  context: { build: "x", role: "tv", device: { ua: "x", screen: [1920, 1080] }, trail: ["pressed"] },
});

const SPECS: Record<string, Spec> = {
  "GET /*": { params: { "*": () => "index.html" } },
  "GET /fixtures/*": { params: { "*": () => "sample.mp4" } },
  "GET /tv": { headers: { accept: "text/html" } },
  "GET /no/such/place": { ok: [404] },
  "POST /no/such/place": { ok: [404] },
  // (A plain request for the WebSocket address is not a WebSocket: it is told there is nothing there.)
  "GET /ws": { ok: [404] },
  "GET /api/library/search": { query: () => ({ q: "casa" }) },
  "GET /api/library/rows": { query: () => ({ cursor: "0", section: "movie" }) },
  "GET /api/library/more": { query: () => ({ row: "row1", page: "2" }) },
  "GET /api/library/similar": { query: () => ({ url: TITLE }) },
  "GET /api/library/about": { query: () => ({ url: TITLE }), ok: [200] },
  "GET /api/library/episodes": { query: () => ({ url: TITLE, season: "1" }) },
  "GET /api/library/seasons": { query: () => ({ url: TITLE }) },
  "GET /api/resolve": { query: () => ({ url: `${origin}/page.html` }) },
  "GET /api/proxy": { query: () => ({ url: `${origin}/video.mp4`, referer: `${origin}/` }) },
  "GET /api/subtitles/ro/:file": { ok: [404] },
  "POST /api/auth/register": { heavy: true, body: () => ({ email: `new-${++registered}`, password: PASSWORD, device: "browser" }) },
  "POST /api/auth/login": { body: (w) => ({ email: w.email, password: w.password, device: "browser" }) },
  "POST /api/auth/logout": { fresh: true, ok: [204] },
  "POST /api/me/password": { fresh: true, body: (w) => ({ current: w.password, next: "another-password" }), ok: [204] },
  "POST /api/me/delete": { fresh: true, body: (w) => ({ password: w.password }), ok: [204] },
  // (The start sends the browser to Google; the way back is given a state that no flow has, which is a way back that went wrong: both answer with a redirect.)
  "GET /api/auth/google/start": { query: () => ({ device: "remote", next: "/", mode: "signin" }) },
  "GET /api/auth/google/callback": { query: () => ({ state: "s".repeat(43), code: "4/0Asweep" }) },
  "PATCH /api/sessions/:id": { params: { id: (w) => w.session }, body: () => ({ label: "Kitchen TV" }) },
  "DELETE /api/sessions/:id": { fresh: true, params: { id: (w) => w.session }, ok: [204] },
  "DELETE /api/sessions": { fresh: true, ok: [204] },
  "POST /api/profiles": { fresh: true, body: () => ({ name: "Another", avatar: "fox" }), ok: [201] },
  "PATCH /api/profiles/:id": { params: profile, body: () => ({ name: "Renamed", avatar: "cat" }) },
  "DELETE /api/profiles/:id": { fresh: true, params: { id: (w) => w.spare } },
  "POST /api/profiles/:id/sync": { heavy: true, params: profile, body: syncBody },
  "POST /api/link/start": { body: () => ({ device: "tv" }), ok: [201] },
  "POST /api/link/poll": { body: (w) => ({ code: w.link.code, secret: w.link.secret }) },
  "GET /api/link/:code": { params: { code: (w) => w.linkPeek } },
  "POST /api/link/:code/approve": { params: { code: (w) => w.linkApprove }, ok: [204] },
  "POST /api/link/:code/deny": { params: { code: (w) => w.linkDeny }, ok: [204] },
  "GET /api/profiles/:id/friends": { params: profile },
  "POST /api/profiles/:id/screen": { params: profile },
  "GET /api/profiles/:id/friends/kept": { params: profile },
  "POST /api/profiles/:id/friends/invites": { params: profile, ok: [201] },
  "DELETE /api/profiles/:id/friends/invites/:code": { params: { ...profile, code: (w) => w.ownInvite }, ok: [204, 404] },
  "GET /api/profiles/:id/friends/invites/:code": { params: { ...profile, code: (w) => w.invite } },
  "POST /api/profiles/:id/friends/accept": { params: profile, body: (w) => ({ code: w.invite }), ok: [409] },
  "GET /api/profiles/:id/friends/tags/:tag": { params: { ...profile, tag: (w) => w.tag }, ok: [409] },
  "POST /api/profiles/:id/friends/requests": { params: profile, body: (w) => ({ tag: w.tag }), ok: [409] },
  "POST /api/profiles/:id/friends/requests/:fid/accept": { params: { ...profile, fid: (w) => w.asker }, ok: [201, 404] },
  "DELETE /api/profiles/:id/friends/requests/:fid": { params: { ...profile, fid: (w) => w.asker }, ok: [204, 404] },
  "DELETE /api/profiles/:id/friends/:fid": { params: { ...profile, fid: (w) => w.spareFriend }, ok: [204, 404] },
  "GET /api/profiles/:id/friends/:fid/lists": { params: withFriend },
  "GET /api/profiles/:id/friends/:fid/ratings": { params: withFriend },
  "POST /api/profiles/:id/friends/send": {
    heavy: true,
    params: profile,
    body: (w) => ({ to: [w.friend], kind: "recommend", title: "A film", url: TITLE, image: `${origin}/a.jpg`, year: 1942, type: "movie", note: "Good" }),
  },
  "POST /api/profiles/:id/friends/plans/:itemId/accept": { params: { ...profile, itemId: (w) => w.plan }, ok: [204, 404] },
  "POST /api/profiles/:id/friends/plans/:itemId/decline": { params: { ...profile, itemId: (w) => w.plan }, ok: [204, 404] },
  "POST /api/profiles/:id/friends/inbox/read": { params: profile, ok: [204] },
  "DELETE /api/profiles/:id/friends/inbox/:itemId": { params: { ...profile, itemId: (w) => w.inbox }, ok: [204, 404] },
  "GET /api/profiles/:id/friends/:fid/chat": { params: withFriend },
  "POST /api/profiles/:id/friends/:fid/chat": { params: withFriend, body: () => ({ text: "hello again" }) },
  "DELETE /api/profiles/:id/friends/:fid/chat/:n": { params: { ...withFriend, n: (w) => w.line }, ok: [200, 404] },
  "PUT /api/profiles/:id/friends/:fid/chat/mute": { params: withFriend, body: () => ({ muted: false }) },
  "GET /api/profiles/:id/friends/:fid/chat/report": { params: withFriend },
  "POST /api/profiles/:id/friends/:fid/chat/report": { params: withFriend, body: () => ({ rev: 1 }), ok: [204, 400, 404, 409] },
  "POST /api/feedback": { heavy: true, body: feedbackBody },
  "POST /api/feedback/check": { body: (w) => ({ keys: [w.report.key] }) },
  "POST /api/feedback/open": { body: (w) => ({ key: w.report.key }) },
  "POST /api/feedback/reply": { heavy: true, body: (w) => ({ key: w.report.key, text: "More words", attachments: [] }) },
  "GET /api/admin/feedback": { team: true, query: () => ({ status: "open", limit: "5" }) },
  // (`since` is a revision that never is the current one, and `wait` is none: a request for this route never waits for something to change.)
  "GET /api/admin/feedback/changes": { team: true, query: () => ({ since: "-1", wait: "0" }) },
  "GET /api/admin/feedback/:id": { team: true, params: { id: (w) => w.report.id } },
  "GET /api/admin/feedback/:id/files/:file": { team: true, params: { id: (w) => w.report.id, file: (w) => w.report.file } },
  "POST /api/admin/feedback/:id/reply": { team: true, params: { id: (w) => w.report.id }, body: () => ({ text: "Thanks", ask: false }), ok: [201] },
  "PATCH /api/admin/feedback/:id": { team: true, params: { id: (w) => w.report.id }, body: () => ({ status: "in_review", tags: ["a"], note: "n" }) },
  "DELETE /api/admin/feedback/:id": { team: true, params: { id: (w) => w.doomed }, ok: [204, 404] },
  "GET /api/admin/stats": { team: true, query: () => ({ days: "30" }) },
  "GET /api/subsync/:key": { params: { key: () => "a".repeat(32) }, ok: [204] },
  "PUT /api/subsync/:key": { heavy: true, params: { key: () => "b".repeat(32) }, body: () => ({ v: 1, lines: 10, placed: [[0, 5, 5, 1], [1, 10, 10, 0]] }), ok: [204] },
};

/* ------------------------------ building the requests ------------------------------ */

interface Base {
  method: string;
  params: Record<string, string>;
  query: Array<[string, string]>;
  body: unknown;
  headers: Record<string, string>;
}
/** What a probe changes of the request after its valid form was built: the end of the address, the whole body, some headers (`null`: none). */
interface Overlay {
  method?: string;
  suffix?: string;
  payload?: string | Buffer | null;
  headers?: Record<string, string | null>;
}
interface Probe {
  label: string;
  make(world: World): Req;
}

const namesIn = (url: string): string[] => [...url.matchAll(/:(\w+)|\*/g)].map((found) => found[1] ?? "*");

function baseOf(route: Route, spec: Spec, w: World, pass: Pass): Base {
  const params = Object.fromEntries(Object.entries(spec.params ?? {}).map(([name, value]) => [name, encodeURIComponent(value(w))]));
  if ("*" in params) params["*"] = (spec.params!["*"] as (w: World) => string)(w);
  const query = Object.entries(spec.query?.(w) ?? {}).map(([name, value]): [string, string] => [name, encodeURIComponent(value)]);
  const headers: Record<string, string> = { ...spec.headers };
  if (pass === "user") headers.cookie = w.cookie;
  if (pass === "team") headers.authorization = `Bearer ${TEAM_TOKEN}`;
  const body = spec.body?.(w);
  if (body !== undefined) headers["content-type"] = "application/json";
  return { method: route.method, params, query, body, headers };
}

function render(route: Route, base: Base, overlay: Overlay = {}): Req {
  const filled = route.url.replace(/:(\w+)|\*/g, (_, name?: string) => base.params[name ?? "*"] ?? "x");
  const query = base.query.map(([name, value]) => `${name}=${value}`).join("&");
  const url = `${filled}${query ? `?${query}` : ""}${overlay.suffix ? `${query ? "&" : "?"}${overlay.suffix}` : ""}`;
  const headers = { ...base.headers };
  for (const [name, value] of Object.entries(overlay.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const payload = overlay.payload !== undefined ? overlay.payload : base.body === undefined ? null : toJson(base.body);
  return { method: overlay.method ?? base.method, url, headers, ...(payload === null ? {} : { payload }) };
}

/** Addresses a route is given to fetch, written as junk: only ever the sweep's own server, or something that is no address at all. */
const urlJunk = (): Array<Named<string>> => [
  { name: "an address with a name and a password", value: encodeURIComponent(origin.replace("://", "://user:secret@") + "/video.mp4") },
  { name: "an address of 3000 characters", value: encodeURIComponent(`${origin}/${"p".repeat(3000)}`) },
  { name: "the playlist", value: encodeURIComponent(`${origin}/list.m3u8`) },
  { name: "the subtitle file", value: encodeURIComponent(`${origin}/sub.srt`) },
  { name: "a page that is not there", value: encodeURIComponent(`${origin}/missing`) },
];

/** The probes (by the start of their names) that are known to be answered wrongly, and that a test of their own holds on to instead of the sweep (none now). */
const KNOWN: Record<string, string[]> = {};

function probesFor(route: Route, spec: Spec, pass: Pass, rand: () => number): Probe[] {
  const list: Probe[] = [];
  const add = (label: string, edit: (base: Base) => Overlay | void = () => {}) =>
    void list.push({
      label,
      make: (w) => {
        const base = baseOf(route, spec, w, pass);
        return render(route, base, edit(base) ?? {});
      },
    });
  const takesBody = spec.body !== undefined || !["GET", "HEAD", "OPTIONS"].includes(route.method);
  const keys = Object.keys(spec.query?.(worlds[0]!) ?? {});

  add("the valid request");
  const other = ["PUT", "DELETE", "PATCH", "POST"].find((method) => !methodsOf.get(route.url)?.has(method));
  if (other) add(`the method ${other}`, () => ({ method: other }));
  if (route.method === "GET") add("the method HEAD", () => ({ method: "HEAD" }));

  // The address: each part of it made junk, the other parts right.
  for (const name of namesIn(route.url)) {
    const junk = name === "*" ? FILE_JUNK : [...PATH_JUNK.slice(0, 7), ...sample(rand, PATH_JUNK.slice(7), 5)];
    for (const each of junk) add(`${name} as ${each.name}`, (base) => void (base.params[name] = each.value));
  }

  // The query: each name dropped, given junk, and given twice; then names nobody asked for.
  for (const name of keys) {
    add(`the query ${name} left out`, (base) => void (base.query = base.query.filter(([each]) => each !== name)));
    const junk = [...QUERY_JUNK.slice(0, 8), ...sample(rand, QUERY_JUNK.slice(8), 4), ...(["url", "referer"].includes(name) ? urlJunk() : [])];
    for (const each of junk) add(`the query ${name} as ${each.name}`, (base) => void (base.query = base.query.map(([key, value]) => [key, key === name ? each.value : value])));
    add(`repeated query parameter ${name}`, (base) => void base.query.push([name, base.query.find(([key]) => key === name)?.[1] ?? "1"]));
    add(`repeated query parameter ${name} with a different value`, (base) => void base.query.push([name, "different"]));
  }
  for (const each of sample(rand, QUERY_STRINGS, 4)) add(`the query string with ${each.name}`, () => ({ suffix: each.value }));

  // The body, as a whole: with no valid request behind it, and on a route which takes none.
  if (takesBody) {
    const shapes = bodyShapes().filter((shape) => !shape.big);
    const chosen = [...shapes.slice(0, 8), ...sample(rand, shapes.slice(8), 10), ...(spec.heavy ? [...bodyShapes().filter((shape) => shape.big), OVER_THE_LIMIT] : [])];
    for (const shape of chosen) add(`the body: ${shape.name}`, () => overlayOf(shape));
  } else {
    for (const shape of bodyShapes().filter((each) => ["{}", "plain text"].includes(each.name))) add(`the body on a ${route.method}: ${shape.name}`, () => overlayOf(shape));
  }

  // The body, field by field: each part of a valid body made wrong, the other parts right (not when nobody is signed in: the route turns the request away first).
  const template = spec.body?.(worlds[0]!);
  if (template !== undefined && pass !== "out") {
    const places = pathsIn(template);
    const values = [...awkwardValues().slice(0, CORE_VALUES), ...sample(rand, awkwardValues().slice(CORE_VALUES), 3), ...(spec.heavy ? sample(rand, heavyValues(), 2) : [])];
    for (const place of sample(rand, places, 16)) {
      const where = place.join(".");
      add(`the field ${where} left out`, (base) => void (base.body = replaceAt(base.body, place, DROP)));
      for (const each of values) add(`the field ${where} as ${each.name}`, (base) => void (base.body = replaceAt(base.body, place, each.value)));
    }
  }

  // The headers: a few at a time.
  for (const shape of sample(rand, headerShapes(), 8)) add(`the headers: ${shape.name}`, () => ({ headers: shape.headers }));
  return list;
}

function overlayOf(shape: BodyShape): Overlay {
  const headers: Record<string, string | null> = { ...shape.headers };
  if (shape.type === null) headers["content-type"] = null;
  else headers["content-type"] = shape.type ?? "application/json";
  return { payload: shape.body === undefined ? null : shape.body, headers };
}

/* ------------------------------ what an answer must be ------------------------------ */

interface Outcome {
  res?: LightMyRequestResponse;
  ms: number;
  /** The request was never made: the client side turned it down (an address that is nothing, a header that cannot be). */
  unmade?: string;
  /** No answer came within `HANG_MS`. */
  hung?: boolean;
}

/** After this long a request is taken to be stuck, and the sweep goes no further (a request that is slow but answers is told by `SLOW_MS`). */
const HANG_MS = 4000;

async function send(req: Req, target: FastifyInstance = app): Promise<Outcome> {
  const started = performance.now();
  let stopWaiting = () => {};
  const stuck = new Promise<undefined>((give) => {
    const timer = setTimeout(give, HANG_MS);
    stopWaiting = () => clearTimeout(timer);
  });
  try {
    const asked = target.inject({ method: req.method as "GET", url: req.url, headers: { "x-forwarded-for": nextAddress(), ...req.headers }, ...(req.payload === undefined ? {} : { payload: req.payload }) });
    const res = await Promise.race([asked, stuck]);
    if (res) return { res, ms: performance.now() - started };
    asked.catch(() => {});
    return { ms: performance.now() - started, hung: true };
  } catch (error) {
    return { ms: performance.now() - started, unmade: error instanceof Error ? error.message : String(error) };
  } finally {
    stopWaiting();
  }
}

/** Where the server keeps its files, as a path might be written in a message: the folder it runs from, and the ones the rig has it serve. */
const folders = () => [ROOT, tmp].flatMap((folder) => [folder, folder.replaceAll("\\", "/"), folder.replaceAll("\\", "\\\\")]);

const leakOf = (text: string): string | undefined => {
  if (/^\s+at .+:\d+:\d+\)?\s*$/m.test(text)) return "a stack trace";
  if (folders().some((folder) => text.includes(folder))) return "the folder the server runs in or serves from";
  if (/node_modules|node:internal|file:\/\/\//.test(text)) return "a path inside the server";
  return undefined;
};

/** The words of an answer, unpacked if the server packed them (a visitor may ask for that). */
function textOf(res: LightMyRequestResponse): string {
  const coding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
  try {
    if (coding === "gzip") return gunzipSync(res.rawPayload).toString("utf8");
    if (coding === "deflate") return inflateSync(res.rawPayload).toString("utf8");
    if (coding === "br") return brotliDecompressSync(res.rawPayload).toString("utf8");
    if (coding === "zstd") return zstdDecompressSync(res.rawPayload).toString("utf8");
  } catch {
    return "(a packed answer that does not unpack)";
  }
  return res.body;
}

/** What is wrong with an answer, in a few words, or nothing. */
function wrongWith(req: Req, { res, ms, hung }: Outcome): string | undefined {
  if (hung) return `did not answer within ${HANG_MS} ms`;
  if (!res) return undefined;
  const type = String(res.headers["content-type"] ?? "");
  const proxy = req.url.startsWith("/api/proxy");
  if (res.statusCode >= 500) return `answered ${res.statusCode}: ${res.body.slice(0, 140).replace(/\s+/g, " ")}`;
  if (ms > SLOW_MS) return `took ${Math.round(ms)} ms`;
  const readable = /json|text|html|xml|javascript/.test(type) || res.statusCode >= 400;
  const text = readable ? textOf(res) : "";
  if (res.statusCode >= 400 && text && !/json/.test(type) && !(proxy && /^text\/plain/.test(type))) return `answered ${res.statusCode} with ${type || "no type"}, which is not JSON`;
  if (/json/.test(type) && text) {
    try {
      JSON.parse(text);
    } catch {
      return "answered JSON that does not parse";
    }
  }
  const leak = leakOf(text);
  if (leak) return `leaked ${leak}`;
  if (text.includes(CANARY)) return "served a file from outside the folders it serves";
  return undefined;
}

/* ------------------------------ the sweep ------------------------------ */

const totals = { sent: 0, unmade: 0, limited: 0, routes: new Set<string>() };

async function sweep(pass: Pass): Promise<string[]> {
  const problems: string[] = [];
  let turn = 0;
  for (const route of routes) {
    const spec = SPECS[route.key] ?? {};
    if (pass === "team" && !spec.team) continue;
    const rand = seeded(hashed(`${SEED}:${pass}:${route.key}`));
    const known = KNOWN[route.key] ?? [];
    for (const probe of probesFor(route, spec, pass, rand)) {
      if (known.some((prefix) => probe.label.startsWith(prefix))) continue;
      const world = pass !== "out" && spec.fresh ? freshWorld() : worlds[turn++ % worlds.length]!;
      const req = probe.make(world);
      const outcome = await send(req);
      totals.sent++;
      totals.routes.add(route.key);
      if (outcome.unmade) {
        totals.unmade++;
        continue;
      }
      const status = outcome.res?.statusCode ?? 0;
      if (status === 429) totals.limited++;
      const what = wrongWith(req, outcome);
      if (what) problems.push(`[${pass}] ${route.key} - ${probe.label}: ${what}`);
      else if (pass !== "out" && !(spec.team && pass === "user") && probe.label === "the valid request" && status >= 400 && !(spec.ok ?? []).includes(status)) {
        problems.push(`[${pass}] ${route.key} - the valid request answered ${status} (${outcome.res!.body.slice(0, 80)}), so the sweep does not get into the route: mend its entry in SPECS`);
      }
      if (outcome.hung) return problems; // (a server that does not answer is not asked more)
    }
  }
  return problems;
}

const shown = (problems: string[]) => (problems.length > 25 ? [...problems.slice(0, 25), `... and ${problems.length - 25} more`] : problems);

describe("the HTTP API turns away what it should not take", () => {
  it("answers every route well to awkward input when nobody is signed in", async () => {
    expect(shown(await sweep("out"))).toEqual([]);
  }, 60_000);

  it("answers every route well to awkward input when an ordinary user is signed in", async () => {
    expect(shown(await sweep("user"))).toEqual([]);
  }, 60_000);

  it("answers the team's routes well to awkward input when the team's token comes with it", async () => {
    expect(shown(await sweep("team"))).toEqual([]);
  }, 60_000);

  it("got to every route, and was not stopped by a limit", () => {
    expect(totals.routes.size).toBe(routes.length);
    expect(routes.length).toBeGreaterThan(55);
    expect(totals.sent).toBeGreaterThan(3000);
    expect(totals.limited / totals.sent).toBeLessThan(0.05);
    expect(totals.unmade / totals.sent).toBeLessThan(0.01);
  });

  it("still answers, and nothing was thrown that nobody caught", async () => {
    const health = await app.inject({ url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);
    expect(unhandled).toEqual([]);
  });
});

/**
 * What was once a 500: a name given twice reaches a handler as a list (the library takes `q`, `row` and `url` for text, and so does the resolver), and Fastify's
 * HEAD twin of the socket's address calls the handler with no socket.
 */
describe("what was once a 500", () => {
  const asked = async (req: Req) => wrongWith(req, await send(req));

  it("turns away a library search whose q is given twice", async () => {
    const req: Req = { method: "GET", url: "/api/library/search?q=a&q=b", headers: {} };
    expect(await asked(req)).toBeUndefined();
    expect((await send(req)).res?.statusCode).toBe(400);
  });

  it.each(["about", "similar", "seasons", "episodes"])("turns away a library %s whose url is given twice", async (route) => {
    const req: Req = { method: "GET", url: `/api/library/${route}?url=a&url=b&season=1`, headers: {} };
    expect(await asked(req)).toBeUndefined();
    expect((await send(req)).res?.statusCode).toBe(400);
  });

  it.each(["/api/library/more?row=a&row=b&page=2", "/api/resolve?url=https%3A%2F%2Fexample.com%2Fa&url=https%3A%2F%2Fexample.com%2Fb"])("turns away %s, a name given twice", async (url) => {
    const req: Req = { method: "GET", url, headers: {} };
    expect(await asked(req)).toBeUndefined();
    expect((await send(req)).res?.statusCode).toBe(400);
  });

  it("turns away a HEAD request to the WebSocket address", async () => {
    const req: Req = { method: "HEAD", url: "/ws", headers: {} };
    expect(await asked(req)).toBeUndefined();
    expect((await send(req)).res?.statusCode).toBe(404);
  });
});

/* ------------------------------ the WebSocket ------------------------------ */

/** The codes a connection may be closed with: the protocol's (a frame too big or not text, a rule broken) and the server's own (too many messages, a newer page taking over). */
const CLEAN_CLOSES = [1000, 1001, 1002, 1003, 1007, 1008, 1009, 4000];
/** How long a screen waits for a server that has gone quiet. */
const WAIT_MS = 2000;
/** How many frames one connection is given in a go: well under what the hub listens to at once (`FRAME_BURST`), with a hello or two and the PING that ends the go. */
const BATCH = FRAME_BURST - 30;
/** How many fields of each message are made wrong (chosen by the seed). */
const FIELDS = 12;

/** A screen at the far end of `app.injectWS` (in memory, as in `hub.test.ts`): it says what it is told to and keeps what it hears. */
class Peer {
  private static live: Peer[] = [];
  heard: ServerMessage[] = [];
  /** How many frames came that are no message of the protocol. */
  strange = 0;
  closeCode: number | undefined;
  private wakers: Array<() => void> = [];

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) this.heard.push(message);
      else this.strange++;
      this.wake();
    };
    ws.onclose = (event) => {
      this.closeCode = event.code;
      this.wake();
    };
  }

  static async open(): Promise<Peer> {
    const peer = new Peer(await app.injectWS("/ws", { socket: { remoteAddress: nextAddress() } as Socket }));
    Peer.live.push(peer);
    return peer;
  }

  static anyStrange = (): boolean => Peer.live.some((peer) => peer.strange > 0);

  /** Every socket opened since the last time drops, as when a page is closed (a polite close never completes over `injectWS`'s in-memory streams). */
  static dropAll(): void {
    for (const peer of Peer.live.splice(0)) peer.ws.terminate();
  }

  private wake(): void {
    this.wakers.splice(0).forEach((go) => go());
  }

  say(message: unknown): void {
    this.ws.send(toJson(message));
  }

  sendFrame(frame: FrameShape): void {
    this.ws.send(frame.data, { binary: frame.binary });
  }

  pongs(): number {
    return this.heard.filter((message) => message.type === "PONG").length;
  }

  /** Waits until `done()` holds; false if the socket is closed first or `WAIT_MS` pass. */
  async until(done: () => boolean): Promise<boolean> {
    const deadline = Date.now() + WAIT_MS;
    while (!done()) {
      const left = deadline - Date.now();
      if (left <= 0 || this.closeCode !== undefined) return false;
      await new Promise<void>((resume) => {
        const timer = setTimeout(resume, Math.min(left, 25)); // (a look now and then: what `done` asks about need not come as a message)
        this.wakers.push(() => {
          clearTimeout(timer);
          resume();
        });
      });
    }
    return true;
  }

  /** The next message of this type that `accept`s (the ones before it are kept). */
  async next<T extends ServerMessage["type"]>(type: T, accept: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    type Wanted = Extract<ServerMessage, { type: T }>;
    const at = () => this.heard.findIndex((message) => message.type === type && accept(message as Wanted));
    if (!(await this.until(() => at() >= 0))) throw new Error(`setting up the sockets: no ${type} came`);
    return this.heard.splice(at(), 1)[0] as Wanted;
  }
}

/** What a message has to name: the ids that the server made for the screens of a scene. */
interface Ids {
  /** The host TV's own id, which is its secret. */
  deviceId: string;
  controllerId: string;
  /** The host TV, in the phone's list. */
  tvId: string;
  /** The guest, in the party's lists. */
  guestId: string;
  partyCode: string;
  /** The pairing code of a TV that nobody has paired with. */
  spareCode: string;
  /** What a signed-in profile gives a screen to be known by (it is good once). */
  proof: string;
}
/** A TV that has a phone and hosts a party, a TV in that party and the phone. (A fresh one for every go: what one message does to it must not decide what the next is sent to.) */
interface Scene extends Ids {
  host: Peer;
  guest: Peer;
  phone: Peer;
}
const SOMEWHERE: Ids = { deviceId: "tv_x", controllerId: "ctl_x", tvId: "x", guestId: "x", partyCode: "123456", spareCode: "654321", proof: "x" };

async function newScene(): Promise<Scene> {
  const host = await Peer.open();
  host.say({ type: "TV_HELLO", opened: true });
  const welcome = await host.next("TV_WELCOME");
  const phone = await Peer.open();
  phone.say({ type: "CTL_HELLO" });
  await phone.next("CTL_WELCOME");
  phone.say({ type: "PAIR", code: welcome.pairing!.code });
  const paired = await phone.next("CTL_WELCOME", (message) => message.tv !== null);
  phone.say({ type: "OPEN_PARTY" });
  const partyCode = (await phone.next("PARTY", (message) => message.code !== undefined)).code!.code;
  const guest = await Peer.open();
  guest.say({ type: "TV_HELLO" });
  await guest.next("TV_WELCOME");
  guest.say({ type: "TV_PARTY_JOIN", code: partyCode });
  await guest.next("TV_FOLLOWING");
  const roster = await phone.next("PARTY", (message) => message.tvs.length > 0);
  const spare = await Peer.open();
  spare.say({ type: "TV_HELLO" });
  const spareWelcome = await spare.next("TV_WELCOME");
  const proof = (await call("POST", `/api/profiles/${worlds[0]!.profile}/screen`, worlds[0]!)).data?.proof ?? "none";
  return {
    host,
    guest,
    phone,
    deviceId: welcome.deviceId,
    controllerId: paired.controllerId,
    tvId: paired.tvs![0]!.id,
    guestId: roster.tvs[0]!.id,
    partyCode,
    spareCode: spareWelcome.pairing!.code,
    proof,
  };
}

/** Who says it: before any hello, as a TV or a phone that has said hello, and as the screens of the scene (which have a phone, a party, a host). */
interface Role {
  name: string;
  join: (scene: Scene) => Promise<Peer>;
}
const ROLES: Role[] = [
  { name: "a stranger who has said nothing", join: () => Peer.open() },
  {
    name: "a TV that said hello",
    join: async () => {
      const tv = await Peer.open();
      tv.say({ type: "TV_HELLO" });
      await tv.next("TV_WELCOME");
      return tv;
    },
  },
  {
    name: "a phone that said hello",
    join: async () => {
      const phone = await Peer.open();
      phone.say({ type: "CTL_HELLO" });
      await phone.next("CTL_WELCOME");
      return phone;
    },
  },
  { name: "the TV that hosts a party and has a phone", join: async (scene) => scene.host },
  { name: "a TV in that party", join: async (scene) => scene.guest },
  { name: "the phone of that TV", join: async (scene) => scene.phone },
];

/* What each message looks like when it is right. */

const MEDIA = (): Record<string, unknown> => ({
  title: "A film",
  stream: { url: "/fixtures/sample.mp4", type: "mp4", directUrl: "/fixtures/sample.mp4" },
  subtitles: [{ id: 1, label: "English", lang: "en", url: "/fixtures/sample.srt" }],
  series: { season: 1, episode: 2, next: { season: 1, episode: 3, title: "Next", url: TITLE }, episodes: [{ season: 1, episode: 2, title: "Now", url: TITLE }] },
  alternates: [{ label: "Mirror", stream: { url: "/fixtures/sample.mp4", type: "mp4" } }],
  page: TITLE,
  poster: "/fixtures/poster.jpg",
  backdrop: "/fixtures/backdrop.jpg",
  year: 1942,
});
const HINT = () => ({ poster: "/fixtures/poster.jpg", backdrop: "/fixtures/backdrop.jpg", year: 1942 });
const STATE = () => ({
  state: "playing",
  currentTime: 12,
  duration: 100,
  buffering: false,
  bufferedEnd: 30,
  playbackRate: 1,
  stream: "/fixtures/sample.mp4",
  sources: { labels: ["Main", "Mirror"], current: 0 },
  fullscreen: false,
  ended: false,
  upNext: { seconds: 5 },
  captionStyle: DEFAULT_CAPTION_STYLE,
  subtitleDelay: 0,
  subtitleSync: "ready",
  quality: { levels: [{ id: 0, label: "720p", height: 720, bitrate: 1000 }], current: -1, active: 0 },
  subtitles: { tracks: [{ id: 0, label: "English", lang: "en" }], current: 0 },
  audio: { tracks: [{ id: 0, label: "English", lang: "en" }], current: 0 },
});
const COMMANDS = (): Array<Record<string, unknown>> => [
  { type: "LOAD", media: MEDIA(), startAt: 30 },
  { type: "PLAY" },
  { type: "PAUSE" },
  { type: "SEEK", time: 30 },
  { type: "SKIP", seconds: -10 },
  { type: "STOP" },
  { type: "SET_QUALITY", level: 0 },
  { type: "SET_SUBTITLE", track: 0 },
  { type: "SET_CAPTION_STYLE", style: { size: "large", font: "serif" } },
  { type: "SET_SPEED", rate: 1.5 },
  { type: "SET_AUDIO", track: 0 },
  { type: "SET_SOURCE", index: 1 },
  { type: "TOGGLE_FULLSCREEN" },
  { type: "NEXT_EPISODE" },
  { type: "DISMISS_UP_NEXT" },
  { type: "REFRESH_ACCOUNT" },
  { type: "SET_SUBTITLE_DELAY", delay: 0.5 },
  { type: "SET_SUBTITLE_SYNC", on: true },
];

interface Template {
  /** The type of the message in the protocol (a command is told apart by its `name`). */
  type: string;
  name: string;
  /** The message, right in every way. */
  make: (ids: Ids) => Record<string, unknown>;
}

function templates(): Template[] {
  const message = (type: string, more: (ids: Ids) => Record<string, unknown> = () => ({})): Template => ({ type, name: type, make: (ids) => ({ type, ...more(ids) }) });
  const party = (command: Record<string, unknown>): Template => ({ type: "TV_PARTY_CMD", name: `TV_PARTY_CMD ${command.type}`, make: () => ({ type: "TV_PARTY_CMD", command }) });
  return [
    message("TV_HELLO", (ids) => ({ deviceId: ids.deviceId, opened: true })),
    message("TV_STATE", () => ({ state: STATE(), media: MEDIA() })),
    message("TV_NEW_CODE"),
    message("TV_NEXT_EPISODE"),
    message("TV_PLAY_URL", () => ({ url: TITLE, startAt: 5, hint: HINT() })),
    message("TV_UNPAIR"),
    message("TV_CANCEL"),
    message("TV_NAME", () => ({ name: "Kitchen" })),
    message("TV_PROFILE", (ids) => ({ proof: ids.proof })),
    message("TV_PARTY_OPEN"),
    message("TV_PARTY_JOIN", (ids) => ({ code: ids.partyCode })),
    message("TV_PARTY_REMOVE", (ids) => ({ id: ids.guestId })),
    message("TV_PARTY_CLOSE"),
    message("TV_PARTY_ADMIN", (ids) => ({ id: ids.guestId, admin: true })),
    party({ type: "SEEK", time: 30 }),
    party({ type: "SKIP", seconds: -10 }),
    party({ type: "PAUSE" }),
    message("CTL_HELLO", (ids) => ({ controllerId: ids.controllerId })),
    message("PAIR", (ids) => ({ code: ids.spareCode })),
    ...COMMANDS().map((command): Template => ({ type: "CMD", name: `CMD ${command.type}`, make: () => ({ type: "CMD", command }) })),
    message("PLAY_URL", () => ({ url: TITLE, startAt: 5, hint: HINT() })),
    message("UNPAIR", (ids) => ({ id: ids.tvId })),
    message("SWITCH_TV", (ids) => ({ id: ids.tvId })),
    message("NAME_TV", () => ({ name: "Den" })),
    message("ADD_TV", (ids) => ({ code: ids.spareCode })),
    message("REMOVE_TV", (ids) => ({ id: ids.guestId })),
    message("OPEN_PARTY"),
    message("END_PARTY"),
    message("PARTY_ADMIN", (ids) => ({ id: ids.guestId, admin: true })),
    message("PING", () => ({ rtt: 12 })),
  ];
}

/* What is said: a frame that is made when the scene is there to name its ids. */

type Maker = (ids: Ids) => FrameShape;
const said = (name: string, message: unknown): FrameShape => ({ name, data: toJson(message), binary: false });
const small = (each: Named<unknown>) => toJson(each.value).length < 20_000;

/** A message as it should be, then each of some of its fields left out and made every kind of wrong (a frame past the size limit is tried by itself, below). */
function makersOf(template: Template, pool: Array<Named<unknown>>): Maker[] {
  const rand = seeded(hashed(`${SEED}:ws:${template.name}`));
  const values = [...pool.slice(0, CORE_VALUES), ...sample(rand, pool.slice(CORE_VALUES).filter(small), 3)];
  const makers: Maker[] = [(ids) => said(`${template.name} as it should be`, template.make(ids))];
  for (const place of sample(rand, pathsIn(template.make(SOMEWHERE)), FIELDS)) {
    const where = place.join(".");
    makers.push((ids) => said(`${template.name}: the field ${where} left out`, replaceAt(template.make(ids), place, DROP)));
    for (const each of values) makers.push((ids) => said(`${template.name}: the field ${where} as ${each.name}`, replaceAt(template.make(ids), place, each.value)));
  }
  return makers;
}

/** Messages whose type is none of the client's: the server's own words, names from the prototype, the client's own with a letter changed. */
function strangeTypes(): Maker[] {
  const own = ServerMessageSchema.options.map((option) => option.shape.type.value as string);
  const names = [...own, "ping", "Ping", "PING ", " PING", "PING\u0000", "TV_HELLO2", "CMD_", "__proto__", "constructor", "toString", "hasOwnProperty", "", "*"];
  return names.flatMap((name) => [
    (): FrameShape => said(`the type ${JSON.stringify(name)}`, { type: name }),
    (): FrameShape => said(`the type ${JSON.stringify(name)} with a command`, { type: name, command: { type: "PLAY" } }),
  ]);
}

/** Frames that are no message at all, and (each by itself, for the socket is closed by it) the ones that the library closes the connection for. */
function frameGroups(): Array<{ name: string; makers: Maker[] }> {
  const shapes = frameShapes(seeded(hashed(`${SEED}:frames`)));
  return [
    { name: "frames that are no message", makers: shapes.filter((shape) => !shape.closes).map((shape): Maker => () => shape) },
    ...shapes.filter((shape) => shape.closes).map((shape) => ({ name: shape.name, makers: [(): FrameShape => shape] })),
  ];
}

/* The go: a scene, the frames said by one of its screens, a PING to know they were all taken in. */

const isPing = (frame: FrameShape) => !frame.binary && typeof frame.data === "string" && parseClientMessage(frame.data)?.type === "PING";
const socketTotals = { batches: 0, frames: 0, closedEarly: 0 };

/** What is wrong after `makers` were said by `role`, in a few words, or nothing. */
async function runBatch(role: Role, makers: Maker[]): Promise<string | undefined> {
  const thrown = unhandled.length;
  socketTotals.batches++;
  try {
    const scene = await newScene();
    const sender = await role.join(scene);
    const frames = makers.map((make) => make(scene));
    socketTotals.frames += frames.length;
    const closing = frames.find((frame) => frame.closes);
    const failed = () => unhandled.length > thrown;
    let wrong: string | undefined;
    try {
      for (const frame of frames) sender.sendFrame(frame);
      if (!closing) sender.say({ type: "PING" });
      if (closing) {
        await sender.until(() => failed() || sender.closeCode !== undefined);
        if (sender.closeCode !== closing.closes) wrong = `was not closed with ${closing.closes} by "${closing.name}" (${sender.closeCode ?? "it stayed open"})`;
      } else {
        const answers = frames.filter(isPing).length + 1;
        if (!(await sender.until(() => failed() || sender.pongs() >= answers))) {
          if (sender.closeCode === undefined) wrong = `stopped answering (no PONG within ${WAIT_MS} ms)`;
          else if (!CLEAN_CLOSES.includes(sender.closeCode)) wrong = `was closed with code ${sender.closeCode}`;
          else socketTotals.closedEarly++;
        }
      }
    } catch (error) {
      wrong = `threw while being spoken to: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (failed()) return `threw something nobody caught (${unhandled[thrown]})`;
    return wrong ?? (Peer.anyStrange() ? "was answered with something that is no message of the protocol" : undefined);
  } finally {
    Peer.dropAll();
  }
}

/** A go that went wrong, frame by frame: which of them do it alone. */
async function whichOnes(role: Role, group: string, makers: Maker[], what: string): Promise<string[]> {
  const found: string[] = [];
  for (const make of makers) {
    const alone = await runBatch(role, [make]);
    if (alone) found.push(`[${role.name}] ${make(SOMEWHERE).name}: ${alone}`);
    if (found.length >= 3) break;
  }
  return found.length ? found : [`[${role.name}] ${group}: a go of ${makers.length} frames ${what}, and none of them did alone`];
}

async function sweepSockets(): Promise<string[]> {
  const problems: string[] = [];
  const pool = awkwardValues();
  const groups = [...templates().map((template) => ({ name: template.name, makers: makersOf(template, pool) })), { name: "types that are none of the client's", makers: strangeTypes() }, ...frameGroups()];
  for (const role of ROLES) {
    for (const group of groups) {
      for (let from = 0; from < group.makers.length; from += BATCH) {
        const makers = group.makers.slice(from, from + BATCH);
        const what = await runBatch(role, makers);
        if (!what) continue;
        problems.push(...(await whichOnes(role, group.name, makers, what)));
        if (problems.length >= 10) return problems;
      }
    }
    const health = await app.inject({ url: "/api/health" });
    if (health.statusCode !== 200) problems.push(`[${role.name}] /api/health answered ${health.statusCode} afterwards`);
  }
  return problems;
}

describe("the WebSocket turns away what it should not take", () => {
  it("is sent every kind of message that the protocol has", () => {
    const made = templates();
    const missing = [
      ...ClientMessageSchema.options.map((option) => option.shape.type.value as string).filter((type) => !made.some((each) => each.type === type)),
      ...CommandSchema.options.map((option) => `CMD ${option.shape.type.value}`).filter((name) => !made.some((each) => each.name === name)),
    ];
    expect(missing).toEqual([]);
    // (A message that is wrong from the start would have its fields made wrong for nothing.)
    expect(made.filter((each) => parseClientMessage(toJson(each.make(SOMEWHERE))) === null).map((each) => each.name)).toEqual([]);
  });

  it("takes in every message made wrong, from a stranger, a TV and a phone, and still answers", async () => {
    expect(shown(await sweepSockets())).toEqual([]);
  }, 60_000);

  it("was not cut short by closing the connection", () => {
    expect(socketTotals.frames).toBeGreaterThan(8000);
    expect(socketTotals.closedEarly / socketTotals.batches).toBeLessThan(0.02);
  });

  it("still answers, and nothing was thrown that nobody caught", async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const health = await app.inject({ url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(unhandled).toEqual([]);
  });
});

/* ------------------------------ the stream relay ------------------------------ */

describe("the stream relay turns away what it should not take", () => {
  it("answers a request that is wrong with a refusal, and the one that is right with the video", async () => {
    const key = "relay-key-of-the-sweep".padEnd(32, "-");
    const relay = buildStreamRelay({ key, isAllowedAddress: () => true });
    await relay.ready();
    try {
      const rand = seeded(hashed(`${SEED}:relay`));
      const link: RelayLink = { url: `${origin}/video.mp4`, referer: `${origin}/`, expires: Date.now() + 60_000, hostToken: false };
      const signed = (changes: Partial<RelayLink> = {}) => signedRelayUrl("http://relay/api/proxy", { ...link, ...changes }, key).slice("http://relay".length);
      const good = signed();
      const parts = [...new URL(good, "http://relay").searchParams].map(([name, value]): [string, string] => [name, encodeURIComponent(value)]);
      const withParts = (pairs: Array<[string, string]>) => `/api/proxy?${pairs.map(([name, value]) => `${name}=${value}`).join("&")}`;
      const asked: Array<[string, Req]> = [];
      const ask = (label: string, url: string, more: Partial<Req> = {}) => void asked.push([label, { method: "GET", url, headers: {}, ...more }]);

      // The link, one part at a time: left out, given twice, made junk (the signature is wrong for these, so they are turned away before anything is fetched).
      for (const [name] of parts) {
        ask(`${name} left out`, withParts(parts.filter(([each]) => each !== name)));
        ask(`${name} given twice`, withParts([...parts, [name, "x"]]));
        for (const junk of [...QUERY_JUNK.slice(0, 8), ...sample(rand, QUERY_JUNK.slice(8), 4)]) ask(`${name} as ${junk.name}`, withParts(parts.map(([each, value]): [string, string] => [each, each === name ? junk.value : value])));
      }
      // Links signed as they should be, to what is junk or is not a video, and signed to run out at a time that makes no sense.
      const places = ["", "not a link", "http://", "http://[::1", "http://127.0.0.1:99999/", "file:///nothing", "javascript:0", "data:text/plain,hello", `${origin}/${"p".repeat(3000)}`];
      for (const place of [...places, `${origin}/missing`, `${origin}/list.m3u8`, `${origin}/sub.srt`, `${origin}/page.html`, `${origin.replace("://", "://name:secret@")}/video.mp4`]) {
        ask(`a link to ${JSON.stringify(place.slice(0, 40))}`, signed({ url: place }));
        ask(`a referer of ${JSON.stringify(place.slice(0, 40))}`, signed({ referer: place }));
      }
      for (const expires of [0, -1, Date.now() - 1, Date.now() + 25 * 3600_000, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) ask(`a link to run out at ${expires}`, signed({ expires }));
      // Other methods, a body, other places, junk in the address, headers.
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) ask(`the method ${method}`, good, { method, headers: { "content-type": "application/json" }, payload: "{}" });
      ask("OPTIONS", "/api/proxy", { method: "OPTIONS" });
      ask("HEAD", good, { method: "HEAD" });
      ask("a body on a GET", good, { headers: { "content-type": "application/json" }, payload: "{}" });
      ask("/health", "/health");
      ask("HEAD /health", "/health", { method: "HEAD" });
      ask("POST /health", "/health", { method: "POST", headers: { "content-type": "application/json" }, payload: "{}" });
      for (const each of PATH_JUNK) ask(`the path ${each.name}`, `/${each.value}`);
      for (const each of sample(rand, QUERY_STRINGS, 4)) ask(`the query string with ${each.name}`, `${good}&${each.value}`);
      for (const shape of sample(rand, headerShapes(), 10)) {
        ask(`the headers: ${shape.name}`, good, { headers: shape.headers });
        ask(`the headers on /health: ${shape.name}`, "/health", { headers: shape.headers });
      }

      const problems: string[] = [];
      for (const [label, req] of asked) {
        const outcome = await send(req, relay);
        const what = wrongWith(req, outcome);
        if (what) problems.push(`${req.method} ${label}: ${what}`);
        if (outcome.hung) break;
      }
      expect(shown(problems)).toEqual([]);
      expect(asked.length).toBeGreaterThan(150);

      // (And the right link is not turned away with the rest.)
      const through = await relay.inject({ url: good });
      expect(through.statusCode).toBe(200);
      expect(through.rawPayload.length).toBe(2048);
    } finally {
      await relay.close();
    }
  });
});
