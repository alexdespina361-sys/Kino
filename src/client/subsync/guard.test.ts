import { describe, expect, it } from "vitest";
import { CrashGuard, type Kept } from "./guard";

const DAY = 24 * 3600 * 1000;

/** A page's storage, and a clock that only moves when the test says so. */
function setup() {
  const store = new Map<string, string>();
  const kept: Kept = {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => void store.set(key, value),
    remove: (key) => void store.delete(key),
  };
  let time = 1_000_000;
  const guard = new CrashGuard(kept, () => time);
  return {
    guard,
    store,
    /** The next page starts (a new guard over the same storage). */
    reopen: () => new CrashGuard(kept, () => time),
    later: (ms: number) => void (time += ms),
  };
}

describe("CrashGuard", () => {
  it("lets the recogniser load on a device that has never fallen over", () => {
    const { guard } = setup();
    expect(guard.begin()).toBe(true);
  });

  it("forgets a device's earlier falls once the recogniser has listened to a window", () => {
    const { guard, reopen, later } = setup();
    for (let fall = 0; fall < 2; fall++) {
      expect(reopen().begin()).toBe(true); // (the page is closed by the system each time: no proved(), no interrupted())
      later(1000);
    }
    reopen().proved();
    for (let fall = 0; fall < 2; fall++) {
      expect(reopen().begin()).toBe(true);
      later(1000);
    }
    expect(guard.begin()).toBe(true); // (still not three in a row)
  });

  it("lets a device alone after three falls in a row, and tries again after three days", () => {
    const { reopen, later } = setup();
    expect(reopen().begin()).toBe(true);
    later(1000);
    expect(reopen().begin()).toBe(true); // (the first fall)
    later(1000);
    expect(reopen().begin()).toBe(true); // (the second)
    later(1000);
    expect(reopen().begin()).toBe(false); // (the third)
    later(DAY);
    expect(reopen().begin()).toBe(false);
    later(2 * DAY - 3000);
    expect(reopen().begin()).toBe(false); // (a moment short of three days since the last start)
    later(5000);
    expect(reopen().begin()).toBe(true);
    later(1000);
    expect(reopen().begin()).toBe(true); // (a clean slate: one fall is not three)
  });

  it("does not count a page that was closed on purpose, or a load that failed with an error, as a fall", () => {
    const { reopen, later } = setup();
    for (let i = 0; i < 6; i++) {
      const page = reopen();
      expect(page.begin(), `start ${i + 1}`).toBe(true);
      page.interrupted();
      later(1000);
    }
  });

  it("does not count a page that closed before the recogniser began to load", () => {
    const { guard, store } = setup();
    guard.interrupted();
    expect(store.size).toBe(0);
  });

  it("does not get in the way when nothing can be kept", () => {
    const broken: Kept = {
      get: () => {
        throw new Error("no storage");
      },
      set: () => {
        throw new Error("no storage");
      },
      remove: () => {
        throw new Error("no storage");
      },
    };
    const guard = new CrashGuard(broken);
    expect(guard.begin()).toBe(true);
    expect(() => guard.proved()).not.toThrow();
    expect(() => guard.interrupted()).not.toThrow();
  });

  it("starts afresh from a mark that cannot be read", () => {
    const { guard, store } = setup();
    store.set("tv.subsync.guard", "{not json");
    expect(guard.begin()).toBe(true);
    store.set("tv.subsync.guard", JSON.stringify({ strikes: "many" }));
    expect(guard.begin()).toBe(true);
  });
});
