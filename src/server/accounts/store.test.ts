import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PROFILES, type SyncRequest } from "../../shared";
import { FilePersistence, MemoryPersistence, PostgresPersistence, persistenceFromEnv } from "./persistence";
import { AccountStore, SESSION_TTL_MS } from "./store";

const DAY = 24 * 3600 * 1000;

let clock = Date.parse("2026-10-10T12:00:00Z");
const now = () => clock;
const advance = (ms: number) => void (clock += ms);

const open = (persistence = new MemoryPersistence(), extra: { flushMs?: number } = {}) => AccountStore.open({ persistence, now, flushMs: 0, ...extra });

const progress = (key: string, at: number, extra: Record<string, unknown> = {}) => ({ key, at, title: key, url: `https://x/${key}`, position: 10, duration: 100, ...extra });
const request = (since: number, parts: Partial<Omit<SyncRequest, "since">> = {}): SyncRequest => ({ since, ...parts });

/** A store with one account, and that account's first profile. */
async function withAccount(persistence?: MemoryPersistence) {
  const store = await open(persistence);
  const created = store.createAccount("alex.popescu@example.com", "hash");
  if (!created.ok) throw new Error("could not create");
  const profile = store.profilesOf(created.value.id)[0]!;
  return { store, account: created.value, profile };
}

describe("accounts", () => {
  it("makes an account with one profile named after the address, and refuses the same address twice", async () => {
    const { store, account, profile } = await withAccount();
    expect(profile).toMatchObject({ name: "Alex", avatar: "fox" });
    expect(store.findByEmail("alex.popescu@example.com")?.id).toBe(account.id);
    expect(store.createAccount("alex.popescu@example.com", "other")).toEqual({ ok: false, error: "email_taken" });
    expect(store.countAccounts()).toBe(1);
  });

  it("deletes an account with its profiles, their data and its sessions", async () => {
    const persistence = new MemoryPersistence();
    const { store, account, profile } = await withAccount(persistence);
    const { token } = store.createSession(account.id, "browser", "Chrome");
    store.sync(profile.id, request(0, { progress: [progress("a", clock)] }));
    await store.flush();
    expect(persistence.docs.size).toBe(3);

    store.deleteAccount(account.id);
    await store.flush();
    expect(store.findByEmail("alex.popescu@example.com")).toBeUndefined();
    expect(store.getSession(token)).toBeUndefined();
    expect(store.sync(profile.id, request(0))).toBeUndefined();
    expect(persistence.docs.size).toBe(0);
  });
});

describe("profiles", () => {
  it("adds up to five, with names that differ, and keeps the last one", async () => {
    const { store, account, profile } = await withAccount();
    for (let i = 1; i < MAX_PROFILES; i++) {
      expect(store.addProfile(account.id, `Kid ${i}`, store.freeAvatar(account.id)).ok).toBe(true);
    }
    expect(store.addProfile(account.id, "Sixth", "owl")).toEqual({ ok: false, error: "profile_limit" });
    expect(store.profilesOf(account.id).map((p) => p.avatar)).toEqual(["fox", "cat", "panda", "owl", "bear"]);

    expect(store.updateProfile(account.id, profile.id, { name: " kid 1 " })).toEqual({ ok: false, error: "name_taken" });
    expect(store.updateProfile(account.id, profile.id, { name: "Alexandra", avatar: "robot" })).toMatchObject({ ok: true, value: { name: "Alexandra", avatar: "robot" } });

    for (const other of store.profilesOf(account.id).slice(1)) expect(store.deleteProfile(account.id, other.id).ok).toBe(true);
    expect(store.deleteProfile(account.id, profile.id)).toEqual({ ok: false, error: "last_profile" });
  });

  it("does not let one account touch another's profile", async () => {
    const { store, profile } = await withAccount();
    const other = store.createAccount("sam@example.com", "hash");
    if (!other.ok) throw new Error("no account");
    expect(store.ownsProfile(other.value.id, profile.id)).toBe(false);
    expect(store.updateProfile(other.value.id, profile.id, { name: "Hacked" })).toEqual({ ok: false, error: "not_found" });
    expect(store.deleteProfile(other.value.id, profile.id)).toEqual({ ok: false, error: "not_found" });
  });

  it("forgets what a deleted profile kept", async () => {
    const { store, account } = await withAccount();
    const second = store.addProfile(account.id, "Second", "cat");
    if (!second.ok) throw new Error("no profile");
    store.sync(second.value.id, request(0, { progress: [progress("a", clock)] }));
    store.deleteProfile(account.id, second.value.id);
    expect(store.sync(second.value.id, request(0))).toBeUndefined();
  });
});

