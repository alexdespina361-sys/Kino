import { once } from "node:events";
import { connect } from "node:net";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_STICKER, PERSONAL_STICKER_TEXT } from "../../shared";
import { buildApp } from "../app";
import { FeedbackStore, MemoryFeedbackBackend } from "../feedback/store";
import { MemoryPersistence } from "./persistence";
import { MemoryStickerFiles } from "./stickerFiles";
import { AccountStore } from "./store";

/**
 * Personal stickers as the server puts them together: made in a collection, sent in a chat, seen by the two of it, saved from it, let go, sent to the team
 * with a report, taken down by the team, and kept over a restart. (The picture check and the book's own rules are in stickers.test.ts; who may reach what, for
 * every route, in authorization.test.ts.)
 */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const cheap = { N: 1024, r: 8, p: 1 } as const;
const TOKEN = "the-teams-token-is-at-least-24-characters";
const clock = { now: Date.now() };

function picture(n: number, text?: string): string {
  const png = new PNG({ width: 48, height: 48 });
  for (let at = 0; at < png.data.length; at += 4) png.data.set([n & 255, 90, 200, 255], at);
  let file = PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 9 });
  if (text) {
    // (words put in the file the way an editor does, before its end: they are not kept)
    const end = file.length - 12;
    const body = Buffer.from(`tEXtComment\0${text}`, "latin1");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length - 4);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    file = Buffer.concat([file.subarray(0, end), length, body, sum, file.subarray(end)]);
  }
  return file.toString("base64");
}

async function start(options: { on?: boolean; persistence?: MemoryPersistence; files?: MemoryStickerFiles; uploadMs?: number } = {}) {
  const persistence = options.persistence ?? new MemoryPersistence();
  const files = options.files ?? new MemoryStickerFiles();
  const store = await AccountStore.open({ persistence, flushMs: 0, now: () => clock.now, stickers: { on: options.on ?? true, files, ...(options.uploadMs ? { uploadMs: options.uploadMs } : {}) } });
  const feedback = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
  const app = await buildApp({ accounts: store, feedback, passwordCost: cheap, feedbackAdminToken: TOKEN });
  apps.push(app);
  return { app, store, feedback, persistence, files };
}

type Reply = LightMyRequestResponse & { data: any };

