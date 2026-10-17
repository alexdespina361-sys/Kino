import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { SharedPlacement, SharedTiming } from "../../shared";
import { MemoryPersistence, PostgresPersistence } from "../accounts/persistence";
import { buildApp } from "../app";
import { FileSubsyncStore, MemorySubsyncStore, PostgresSubsyncStore, subsyncStoreFor, type SubsyncStore } from "./store";

const key = (n: number) => n.toString(16).padStart(32, "0");
const timing = (lines: number, ...placed: SharedPlacement[]): SharedTiming => ({ v: 1, lines, placed });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Waits (a little) for something that happens by itself a moment after the call that causes it. */
async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await done()); i++) await wait(20);
}

interface Home {
  store: SubsyncStore;
  /** How many timings are kept. */
  count(): Promise<number>;
  /** Makes the timing look as if it was last used this long ago. */
  age(key: string, ms: number): Promise<void>;
  /** How long ago the timing was last used. */
  unused(key: string): Promise<number>;
  done(): Promise<void>;
}

const homes: Array<[string, (limit: number) => Promise<Home>]> = [
  [
    "memory",
    async (limit) => {
      const store = new MemorySubsyncStore(limit);
      return { store, count: async () => store.size, age: async () => {}, unused: async () => 0, done: async () => {} };
    },
  ],
  [
    "a folder",
    async (limit) => {
      const dir = await mkdtemp(path.join(tmpdir(), "kino-subsync-"));
      const store = new FileSubsyncStore(dir, limit);
      const file = (name: string) => path.join(dir, `${name}.json`);
      return {
        store,
        count: async () => (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).length,
        age: async (name, ms) => void (await utimes(file(name), new Date(Date.now() - ms), new Date(Date.now() - ms))),
        unused: async (name) => Date.now() - (await stat(file(name))).mtimeMs,
        done: () => rm(dir, { recursive: true, force: true }),
      };
    },
  ],
  [
    "Postgres",
    async (limit) => {
      const db = new PGlite();
      const store = new PostgresSubsyncStore(db, limit);
      return {
        store,
        count: async () => {
          await store.get(key(0)); // (makes the table when nothing has)
          return ((await db.query("select count(*)::int as n from kino_subsync")).rows[0] as { n: number }).n;
        },
        age: async (name, ms) => void (await db.query("update kino_subsync set used = now() - make_interval(secs => $2) where key = $1", [name, ms / 1000])),
        unused: async (name) => ((await db.query("select extract(epoch from now() - used)::float8 * 1000 as ms from kino_subsync where key = $1", [name])).rows[0] as { ms: number }).ms,
        done: () => db.close(),
      };
    },
  ],
];

describe.each(homes)("shared timings kept in %s", (_name, open) => {
  let home: Home | undefined;
  const make = async (limit = 3000) => (home = await open(limit));
  afterEach(async () => {
    await home?.done();
    home = undefined;
  });

  it("knows nothing of a key that was never left", async () => {
    expect(await (await make()).store.get(key(1))).toBeUndefined();
  });

  it("gives back what was left, and joins what is left later (words before none)", async () => {
    const { store } = await make();
    expect(await store.merge(key(1), timing(9, [0, 1, 1, 0], [4, 40, 40, 0]))).toBe(true);
    expect(await store.get(key(1))).toEqual(timing(9, [0, 1, 1, 0], [4, 40, 40, 0]));
    expect(await store.merge(key(1), timing(9, [2, 20, 20, 1], [4, 41, 41, 1]))).toBe(true);
    expect(await store.get(key(1))).toEqual(timing(9, [0, 1, 1, 0], [2, 20, 20, 1], [4, 41, 41, 1]));
  });

  it("turns away a timing of a file with another number of lines, and keeps what it had", async () => {
    const { store } = await make();
    await store.merge(key(1), timing(9, [4, 40, 40, 1]));
    expect(await store.merge(key(1), timing(10, [4, 99, 99, 1]))).toBe(false);
    expect(await store.get(key(1))).toEqual(timing(9, [4, 40, 40, 1]));
  });

  it("keeps both of two timings that arrive together", async () => {
    const { store } = await make();
    await Promise.all([store.merge(key(1), timing(9, [1, 10, 10, 1])), store.merge(key(1), timing(9, [2, 20, 20, 1])), store.merge(key(1), timing(9, [3, 30, 30, 1]))]);
    expect((await store.get(key(1)))?.placed.map((each) => each[0])).toEqual([1, 2, 3]);
  });

  it("forgets the timings that were used longest ago when there are too many", async () => {
    const { store, count } = await make(5);
    for (let n = 1; n <= 100; n++) await store.merge(key(n), timing(9, [1, n, n, 1]));
    await until(async () => (await count()) <= 5);
    expect(await count()).toBeLessThanOrEqual(5);
    expect(await store.get(key(100))).toBeDefined();
    expect(await store.get(key(1))).toBeUndefined();
  });
});

