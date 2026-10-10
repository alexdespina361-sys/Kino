import { describe, expect, it } from "vitest";
import type { LiveProgress, LiveWatched } from "./account";
import type { NormalizedMedia } from "./media";
import { fractionOf, progressFor, progressKeyOf, resumeAt, watchedFor } from "./progress";

const MIN = 60;
const stream = { url: "https://cdn.example/x.m3u8", type: "hls" as const };
const movie: NormalizedMedia = { title: "A Movie", stream, page: "https://site.example/watch/9#top", poster: "/p.jpg", year: 1999 };
const episode = (n: number, next?: number): NormalizedMedia => ({
  title: `Show · S1 E${n}`,
  stream,
  page: `https://site.example/show?e=${n}`,
  series: { season: 1, episode: n, ...(next ? { next: { season: 1, episode: next, url: `https://site.example/show?e=${next}` } } : {}) },
});

describe("progressFor", () => {
  it("makes a card for a film that has just started, under the link that plays it again", () => {
    expect(progressFor(movie, 100)).toEqual({
      key: "url:https://site.example/watch/9",
      at: 100,
      title: "A Movie",
      url: "https://site.example/watch/9#top",
      image: "/p.jpg",
      year: 1999,
      position: 0,
      duration: 0,
    });
  });

  it("makes nothing for media that does not say where it came from", () => {
    expect(progressFor({ ...movie, page: undefined }, 1)).toBeUndefined();
    expect(progressKeyOf({ ...movie, page: undefined })).toBeUndefined();
  });

  it("makes one card for a whole show, under its name, remembering which episode", () => {
    const card = progressFor(episode(3), 5, { currentTime: 600, duration: 45 * MIN })!;
    expect(card).toMatchObject({ key: "show:Show", title: "Show", season: 1, episode: 3, position: 600, duration: 45 * MIN, url: "https://site.example/show?e=3" });
    expect(progressKeyOf(episode(1))).toBe(progressKeyOf(episode(7)));
  });

  it("hands back the very same card when only a few seconds passed, so nothing needs saving or sending", () => {
    const first = progressFor(movie, 1, { currentTime: 100, duration: 7200 })!;
    expect(progressFor(movie, 2, { currentTime: 103, duration: 7200 }, first)).toBe(first);
    expect(progressFor(movie, 3, { currentTime: 110, duration: 7200 }, first)).toMatchObject({ position: 110, at: 3 });
  });

  it("keeps its place when the same unfinished film is started again, and starts a finished one over", () => {
    const left = progressFor(movie, 1, { currentTime: 1800, duration: 7200 })!;
    expect(progressFor(movie, 9, undefined, left)).toMatchObject({ position: 1800, duration: 7200, at: 9 });
    const finished = progressFor(movie, 2, { currentTime: 7190, duration: 7200 })!;
    expect(finished.done).toBe(true);
    expect(progressFor(movie, 10, undefined, finished)).toMatchObject({ position: 0, duration: 0 });
  });

  it("points the end of an episode at the next one, and ends the card of a film", () => {
    const up = progressFor(episode(1, 2), 7, { currentTime: 45 * MIN - 20, duration: 45 * MIN })!;
    expect(up).toMatchObject({ key: "show:Show", episode: 2, url: "https://site.example/show?e=2", position: 0, duration: 0 });
    expect(up.done).toBeUndefined();
    // the credits rolling on do not change it
    expect(progressFor(episode(1, 2), 8, { currentTime: 45 * MIN - 5, duration: 45 * MIN }, up)).toBe(up);

    const last = progressFor(episode(8), 9, { currentTime: 45 * MIN - 20, duration: 45 * MIN })!;
    expect(last).toMatchObject({ done: true, episode: 8 });
    expect(progressFor(movie, 9, { currentTime: 7150, duration: 7200 })).toMatchObject({ done: true });
  });

  it("carries on seamlessly into the next episode after the card pointed at it", () => {
    const up = progressFor(episode(1, 2), 7, { currentTime: 45 * MIN - 20, duration: 45 * MIN })!;
    const started = progressFor(episode(2, 3), 8, undefined, up)!;
    expect(started).toMatchObject({ episode: 2, position: 0, url: "https://site.example/show?e=2" });
  });

  it("keeps the picture it had when a later play brings none", () => {
    const before = progressFor(movie, 1, { currentTime: 100, duration: 7200 })!;
    const now = progressFor({ ...movie, poster: undefined, year: undefined }, 5, { currentTime: 400, duration: 7200 }, before)!;
    expect(now).toMatchObject({ image: "/p.jpg", year: 1999, position: 400 });
  });
});

describe("resumeAt and fractionOf", () => {
  const card = (over: Partial<LiveProgress>): LiveProgress => ({ key: "k", at: 1, title: "T", url: "/u", position: 0, duration: 0, ...over });

  it("resumes between 'not started' and 'finished'", () => {
    expect(resumeAt(card({ position: 5, duration: 3600 }))).toBeUndefined();
    expect(resumeAt(card({ position: 754.6, duration: 3600 }))).toBe(754);
    expect(resumeAt(card({ position: 3590, duration: 3600 }))).toBeUndefined();
    expect(resumeAt(card({ position: 700, duration: 3600, done: true }))).toBeUndefined();
    expect(resumeAt(card({ position: 700, duration: 0 }))).toBeUndefined();
  });

  it("measures the bar only where there is something to resume", () => {
    expect(fractionOf(card({ position: 900, duration: 3600 }))).toBe(0.25);
    expect(fractionOf(card({ position: 5, duration: 3600 }))).toBe(0);
  });
});

describe("watchedFor", () => {
  it("marks the episode that is playing, under the show's name", () => {
    expect(watchedFor(episode(2), { currentTime: 100, duration: 45 * MIN }, 1000)).toEqual({
      key: "Show|1x2",
      at: 1000,
      show: "Show",
      season: 1,
      episode: 2,
      position: 100,
      duration: 45 * MIN,
      done: false,
    });
  });

  it("ignores films, and videos whose length is not known yet", () => {
    expect(watchedFor(movie, { currentTime: 100, duration: 3600 }, 1)).toBeUndefined();
    expect(watchedFor(episode(1), { currentTime: 0, duration: 0 }, 1)).toBeUndefined();
  });

  it("hands back the same mark when only a few seconds passed", () => {
    const mark = watchedFor(episode(1), { currentTime: 100, duration: 2700 }, 1)!;
    expect(watchedFor(episode(1), { currentTime: 103, duration: 2700 }, 2, mark)).toBe(mark);
    expect(watchedFor(episode(1), { currentTime: 110, duration: 2700 }, 2, mark)?.position).toBe(110);
  });

  it("calls an episode watched near its end, and keeps it watched when it is started again", () => {
    const seen = watchedFor(episode(1), { currentTime: 2700 - 30, duration: 2700 }, 1)!;
    expect(seen.done).toBe(true);
    const again: LiveWatched | undefined = watchedFor(episode(1), { currentTime: 20, duration: 2700 }, 2, seen);
    expect(again).toMatchObject({ position: 20, done: true });
  });

  it("counts the last tenth of a short video as the end, not the whole of it", () => {
    expect(watchedFor(episode(1), { currentTime: 0, duration: 30 }, 1)?.done).toBe(false);
    expect(watchedFor(episode(1), { currentTime: 28, duration: 30 }, 1)?.done).toBe(true);
  });
});
