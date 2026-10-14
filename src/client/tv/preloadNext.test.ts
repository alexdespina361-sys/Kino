import { describe, expect, it } from "vitest";
import { PRELOAD_NEXT_WITHIN_S, nearTheEnd } from "./preloadNext";

describe("nearTheEnd", () => {
  const EPISODE = 45 * 60;

  it("is not yet true for most of an episode, which is when nobody has any use for the next one", () => {
    expect(nearTheEnd(0, EPISODE)).toBe(false);
    expect(nearTheEnd(20 * 60, EPISODE)).toBe(false);
    expect(nearTheEnd(EPISODE - PRELOAD_NEXT_WITHIN_S - 1, EPISODE)).toBe(false);
  });

  it("is true for the last two minutes, and stays true to the end", () => {
    expect(nearTheEnd(EPISODE - PRELOAD_NEXT_WITHIN_S, EPISODE)).toBe(true);
    expect(nearTheEnd(EPISODE - 15, EPISODE)).toBe(true);
    expect(nearTheEnd(EPISODE, EPISODE)).toBe(true);
  });

  it("is true from the start for a short picture, which is all end", () => {
    expect(nearTheEnd(0, 40)).toBe(true);
  });

  it("waits for a length that is known, and for a picture that is more than a clip", () => {
    expect(nearTheEnd(0, 0)).toBe(false);
    expect(nearTheEnd(5, 30)).toBe(false);
    expect(nearTheEnd(0, Number.NaN)).toBe(false);
  });
});
