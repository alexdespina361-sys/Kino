import { afterEach, describe, expect, it, vi } from "vitest";
import { SUBSYNC_MAX_LINES, SUBSYNC_MAX_MOVE, type SharedPlacement, type SharedTiming } from "../../shared";
import type { Cue } from "./cues";
import { BAD_STRETCHES, Borrowed, GOOD_STRETCHES, hash128, httpShared, Lent, MIN_COMMON, timingKeys } from "./share";

const cues = (count: number, start = 10): Cue[] => Array.from({ length: count }, (_, i) => ({ start: start + i * 4, end: start + i * 4 + 2.5, text: `line ${i}` }));
const timing = (lines: number, ...placed: SharedPlacement[]): SharedTiming => ({ v: 1, lines, placed });

describe("hash128", () => {
  it("gives 32 hex digits, the same ones for the same text", () => {
    expect(hash128("Hello")).toMatch(/^[0-9a-f]{32}$/);
    expect(hash128("Hello")).toBe(hash128("Hello"));
    expect(hash128("")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("tells texts apart, and the order of their parts", () => {
    expect(hash128("ab")).not.toBe(hash128("ba"));
    expect(hash128("Hello")).not.toBe(hash128("Hello "));
    const seen = new Set<string>();
    for (let n = 0; n < 20_000; n++) seen.add(hash128(`line ${n}\t${n * 7}\t${(n * 31) % 977}`));
    expect(seen.size).toBe(20_000);
  });

  it("changes about half of its bits when one character of a long text changes", () => {
    const base = Array.from({ length: 400 }, (_, i) => `${i * 100}\t${i * 100 + 250}\tsomething said ${i}`).join("\n");
    let flipped = 0;
    const samples = 100;
    for (let n = 0; n < samples; n++) {
      const at = (n * 37) % base.length;
      const changed = base.slice(0, at) + (base[at] === "x" ? "y" : "x") + base.slice(at + 1);
      const a = hash128(base);
      const b = hash128(changed);
      for (let i = 0; i < 32; i++) flipped += (parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)).toString(2).replace(/0/g, "").length;
    }
    const average = flipped / samples;
    expect(average).toBeGreaterThan(50);
    expect(average).toBeLessThan(78);
  });
});

describe("timingKeys", () => {
  const base = { duration: 5400, audio: "en", cues: cues(50) };

  it("names a file the same way every time, with a second name for the next length of film", () => {
    const keys = timingKeys(base)!;
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(timingKeys(base)).toEqual(keys);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("tells files, cuts, sounds apart", () => {
    const key = timingKeys(base)![0];
    expect(timingKeys({ ...base, cues: cues(50, 10.5) })![0]).not.toBe(key); // (other times)
    expect(timingKeys({ ...base, cues: cues(50).map((cue, i) => (i === 7 ? { ...cue, text: "other" } : cue)) })![0]).not.toBe(key);
    expect(timingKeys({ ...base, cues: cues(51) })![0]).not.toBe(key);
    expect(timingKeys({ ...base, audio: "fr" })![0]).not.toBe(key);
    expect(timingKeys({ ...base, audio: undefined })![0]).not.toBe(key);
    expect(timingKeys({ ...base, duration: 5460 })![0]).not.toBe(key);
  });

  it("does not mind markup and spacing in the words", () => {
    const plain = [{ start: 1, end: 2, text: "Hello there" }];
    const marked = [{ start: 1, end: 2, text: "<i>Hello</i>   there\n" }];
    expect(timingKeys({ ...base, cues: marked })![0]).toBe(timingKeys({ ...base, cues: plain })![0]);
  });

  it("is shared by screens that find the film's length a little differently (either side of the edge of a bucket too)", () => {
    const at = (duration: number) => timingKeys({ ...base, duration })!;
    for (const [a, b] of [
      [5400, 5400.4],
      [5400.49, 5400.51],
      [5399.6, 5400.4],
      [5400, 5401],
      [5399.6, 5400.9],
    ] as const) {
      const first = at(a);
      const second = at(b);
      expect(first.some((key) => second.includes(key)), `${a} and ${b}`).toBe(true);
    }
  });

  it("is not shared by a film that is a few seconds longer or shorter: that is another cut, or a source with a longer lead-in, and its lines are said at other times", () => {
    const at = (duration: number) => timingKeys({ ...base, duration })!;
    for (const [a, b] of [
      [5400, 5403],
      [5398, 5402],
      [5402, 5404],
      [5398, 5430],
    ] as const) expect(at(a).some((key) => at(b).includes(key)), `${a} and ${b}`).toBe(false);
  });

  it("gives nothing when the length is not known or the file is no film's", () => {
    expect(timingKeys({ ...base, duration: Number.NaN })).toBeUndefined();
    expect(timingKeys({ ...base, duration: Infinity })).toBeUndefined();
    expect(timingKeys({ ...base, duration: 0 })).toBeUndefined();
    expect(timingKeys({ ...base, cues: [] })).toBeUndefined();
    expect(timingKeys({ ...base, cues: cues(SUBSYNC_MAX_LINES + 1) })).toBeUndefined();
  });
});

describe("Borrowed", () => {
  const file = cues(40);
  /** Placements of the first `count` lines, `moved` seconds from the file's. */
  const moved = (count: number, seconds: number, words = 1 as 0 | 1, from = 0): SharedPlacement[] =>
    Array.from({ length: count }, (_, i) => [from + i, Math.round(seconds * 100), Math.round(seconds * 100), words] as SharedPlacement);
  /** What a solve of the lines `from..from+count` would say, if it found them `seconds` from the file's times. */
  const solve = (from: number, count: number, seconds: number) => Array.from({ length: count }, (_, i) => ({ index: from + i, start: file[from + i]!.start + seconds }));

  it("reads the lines as absolute times, and leaves out lines the file does not have", () => {
    const borrowed = new Borrowed(timing(40, [0, -300, -250, 1], [5, 120, 130, 0]), file);
    expect(borrowed.size).toBe(2);
    expect(borrowed.at(0)).toEqual({ start: 7, end: 10, words: true });
    expect(borrowed.at(5)?.start).toBeCloseTo(file[5]!.start + 1.2);
    expect(borrowed.at(5)?.words).toBe(false);
    expect(new Borrowed(timing(40, [39, 0, 0, 1], [39 + 10, 0, 0, 1]), file.slice(0, 40)).size).toBe(1);
  });

  it("never puts a line before the start of the film or makes it end before it starts", () => {
    const borrowed = new Borrowed(timing(40, [0, -3000, -3000, 1]), file);
    const line = borrowed.at(0)!;
    expect(line.start).toBe(0);
    expect(line.end).toBeGreaterThan(line.start);
  });

  it("is believed after stretches of work that agree with it, and not before", () => {
    const borrowed = new Borrowed(timing(40, ...moved(40, -3)), file);
    borrowed.check(solve(0, MIN_COMMON - 1, -3)); // (too few lines in common to say)
    expect(borrowed.state).toBe("checking");
    borrowed.check(solve(0, 12, -3));
    expect(borrowed.state).toBe("checking");
    borrowed.check(solve(10, 12, -3.4));
    expect(borrowed.state).toBe(GOOD_STRETCHES === 2 ? "trusted" : "checking");
  });

  it("allows a stretch that is mostly right (the voice detector is a little off now and then)", () => {
    const borrowed = new Borrowed(timing(40, ...moved(40, -3)), file);
    const rough = solve(0, 10, -3).map((line, i) => (i < 4 ? { ...line, start: line.start + 7 } : line)); // (6 of 10 within the bar)
    borrowed.check(rough);
    borrowed.check(rough);
    expect(borrowed.state).toBe("trusted");
  });

  it("allows the voice detector's second or three of error on real sound, and not a timing for another cut", () => {
    // (Measured on a real film: a timing right to 0.2 s, against the first solves of a screen that had only the voice detector: 1 to 4.5 s, mostly under 3.)
    const noisy = (from: number) => solve(from, 14, -3).map((line, i) => ({ ...line, start: line.start + [-0.4, -1.2, -2.3, -1.3, -1.9, -2.2, -3.1, -1.1, -2.2, -3.3, -0.6, -1.9, -2.2, -4.2][i]! }));
    const right = new Borrowed(timing(40, ...moved(40, -3)), file);
    right.check(noisy(0));
    right.check(noisy(12));
    expect(right.state).toBe("trusted");

    const otherCut = new Borrowed(timing(40, ...moved(40, -3 + 9)), file); // (nine seconds later than this screen finds the lines)
    for (const from of [0, 8, 16, 24]) otherCut.check(noisy(from));
    expect(otherCut.state).toBe("rejected");
  });

  it("says whether a stretch of work is where the timing has its lines by most of the lines, not by each one", () => {
    const borrowed = new Borrowed(timing(40, ...moved(40, -3)), file);
    expect(borrowed.agrees(solve(0, MIN_COMMON - 1, -3))).toBeUndefined(); // (too few lines in common to say)
    expect(borrowed.agrees(solve(0, 12, -3))).toBe(true);
    expect(borrowed.agrees(solve(0, 12, -3 + 2.4))).toBe(true); // (the voice detector's usual error over a stretch)
    expect(borrowed.agrees(solve(0, 12, 17))).toBe(false); // (another cut)
    const rough = solve(0, 15, -3).map((line, i) => (i % 5 === 0 ? { ...line, start: line.start + 6 } : line)); // (one line in five far off)
    expect(borrowed.agrees(rough)).toBe(true);
    const mostlyWrong = solve(0, 15, -3).map((line, i) => (i % 5 === 0 ? line : { ...line, start: line.start + 6 }));
    expect(borrowed.agrees(mostlyWrong)).toBe(false);
  });

  it("is let go after stretches that do not agree, even with a good one among them", () => {
    const borrowed = new Borrowed(timing(40, ...moved(40, -3)), file);
    borrowed.check(solve(0, 12, 17));
    borrowed.check(solve(10, 12, -3));
    expect(borrowed.state).toBe("checking");
    borrowed.check(solve(12, 12, 20));
    expect(borrowed.state).toBe("checking");
    borrowed.check(solve(20, 12, 14));
    expect(borrowed.state).toBe(BAD_STRETCHES === 3 ? "rejected" : "checking");
  });

  it("stays as it was decided", () => {
    const trusted = new Borrowed(timing(40, ...moved(40, -3)), file);
    trusted.check(solve(0, 12, -3));
    trusted.check(solve(5, 12, -3));
    for (let n = 0; n < 6; n++) trusted.check(solve(10, 12, 30));
    expect(trusted.state).toBe("trusted");
    const rejected = new Borrowed(timing(40, ...moved(40, -3)), file);
    for (let n = 0; n < 3; n++) rejected.check(solve(0, 12, 30));
    for (let n = 0; n < 6; n++) rejected.check(solve(0, 12, -3));
    expect(rejected.state).toBe("rejected");
  });

  it("counts only the lines it has", () => {
    const borrowed = new Borrowed(timing(40, ...moved(6, -3)), file);
    for (let n = 0; n < 5; n++) borrowed.check(solve(0, 20, 99)); // (only 6 in common: says nothing)
    expect(borrowed.state).toBe("checking");
  });

  it("says when it places all of a file, or most of it", () => {
    expect(new Borrowed(timing(40, ...moved(40, -3)), file).complete()).toBe(true);
    expect(new Borrowed(timing(40, ...moved(36, -3)), file).complete()).toBe(true);
    expect(new Borrowed(timing(40, ...moved(35, -3)), file).complete()).toBe(false);
  });

  it("knows the stretches of the picture it has lines in, and how far the file is moved", () => {
    const wide = cues(10).map((cue, i) => ({ ...cue, start: i < 5 ? 10 + i * 4 : 400 + i * 4, end: i < 5 ? 12 + i * 4 : 402 + i * 4 }));
    const borrowed = new Borrowed(timing(10, ...moved(10, -3)), wide);
    const ranges = borrowed.ranges();
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.from).toBeCloseTo(7);
    expect(ranges[0]!.to).toBeCloseTo(28 - 3); // (the fifth line, 26 to 28 in the file)
    expect(ranges[1]!.from).toBeCloseTo(420 - 3); // (the sixth, a good way on)
    expect(borrowed.shift()).toBeCloseTo(-3);
  });
});

describe("Lent", () => {
  const file = cues(30);

  it("leaves the lines it placed, as how far each moved, in order", () => {
    const lent = new Lent();
    lent.note(5, file[5]!, file[5]!.start - 3, file[5]!.end - 2.9, true);
    lent.note(2, file[2]!, file[2]!.start + 1.234, file[2]!.end + 1.234, false);
    expect(lent.pending()).toBe(2);
    expect(lent.take(30)).toEqual(timing(30, [2, 123, 123, 0], [5, -300, -290, 1]));
  });

  it("leaves a line again when it has moved since, and only then", () => {
    const lent = new Lent();
    lent.note(1, file[1]!, file[1]!.start - 3, file[1]!.end - 3, true);
    lent.note(2, file[2]!, file[2]!.start - 3, file[2]!.end - 3, true);
    lent.confirm(lent.take(30)!);
    expect(lent.pending()).toBe(0);
    expect(lent.take(30)).toBeUndefined();
    lent.note(1, file[1]!, file[1]!.start - 3, file[1]!.end - 3, true); // (the same)
    expect(lent.pending()).toBe(0);
    lent.note(2, file[2]!, file[2]!.start - 3.2, file[2]!.end - 3.2, true);
    expect(lent.take(30)).toEqual(timing(30, [2, -320, -320, 1]));
  });

  it("does not count what the server did not take", () => {
    const lent = new Lent();
    lent.note(1, file[1]!, file[1]!.start - 3, file[1]!.end - 3, true);
    lent.take(30); // (asked for, not confirmed)
    expect(lent.pending()).toBe(1);
  });

  it("keeps a line that had words as that, against the voice detector alone", () => {
    const lent = new Lent();
    lent.note(1, file[1]!, file[1]!.start - 3, file[1]!.end - 3, true);
    lent.note(1, file[1]!, file[1]!.start - 2, file[1]!.end - 2, false);
    expect(lent.take(30)).toEqual(timing(30, [1, -300, -300, 1]));
    lent.note(1, file[1]!, file[1]!.start - 2.9, file[1]!.end - 2.9, true); // (words again: the newer)
    expect(lent.take(30)).toEqual(timing(30, [1, -290, -290, 1]));
  });

  it("does not leave a line that moved further than a timing can say, and forgets one that did before", () => {
    const lent = new Lent();
    lent.note(1, file[1]!, file[1]!.start + SUBSYNC_MAX_MOVE + 1, file[1]!.end + SUBSYNC_MAX_MOVE + 1, true);
    expect(lent.pending()).toBe(0);
    lent.note(2, file[2]!, file[2]!.start - 3, file[2]!.end - 3, true);
    lent.note(2, file[2]!, file[2]!.start - SUBSYNC_MAX_MOVE - 1, file[2]!.end - SUBSYNC_MAX_MOVE - 1, true);
    expect(lent.pending()).toBe(0);
  });

  it("forgets a line that was taken from a timing after all, which is not this screen's own work", () => {
    const lent = new Lent();
    lent.note(1, file[1]!, file[1]!.start - 3, file[1]!.end - 3, false);
    lent.note(2, file[2]!, file[2]!.start - 3, file[2]!.end - 3, false);
    lent.drop(1);
    lent.drop(7); // (a line that was never noted: nothing happens)
    expect(lent.pending()).toBe(1);
    expect(lent.take(30)?.placed.map((each) => each[0])).toEqual([2]);
  });

  it("leaves only lines the file has, and no more than it is asked to", () => {
    const lent = new Lent();
    for (let i = 0; i < 10; i++) lent.note(i, cues(10)[i]!, cues(10)[i]!.start - 1, cues(10)[i]!.end - 1, true);
    expect(lent.take(5)?.placed.map((each) => each[0])).toEqual([0, 1, 2, 3, 4]);
    expect(lent.take(10, 3)?.placed.map((each) => each[0])).toEqual([0, 1, 2]);
  });
});

describe("httpShared", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const key = "0123456789abcdef0123456789abcdef";
  const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

  it("asks for a timing and takes what the server has", async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(200, timing(30, [1, 10, 10, 1])));
    vi.stubGlobal("fetch", fetchMock);
    expect(await httpShared().get(key)).toEqual(timing(30, [1, 10, 10, 1]));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/subsync/${key}`);
  });

  it("says nothing was found when the server has none, says something odd, or cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => reply(404, { error: "not_found" }));
    expect(await httpShared().get(key)).toBeUndefined();
    vi.stubGlobal("fetch", async () => reply(200, { v: 1, lines: 3, placed: [[9, 0, 0, 0]] }));
    expect(await httpShared().get(key)).toBeUndefined();
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    expect(await httpShared().get(key)).toBeUndefined();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await httpShared().get(key)).toBeUndefined();
  });

  it("does not wait for a server that is slow", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const asking = httpShared().get(key);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await asking).toBeUndefined();
  });

  it("leaves a timing as JSON, with keepalive for a page that is closing", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => reply(204));
    vi.stubGlobal("fetch", fetchMock);
    const body = timing(30, [1, 10, 10, 1]);
    expect(await httpShared("https://kino.example").put(key, body, true)).toBe("taken");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://kino.example/api/subsync/${key}`);
    expect(init).toMatchObject({ method: "PUT", keepalive: true, headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body as string)).toEqual(body);
    await httpShared().put(key, body);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ keepalive: false });
  });

  it("says whether the server will never take it (another file is kept under the name) or could not for now (it is busy, a limit, no connection)", async () => {
    vi.stubGlobal("fetch", async () => reply(409, { error: "different_file" }));
    expect(await httpShared().put(key, timing(30, [1, 10, 10, 1]))).toBe("refused");
    vi.stubGlobal("fetch", async () => reply(413, { error: "too_big" }));
    expect(await httpShared().put(key, timing(30, [1, 10, 10, 1]))).toBe("refused");
    for (const status of [429, 500, 503]) {
      vi.stubGlobal("fetch", async () => reply(status, { error: "later" }));
      expect(await httpShared().put(key, timing(30, [1, 10, 10, 1])), `${status}`).toBe("failed");
    }
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await httpShared().put(key, timing(30, [1, 10, 10, 1]))).toBe("failed");
  });
});
