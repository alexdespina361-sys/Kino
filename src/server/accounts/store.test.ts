import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS, ListItemSchema, MAX_PROFILES, ProgressItemSchema, RatingItemSchema, WatchedItemSchema, type CollectionName, type SyncRequest } from "../../shared";
import { FilePersistence, MemoryPersistence, PostgresPersistence, persistenceFromEnv } from "./persistence";
import { AccountStore, SESSION_TTL_MS } from "./store";

const DAY = 24 * 3600 * 1000;

let clock = Date.parse("2026-10-10T12:00:00Z");
const now = () => clock;
const advance = (ms: number) => void (clock += ms);

const open = (persistence = new MemoryPersistence(), extra: { flushMs?: number } = {}) => AccountStore.open({ persistence, now, flushMs: 0, ...extra });

const progress = (key: string, at: number, extra: Record<string, unknown> = {}) => ({ key, at, title: key, url: `https://x/${key}`, position: 10, duration: 100, ...extra });
const request = (since: number, parts: Partial<Omit<SyncRequest, "since">> = {}): SyncRequest => ({ since, ...parts });

/** `item` with the text of the fields named (each may take up to that many more characters) made longer until its JSON is exactly `chars` long. */
function weighing<T extends object>(item: T, chars: number, fields: Array<[string, number]>): T {
  const filled = { ...item } as Record<string, unknown>;
  for (const [name] of fields) filled[name] = String(filled[name] ?? "");
  let missing = chars - JSON.stringify(filled).length;
  for (const [name, most] of fields) {
    const add = Math.max(0, Math.min(missing, most));
    filled[name] = `${String(filled[name])}${"x".repeat(add)}`;
    missing -= add;
  }
  if (missing !== 0) throw new Error(`cannot make an item of ${chars} characters`);
  return filled as T;
}
/** What `items` weigh as the store counts it: their JSON in bytes (for ASCII, which `weighing` writes, that is its length in characters). */
const weigh = (items: readonly object[]) => items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);

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

