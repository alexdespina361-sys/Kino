import { describe, expect, it } from "vitest";
import { addressOf, asksAnything, dropLink, extrasOf, extrasQuery, linkedTitle, pendingLink, titleAsk, titleIdOf, withTitle } from "./titleAddress";

describe("a title's own address", () => {
  it("names a tile of the library by its id, short", () => {
    expect(addressOf({ id: "filmpire-movie-603", url: "https://x.example/watch/603" })).toBe("movie-603");
    expect(addressOf({ id: "filmpire-tv-1399", url: "https://x.example/watch/1399?s=1&e=1" })).toBe("tv-1399");
  });

  it("names a card with a key of its own from the link it plays: a show by its season and episode, or by its kind", () => {
    expect(addressOf({ id: "progress:abc", url: "https://x.example/watch/1399?s=2&e=5" })).toBe("tv-1399");
    expect(addressOf({ id: "list:abc", url: "https://x.example/watch/1399", kind: "series" })).toBe("tv-1399");
    expect(addressOf({ id: "rate:abc", url: "https://x.example/watch/603" })).toBe("movie-603");
  });

  it("names nothing else: a pasted link, a category, a file of this server", () => {
    expect(addressOf({ id: "pasted", url: "https://y.example/some/page" })).toBeNull();
    expect(addressOf({ id: "category:7", url: "" })).toBeNull();
    expect(addressOf({ id: "fixture", url: "/fixtures/sample.mp4" })).toBeNull();
    expect(addressOf({ id: "archive-movie-603", url: "https://archive.example/details/x" })).toBeNull();
  });

  it("is read back as the library's id, and anything else in that place is nothing", () => {
    expect(titleIdOf("movie-603")).toBe("filmpire-movie-603");
    expect(titleIdOf("tv-1399")).toBe("filmpire-tv-1399");
    for (const wrong of ["", "movie-", "film-603", "movie-603x", "movie-603&x", "tv-12345678901", null, undefined]) expect(titleIdOf(wrong), String(wrong)).toBeNull();
    expect(linkedTitle("?title=movie-603")).toBe("filmpire-movie-603");
    expect(linkedTitle("?party=123456")).toBeNull();
  });

  it("says what a link asks for: nothing, a title, or a title that is none (the library says so: the judge, 16 Nov)", () => {
    expect(titleAsk("")).toBeNull();
    expect(titleAsk("?party=123456")).toBeNull();
    expect(titleAsk("?title=movie-603")).toEqual({ id: "filmpire-movie-603", extras: {} });
    expect(titleAsk("?title=movie-0")).toEqual({ id: "filmpire-movie-0", extras: {} });
    for (const wrong of ["?title=", "?title=x", "?title=movie-603x"]) expect(titleAsk(wrong), wrong).toEqual({ id: null, extras: {} });
  });

  it("says which episode and from when a link asks for, but never a rating (a link opened from elsewhere has nobody to say it)", () => {
    expect(titleAsk("?title=tv-1399&s=2&e=5&t=754&r=8")).toEqual({ id: "filmpire-tv-1399", extras: { season: 2, episode: 5, at: 754 } });
    expect(titleAsk("?title=movie-603&t=3600")).toEqual({ id: "filmpire-movie-603", extras: { at: 3600 } });
  });
});

describe("what an address asks for besides the title", () => {
  const of = (query: string, address: string) => extrasOf(new URLSearchParams(query), address);

  it("is an episode of a show, a time, and a rating", () => {
    expect(of("s=2&e=5&t=754&r=8", "tv-1399")).toEqual({ season: 2, episode: 5, at: 754, score: 8 });
    expect(of("t=90&r=10", "movie-603")).toEqual({ at: 90, score: 10 });
    expect(of("", "movie-603")).toEqual({});
  });

  it("is never an episode of a film, nor a time in a whole show (it would be in nothing): an episode is its season and its number, both", () => {
    expect(of("s=2&e=5&t=754", "movie-603")).toEqual({ at: 754 });
    expect(of("t=754", "tv-1399")).toEqual({});
    expect(of("s=2&t=754", "tv-1399")).toEqual({});
    expect(of("e=5&t=754&r=7", "tv-1399")).toEqual({ score: 7 });
  });

  it("is nothing that is odd (they can be typed by hand): not whole, out of bounds, signed, twice as long", () => {
    for (const odd of ["0", "86401", "-5", "1.5", "1e3", "abc", "%209", "0x10", "1234567", ""]) expect(of(`t=${odd}`, "movie-603"), `t=${odd}`).toEqual({});
    for (const odd of ["0", "11", "-1", "7.5"]) expect(of(`r=${odd}`, "movie-603"), `r=${odd}`).toEqual({});
    for (const odd of ["s=0&e=1", "s=201&e=1", "s=1&e=0", "s=1&e=5001", "s=1&e=x"]) expect(of(odd, "tv-1399"), odd).toEqual({});
    expect(of("t=86400", "movie-603")).toEqual({ at: 86_400 });
    expect(of("s=2&e=5&t=754&r=8", "x")).toEqual({ at: 754, score: 8 });
  });

  it("is written after the title's address, only what there is, and read back the same", () => {
    expect(extrasQuery({ season: 2, episode: 5, at: 754, score: 8 })).toBe("&s=2&e=5&t=754&r=8");
    expect(extrasQuery({ at: 90 })).toBe("&t=90");
    expect(extrasQuery({})).toBe("");
    const extras = { season: 3, episode: 12, at: 61, score: 6 };
    expect(of(extrasQuery(extras).slice(1), "tv-1399")).toEqual(extras);
    expect(asksAnything({})).toBe(false);
    expect(asksAnything(undefined)).toBe(false);
    expect(asksAnything({ score: 4 })).toBe(true);
  });

  it("is read from the address once a page load, asked about once, and is there until it is dealt with: the library drawn again after a film does not open it again", async () => {
    const first = pendingLink("?title=x");
    expect(first?.id).toBeNull();
    expect(await first?.item).toBeNull();
    const again = pendingLink("?title=movie-603");
    expect(again?.id).toBeNull();
    expect(again?.item).toBe(first?.item);
    dropLink();
    expect(pendingLink("?title=x")).toBeNull();
    expect(pendingLink("?title=tv-1399")).toBeNull();
  });

  it("is put in the address and taken out again, with everything else in it left as it was", () => {
    expect(withTitle("https://kino.example/tv", "movie-603")).toBe("/tv?title=movie-603");
    expect(withTitle("https://kino.example/tv?title=movie-603", "tv-1399")).toBe("/tv?title=tv-1399");
    expect(withTitle("https://kino.example/tv?title=movie-603", null)).toBe("/tv");
    expect(withTitle("https://kino.example/?role=tv&title=movie-603#x", null)).toBe("/?role=tv#x");
  });

  it("goes without the episode, the time and the rating a link asked for: they were of the title it named, not of the next", () => {
    expect(withTitle("https://kino.example/tv?title=tv-1399&s=2&e=5&t=754&r=8", "movie-603")).toBe("/tv?title=movie-603");
    expect(withTitle("https://kino.example/tv?title=tv-1399&s=2&e=5&t=754", null)).toBe("/tv");
  });
});
