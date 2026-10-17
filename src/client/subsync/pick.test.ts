import { describe, expect, it } from "vitest";
import { heardRate, MIN_HEARD_RATE } from "./pick";
import type { Word } from "./signals";

const words = (count: number, probability?: number): Word[] =>
  Array.from({ length: count }, (_, i) => ({ word: `w${i}`, start: i, end: i + 0.3, ...(probability === undefined ? {} : { probability }) }));

describe("how much speech the recogniser heard (the rate that tells a dub from a sound it cannot read)", () => {
  it("is the sure words per second of the sound listened to", () => {
    expect(heardRate(words(30, 0.9), 60)).toBeCloseTo(0.5, 5);
    expect(heardRate(words(30, 0.9), 60)).toBeGreaterThan(MIN_HEARD_RATE);
  });

  it("does not count the words the recogniser was not sure of", () => {
    expect(heardRate([...words(10, 0.9), ...words(40, 0.3)], 60)).toBeCloseTo(10 / 60, 5);
    expect(heardRate(words(40, 0.3), 60)).toBe(0);
    // (Exactly as sure as the kit asks counts, and a word that has no probability is taken as sure.)
    expect(heardRate(words(6, 0.5), 60)).toBeCloseTo(0.1, 5);
    expect(heardRate(words(6), 60)).toBeCloseTo(0.1, 5);
  });

  it("says nothing of a stretch too short to tell a rate from", () => {
    expect(heardRate(words(20, 0.9), 9.9)).toBe(0);
    expect(heardRate(words(20, 0.9), 0)).toBe(0);
    expect(heardRate(words(20, 0.9), 10)).toBe(2);
  });

  it("is under the line for the sparse words a film that is not in English gives", () => {
    expect(heardRate(words(8, 0.9), 120)).toBeLessThan(MIN_HEARD_RATE);
  });
});