describe("sessions", () => {
  it("knows a device by its token, only keeps the token's hash, and ends it on request", async () => {
    const persistence = new MemoryPersistence();
    const { store, account } = await withAccount(persistence);
    const { token, session } = store.createSession(account.id, "tv", "TV · Chrome");
    expect(store.getSession(token)?.accountId).toBe(account.id);
    expect(store.getSession("not a token")).toBeUndefined();
    await store.flush();
    expect(JSON.stringify([...persistence.docs.values()])).not.toContain(token);

    const [listed] = store.listSessions(account.id, session.id);
    expect(listed).toMatchObject({ kind: "tv", label: "TV · Chrome", current: true });
    expect(store.revokeSession(account.id, listed!.id)).toBe(true);
    expect(store.getSession(token)).toBeUndefined();
  });

  it("only ends sessions of its own account", async () => {
    const { store, account } = await withAccount();
    const other = store.createAccount("sam@example.com", "hash");
    if (!other.ok) throw new Error("no account");
    const mine = store.createSession(account.id, "browser", "Mine");
    const theirs = store.createSession(other.value.id, "browser", "Theirs");
    const [theirsListed] = store.listSessions(other.value.id);
    expect(store.revokeSession(account.id, theirsListed!.id)).toBe(false);
    expect(store.getSession(theirs.token)).toBeDefined();
    expect(store.getSession(mine.token)).toBeDefined();
  });

  it("keeps a device that is used signed in, and lets one that is not expire", async () => {
    const { store, account } = await withAccount();
    const used = store.createSession(account.id, "browser", "Used");
    const idle = store.createSession(account.id, "browser", "Idle");
    advance(SESSION_TTL_MS - DAY);
    expect(store.getSession(used.token)).toBeDefined();
    advance(2 * DAY);
    expect(store.getSession(used.token)).toBeDefined();
    expect(store.getSession(idle.token)).toBeUndefined();
  });

  it("ends all but one, and keeps at most twenty", async () => {
    const { store, account } = await withAccount();
    const sessions = Array.from({ length: 22 }, (_, i) => {
      advance(1000);
      return store.createSession(account.id, "browser", `Device ${i}`);
    });
    expect(store.listSessions(account.id)).toHaveLength(20);
    expect(store.getSession(sessions[0]!.token)).toBeUndefined();
    const keep = sessions[21]!;
    store.revokeAll(account.id, keep.session.id);
    expect(store.listSessions(account.id)).toHaveLength(1);
    expect(store.getSession(keep.token)).toBeDefined();
  });
});

