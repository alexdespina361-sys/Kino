import { describe, expect, it } from "vitest";
import { BROWSERS_PER_ADDRESS, HERE_MS, HOURS_KEPT, LiveCount, oddHours, type HourAnswers } from "./live";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PHONE = "Mozilla/5.0 (Linux; Android 10; K) Chrome/156.0 Mobile Safari/537.36";
const LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0 Safari/537.36";

describe("who is here now", () => {
  it("counts a browser at an address once however much it asks, and tells the signed-in from the guests", () => {
    let clock = Date.parse("2026-11-18T10:00:00Z");
    const live = new LiveCount(() => clock);
    expect(live.now()).toEqual({ people: 0, signedIn: 0, guests: 0 });
    for (let i = 0; i < 5; i++) live.seen("203.0.113.7", PHONE, false);
    live.seen("203.0.113.7", LAPTOP, true); // (the same home, another device)
    live.seen("203.0.113.8", PHONE, false);
    expect(live.now()).toEqual({ people: 3, signedIn: 1, guests: 2 });
  });

  it("counts one address as a few people at most, however many names its browser gives itself; a new one is counted once room is made", () => {
    let clock = Date.parse("2026-11-18T10:00:00Z");
    const live = new LiveCount(() => clock);
    for (let i = 0; i < 500; i++) live.seen("198.51.100.1", `made up ${i}`, false);
    live.seen("203.0.113.7", PHONE, true);
    expect(live.now()).toEqual({ people: BROWSERS_PER_ADDRESS + 1, signedIn: 1, guests: BROWSERS_PER_ADDRESS });
    // (they leave; a quarter of an hour later the address's places are free again)
    clock += 16 * MINUTE;
    live.seen("203.0.113.9", PHONE, false); // (the sweep of the minute runs)
    live.seen("198.51.100.1", LAPTOP, true);
    expect(live.now()).toEqual({ people: 2, signedIn: 1, guests: 1 });
  });

  it("no longer counts a browser that asked nothing for five minutes, and counts it again when it is back", () => {
    let clock = Date.parse("2026-11-18T10:00:00Z");
    const live = new LiveCount(() => clock);
    live.seen("203.0.113.7", PHONE, true);
    clock += HERE_MS;
    expect(live.now().people).toBe(1);
    clock += 1;
    expect(live.now().people).toBe(0);
    live.seen("203.0.113.7", PHONE, false);
    expect(live.now()).toEqual({ people: 1, signedIn: 0, guests: 1 }); // (it signed out meanwhile: what it was is not remembered past the five minutes)
  });

  it("keeps a browser signed in while some of what it asks carries no session (a picture, a page)", () => {
    let clock = Date.parse("2026-11-18T10:00:00Z");
    const live = new LiveCount(() => clock);
    live.seen("203.0.113.7", PHONE, true);
    clock += MINUTE;
    live.seen("203.0.113.7", PHONE, false);
    expect(live.now()).toEqual({ people: 1, signedIn: 1, guests: 0 });
  });

  it("keeps nothing that says who: asked what it holds, it has counts only", () => {
    const live = new LiveCount(() => 1_000_000);
    live.seen("203.0.113.77", PHONE, true);
    const held = JSON.stringify(live, (_key, value: unknown) => (value instanceof Map ? [...value.entries()] : value));
    expect(held).not.toContain("203.0.113.77");
    expect(held).not.toContain("Android");
  });
});

