import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilePersistence, MemoryPersistence, PostgresPersistence, type Persistence } from "../accounts/persistence";
import { dayOf, MAX_VISITORS_A_DAY, VisitCounter, visitsPersistenceFor } from "./visits";

const HOUR = 3600 * 1000;
let clock = 0;
beforeEach(() => {
  clock = Date.parse("2026-11-01T10:00:00Z");
});
const now = () => clock;
const open = (persistence: Persistence = new MemoryPersistence()) => VisitCounter.open({ persistence, now, flushMs: 0 });

const PHONE = "Mozilla/5.0 (Linux; Android 10; K) Chrome/156.0 Mobile Safari/537.36";
const LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0 Safari/537.36";

describe("counting visitors", () => {
  it("counts a visitor once a day however often they load the page, and every load", async () => {
    const counter = await open();
    counter.count("203.0.113.7", PHONE, "ro");
    counter.count("203.0.113.7", PHONE, "ro");
    counter.count("203.0.113.7", PHONE, "ro");
    counter.count("203.0.113.9", PHONE, "ro"); // another address
    counter.count("203.0.113.7", LAPTOP, "ro"); // the same address, another browser
    counter.count("203.0.113.7", PHONE, "en"); // the same, another language
    expect(counter.records().days.get("2026-11-01")).toEqual({ visitors: 4, loads: 6 });
    expect(counter.records().since).toBe("2026-11-01");
  });

  it("counts the same visitor again on another day, and keeps only the number of the day that is over", async () => {
    const persistence = new MemoryPersistence();
    const counter = await open(persistence);
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.flush();
    expect([...persistence.docs.keys()].sort()).toEqual(["seen:2026-11-01", "visits:2026-11-01"]);
    const yesterday = structuredClone(persistence.docs.get("seen:2026-11-01")) as { salt: string; hashes: string[] };

    clock += 24 * HOUR;
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.flush();
    expect(counter.records().days.get("2026-11-01")).toEqual({ visitors: 1, loads: 1 });
    expect(counter.records().days.get("2026-11-02")).toEqual({ visitors: 1, loads: 1 });
    // the same visitor, with another salt: nothing that was kept can say it was them again
    const today = persistence.docs.get("seen:2026-11-02") as { salt: string; hashes: string[] };
    expect(today.salt).not.toBe(yesterday.salt);
    expect(today.hashes[0]).not.toBe(yesterday.hashes[0]);
    // yesterday's hashes and their salt are gone; its number stays
    expect([...persistence.docs.keys()].sort()).toEqual(["seen:2026-11-02", "visits:2026-11-01", "visits:2026-11-02"]);
  });

  it("forgets a day's hashes when the day is over even if nobody comes", async () => {
    const persistence = new MemoryPersistence();
    const counter = await open(persistence);
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.flush();
    counter.rollOver();
    await counter.flush();
    expect(persistence.docs.has("seen:2026-11-01")).toBe(true); // (still the same day)

    clock += 14 * HOUR; // 2026-11-02 00:00 UTC
    counter.rollOver();
    await counter.flush();
    expect([...persistence.docs.keys()]).toEqual(["visits:2026-11-01"]);
  });

  it("keeps nothing that says who came: no address, no browser, no language, in anything that is written", async () => {
    const persistence = new MemoryPersistence();
    const counter = await open(persistence);
    counter.count("203.0.113.7", PHONE, "ro-RO,ro;q=0.9");
    counter.count("2001:db8::1234", LAPTOP, "en-US");
    await counter.flush();
    const written = JSON.stringify([...persistence.docs.values()]);
    for (const secret of ["203.0.113.7", "2001:db8", "Android", "Windows", "Chrome", "ro-RO", "en-US"]) expect(written).not.toContain(secret);
    const seen = persistence.docs.get("seen:2026-11-01") as { hashes: string[]; salt: string };
    expect(seen.hashes).toHaveLength(2);
    for (const hash of seen.hashes) expect(hash).toMatch(/^[\w-]{16}$/);
    expect(seen.salt.length).toBeGreaterThanOrEqual(24);
  });

  it("does not count a visitor twice when the server restarts in the day, and starts clean the day after", async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    first.count("203.0.113.7", PHONE, "ro");
    await first.close();

    const sameDay = await open(persistence);
    sameDay.count("203.0.113.7", PHONE, "ro");
    sameDay.count("203.0.113.8", PHONE, "ro");
    expect(sameDay.records().days.get("2026-11-01")).toEqual({ visitors: 2, loads: 3 });
    await sameDay.close();

    clock += 24 * HOUR;
    const nextDay = await open(persistence);
    await nextDay.flush();
    // the hashes of the day that is over were deleted as the server started
    expect(persistence.docs.has("seen:2026-11-01")).toBe(false);
    nextDay.count("203.0.113.7", PHONE, "ro");
    expect(nextDay.records().days.get("2026-11-02")).toEqual({ visitors: 1, loads: 1 });
  });

  it("stops adding visitors at the cap for a day (made-up browsers), and goes on counting loads", async () => {
    const counter = await open();
    for (let i = 0; i < MAX_VISITORS_A_DAY + 50; i++) counter.count("198.51.100.1", `bot ${i}`, "en");
    expect(counter.records().days.get("2026-11-01")).toEqual({ visitors: MAX_VISITORS_A_DAY, loads: MAX_VISITORS_A_DAY + 50 });
  });

  it("tries again to write after a failure, and loses nothing", async () => {
    let failing = true;
    const memory = new MemoryPersistence();
    const persistence: Persistence = {
      load: () => memory.load(),
      save: async (changes) => {
        if (failing) throw new Error("the database is asleep");
        await memory.save(changes);
      },
    };
    const warnings: string[] = [];
    const counter = await VisitCounter.open({ persistence, now, flushMs: 0, log: { warn: (message) => warnings.push(message) } });
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.flush();
    expect(warnings).toEqual(["Could not save the visitor counts: the database is asleep"]);
    expect(memory.docs.size).toBe(0);
    failing = false;
    await counter.flush();
    expect([...memory.docs.keys()].sort()).toEqual(["seen:2026-11-01", "visits:2026-11-01"]);
  });

  it("skips a record it cannot read, and says so", async () => {
    const memory = new MemoryPersistence();
    memory.docs.set("visits:2026-10-31", { v: 1, day: "2026-10-31", visitors: 3, loads: 5 });
    memory.docs.set("visits:2026-10-30", { v: 1, day: "2026-10-30", visitors: "many" });
    memory.docs.set("seen:2026-11-01", { v: 1, day: "2026-11-01", salt: "s", hashes: "not a list" });
    const warnings: string[] = [];
    const counter = await VisitCounter.open({ persistence: memory, now, flushMs: 0, log: { warn: (message) => warnings.push(message) } });
    expect(counter.records().days.get("2026-10-31")).toEqual({ visitors: 3, loads: 5 });
    expect(counter.records().days.has("2026-10-30")).toBe(false);
    expect(warnings).toEqual(["Skipped an unreadable record (seen:2026-11-01)."]);
    counter.count("203.0.113.7", PHONE, "ro"); // (starts a salt of its own and writes over the unreadable one)
    await counter.flush();
    expect((memory.docs.get("seen:2026-11-01") as { hashes: string[] }).hashes).toHaveLength(1);
  });

  it("names the day in UTC", () => {
    expect(dayOf(Date.parse("2026-11-01T23:59:59Z"))).toBe("2026-11-01");
    expect(dayOf(Date.parse("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
  });
});

describe("where the counts are kept", () => {
  const folders: string[] = [];
  afterEach(async () => {
    while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
  });

  it("is a table of its own on the accounts' connection, which closing it leaves open", async () => {
    const db = new PGlite();
    let ended = false;
    const accounts = new PostgresPersistence({
      query: (text, params) => db.query(text, params),
      end: async () => {
        ended = true;
      },
    });
    await accounts.load(); // (makes the accounts' table)
    await accounts.save({ put: new Map([["account:a", { id: "a" }]]), remove: new Set() });

    const persistence = visitsPersistenceFor(accounts, "postgres");
    const counter = await open(persistence);
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.close();

    expect(ended).toBe(false);
    const visits = await db.query("select key from kino_visits order by key");
    expect(visits.rows.map((row) => (row as { key: string }).key)).toEqual(["seen:2026-11-01", "visits:2026-11-01"]);
    // the accounts' table has none of it, and the visits' none of the accounts'
    const docs = await db.query("select key from kino_docs");
    expect(docs.rows.map((row) => (row as { key: string }).key)).toEqual(["account:a"]);

    // and it is read back after a restart
    const again = await open(visitsPersistenceFor(accounts, "postgres"));
    expect(again.records().days.get("2026-11-01")).toEqual({ visitors: 1, loads: 1 });
    await db.close();
  });

  it("refuses a table name that is not one of ours", () => {
    expect(() => new PostgresPersistence({ query: async () => ({ rows: [] }) }, "kino_docs; drop table kino_docs")).toThrow("Not a table name");
  });

  it("is a file of its own next to the accounts' file, or memory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kino-visits-"));
    folders.push(dir);
    const persistence = visitsPersistenceFor(new FilePersistence(path.join(dir, "kino.json")), "file", { DATA_DIR: dir });
    const counter = await open(persistence);
    counter.count("203.0.113.7", PHONE, "ro");
    await counter.flush();
    expect(Object.keys(JSON.parse(await readFile(path.join(dir, "visits.json"), "utf8"))).sort()).toEqual(["seen:2026-11-01", "visits:2026-11-01"]);

    expect(visitsPersistenceFor(new MemoryPersistence(), "memory")).toBeInstanceOf(MemoryPersistence);
  });
});
