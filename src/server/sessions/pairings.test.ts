import { describe, expect, it } from "vitest";
import { AccountStore } from "../accounts/store";
import { MemoryPersistence, type Persistence } from "../accounts/persistence";
import { buildApp } from "../app";
import { PairingStore } from "./pairings";
import { KEEP_PAIRINGS_DAYS, Registry } from "./registry";

const DAY = 24 * 3600 * 1000;

/** A server that starts on `persistence` at time `clock.now`. */
async function start(persistence: Persistence, clock: { now: number }, log?: { warn(message: string): void }) {
  const registry = new Registry({ now: () => clock.now });
  const store = await PairingStore.open({ registry, persistence, flushMs: 0, ...(log ? { log } : {}) });
  return { registry, store };
}

function pairUp(registry: Registry) {
  const tv = registry.tvHello();
  const phone = registry.controllerHello();
  registry.pair(phone, registry.ensureCode(tv)!.code);
  return { tv, phone };
}

const newClock = () => ({ now: Date.parse("2026-10-11T12:00:00Z") });

describe("pairings kept between restarts", () => {
  it("a phone and a TV that were paired are still paired when the server starts again", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const { tv, phone } = pairUp(before.registry);
    await before.store.flush();

    const after = await start(persistence, clock);
    const sameTv = after.registry.tvHello(tv.id);
    const samePhone = after.registry.controllerHello(phone.id);
    expect(sameTv.id).toBe(tv.id);
    expect(sameTv.controllerId).toBe(phone.id);
    expect(samePhone.id).toBe(phone.id);
    expect(after.registry.deviceForController(samePhone)).toBe(sameTv);
    // A paired TV has no pairing code to show, and none was kept from before.
    expect(after.registry.ensureCode(sameTv)).toBeNull();
    expect(sameTv.media).toBeNull();
  });

  it("a phone's list of TVs, and the one it was controlling, are still there when the server starts again", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const { tv: first, phone } = pairUp(before.registry);
    const second = before.registry.tvHello();
    before.registry.pair(phone, before.registry.ensureCode(second)!.code);
    await before.store.flush();
    expect(persistence.docs.get(`phone:${phone.id}`)).toMatchObject({ deviceId: second.id, deviceIds: [first.id, second.id] });

    const after = await start(persistence, clock);
    const samePhone = after.registry.controllerHello(phone.id);
    expect(after.registry.tvsOf(samePhone).map((tv) => tv.id)).toEqual([first.id, second.id]);
    expect(samePhone.deviceId).toBe(second.id);
    const sameFirst = after.registry.tvHello(first.id);
    expect(after.registry.phonesOf(sameFirst)).toEqual([samePhone]);
    expect(after.registry.controllersOf(sameFirst)).toEqual([]); // it is on the list, not the one in use
    expect(after.registry.ensureCode(sameFirst)).toBeNull(); // and still paired: no code to show
    expect(after.registry.switchTo(samePhone, sameFirst.publicId)).toBe(sameFirst);
  });

  it("a phone that controls none of its TVs any more still has them", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const { tv: first, phone } = pairUp(before.registry);
    const second = before.registry.tvHello();
    before.registry.pair(phone, before.registry.ensureCode(second)!.code);
    before.registry.unpair(phone); // forgets the second, which it controlled
    await before.store.flush();
    expect(persistence.docs.get(`phone:${phone.id}`)).toMatchObject({ deviceId: null, deviceIds: [first.id] });
    expect(persistence.docs.has(`tv:${second.id}`)).toBe(false);

    const after = await start(persistence, clock);
    const samePhone = after.registry.controllerHello(phone.id);
    expect(samePhone.deviceId).toBeNull();
    expect(after.registry.tvsOf(samePhone).map((tv) => tv.id)).toEqual([first.id]);
  });

  it("does not keep a TV nobody paired, nor a phone with no TV", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const tv = before.registry.tvHello();
    before.registry.ensureCode(tv);
    const phone = before.registry.controllerHello();
    await before.store.flush();
    expect(persistence.docs.size).toBe(0);

    const after = await start(persistence, clock);
    expect(after.registry.tvHello(tv.id).id).not.toBe(tv.id);
    expect(after.registry.controllerHello(phone.id).id).not.toBe(phone.id);
  });

  it("forgets a pair once either side lets go of it", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const { registry, store } = await start(persistence, clock);
    const { phone } = pairUp(registry);
    await store.flush();
    expect(persistence.docs.size).toBe(2);

    registry.unpair(phone);
    await store.flush();
    expect(persistence.docs.size).toBe(0);
  });

  it("keeps a second phone, the name a TV asked for, and the TVs that watch along", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const { tv: host, phone } = pairUp(before.registry);
    before.registry.setLabel(host, "Living room");
    const second = before.registry.controllerHello();
    before.registry.joinController(second, before.registry.ensureControlCode(host).code);
    const guest = before.registry.tvHello();
    expect(before.registry.addFollower(phone, before.registry.ensureCode(guest)!.code).ok).toBe(true);
    await before.store.flush();

    const after = await start(persistence, clock);
    const hostAgain = after.registry.tvHello(host.id);
    const guestAgain = after.registry.tvHello(guest.id);
    expect(hostAgain.controllerIds).toEqual([phone.id, second.id]);
    expect(after.registry.displayName(hostAgain)).toBe("Living room");
    expect(after.registry.followersOf(hostAgain)).toEqual([guestAgain]);
    expect(after.registry.leaderOf(guestAgain)).toBe(hostAgain);
    expect(guestAgain.publicId).toBe(guest.publicId);
    // No code, party or control code survives: they are asked for again.
    expect(hostAgain.controlCode).toBeNull();
    expect(hostAgain.partyCode).toBeNull();
  });

  it("writes only what changed", async () => {
    const saves: Array<{ put: string[]; remove: string[] }> = [];
    const persistence = new MemoryPersistence();
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      saves.push({ put: [...changes.put.keys()], remove: [...changes.remove] });
      return save(changes);
    };
    const clock = newClock();
    const { registry, store } = await start(persistence, clock);
    const { tv } = pairUp(registry);
    await store.flush();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.put).toHaveLength(2);

    await store.flush(); // nothing changed
    expect(saves).toHaveLength(1);

    registry.setLabel(tv, "Bedroom");
    await store.flush();
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual({ put: [`tv:${tv.id}`], remove: [] });
  });
});

