import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DayCount, keepLimitsIn, LimitKeeper, RateLimiter, WorkBudget } from "./rateLimit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const folders: string[] = [];
async function fileIn(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "kino-limits-"));
  folders.push(folder);
  return path.join(folder, "limits.json");
}

afterEach(async () => {
  keepLimitsIn(undefined);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function life(file: string, clock: { now: number }) {
  const keeper = LimitKeeper.open(file);
  keepLimitsIn(keeper);
  const wrong = new RateLimiter(3, 15 * MINUTE, () => clock.now, "login.failedByName");
  const daily = new RateLimiter(2, 24 * HOUR, () => clock.now, "stickers.madePerDay");
  const unnamed = new RateLimiter(3, 15 * MINUTE, () => clock.now);
  const work = new WorkBudget(1000, HOUR, () => clock.now, "stickers.siteWork");
  keepLimitsIn(undefined);
  return { keeper, wrong, daily, unnamed, work };
}

describe("limits kept over a restart", () => {
  it("somebody who was told to wait before a restart still waits after it, and no longer than they would have", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const first = life(file, clock);
    for (let n = 0; n < 3; n++) {
      first.wrong.hit("alma@example.com");
      first.unnamed.hit("alma@example.com");
      clock.now += 1000;
    }
    first.daily.hit("acc_1");
    first.daily.hit("acc_1");
    first.work.spend(1500);
    expect(first.wrong.wait("alma@example.com")).toBeGreaterThan(0);
    const waited = first.wrong.wait("alma@example.com");
    first.keeper.save();

    clock.now += 30_000;
    const second = life(file, clock);
    expect(second.wrong.wait("alma@example.com")).toBe(waited - 30_000);
    expect(second.wrong.wait("boris@example.com")).toBe(0);
    expect(second.daily.wait("acc_1")).toBeGreaterThan(23 * HOUR);
    expect(second.work.wait()).toBeGreaterThan(0);
    expect(second.unnamed.wait("alma@example.com")).toBe(0);

    second.wrong.hit("carol@example.com");
    expect(second.wrong.wait("carol@example.com")).toBe(0);

    clock.now += 15 * MINUTE;
    expect(second.wrong.wait("alma@example.com")).toBe(0);
    expect(second.work.wait()).toBeGreaterThan(0);
    clock.now += HOUR;
    expect(second.work.wait()).toBe(0);
  });

  it("adds what is counted after the restart to what was counted before it", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const first = life(file, clock);
    first.wrong.hit("203.0.113.9");
    first.wrong.hit("203.0.113.9");
    first.keeper.save();
    clock.now += 5000;
    const second = life(file, clock);
    expect(second.wrong.wait("203.0.113.9")).toBe(0);
    second.wrong.hit("203.0.113.9");
    expect(second.wrong.wait("203.0.113.9")).toBeGreaterThan(0);
    second.wrong.reset("203.0.113.9");
    expect(second.wrong.wait("203.0.113.9")).toBe(0);
    second.keeper.save();
    clock.now += 5000;
    expect(life(file, clock).wrong.wait("203.0.113.9")).toBe(0);
  });

  it("goes through a second restart for somebody who did not come back in between", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const first = life(file, clock);
    for (let n = 0; n < 3; n++) first.wrong.hit("alma@example.com");
    first.keeper.save();
    clock.now += 10_000;
    life(file, clock).keeper.save();
    clock.now += 10_000;
    expect(life(file, clock).wrong.wait("alma@example.com")).toBeGreaterThan(0);
  });

  it("writes no address, name or account as it is, and nothing that has run out", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const first = life(file, clock);
    first.wrong.hit("alma@example.com");
    first.wrong.hit("203.0.113.9");
    clock.now += 16 * MINUTE;
    first.wrong.hit("2001:db8::1");
    first.daily.hit("acc_secret_1");
    first.keeper.save();
    const text = await readFile(file, "utf8");
    for (const key of ["alma@example.com", "203.0.113.9", "2001:db8::1", "acc_secret_1"]) expect(text).not.toContain(key);
    const written = JSON.parse(text) as { v: number; salt: string; limits: Record<string, Array<[string, number[]]>> };
    expect(written.v).toBe(1);
    expect(Object.keys(written.limits).sort()).toEqual(["login.failedByName", "stickers.madePerDay"]);
    expect(written.limits["login.failedByName"]).toHaveLength(1);
    const other = life(await fileIn(), clock);
    other.daily.hit("acc_secret_1");
    expect((other.keeper.view().limits["stickers.madePerDay"] as Array<[string, number[]]>)[0]![0]).not.toBe(written.limits["stickers.madePerDay"]![0]![0]);
  });

  it("starts empty from a file that is not there, is not JSON, or holds what no limiter wrote", async () => {
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    expect(life(await fileIn(), clock).wrong.wait("anybody")).toBe(0);
    const broken = await fileIn();
    await writeFile(broken, "{ not json");
    expect(life(broken, clock).wrong.wait("anybody")).toBe(0);
    const odd = await fileIn();
    const future = clock.now + HOUR;
    await writeFile(
      odd,
      JSON.stringify({
        v: 1,
        salt: "a-salt-that-is-long-enough-000",
        limits: { "login.failedByName": [["x", [future, future, future]], "nonsense", [1, 2], ["y", "z"]], "stickers.madePerDay": { not: "a list" }, "stickers.siteWork": [["a", "b"], [future, 5000], [clock.now - 5000, -4]] },
      }),
    );
    const lived = life(odd, clock);
    expect(lived.wrong.wait("anybody")).toBe(0);
    expect(lived.daily.wait("anybody")).toBe(0);
    expect(lived.work.wait()).toBe(0);
    expect(lived.keeper.view().limits).toEqual({});
  });

  it("keeps the first limiter of a name and no second one", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const keeper = LimitKeeper.open(file);
    keepLimitsIn(keeper);
    const one = new RateLimiter(1, HOUR, () => clock.now, "same.name");
    const two = new RateLimiter(1, HOUR, () => clock.now, "same.name");
    one.hit("a");
    two.hit("b");
    expect(keeper.names).toEqual(["same.name"]);
    expect(keeper.view().limits["same.name"]).toHaveLength(1);
  });

  it("is nothing at all when the server has no keeper (a test, or DATA_DIR=memory)", () => {
    const limiter = new RateLimiter(1, HOUR, Date.now, "login.failedByName");
    limiter.hit("a");
    expect(limiter.wait("a")).toBeGreaterThan(0);
  });
});