describe("sync", () => {
  it("keeps what a screen sends and hands it to another screen that asks", async () => {
    const { store, profile } = await withAccount();
    const first = store.sync(profile.id, request(0, { progress: [progress("film", clock)], list: [{ key: "url:https://x/a", at: clock, id: "1", title: "A", url: "https://x/a" }] }))!;
    // the sender has these already
    expect(first).toMatchObject({ rev: 1, progress: [], list: [] });

    const second = store.sync(profile.id, request(0))!;
    expect(second.rev).toBe(1);
    expect(second.progress.map((p) => p.key)).toEqual(["film"]);
    expect(second.list).toHaveLength(1);

    // asking again with where it got to costs nothing
    expect(store.sync(profile.id, request(second.rev))).toMatchObject({ rev: 1, progress: [], watched: [], list: [], settings: [] });
  });

  it("answers an older copy with the newer one it has", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, { progress: [progress("film", clock, { position: 80 })] }));
    const answer = store.sync(profile.id, request(1, { progress: [progress("film", clock - 5000, { position: 5 })] }))!;
    expect(answer.rev).toBe(1);
    // nothing changed on the server, and the sender (who is up to date as of rev 1) hears nothing new
    expect(answer.progress).toEqual([]);
    const fresh = store.sync(profile.id, request(0, { progress: [progress("film", clock - 5000, { position: 5 })] }))!;
    expect(fresh.progress).toMatchObject([{ key: "film", position: 80 }]);
  });

  it("combines changes from two screens whatever order they arrive in", async () => {
    const a = await withAccount();
    const b = await withAccount();
    const phone = [progress("one", clock - 3000, { position: 1 }), progress("two", clock - 1000, { position: 2 })];
    const tv = [progress("one", clock - 2000, { position: 9 }), progress("three", clock - 500, { position: 3 })];
    a.store.sync(a.profile.id, request(0, { progress: phone }));
    a.store.sync(a.profile.id, request(0, { progress: tv }));
    b.store.sync(b.profile.id, request(0, { progress: tv }));
    b.store.sync(b.profile.id, request(0, { progress: phone }));
    const shape = (s: typeof a) => s.store.snapshot(s.profile.id)!.progress.map((p) => ("deleted" in p ? [p.key, "gone"] : [p.key, p.position])).sort();
    expect(shape(a)).toEqual(shape(b));
    expect(shape(a)).toEqual([["one", 9], ["three", 3], ["two", 2]]);
  });

  it("lets a removal reach a screen that still has the item, and a later watch bring it back", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, { list: [{ key: "url:u", at: clock - 3000, id: "1", title: "T", url: "u" }] }));
    advance(1000);
    const removed = store.sync(profile.id, request(1, { list: [{ key: "url:u", at: clock, deleted: true }] }))!;
    expect(removed.rev).toBe(2);
    expect(store.snapshot(profile.id)!.list).toEqual([{ key: "url:u", at: clock, deleted: true }]);
    advance(1000);
    store.sync(profile.id, request(2, { list: [{ key: "url:u", at: clock, id: "1", title: "T", url: "u" }] }));
    expect(store.snapshot(profile.id)!.list.map((i) => "deleted" in i)).toEqual([false]);
  });

  it("lets the newest copy borrow the picture only the older one had", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, { progress: [progress("film", clock - 5000, { image: "/poster.jpg", year: 1999 })] }));
    store.sync(profile.id, request(1, { progress: [progress("film", clock, { position: 50 })] }));
    expect(store.snapshot(profile.id)!.progress).toMatchObject([{ key: "film", position: 50, image: "/poster.jpg", year: 1999 }]);
  });

  it("does not let a clock that runs ahead win for ever", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, { progress: [progress("film", clock + 400 * DAY, { position: 99 })] }));
    const [stored] = store.snapshot(profile.id)!.progress;
    expect(stored!.at).toBeLessThan(clock + 2 * 60_000);
    // so a real, later watch does beat it
    advance(10 * 60_000);
    store.sync(profile.id, request(1, { progress: [progress("film", clock, { position: 7 })] }));
    expect(store.snapshot(profile.id)!.progress).toMatchObject([{ position: 7 }]);
  });

  it("accepts only settings that are a real choice", async () => {
    const { store, profile } = await withAccount();
    store.sync(
      profile.id,
      request(0, {
        settings: [
          { key: "lang", at: clock, value: "ro" },
          { key: "accent", at: clock, value: "chartreuse" },
          { key: "subtitleLanguages", at: clock, value: ["ro", "en"] },
        ],
      }),
    );
    expect(store.snapshot(profile.id)!.settings.map((s) => s.key).sort()).toEqual(["lang", "subtitleLanguages"]);
  });

  it("keeps only as many items as it is meant to", async () => {
    const { store, profile } = await withAccount();
    const many = Array.from({ length: 70 }, (_, i) => progress(`k${i}`, clock - i * 1000));
    store.sync(profile.id, request(0, { progress: many.slice(0, 60) }));
    store.sync(profile.id, request(1, { progress: many.slice(60) }));
    const kept = store.snapshot(profile.id)!.progress;
    expect(kept).toHaveLength(60);
    expect(kept[0]!.key).toBe("k0");
  });

  it("tells a screen that is ahead of it to send everything again", async () => {
    const { store, profile } = await withAccount();
    const answer = store.sync(profile.id, request(7, { progress: [progress("film", clock)] }))!;
    expect(answer.reset).toBe(true);
    // ...and still keeps what it was sent
    expect(store.snapshot(profile.id)!.progress.map((p) => p.key)).toEqual(["film"]);
    expect(store.sync(profile.id, request(0))).not.toHaveProperty("reset");
  });

  it("answers nobody for a profile that does not exist", async () => {
    const { store } = await withAccount();
    expect(store.sync("pro_nope", request(0))).toBeUndefined();
  });
});