describe("what a TV was playing, kept with its pair", () => {
  const film = { title: "Film", stream: { url: "https://cdn.example/f.mp4", type: "mp4" as const }, page: "https://site.example/watch/1", poster: "/p.jpg" };
  const playingAt = (currentTime: number) => ({ state: "playing" as const, currentTime, duration: 7200 });

  function filmOn(registry: Registry) {
    const { tv } = pairUp(registry);
    tv.media = film;
    registry.startedPlaying(tv, film, 0);
    return tv;
  }

  it("is put back after a restart, at the place the TV had reached when it went away", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const tv = filmOn(before.registry);
    before.registry.noteProgress(tv, playingAt(2000));
    before.registry.checkpoint(tv); // the page was closed
    await before.store.flush();

    const after = await start(persistence, clock);
    expect(after.registry.resumeOf(after.registry.tvHello(tv.id))).toEqual({ url: film.page, hint: { poster: "/p.jpg" }, time: 2000 });
  });

  it("is written again only when the place has moved a while, and is gone from the database once it is cleared", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    let writes = 0;
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      writes++;
      return save(changes);
    };
    const { registry, store } = await start(persistence, clock);
    const tv = filmOn(registry);
    await store.flush();
    const first = writes;

    for (let at = 1; at <= 25; at++) registry.noteProgress(tv, playingAt(at)); // a TV reports every second
    await store.flush();
    expect(writes).toBe(first);

    registry.noteProgress(tv, playingAt(40));
    await store.flush();
    expect(writes).toBe(first + 1);
    expect((persistence.docs.get(`tv:${tv.id}`) as { resume: { time: number } }).resume.time).toBe(40);

    registry.forgetResume(tv);
    await store.flush();
    expect(persistence.docs.get(`tv:${tv.id}`)).not.toHaveProperty("resume");
  });

  it("is not kept for a TV without a phone or a party, which is not kept at all", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const { registry, store } = await start(persistence, clock);
    const alone = registry.tvHello();
    alone.media = film;
    registry.startedPlaying(alone, film, 500);
    await store.flush();
    expect(persistence.docs.size).toBe(0);
  });

  it("costs a pair nothing when the record of it cannot be read", async () => {
    const persistence = new MemoryPersistence();
    const stamp = Math.floor(Date.parse("2026-10-11T12:00:00Z") / DAY);
    persistence.docs.set("tv:tv_a", {
      v: 1, id: "tv_a", publicId: "aaaa", name: "TV A", label: null, controllerId: "ctl_a", controllerIds: ["ctl_a"], leaderId: null, followerIds: [], seenDay: stamp,
      resume: { url: 42, time: "soon" },
    });
    persistence.docs.set("phone:ctl_a", { v: 1, id: "ctl_a", deviceId: "tv_a", seenDay: stamp });
    const { registry } = await start(persistence, newClock());
    const tv = registry.tvHello("tv_a");
    expect(tv.controllerId).toBe("ctl_a");
    expect(registry.resumeOf(tv)).toBeUndefined();
  });
});

