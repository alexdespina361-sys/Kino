import { describe, expect, it } from "vitest";
import type { LiveProgress, LiveWatched } from "../../shared";
import type { Entry } from "../tv/pages";
import { ratedTitleOf, watchFacts } from "./ratings";

const entry = (extra: Partial<Entry> = {}): Entry => ({ id: "x", title: "Some Title", url: "https://x.example/watch/7", ...extra });
const card = (extra: Partial<LiveProgress> = {}): LiveProgress => ({ key: "k", at: 500, title: "Some Title", url: "https://x.example/watch/7", position: 3000, duration: 6000, ...extra });
const mark = (episode: number, extra: Partial<LiveWatched> = {}): LiveWatched => ({ key: `w${episode}`, at: 1000 + episode, show: "Some Title", season: 1, episode, position: 2700, duration: 2700, done: true, ...extra });

describe("ratedTitleOf", () => {
  it("files a title under what the page knows of it, and a show as a show whatever the entry says", () => {
    expect(ratedTitleOf(entry({ image: "p", backdrop: "b", year: 1999, kind: "movie" }))).toEqual({ title: "Some Title", url: "https://x.example/watch/7", image: "p", backdrop: "b", year: 1999, kind: "movie" });
    expect(ratedTitleOf(entry(), true).kind).toBe("series");
    expect(ratedTitleOf(entry()).kind).toBeUndefined();
  });
});

describe("watchFacts", () => {
  it("is how much of a film was watched and when, from the card it has", () => {
    expect(watchFacts(entry(), false, undefined, undefined, [card()], [])).toEqual({ watchedAt: 500, percent: 50 });
    expect(watchFacts(entry(), false, undefined, undefined, [card({ position: 5900 })], [])).toEqual({ watchedAt: 500, percent: 100 });
  });

  it("knows nothing of a film that was never played here, nor takes a show's card with the same link for the film's", () => {
    expect(watchFacts(entry(), false, undefined, undefined, [], [])).toEqual({});
    expect(watchFacts(entry(), false, undefined, undefined, [card({ season: 1, episode: 2 })], [])).toEqual({});
  });

  it("counts the episodes of a show watched to the end, filed under the name its card has, and of one season out of how many it has", () => {
    const watched = [mark(1), mark(2), mark(3, { done: false, position: 300 }), mark(1, { season: 2 })];
    const cards = [card({ season: 1, episode: 3, title: "Some Title" })];
    expect(watchFacts(entry(), true, undefined, undefined, cards, watched)).toEqual({ seen: 3, watchedAt: 1003 });
    expect(watchFacts(entry(), true, 1, 10, cards, watched)).toEqual({ seen: 2, of: 10, watchedAt: 1003 });
    expect(watchFacts(entry(), true, 2, 8, cards, watched)).toEqual({ seen: 1, of: 8, watchedAt: 1001 });
  });

  it("finds a show's episodes under the card's name when the page calls the show something else", () => {
    const cards = [card({ season: 1, episode: 1, title: "The Real Name" })];
    expect(watchFacts(entry({ title: "Shown As" }), true, 1, 4, cards, [mark(1, { show: "The Real Name" })])).toEqual({ seen: 1, of: 4, watchedAt: 1001 });
  });
});
