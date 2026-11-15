import { describe, expect, it } from "vitest";
import { addressOf, linkedTitle, takeLinkedTitle, titleIdOf, withTitle } from "./titleAddress";

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

  it("is taken from the address once a page load: the library drawn again after a film does not open it again", () => {
    expect(takeLinkedTitle("?title=movie-603")).toBe("filmpire-movie-603");
    expect(takeLinkedTitle("?title=movie-603")).toBeNull();
    expect(takeLinkedTitle("?title=tv-1399")).toBeNull();
  });

  it("is put in the address and taken out again, with everything else in it left as it was", () => {
    expect(withTitle("https://kino.example/tv", "movie-603")).toBe("/tv?title=movie-603");
    expect(withTitle("https://kino.example/tv?title=movie-603", "tv-1399")).toBe("/tv?title=tv-1399");
    expect(withTitle("https://kino.example/tv?title=movie-603", null)).toBe("/tv");
    expect(withTitle("https://kino.example/?role=tv&title=movie-603#x", null)).toBe("/?role=tv#x");
  });
});