describe("pairings nobody uses any more", () => {
  it(`are let go after more than a year (${KEEP_PAIRINGS_DAYS} days) without being heard from, and cleared out of the database`, async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const before = await start(persistence, clock);
    const { tv, phone } = pairUp(before.registry);
    await before.store.flush();

    clock.now += (KEEP_PAIRINGS_DAYS - 1) * DAY;
    const recent = await start(persistence, clock);
    expect(recent.registry.tvHello(tv.id).id).toBe(tv.id);

    clock.now += 2 * DAY;
    const old = await start(persistence, clock);
    await old.store.flush();
    expect(old.registry.tvHello(tv.id).id).not.toBe(tv.id);
    expect(old.registry.controllerHello(phone.id).id).not.toBe(phone.id);
    expect([...persistence.docs.keys()].filter((key) => key.startsWith("tv:") || key.startsWith("phone:"))).toEqual([]);
  });

  it("stay as long as the TV or the phone keeps coming back", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const first = await start(persistence, clock);
    const { tv, phone } = pairUp(first.registry);
    await first.store.flush();

    // Two months on the TV says hello again; another two months later the server starts.
    clock.now += 60 * DAY;
    const second = await start(persistence, clock);
    second.registry.tvHello(tv.id);
    second.registry.controllerHello(phone.id);
    await second.store.flush();

    clock.now += 60 * DAY;
    const third = await start(persistence, clock);
    expect(third.registry.tvHello(tv.id).id).toBe(tv.id);
    expect(third.registry.deviceForController(third.registry.controllerHello(phone.id))?.id).toBe(tv.id);
  });

  it("are written again at most once a day, however often the TV pings", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    let writes = 0;
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      writes++;
      return save(changes);
    };
    const { registry, store } = await start(persistence, clock);
    const { tv } = pairUp(registry);
    await store.flush();
    for (let i = 0; i < 50; i++) registry.markSeen(tv.id);
    await store.flush();
    expect(writes).toBe(1);

    clock.now += DAY;
    registry.markSeen(tv.id);
    registry.markSeen(tv.id);
    await store.flush();
    expect(writes).toBe(2);
  });
});