describe("usage", () => {
  it("tells when accounts were made and last used and what devices are in, and nothing about who", async () => {
    const store = await open();
    const made = clock;
    const a = store.createAccount("first.person@example.com", "hash");
    advance(2 * DAY);
    const b = store.createAccount("second.person@example.com", "hash");
    advance(DAY);
    store.createAccount("third.person@example.com", "hash"); // never signed in
    if (!a.ok || !b.ok) throw new Error("could not create");
    store.addProfile(a.value.id, "Kid", store.freeAvatar(a.value.id));

    clock = made + 5 * DAY;
    store.createSession(a.value.id, "browser", "Chrome");
    clock = made + 6 * DAY;
    store.createSession(a.value.id, "tv", "Silk"); // the later of an account's devices is when it was last used
    clock = made + 4 * DAY;
    const { token } = store.createSession(b.value.id, "tv", "Chrome");
    store.createSession(b.value.id, "browser", "Chrome");
    clock = made + 7 * DAY;

    const usage = store.usage();
    expect(usage).toEqual({
      profiles: 4,
      madeAt: [made, made + 2 * DAY, made + 3 * DAY],
      lastUsedAt: [made + 4 * DAY, made + 6 * DAY],
      devices: { browser: 2, tv: 2 },
    });
    expect(JSON.stringify(usage)).not.toMatch(/example\.com|acc_|pro_|hash/);

    // a device that signs out is no longer a device in use; an account with none is no longer in the list of those used
    store.endSessionByToken(token);
    store.revokeAll(b.value.id);
    expect(store.usage().lastUsedAt).toEqual([made + 6 * DAY]);
    expect(store.usage().devices).toEqual({ browser: 1, tv: 1 });
  });

  it("leaves out the devices whose sign-in has run out", async () => {
    const store = await open();
    const account = store.createAccount("only.person@example.com", "hash");
    if (!account.ok) throw new Error("could not create");
    store.createSession(account.value.id, "browser", "Chrome");
    advance(SESSION_TTL_MS + DAY);
    const usage = store.usage();
    expect(usage.lastUsedAt).toEqual([]);
    expect(usage.devices).toEqual({});
    expect(usage.madeAt).toHaveLength(1);
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

describe("tags", () => {
  const made = (store: AccountStore, login: string) => {
    const created = store.createAccount(login, "hash");
    if (!created.ok) throw new Error("no account");
    return created.value;
  };
  const tagOf = (store: AccountStore, accountId: string, index = 0) => store.profilesOf(accountId)[index]!.tag;

  it("gives each profile the lowest number nobody with the same name has, whoever has the name and however it is spelled", async () => {
    const store = await open();
    const first = made(store, "sam");
    const second = made(store, "SAM@example.com");
    const third = made(store, "sam.smith@example.com");
    const other = made(store, "robin");
    expect([first, second, third].map((account) => tagOf(store, account.id))).toEqual([1, 2, 3]);
    expect(tagOf(store, other.id)).toBe(1);
    expect(store.profileByTag("Sam", 2)).toBe(store.profilesOf(second.id)[0]!.id);
    expect(store.profileByTag(" SAM ", 3)).toBe(store.profilesOf(third.id)[0]!.id);
    expect(store.profileByTag("Sam", 4)).toBeUndefined();
    expect(store.profileByTag("Nobody", 1)).toBeUndefined();
    expect(store.profileCard(store.profilesOf(second.id)[0]!.id)).toMatchObject({ name: "SAM", tag: 2 });
  });

  it("gives a number back when its profile goes, to the next that asks", async () => {
    const store = await open();
    made(store, "sam");
    const second = made(store, "sam.two@example.com");
    made(store, "sam.three@example.com");
    store.deleteAccount(second.id);
    expect(store.profileByTag("Sam", 2)).toBeUndefined();
    expect(tagOf(store, made(store, "sam.four@example.com").id)).toBe(2);

    const account = made(store, "kim");
    const extra = store.addProfile(account.id, "Sam", "cat");
    expect(extra).toMatchObject({ ok: true, value: { tag: 4 } });
    if (!extra.ok) throw new Error("no profile");
    store.deleteProfile(account.id, extra.value.id);
    expect(store.profileByTag("Sam", 4)).toBeUndefined();
  });

  it("starts a new name at the lowest free number, and keeps the number for the same name in other capitals", async () => {
    const store = await open();
    made(store, "sam");
    const second = made(store, "sam.two@example.com");
    const third = made(store, "sam.three@example.com");
    const profile = store.profilesOf(third.id)[0]!;
    expect(profile.tag).toBe(3);

    expect(store.updateProfile(third.id, profile.id, { name: "Trebert" })).toMatchObject({ ok: true, value: { name: "Trebert", tag: 1 } });
    expect(store.profileByTag("Sam", 3)).toBeUndefined();
    expect(store.profileByTag("trebert", 1)).toBe(profile.id);
    expect(store.updateProfile(third.id, profile.id, { name: "TREBERT" })).toMatchObject({ ok: true, value: { tag: 1 } });

    const taken = store.profilesOf(second.id)[0]!;
    expect(store.updateProfile(second.id, taken.id, { name: "trebert" })).toMatchObject({ ok: true, value: { tag: 2 } });
    // (a number held by somebody else is not taken from them, a number that is free again is the lowest again)
    expect(store.updateProfile(third.id, profile.id, { name: "Ana" })).toMatchObject({ ok: true, value: { tag: 1 } });
    expect(store.profileByTag("trebert", 1)).toBeUndefined();
    expect(store.profileByTag("trebert", 2)).toBe(taken.id);
  });

  it("is kept between runs, and a profile that was made before there were tags gets its own, the older first, without taking one that is taken", async () => {
    const persistence = new MemoryPersistence();
    const store = await open(persistence);
    const early = made(store, "sam");
    clock += 1000;
    const late = made(store, "sam.late@example.com");
    await store.flush();
    const reopened = await open(persistence);
    expect(tagOf(reopened, early.id)).toBe(1);
    expect(tagOf(reopened, late.id)).toBe(2);

    // Old records: no tags at all, or two that were given the same.
    const old = new MemoryPersistence();
    for (const [key, value] of persistence.docs) {
      if (!key.startsWith("account:")) {
        old.docs.set(key, value);
        continue;
      }
      const doc = structuredClone(value) as { profiles: Array<{ tag?: number }> };
      for (const profile of doc.profiles) delete profile.tag;
      old.docs.set(key, doc);
    }
    const migrated = await open(old);
    expect(tagOf(migrated, early.id)).toBe(1); // (the older profile)
    expect(tagOf(migrated, late.id)).toBe(2);
    await migrated.flush();
    expect(tagOf(await open(old), late.id)).toBe(2); // (and written down: the next run finds them)

    const clash = new MemoryPersistence();
    for (const [key, value] of persistence.docs) clash.docs.set(key, key.startsWith("account:") ? { ...(value as object), profiles: (value as { profiles: object[] }).profiles.map((profile) => ({ ...profile, tag: 1 })) } : value);
    const settled = await open(clash);
    expect([tagOf(settled, early.id), tagOf(settled, late.id)].sort()).toEqual([1, 2]);
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

  it("lets a device be renamed (only by its own account), and keeps the name between runs", async () => {
    const persistence = new MemoryPersistence();
    const { store, account } = await withAccount(persistence);
    const other = store.createAccount("sam@example.com", "hash");
    if (!other.ok) throw new Error("no account");
    const { token } = store.createSession(account.id, "tv", "Chrome on Windows");
    const [listed] = store.listSessions(account.id);

    expect(store.renameSession(other.value.id, listed!.id, "Mine now")).toBe(false);
    expect(store.renameSession(account.id, "nope", "Kitchen")).toBe(false);
    expect(store.listSessions(account.id)[0]!.label).toBe("Chrome on Windows");

    expect(store.renameSession(account.id, listed!.id, "Living room TV")).toBe(true);
    await store.flush();
    const again = await open(persistence);
    expect(again.listSessions(account.id)[0]).toMatchObject({ kind: "tv", label: "Living room TV" });
    expect(again.getSession(token)?.label).toBe("Living room TV");
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

  it("keeps the names of lists and which list a title is in, and a removed list stays removed", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, {
      listNames: [{ key: "l1", at: clock, name: "Weekend" }],
      list: [{ key: "l1|url:u", at: clock, list: "l1", id: "1", title: "T", url: "u" }],
    }));
    const other = store.sync(profile.id, request(0))!;
    expect(other.listNames).toEqual([{ key: "l1", at: clock, name: "Weekend" }]);
    expect(other.list).toMatchObject([{ key: "l1|url:u", list: "l1" }]);

    advance(1000);
    store.sync(profile.id, request(1, { listNames: [{ key: "l1", at: clock, deleted: true }] }));
    store.sync(profile.id, request(2, { listNames: [{ key: "l1", at: clock - 5000, name: "Weekend" }] })); // a copy that never heard of it
    expect(store.snapshot(profile.id)!.listNames).toEqual([{ key: "l1", at: clock, deleted: true }]);
  });

  it("keeps ratings, hands them to another screen, and lets a removal and a later rating settle in order", async () => {
    const { store, profile } = await withAccount();
    const rating = (at: number, extra: Record<string, unknown> = {}) => ({ key: "rate:u", at, title: "T", url: "u", score: 8, ratedAt: at, ...extra });
    store.sync(profile.id, request(0, { ratings: [rating(clock, { note: "Big", percent: 100, watchedAt: clock - 1000 })] }));
    expect(store.sync(profile.id, request(0))!.ratings).toMatchObject([{ key: "rate:u", score: 8, note: "Big", percent: 100 }]);

    advance(1000);
    store.sync(profile.id, request(1, { ratings: [{ key: "rate:u", at: clock, deleted: true }] }));
    store.sync(profile.id, request(2, { ratings: [rating(clock - 5000)] })); // a copy that never heard of the removal
    expect(store.snapshot(profile.id)!.ratings).toEqual([{ key: "rate:u", at: clock, deleted: true }]);
    advance(1000);
    store.sync(profile.id, request(2, { ratings: [rating(clock, { score: 3 })] }));
    expect(store.snapshot(profile.id)!.ratings).toMatchObject([{ key: "rate:u", score: 3 }]);
  });

  it("accepts a setting that turns ratings off, and nothing but a yes or a no", async () => {
    const { store, profile } = await withAccount();
    store.sync(profile.id, request(0, { settings: [{ key: "ratings", at: clock, value: false }] }));
    expect(store.snapshot(profile.id)!.settings).toMatchObject([{ key: "ratings", value: false }]);
    store.sync(profile.id, request(1, { settings: [{ key: "ratings", at: clock + 1, value: "maybe" }] }));
    expect(store.snapshot(profile.id)!.settings).toMatchObject([{ key: "ratings", value: false }]);
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

describe("what a profile may weigh", () => {
  type Stored = Array<{ key: string; deleted?: true }>;
  const stored = (store: AccountStore, profileId: string, name: CollectionName) => store.items(profileId, name) as unknown as Stored;

  const budgets = { progress: 192 * 1024, watched: 256 * 1024, list: 640 * 1024, ratings: 640 * 1024 } as const;
  type Heavy = keyof typeof budgets;
  const heavy = Object.keys(budgets) as Heavy[];
  /** A key as long as a key may be, told apart by its first characters. */
  const wide = (n: number) => `${String(n).padStart(4, "0")}${"k".repeat(396)}`;
  /** An item of each part with every text as long as the schema it travels by allows (each is checked against it, so these are items a screen may send). */
  const longest: Record<Heavy, (n: number, at: number) => object> = {
    progress: (n, at) => ProgressItemSchema.parse({ key: wide(n), at, title: "t".repeat(300), url: "u".repeat(2048), image: "i".repeat(2048), backdrop: "b".repeat(2048), year: 2026, position: 1, duration: 2, season: 1, episode: 1, done: true }),
    watched: (n, at) => WatchedItemSchema.parse({ key: wide(n), at, show: "s".repeat(300), season: 1, episode: 1, position: 1, duration: 2, done: true }),
    list: (n, at) => ListItemSchema.parse({ key: wide(n), at, list: "l".repeat(60), id: "d".repeat(200), title: "t".repeat(300), url: "u".repeat(2048), image: "i".repeat(2048), backdrop: "b".repeat(2048), year: 2026, description: "x".repeat(400) }),
    ratings: (n, at) => RatingItemSchema.parse({ key: wide(n), at, title: "t".repeat(300), url: "u".repeat(2048), image: "i".repeat(2048), backdrop: "b".repeat(2048), year: 2026, kind: "movie", season: 1, score: 10, note: "n".repeat(400), ratedAt: at, watchedAt: at, percent: 100, seen: 5000, of: 5000 }),
  };

  /** A profile whose every part has as many items as it may have, each as long as it may be, the newest first. */
  async function brim() {
    const persistence = new MemoryPersistence();
    const { store, profile } = await withAccount(persistence);
    const sent = Object.fromEntries(heavy.map((name) => [name, Array.from({ length: LIMITS[name] }, (_, n) => longest[name](n, clock - n * 1000))])) as Record<Heavy, Stored>;
    store.sync(profile.id, request(0, sent as never));
    return { persistence, store, profile, sent };
  }

  it("keeps a profile filled to the brim within the budget of each part, the newest items first, in the very call that brought them", async () => {
    const { persistence, store, profile, sent } = await brim();
    for (const name of heavy) {
      // (Looked at as that call left them: any other call would prune again.)
      const here = new Set(stored(store, profile.id, name).map((item) => item.key));
      const fit = sent[name].filter((item) => here.has(item.key));
      expect(here.size).toBe(fit.length);
      expect(fit).toEqual(sent[name].slice(0, fit.length)); // the newest are what stayed...
      expect(weigh(fit)).toBeLessThanOrEqual(budgets[name]);
      expect(weigh(sent[name].slice(0, fit.length + 1))).toBeGreaterThan(budgets[name]); // ...as many as fit...
      expect(fit.length).toBeLessThan(LIMITS[name]); // ...which is fewer than the count alone allows.
    }
    // What is written down is some megabytes, where the counts alone allow some eight.
    await store.flush();
    expect(JSON.stringify(persistence.docs.get(`pdata:${profile.id}`)).length).toBeLessThan(2 * 1024 * 1024);
  });

  it("lets a newer item push out the oldest ones in the call that brings it", async () => {
    const { store, profile, sent } = await brim();
    const before = stored(store, profile.id, "list");
    const oldest = sent.list.filter((item) => before.some((kept) => kept.key === item.key)).at(-1)!;
    const newest = longest.list(9999, clock + 1000);
    store.sync(profile.id, request(1, { list: [newest as never] }));
    const after = stored(store, profile.id, "list");
    expect(after).toContainEqual(newest);
    expect(after.map((item) => item.key)).not.toContain(oldest.key);
    expect(after).toHaveLength(before.length); // (every item is as long as the next: one in, one out)
    expect(weigh(after)).toBeLessThanOrEqual(budgets.list);
  });

  it("loses nothing of a heavy profile that somebody really could have, and asks for no more writes for it than for any other", async () => {
    const persistence = new MemoryPersistence();
    let saves = 0;
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      saves++;
      await save(changes);
    };
    const { store, profile } = await withAccount(persistence);
    // 400 titles in the lists and 500 ratings, a kilobyte each, 600 episodes watched and 60 cards to carry on with
    const kilobyte = <T extends object>(item: T, fields: Array<[string, number]>) => weighing(item, 1000, fields);
    const sent = {
      progress: Array.from({ length: LIMITS.progress }, (_, n) => kilobyte(progress(`show:${n}`, clock - n * 1000), [["image", 2048]])),
      watched: Array.from({ length: LIMITS.watched }, (_, n) => ({ key: `show|1x${n}`, at: clock - n * 1000, show: "Some show", season: 1, episode: n, position: 10, duration: 100, done: true })),
      list: Array.from({ length: LIMITS.list }, (_, n) => kilobyte({ key: `url:https://x/${n}`, at: clock - n * 1000, id: String(n), title: `T${n}`, url: `https://x/${n}` }, [["description", 400], ["image", 2048]])),
      ratings: Array.from({ length: LIMITS.ratings }, (_, n) => kilobyte({ key: `rate:https://x/${n}`, at: clock - n * 1000, title: `T${n}`, url: `https://x/${n}`, score: 7, ratedAt: clock }, [["note", 400], ["image", 2048]])),
    };
    expect(JSON.stringify(sent.list[0]).length).toBe(1000);
    const first = store.sync(profile.id, request(0, sent as never))!;
    const keys = (items: ReadonlyArray<{ key: string }>) => items.map((item) => item.key).sort();
    for (const name of heavy) expect(keys(stored(store, profile.id, name))).toEqual(keys(sent[name]));

    // one write for all of it, and none when a call changes nothing, or says what the server has already
    await store.flush();
    expect(saves).toBe(1);
    store.sync(profile.id, request(first.rev));
    store.sync(profile.id, request(first.rev, { list: [sent.list[0]! as never] }));
    await store.flush();
    expect(saves).toBe(1);
    // (and one that does change something is written, so the count above is counting)
    store.sync(profile.id, request(first.rev, { list: [{ ...sent.list[0]!, at: clock + 1, title: "Changed" } as never] }));
    await store.flush();
    expect(saves).toBe(2);
  });

  const edges = [
    { name: "progress", budget: 192 * 1024, size: 4096, make: (n: number, at: number) => progress(`show:${n}`, at), pad: [["image", 2048], ["backdrop", 2048]] },
    { name: "watched", budget: 256 * 1024, size: 512, make: (n: number, at: number) => ({ key: `show|1x${n}`, at, show: "Show", season: 1, episode: n, position: 10, duration: 100, done: true }), pad: [["show", 300], ["key", 150]] },
    { name: "list", budget: 640 * 1024, size: 4096, make: (n: number, at: number) => ({ key: `url:https://x/${n}`, at, id: String(n), title: `T${n}`, url: `https://x/${n}` }), pad: [["description", 400], ["image", 2048], ["backdrop", 2048]] },
    { name: "ratings", budget: 640 * 1024, size: 4096, make: (n: number, at: number) => ({ key: `rate:https://x/${n}`, at, title: `T${n}`, url: `https://x/${n}`, score: 7, ratedAt: at }), pad: [["note", 400], ["image", 2048], ["backdrop", 2048]] },
    // (A name of a list is 24 characters at the most. Only a store that is handed what the routes would have turned away can be given one this long, which is the one way to reach this budget.)
    { name: "listNames", budget: 32 * 1024, size: 4096, make: (n: number, at: number) => ({ key: `l${n}`, at, name: "" }), pad: [["name", 4096]] },
  ] satisfies Array<{ name: CollectionName; budget: number; size: number; make: (n: number, at: number) => object; pad: Array<[string, number]> }>;

  it.each(edges)("holds $name to its budget to the byte", async ({ name, budget, size, make, pad }) => {
    const count = budget / size;
    const items = (oldestWeighs = size) => Array.from({ length: count }, (_, n) => weighing(make(n, clock - n * 1000), n === count - 1 ? oldestWeighs : size, pad as Array<[string, number]>));

    // exactly the budget: all of it stays, and whatever comes after it, being older, has no room
    const exact = await withAccount();
    exact.store.sync(exact.profile.id, request(0, { [name]: items() } as never));
    expect(stored(exact.store, exact.profile.id, name)).toHaveLength(count);
    exact.store.sync(exact.profile.id, request(1, { [name]: [make(count, clock - count * 1000)] } as never));
    expect(stored(exact.store, exact.profile.id, name)).toHaveLength(count);

    // a character more, and the oldest is the one that goes
    const over = await withAccount();
    const sent = items(size + 1);
    over.store.sync(over.profile.id, request(0, { [name]: sent } as never));
    expect(stored(over.store, over.profile.id, name).map((item) => item.key).sort()).toEqual(sent.slice(0, count - 1).map((item) => (item as { key: string }).key).sort());
  });

  it("counts the bytes that are written down, not the letters: a letter that is not ASCII weighs two or three of them", async () => {
    const budget = 640 * 1024;
    const count = 128;
    // Items of 4320 letters, 400 of them Chinese ones (three bytes each in UTF-8): 5120 bytes, so 128 of them are exactly the budget of a list, where the same letters
    // in ASCII would have been 552960 of the 655360.
    const items = (oldestWeighs = 4320) =>
      Array.from({ length: count }, (_, n) =>
        weighing({ key: `url:https://x/${n}`, at: clock - n * 1000, id: String(n), title: `T${n}`, url: `https://x/${n}`, description: "漢".repeat(400) }, n === count - 1 ? oldestWeighs : 4320, [["image", 2048], ["backdrop", 2048]]),
      );
    expect(weigh(items())).toBe(budget);
    expect(items().reduce((sum, item) => sum + JSON.stringify(item).length, 0)).toBeLessThan(budget);

    // exactly the budget: all of it stays
    const exact = await withAccount();
    exact.store.sync(exact.profile.id, request(0, { list: items() }));
    expect(stored(exact.store, exact.profile.id, "list")).toHaveLength(count);

    // a byte more, and the oldest is the one that goes
    const over = await withAccount();
    const sent = items(4321);
    over.store.sync(over.profile.id, request(0, { list: sent }));
    expect(stored(over.store, over.profile.id, "list").map((item) => item.key).sort()).toEqual(sent.slice(0, count - 1).map((item) => item.key).sort());

    // and text of two bytes a letter (Cyrillic, Greek) is held to it as well: 160 items of 4096 letters would be 655360 of them, but they are 4496 bytes each
    const twice = await withAccount();
    const cyrillic = Array.from({ length: 160 }, (_, n) =>
      weighing({ key: `url:https://x/${n}`, at: clock - n * 1000, id: String(n), title: `T${n}`, url: `https://x/${n}`, description: "ж".repeat(400) }, 4096, [["image", 2048], ["backdrop", 2048]]),
    );
    twice.store.sync(twice.profile.id, request(0, { list: cyrillic }));
    const kept = stored(twice.store, twice.profile.id, "list");
    expect(kept.length).toBeLessThan(160);
    expect(weigh(cyrillic.slice(0, kept.length))).toBeLessThanOrEqual(budget);
    expect(weigh(cyrillic.slice(0, kept.length + 1))).toBeGreaterThan(budget);
  });

  it("lets nothing older than the first item that does not fit stay, even a small one that would fit", async () => {
    const { store, profile } = await withAccount();
    const pad: Array<[string, number]> = [["description", 400], ["image", 2048], ["backdrop", 2048]];
    const titled = (n: number, chars: number) => weighing({ key: `url:https://x/${n}`, at: clock - n * 1000, id: String(n), title: `T${n}`, url: `https://x/${n}` }, chars, pad);
    // 159 items of 4096 leave room for 4096 more of the 160 × 4096 there is: the next one is a character too long, and the one after it is small
    const sent = [...Array.from({ length: 159 }, (_, n) => titled(n, 4096)), titled(159, 4097), titled(160, 300)];
    store.sync(profile.id, request(0, { list: sent }));
    expect(stored(store, profile.id, "list").map((item) => item.key).sort()).toEqual(sent.slice(0, 159).map((item) => item.key).sort());
  });

  it("does not weigh a removal, and never lets the budget take one", async () => {
    const { store, profile } = await withAccount();
    const live = Array.from({ length: 161 }, (_, n) => weighing({ key: `url:https://x/${n}`, at: clock - 1000 - n * 1000, id: String(n), title: `T${n}`, url: `https://x/${n}` }, 4096, [["description", 400], ["image", 2048], ["backdrop", 2048]]));
    const removal = (n: number, at: number) => ({ key: `url:https://x/gone${n}`, at, deleted: true as const });
    // Removals newer than every item and older than every item: the budget has room for 160 items, so the 161st goes, and no removal with it.
    const gone = [...Array.from({ length: 50 }, (_, n) => removal(n, clock + n)), ...Array.from({ length: 50 }, (_, n) => removal(50 + n, clock - 500_000 - n))];
    store.sync(profile.id, request(0, { list: [...live, ...gone] }));
    const kept = stored(store, profile.id, "list");
    expect(kept.filter((item) => !item.deleted).map((item) => item.key).sort()).toEqual(live.slice(0, 160).map((item) => item.key).sort());
    expect(kept.filter((item) => item.deleted)).toHaveLength(100);
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

  it("writes and forgets in one statement to Postgres, so that stopping between the two cannot keep one and lose the other", async () => {
    const db = new PGlite();
    try {
      const statements: string[] = [];
      const persistence = new PostgresPersistence({
        query: (text, params) => {
          statements.push(text);
          return db.query(text, params);
        },
      });
      await persistence.load();
      await persistence.save({ put: new Map<string, unknown>([["a", { n: 1 }], ["b", { n: 2 }]]), remove: new Set() });
      statements.length = 0;

      await persistence.save({ put: new Map<string, unknown>([["c", { n: 3 }], ["b", { n: 22 }]]), remove: new Set(["a"]) });
      expect(statements).toHaveLength(1);
      expect(Object.fromEntries((await persistence.load()).entries())).toEqual({ b: { n: 22 }, c: { n: 3 } });
      statements.length = 0; // (the load above asked the database too)

      await persistence.save({ put: new Map(), remove: new Set(["b", "nothing"]) }); // (only to forget)
      await persistence.save({ put: new Map<string, unknown>([["d", { n: 4 }]]), remove: new Set() }); // (only to write)
      await persistence.save({ put: new Map(), remove: new Set() }); // (nothing: nothing is asked of the database)
      expect(statements).toHaveLength(2);
      expect(Object.fromEntries((await persistence.load()).entries())).toEqual({ c: { n: 3 }, d: { n: 4 } });
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
    expect((await persistenceFromEnv({ DATA_DIR: "memory" })).kind).toBe("memory");
    expect((await persistenceFromEnv({ DATA_DIR: "somewhere" })).describe).toMatch(/kino\.json/);
    expect((await persistenceFromEnv({ DATA_DIR: "somewhere" })).kind).toBe("file");
    const pg = await persistenceFromEnv({ DATABASE_URL: "postgres://user:pass@localhost:1/db" });
    expect(pg.describe).toMatch(/Postgres/);
    expect(pg.kind).toBe("postgres");
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
