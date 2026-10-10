import { describe, expect, it } from "vitest";
import { describeStatus, episodeStatus, type WatchedEntry } from "./watched";

describe("episodeStatus", () => {
  const list: WatchedEntry[] = [
    { show: "Show", season: 1, episode: 1, position: 2690, duration: 2700, done: true },
    { show: "Show", season: 1, episode: 2, position: 900, duration: 2700, done: false },
    { show: "Show", season: 1, episode: 3, position: 5, duration: 2700, done: false },
  ];

  it("tells watched, started (with how far and how long is left) and new apart", () => {
    expect(episodeStatus(list, "Show", 1, 1)).toEqual({ kind: "watched" });
    expect(episodeStatus(list, "Show", 1, 2)).toEqual({ kind: "started", fraction: 1 / 3, secondsLeft: 1800 });
    expect(episodeStatus(list, "Show", 1, 3)).toEqual({ kind: "new" }); // 5 seconds in isn't "started"
    expect(episodeStatus(list, "Show", 1, 4)).toEqual({ kind: "new" });
  });

  it("doesn't mix up shows, and knows nothing without one", () => {
    expect(episodeStatus(list, "Other", 1, 1)).toEqual({ kind: "new" });
    expect(episodeStatus(list, undefined, 1, 1)).toEqual({ kind: "new" });
  });

  it("describes what a list can show for it", () => {
    expect(describeStatus({ kind: "watched" })).toBe("Watched");
    expect(describeStatus({ kind: "started", fraction: 0.3, secondsLeft: 1800 })).toBe("30 min left");
    expect(describeStatus({ kind: "started", fraction: 0.99, secondsLeft: 20 })).toBe("1 min left");
    expect(describeStatus({ kind: "new" })).toBeUndefined();
  });
});