describe("pairings that disagree", () => {
  const device = (over: Record<string, unknown> = {}) => ({
    v: 1,
    id: "tv_a",
    publicId: "aaaa",
    name: "TV A",
    label: null,
    controllerId: "ctl_a",
    controllerIds: ["ctl_a"],
    leaderId: null,
    followerIds: [],
    seenDay: Math.floor(Date.parse("2026-10-11T12:00:00Z") / DAY),
    ...over,
  });
  const phone = (over: Record<string, unknown> = {}) => ({ v: 1, id: "ctl_a", deviceId: "tv_a", seenDay: device().seenDay, ...over });

  async function startWith(docs: Record<string, unknown>) {
    const persistence = new MemoryPersistence();
    for (const [key, value] of Object.entries(docs)) persistence.docs.set(key, value);
    return start(persistence, newClock());
  }

  it("keeps a pair whose two sides agree", async () => {
    const { registry } = await startWith({ "tv:tv_a": device(), "phone:ctl_a": phone() });
    expect(registry.deviceForController(registry.controllerHello("ctl_a"))?.id).toBe("tv_a");
  });

  it("lets a phone go whose TV is gone or does not list it", async () => {
    const gone = await startWith({ "phone:ctl_a": phone() });
    expect(gone.registry.controllerHello("ctl_a").deviceId).toBeNull();

    const unlisted = await startWith({ "tv:tv_a": device({ controllerId: null, controllerIds: [], leaderId: "tv_b" }), "phone:ctl_a": phone() });
    expect(unlisted.registry.controllerHello("ctl_a").deviceId).toBeNull();
  });

  it("reads a phone written before it had a list as a list of the one TV it had", async () => {
    const { registry } = await startWith({ "tv:tv_a": device(), "phone:ctl_a": phone() });
    const samePhone = registry.controllerHello("ctl_a");
    expect(registry.tvsOf(samePhone).map((tv) => tv.id)).toEqual(["tv_a"]);
    expect(samePhone.deviceId).toBe("tv_a");
  });

  it("keeps in a phone's list only the TVs that list the phone, and in a TV only the phones that list the TV", async () => {
    const { registry } = await startWith({
      "tv:tv_a": device(),
      "tv:tv_b": device({ id: "tv_b", publicId: "bbbb", controllerId: null, controllerIds: [] }), // does not list the phone
      "tv:tv_c": device({ id: "tv_c", publicId: "cccc", controllerId: "ctl_a", controllerIds: ["ctl_a"] }), // lists a phone that does not list it
      "phone:ctl_a": phone({ deviceIds: ["tv_a", "tv_b", "tv_gone"] }),
    });
    const samePhone = registry.controllerHello("ctl_a");
    expect(registry.tvsOf(samePhone).map((tv) => tv.id)).toEqual(["tv_a"]);
    const orphan = registry.tvHello("tv_c");
    expect(orphan.controllerIds).toEqual([]);
    expect(orphan.controllerId).toBeNull();
  });

  it("lets go of the TV a phone controls when its own list leaves it out", async () => {
    const { registry } = await startWith({ "tv:tv_a": device(), "phone:ctl_a": phone({ deviceIds: ["tv_b"] }) });
    expect(registry.controllerHello("ctl_a").deviceId).toBeNull();
    expect(registry.tvHello("tv_a").controllerId).toBeNull();
  });

  it("lets a TV go free whose phone is gone or points somewhere else", async () => {
    const gone = await startWith({ "tv:tv_a": device() });
    const free = gone.registry.tvHello("tv_a");
    expect(free.id).toBe("tv_a");
    expect(free.controllerId).toBeNull();
    expect(free.controllerIds).toEqual([]);
    expect(gone.registry.ensureCode(free)).not.toBeNull();

    const elsewhere = await startWith({ "tv:tv_a": device(), "phone:ctl_a": phone({ deviceId: "tv_b" }) });
    expect(elsewhere.registry.tvHello("tv_a").controllerId).toBeNull();
  });

  it("picks another phone as the main one when the main one is gone", async () => {
    const { registry } = await startWith({
      "tv:tv_a": device({ controllerId: "ctl_gone", controllerIds: ["ctl_gone", "ctl_a"] }),
      "phone:ctl_a": phone(),
    });
    expect(registry.tvHello("tv_a").controllerId).toBe("ctl_a");
  });

  it("lets a guest go whose host does not list it, and a host forget a guest that does not follow it", async () => {
    const { registry } = await startWith({
      "tv:tv_a": device({ controllerId: null, controllerIds: [], followerIds: ["tv_g", "tv_x"] }),
      "tv:tv_g": device({ id: "tv_g", controllerId: null, controllerIds: [], leaderId: "tv_a", followerIds: [] }),
      "tv:tv_x": device({ id: "tv_x", controllerId: null, controllerIds: [], leaderId: null, followerIds: [] }),
      "tv:tv_y": device({ id: "tv_y", controllerId: null, controllerIds: [], leaderId: "tv_a", followerIds: [] }),
    });
    const host = registry.tvHello("tv_a");
    expect(host.followerIds).toEqual(["tv_g"]);
    expect(registry.tvHello("tv_g").leaderId).toBe("tv_a");
    expect(registry.tvHello("tv_y").leaderId).toBeNull();
  });
});