class Client {
  cookie = "";
  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string> = {},
  ) {}
  async call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown): Promise<Reply> {
    const response = await this.app.inject({ method, url, headers: { ...this.headers, ...(this.cookie ? { cookie: this.cookie } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
    const set = response.headers["set-cookie"];
    const header = Array.isArray(set) ? set[0] : set;
    if (header) this.cookie = header.split(";")[0]!;
    let data: unknown;
    try {
      data = response.json();
    } catch {
      data = undefined;
    }
    return Object.assign(response, { data });
  }
}

async function person(app: FastifyInstance, login: string) {
  const client = new Client(app);
  const registered = await client.call("POST", "/api/auth/register", { email: login, password: "x" });
  expect(registered.statusCode).toBe(201);
  const id = registered.data.profiles[0].id as string;
  const mine = (rest = "") => `/api/profiles/${id}/stickers${rest}`;
  return {
    client,
    id,
    account: registered.data.account.id as string,
    make: (data: string) => client.call("POST", mine(), { data }),
    collection: async () => (await client.call("GET", mine())).data.stickers as Array<{ id: string; mine: boolean }>,
    own: (sid: string) => client.call("GET", mine(`/${sid}`)),
    letGo: (sid: string) => client.call("DELETE", mine(`/${sid}`)),
    chat: (friend: { id: string }, rest = "") => `/api/profiles/${id}/friends/${friend.id}/chat${rest}`,
  };
}
type Person = Awaited<ReturnType<typeof person>>;

async function friends(options: Parameters<typeof start>[0] = {}) {
  const world = await start(options);
  const alex = await person(world.app, "alex");
  const sam = await person(world.app, "sam");
  const made = await alex.client.call("POST", `/api/profiles/${alex.id}/friends/invites`, {});
  expect((await sam.client.call("POST", `/api/profiles/${sam.id}/friends/accept`, { code: made.data.code })).statusCode).toBe(201);
  return { ...world, alex, sam, team: new Client(world.app, { authorization: `Bearer ${TOKEN}` }) };
}

async function madeOne(who: Person, n: number, text?: string): Promise<string> {
  const reply = await who.make(picture(n, text));
  expect(reply.statusCode, reply.body).toBe(201);
  return reply.data.id as string;
}
async function sendIt(from: Person, to: Person, sid: string): Promise<Reply> {
  clock.now += 1000;
  return from.client.call("POST", from.chat(to, "/sticker"), { id: sid });
}

describe("personal stickers while the host has them off", () => {
  it("are not there: nothing is made, sent or shown, and the screens are told nothing of them", async () => {
    const { app, alex, sam } = await friends({ on: false });
    expect((await new Client(app).call("GET", "/api/features")).data.stickers).toBeUndefined();
    for (const reply of [await alex.make(picture(1)), await alex.client.call("GET", `/api/profiles/${alex.id}/stickers`), await alex.client.call("POST", alex.chat(sam, "/sticker"), { id: "A".repeat(22) })]) {
      expect([reply.statusCode, reply.data]).toEqual([404, { error: "off" }]);
    }
  });

  it("leave where their pictures are kept alone: a start asks it nothing (on Postgres, not even for their table), one with them on tidies it", async () => {
    const asked: string[] = [];
    const files = new MemoryStickerFiles();
    for (const name of ["ids", "get", "put", "remove"] as const) {
      const real = files[name].bind(files) as (...args: unknown[]) => unknown;
      (files as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => (asked.push(name), real(...args));
    }
    await start({ on: false, files });
    expect(asked).toEqual([]);
    await start({ on: true, files });
    expect(asked).toEqual(["ids"]);
  });
});

describe("a personal sticker", () => {
  it("is told of to the screens while it is on", async () => {
    const { app } = await friends();
    expect((await new Client(app).call("GET", "/api/features")).data.stickers).toBe(true);
  });

  it("is made of a picture, sent to a friend, shown to the two of the chat, and saved by the friend", async () => {
    const { alex, sam } = await friends();
    const sid = await madeOne(alex, 1, "the words of the file");
    expect(await alex.collection()).toEqual([{ id: sid, mine: true }]);
    const own = await alex.own(sid);
    expect(own.statusCode).toBe(200);
    expect(own.rawPayload.includes(Buffer.from("the words of the file"))).toBe(false);

    const sent = await sendIt(alex, sam, sid);
    expect(sent.statusCode).toBe(201);
    expect(sent.data.lines.at(-1)).toMatchObject({ mine: true, text: PERSONAL_STICKER_TEXT, sticker: sid });
    const seen = (await sam.client.call("GET", sam.chat(alex))).data.lines.at(-1);
    expect(seen).toMatchObject({ mine: false, text: PERSONAL_STICKER_TEXT, sticker: sid });

    // the picture, to each of the two, as a PNG nothing guesses at, runs or embeds elsewhere
    for (const [who, other] of [[sam, alex], [alex, sam]] as const) {
      const shown = await who.client.call("GET", who.chat(other, `/stickers/${sid}`));
      expect(shown.statusCode).toBe(200);
      expect(shown.rawPayload).toEqual(own.rawPayload);
      expect(shown.headers).toMatchObject({
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=300",
      });
    }
    // not in Sam's collection until he saves it; then it is, and not his own
    expect((await sam.own(sid)).statusCode).toBe(404);
    const saved = await sam.client.call("POST", sam.chat(alex, `/stickers/${sid}/save`));
    expect([saved.statusCode, saved.data.stickers]).toEqual([200, [{ id: sid, mine: false }]]);
    expect((await sam.own(sid)).rawPayload).toEqual(own.rawPayload);
    // and he may send it on: it is one he has
    expect((await sendIt(sam, alex, sid)).statusCode).toBe(201);
  });

  it("is only one's own to send, and only the chat's two see it there", async () => {
    const { app, alex, sam } = await friends();
    const sid = await madeOne(alex, 1);
    // (a name typed by hand: Sam does not have it)
    expect([(await sendIt(sam, alex, sid)).statusCode, (await sendIt(sam, alex, sid)).data]).toEqual([404, { error: "gone" }]);
    expect((await sam.client.call("GET", sam.chat(alex, `/stickers/${sid}`))).statusCode).toBe(404);
    expect((await sam.client.call("POST", sam.chat(alex, `/stickers/${sid}/save`))).statusCode).toBe(404);
    await sendIt(alex, sam, sid);
    // somebody else, friends with Alex, is not of that chat
    const kim = await person(app, "kim");
    const code = (await alex.client.call("POST", `/api/profiles/${alex.id}/friends/invites`, {})).data.code;
    await kim.client.call("POST", `/api/profiles/${kim.id}/friends/accept`, { code });
    expect((await kim.client.call("GET", kim.chat(alex, `/stickers/${sid}`))).statusCode).toBe(404);
    expect((await kim.client.call("GET", kim.chat(sam, `/stickers/${sid}`))).statusCode).toBe(404); // (not friends: the same answer as for a sticker not sent there)
    expect((await kim.own(sid)).statusCode).toBe(404);
    // once they are not friends, the chat shows Sam nothing more of it; what he saved is still his
    await sam.client.call("POST", sam.chat(alex, `/stickers/${sid}/save`));
    expect((await sam.client.call("DELETE", `/api/profiles/${sam.id}/friends/${alex.id}`)).statusCode).toBe(204);
    expect((await sam.client.call("GET", sam.chat(alex, `/stickers/${sid}`))).statusCode).toBe(404);
    expect((await sam.own(sid)).statusCode).toBe(200);
  });

  it("is no longer available once everybody who had it has let it go: the message stays and says what it was", async () => {
    const { alex, sam, files } = await friends();
    const sid = await madeOne(alex, 1);
    await sendIt(alex, sam, sid);
    await sam.client.call("POST", sam.chat(alex, `/stickers/${sid}/save`));
    expect((await alex.letGo(sid)).data.stickers).toEqual([]);
    expect((await sam.client.call("GET", sam.chat(alex, `/stickers/${sid}`))).statusCode).toBe(200); // (Sam still has it)
    expect((await sam.letGo(sid)).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const [who, other] of [[sam, alex], [alex, sam]] as const) {
      expect((await who.client.call("GET", who.chat(other, `/stickers/${sid}`))).data).toEqual({ error: "gone" });
    }
    expect(files.files.size).toBe(0);
    expect((await sam.client.call("GET", sam.chat(alex))).data.lines.at(-1)).toMatchObject({ text: PERSONAL_STICKER_TEXT, sticker: sid });
  });

  it("is sent to the team with a report of the chat, its picture with it, as it was when the report was sent", async () => {
    const { alex, sam, feedback } = await friends();
    const sid = await madeOne(alex, 1);
    await sendIt(alex, sam, sid);
    clock.now += 1000;
    await alex.client.call("POST", alex.chat(sam), { text: "and some words" });
    const picture = (await alex.own(sid)).rawPayload;
    const preview = await sam.client.call("GET", sam.chat(alex, "/report"));
    expect(preview.data.lines.map((line: { sticker?: string }) => line.sticker)).toEqual([sid, undefined]);
    expect((await sam.client.call("POST", sam.chat(alex, "/report"), { rev: preview.data.rev })).statusCode).toBe(204);
    // (Alex letting it go after the report does not take it from the team)
    await alex.letGo(sid);
    const record = feedback.list()[0]!;
    expect(record.files.map((file) => [file.id, file.name, file.mime])).toEqual([
      ["chat", "chat.txt", "text/plain"],
      ["sticker1", "sticker1.png", "image/png"],
    ]);
    expect((await feedback.file(record.id, "sticker1"))!.data).toEqual(picture);
    const text = (await feedback.file(record.id, "chat"))!.data.toString("utf8");
    expect(text).toContain(`${PERSONAL_STICKER_TEXT} [personal sticker ${sid}: picture in sticker1.png]`);
    expect(text).toContain("node scripts/stickers.mjs remove");
  });

  it("is taken down by the team everywhere, one or all of a maker's, with the team's token only", async () => {
    const { app, alex, sam, team } = await friends();
    const one = await madeOne(alex, 1);
    const two = await madeOne(alex, 2);
    await sendIt(alex, sam, one);
    await sam.client.call("POST", sam.chat(alex, `/stickers/${one}/save`));

    expect((await new Client(app).call("GET", "/api/admin/stickers")).statusCode).toBe(401);
    expect((await alex.client.call("DELETE", `/api/admin/stickers/${one}`)).statusCode).toBe(401);
    const listed = await team.call("GET", "/api/admin/stickers");
    expect(listed.data).toMatchObject({ on: true, stickers: expect.any(Array) });
    expect(listed.data.stickers.map((each: { id: string; by: string; account: string; holders: number }) => [each.id, each.by, each.account, each.holders]).sort()).toEqual(
      [
        [one, alex.id, alex.account, 2],
        [two, alex.id, alex.account, 1],
      ].sort(),
    );
    expect((await team.call("GET", `/api/admin/stickers/${one}`)).headers["content-type"]).toBe("image/png");

    expect((await team.call("DELETE", `/api/admin/stickers/${one}`)).data).toEqual({ taken: 1 });
    expect((await team.call("DELETE", `/api/admin/stickers/${one}`)).statusCode).toBe(404);
    expect((await sam.client.call("GET", sam.chat(alex, `/stickers/${one}`))).statusCode).toBe(404);
    expect(await sam.collection()).toEqual([]);
    expect((await team.call("DELETE", `/api/admin/stickers?by=${alex.account}`)).data).toEqual({ taken: 1 });
    expect(await alex.collection()).toEqual([]);
    expect((await team.call("DELETE", "/api/admin/stickers?by=")).statusCode).toBe(400);
  });

  it("is turned away for a profile without friends, and for what is not a picture", async () => {
    const { alex, store } = await friends();
    const settings = [{ key: "friendsOff", at: clock.now + 1, value: true }];
    expect((await alex.client.call("POST", `/api/profiles/${alex.id}/sync`, { since: 0, settings })).statusCode).toBe(200);
    expect(store.settingsOf(alex.id).friendsOff).toBe(true);
    expect([(await alex.make(picture(1))).statusCode, (await alex.make(picture(1))).data]).toEqual([403, { error: "friends_off" }]);
    const { alex: other } = await friends();
    for (const data of ["", "not base64 at all!", Buffer.from("GIF89a").toString("base64")]) {
      expect((await other.make(data)).statusCode, data).toBe(400);
    }
    expect((await other.make("A".repeat(400_000))).statusCode).toBe(413);
  });

  it("is kept over a restart, and a picture nobody has a record of is let go then", async () => {
    const persistence = new MemoryPersistence();
    const files = new MemoryStickerFiles();
    const first = await friends({ persistence, files });
    const sid = await madeOne(first.alex, 1);
    await sendIt(first.alex, first.sam, sid);
    await first.sam.client.call("POST", first.sam.chat(first.alex, `/stickers/${sid}/save`));
    await first.store.flush();
    await files.put("Z".repeat(22), Buffer.from("written, then the server stopped"));

    const second = await start({ persistence, files });
    expect(second.store.stickers.of(first.sam.id).stickers).toEqual([{ id: sid, mine: false }]);
    expect(second.store.stickers.of(first.alex.id).stickers).toEqual([{ id: sid, mine: true }]);
    expect(await files.ids()).toEqual([sid]);
  });

  it("goes with the profile or the account that is gone", async () => {
    const { alex, sam, store, files } = await friends();
    const alone = await madeOne(alex, 1);
    const shared = await madeOne(alex, 2);
    await sendIt(alex, sam, shared);
    await sam.client.call("POST", sam.chat(alex, `/stickers/${shared}/save`));
    store.deleteAccount(store.findByEmail("alex")!.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.stickers.has(alone)).toBe(false);
    expect(store.stickers.of(sam.id).stickers).toEqual([{ id: shared, mine: false }]);
    expect(await files.ids()).toEqual([shared]);
  });

  it("lets a picture in before its body is read: only from the profile's own account, one at a time for it, and so many at once for the site", async () => {
    const files = new MemoryStickerFiles();
    const { app, alex, sam } = await friends({ files });
    // (what is not even read as a body is turned away for who sent it, not for what it is)
    const raw = (client: Client, id: string) =>
      app.inject({ method: "POST", url: `/api/profiles/${id}/stickers`, headers: { "content-type": "application/json", ...(client.cookie ? { cookie: client.cookie } : {}) }, payload: "{ not json" });
    expect((await raw(new Client(app), alex.id)).statusCode).toBe(401);
    expect((await raw(sam.client, alex.id)).statusCode).toBe(404);
    expect((await raw(alex.client, alex.id)).statusCode).toBe(400);
    // (and a body that is JSON, and not exactly what the page sends, is not unpacked to be looked at: a bad request too, the judge, 17 Nov)
    const junk = (payload: string) =>
      app.inject({ method: "POST", url: `/api/profiles/${alex.id}/stickers`, headers: { "content-type": "application/json", cookie: alex.client.cookie! }, payload });
    expect((await junk(`{"data":"","delays":[20,20],"junk":[${"{},".repeat(1000)}{}]}`)).statusCode).toBe(400);
    expect((await junk(`{ "data": "${picture(9)}" }`)).statusCode, "spaces are not what the page sends").toBe(400);
    expect((await junk(`{"data":"${picture(9)}"}`)).statusCode, "what the page sends").toBe(201);

    // (pictures held on their way in: a second of Alex's waits, as does a fifth of the site's)
    const put = files.put.bind(files);
    const held: Array<() => void> = [];
    files.put = (id, data) => new Promise<void>((resolve) => held.push(() => void put(id, data).then(resolve)));
    const others = await Promise.all(["kim", "lee", "max"].map((login) => person(app, login)));
    const waiting = [alex, ...others].map((who, n) => who.make(picture(10 + n)));
    await vi.waitFor(() => expect(held).toHaveLength(4));
    const busy = await alex.make(picture(20));
    expect([busy.statusCode, busy.data, busy.headers["retry-after"]]).toEqual([503, { error: "busy", retryAfter: 5 }, "5"]);
    expect([(await sam.make(picture(21))).statusCode]).toEqual([503]);
    held.forEach((go) => go());
    expect((await Promise.all(waiting)).map((reply) => reply.statusCode)).toEqual([201, 201, 201, 201]);
    files.put = put;
    // (and each is let go when its answer has gone)
    expect((await alex.make(picture(22))).statusCode).toBe(201);
    expect((await sam.make(picture(23))).statusCode).toBe(201);
  });

  it("lets an upload's place go however it ends: its asker gone while the picture was being kept, or the picture too slow to come", async () => {
    const files = new MemoryStickerFiles();
    const { app, alex } = await friends({ files, uploadMs: 1000 });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const path = `/api/profiles/${alex.id}/stickers`;
    const body = JSON.stringify({ data: picture(30) });

    // the picture came whole, and its asker went while it was being kept: the account's next is let in
    const put = files.put.bind(files);
    let release: (() => void) | undefined;
    files.put = (id, data) => new Promise<void>((resolve) => (release = () => void put(id, data).then(resolve)));
    const gone = new AbortController();
    const asked = fetch(`${address}${path}`, { method: "POST", headers: { cookie: alex.client.cookie, "content-type": "application/json" }, body, signal: gone.signal }).catch(() => "gone");
    await vi.waitFor(() => expect(release).toBeDefined());
    gone.abort();
    expect(await asked).toBe("gone");
    release!();
    files.put = put;
    await vi.waitFor(async () => expect(await alex.collection()).toHaveLength(1));
    expect((await alex.make(picture(31))).statusCode).toBe(201);

    // one sent a little at a time keeps the account's next out only until its time is up, then it is ended
    const socket = connect(Number(new URL(address).port), "127.0.0.1");
    await once(socket, "connect");
    const ended = once(socket, "close");
    socket.on("error", () => {});
    socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nCookie: ${alex.client.cookie}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body.slice(0, 100)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await alex.make(picture(32))).statusCode).toBe(503);
    await ended;
    expect((await alex.make(picture(33))).statusCode).toBe(201);
    expect(await alex.collection()).toHaveLength(3);
  });

  it("has one allowance of pictures a minute for an account, of its collection and of its chats together", async () => {
    const { alex, sam, store } = await friends();
    const sid = await madeOne(alex, 1);
    await sendIt(alex, sam, sid);
    expect((await alex.own(sid)).statusCode).toBe(200);
    expect((await alex.client.call("GET", alex.chat(sam, `/stickers/${sid}`))).statusCode).toBe(200);
    for (let n = 2; n < PERSONAL_STICKER.picturesPerMinute; n++) store.stickers.pictureReads.hit(alex.account);
    expect((await alex.own(sid)).statusCode).toBe(429);
    expect((await alex.client.call("GET", alex.chat(sam, `/stickers/${sid}`))).statusCode).toBe(429);
    // (Sam's are his own)
    expect((await sam.client.call("GET", sam.chat(alex, `/stickers/${sid}`))).statusCode).toBe(200);
  });
});
