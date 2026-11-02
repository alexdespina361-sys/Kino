import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { friendChoices } from "../../shared";
import { CHAT_SENDS_PER_MINUTE, CHAT_TEXT_MAX, type ChatThread } from "../../shared/chat";
import { chatReporter } from "../feedback/chatReport";
import { FeedbackStore, MemoryFeedbackBackend } from "../feedback/store";
import { ChatBook } from "./chat";
import { chatRoutes, type ChatReport, type ChatReporter } from "./chatRoutes";
import { MemoryPersistence } from "./persistence";
import { COOKIE, readCookie } from "./routes";
import { AccountStore } from "./store";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** The routes on a bare server: the helpers the account routes give them are made here from the store, the way those make them. */
async function start({ report = true, feedback }: { report?: boolean; feedback?: FeedbackStore } = {}) {
  const clock = { now: 1_700_000_000_000 };
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  const quiet = new Set<string>(); // (profiles that turned "Friends can message me" off)
  const on = (id: string) => friendChoices(store.settingsOf(id)).friends;
  const chat = new ChatBook({
    now: () => clock.now,
    touch: () => {},
    drop: () => {},
    areFriends: (a, b) => store.friends.areFriends(a, b),
    on,
    takes: (id) => on(id) && !quiet.has(id),
  });
  const reports: ChatReport[] = [];
  const teamSide = { full: false, tooMany: false }; // (while one is, the team's side takes no report: it is full, or the account has as many open as it may)
  const stub: ChatReporter = async (made) => (teamSide.full ? "full" : teamSide.tooMany ? "too_many_open" : void reports.push(made));
  const reporter = feedback ? chatReporter(feedback) : stub; // (the team's side itself, or what stands in for it)
  const app = Fastify();
  apps.push(app);
  chatRoutes(
    app,
    {
      store,
      authenticate: (request: FastifyRequest) => {
        const token = readCookie(request.headers.cookie, COOKIE);
        const session = token ? store.getSession(token) : undefined;
        return session ? { accountId: session.accountId } : undefined;
      },
      signedOut: (reply: FastifyReply) => reply.code(401).send({ error: "signed_out" }),
      tooMany: (reply: FastifyReply, waitMs: number) => reply.header("Retry-After", Math.ceil(waitMs / 1000)).code(429).send({ error: "rate_limited", retryAfter: Math.ceil(waitMs / 1000) }),
      invalid: (reply: FastifyReply) => reply.code(400).send({ error: "invalid_request" }),
      refused: (reply: FastifyReply, error) => reply.code(error === "not_found" ? 404 : 409).send({ error }),
    },
    { chat, ...(report ? { report: reporter } : {}) },
  );
  await app.ready();
  return { app, store, chat, clock, quiet, reports, teamSide };
}
type World = Awaited<ReturnType<typeof start>>;

interface Person {
  id: string;
  accountId: string;
  cookie: string;
  call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown): Promise<LightMyRequestResponse & { data: any }>;
  /** The routes of the chat with this friend. */
  chatWith(friend: Person, path?: string): string;
}

