import { describe, expect, it } from "vitest";
import { livePcm, SAMPLE_RATE, Stamper } from "./capture";
import { SAMPLE_RATE as ALIGNER_RATE } from "./signals";

const RATE = 1000;

const stamper = (delay = 0) => {
  const given: Array<{ start: number; length: number }> = [];
  const stamp = new Stamper(RATE, (start, samples) => given.push({ start, length: samples.length }), delay);
  return { stamp, given };
};
const block = (length = 100) => new Float32Array(length);

describe("the times of the sound taken from a playing film", () => {
  it("is the aligner's rate", () => {
    expect(SAMPLE_RATE).toBe(ALIGNER_RATE);
  });

  it("makes pieces of 5 s that follow on from each other exactly, counted in samples, from the time of the first block", () => {
    const { stamp, given } = stamper();
    stamp.block(block(), 10);
    for (let i = 1; i <= 100; i++) stamp.block(block(), 10 + i * 0.1 + (i % 2 ? 0.03 : -0.03));
    expect(given.map((piece) => piece.length)).toEqual([5000, 5000]);
    expect(given[0]!.start).toBeCloseTo(10, 9);
    expect(given[1]!.start).toBeCloseTo(15, 9);
  });

  it("takes where a stretch begins from all the blocks of its first piece, not from one reading of the clock", () => {
    const { stamp, given } = stamper();
    stamp.block(block(), 10.05);
    for (let i = 1; i <= 50; i++) stamp.block(block(), 10 + i * 0.1);
    expect(given[0]!.start).toBeCloseTo(10, 2);
  });

  it("puts the sound back by the capture's delay", () => {
    const { stamp, given } = stamper(0.2);
    stamp.block(block(), 10);
    for (let i = 1; i <= 50; i++) stamp.block(block(), 10 + i * 0.1);
    expect(given[0]!.start).toBeCloseTo(9.8, 9);
  });

  it("ends a stretch at a pause or a jump: what is long enough goes, and the next begins at the picture", () => {
    const { stamp, given } = stamper();
    stamp.block(block(), 10);
    for (let i = 1; i <= 20; i++) stamp.block(block(), 10 + i * 0.1);
    stamp.flush();
    expect(given).toHaveLength(1);
    expect(given[0]!.length).toBe(2000);
    expect(given[0]!.start).toBeCloseTo(10, 9);
    stamp.block(block(), 300);
    for (let i = 1; i <= 5; i++) stamp.block(block(), 300 + i * 0.1);
    stamp.flush();
    expect(given).toHaveLength(1);
    stamp.block(block(), 40);
    for (let i = 1; i <= 50; i++) stamp.block(block(), 40 + i * 0.1);
    expect(given[1]!.length).toBe(5000);
    expect(given[1]!.start).toBeCloseTo(40, 9);
  });

  it("begins again from the picture when the samples and the picture disagree (sound that was lost on the way)", () => {
    const { stamp, given } = stamper();
    stamp.block(block(), 10);
    for (let i = 1; i <= 20; i++) stamp.block(block(), 10 + i * 0.1);
    stamp.block(block(), 12.5);
    for (let i = 1; i <= 50; i++) stamp.block(block(), 12.5 + i * 0.1);
    expect(given[0]!.length).toBe(2000);
    expect(given[0]!.start).toBeCloseTo(10, 9);
    expect(given[1]!.start).toBeCloseTo(12.5, 9);
  });

  it("hands the aligner its samples back as they were", async () => {
    const pcm = new Float32Array([0.5, -0.25, 1, 0]);
    expect(Array.from(await livePcm(new Uint8Array(pcm.buffer)))).toEqual([0.5, -0.25, 1, 0]);
    const shifted = new Uint8Array(17);
    shifted.set(new Uint8Array(pcm.buffer), 1);
    expect(Array.from(await livePcm(shifted.subarray(1)))).toEqual([0.5, -0.25, 1, 0]);
  });
});