describe("what a read does", () => {
  it("counts as use in memory, so the one nobody wants goes first", async () => {
    const store = new MemorySubsyncStore(2);
    await store.merge(key(1), timing(9, [1, 1, 1, 1]));
    await store.merge(key(2), timing(9, [1, 2, 2, 1]));
    await store.get(key(1));
    await store.merge(key(3), timing(9, [1, 3, 3, 1]));
    expect(await store.get(key(1))).toBeDefined();
    expect(await store.get(key(2))).toBeUndefined();
  });

  for (const [name, open] of homes.slice(1)) {
    it(`counts as use in ${name}, once an hour at most`, async () => {
      const home = await open(3000);
      try {
        await home.store.merge(key(1), timing(9, [1, 1, 1, 1]));
        await home.store.merge(key(2), timing(9, [1, 2, 2, 1]));
        await home.age(key(1), 2 * 3600_000);
        await home.age(key(2), 20 * 60_000);
        await home.store.get(key(1));
        await home.store.get(key(2));
        await until(async () => (await home.unused(key(1))) < 60_000);
        expect(await home.unused(key(1))).toBeLessThan(60_000); // (it had not been used for two hours)
        expect(await home.unused(key(2))).toBeGreaterThan(19 * 60_000); // (it had, twenty minutes ago: not written to again for that)
      } finally {
        await home.done();
      }
    });
  }
});

describe("Postgres", () => {
  it("does not write what it already has", async () => {
    const db = new PGlite();
    try {
      const statements: string[] = [];
      const store = new PostgresSubsyncStore({
        query: (text, params) => {
          statements.push(text);
          return db.query(text, params);
        },
      });
      await store.merge(key(1), timing(9, [1, 10, 10, 1], [2, 20, 20, 0]));
      const inserts = () => statements.filter((text) => text.startsWith("insert")).length;
      expect(inserts()).toBe(1);
      await store.merge(key(1), timing(9, [1, 10, 10, 1])); // (the same)
      expect(inserts()).toBe(1);
      await store.merge(key(1), timing(9, [2, 99, 99, 0])); // (a different time for line 2, neither with words: the newer one is kept)
      expect(inserts()).toBe(2);
      await store.merge(key(1), timing(9, [1, 77, 77, 0])); // (no words do not replace words)
      expect(inserts()).toBe(2);
    } finally {
      await db.close();
    }
  });
});

describe("subsyncStoreFor", () => {
  it("follows where the accounts are kept", async () => {
    const db = new PGlite();
    try {
      expect(subsyncStoreFor(new MemoryPersistence(), "memory")).toBeInstanceOf(MemorySubsyncStore);
      expect(subsyncStoreFor(new MemoryPersistence(), "file", { DATA_DIR: path.join(tmpdir(), "kino-subsync-unused") })).toBeInstanceOf(FileSubsyncStore);
      expect(subsyncStoreFor(new PostgresPersistence(db), "postgres")).toBeInstanceOf(PostgresSubsyncStore);
    } finally {
      await db.close();
    }
  });
});

