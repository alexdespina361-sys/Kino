import { describe, expect, it } from "vitest";
import type { LibraryItem, LiveListItem, LiveProgress, LiveRating } from "../../shared";
import { askedSeeds, becauseRows, MAX_BECAUSE, seedsOf } from "./recommend";
import { DISLIKED_TO, isSeen, knownOf, LOVED_FROM, MAX_ASKS, picksOf, savedSeeds, seenKeys, UNSEEN_MIN, withoutSeen, type Seed } from "./taste";

const card = (name: string, extra: Partial<LiveProgress> = {}): LiveProgress => ({ key: `url:https://x.example/${name}`, at: 1, title: `Card ${name}`, url: `https://x.example/${name}`, position: 100, duration: 6000, ...extra });
const rated = (name: string, score: number, ratedAt = 1, extra: Partial<LiveRating> = {}): LiveRating => ({ key: `rate:${name}`, at: ratedAt, title: `Rated ${name}`, url: `https://x.example/${name}`, score, ratedAt, ...extra });
const saved = (name: string, at = 1): LiveListItem => ({ key: `url:${name}`, at, id: name, title: `Saved ${name}`, url: `https://x.example/${name}` });
const item = (id: string, title = `Title ${id}`): LibraryItem => ({ id, title, url: `https://x.example/${id}` });
const seed = (name: string, why: Seed["why"] = "watched"): Seed => ({ key: `https://x.example/${name}`, title: `Seed ${name}`, url: `https://x.example/${name}`, why });
const answers = (all: Record<string, LibraryItem[]>) => (key: string) => all[key.replace("https://x.example/", "")];
const NOTHING = knownOf([], []);

describe("what a profile has seen", () => {
  it("is what it played to the end and what it scored, every episode of a show as the show; not what it is part way through", () => {
    const seen = seenKeys([card("done", { done: true }), card("going"), card("show", { url: "https://x.example/show?s=3&e=9", done: true })], [rated("scored", 3)]);
    expect(isSeen(item("done"), seen)).toBe(true);
    expect(isSeen(item("scored"), seen)).toBe(true);
    expect(isSeen({ url: "https://x.example/show?s=1&e=1" }, seen)).toBe(true);
    expect(isSeen(item("going"), seen)).toBe(false);
    expect(isSeen(item("other"), seen)).toBe(false);
  });

  it("is left out of a row while enough is left; a row that would be short is as it was, and so is one with nothing seen in it", () => {
    const row = Array.from({ length: UNSEEN_MIN + 2 }, (_, at) => item(`t${at}`));
    const seen = seenKeys([card("t1", { done: true })], [rated("t4", 9)]);
    expect(withoutSeen(row, seen).map((each) => each.id)).toEqual(["t0", "t2", "t3", "t5", "t6", "t7"]);
    // One more seen: five would be left, which is no row.
    const more = seenKeys([card("t1", { done: true }), card("t2", { done: true })], [rated("t4", 9)]);
    expect(withoutSeen(row, more)).toBe(row);
    expect(withoutSeen(row, seenKeys([card("elsewhere", { done: true })], []))).toBe(row);
    expect(withoutSeen(row, new Set())).toBe(row);
  });
});

describe("the titles a page asks about", () => {
  it("does not ask for more like a title that was watched and scored low", () => {
    const seeds = seedsOf([card("bad"), card("fine")], [rated("bad", DISLIKED_TO), rated("season", 1, 1, { url: "https://x.example/fine", season: 2 })]);
    expect(seeds.map((each) => each.title)).toEqual(["Card fine"]); // (a low score for one season says nothing of the show)
  });

  it("has the titles that get a row of their own first, then in turn one that was saved and the next that was watched, each once", () => {
    const progress = ["a", "b", "c", "d", "e"].map((name) => card(name));
    const list = [saved("old", 1), saved("new", 9), saved("b", 5), saved("hated", 7)];
    const seeds = askedSeeds(progress, [rated("hated", 2)], list);
    expect(seeds.map((each) => [each.title, each.why])).toEqual([
      ["Card a", "watched"],
      ["Card b", "watched"],
      ["Card c", "watched"],
      ["Saved new", "saved"], // (the newest saved; not "b", which is asked about already, nor the one scored low since)
      ["Card d", "watched"],
      ["Saved old", "saved"],
    ]);
    expect(seeds).toHaveLength(MAX_ASKS);
    expect(askedSeeds([], [], [])).toEqual([]);
    expect(savedSeeds(list, [], new Set()).map((each) => each.title)).toEqual(["Saved new", "Saved hated", "Saved b", "Saved old"]);
  });

  it("gives a saved title no row of its own, and no more rows than there are for", () => {
    const seeds = [seed("s", "saved"), seed("a"), seed("b"), seed("c"), seed("d")];
    const many = (prefix: string) => Array.from({ length: 5 }, (_, at) => item(`${prefix}${at}`));
    const rows = becauseRows(seeds, answers({ s: many("s"), a: many("a"), b: many("b"), c: many("c"), d: many("d") }), [], []);
    expect(rows.map((each) => each.title)).toEqual(["Seed a", "Seed b", "Seed c"]);
    expect(rows).toHaveLength(MAX_BECAUSE);
  });

  it("leaves a title the profile scored out of the rows of titles like another", () => {
    const rows = becauseRows([seed("a")], answers({ a: [item("x"), item("y")] }), [], [], [rated("x", 9)]);
    expect(rows[0]!.items.map((each) => each.id)).toEqual(["y"]);
  });
});

describe("what a profile might like", () => {
  it("is the titles like several of what it watched, loved or saved first, then the ones the library put nearer the front", () => {
    const seeds = [seed("a"), seed("b", "loved"), seed("c", "saved")];
    const picks = picksOf(seeds, answers({ a: [item("one"), item("both"), item("last")], b: [item("loved"), item("both")], c: [item("both"), item("saved")] }), NOTHING);
    // "both" came of all three; "loved" of one that was loved (worth more than one watched or saved); then the fronts of the answers, then what was further back
    expect(picks.map((each) => each.id)).toEqual(["both", "loved", "one", "saved", "last"]);
  });

  it("never has what the profile started, finished, saved or scored, nor the titles it asked about, nor what the rows over it show", () => {
    const known = knownOf([card("going"), card("done", { done: true })], [saved("kept")], [rated("scored", 2)]);
    const list = [item("going"), item("done"), item("kept"), item("scored"), item("a"), item("named", "seed b"), item("shown"), item("fresh"), item("fresh")];
    const picks = picksOf([seed("a"), seed("b")], answers({ a: list, b: [item("fresh")] }), known, new Set(["shown"]));
    expect(picks.map((each) => each.id)).toEqual(["fresh"]);
    // (a title known by its name, under another link)
    expect(picksOf([seed("a")], answers({ a: [item("elsewhere", "Card Going")] }), known)).toEqual([]);
  });

  it("is nothing while no answer has come, and no longer than a row", () => {
    expect(picksOf([seed("a")], () => undefined, NOTHING)).toEqual([]);
    const long = Array.from({ length: 80 }, (_, at) => item(`t${at}`));
    expect(picksOf([seed("a")], answers({ a: long }), NOTHING, new Set(), 30)).toHaveLength(30);
    expect(LOVED_FROM).toBeGreaterThan(DISLIKED_TO);
  });
});
