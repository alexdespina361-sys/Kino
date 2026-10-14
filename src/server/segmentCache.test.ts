import { describe, expect, it } from "vitest";
import { bufferPolicy } from "../client/tv/engine";
import { DEFAULT_SEGMENT_CACHE_BYTES, SegmentCache, type Opened } from "./segmentCache";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (chunks: Uint8Array[]) => chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

async function readAll(piece: { read(): AsyncIterable<Uint8Array> }): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of piece.read()) chunks.push(chunk);
  return text(chunks);
}

/** A body that arrives in the pieces given, each after its own wait (milliseconds); `seen.released` says when whoever reads it has let go of it. */
function body(parts: [string, number?][], seen = { released: false }): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let next = 0;
      return {
        async next() {
          const part = parts[next++];
          if (!part) {
            seen.released = true;
            return { done: true, value: undefined };
          }
          if (part[1]) await new Promise((resolve) => setTimeout(resolve, part[1]));
          return { done: false, value: bytes(part[0]) };
        },
        async return() {
          seen.released = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
}

const opened = (parts: [string, number?][], patch: Partial<Opened> = {}, seen = { released: false }): Opened => ({
  status: 200,
  contentType: "video/mp2t",
  length: parts.reduce((sum, [part]) => sum + bytes(part).length, 0),
  stream: body(parts, seen),
  ...patch,
});

describe("SegmentCache", () => {
  it("fetches a piece once and answers the next from memory", async () => {
    const cache = new SegmentCache();
    let fetches = 0;
    const open = async () => (fetches++, opened([["abc"], ["def"]]));
    const first = await cache.get("seg1", open);
    expect(await readAll(first!)).toBe("abcdef");
    const second = await cache.get("seg1", open);
    expect(await readAll(second!)).toBe("abcdef");
    expect(fetches).toBe(1);
    expect(cache.keptBytes).toBe(6);
  });

  it("gives a piece that is still arriving to everyone who asks for it, from its first byte", async () => {
    const cache = new SegmentCache();
    let fetches = 0;
    const open = async () => (fetches++, opened([["one-"], ["two-", 40], ["three", 40]]));
    const first = cache.get("seg", open);
    const second = cache.get("seg", open); // asked for while the first is being opened
    const reading = readAll((await first)!);
    await new Promise((resolve) => setTimeout(resolve, 60)); // part way through
    const late = await cache.get("seg", open);
    expect(await Promise.all([reading, readAll((await second)!), readAll(late!)])).toEqual(["one-two-three", "one-two-three", "one-two-three"]);
    expect(fetches).toBe(1);
    expect([cache.hits, cache.misses]).toEqual([2, 1]); // (a piece that is still arriving is an answer from memory too)
  });

  it("counts the asks it answered from memory and the ones that went to the film's own place", async () => {
    const cache = new SegmentCache();
    const open = async () => opened([["abc"]]);
    await readAll((await cache.get("a", open))!);
    await cache.get("a", open);
    await cache.get("a", open);
    await cache.get("b", open);
    expect([cache.hits, cache.misses]).toEqual([2, 2]);
  });

  it("is not sure about a piece it could not open: the caller asks the ordinary way, and the next ask tries again", async () => {
    const cache = new SegmentCache();
    let fetches = 0;
    expect(await cache.get("seg", async () => (fetches++, Promise.reject(new Error("no"))))).toBeNull();
    expect(await cache.get("seg", async () => (fetches++, null))).toBeNull();
    const piece = await cache.get("seg", async () => (fetches++, opened([["ok"]])));
    expect(await readAll(piece!)).toBe("ok");
    expect(fetches).toBe(3);
  });

  it("shares an answer that said no while it is on its way, but does not keep it", async () => {
    const cache = new SegmentCache();
    let fetches = 0;
    const open = async () => (fetches++, opened([["gone"]], { status: 404 }));
    const [a, b] = await Promise.all([cache.get("seg", open), cache.get("seg", open)]);
    expect(a!.status).toBe(404);
    expect(await readAll(b!)).toBe("gone");
    await cache.get("seg", open);
    expect(fetches).toBe(2);
    expect(cache.keptBytes).toBe(0);
  });

  it("does not keep a piece that came out shorter or longer than it said, and its readers are told", async () => {
    const cache = new SegmentCache();
    let fetches = 0;
    const short = await cache.get("short", async () => (fetches++, opened([["abc"]], { length: 10 })));
    await expect(readAll(short!)).rejects.toThrow();
    const long = await cache.get("long", async () => (fetches++, opened([["abcdef"]], { length: 3 })));
    await expect(readAll(long!)).rejects.toThrow();
    expect(cache.keptBytes).toBe(0);
    const again = await cache.get("short", async () => (fetches++, opened([["abcdefghij"]])));
    expect(await readAll(again!)).toBe("abcdefghij");
    expect(fetches).toBe(3);
  });

  it("does not share a piece longer than it is willing to hold, and lets go of its connection", async () => {
    const cache = new SegmentCache({ maxPiece: 5 });
    const seen = { released: false };
    expect(await cache.get("big", async () => opened([["123456"]], {}, seen))).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.released).toBe(true);
  });

  it("forgets a piece after the time it is kept for", async () => {
    let now = 1_000;
    const cache = new SegmentCache({ keepMs: 5_000, now: () => now });
    let fetches = 0;
    const open = async () => (fetches++, opened([["abc"]]));
    await readAll((await cache.get("seg", open))!);
    now += 4_999;
    await readAll((await cache.get("seg", open))!);
    expect(fetches).toBe(1);
    now += 2;
    await readAll((await cache.get("seg", open))!);
    expect(fetches).toBe(2);
  });

  it("keeps no more than it is allowed to, the oldest going first", async () => {
    const cache = new SegmentCache({ maxBytes: 10 });
    const fetched: string[] = [];
    const open = (key: string, content: string) => async () => (fetched.push(key), opened([[content]]));
    for (const [key, content] of [["a", "1234"], ["b", "5678"], ["c", "9012"]] as const) await readAll((await cache.get(key, open(key, content)))!);
    expect(cache.keptBytes).toBe(8); // (a was let go to make room for c)
    await cache.get("b", open("b", "5678"));
    await cache.get("c", open("c", "9012"));
    expect(fetched).toEqual(["a", "b", "c"]);
    await cache.get("a", open("a", "1234"));
    expect(fetched).toEqual(["a", "b", "c", "a"]);
  });

  it("does not take on more pieces at once than it is allowed to", async () => {
    const cache = new SegmentCache({ maxUnderway: 2 });
    const slow = () => async () => opened([["x"], ["y", 30]]);
    const first = cache.get("one", slow());
    const second = cache.get("two", slow());
    expect(await cache.get("three", slow())).toBeNull();
    await readAll((await first)!);
    await readAll((await second)!);
    expect(await readAll((await cache.get("three", slow()))!)).toBe("xy");
  });
});

