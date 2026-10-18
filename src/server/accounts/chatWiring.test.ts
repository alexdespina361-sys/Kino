import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_KEEP_MS, type ChatThread, type FriendsState } from "../../shared";
import { buildApp } from "../app";
import { FeedbackStore, MemoryFeedbackBackend } from "../feedback/store";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";

/**
 * The chat as the server puts it together: the switch "Friends can message me", what waits in the friends' answer, the end of a chat with its
 * friendship or its profile, the report that goes to the team, and what survives a restart. (The rules of the chat itself are in chat.test.ts
 * and chatRoutes.test.ts, on their own.)
 */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const cheap = { N: 1024, r: 8, p: 1 } as const;
const clock = { now: Date.now() };

async function start(persistence = new MemoryPersistence()) {
  const store = await AccountStore.open({ persistence, flushMs: 0, now: () => clock.now });
  const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
  const app = await buildApp({ accounts: store, feedback, passwordCost: cheap });
  apps.push(app);
  return { app, store, feedback, persistence };
}

/** One browser: it keeps its cookie, and sends it back. */
class Client {
  cookie = "";
  constructor(private readonly app: FastifyInstance) {}

  async call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown): Promise<LightMyRequestResponse & { data: any }> {
    const response = await this.app.inject({ method, url, headers: this.cookie ? { cookie: this.cookie } : {}, ...(payload === undefined ? {} : { payload: payload as object }) });
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
    return Object.assign(response, { data });
  }
}

interface Person {
  client: Client;
  id: string;
  choose(choices: Record<string, boolean>): Promise<void>;
  state(): Promise<FriendsState>;
  /** The routes of the chat with this friend. */
  chat(friend: Person, path?: string): string;
  say(friend: Person, text: string): Promise<LightMyRequestResponse & { data: any }>;
  open(friend: Person): Promise<ChatThread>;
}

async function person(app: FastifyInstance, login: string): Promise<Person> {
  const client = new Client(app);
  const registered = await client.call("POST", "/api/auth/register", { email: login, password: "x" });
  expect(registered.statusCode).toBe(201);
  const id = registered.data.profiles[0].id as string;
  const me: Person = {
    client,
    id,
    async choose(choices) {
      clock.now += 1000;
      const settings = Object.entries(choices).map(([key, value]) => ({ key, at: clock.now, value }));
      expect((await client.call("POST", `/api/profiles/${id}/sync`, { since: 0, settings })).statusCode).toBe(200);
    },
    async state() {
      const response = await client.call("GET", `/api/profiles/${id}/friends`);
      expect(response.statusCode).toBe(200);
      return response.data as FriendsState;
    },
    chat: (friend, path = "") => `/api/profiles/${id}/friends/${friend.id}/chat${path}`,
    say: (friend, text) => client.call("POST", me.chat(friend), { text }),
    async open(friend) {
      const response = await client.call("GET", me.chat(friend));
      expect(response.statusCode).toBe(200);
      return response.data as ChatThread;
    },
  };
  return me;
}

/** Alex and Sam, friends with friends on. */
async function friends(persistence?: MemoryPersistence) {
  const world = await start(persistence);
  const alex = await person(world.app, "alex");
  const sam = await person(world.app, "sam");
  await alex.choose({ friends: true });
  await sam.choose({ friends: true });
  const made = await alex.client.call("POST", `/api/profiles/${alex.id}/friends/invites`, {});
  expect((await sam.client.call("POST", `/api/profiles/${sam.id}/friends/accept`, { code: made.data.code })).statusCode).toBe(201);
  return { ...world, alex, sam };
}

describe("Friends can message me", () => {
  it("is on until it is turned off: the server takes the setting like the other friend switches", async () => {
    const { alex, sam, store } = await friends();
    expect(store.settingsOf(sam.id).friendsMessages).toBeUndefined();
    expect((await alex.say(sam, "hello")).statusCode).toBe(201);

    await sam.choose({ friendsMessages: false });
    expect(store.settingsOf(sam.id).friendsMessages).toBe(false);
    const refused = await alex.say(sam, "hello again");
    expect(refused.statusCode).toBe(403);
    expect(refused.data).toEqual({ error: "chat_off" });
    // (the friend can still be read, and the page is told that they are not taking messages)
    const thread = await alex.open(sam);
    expect(thread.open).toBe(false);
    expect(thread.lines?.map((line) => line.text)).toEqual(["hello"]);
    // (and sam, who turned it off, can still write to alex: it is a switch for what comes in)
    expect((await sam.say(alex, "I can write")).statusCode).toBe(201);

    await sam.choose({ friendsMessages: true });
    expect((await alex.say(sam, "back on")).statusCode).toBe(201);
  });

  it("is not a value the server believes when it is not true or false", async () => {
    const { sam, store } = await friends();
    clock.now += 1000;
    await sam.client.call("POST", `/api/profiles/${sam.id}/sync`, { since: 0, settings: [{ key: "friendsMessages", at: clock.now, value: "no" }] });
    expect(store.settingsOf(sam.id).friendsMessages).toBeUndefined();
  });

  it("is shut with friends: a friend who turned friends off takes no messages either", async () => {
    const { alex, sam } = await friends();
    await sam.choose({ friends: false });
    expect((await alex.say(sam, "hello")).data).toEqual({ error: "chat_off" });
  });
});

