import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_DETAIL_KEYS, FEEDBACK_LIMITS, feedbackClosed } from "../../shared";
import { MemoryPersistence } from "../accounts/persistence";
import { AccountStore } from "../accounts/store";
import { buildApp } from "../app";
import { seeded } from "../robustnessInputs";
import {
  FEEDBACK_MAX_MESSAGES,
  FeedbackFull,
  FileFeedbackBackend,
  FeedbackStore,
  MemoryFeedbackBackend,
  PostgresFeedbackBackend,
  TooManyOpen,
  type FeedbackBackend,
  type FeedbackRecord,
  type NewReport,
} from "./store";

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

  // (A Postgres that is made for each of them takes a second or so, and more on a busy machine.)
  describe("the answers of a sender", { timeout: 30_000 }, () => {
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    const small = Buffer.concat([PNG, Buffer.alloc(1_000)]);
    const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
    const pictureOf = (id: string, data: Buffer = big) => ({ meta: { id, name: "a.png", mime: "image/png" as const, role: "screenshot" as const }, data });
    const closed = (store: FeedbackStore, id: string) => store.update(id, (draft) => void (draft.status = "done"));

    it("are held to the budget as a new report is: a closed report's files make room, the pictures that still do not fit are left out, and the words are kept", async () => {
      const { backend } = await make();
      // Room for the words of four reports and three pictures.
      const store = await FeedbackStore.open({ backend, maxBytes: 3 * big.length + 4 * 6 * 1024, log: quiet });
      const one = (await store.create(withFile(1))).record;
      const two = (await store.create(withFile(2))).record;
      await store.create(withFile(3));
      await closed(store, one.id);

      const added = await store.addMessage(two.id, { from: "user", text: "More", files: [pictureOf("ans1"), pictureOf("ans2")] });
      // (The closed report's picture went for the first; the second does not fit, and is named.)
      expect(added).toMatchObject({ message: { text: "More", files: ["ans1"] }, refused: ["ans2"] });
      expect(store.get(one.id)?.files[0]?.gone).toBe(true);
      expect(store.get(one.id)?.message).toBe("It broke 1");
      expect(store.get(two.id)?.files.map((file) => file.id)).toEqual(["pic21", "ans1"]);
      expect(await backend.getFile(two.id, "ans2")).toBeUndefined();
      expect((await store.file(two.id, "ans1"))?.data.length).toBe(big.length);
      expect(store.bytes).toBe(3 * big.length + 3 * 6 * 1024 + Buffer.byteLength("More"));
    });

    it("are turned away when not even their words fit, and nothing of them is kept; the words go again once a closed report has made room", async () => {
      const { backend } = await make();
      // Room for the words of two reports and one picture, and a hundred bytes.
      const store = await FeedbackStore.open({ backend, maxBytes: big.length + 2 * 6 * 1024 + 100, log: quiet });
      const one = (await store.create(withFile(1))).record;
      const two = (await store.create(report(2))).record;

      await expect(store.addMessage(two.id, { from: "user", text: "w".repeat(150), files: [pictureOf("ans1", small)] })).rejects.toBeInstanceOf(FeedbackFull);
      expect(store.get(two.id)).toMatchObject({ messages: [], files: [] });
      expect(await backend.getFile(two.id, "ans1")).toBeUndefined();
      // (Words that fit are taken, as they were.)
      expect(await store.addMessage(two.id, { from: "user", text: "w".repeat(50) })).toMatchObject({ refused: [] });

      await closed(store, one.id);
      const again = await store.addMessage(two.id, { from: "user", text: "w".repeat(100), files: [pictureOf("ans1", small)] });
      expect(again).toMatchObject({ message: { files: ["ans1"] }, refused: [] });
      expect(store.get(one.id)?.files[0]?.gone).toBe(true);
      expect(store.bytes).toBeLessThanOrEqual(big.length + 2 * 6 * 1024 + 100);
    });

    it("are not the team's: a line from the team is counted but never turned away, because closing reports is what makes room", async () => {
      const { backend } = await make();
      const store = await FeedbackStore.open({ backend, maxBytes: big.length + 2 * 6 * 1024, log: quiet });
      const one = (await store.create(withFile(1))).record;
      const two = (await store.create(report(2))).record;

      // The room is all taken, and the team may still write.
      const asked = await store.addMessage(two.id, { from: "team", text: "Which film?", asks: true, status: "needs_info" });
      expect(asked).toMatchObject({ message: { from: "team", text: "Which film?" }, refused: [] });
      expect(store.bytes).toBe(big.length + 2 * 6 * 1024 + Buffer.byteLength("Which film?"));
      // (The sender, though, is not taken in beyond the budget.)
      await expect(store.addMessage(two.id, { from: "user", text: "Any film" })).rejects.toBeInstanceOf(FeedbackFull);

      await closed(store, one.id);
      expect(await store.addMessage(two.id, { from: "user", text: "Any film" })).toMatchObject({ message: { text: "Any film" } });
      expect(store.get(one.id)?.files[0]?.gone).toBe(true);
    });

    it("do not take the files of the report they are for, though it is closed: the answer opens it again", async () => {
      const { backend } = await make();
      // Room for the words of two reports and one picture, and no more than a hundred bytes.
      const store = await FeedbackStore.open({ backend, maxBytes: big.length + 2 * 6 * 1024 + 100, log: quiet });
      const one = (await store.create(withFile(1))).record;
      await store.create(report(2));
      await closed(store, one.id);

      const added = await store.addMessage(one.id, { from: "user", text: "Again", files: [pictureOf("ans1")], status: "in_review" });
      expect(added).toMatchObject({ message: { text: "Again" }, refused: ["ans1"] });
      expect(store.get(one.id)).toMatchObject({ status: "in_review" });
      expect((await store.file(one.id, "pic11"))?.data.length).toBe(big.length);
    });

    it("are exact when many arrive at once: the room that was found is the room there is", async () => {
      const { backend } = await make();
      // Room for the words of four reports, two pictures, and the four short answers.
      const maxBytes = 4 * 6 * 1024 + 2 * big.length + 4;
      const store = await FeedbackStore.open({ backend, maxBytes, log: quiet });
      const reports: FeedbackRecord[] = [];
      for (const n of [1, 2, 3, 4]) reports.push((await store.create(report(n))).record);

      const added = await Promise.all(reports.map((each, n) => store.addMessage(each.id, { from: "user", text: "x", files: [pictureOf(`ans${n}`)] })));
      expect(added.flatMap((each) => (typeof each === "object" ? each.refused : []))).toHaveLength(2);
      expect(store.list().flatMap((record) => record.files)).toHaveLength(2);
      expect(store.list().flatMap((record) => record.messages)).toHaveLength(4);
      expect(store.bytes).toBeLessThanOrEqual(maxBytes);
    });

    it("count for what they are in the budget: the bytes of every line of a thread, from either side", async () => {
      const { backend } = await make();
      const store = await FeedbackStore.open({ backend, log: quiet });
      const { record } = await store.create(report(1));
      expect(store.bytes).toBe(6 * 1024);
      await store.addMessage(record.id, { from: "user", text: "é".repeat(100) });
      await store.addMessage(record.id, { from: "team", text: "Which film?" });
      expect(store.bytes).toBe(6 * 1024 + 200 + 11);
      // ...and what is taken away is given back.
      await store.remove(record.id);
      expect(store.bytes).toBe(0);
    });
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
    // (And a little for the words of the answer: the lines of a thread count for what they are.)
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024 + 100, log: quiet });
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

  // (The sender's answers are taken in one turn with the new reports, so they cannot open a report in the middle of it; the team's changes are not.)
  const putBack = (store: FeedbackStore, id: string) => store.update(id, (draft) => void (draft.status = "in_review"));

  it("leaves a report alone that the team put back in review before its turn came, for its place", async () => {
    const backend = new SlowSave();
    const store = await FeedbackStore.open({ backend, maxReports: 2, log: quiet });
    const one = (await store.create(report(1))).record;
    await store.create(report(2));
    await store.update(one.id, (draft) => void (draft.status = "done"));

    const release = backend.hold();
    const writing = putBack(store, one.id);
    const arriving = expect(store.create(report(3))).rejects.toBeInstanceOf(FeedbackFull);
    await wait(20);
    release();
    await writing;
    await arriving;
    expect(store.get(one.id)).toMatchObject({ status: "in_review" });
    expect(store.size).toBe(2);
  });

  it("does the same for its files", async () => {
    const backend = new SlowSave();
    const store = await FeedbackStore.open({ backend, maxBytes: 2 * big.length + 3 * 6 * 1024, log: quiet });
    const one = (await store.create(withFile(1))).record;
    await store.create(withFile(2));
    await store.update(one.id, (draft) => void (draft.status = "done"));

    const release = backend.hold();
    const writing = putBack(store, one.id);
    const arriving = store.create(withFile(3), { filesOptional: true });
    await wait(20);
    release();
    await writing;
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

describe("the reports one sender has open", () => {
  const from = (address: string, n: number) => report(n, { from: address });
  const most = { maxOpen: 3 };

  it("are no more than a sender may have: the next is turned away, another sender is not, and what is closed or gone is not counted", async () => {
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), log: quiet });
    for (const n of [1, 2, 3]) await store.create(from("sender-a", n), most);
    await expect(store.create(from("sender-a", 4), most)).rejects.toBeInstanceOf(TooManyOpen);
    expect(store.size).toBe(3);
    expect(store.byKey(key(4))).toBeUndefined();
    // (A report that is sent again is the same report: it is not another one open. A sender of another address, and one with no address, have their own.)
    expect((await store.create(from("sender-a", 1), most)).created).toBe(false);
    expect((await store.create(from("sender-b", 5), most)).created).toBe(true);
    expect((await store.create(report(6), most)).created).toBe(true);

    // A report the team plans is still open; one it has closed, or deleted, is not.
    await store.update("1", (draft) => void (draft.status = "planned"));
    await expect(store.create(from("sender-a", 4), most)).rejects.toBeInstanceOf(TooManyOpen);
    await store.update("1", (draft) => void (draft.status = "duplicate"));
    expect((await store.create(from("sender-a", 4), most)).created).toBe(true);
    await expect(store.create(from("sender-a", 7), most)).rejects.toBeInstanceOf(TooManyOpen);
    await store.remove("2");
    expect((await store.create(from("sender-a", 7), most)).created).toBe(true);
    // (With no limit asked for, there is none.)
    expect((await store.create(from("sender-a", 8))).created).toBe(true);
  });

  it("cannot be got past by sending them all at once: they are counted in the turn the report is put in", async () => {
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), log: quiet });
    const arrived = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => store.create(from("sender-a", n), most)));
    expect(arrived.filter((each) => each.status === "fulfilled")).toHaveLength(3);
    expect(arrived.flatMap((each) => (each.status === "rejected" ? [each.reason] : []))).toEqual([expect.any(TooManyOpen), expect.any(TooManyOpen)]);
    expect(store.size).toBe(3);
  });

  it("are counted from the address the report came from, which is never written down: not in the backend, not in what the team reads", async () => {
    const backend = new MemoryFeedbackBackend();
    const store = await FeedbackStore.open({ backend, log: quiet });
    const { record } = await store.create(from("203.0.113.77", 1), most);
    expect(JSON.stringify([...backend.records.values()])).not.toContain("203.0.113.77");
    expect(JSON.stringify(record)).not.toContain("203.0.113.77");
    // (So a server that starts again does not know it: a restart forgives, as it does for the allowances.)
    const restarted = await FeedbackStore.open({ backend, log: quiet });
    for (const n of [2, 3, 4]) await restarted.create(from("203.0.113.77", n), most);
    await expect(restarted.create(from("203.0.113.77", 5), most)).rejects.toBeInstanceOf(TooManyOpen);
  });

  it("are counted from an address that is kept only as long as its report is: one taken out, or given up for a place, takes the address along", async () => {
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxReports: 2, log: quiet });
    // (The addresses are in the store's memory and nowhere else, so that is where this looks.)
    const remembered = () => [...(store as unknown as { senders: Map<string, string> }).senders.keys()];
    await store.create(from("203.0.113.77", 1), most);
    await store.create(from("203.0.113.78", 2), most);
    expect(remembered()).toEqual(["1", "2"]);
    await store.remove("1");
    expect(remembered()).toEqual(["2"]);
    await store.update("2", (draft) => void (draft.status = "done"));
    await store.create(from("203.0.113.79", 3), most);
    await store.create(from("203.0.113.80", 4), most);
    expect(store.get("2")).toBeUndefined();
    expect(remembered()).toEqual(["3", "4"]);
  });
});

