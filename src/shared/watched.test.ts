import { describe, expect, it } from "vitest";
import type { NormalizedMedia } from "./media";
import { describeStatus, episodeStatus, parseWatched, recordWatching, serializeWatched, WATCHED_MAX, type WatchedEntry } from "./watched";

const episode = (n: number, title = "Show · S1 E" + n): NormalizedMedia => ({
  title,
  stream: { url: `https://cdn.example/${n}.m3u8`, type: "hls" },
  series: { season: 1, episode: n },
});
const movie: NormalizedMedia = { title: "A Movie", stream: { url: "https://cdn.example/m.mp4", type: "mp4" } };
const MIN = 60;

describe("recordWatching", () => {
  it("starts a record for the episode that is playing, under the show's name", () => {
    const list = recordWatching([], episode(2), { currentTime: 100, duration: 45 * MIN }, 1000);
    expect(list).toEqual([{ show: "Show", season: 1, episode: 2, position: 100, duration: 45 * MIN, done: false, at: 1000 }]);
  });

  it("ignores movies, and videos whose length isn't known yet", () => {
    expect(recordWatching([], movie, { currentTime: 100, duration: 3600 }, 1)).toEqual([]);
    expect(recordWatching([], episode(1), { currentTime: 0, duration: 0 }, 1)).toEqual([]);
  });

  it("hands back the very same list when only a few seconds passed, so nothing needs saving", () => {
    const list = recordWatching([], episode(1), { currentTime: 100, duration: 2700 }, 1);
    expect(recordWatching(list, episode(1), { currentTime: 103, duration: 2700 }, 2)).toBe(list);
    expect(recordWatching(list, episode(1), { currentTime: 110, duration: 2700 }, 2)[0]?.position).toBe(110);
  });

  it("calls an episode watched near its end, and keeps it watched when it is started again", () => {
    let list = recordWatching([], episode(1), { currentTime: 2700 - 30, duration: 2700 }, 1);
    expect(list[0]?.done).toBe(true);
    list = recordWatching(list, episode(1), { currentTime: 20, duration: 2700 }, 2);
    expect(list[0]).toMatchObject({ position: 20, done: true });
  });

  it("counts the last tenth of a short video as the end, not the whole of it", () => {
    expect(recordWatching([], episode(1), { currentTime: 0, duration: 30 }, 1)[0]?.done).toBe(false);
    expect(recordWatching([], episode(1), { currentTime: 28, duration: 30 }, 1)[0]?.done).toBe(true);
  });

  it("keeps the latest first, one record per episode, and never more than the limit", () => {
    let list: WatchedEntry[] = [];
    list = recordWatching(list, episode(1), { currentTime: 50, duration: 2700 }, 1);
    list = recordWatching(list, episode(2), { currentTime: 50, duration: 2700 }, 2);
    list = recordWatching(list, episode(1), { currentTime: 400, duration: 2700 }, 3);
    expect(list.map((entry) => entry.episode)).toEqual([1, 2]);

    const many = Array.from({ length: WATCHED_MAX }, (_, i) => ({ show: "S" + i, season: 1, episode: 1, position: 50, duration: 2700, done: false, at: i }));
    expect(recordWatching(many, episode(1), { currentTime: 50, duration: 2700 }, 9999)).toHaveLength(WATCHED_MAX);
  });
});

describe("episodeStatus", () => {
  const list: WatchedEntry[] = [
    { show: "Show", season: 1, episode: 1, position: 2690, duration: 2700, done: true, at: 1 },
    { show: "Show", season: 1, episode: 2, position: 900, duration: 2700, done: false, at: 2 },
    { show: "Show", season: 1, episode: 3, position: 5, duration: 2700, done: false, at: 3 },
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

describe("storage", () => {
  it("round-trips, and starts clean from anything that isn't a list of records", () => {
    const list = recordWatching([], episode(1), { currentTime: 100, duration: 2700 }, 1);
    expect(parseWatched(serializeWatched(list))).toEqual(list);
    expect(parseWatched(undefined)).toEqual([]);
    expect(parseWatched("not json")).toEqual([]);
    expect(parseWatched('[{"show":"x"}]')).toEqual([]);
  });
});