/*
 * Screens that watch one film together, through the real cache on a clock of its own. The film is in pieces of 4 seconds and 2 MB (4 Mbit/s),
 * and every screen downloads ahead of its picture as `bufferPolicy` says for it. What is counted is how often the film's own place is asked for
 * a piece it was asked for before. For the screens of a party that should come to (almost) nothing; it is what a party made afterwards, or a
 * screen with a slow connection, cost when every screen of it downloaded minutes ahead of its picture, far more than the cache can hold.
 */
const PIECE_S = 4;
const BITS_PER_SECOND = 4_000_000;
const PIECE_BYTES = (BITS_PER_SECOND / 8) * PIECE_S;
const STEP_S = 0.5;
const ZEROS = new Uint8Array(PIECE_BYTES);

/** How far ahead of its picture a screen downloads, in seconds: what hls.js aims at (`max(8 * maxBufferSize / bitrate, maxBufferLength)`, at most `maxMaxBufferLength`). */
function aheadSeconds(inParty: boolean, bitsPerSecond = BITS_PER_SECOND): number {
  const policy = bufferPolicy(inParty);
  return Math.min(Math.max((8 * policy.maxBufferSize) / bitsPerSecond, policy.maxBufferLength), policy.maxMaxBufferLength);
}

interface Viewer {
  /** When it starts (seconds on the clock of the simulation) and from where in the film (seconds). */
  from: number;
  at: number;
  /** How many pieces it can download in a second. */
  speed: number;
  /** Whether it is in a party at a time (under the party's numbers) or alone. */
  inParty: (clock: number) => boolean;
}