describe("keeping it between runs", () => {
  async function fill(store: AccountStore, accountId: string, profileId: string) {
    store.createSession(accountId, "browser", "Chrome");
    store.sync(profileId, request(0, { progress: [progress("film", clock)], settings: [{ key: "lang", at: clock, value: "it" }] }));
    store.addProfile(accountId, "Second", "owl");
    await store.flush();
  }
  const expectBack = async (store: AccountStore) => {
    const account = store.findByEmail("alex.popescu@example.com")!;
    expect(account).toBeDefined();
    const profiles = store.profilesOf(account.id);
    expect(profiles.map((p) => p.name)).toEqual(["Alex", "Second"]);
    expect(store.snapshot(profiles[0]!.id)).toMatchObject({ rev: 1, progress: [{ key: "film" }], settings: [{ key: "lang", value: "it" }] });
    expect(store.listSessions(account.id)).toHaveLength(1);
  };

  it("through memory", async () => {
    const persistence = new MemoryPersistence();
    const first = await withAccount(persistence);
    await fill(first.store, first.account.id, first.profile.id);
    await expectBack(await open(persistence));
  });

  it("through a file, which is private and never overwrites one it cannot read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kino-store-"));
    try {
      const file = path.join(dir, "data", "kino.json");
      const log = { warn: () => {} };
      const first = await AccountStore.open({ persistence: new FilePersistence(file, log), now, flushMs: 0 });
      const created = first.createAccount("alex.popescu@example.com", "hash");
      if (!created.ok) throw new Error("no account");
      await fill(first, created.value.id, first.profilesOf(created.value.id)[0]!.id);
      expect(await readFile(path.join(dir, "data", ".gitignore"), "utf8")).toBe("*\n");

      await expectBack(await AccountStore.open({ persistence: new FilePersistence(file, log), now, flushMs: 0 }));

      await writeFile(file, "{ this is not json");
      const empty = await AccountStore.open({ persistence: new FilePersistence(file, log), now, flushMs: 0 });
      expect(empty.countAccounts()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("through Postgres", async () => {
    const db = new PGlite();
    try {
      const first = await AccountStore.open({ persistence: new PostgresPersistence(db), now, flushMs: 0 });
      const created = first.createAccount("alex.popescu@example.com", "hash");
      if (!created.ok) throw new Error("no account");
      await fill(first, created.value.id, first.profilesOf(created.value.id)[0]!.id);
      await expectBack(await AccountStore.open({ persistence: new PostgresPersistence(db), now, flushMs: 0 }));

      // removals reach the database too
      first.deleteAccount(created.value.id);
      await first.flush();
      const { rows } = await db.query("select count(*)::int as n from kino_docs");
      expect(rows[0]).toEqual({ n: 0 });
    } finally {
      await db.close();
    }
  });

  it("writes by itself a moment after a change, and when it stops", async () => {
    const persistence = new MemoryPersistence();
    const store = await AccountStore.open({ persistence, now, flushMs: 20 });
    store.createAccount("a@example.com", "hash");
    expect(persistence.docs.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(persistence.docs.size).toBe(2);

    store.createAccount("b@example.com", "hash");
    await store.close();
    expect(persistence.docs.size).toBe(4);
  });

  it("tries again when a write fails", async () => {
    const persistence = new MemoryPersistence();
    let failures = 1;
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      if (failures-- > 0) throw new Error("database asleep");
      await save(changes);
    };
    const warnings: string[] = [];
    const store = await AccountStore.open({ persistence, now, flushMs: 0, log: { warn: (m) => void warnings.push(m) } });
    store.createAccount("a@example.com", "hash");
    await store.flush();
    expect(warnings).toEqual(["Could not save accounts: database asleep"]);
    expect(persistence.docs.size).toBe(0);
    await store.flush();
    expect(persistence.docs.size).toBe(2);
  });
});

describe("persistenceFromEnv", () => {
  it("chooses memory, a file, or Postgres from the environment", async () => {
    expect((await persistenceFromEnv({ DATA_DIR: "memory" })).describe).toMatch(/memory/);
    expect((await persistenceFromEnv({ DATA_DIR: "somewhere" })).describe).toMatch(/kino\.json/);
    const pg = await persistenceFromEnv({ DATABASE_URL: "postgres://user:pass@localhost:1/db" });
    expect(pg.describe).toMatch(/Postgres/);
    await pg.persistence.close?.();
  });

  it("warns on Render when accounts would sit in a file that is wiped at every restart", async () => {
    const warnings: string[] = [];
    const log = { warn: (message: string) => void warnings.push(message) };
    await persistenceFromEnv({ RENDER: "true" }, log);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/DATABASE_URL/);

    // Not when a database is set, when the folder was chosen on purpose (a persistent disk), or off Render.
    await (await persistenceFromEnv({ RENDER: "true", DATABASE_URL: "postgres://user:pass@localhost:1/db" }, log)).persistence.close?.();
    await persistenceFromEnv({ RENDER: "true", DATA_DIR: "/var/data" }, log);
    await persistenceFromEnv({}, log);
    expect(warnings).toHaveLength(1);
  });
});

afterEach(() => {
  clock = Date.parse("2026-10-10T12:00:00Z");
});