describe("how the server answered, by the hour", () => {
  it("counts every answer in its hour, and of them the refusals, the waits and the server's own failures", () => {
    let clock = Date.parse("2026-11-18T10:20:00Z");
    const live = new LiveCount(() => clock);
    for (const status of [200, 200, 304, 401, 403, 429, 500, 503, 404]) live.answered(status);
    clock += HOUR;
    live.answered(200);
    const hours = live.answers(3);
    expect(hours.map((each) => new Date(each.hour).toISOString().slice(11, 16))).toEqual(["09:00", "10:00", "11:00"]);
    expect(hours[0]).toMatchObject({ requests: 0, refused: 0, limited: 0, failed: 0 });
    expect(hours[1]).toMatchObject({ requests: 9, refused: 2, limited: 1, failed: 2 });
    expect(hours[2]).toMatchObject({ requests: 1 });
  });

  it("hands its hours over a restart and takes them back, added to what the new life counted; who is here is not handed over", () => {
    let clock = Date.parse("2026-11-18T10:20:00Z");
    const first = new LiveCount(() => clock);
    first.seen("203.0.113.7", PHONE, true);
    for (const status of [200, 200, 401, 429, 500]) first.answered(status);
    clock += HOUR;
    first.answered(200);
    const handed = JSON.parse(JSON.stringify(first.kept())) as unknown;
    expect(JSON.stringify(handed)).not.toContain("203.0.113");

    clock += 30_000;
    const second = new LiveCount(() => clock);
    second.answered(429); // (already counting when what was kept is given back)
    second.restore(handed);
    expect(second.now()).toEqual({ people: 0, signedIn: 0, guests: 0 });
    expect(second.answers(2)).toEqual([
      { hour: Date.parse("2026-11-18T10:00:00Z"), requests: 5, refused: 1, limited: 1, failed: 1 },
      { hour: Date.parse("2026-11-18T11:00:00Z"), requests: 2, refused: 0, limited: 1, failed: 0 },
    ]);

    // What no server wrote is let go: an hour that is not an hour, one from the future, one too old, numbers that are none.
    const third = new LiveCount(() => clock);
    third.restore([[clock + 5, 9, 9, 9, 9], [Date.parse("2026-11-19T10:00:00Z"), 9, 0, 0, 0], [Date.parse("2026-11-10T10:00:00Z"), 9, 0, 0, 0], "x", [Date.parse("2026-11-18T10:00:00Z"), -4, "many", 1.5, null]]);
    expect(third.answers(HOURS_KEPT).reduce((all, each) => all + each.requests + each.refused + each.limited + each.failed, 0)).toBe(0);
    third.restore({ not: "a list" });
  });

  it("keeps two days of hours and no more", () => {
    let clock = Date.parse("2026-11-18T10:20:00Z");
    const live = new LiveCount(() => clock);
    live.answered(200);
    clock += HOURS_KEPT * HOUR;
    live.answered(200);
    expect(live.answers(1000)).toHaveLength(HOURS_KEPT);
    expect(live.answers(HOURS_KEPT).reduce((sum, each) => sum + each.requests, 0)).toBe(1); // (the first one is forgotten)
  });
});

describe("an hour that looks unlike the others", () => {
  const hour = (n: number, extra: Partial<HourAnswers> = {}): HourAnswers => ({ hour: n * HOUR, requests: 500, refused: 3, limited: 0, failed: 0, ...extra });
  const usual = Array.from({ length: 22 }, (_, n) => hour(n));

  it("is named when it turned away, told to wait or failed far more than the usual hour, and enough to be more than a slip", () => {
    expect(oddHours([...usual, hour(22), hour(23)])).toEqual([]);
    expect(oddHours([...usual, hour(22, { refused: 80 }), hour(23, { limited: 45, failed: 31 })])).toEqual([
      { hour: 22 * HOUR, what: "refused", count: 80, usual: 3 },
      { hour: 23 * HOUR, what: "limited", count: 45, usual: 0 },
      { hour: 23 * HOUR, what: "failed", count: 31, usual: 0 },
    ]);
  });

  it("is not named for a handful, for a site that is always like that, nor with too little to compare with", () => {
    expect(oddHours([...usual, hour(22, { refused: 14 }), hour(23, { failed: 29 })])).toEqual([]);
    const busy = Array.from({ length: 22 }, (_, n) => hour(n, { refused: 40 }));
    expect(oddHours([...busy, hour(22, { refused: 60 }), hour(23, { refused: 190 })])).toEqual([]); // (not five times the usual forty)
    expect(oddHours([hour(0), hour(1, { refused: 500 })])).toEqual([]);
    // (a server that has just started: the hours before it are empty, and say nothing of what is usual)
    const quiet = Array.from({ length: 22 }, (_, n) => hour(n, { requests: 0, refused: 0 }));
    expect(oddHours([...quiet, hour(22, { refused: 80 }), hour(23, { refused: 90 })])).toEqual([]);
  });
});
