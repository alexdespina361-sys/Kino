import { describe, expect, it } from "vitest";
import { SegmentCache, type Opened } from "./segmentCache";

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