describe("/api/subsync", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const open = async () => (app = await buildApp({ subsync: new MemorySubsyncStore() }));
  const put = (body: unknown, name = key(1)) => app!.inject({ method: "PUT", url: `/api/subsync/${name}`, payload: body as object });

  it("takes a timing and gives it back to the next screen", async () => {
    await open();
    const none = await app!.inject(`/api/subsync/${key(1)}`);
    expect(none.statusCode).toBe(204); // (nobody has yet: not a 404, which a browser prints as an error in its console)
    expect(none.body).toBe("");
    expect((await put(timing(9, [0, 1, -1, 0], [4, 40, 40, 1]))).statusCode).toBe(204);
    const reply = await app!.inject(`/api/subsync/${key(1)}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual(timing(9, [0, 1, -1, 0], [4, 40, 40, 1]));
    expect(reply.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("does not let a miss be kept by anybody's cache", async () => {
    await open();
    expect((await app!.inject(`/api/subsync/${key(2)}`)).headers["cache-control"]).toBe("no-store");
  });

  it("joins what screens leave, and says so when a timing is for another file", async () => {
    await open();
    await put(timing(9, [1, 10, 10, 1]));
    await put(timing(9, [2, 20, 20, 1]));
    expect((await app!.inject(`/api/subsync/${key(1)}`)).json<SharedTiming>().placed).toEqual([[1, 10, 10, 1], [2, 20, 20, 1]]);
    const other = await put(timing(12, [2, 20, 20, 1]));
    expect(other.statusCode).toBe(409);
    expect(other.json()).toEqual({ error: "different_file" });
  });

  it("turns away what is not a key and what is not a timing", async () => {
    await open();
    for (const name of ["short", "G".repeat(32), "A".repeat(32), "0".repeat(33), "..%2F..%2Fx"]) {
      expect((await app!.inject(`/api/subsync/${name}`)).statusCode, name).toBe(400);
      expect((await put(timing(9, [1, 1, 1, 1]), name)).statusCode, name).toBe(400);
    }
    for (const body of [{}, { v: 1, lines: 9, placed: [] }, { v: 1, lines: 9, placed: [[9, 0, 0, 0]] }, { v: 1, lines: 9, placed: [[1, 99999, 0, 0]] }, { v: 1, lines: 9, placed: "all" }]) {
      expect((await put(body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await app!.inject(`/api/subsync/${key(1)}`)).statusCode).toBe(204); // (and none of it was kept)
  });

  it("keeps only the numbers, whatever else comes with them", async () => {
    await open();
    expect((await put({ ...timing(9, [1, 10, 10, 1]), text: "Hello there", who: "alex@example.com", placed2: [] })).statusCode).toBe(204);
    expect((await app!.inject(`/api/subsync/${key(1)}`)).json()).toEqual(timing(9, [1, 10, 10, 1]));
  });

  it("turns away a body bigger than any timing can be", async () => {
    await open();
    const reply = await app!.inject({ method: "PUT", url: `/api/subsync/${key(1)}`, headers: { "content-type": "application/json" }, payload: JSON.stringify({ v: 1, lines: 9, placed: [[1, 1, 1, 1]], pad: "x".repeat(200 * 1024) }) });
    expect(reply.statusCode).toBe(413);
  });

  it("slows down a screen that asks or leaves too much, and says for how long", async () => {
    await open();
    let reply = await app!.inject(`/api/subsync/${key(3)}`);
    for (let n = 0; n < 120; n++) reply = await app!.inject(`/api/subsync/${key(3)}`);
    expect(reply.statusCode).toBe(429);
    expect(Number(reply.headers["retry-after"])).toBeGreaterThan(0);
    expect(reply.json()).toMatchObject({ error: "rate_limited" });
    for (let n = 0; n < 60; n++) reply = await put(timing(9, [1, 10, 10, 1]));
    expect(reply.statusCode).toBe(204);
    reply = await put(timing(9, [1, 10, 10, 1]));
    expect(reply.statusCode).toBe(429);
  });

  it("says in /api/health how many asks found a timing, how many did not, and how many were left", async () => {
    await open();
    expect((await app!.inject("/api/health")).json<{ subsync: unknown }>().subsync).toEqual({ found: 0, missed: 0, stored: 0 });
    await app!.inject(`/api/subsync/${key(1)}`);
    await put(timing(9, [1, 10, 10, 1]));
    await app!.inject(`/api/subsync/${key(1)}`);
    await app!.inject(`/api/subsync/${key(1)}`);
    expect((await app!.inject("/api/health")).json<{ subsync: unknown }>().subsync).toEqual({ found: 2, missed: 1, stored: 1 });
  });
});