function person(world: World, login: string, { friends = true }: { friends?: boolean } = {}): Person {
  const account = world.store.createAccount(login, "x");
  if (!account.ok) throw new Error("could not make the account");
  const profile = account.value.profiles[0]!;
  const { token } = world.store.createSession(account.value.id, "browser", "test");
  if (friends) world.store.sync(profile.id, { since: 0, settings: [{ key: "friends", at: world.clock.now, value: true }] });
  const me: Person = {
    id: profile.id,
    accountId: account.value.id,
    cookie: `${COOKIE}=${token}`,
    async call(method, url, payload) {
      const response = await world.app.inject({ method, url, headers: { cookie: me.cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
      let data: unknown;
      try {
        data = response.json();
      } catch {
        data = undefined;
      }
      return Object.assign(response, { data });
    },
    chatWith: (friend, path = "") => `/api/profiles/${profile.id}/friends/${friend.id}/chat${path}`,
  };
  return me;
}

function befriend(world: World, a: Person, b: Person) {
  const { code } = world.store.friends.createInvite(a.id);
  expect(world.store.friends.redeem(b.id, code).ok).toBe(true);
}

/** Alex and Sam, friends with friends on. */
async function friends(options?: { report?: boolean; feedback?: FeedbackStore }) {
  const world = await start(options);
  const alex = person(world, "alex");
  const sam = person(world, "sam");
  befriend(world, alex, sam);
  return { ...world, alex, sam };
}

const write = (from: Person, to: Person, text: string) => from.call("POST", from.chatWith(to), { text });

describe("who is asking", () => {
  it("is somebody who is signed in, as a profile of theirs that has friends on, about a friend", async () => {
    const world = await friends();
    const { alex, sam } = world;
    const stranger = person(world, "stranger");
    const off = person(world, "off", { friends: false });

    const signedOut = await world.app.inject({ method: "GET", url: alex.chatWith(sam) });
    expect(signedOut.statusCode).toBe(401);
    // (a profile that is not theirs)
    expect((await stranger.call("GET", alex.chatWith(sam))).statusCode).toBe(404);
    expect((await stranger.call("POST", alex.chatWith(sam), { text: "hi" })).statusCode).toBe(404);
    expect((await off.call("GET", off.chatWith(alex))).data).toEqual({ error: "friends_off" });
    expect((await off.call("POST", off.chatWith(alex), { text: "hi" })).statusCode).toBe(403);
    // (somebody who is not a friend)
    expect((await stranger.call("GET", stranger.chatWith(alex))).data).toEqual({ error: "not_friends" });
    expect((await write(stranger, alex, "hi")).statusCode).toBe(404);
    expect((await alex.call("GET", alex.chatWith(sam))).statusCode).toBe(200);
  });
});

describe("writing and reading", () => {
  it("is a message to a friend, that the friend sees as theirs to read, and that the answer to writing it already holds", async () => {
    const { alex, sam, clock } = await friends();
    const sent = await write(alex, sam, "  hello\n there ");
    expect(sent.statusCode).toBe(201);
    expect(sent.data).toMatchObject({ open: true, muted: false, lines: [{ mine: true, text: "hello there", at: clock.now }] });

    const seen = await sam.call("GET", sam.chatWith(alex));
    expect(seen.statusCode).toBe(200);
    expect(seen.data).toEqual({ rev: sent.data.rev, open: true, muted: false, lines: [{ id: sent.data.lines[0].id, at: clock.now, mine: false, text: "hello there" }] });
  });

  it("is answered with no messages when nothing changed since the revision the page has, and with them when something did", async () => {
    const { alex, sam, clock } = await friends();
    const first = (await write(alex, sam, "one")).data as ChatThread;
    const quiet = await sam.call("GET", `${sam.chatWith(alex)}?since=${first.rev}`);
    expect(quiet.data).toEqual({ rev: first.rev, open: true, muted: false });
    clock.now += 10;
    await write(alex, sam, "two");
    const news = await sam.call("GET", `${sam.chatWith(alex)}?since=${first.rev}`);
    expect(news.data.lines.map((line: { text: string }) => line.text)).toEqual(["one", "two"]);
    expect(news.data.rev).toBeGreaterThan(first.rev);
    // (a revision it makes up, or one that is not a number, is not believed)
    expect((await sam.call("GET", `${sam.chatWith(alex)}?since=5`)).data.lines).toHaveLength(2);
    expect((await sam.call("GET", `${sam.chatWith(alex)}?since=abc`)).data.lines).toHaveLength(2);
    expect((await sam.call("GET", `${sam.chatWith(alex)}?since=`)).data.lines).toHaveLength(2);
  });

  it("is a chat with nothing in it before anything was written", async () => {
    const { alex, sam } = await friends();
    expect((await alex.call("GET", alex.chatWith(sam))).data).toEqual({ rev: 0, open: true, muted: false, lines: [] });
    expect((await alex.call("GET", `${alex.chatWith(sam)}?since=0`)).data).toEqual({ rev: 0, open: true, muted: false });
  });

  it("is only text: what looks like a page is sent back as it was written, as data", async () => {
    const { alex, sam } = await friends();
    const sent = await write(alex, sam, '<img src=x onerror="alert(1)"> https://example.com/?a=1&b=2');
    expect(sent.headers["content-type"]).toContain("application/json");
    expect(sent.data.lines[0].text).toBe('<img src=x onerror="alert(1)"> https://example.com/?a=1&b=2');
  });

  it("is a request that is a message: nothing, or too much, or not a message at all, is turned away with the reason", async () => {
    const { alex, sam } = await friends();
    expect((await write(alex, sam, "   ")).data).toEqual({ error: "empty" });
    expect((await write(alex, sam, "x".repeat(CHAT_TEXT_MAX + 1))).data).toEqual({ error: "too_long" });
    expect((await write(alex, sam, "x".repeat(CHAT_TEXT_MAX + 1))).statusCode).toBe(400);
    expect((await alex.call("POST", alex.chatWith(sam), {})).data).toEqual({ error: "invalid_request" });
    expect((await alex.call("POST", alex.chatWith(sam), { text: 5 })).statusCode).toBe(400);
    expect((await alex.call("POST", alex.chatWith(sam), { text: "x".repeat(CHAT_TEXT_MAX * 4 + 1) })).statusCode).toBe(400);
    expect((await alex.call("GET", alex.chatWith(sam))).data.lines).toEqual([]);
  });

  it("is refused for a friend who does not take messages, with a plain answer, while the chat can still be read", async () => {
    const { alex, sam, quiet } = await friends();
    await write(alex, sam, "hi");
    quiet.add(sam.id);
    const refused = await write(alex, sam, "are you there?");
    expect(refused.statusCode).toBe(403);
    expect(refused.data).toEqual({ error: "chat_off" });
    const read = await alex.call("GET", alex.chatWith(sam));
    expect(read.data).toMatchObject({ open: false });
    expect(read.data.lines).toHaveLength(1);
    quiet.delete(sam.id);
    expect((await write(alex, sam, "are you there?")).statusCode).toBe(201);
  });

  it("is slowed to twenty a minute for one sender, and says how long to wait", async () => {
    const { alex, sam, clock } = await friends();
    for (let i = 0; i < CHAT_SENDS_PER_MINUTE; i++) expect((await write(alex, sam, `message ${i}`)).statusCode).toBe(201);
    const slow = await write(alex, sam, "one too many");
    expect(slow.statusCode).toBe(429);
    expect(slow.data).toMatchObject({ error: "rate_limited", retryAfter: 60 });
    expect(slow.headers["retry-after"]).toBe("60");
    expect((await write(sam, alex, "my turn")).statusCode).toBe(201);
    clock.now += 60_000;
    expect((await write(alex, sam, "again")).statusCode).toBe(201);
  });
});

describe("what has been looked at", () => {
  it("is everything that a page asked for: reading the chat clears what waited, and a poll that finds no news does not bring it back", async () => {
    const { alex, sam, chat, clock } = await friends();
    await write(alex, sam, "one");
    await write(alex, sam, "two");
    expect(chat.unread(sam.id)).toEqual([{ friend: alex.id, count: 2, at: clock.now }]);
    const seen = await sam.call("GET", sam.chatWith(alex));
    expect(chat.unread(sam.id)).toEqual([]);
    await sam.call("GET", `${sam.chatWith(alex)}?since=${seen.data.rev}`);
    expect(chat.unread(sam.id)).toEqual([]);
    clock.now += 10;
    await write(alex, sam, "three");
    expect(chat.unread(sam.id)).toHaveLength(1);
    expect(chat.unread(alex.id)).toEqual([]); // (what you wrote yourself does not wait)
  });
});

describe("taking a message back", () => {
  it("is for the writer, who is answered with the chat as it is then, and it is gone for the friend", async () => {
    const { alex, sam } = await friends();
    const first = (await write(alex, sam, "oops")).data as ChatThread;
    await write(sam, alex, "fine");
    const id = first.lines![0]!.id;
    const taken = await alex.call("DELETE", alex.chatWith(sam, `/${id}`));
    expect(taken.statusCode).toBe(200);
    expect(taken.data.lines.map((line: { text: string }) => line.text)).toEqual(["fine"]);
    expect((await sam.call("GET", sam.chatWith(alex))).data.lines.map((line: { text: string }) => line.text)).toEqual(["fine"]);
    expect((await alex.call("DELETE", alex.chatWith(sam, `/${id}`))).data).toEqual({ error: "gone" });
    // (the friend's message is not Alex's to take back)
    const theirs = taken.data.lines[0].id;
    expect((await alex.call("DELETE", alex.chatWith(sam, `/${theirs}`))).statusCode).toBe(404);
    expect((await alex.call("DELETE", alex.chatWith(sam, "/abc"))).statusCode).toBe(404);
  });

  it("changes the revision, so a page that has the message is told", async () => {
    const { alex, sam, clock } = await friends();
    const first = (await write(alex, sam, "oops")).data as ChatThread;
    await write(sam, alex, "fine");
    const before = (await sam.call("GET", sam.chatWith(alex))).data as ChatThread;
    clock.now += 10;
    await alex.call("DELETE", alex.chatWith(sam, `/${first.lines![0]!.id}`));
    const after = await sam.call("GET", `${sam.chatWith(alex)}?since=${before.rev}`);
    expect(after.data.lines.map((line: { text: string }) => line.text)).toEqual(["fine"]);
  });
});

describe("muting", () => {
  it("is the profile's own choice about a friend, that the friend does not see, and that stops what waits from being counted", async () => {
    const { alex, sam, chat } = await friends();
    expect((await alex.call("PUT", alex.chatWith(sam, "/mute"), { muted: true })).data).toEqual({ muted: true });
    await write(sam, alex, "hello?");
    expect(chat.unread(alex.id)).toEqual([]);
    expect((await alex.call("GET", alex.chatWith(sam))).data).toMatchObject({ muted: true });
    expect((await sam.call("GET", sam.chatWith(alex))).data).toMatchObject({ muted: false });
    expect((await write(sam, alex, "still here")).statusCode).toBe(201);
    expect((await alex.call("PUT", alex.chatWith(sam, "/mute"), { muted: false })).data).toEqual({ muted: false });
    expect((await alex.call("GET", alex.chatWith(sam))).data).toMatchObject({ muted: false });
  });

  it("asks for true or false, and for a friend", async () => {
    const world = await friends();
    const { alex, sam } = world;
    const stranger = person(world, "stranger");
    expect((await alex.call("PUT", alex.chatWith(sam, "/mute"), { muted: "yes" })).statusCode).toBe(400);
    expect((await alex.call("PUT", alex.chatWith(sam, "/mute"), {})).statusCode).toBe(400);
    expect((await stranger.call("PUT", stranger.chatWith(alex, "/mute"), { muted: true })).data).toEqual({ error: "not_friends" });
  });
});

describe("reporting a chat", () => {
  it("shows what would be sent: the last messages, as the reporter sees them, and the revision they are of", async () => {
    const { alex, sam } = await friends();
    await write(sam, alex, "something awful");
    const sent = (await write(alex, sam, "stop it")).data as ChatThread;
    const preview = await alex.call("GET", alex.chatWith(sam, "/report"));
    expect(preview.statusCode).toBe(200);
    expect(preview.data).toEqual({ rev: sent.rev, lines: sent.lines });
    expect(preview.data.lines.map((line: { mine: boolean }) => line.mine)).toEqual([false, true]);
  });

  it("sends it to the team once the reporter says yes to what was shown, with who is who, and nobody else is told", async () => {
    const { alex, sam, reports, clock, chat } = await friends();
    await write(sam, alex, "something awful");
    clock.now += 1000;
    const sent = (await write(alex, sam, "stop it")).data as ChatThread;
    const done = await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev });
    expect(done.statusCode).toBe(204);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reporter: { id: alex.id, label: "Alex#1" },
      about: { id: sam.id, label: "Sam#1" },
      account: alex.accountId,
      at: clock.now,
      lines: [
        { from: "about", text: "something awful" },
        { from: "reporter", text: "stop it" },
      ],
    });
    // (the chat is as it was: the friend is not told, and nothing was muted or ended)
    expect((await sam.call("GET", sam.chatWith(alex))).data).toMatchObject({ open: true, muted: false });
    expect(chat.unread(sam.id)).toEqual([]);
  });

  it("is not sent when the chat is not as it was shown: the page is told to show it again", async () => {
    const { alex, sam, reports, clock } = await friends();
    const shown = (await write(sam, alex, "one")).data as ChatThread;
    clock.now += 10;
    await write(sam, alex, "two"); // (arrived while the reporter was looking)
    const refused = await alex.call("POST", alex.chatWith(sam, "/report"), { rev: shown.rev });
    expect(refused.statusCode).toBe(409);
    expect(refused.data).toEqual({ error: "changed" });
    expect(reports).toEqual([]);
    // (a message taken back in the meantime is a change too)
    const fresh = (await alex.call("GET", alex.chatWith(sam, "/report"))).data;
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: fresh.rev })).statusCode).toBe(204);
  });

  it("has nothing to send for a chat with nothing in it, and asks for the revision", async () => {
    const { alex, sam, reports } = await friends();
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: 0 })).statusCode).toBe(404);
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), {})).statusCode).toBe(400);
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: "x" })).statusCode).toBe(400);
    expect(reports).toEqual([]);
  });

  it("is a few an hour for an account", async () => {
    const { alex, sam, reports } = await friends();
    const sent = (await write(sam, alex, "hello")).data as ChatThread;
    for (let i = 0; i < 5; i++) expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev })).statusCode).toBe(204);
    const slow = await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev });
    expect(slow.statusCode).toBe(429);
    expect(slow.data.error).toBe("rate_limited");
    expect(reports).toHaveLength(5);
  });

  it("does not use up an account's few an hour on a team's side that is full: a report that was not kept is not one it sent", async () => {
    const { alex, sam, reports, teamSide } = await friends();
    const sent = (await write(sam, alex, "hello")).data as ChatThread;
    teamSide.full = true;
    // (More tries than the hour allows.)
    for (let i = 0; i < 8; i++) {
      const refused = await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev });
      expect([refused.statusCode, refused.data]).toEqual([503, { error: "full" }]);
    }
    // Once there is room all of the few are there still.
    teamSide.full = false;
    for (let i = 0; i < 5; i++) expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev })).statusCode).toBe(204);
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev })).statusCode).toBe(429);
    expect(reports).toHaveLength(5);
  });

  it("tells an account that has as many reports open as it may so, with a 429 that waiting will not change, and does not use up its few an hour for it", async () => {
    const { alex, sam, reports, teamSide } = await friends();
    const sent = (await write(sam, alex, "hello")).data as ChatThread;
    teamSide.tooMany = true;
    for (let i = 0; i < 8; i++) {
      const refused = await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev });
      expect([refused.statusCode, refused.headers["retry-after"], refused.data]).toEqual([429, "3600", { error: "too_many_open" }]);
    }
    teamSide.tooMany = false;
    for (let i = 0; i < 5; i++) expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev })).statusCode).toBe(204);
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev })).data.error).toBe("rate_limited");
    expect(reports).toHaveLength(5);
  });

  it("is a number an hour for the whole site, whoever sends them, so that accounts cannot send faster than the team reads; the hour is an hour", async () => {
    let now = 1_700_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now); // (before the routes are made: their limits keep the time of the call that makes them)
    try {
      const world = await start();
      const sam = person(world, "sam");
      const reporters = Array.from({ length: 13 }, (_, i) => person(world, `reporter${i}`));
      const revs: number[] = [];
      for (const each of reporters) {
        befriend(world, each, sam);
        revs.push(((await write(each, sam, "hi")).data as ChatThread).rev);
      }
      const report = (i: number) => reporters[i]!.call("POST", reporters[i]!.chatWith(sam, "/report"), { rev: revs[i] });
      // Twelve accounts send all of their five, which is all of the site's sixty.
      for (let i = 0; i < 12; i++) for (let n = 0; n < 5; n++) expect((await report(i)).statusCode, `account ${i}, report ${n}`).toBe(204);
      expect(world.reports).toHaveLength(60);
      // The thirteenth has sent none and is turned away all the same.
      const turned = await report(12);
      expect([turned.statusCode, turned.data.error]).toEqual([429, "rate_limited"]);
      now += 30 * 60_000;
      expect((await report(12)).statusCode).toBe(429);
      now += 30 * 60_000 + 1;
      expect((await report(12)).statusCode).toBe(204);
      expect(world.reports).toHaveLength(61);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not use up the site's sixty an hour on reports that were not kept", async () => {
    const world = await start();
    const sam = person(world, "sam");
    const reporters = Array.from({ length: 13 }, (_, i) => person(world, `reporter${i}`));
    const revs: number[] = [];
    for (const each of reporters) {
      befriend(world, each, sam);
      revs.push(((await write(each, sam, "hi")).data as ChatThread).rev);
    }
    const report = (i: number) => reporters[i]!.call("POST", reporters[i]!.chatWith(sam, "/report"), { rev: revs[i] });
    // Reports that the team's side turns away, from twelve accounts and from the full store, many times over...
    for (const refusal of ["full", "tooMany"] as const) {
      world.teamSide[refusal] = true;
      for (let i = 0; i < 12; i++) for (let n = 0; n < 5; n++) expect((await report(i)).statusCode).toBe(refusal === "full" ? 503 : 429);
      world.teamSide[refusal] = false;
    }
    // ...leave all of the sixty to the ones that are kept.
    for (let i = 0; i < 12; i++) for (let n = 0; n < 5; n++) expect((await report(i)).statusCode, `account ${i}, report ${n}`).toBe(204);
    expect(world.reports).toHaveLength(60);
    expect((await report(12)).statusCode).toBe(429);
  });

  it("keeps three of an account's reports open at the team's side, and the fourth is turned away until the team has closed one; another account has its own three", async () => {
    const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
    const world = await friends({ feedback });
    const { alex, sam } = world;
    const sent = (await write(sam, alex, "hello")).data as ChatThread;
    const report = () => alex.call("POST", alex.chatWith(sam, "/report"), { rev: sent.rev });
    for (let i = 0; i < 3; i++) expect((await report()).statusCode).toBe(204);
    const turned = await report();
    expect([turned.statusCode, turned.headers["retry-after"], turned.data]).toEqual([429, "3600", { error: "too_many_open" }]);
    expect(feedback.size).toBe(3);
    const bob = person(world, "bob");
    befriend(world, bob, sam);
    const heard = (await write(bob, sam, "hi")).data as ChatThread;
    expect((await bob.call("POST", bob.chatWith(sam, "/report"), { rev: heard.rev })).statusCode).toBe(204);
    expect(feedback.size).toBe(4);
    await feedback.update("2", (draft) => void (draft.status = "done"));
    expect((await report()).statusCode).toBe(204);
    expect((await report()).data).toEqual({ error: "too_many_open" });
    expect(feedback.size).toBe(5);
  });

  it("is not there on a server that has nowhere to send it", async () => {
    const { alex, sam } = await friends({ report: false });
    await write(sam, alex, "hello");
    expect((await alex.call("GET", alex.chatWith(sam, "/report"))).statusCode).toBe(404);
    expect((await alex.call("POST", alex.chatWith(sam, "/report"), { rev: 1 })).statusCode).toBe(404);
  });

  it("is for a friend only", async () => {
    const world = await friends();
    const stranger = person(world, "stranger");
    const refused = await stranger.call("GET", stranger.chatWith(world.alex, "/report"));
    expect(refused.data).toEqual({ error: "not_friends" });
  });
});