describe("whether a new report would be turned away", () => {
  const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
  const withFile = (n: number) => report(n, { files: [{ meta: { id: `pic${n}1`, name: "a.png", mime: "image/png", role: "screenshot" }, data: big }] });
  const closed = (store: FeedbackStore, id: string) => store.update(id, (draft) => void (draft.status = "done"));

  it("is when the reports that are open take every place, and not when one that is closed can make a place", async () => {
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxReports: 2, log: quiet });
    expect(store.full).toBe(false);
    await store.create(report(1));
    expect(store.full).toBe(false);
    await store.create(report(2));
    expect(store.full).toBe(true);
    await closed(store, "1");
    expect(store.full).toBe(false);
    expect((await store.create(report(3))).created).toBe(true);
    expect(store.full).toBe(true);
  });

  it("is when the reports that are open take all the room, and not when the files of ones that are closed can make it", async () => {
    // Room for the words of two reports and one picture.
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxBytes: big.length + 2 * 6 * 1024, log: quiet });
    await store.create(withFile(1));
    expect(store.full).toBe(false);
    await store.create(report(2));
    expect(store.full).toBe(true);
    await closed(store, "1");
    expect(store.full).toBe(false);
  });

  it("counts the places that a closed report makes whole, with its words", async () => {
    // Two places, both taken, one of them by a report that is closed; room for the words of three reports but a thousand bytes.
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxReports: 2, maxBytes: 3 * 6 * 1024 - 1000, log: quiet });
    await store.create(report(1));
    await store.create(report(2));
    expect(store.full).toBe(true);
    await closed(store, "1");
    // (The new report takes the place of the closed one, words and all.)
    expect(store.full).toBe(false);
    expect((await store.create(report(3))).created).toBe(true);
    expect(store.list().map((each) => each.id).sort()).toEqual(["2", "3"]);
  });
});

