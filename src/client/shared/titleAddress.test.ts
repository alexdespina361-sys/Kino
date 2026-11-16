import { describe, expect, it } from "vitest";
import { addressOf, dropLink, linkedTitle, pendingLink, titleAsk, titleIdOf, withTitle } from "./titleAddress";

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
    expect(titleAsk("?title=movie-603")).toEqual({ id: "filmpire-movie-603" });
    expect(titleAsk("?title=movie-0")).toEqual({ id: "filmpire-movie-0" }); // (well made: the server is asked, and finds nothing)
    for (const wrong of ["?title=", "?title=x", "?title=movie-603x"]) expect(titleAsk(wrong), wrong).toEqual({ id: null });
  });

  it("is read from the address once a page load, asked about once, and is there until it is dealt with: the library drawn again after a film does not open it again", async () => {
    const first = pendingLink("?title=x");
    expect(first?.id).toBeNull();
    expect(await first?.item).toBeNull(); // (one that names nothing is not asked about)
    const again = pendingLink("?title=movie-603"); // (a library drawn again before the answer came: the same link, the same answer)
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
});
