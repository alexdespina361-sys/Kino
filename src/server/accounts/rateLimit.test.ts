import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit";

describe("taking back an attempt", () => {
  it("is taking back the one counted last for the key, and no other: the others stay, and so do the other keys", () => {
    const clock = { now: 0 };
    const limiter = new RateLimiter(2, 1000, () => clock.now);
    limiter.hit("a");
    clock.now = 500;
    limiter.hit("a");
    limiter.hit("b");
    expect(limiter.wait("a")).toBeGreaterThan(0);

    limiter.undo("a");
    expect(limiter.wait("a")).toBe(0);
    // (The one at 500 went, not the first: when the first is out of the window nothing is left to count.)
    clock.now = 1001;
    limiter.hit("a");
    expect(limiter.wait("a")).toBe(0);
    expect(limiter.wait("b")).toBe(0);
    limiter.hit("a");
    expect(limiter.wait("a")).toBeGreaterThan(0);
  });

  it("is nothing for a key that has nothing counted, or whose attempts are out of the window", () => {
    const clock = { now: 0 };
    const limiter = new RateLimiter(1, 1000, () => clock.now);
    limiter.undo("nobody");
    limiter.hit("a");
    clock.now = 2000;
    limiter.undo("a");
    limiter.hit("a");
    expect(limiter.wait("a")).toBeGreaterThan(0);
  });
});