it("says in its log which limit it turned a report, or an answer, away at: the places or the room", async () => {
  const told: string[] = [];
  const log = { warn: (line: string) => void told.push(line) };
  const places = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxReports: 1, log });
  await places.create(report(1));
  await expect(places.create(report(2))).rejects.toBeInstanceOf(FeedbackFull);
  const room = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxBytes: 6 * 1024, log });
  const { record } = await room.create(report(1));
  await expect(room.create(report(2))).rejects.toBeInstanceOf(FeedbackFull);
  await expect(room.addMessage(record.id, { from: "user", text: "More" })).rejects.toBeInstanceOf(FeedbackFull);
  expect(told).toEqual([
    expect.stringMatching(/^Feedback: turned a report away: all 1 places are taken by reports that are still open/),
    expect.stringMatching(/^Feedback: turned a report away: all the room \(\d+ MB\) is taken by reports that are still open/),
    expect.stringMatching(/^Feedback: turned an answer away: all the room \(\d+ MB\) is taken by reports that are still open/),
  ]);
});

describe("the budget, whatever mix of reports and answers comes", () => {
  const FILE_SIZES = [0, 1_000, 5_000, 12_000, 25_000];

  it("is never passed: a seeded run of reports, answers and closings, with the files kept and counted exactly, and `full` saying what a report would meet", async () => {
    // (A budget that is nearly always spent, and ones that are spent now and then.)
    for (const [seed, maxBytes] of [[11, 90_000], [12, 150_000], [13, 250_000], [14, 400_000]] as const) {
      const next = seeded(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
      const backend = new MemoryFeedbackBackend();
      const store = await FeedbackStore.open({ backend, maxBytes, maxReports: 8, log: quiet });
      let reports = 0;
      let files = 0;
      const someFiles = () =>
        Array.from({ length: Math.floor(next() * 3) }, () => ({
          meta: { id: `file${++files}`, name: "a.png", mime: "image/png" as const, role: "screenshot" as const },
          data: Buffer.concat([PNG, Buffer.alloc(pick(FILE_SIZES))]),
        }));
      const answer = async (id: string) => {
        const record = store.get(id)!;
        const attached = someFiles();
        const text = "w".repeat(attached.length === 0 ? 1 + Math.floor(next() * 3000) : Math.floor(next() * 3000));
        const status = feedbackClosed(record.status) ? ("in_review" as const) : undefined;
        await store.addMessage(id, { from: "user", text, files: attached, ...(status ? { status } : {}) });
      };
      /** A thing that may be turned away for want of room, and nothing else. */
      const unlessFull = async (job: () => Promise<unknown>): Promise<boolean> => {
        try {
          await job();
          return false;
        } catch (error) {
          if (!(error instanceof FeedbackFull)) throw error;
          return true;
        }
      };
      const step = async () => {
        const ids = store.list().map((each) => each.id);
        const roll = next();
        if (roll < 0.35 || ids.length === 0) {
          const attached = someFiles();
          const n = ++reports;
          const made = report(n, { message: "w".repeat(1 + Math.floor(next() * 4000)), files: attached });
          const predicted = attached.length === 0 ? store.full : undefined;
          const turnedAway = await unlessFull(() => store.create(made, { filesOptional: next() < 0.7 }));
          if (predicted !== undefined) expect(turnedAway, `full said ${predicted}`).toBe(predicted);
        } else if (roll < 0.75) {
          await unlessFull(() => answer(pick(ids)));
        } else if (roll < 0.85) {
          // (Several at once.)
          await Promise.all([pick(ids), pick(ids), pick(ids)].map((id) => unlessFull(() => answer(id))));
        } else if (roll < 0.95) {
          await store.update(pick(ids), (draft) => void (draft.status = pick(["done", "declined", "in_review", "needs_info", "planned"] as const)));
        } else {
          await store.remove(pick(ids));
        }
      };
      for (let round = 0; round < 150; round++) {
        await step();
        expect(store.bytes, `seed ${seed}, round ${round}`).toBeLessThanOrEqual(maxBytes);
        // Every file that is kept is in the backend, and nothing else is.
        const kept = store.list().flatMap((record) => record.files.filter((file) => !file.gone).map((file) => `${record.id}/${file.id}`));
        expect([...backend.files.keys()].sort(), `seed ${seed}, round ${round}`).toEqual(kept.sort());
      }
    }
  });

  it("holds the words of a sender's answers to it as well as the files: a thread is not a way past it", async () => {
    // Room for the words of a report and two answers of the longest kind (and a little).
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), maxBytes: 6 * 1024 + 2 * FEEDBACK_LIMITS.text + 100, log: quiet });
    const { record } = await store.create(report(1));
    const long = "w".repeat(FEEDBACK_LIMITS.text);
    expect(await store.addMessage(record.id, { from: "user", text: long })).toMatchObject({ refused: [] });
    expect(await store.addMessage(record.id, { from: "user", text: long })).toMatchObject({ refused: [] });
    await expect(store.addMessage(record.id, { from: "user", text: long })).rejects.toBeInstanceOf(FeedbackFull);
    expect(store.get(record.id)?.messages).toHaveLength(2);
    expect(store.bytes).toBeLessThanOrEqual(6 * 1024 + 2 * FEEDBACK_LIMITS.text + 100);
  });

  it("counts a thread as long as a thread can be, with the longest lines, for what it comes to", async () => {
    const store = await FeedbackStore.open({ backend: new MemoryFeedbackBackend(), log: quiet });
    const { record } = await store.create(report(1));
    for (let line = 0; line < FEEDBACK_MAX_MESSAGES; line++) await store.addMessage(record.id, { from: "team", text: "x".repeat(FEEDBACK_LIMITS.text * 2) });
    expect(await store.addMessage(record.id, { from: "user", text: "One more" })).toBe("full");
    expect(store.bytes).toBe(6 * 1024 + FEEDBACK_MAX_MESSAGES * FEEDBACK_LIMITS.text * 2);
  });
});

