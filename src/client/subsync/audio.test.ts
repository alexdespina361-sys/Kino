import { describe, expect, it } from "vitest";
import { AudioFeed, type FeedOptions } from "./audio";
import { SAMPLE_RATE } from "./signals";
import type { Piece } from "./tap";

const SECONDS = 5;

/** A piece of film sound whose first data byte says which piece it is; decoding it gives a flat level of `id / 100`. */
const piece = (id: number, start = id * SECONDS): Piece => ({ start, end: start + SECONDS, init: Uint8Array.from([1, 1]), data: Uint8Array.from([id, 0, 0, 0]) });
const decodeFlat = async (bytes: Uint8Array) => new Float32Array(SECONDS * SAMPLE_RATE).fill((bytes[2] as number) / 100);

function feed(options: Partial<FeedOptions> = {}) {
  const sunk: Array<{ time: number; level: number }> = [];
  let unreadable = 0;
  const instance = new AudioFeed({
    decode: decodeFlat,
    sink: (time, pcm) => void sunk.push({ time, level: pcm[0] as number }),
    playhead: () => 0,
    unreadable: () => void unreadable++,
    ...options,
  });
  return { feed: instance, sunk, unreadable: () => unreadable };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("the film's sound arriving in pieces", () => {
  it("decodes the pieces in order and hands each to the voice detector", async () => {
    const { feed: f, sunk } = feed();
    f.push(piece(1));
    f.push(piece(2));
    f.push(piece(3));
    await settle();
    expect(sunk.map((s) => s.time)).toEqual([5, 10, 15]);
    expect(sunk[2]?.level).toBeCloseTo(0.03, 5);
    expect(f.ranges()).toEqual([{ from: 5, to: 20.1 }]);
  });

  it("decodes nothing while paused, keeps what came, and decodes it when the pause is over", async () => {
    let decoded = 0;
    const { feed: f, sunk } = feed({ decode: async (bytes) => (decoded++, decodeFlat(bytes)) });
    f.pause(true);
    f.push(piece(1));
    f.push(piece(2));
    await settle();
    await f.idle(); // (what is held back by a pause is not waited for)
    expect(decoded).toBe(0);
    expect(sunk).toEqual([]);
    f.push(piece(3));
    f.pause(false);
    await settle();
    expect(sunk.map((s) => s.time)).toEqual([5, 10, 15]);
    f.pause(true);
    f.push(piece(4));
    await settle();
    expect(sunk).toHaveLength(3);
  });

  it("decodes what is nearest the picture first when sound was held back (a viewer who turns the aligner on in the middle of a film)", async () => {
    const { feed: f, sunk } = feed({ playhead: () => 12 });
    f.pause(true);
    for (let id = 0; id < 6; id++) f.push(piece(id)); // (0 to 30 s)
    f.pause(false);
    await settle();
    // (The piece just ahead of the picture, then the one under it and the ones after it, and last the oldest: what is behind counts as farther.)
    expect(sunk.map((s) => s.time)).toEqual([15, 10, 20, 25, 5, 0]);
  });

  it("gives a window across pieces back as it was heard", async () => {
    const { feed: f } = feed();
    f.push(piece(1));
    f.push(piece(2));
    await settle();
    const window = f.pcm(8, 12) as Float32Array;
    expect(window.length).toBe(4 * SAMPLE_RATE);
    expect(window[0]).toBeCloseTo(0.01, 3);
    expect(window[window.length - 1]).toBeCloseTo(0.02, 3);
    expect(window[SAMPLE_RATE * 2 - 1]).toBeCloseTo(0.01, 3);
    expect(window[SAMPLE_RATE * 2 + 1]).toBeCloseTo(0.02, 3);
  });

  it("has no window where a piece is missing", async () => {
    const { feed: f } = feed();
    f.push(piece(1));
    f.push(piece(3));
    await settle();
    expect(f.pcm(8, 17)).toBeUndefined();
    expect(f.pcm(5, 10)).toBeDefined();
  });

  it("ignores a piece it has already", async () => {
    const { feed: f, sunk } = feed();
    f.push(piece(1));
    await settle();
    f.push(piece(1));
    await settle();
    expect(sunk).toHaveLength(1);
  });

  it("lets go of what is farthest from the picture when the sound kept grows too big", async () => {
    const { feed: f } = feed({ maxPcmBytes: 3 * SECONDS * SAMPLE_RATE * 2, playhead: () => 20 });
    for (let id = 0; id < 6; id++) f.push(piece(id));
    await settle();
    const kept = f.ranges();
    expect(kept.length).toBeGreaterThan(0);
    expect(f.pcm(25, 30)).toBeDefined();
    expect(f.pcm(0, 5)).toBeUndefined();
  });

  it("says the sound is unreadable after three pieces that cannot be decoded, when none could", async () => {
    const { feed: f, unreadable } = feed({
      decode: async () => {
        throw new Error("unsupported codec");
      },
    });
    for (let id = 0; id < 5; id++) f.push(piece(id));
    await settle();
    expect(unreadable()).toBe(1);
    expect(f.ranges()).toEqual([]);
  });

  it("does not give up on a film that has been read once", async () => {
    let calls = 0;
    const { feed: f, unreadable } = feed({
      decode: async (bytes) => {
        if (++calls > 1) throw new Error("one bad piece");
        return decodeFlat(bytes);
      },
    });
    for (let id = 0; id < 6; id++) f.push(piece(id));
    await settle();
    expect(unreadable()).toBe(0);
  });

  it("starts again after a reset, and a piece that comes while the old work ends is not lost", async () => {
    let release: (() => void) | undefined;
    const { feed: f, sunk } = feed({
      decode: (bytes) =>
        new Promise((resolve) => {
          if (bytes[2] === 1) release = () => resolve(new Float32Array(SECONDS * SAMPLE_RATE));
          else resolve(new Float32Array(SECONDS * SAMPLE_RATE).fill(0.5));
        }),
    });
    f.push(piece(1));
    await settle();
    f.reset();
    f.push(piece(2));
    release?.();
    await settle();
    expect(sunk.map((s) => s.time)).toEqual([10]);
    expect(f.ranges()).toEqual([{ from: 10, to: 15.1 }]);
  });
});