describe("what waits in a chat", () => {
  it("rides with the friends' answer, a friend at a time, and is gone once the chat has been opened", async () => {
    const { alex, sam } = await friends();
    expect((await sam.state()).chat).toBeUndefined();
    await alex.say(sam, "one");
    clock.now += 5000;
    await alex.say(sam, "two");

    expect((await sam.state()).chat).toEqual([{ friend: alex.id, count: 2, at: clock.now }]);
    expect((await alex.state()).chat).toBeUndefined(); // (one's own words do not wait for oneself)
    expect((await sam.open(alex)).lines).toHaveLength(2);
    expect((await sam.state()).chat).toBeUndefined();

    await alex.say(sam, "three");
    expect((await sam.state()).chat).toMatchObject([{ friend: alex.id, count: 1 }]);
  });

  it("is quiet for a friend who is muted, who is not told", async () => {
    const { alex, sam } = await friends();
    expect((await sam.client.call("PUT", sam.chat(alex, "/mute"), { muted: true })).statusCode).toBe(200);
    await alex.say(sam, "psst");
    expect((await sam.state()).chat).toBeUndefined();
    expect((await alex.open(sam)).muted).toBe(false); // (alex is not told)
    await sam.client.call("PUT", sam.chat(alex, "/mute"), { muted: false });
    expect((await sam.state()).chat).toMatchObject([{ friend: alex.id, count: 1 }]);
  });

  it("is let go with the messages that are too old", async () => {
    const { alex, sam } = await friends();
    await alex.say(sam, "old");
    clock.now += CHAT_KEEP_MS + 1000;
    expect((await sam.state()).chat).toBeUndefined();
    expect((await sam.open(alex)).lines).toEqual([]);
  });
});

describe("the end of a chat", () => {
  it("comes with the friendship: nothing of it is left, for either, and a new friendship starts a chat of its own", async () => {
    const { alex, sam } = await friends();
    await alex.say(sam, "hello");
    await sam.say(alex, "hi");
    expect((await sam.client.call("DELETE", `/api/profiles/${sam.id}/friends/${alex.id}`)).statusCode).toBe(204);

    expect((await alex.client.call("GET", alex.chat(sam))).data).toEqual({ error: "not_friends" });
    expect((await sam.client.call("GET", sam.chat(alex))).data).toEqual({ error: "not_friends" });
    expect((await sam.state()).chat).toBeUndefined();

    const made = await alex.client.call("POST", `/api/profiles/${alex.id}/friends/invites`, {});
    await sam.client.call("POST", `/api/profiles/${sam.id}/friends/accept`, { code: made.data.code });
    expect((await alex.open(sam)).lines).toEqual([]);
  });

  it("comes with the profile: a friend whose profile is gone leaves no chat, and no notice of one", async () => {
    const { alex, sam, store } = await friends();
    await alex.say(sam, "hello");
    expect((await sam.state()).chat).toHaveLength(1);
    store.deleteAccount(store.findByEmail("alex")!.id);
    expect((await sam.state()).chat).toBeUndefined();
    expect((await sam.client.call("GET", sam.chat(alex))).data).toEqual({ error: "not_friends" });
  });
});

describe("reporting a chat", () => {
  it("shows what would be sent and sends it to the team as feedback about the friends, once the reporter has agreed", async () => {
    const { alex, sam, feedback } = await friends();
    await alex.say(sam, "something unkind");
    await sam.say(alex, "stop");

    const preview = await sam.client.call("GET", sam.chat(alex, "/report"));
    expect(preview.statusCode).toBe(200);
    expect(preview.data.lines.map((line: { text: string; mine: boolean }) => [line.mine, line.text])).toEqual([
      [false, "something unkind"],
      [true, "stop"],
    ]);
    expect(feedback.size).toBe(0); // (looking is not sending)

    expect((await sam.client.call("POST", sam.chat(alex, "/report"), { rev: preview.data.rev })).statusCode).toBe(204);
    expect(feedback.size).toBe(1);
    const record = feedback.list()[0]!;
    expect(record).toMatchObject({ kind: "bug", area: "friends", answer: false });
    const text = (await feedback.file(record.id, "chat"))!.data.toString("utf8");
    expect(text).toContain("something unkind");
    expect(text).toContain("Reported by: Sam#1");
  });

  it("is not sent when the chat has changed since it was shown", async () => {
    const { alex, sam, feedback } = await friends();
    await alex.say(sam, "one");
    const preview = await sam.client.call("GET", sam.chat(alex, "/report"));
    clock.now += 1000;
    await alex.say(sam, "two");
    const refused = await sam.client.call("POST", sam.chat(alex, "/report"), { rev: preview.data.rev });
    expect(refused.statusCode).toBe(409);
    expect(feedback.size).toBe(0);
  });
});

describe("a restart", () => {
  it("keeps the chats, what has been seen of them, and who muted whom", async () => {
    const persistence = new MemoryPersistence();
    const first = await friends(persistence);
    await first.alex.say(first.sam, "kept");
    await first.alex.say(first.sam, "kept too");
    expect((await first.sam.client.call("PUT", first.sam.chat(first.alex, "/mute"), { muted: true })).statusCode).toBe(200);
    await first.store.flush();

    const second = await start(persistence);
    const read = second.store.chats.read(first.sam.id, first.alex.id);
    expect(read.ok && read.value.lines.map((line) => line.text)).toEqual(["kept", "kept too"]);
    expect(read.ok && read.value.muted).toBe(true);
    expect(second.store.chats.unread(first.sam.id)).toEqual([]); // (muted)
    second.store.chats.mute(first.sam.id, first.alex.id, false);
    expect(second.store.chats.unread(first.sam.id)).toMatchObject([{ friend: first.alex.id, count: 2 }]);
  });
});