/* ------------------------------ the routes ------------------------------ */

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(options: { token?: string | null; accounts?: boolean; maxBytes?: number; maxReports?: number; sendsPer10Min?: number } = {}) {
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
    ...(options.sendsPer10Min ? { feedbackSendsPer10Min: options.sendsPer10Min } : {}),
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

  it("gives the allowances back when the store cannot take a report: a full store does not use up the address's, nor everybody's", async () => {
    // (The clock is the limiters' own: it is set before they are made, and moved to get past the ten minutes.)
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { app } = await start({ maxReports: 1 });
      const sendFrom = (address: string, n: number) => app.inject({ method: "POST", url: "/api/feedback", remoteAddress: address, payload: { key: key(n), message: `Report ${n}` } });
      const staff = team(app);
      let n = 0;
      expect((await sendFrom("198.51.100.1", ++n)).statusCode).toBe(201); // (the only place)
      // More tries that are turned away than any allowance holds: 6 in ten minutes from an address, 42 in a day, and 200 in an hour from everybody.
      for (let address = 2; address <= 8; address++) {
        for (let each = 0; each < 30; each++) expect((await sendFrom(`198.51.100.${address}`, ++n)).statusCode).toBe(503);
      }
      vi.setSystemTime(Date.now() + 11 * 60_000);
      for (let each = 0; each < 15; each++) expect((await sendFrom("198.51.100.2", ++n)).statusCode).toBe(503);

      // The team closes the report: an address that has not sent anything else is taken at once, and so is the one that tried 45 times.
      await staff.patch("/api/admin/feedback/1", { status: "done" });
      expect((await sendFrom("198.51.100.9", ++n)).statusCode).toBe(201);
      await staff.patch("/api/admin/feedback/2", { status: "done" });
      expect((await sendFrom("198.51.100.2", ++n)).statusCode).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns the report that would be one too many open from an address away with a 429 of its own, while another address still sends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { app, feedback } = await start();
      const sendFrom = (address: string, n: number) => app.inject({ method: "POST", url: "/api/feedback", remoteAddress: address, payload: { key: key(n), message: `Report ${n}` } });
      // Six reports: what an address may send in ten minutes, and what it may have open.
      for (let n = 1; n <= 6; n++) expect((await sendFrom("198.51.100.1", n)).statusCode).toBe(201);
      vi.setSystemTime(Date.now() + 11 * 60_000);

      // Ten minutes on it may send again, but the team has not dealt with any of the six. (A refused try does not use up the allowance: it stays what it is.)
      for (let n = 7; n <= 14; n++) {
        const refused = await sendFrom("198.51.100.1", n);
        expect([refused.statusCode, refused.json()]).toEqual([429, { error: "too_many_open" }]);
        expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      }
      expect(feedback.size).toBe(6);
      expect((await sendFrom("198.51.100.2", 15)).statusCode).toBe(201);

      // One closed makes room for one.
      expect((await team(app).patch("/api/admin/feedback/3", { status: "declined" })).statusCode).toBe(200);
      expect((await sendFrom("198.51.100.1", 16)).statusCode).toBe(201);
      expect((await sendFrom("198.51.100.1", 17)).json()).toEqual({ error: "too_many_open" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an address have as many open as it may send in ten minutes when that is more than six: the cap goes with the allowance", async () => {
    const { app, feedback } = await start({ sendsPer10Min: 20 });
    const page = new Client(app);
    for (let n = 1; n <= 12; n++) expect((await page.post("/api/feedback", { key: key(n), message: `Report ${n}` })).statusCode).toBe(201);
    expect(feedback.size).toBe(12);
  });

  it("says in /api/health when a new report would be turned away", async () => {
    const { app } = await start({ maxReports: 2 });
    const page = new Client(app);
    const health = async () => (await app.inject("/api/health")).json().feedback;
    expect(await health()).toEqual({ reports: 0, full: false, team: true });
    await page.post("/api/feedback", { key: key(1), message: "One" });
    expect(await health()).toEqual({ reports: 1, full: false, team: true });
    await page.post("/api/feedback", { key: key(2), message: "Two" });
    expect(await health()).toEqual({ reports: 2, full: true, team: true });
    await team(app).patch("/api/admin/feedback/1", { status: "done" });
    expect(await health()).toEqual({ reports: 2, full: false, team: true });
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

  it("keeps the words of an answer and says which of its pictures were left out when the room for pictures is taken by reports that are open", async () => {
    const chunk = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    // Room for the words of three reports and one picture of this size.
    const { app, feedback } = await start({ maxBytes: chunk.length + 3 * 6 * 1024 });
    const page = new Client(app);
    const staff = team(app);
    await page.post("/api/feedback", { key: key(1), message: "With a picture", attachments: [picture("pic1", chunk)] });
    await page.post("/api/feedback", { key: key(2), message: "Words only" });

    const answered = await page.post("/api/feedback/reply", { key: key(2), text: "More", attachments: [picture("pic2", chunk)] });
    expect(answered.statusCode).toBe(201);
    expect(answered.data.message).toMatchObject({ from: "you", text: "More" });
    expect(answered.data.rejected).toEqual([{ id: "pic2", reason: "too_big" }]);
    expect(feedback.get("2")).toMatchObject({ files: [], messages: [{ text: "More" }] });
    expect((await staff.get("/api/admin/feedback/1/files/pic1")).statusCode).toBe(200);
    expect(feedback.bytes).toBeLessThanOrEqual(chunk.length + 3 * 6 * 1024);

    // The team closes the first: its picture makes room (its words stay) and the next answer keeps its picture.
    await staff.patch("/api/admin/feedback/1", { status: "done" });
    const next = await page.post("/api/feedback/reply", { key: key(2), text: "Again", attachments: [picture("pic3", chunk)] });
    expect(next.data.rejected).toEqual([]);
    expect((await staff.get("/api/admin/feedback/2/files/pic3")).statusCode).toBe(200);
    expect((await staff.get("/api/admin/feedback/1/files/pic1")).statusCode).toBe(404);
    expect(feedback.get("1")).toMatchObject({ message: "With a picture" });
  });

  it("turns an answer away with a 503 when not even its words fit, and keeps nothing of it; the team closing a report makes room", async () => {
    const chunk = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    // Room for the words of two reports and one picture, and not a byte more.
    const { app, feedback } = await start({ maxBytes: chunk.length + 2 * 6 * 1024 });
    const page = new Client(app);
    await page.post("/api/feedback", { key: key(1), message: "With a picture", attachments: [picture("pic1", chunk)] });
    await page.post("/api/feedback", { key: key(2), message: "Words only" });

    const refused = await page.post("/api/feedback/reply", { key: key(2), text: "More" });
    expect(refused.statusCode).toBe(503);
    expect(refused.data).toEqual({ error: "full" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(feedback.get("2")).toMatchObject({ messages: [], status: "new" });

    await team(app).patch("/api/admin/feedback/1", { status: "done" });
    expect((await page.post("/api/feedback/reply", { key: key(2), text: "More" })).statusCode).toBe(201);
    expect(feedback.get("2")?.messages).toHaveLength(1);
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
      expect((await app.inject("/api/health")).json().feedback).toEqual({ reports: 1, full: false, team: false });
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
    expect((await app.inject("/api/health")).json().feedback).toEqual({ reports: 0, full: false, team: true });
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
