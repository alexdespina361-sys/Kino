import { describe, expect, it } from "vitest";
import {
  HISTORY_MAX,
  parseHistory,
  progressFraction,
  recordPlay,
  recordProgress,
  removeEntry,
  resumePoint,
  serializeHistory,
  type HistoryEntry,
} from "./history";

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  url: "https://site.example/watch/1",
  title: "Movie",
  streamUrl: "https://cdn.example/1.m3u8",
  position: 0,
  duration: 0,
  at: 1,
  ...over,
});

describe("recordPlay", () => {
  it("puts the newest first and keeps the list short", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_MAX + 5; i++) {
      list = recordPlay(list, { url: `https://a.example/${i}`, title: `T${i}`, streamUrl: `s${i}`, now: i });
    }
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0]?.title).toBe(`T${HISTORY_MAX + 4}`);
  });

  it("replaying a link moves it to the top and keeps its progress and a fresh stream url", () => {
    const list = [entry({ url: "https://a.example/2", title: "Two" }), entry({ position: 300, duration: 6000 })];
    const next = recordPlay(list, { url: "https://site.example/watch/1", title: "Movie", streamUrl: "https://cdn.example/new.m3u8", now: 9 });
    expect(next.map((e) => e.title)).toEqual(["Movie", "Two"]);
    expect(next[0]).toMatchObject({ position: 300, duration: 6000, streamUrl: "https://cdn.example/new.m3u8", at: 9 });
  });

  it("keeps one entry per show: a new episode replaces the previous episode", () => {
    const e1 = { url: "https://s.example/w?e=1", title: "Show · S1 E1", streamUrl: "s1", seriesKey: "Show", now: 1 };
    const e2 = { url: "https://s.example/w?e=2", title: "Show · S1 E2", streamUrl: "s2", seriesKey: "Show", now: 2 };
    const other = { url: "https://o.example/m", title: "Other", streamUrl: "s3", now: 3 };
    let list = recordPlay([], e1);
    list = recordPlay(list, other);
    list = recordPlay(list, e2);
    expect(list.map((entry) => entry.title)).toEqual(["Show · S1 E2", "Other"]);
    // ...and episodes of a different show are left alone.
    list = recordPlay(list, { ...e1, url: "https://x.example/w", title: "Another Show · S1 E1", seriesKey: "Another Show", now: 4 });
    expect(list).toHaveLength(3);
  });

  it("falls back to the old title, then the url, when the page has no title", () => {
    expect(recordPlay([entry({ title: "Known" })], { url: entry().url, title: "", streamUrl: "s", now: 2 })[0]?.title).toBe("Known");
    expect(recordPlay([], { url: "https://a.example/x", title: "", streamUrl: "s", now: 2 })[0]?.title).toBe("https://a.example/x");
  });
});

describe("recordProgress", () => {
  it("finds the entry by the stream the TV is playing", () => {
    const next = recordProgress([entry()], { streamUrl: "https://cdn.example/1.m3u8", position: 125.4, duration: 5400, now: 5 });
    expect(next[0]).toMatchObject({ position: 125.4, duration: 5400, at: 5 });
  });

  it("returns the very same list for unknown streams, no duration, or no real change", () => {
    const list = [entry({ position: 100, duration: 5400 })];
    expect(recordProgress(list, { streamUrl: "other", position: 5, duration: 10, now: 2 })).toBe(list);
    expect(recordProgress(list, { streamUrl: list[0]!.streamUrl!, position: 5, duration: 0, now: 2 })).toBe(list);
    expect(recordProgress(list, { streamUrl: list[0]!.streamUrl!, position: 101, duration: 5400, now: 2 })).toBe(list);
  });

  it("never records a position beyond the end", () => {
    const next = recordProgress([entry()], { streamUrl: entry().streamUrl!, position: 9999, duration: 100, now: 2 });
    expect(next[0]?.position).toBe(100);
  });
});

describe("resumePoint and progressFraction", () => {
  it("resumes from the saved position once it is far enough in", () => {
    expect(resumePoint(entry({ position: 754.9, duration: 6000 }))).toBe(754);
    expect(progressFraction(entry({ position: 3000, duration: 6000 }))).toBe(0.5);
  });

  it("does not resume something barely started, finished, or unmeasured", () => {
    expect(resumePoint(entry({ position: 5, duration: 6000 }))).toBeUndefined();
    expect(resumePoint(entry({ position: 5950, duration: 6000 }))).toBeUndefined();
    expect(resumePoint(entry({ position: 100, duration: 0 }))).toBeUndefined();
    expect(progressFraction(entry({ position: 5950, duration: 6000 }))).toBe(0);
  });
});

describe("storage format", () => {
  it("round-trips", () => {
    const list = [entry({ position: 20, duration: 100 })];
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });

  it("shrugs off missing, corrupt, or foreign data", () => {
    expect(parseHistory(undefined)).toEqual([]);
    expect(parseHistory("{nope")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('[{"url":1}]')).toEqual([]);
  });

  it("removeEntry drops just that link", () => {
    const list = [entry(), entry({ url: "https://a.example/2" })];
    expect(removeEntry(list, entry().url).map((e) => e.url)).toEqual(["https://a.example/2"]);
  });
});