async function watchTogether(viewers: Viewer[], seconds: number): Promise<{ fetches: number; duplicates: number }> {
  let clock = 0;
  const cache = new SegmentCache({ now: () => clock * 1000 });
  const fetched = new Set<string>();
  const open = (key: string) => async (): Promise<Opened> => {
    fetched.add(key);
    return {
      status: 200,
      contentType: "video/mp2t",
      length: PIECE_BYTES,
      stream: {
        async *[Symbol.asyncIterator]() {
          yield ZEROS;
        },
      },
    };
  };
  const screens = viewers.map((viewer) => ({ ...viewer, position: viewer.at, next: Math.floor(viewer.at / PIECE_S), carry: 0 }));
  for (let tick = 0; tick * STEP_S < seconds; tick++) {
    clock = tick * STEP_S;
    for (const screen of screens) {
      if (clock < screen.from) continue;
      if (screen.next * PIECE_S > screen.position) screen.position += STEP_S; // (the picture runs while it has pieces, and waits when it has none)
      const ahead = aheadSeconds(screen.inParty(clock));
      screen.carry += screen.speed * STEP_S;
      while (screen.carry >= 1 && screen.next * PIECE_S - screen.position < ahead) {
        const key = String(screen.next++);
        screen.carry -= 1;
        const piece = await cache.get(key, open(key));
        if (piece) for await (const chunk of piece.read()) void chunk;
      }
      if (screen.next * PIECE_S - screen.position >= ahead) screen.carry = 0; // (a full buffer does not save up for a burst)
    }
  }
  return { fetches: cache.misses, duplicates: cache.misses - fetched.size };
}

describe("screens watching one film together", () => {
  const GOOD = 2; // pieces a second: 32 Mbit/s
  const SLOW = 0.3; // 1.2 times as fast as the picture runs
  const together = (inParty: boolean) => () => inParty;

  it("download further ahead alone than the cache holds, and in a party no further than half of it, at any usual bitrate", () => {
    const aheadBytes = (inParty: boolean, bitsPerSecond: number) => (aheadSeconds(inParty, bitsPerSecond) * bitsPerSecond) / 8;
    expect(aheadBytes(false, BITS_PER_SECOND)).toBeGreaterThan(DEFAULT_SEGMENT_CACHE_BYTES);
    for (const mbit of [0.5, 1, 2, 4, 6, 8, 12, 16]) {
      expect(aheadBytes(true, mbit * 1_000_000), `${mbit} Mbit/s`).toBeLessThanOrEqual(DEFAULT_SEGMENT_CACHE_BYTES / 2 + 1);
    }
  });

  it("go to the film's own place once for each piece when they start together", async () => {
    const screens = [0, 0.5, 1, 2].map((from): Viewer => ({ from, at: 0, speed: GOOD, inParty: together(true) }));
    expect((await watchTogether(screens, 600)).duplicates).toBe(0);
  });

  it("go to the film's own place once for each piece when one of them has a slow connection (as they did not when each went minutes ahead)", async () => {
    const screens = (inParty: boolean): Viewer[] => [
      { from: 0, at: 0, speed: GOOD, inParty: together(inParty) },
      { from: 0, at: 0, speed: SLOW, inParty: together(inParty) },
    ];
    expect((await watchTogether(screens(true), 600)).duplicates).toBe(0);
    expect((await watchTogether(screens(false), 600)).duplicates).toBeGreaterThan(100); // (what the numbers of a lone screen would have cost the same party)
  });

  it("go to the film's own place again only for what the host had downloaded alone before the party, when it is made afterwards", async () => {
    // The host watches alone for two minutes (downloading far ahead, as a lone screen does), then a party is made and three guests join a minute apart.
    const screens = (inParty: boolean): Viewer[] => [
      { from: 0, at: 0, speed: GOOD, inParty: (clock) => inParty && clock >= 120 },
      ...[120, 180, 240].map((joins): Viewer => ({ from: joins, at: joins, speed: GOOD, inParty: together(inParty) })),
    ];
    const lead = Math.ceil(aheadSeconds(false) / PIECE_S); // (the pieces a lone host is ahead by: the cache cannot hold them, so the first guest asks for them again)
    const party = await watchTogether(screens(true), 600);
    const alone = await watchTogether(screens(false), 600);
    expect(party.duplicates).toBeLessThanOrEqual(lead + 2);
    expect(alone.duplicates).toBeGreaterThan(2 * party.duplicates); // (every guest asked again for everything it was ahead by)
    expect(party.fetches).toBeLessThan(alone.fetches);
    expect((await watchTogether(screens(true), 1200)).duplicates).toBe(party.duplicates); // (and then nothing is asked for twice, however long it goes on)
  });
});