describe("a day's count", () => {
  it("counts per key up to its most a day, and begins again at midnight UTC for every key", () => {
    const clock = { now: Date.parse("2026-11-18T22:00:00Z") };
    const day = new DayCount(3, () => clock.now);
    for (let n = 0; n < 3; n++) {
      expect(day.wait("a")).toBe(0);
      day.hit("a");
    }
    expect(day.wait("a")).toBe(2 * HOUR);
    expect(day.wait("b")).toBe(0);
    expect(day.wait("b", 4)).toBeGreaterThan(0);
    day.hit("b", 3);
    expect(day.count("b")).toBe(3);
    day.undo("b");
    expect(day.count("b")).toBe(2);
    clock.now = Date.parse("2026-11-19T00:00:00Z");
    expect([day.wait("a"), day.count("a"), day.count("b")]).toEqual([0, 0, 0]);
  });

  it("holds so many keys at most, letting go of the one counted first", () => {
    const day = new DayCount(5, () => Date.parse("2026-11-18T10:00:00Z"), undefined, 3);
    for (const key of ["a", "b", "c", "d"]) day.hit(key);
    expect(["a", "b", "c", "d"].map((key) => day.count(key))).toEqual([0, 1, 1, 1]);
  });

  it("is kept over a restart as one number a key, written as codes, and only for the day it was counted", async () => {
    const file = await fileIn();
    const clock = { now: Date.parse("2026-11-18T10:00:00Z") };
    const first = LimitKeeper.open(file);
    keepLimitsIn(first);
    const before = new DayCount(1000, () => clock.now, "search.perDay");
    keepLimitsIn(undefined);
    before.hit("203.0.113.7", 999);
    first.save();
    const written = await readFile(file, "utf8");
    expect(written).not.toContain("203.0.113.7");
    expect(written.length).toBeLessThan(200);

    const second = LimitKeeper.open(file);
    keepLimitsIn(second);
    const after = new DayCount(1000, () => clock.now, "search.perDay");
    keepLimitsIn(undefined);
    expect(after.wait("203.0.113.7")).toBe(0);
    after.hit("203.0.113.7");
    expect(after.wait("203.0.113.7")).toBeGreaterThan(0);
    expect(after.count("203.0.113.8")).toBe(0);
    second.save();
    const third = LimitKeeper.open(file);
    clock.now = Date.parse("2026-11-19T00:00:01Z");
    keepLimitsIn(third);
    const nextDay = new DayCount(1000, () => clock.now, "search.perDay");
    keepLimitsIn(undefined);
    expect(nextDay.count("203.0.113.7")).toBe(0);
  });
});
