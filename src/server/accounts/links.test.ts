import { describe, expect, it } from "vitest";
import { LinkRegistry } from "./links";

const MINUTE = 60_000;

describe("the requests of TVs that wait to be signed in", () => {
  let clock = 1_000_000;
  const open = () => new LinkRegistry(() => clock);
  const alive = (links: LinkRegistry, started: { code: string }) => links.peek(started.code) !== undefined;

  it("lets an address have ten open at once, and the eleventh takes the place of its oldest", () => {
    const links = open();
    const mine = Array.from({ length: 10 }, () => links.start("tv", "TV", "203.0.113.5")!);
    const theirs = links.start("tv", "TV", "203.0.113.6")!;
    expect(mine.every((each) => alive(links, each))).toBe(true);

    const eleventh = links.start("tv", "TV", "203.0.113.5")!;
    expect(eleventh).toBeDefined();
    // (The one that gave way is told as one that is gone, and the others are as they were.)
    expect(links.claim(mine[0]!.code, mine[0]!.secret)).toEqual({ status: "gone" });
    expect(mine.slice(1).every((each) => alive(links, each))).toBe(true);
    expect(alive(links, eleventh)).toBe(true);
    expect(alive(links, theirs)).toBe(true);

    links.start("tv", "TV", "203.0.113.5");
    expect(alive(links, mine[1]!)).toBe(false);
    expect(alive(links, mine[2]!)).toBe(true);
  });

  it("does not count the requests that have run out of time", () => {
    const links = open();
    const old = Array.from({ length: 10 }, () => links.start("tv", "TV", "203.0.113.5")!);
    clock += 6 * MINUTE;
    const fresh = Array.from({ length: 10 }, () => links.start("tv", "TV", "203.0.113.5")!);
    expect(old.some((each) => alive(links, each))).toBe(false);
    expect(fresh.every((each) => alive(links, each))).toBe(true);
  });

  it("gives a request its place when the table is full, by letting the oldest of all give way", () => {
    const links = open();
    // a thousand, ten from each of a hundred addresses
    const flood = Array.from({ length: 100 }, (_, address) => Array.from({ length: 10 }, () => links.start("tv", "TV", `198.51.100.${address}`)!)).flat();
    expect(flood).toHaveLength(1000);
    expect(flood.every((each) => alive(links, each))).toBe(true);

    const real = links.start("tv", "TV", "203.0.113.9");
    expect(real).toBeDefined();
    expect(alive(links, flood[0]!)).toBe(false);
    expect(flood.slice(1).every((each) => alive(links, each))).toBe(true);
    expect(alive(links, real!)).toBe(true);
  });

  it("cannot be filled by one address, and a TV that asks after the flood is signed in as ever", () => {
    const links = open();
    const flood = Array.from({ length: 200 }, () => links.start("tv", "TV", "198.51.100.1")!);
    expect(flood.filter((each) => alive(links, each))).toEqual(flood.slice(-10));

    const tv = links.start("tv", "TV", "203.0.113.9")!;
    expect(links.approve(tv.code, "acc_1")).toBe(true);
    expect(links.claim(tv.code, tv.secret)).toMatchObject({ status: "approved", accountId: "acc_1" });
  });

  it("takes a request made without an address as before: only the table's own limit counts", () => {
    const links = open();
    const many = Array.from({ length: 15 }, () => links.start("tv", "TV")!);
    expect(many.every((each) => alive(links, each))).toBe(true);
  });
});
