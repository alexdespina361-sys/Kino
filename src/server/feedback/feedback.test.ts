import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { FEEDBACK_DETAIL_KEYS, FEEDBACK_LIMITS } from "../../shared";
import { MemoryPersistence } from "../accounts/persistence";
import { AccountStore } from "../accounts/store";
import { buildApp } from "../app";
import { FeedbackFull, FileFeedbackBackend, FeedbackStore, MemoryFeedbackBackend, PostgresFeedbackBackend, type FeedbackBackend, type FeedbackRecord, type NewReport } from "./store";

const TOKEN = "t".repeat(32);
const key = (n: number) => `k${String(n).padStart(21, "0")}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a picture")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a picture")]);
const picture = (id = "pic1", data: Buffer = PNG, extra: object = {}) => ({ id, name: "screen.png", mime: "image/png", role: "screenshot", data: data.toString("base64"), ...extra });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** A store that is turning reports away says so in its log: not in these. */
const quiet = { warn: () => {} };

const report = (n: number, extra: Partial<NewReport> = {}): NewReport => ({
  key: key(n),
  kind: "bug",
  area: "player",
  title: `Report ${n}`,
  message: `It broke ${n}`,
  details: {},
  answer: true,
  context: null,
  files: [],
  ...extra,
});

/* ------------------------------ the store, in each of its homes ------------------------------ */

interface Home {
  backend: FeedbackBackend;
  /** A second backend over what the first one kept (the server was started again). */
  again(): FeedbackBackend;
  done(): Promise<void>;
}

const homes: Array<[string, () => Promise<Home>]> = [
  [
    "memory",
    async () => {
      const backend = new MemoryFeedbackBackend();
      return { backend, again: () => backend, done: async () => {} };
    },
  ],
  [
    "a folder",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kino-feedback-"));
      return { backend: new FileFeedbackBackend(dir), again: () => new FileFeedbackBackend(dir), done: () => rm(dir, { recursive: true, force: true }) };
    },
  ],
  [
    "Postgres",
    async () => {
      const db = new PGlite();
      return { backend: new PostgresFeedbackBackend(db), again: () => new PostgresFeedbackBackend(db), done: () => db.close() };
    },
  ],
];

describe.each(homes)("reports kept in %s", (_name, open) => {
  let home: Home | undefined;
  const make = async () => (home = await open());
  afterEach(async () => {
    await home?.done();
    home = undefined;
  });

  it("keeps a report with its files across a restart, and the same key is the same report", async () => {
    const { backend, again } = await make();
    const store = await FeedbackStore.open({ backend });
    const first = await store.create(report(1, { files: [{ meta: { id: "pic1", name: "a.png", mime: "image/png", role: "screenshot" }, data: PNG }] }));
    expect(first.created).toBe(true);
    // (Sent again, even at the same moment: one report.)
    const [second, third] = await Promise.all([store.create(report(1, { message: "other words" })), store.create(report(1))]);
    expect([second.created, third.created]).toEqual([false, false]);
    expect(second.record.id).toBe(first.record.id);
    expect(store.size).toBe(1);

    const restarted = await FeedbackStore.open({ backend: again() });
    expect(restarted.size).toBe(1);
    expect(restarted.byKey(key(1))?.message).toBe("It broke 1");
    expect(restarted.byKey("some other key")).toBeUndefined();
    expect((await restarted.file(first.record.id, "pic1"))?.data.equals(PNG)).toBe(true);
    // The next report does not take the number of one that is kept.
    expect((await restarted.create(report(2))).record.id).toBe("2");
  });

  it("changes a report only after the change is written, one change at a time", async () => {
    const { backend, again } = await make();
    const store = await FeedbackStore.open({ backend });
    const { record } = await store.create(report(1));
    await Promise.all([
      store.addMessage(record.id, { from: "team", text: "Which film?", asks: true, status: "needs_info" }),
      store.addMessage(record.id, { from: "user", text: "Any film" }),
      store.update(record.id, (draft) => void draft.tags.push("player")),
    ]);
    const restarted = await FeedbackStore.open({ backend: again() });
    const kept = restarted.get(record.id)!;
    expect(kept.messages.map((message) => message.text).sort()).toEqual(["Any film", "Which film?"]);
    expect(kept.messages.map((message) => message.id)).toEqual([1, 2]);
    expect(kept.tags).toEqual(["player"]);
    expect(kept.status).toBe("needs_info");
  });

  it("makes room: the files of the oldest closed report first, then the oldest closed report itself", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    // Room for two files of this size (and the words), not three.
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024, maxReports: 3 });
    const one = (await store.create(withFile(1))).record;
    const two = (await store.create(withFile(2))).record;
    await store.update(one.id, (draft) => void (draft.status = "done"));
    await store.create(withFile(3));
    // The closed one lost its picture; its words stay, and so do the other reports' pictures.
    expect(store.get(one.id)?.files[0]?.gone).toBe(true);
    expect(await store.file(one.id, "pic11")).toBeUndefined();
    expect(await backend.getFile(one.id, "pic11")).toBeUndefined();
    expect(store.get(one.id)?.message).toBe("It broke 1");
    expect((await store.file(two.id, "pic21"))?.data.length).toBe(big.length);

    // A fourth report is one too many: the closed one goes, not the older open one.
    await store.create(report(4));
    expect(store.get(one.id)).toBeUndefined();
    expect(store.get(two.id)).toBeDefined();
    expect(store.size).toBe(3);
  });

  it("never gives up a report that is open to make room: past the number it keeps, a new one is turned away until the team has closed one", async () => {
    const { backend, again } = await make();
    const told: string[] = [];
    const store = await FeedbackStore.open({ backend, maxReports: 2, log: { warn: (line) => void told.push(line) } });
    const one = (await store.create(report(1))).record;
    const two = (await store.create(report(2))).record;

    await expect(store.create(report(3))).rejects.toBeInstanceOf(FeedbackFull);
    expect(store.size).toBe(2);
    expect([store.get(one.id)?.status, store.get(two.id)?.status]).toEqual(["new", "new"]);
    expect(store.byKey(key(3))).toBeUndefined();
    // (Whoever runs the site is told: that is the only way to know that reports are being turned away.)
    expect(told).toEqual([expect.stringContaining("turned a report away")]);

    // (What was turned away did not use up a number. A report that is closed makes room; the one that is open stays.)
    await store.update(one.id, (draft) => void (draft.status = "done"));
    const before = store.rev;
    expect((await store.create(report(3))).record.id).toBe("3");
    expect(store.get(one.id)).toBeUndefined();
    expect(store.get(two.id)?.status).toBe("new");
    expect(store.size).toBe(2);
    // (The team's watch hears of it: the report that went, and the one that came.)
    expect(store.rev).toBe(before + 2);
    const restarted = await FeedbackStore.open({ backend: again(), log: quiet });
    expect(restarted.list().map((each) => each.id).sort()).toEqual(["2", "3"]);
  });

  it("keeps the files of a report that is open whatever comes after it: the new report keeps its words, and its files are said to be left out", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number, extra: Partial<NewReport> = {}) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }], ...extra });
    // Room for the words of five reports and two files of this size.
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 5 * 6 * 1024, log: quiet });
    const one = (await store.create(withFile(1))).record;
    const two = (await store.create(withFile(2))).record;

    // Left to itself it is all or nothing: a report with files that do not fit is not taken.
    await expect(store.create(withFile(3))).rejects.toBeInstanceOf(FeedbackFull);
    expect(store.size).toBe(2);
    // Where the files may be left out, the words are kept and the file is named.
    const three = await store.create(withFile(3), { filesOptional: true });
    expect(three.refused).toEqual(["pic31"]);
    expect(three.record).toMatchObject({ id: "3", message: "It broke 3", files: [] });
    expect(await backend.getFile(three.record.id, "pic31")).toBeUndefined();
    // The files of the reports that are open are as they were.
    expect((await store.file(one.id, "pic11"))?.data.length).toBe(big.length);
    expect((await store.file(two.id, "pic21"))?.data.length).toBe(big.length);
    // A report that is only its files is not kept without them. (The answers to the questions are words.)
    await expect(store.create(withFile(4, { message: "" }), { filesOptional: true })).rejects.toBeInstanceOf(FeedbackFull);
    const four = await store.create(withFile(4, { message: "", details: { steps: "Play the film" } }), { filesOptional: true });
    expect([four.record.id, four.refused]).toEqual(["4", ["pic41"]]);

    // The team closes one: its files make room (the words stay), and the next report keeps its file.
    await store.update(one.id, (draft) => void (draft.status = "done"));
    const five = await store.create(withFile(5), { filesOptional: true });
    expect(five.refused).toEqual([]);
    expect(store.get(one.id)).toMatchObject({ message: "It broke 1" });
    expect(store.get(one.id)?.files[0]?.gone).toBe(true);
    expect(await backend.getFile(one.id, "pic11")).toBeUndefined();
    expect((await store.file(five.record.id, "pic51"))?.data.length).toBe(big.length);
    expect((await store.file(two.id, "pic21"))?.data.length).toBe(big.length);

    // And when not even the words fit, nothing is taken.
    await expect(store.create(report(6), { filesOptional: true })).rejects.toBeInstanceOf(FeedbackFull);
    expect(store.size).toBe(5);
  });

  it("takes the files of the oldest closed report first, and no more than it needs", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    // Room for the words of three reports and two files: the third report needs one of the two to go, to the byte.
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024, log: quiet });
    const one = (await store.create(withFile(1))).record;
    const two = (await store.create(withFile(2))).record;
    for (const each of [one, two]) await store.update(each.id, (draft) => void (draft.status = "duplicate"));

    const three = await store.create(withFile(3));
    expect(three.refused).toEqual([]);
    expect(store.get(one.id)?.files[0]?.gone).toBe(true);
    expect(store.get(two.id)?.files[0]?.gone).toBeUndefined();
    expect((await store.file(two.id, "pic21"))?.data.length).toBe(big.length);
    expect(store.bytes).toBe(2 * big.length + 3 * 6 * 1024);
  });

  it("counts the words of the new report in the room it makes: a file goes while the words and the file together do not fit", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    // A thousand bytes less than the third report needs when one file has gone.
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024 - 1000, log: quiet });
    const one = (await store.create(withFile(1))).record;
    const two = (await store.create(withFile(2))).record;
    for (const each of [one, two]) await store.update(each.id, (draft) => void (draft.status = "done"));

    const three = await store.create(withFile(3));
    expect(three.refused).toEqual([]);
    expect([store.get(one.id)?.files[0]?.gone, store.get(two.id)?.files[0]?.gone]).toEqual([true, true]);
    expect((await store.file(three.record.id, "pic31"))?.data.length).toBe(big.length);
  });

  it("tells a page that sends a report twice at once the same of its files both times", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024, log: quiet });
    await store.create(withFile(1));
    await store.create(withFile(2));

    const [first, second] = await Promise.all([store.create(withFile(3), { filesOptional: true }), store.create(withFile(3), { filesOptional: true })]);
    expect([first.created, second.created]).toEqual([true, false]);
    expect([first.refused, second.refused]).toEqual([["pic31"], ["pic31"]]);
    expect(second.record.id).toBe(first.record.id);
    expect(store.size).toBe(3);
  });

  it("keeps the files that fit, in the order they came, and names the ones that are left out", async () => {
    const { backend } = await make();
    const file = (id: string, size: number) => ({ meta: { id, name: `${id}.png`, mime: "image/png" as const, role: "screenshot" as const }, data: Buffer.concat([PNG, Buffer.alloc(size - PNG.length)]) });
    // Room for the words of a report and for 40,056 bytes of files.
    const store = await FeedbackStore.open({ backend, maxBytes: 6 * 1024 + 40_056, log: quiet });
    const made = await store.create(report(1, { files: [file("big1", 30_028), file("mid1", 20_028), file("sml1", 10_028)] }), { filesOptional: true });
    // (The middle one does not fit, and the small one after it fits to the byte.)
    expect(made.refused).toEqual(["mid1"]);
    expect(made.record.files.map((each) => each.id)).toEqual(["big1", "sml1"]);
    expect((await store.file(made.record.id, "sml1"))?.data.length).toBe(10_028);
    expect(await backend.getFile(made.record.id, "mid1")).toBeUndefined();
    expect(store.bytes).toBe(6 * 1024 + 40_056);
  });

  it("is exact when many arrive at once: the room that was found is the room there is", async () => {
    const { backend } = await make();
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    const maxBytes = 2 * big.length + 3 * 6 * 1024;
    const store = await FeedbackStore.open({ backend, maxReports: 3, maxBytes, log: quiet });
    const arrived = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => store.create(withFile(n), { filesOptional: true })));
    // Three have a place, and two files fit; the other two reports are turned away.
    expect(arrived.filter((each) => each.status === "fulfilled")).toHaveLength(3);
    expect(arrived.flatMap((each) => (each.status === "rejected" ? [each.reason] : []))).toEqual([expect.any(FeedbackFull), expect.any(FeedbackFull)]);
    expect(store.size).toBe(3);
    expect(store.bytes).toBeLessThanOrEqual(maxBytes);
    expect(store.list().flatMap((record) => record.files)).toHaveLength(2);
  });

  it("takes a report out with its files", async () => {
    const { backend } = await make();
    const store = await FeedbackStore.open({ backend });
    const { record } = await store.create(report(1, { files: [{ meta: { id: "pic1", name: "a.png", mime: "image/png", role: "screenshot" }, data: PNG }] }));
    expect(await store.remove(record.id)).toBe(true);
    expect(await store.remove(record.id)).toBe(false);
    expect(await backend.getFile(record.id, "pic1")).toBeUndefined();
    expect((await FeedbackStore.open({ backend })).size).toBe(0);
  });
});

/** A backend that holds the next save until it is let go: a slow write, with whatever comes after it waiting for its turn. */
class SlowSave extends MemoryFeedbackBackend {
  private gate: Promise<void> | undefined;

  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => (release = resolve));
    return release;
  }

  override async save(record: FeedbackRecord) {
    const gate = this.gate;
    this.gate = undefined;
    await gate;
    await super.save(record);
  }
}

describe("making room while a closed report is being opened again", () => {
  const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
  const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
  const sentAgain = (store: FeedbackStore, id: string) => store.addMessage(id, { from: "user", text: "It still happens", status: "in_review" });

  it("leaves a report alone that its sender wrote to before its turn came: it is open now", async () => {
    const backend = new SlowSave();
    const store = await FeedbackStore.open({ backend, maxReports: 2, log: quiet });
    const one = (await store.create(report(1))).record;
    await store.create(report(2));
    await store.update(one.id, (draft) => void (draft.status = "done"));

    // (The report is closed when it is chosen to make room, and open when its turn comes.)
    const release = backend.hold();
    const writing = sentAgain(store, one.id);
    const arriving = expect(store.create(report(3))).rejects.toBeInstanceOf(FeedbackFull);
    await wait(20);
    release();
    await writing;
    await arriving;
    expect(store.get(one.id)).toMatchObject({ status: "in_review" });
    expect(store.get(one.id)?.messages).toHaveLength(1);
    expect(store.size).toBe(2);
  });

  it("does the same for the files of a report", async () => {
    const backend = new SlowSave();
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024, log: quiet });
    const one = (await store.create(withFile(1))).record;
    await store.create(withFile(2));
    await store.update(one.id, (draft) => void (draft.status = "done"));

    const release = backend.hold();
    const writing = sentAgain(store, one.id);
    const arriving = store.create(withFile(3), { filesOptional: true });
    await wait(20);
    release();
    await writing;
    // (Its file was to make the room, but it is open now: it is the new report's file that is left out.)
    expect((await arriving).refused).toEqual(["pic31"]);
    expect((await store.file(one.id, "pic11"))?.data.length).toBe(big.length);
  });
});

it("tells a change from no change when it is waited for", async () => {
  const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend() });
  const before = store.rev;
  const quiet = await store.waitForChange(before, 30);
  expect(quiet).toBe(before);
  const waiting = store.waitForChange(before, 2000);
  await store.create(report(1));
  expect(await waiting).toBe(before + 1);
  // A revision from before a restart (it is ahead) is answered at once with the one there is.
  expect(await store.waitForChange(before + 50, 2000)).toBe(before + 1);
});

/* ------------------------------ the routes ------------------------------ */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(options: { token?: string | null; accounts?: boolean; maxBytes?: number; maxReports?: number } = {}) {
  const feedback = await FeedbackStore.open({
    backend: new MemoryFeedbackBackend(),
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    ...(options.maxReports ? { maxReports: options.maxReports } : {}),
    log: quiet,
  });
  const accounts = options.accounts ? await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0 }) : undefined;
  const app = await buildApp({
    feedback,
    ...(options.token === null ? {} : { feedbackAdminToken: options.token ?? TOKEN }),
    ...(accounts ? { accounts, passwordCost: { N: 1024, r: 8, p: 1 } } : {}),
  });
  apps.push(app);
  return { app, feedback };
}

type Response = LightMyRequestResponse & { data: any };
const data = (response: LightMyRequestResponse): any => {
  try {
    return response.json();
  } catch {
    return undefined;
  }
};

/** One browser: it keeps its cookie, and sends it back. */
class Client {
  cookie = "";
  constructor(
    private readonly app: FastifyInstance,
    private readonly extra: Record<string, string> = {},
  ) {}

  async call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown): Promise<Response> {
    const response = await this.app.inject({ method, url, headers: { ...this.extra, ...(this.cookie ? { cookie: this.cookie } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
    const set = response.headers["set-cookie"];
    const header = Array.isArray(set) ? set[0] : set;
    if (header) this.cookie = (header.split(";")[0] ?? "").endsWith("=") ? "" : (header.split(";")[0] ?? "");
    return Object.assign(response, { data: data(response) });
  }
  get = (url: string) => this.call("GET", url);
  post = (url: string, payload?: unknown) => this.call("POST", url, payload ?? {});
  patch = (url: string, payload: unknown) => this.call("PATCH", url, payload);
  delete = (url: string) => this.call("DELETE", url);
}

const team = (app: FastifyInstance) => new Client(app, { authorization: `Bearer ${TOKEN}` });

describe("sending a report", () => {
  it("keeps what is sent, answers with a number, and takes the same key as the same report", async () => {
    const { app, feedback } = await start();
    const page = new Client(app);
    const sent = await page.post("/api/feedback", {
      key: key(1),
      kind: "bug",
      area: "subtitles",
      message: "The subtitles are late​\u0007 in the second half",
      details: { steps: "Play the film", expected: "On time", unknown: "x" },
      severity: "annoying",
      frequency: "always",
      attachments: [picture()],
      context: { build: "abc", lang: "en", device: { ua: "Test", viewport: [390, 844] }, trail: ["tap Play"] },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.data).toMatchObject({ id: "1", status: "new", rejected: [] });
    const record = feedback.get("1")!;
    expect(record).toMatchObject({ kind: "bug", area: "subtitles", title: "The subtitles are late in the second half", severity: "annoying", frequency: "always" });
    expect(record.message).toBe("The subtitles are late in the second half");
    expect(record.details).toEqual({ steps: "Play the film", expected: "On time" });
    expect(record.context).toMatchObject({ build: "abc", device: { viewport: [390, 844] }, trail: ["tap Play"] });
    expect(record.files).toMatchObject([{ id: "pic1", mime: "image/png", role: "screenshot", bytes: PNG.length }]);
    // The key itself is not kept.
    expect(JSON.stringify(record)).not.toContain(key(1));

    const again = await page.post("/api/feedback", { key: key(1), kind: "idea", message: "other" });
    expect(again.statusCode).toBe(200);
    expect(again.data).toMatchObject({ id: "1", again: true });
    expect(feedback.size).toBe(1);
  });

  it("never loses a report to a detail: what it does not know is other, unsure, or left out", async () => {
    const { app, feedback } = await start();
    const sent = await new Client(app).post("/api/feedback", {
      key: key(1),
      kind: "complaint",
      area: "the-moon",
      message: "Words",
      severity: "dreadful",
      context: { build: "abc", device: { screen: "wide" }, trail: "not a list", playback: { state: "playing", time: 12 } },
      attachments: [picture("bad1", Buffer.from("MZ not a picture at all\0\0\0")), { nonsense: true }, picture("ok01", JPEG, { mime: "image/jpeg" })],
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.data.rejected).toEqual([
      { id: "bad1", reason: "bad_type" },
      { id: "", reason: "bad_type" },
    ]);
    const record = feedback.get(sent.data.id)!;
    expect(record).toMatchObject({ kind: "other", area: "unsure" });
    expect(record.severity).toBeUndefined();
    expect(record.context).toEqual({ build: "abc", playback: { state: "playing", time: 12 } });
    expect(record.contextDropped?.sort()).toEqual(["device", "trail"]);
    expect(record.files.map((file) => [file.id, file.mime])).toEqual([["ok01", "image/jpeg"]]);
  });

  it("takes a picture for what it is and not for what it is called, and logs as text", async () => {
    const { app, feedback } = await start();
    const sent = await new Client(app).post("/api/feedback", {
      key: key(1),
      message: "Logs",
      attachments: [
        picture("one1", JPEG, { mime: "image/png", name: "../../etc/passwd" }),
        { id: "log1", name: "log.json", mime: "application/json", role: "file", data: Buffer.from('{"a":1}').toString("base64") },
        { id: "log2", name: "notes.txt", mime: "application/json", role: "file", data: Buffer.from("not json at all").toString("base64") },
      ],
    });
    expect(sent.statusCode).toBe(201);
    const files = feedback.get(sent.data.id)!.files;
    expect(files.map((file) => [file.id, file.mime, file.role])).toEqual([
      ["one1", "image/jpeg", "screenshot"],
      ["log1", "application/json", "file"],
      ["log2", "text/plain", "file"],
    ]);
    expect(files[0]?.name).not.toMatch(/[\\/]/);
  });

  it("takes a report that is only a picture, and none that is nothing", async () => {
    const { app, feedback } = await start();
    const page = new Client(app);
    const empty = await page.post("/api/feedback", { key: key(1), message: "   ", attachments: [] });
    expect(empty.statusCode).toBe(400);
    expect(empty.data.error).toBe("empty");
    expect((await page.post("/api/feedback", { key: "short" })).statusCode).toBe(400);
    expect((await page.post("/api/feedback", { message: "no key" })).statusCode).toBe(400);
    const picturesOnly = await page.post("/api/feedback", { key: key(2), attachments: [picture()] });
    expect(picturesOnly.statusCode).toBe(201);
    expect(feedback.get(picturesOnly.data.id)?.title).toBe("(no text)");
    // (A picture that is rejected leaves nothing to keep.)
    const none = await page.post("/api/feedback", { key: key(3), attachments: [picture("big1", Buffer.concat([PNG, Buffer.alloc(FEEDBACK_LIMITS.imageBytes)]))] });
    expect(none.statusCode).toBe(400);
    expect(none.data.rejected).toEqual([{ id: "big1", reason: "too_big" }]);
    expect(feedback.size).toBe(1);
  });

  it("keeps the pictures of one report within what is allowed for it", async () => {
    const { app, feedback } = await start();
    const chunk = Buffer.concat([PNG, Buffer.alloc(1_300_000)]);
    const sent = await new Client(app).post("/api/feedback", { key: key(1), message: "Many", attachments: ["a001", "a002", "a003", "a004", "a005"].map((id) => picture(id, chunk)) });
    expect(sent.statusCode).toBe(201);
    const kept = feedback.get(sent.data.id)!.files;
    expect(kept.reduce((sum, file) => sum + file.bytes, 0)).toBeLessThanOrEqual(FEEDBACK_LIMITS.totalBytes);
    expect(kept.map((file) => file.id)).toEqual(["a001", "a002", "a003", "a004"]);
    expect(sent.data.rejected).toEqual([{ id: "a005", reason: "too_big" }]);
    // (More than a request may carry is turned away whole, before anything is read.)
    const huge = await new Client(app).post("/api/feedback", { key: key(2), message: "Too much", attachments: ["b001", "b002", "b003", "b004", "b005", "b006"].map((id) => picture(id, chunk)) });
    expect(huge.statusCode).toBe(413);
  });

  it("turns a report away with a 503, not a 429, when every report kept is open and the store is full; the team closing one makes room", async () => {
    const { app, feedback } = await start({ maxReports: 2 });
    const page = new Client(app);
    const send = (n: number) => page.post("/api/feedback", { key: key(n), message: `It broke ${n}` });
    expect((await send(1)).statusCode).toBe(201);
    expect((await send(2)).statusCode).toBe(201);

    const refused = await send(3);
    expect(refused.statusCode).toBe(503);
    expect(refused.data).toEqual({ error: "full" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(feedback.size).toBe(2);
    expect([feedback.byKey(key(1))?.status, feedback.byKey(key(2))?.status, feedback.byKey(key(3))]).toEqual(["new", "new", undefined]);

    expect((await team(app).patch("/api/admin/feedback/1", { status: "done" })).statusCode).toBe(200);
    const taken = await send(3);
    expect(taken.statusCode).toBe(201);
    expect(taken.data).toMatchObject({ id: "3", rejected: [] });
    expect([feedback.get("1"), feedback.get("2")?.status, feedback.size]).toEqual([undefined, "new", 2]);
  });

  it("keeps the words of a report and says which of its pictures were left out when the room for pictures is taken by reports that are open", async () => {
    const chunk = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    // Room for the words of three reports and one picture of this size.
    const { app, feedback } = await start({ maxBytes: chunk.length + 3 * 6 * 1024 });
    const page = new Client(app);
    const staff = team(app);

    const first = await page.post("/api/feedback", { key: key(1), message: "With a picture", attachments: [picture("pic1", chunk)] });
    expect(first.data).toMatchObject({ id: "1", rejected: [] });
    const second = await page.post("/api/feedback", { key: key(2), message: "With another", attachments: [picture("pic2", chunk)] });
    expect(second.statusCode).toBe(201);
    expect(second.data.rejected).toEqual([{ id: "pic2", reason: "too_big" }]);
    expect(feedback.get("2")).toMatchObject({ message: "With another", files: [] });
    expect((await staff.get("/api/admin/feedback/1/files/pic1")).statusCode).toBe(200);

    // A report that is only a picture is nothing without it.
    const onlyPicture = await page.post("/api/feedback", { key: key(3), attachments: [picture("pic3", chunk)] });
    expect(onlyPicture.statusCode).toBe(503);
    expect(onlyPicture.data).toEqual({ error: "full" });
    expect(feedback.size).toBe(2);

    // The team closes the first: its picture makes room (its words stay) and the next report keeps its picture.
    await staff.patch("/api/admin/feedback/1", { status: "done" });
    const third = await page.post("/api/feedback", { key: key(3), attachments: [picture("pic3", chunk)] });
    expect(third.data).toMatchObject({ id: "3", rejected: [] });
    expect(feedback.get("1")).toMatchObject({ message: "With a picture" });
    expect((await staff.get("/api/admin/feedback/1/files/pic1")).statusCode).toBe(404);
    expect((await staff.get("/api/admin/feedback/3/files/pic3")).statusCode).toBe(200);
  });

  it("slows down an address that sends many", async () => {
    const { app } = await start();
    const page = new Client(app);
    for (let n = 1; n <= 6; n++) expect((await page.post("/api/feedback", { key: key(n), message: `Report ${n}` })).statusCode).toBe(201);
    const blocked = await page.post("/api/feedback", { key: key(7), message: "Report 7" });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // (A report that was kept can be sent again, it costs nothing.)
    expect((await page.post("/api/feedback", { key: key(1), message: "Report 1" })).statusCode).toBe(200);
  });

  it("counts a try that comes to nothing as well, before the body is read: a request with no words is not free", async () => {
    const { app, feedback } = await start();
    const page = new Client(app);
    for (let n = 1; n <= 30; n++) expect((await page.post("/api/feedback", { key: key(n), attachments: [{ id: "bad" }] })).statusCode).toBe(400);
    const blocked = await page.post("/api/feedback", { key: key(31), attachments: [{ id: "bad" }] });
    expect(blocked.statusCode).toBe(429);
    expect(feedback.size).toBe(0);
    // (Another address has its own.)
    const elsewhere = await app.inject({ method: "POST", url: "/api/feedback", remoteAddress: "198.51.100.7", payload: { key: key(32), message: "From elsewhere" } });
    expect(elsewhere.statusCode).toBe(201);
  });

  it("turns away at once a list of files longer than any page sends, instead of reading each to turn it away", async () => {
    const { app, feedback } = await start();
    const page = new Client(app);
    const files = (count: number) => Array.from({ length: count }, () => ({}));
    const refused = await page.post("/api/feedback", { key: key(1), message: "Many", attachments: files(FEEDBACK_LIMITS.attachments * 4 + 1) });
    expect(refused.statusCode).toBe(400);
    expect(refused.data).toEqual({ error: "invalid_request" });
    expect(feedback.size).toBe(0);
    // (Up to there it is read: the files that are past the limit are said to be too many.)
    const sent = await page.post("/api/feedback", { key: key(2), message: "Some", attachments: files(FEEDBACK_LIMITS.attachments * 4) });
    expect(sent.statusCode).toBe(201);
    expect(sent.data.rejected).toHaveLength(FEEDBACK_LIMITS.attachments * 4);
  });

  it("turns away at once answers to more questions than there are, instead of reading each to leave it out", async () => {
    const { app, feedback } = await start();
    const page = new Client(app);
    const answers = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, n) => [`question${n}`, "a"]));
    const most = FEEDBACK_DETAIL_KEYS.length * 4;
    const refused = await page.post("/api/feedback", { key: key(1), message: "Many", details: answers(most + 1) });
    expect(refused.statusCode).toBe(400);
    expect(refused.data).toEqual({ error: "invalid_request" });
    expect(feedback.size).toBe(0);
    // (Up to there it is read, and the questions there are get their answers.)
    const sent = await page.post("/api/feedback", { key: key(2), message: "Some", details: { ...answers(most - 1), steps: "Open it" } });
    expect(sent.statusCode).toBe(201);
    expect(feedback.get(sent.data.id)?.details).toEqual({ steps: "Open it" });
    // (Answers that are not a set of answers are read as none, as they always were: they are not too many.)
    expect((await page.post("/api/feedback", { key: key(3), message: "Text", details: "x".repeat(500) })).statusCode).toBe(201);
    expect((await page.post("/api/feedback", { key: key(4), message: "List", details: Array.from({ length: 500 }, () => "x") })).statusCode).toBe(201);
  });

  it("does the same for an answer: the list is turned away at once, and every try is counted before the body is read", async () => {
    const { app } = await start();
    const page = new Client(app);
    const refused = await page.post("/api/feedback/reply", { key: key(1), text: "More", attachments: Array.from({ length: FEEDBACK_LIMITS.attachments * 4 + 1 }, () => ({})) });
    expect(refused.statusCode).toBe(400);
    expect(refused.data).toEqual({ error: "invalid_request" });
    // (That was the first of thirty tries; a body that is not even an object is one as well.)
    for (let n = 2; n <= 30; n++) expect((await page.post("/api/feedback/reply", [])).statusCode).toBe(400);
    expect((await page.post("/api/feedback/reply", [])).statusCode).toBe(429);
  });

  it("does not read a file that is longer than a file can be, nor one that is only called text", async () => {
    const { app } = await start();
    const page = new Client(app);
    const longest = Math.ceil((FEEDBACK_LIMITS.imageBytes * 4) / 3) + 5;
    const answer = await page.post("/api/feedback", {
      key: key(1),
      message: "Files",
      attachments: [
        { id: "long1", name: "x", mime: "text/plain", role: "file", data: "A".repeat(longest) },
        { id: "bin01", name: "x", mime: "text/plain", role: "file", data: Buffer.from([1, 2, 0, 3]).toString("base64") },
        { id: "big01", name: "x", mime: "text/plain", role: "file", data: Buffer.alloc(FEEDBACK_LIMITS.fileBytes + 1, "a").toString("base64") },
        { id: "ok001", name: "x", mime: "text/plain", role: "file", data: Buffer.from("fine").toString("base64") },
      ],
    });
    expect(answer.statusCode).toBe(201);
    expect(answer.data.rejected).toEqual([
      { id: "long1", reason: "too_big" },
      { id: "bin01", reason: "bad_type" },
      { id: "big01", reason: "too_big" },
    ]);
  });
});

describe("hearing back", () => {
  it("shows the sender their report and the team's lines, marks them read, and takes their answer", async () => {
    const { app } = await start();
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), kind: "bug", area: "player", message: "It stops", attachments: [picture()] });
    const staff = team(app);
    const asked = await staff.post("/api/admin/feedback/1/reply", { text: "Which film was it?", ask: true });
    expect(asked.statusCode).toBe(201);
    expect(asked.data.status).toBe("needs_info");
    await staff.patch("/api/admin/feedback/1", { tags: ["Player"], note: "looks like the stall" });

    const checked = await page.post("/api/feedback/check", { keys: [key(1), key(9)] });
    expect(checked.data.items).toMatchObject([{ key: key(1), id: "1", status: "needs_info", unread: 1 }]);
    const opened = await page.post("/api/feedback/open", { key: key(1) });
    expect(opened.statusCode).toBe(200);
    expect(opened.data).toMatchObject({ id: "1", message: "It stops", status: "needs_info", attachments: [{ id: "pic1", role: "screenshot" }], messages: [{ from: "team", text: "Which film was it?", asks: true }] });
    // What the team keeps for itself is not in it.
    expect(JSON.stringify(opened.data)).not.toMatch(/stall|tags|note/i);
    expect((await page.post("/api/feedback/check", { keys: [key(1)] })).data.items[0].unread).toBe(0);

    const answered = await page.post("/api/feedback/reply", { key: key(1), text: "Any film", attachments: [picture("pic2", JPEG, { mime: "image/jpeg" })] });
    expect(answered.statusCode).toBe(201);
    expect(answered.data.message).toMatchObject({ from: "you", text: "Any film" });
    const seen = (await staff.get("/api/admin/feedback/1")).data;
    expect(seen).toMatchObject({ status: "in_review", waiting: true, tags: ["player"], note: "looks like the stall" });
    expect(seen.messages.map((line: { from: string }) => line.from)).toEqual(["team", "user"]);
    expect(seen.attachments.map((file: { id: string }) => file.id)).toEqual(["pic1", "pic2"]);
  });

  it("does not show a report to anyone but who sent it", async () => {
    const { app } = await start();
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), message: "Mine" });
    const stranger = new Client(app);
    expect((await stranger.post("/api/feedback/open", { key: key(2) })).statusCode).toBe(404);
    expect((await stranger.post("/api/feedback/open", { id: "1" })).statusCode).toBe(404);
    expect((await stranger.post("/api/feedback/reply", { id: "1", text: "hi" })).statusCode).toBe(404);
    expect((await stranger.post("/api/feedback/open", { key: "x" })).statusCode).toBe(400);
    expect((await stranger.get("/api/feedback/mine")).statusCode).toBe(401);
  });

  it("keeps a report that asked for no answer out of every way of reading it back", async () => {
    const { app } = await start();
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), message: "No answer please", answer: false });
    expect((await page.post("/api/feedback/open", { key: key(1) })).statusCode).toBe(404);
    expect((await page.post("/api/feedback/check", { keys: [key(1)] })).data.items).toEqual([]);
    expect((await team(app).post("/api/admin/feedback/1/reply", { text: "Hello?" })).statusCode).toBe(409);
  });

  it("opens a closed report again when its sender writes", async () => {
    const { app } = await start();
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), message: "Broken" });
    await team(app).patch("/api/admin/feedback/1", { status: "done" });
    await page.post("/api/feedback/reply", { key: key(1), text: "Still broken" });
    expect((await team(app).get("/api/admin/feedback/1")).data.status).toBe("in_review");
  });

  it("lists a signed-in account's reports on every device it is signed in on, by number and without the key", async () => {
    const { app } = await start({ accounts: true });
    const phone = new Client(app);
    expect((await phone.post("/api/auth/register", { email: "a@example.com", password: "correct horse" })).statusCode).toBe(201);
    await phone.post("/api/feedback", { key: key(1), message: "From the phone" });
    await phone.post("/api/feedback", { key: key(2), message: "Not for an answer", answer: false });
    const laptop = new Client(app);
    expect((await laptop.post("/api/auth/login", { email: "a@example.com", password: "correct horse" })).statusCode).toBe(200);
    const mine = await laptop.get("/api/feedback/mine");
    expect(mine.data.items).toMatchObject([{ id: "1", title: "From the phone" }]);
    expect((await laptop.post("/api/feedback/open", { id: "1" })).data.message).toBe("From the phone");
    expect((await laptop.post("/api/feedback/reply", { id: "1", text: "And from the laptop" })).statusCode).toBe(201);
    // Another account has none of them.
    const other = new Client(app);
    await other.post("/api/auth/register", { email: "b@example.com", password: "correct horse" });
    expect((await other.get("/api/feedback/mine")).data.items).toEqual([]);
    expect((await other.post("/api/feedback/open", { id: "1" })).statusCode).toBe(404);
    expect((await team(app).get("/api/admin/feedback/1")).data).toMatchObject({ signedIn: true });
    expect((await team(app).get("/api/admin/feedback/2")).data).toMatchObject({ signedIn: false });
  });
});

describe("the team's side", () => {
  it("is not there without a token, or with one that is too short", async () => {
    for (const token of [null, "short"]) {
      const { app } = await start({ token });
      await new Client(app).post("/api/feedback", { key: key(1), message: "Hello" });
      const response = await new Client(app, { authorization: `Bearer ${token ?? "x"}` }).get("/api/admin/feedback");
      expect(response.statusCode).toBe(404);
      expect((await app.inject("/api/health")).json().feedback).toEqual({ reports: 1, team: false });
    }
  });

  it("wants the token, and slows down an address that guesses", async () => {
    const { app } = await start();
    expect((await new Client(app).get("/api/admin/feedback")).statusCode).toBe(401);
    expect((await new Client(app, { authorization: "Bearer nope" }).get("/api/admin/feedback")).statusCode).toBe(401);
    expect((await new Client(app, { authorization: `Basic ${TOKEN}` }).get("/api/admin/feedback")).statusCode).toBe(401);
    expect((await team(app).get("/api/admin/feedback")).statusCode).toBe(200);
    const guesser = new Client(app, { authorization: "Bearer nope-nope-nope-nope-nope-nope" });
    for (let n = 0; n < 7; n++) expect((await guesser.get("/api/admin/feedback")).statusCode).toBe(401);
    // (Ten wrong tries in all; even the right token waits then.)
    expect((await team(app).get("/api/admin/feedback")).statusCode).toBe(429);
    expect((await app.inject("/api/health")).json().feedback).toEqual({ reports: 0, team: true });
  });

  it("lists, filters, reads, downloads, answers, sorts and deletes", async () => {
    const { app } = await start();
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), kind: "bug", area: "player", message: "Video freezes at the end", attachments: [picture(), { id: "log1", name: "log.txt", mime: "text/plain", role: "file", data: Buffer.from("line one\nline two").toString("base64") }] });
    await page.post("/api/feedback", { key: key(2), kind: "idea", area: "party", message: "Let guests pick the film" });
    await page.post("/api/feedback", { key: key(3), kind: "improve", area: "home", message: "Bigger posters" });
    const staff = team(app);
    await staff.patch("/api/admin/feedback/3", { status: "declined" });

    const all = (await staff.get("/api/admin/feedback")).data;
    expect(all.items.map((each: { id: string }) => each.id)).toEqual(["3", "2", "1"]);
    expect((await staff.get("/api/admin/feedback?status=open")).data.items.map((each: { id: string }) => each.id)).toEqual(["2", "1"]);
    expect((await staff.get("/api/admin/feedback?kind=idea")).data.items).toMatchObject([{ id: "2", area: "party" }]);
    expect((await staff.get("/api/admin/feedback?area=player&q=FREEZES")).data.items).toMatchObject([{ id: "1", files: 2 }]);
    expect((await staff.get("/api/admin/feedback?q=freezes+posters")).data.items).toEqual([]);

    const one = (await staff.get("/api/admin/feedback/1")).data;
    expect(one).toMatchObject({ message: "Video freezes at the end", waiting: true, attachments: [{ id: "pic1" }, { id: "log1" }] });
    const download = await app.inject({ method: "GET", url: "/api/admin/feedback/1/files/pic1", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("image/png");
    expect(download.headers["content-disposition"]).toBe("attachment");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.rawPayload.equals(PNG)).toBe(true);
    expect((await staff.get("/api/admin/feedback/1/files/nope")).statusCode).toBe(404);
    expect((await staff.get("/api/admin/feedback/99")).statusCode).toBe(404);

    const answered = await staff.post("/api/admin/feedback/1/reply", { text: "Fixed in the next version", status: "done" });
    expect(answered.data.status).toBe("done");
    expect((await staff.get("/api/admin/feedback?waiting=1")).data.items.map((each: { id: string }) => each.id)).toEqual(["2"]);
    expect((await staff.delete("/api/admin/feedback/2")).statusCode).toBe(204);
    expect((await staff.delete("/api/admin/feedback/2")).statusCode).toBe(404);
    expect((await staff.post("/api/admin/feedback/1/reply", { text: "" })).statusCode).toBe(400);
    expect((await staff.patch("/api/admin/feedback/1", { status: "great" })).statusCode).toBe(400);
  });

  it("waits for something to happen and then says what is open", async () => {
    const { app } = await start();
    const staff = team(app);
    const start0 = (await staff.get("/api/admin/feedback")).data.rev;
    const quiet = await staff.get(`/api/admin/feedback/changes?since=${start0}&wait=0`);
    expect(quiet.data).toMatchObject({ rev: start0, items: [] });
    const waiting = staff.get(`/api/admin/feedback/changes?since=${start0}&wait=5`);
    await wait(30);
    await new Client(app).post("/api/feedback", { key: key(1), message: "Something new" });
    const woke = await waiting;
    expect(woke.data.rev).toBe(start0 + 1);
    expect(woke.data.items).toMatchObject([{ id: "1", waiting: true }]);
    // The sender writing again is a change too; the team answering is one as well.
    const next = staff.get(`/api/admin/feedback/changes?since=${woke.data.rev}&wait=5`);
    await wait(30);
    await new Client(app).post("/api/feedback/reply", { key: key(1), text: "More" });
    expect((await next).data.items).toMatchObject([{ id: "1", lines: 1 }]);
  });
});