describe("what is in the database besides pairings", () => {
  it("is left alone, and what cannot be read is skipped with a warning", async () => {
    const persistence = new MemoryPersistence();
    persistence.docs.set("account:acc_1", { v: 1, id: "acc_1" });
    persistence.docs.set("session:abc", { v: 1 });
    persistence.docs.set("tv:broken", { nonsense: true });
    persistence.docs.set("phone:broken", "nonsense");
    const warnings: string[] = [];
    const clock = newClock();
    const { registry, store } = await start(persistence, clock, { warn: (message) => void warnings.push(message) });
    pairUp(registry);
    await store.flush();

    expect(warnings).toHaveLength(2);
    expect(persistence.docs.has("account:acc_1")).toBe(true);
    expect(persistence.docs.has("session:abc")).toBe(true);
    // The two it could not read are not "pairings that went away": they are not touched either.
    expect(persistence.docs.has("tv:broken")).toBe(true);
    expect(persistence.docs.has("phone:broken")).toBe(true);
  });

  it("does not rewrite a record the database gives back with its fields in another order", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const first = await start(persistence, clock);
    pairUp(first.registry);
    await first.store.flush();
    // Postgres keeps JSON in an order of its own (shortest field names first).
    for (const [key, value] of [...persistence.docs]) {
      const reversed = Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse());
      persistence.docs.set(key, reversed);
    }
    let writes = 0;
    const save = persistence.save.bind(persistence);
    persistence.save = async (changes) => {
      writes++;
      return save(changes);
    };
    const second = await start(persistence, clock);
    await second.store.flush();
    expect(writes).toBe(0);
  });
});

describe("a database that does not answer", () => {
  it("is tried again with the next flush, and never takes the server down", async () => {
    const persistence = new MemoryPersistence();
    const save = persistence.save.bind(persistence);
    let failing = true;
    persistence.save = async (changes) => {
      if (failing) throw new Error("the database is asleep");
      return save(changes);
    };
    const warnings: string[] = [];
    const clock = newClock();
    const { registry, store } = await start(persistence, clock, { warn: (message) => void warnings.push(message) });
    pairUp(registry);

    await store.flush();
    expect(warnings).toEqual(["Could not save pairings: the database is asleep"]);
    expect(persistence.docs.size).toBe(0);

    failing = false;
    await store.flush();
    expect(persistence.docs.size).toBe(2);
  });

  it("writes what is left when the store is closed", async () => {
    const persistence = new MemoryPersistence();
    const clock = newClock();
    const { registry, store } = await start(persistence, clock);
    pairUp(registry);
    expect(persistence.docs.size).toBe(0);
    await store.close();
    expect(persistence.docs.size).toBe(2);
  });
});

describe("a server that stops", () => {
  it("writes the pairs before the accounts close the database they share", async () => {
    class Recording extends MemoryPersistence {
      readonly events: string[] = [];
      override async save(changes: Parameters<MemoryPersistence["save"]>[0]) {
        this.events.push(`save ${[...changes.put.keys()].map((key) => key.split(":")[0]).sort().join(",")}`);
        return super.save(changes);
      }
      async close() {
        this.events.push("close");
      }
    }
    const persistence = new Recording();
    const accounts = await AccountStore.open({ persistence });
    const { registry, store } = await start(persistence, newClock());
    const app = await buildApp({ accounts, registry, pairings: store });
    await app.ready();
    pairUp(registry);
    await app.close();

    expect(persistence.events).toEqual(["save phone,tv", "close"]);
  });
});
