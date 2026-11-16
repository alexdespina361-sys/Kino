import { describe, expect, it } from "vitest";
import { checkChatText } from "../../shared";
import { messageOf, onlyNames, sendableTitles, titleIn, titleLabel, titleMessage } from "./titles";

describe("a title in a chat message", () => {
  it("is found by the title its address names, whichever of the site's addresses it is", () => {
    expect(titleIn("https://kino4tv.com/tv?title=movie-603")).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "" });
    expect(titleIn("look https://kino.24-7.ro/?title=tv-1399 tonight?")).toEqual({ id: "filmpire-tv-1399", link: "https://kino.24-7.ro/?title=tv-1399", rest: "look tonight?" });
    expect(titleIn("http://localhost:8885/tv?x=1&title=movie-7#a")?.id).toBe("filmpire-movie-7");
  });

  it("leaves the end of a sentence out of the address", () => {
    expect(titleIn("Watch this: https://kino4tv.com/tv?title=movie-603!")).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "Watch this:" });
    expect(titleIn("(https://kino4tv.com/tv?title=movie-603).")).toMatchObject({ id: "filmpire-movie-603", rest: "" }); // (no "(" left over the card: the judge, 16 Nov)
    expect(titleIn("Tonight (https://kino4tv.com/tv?title=movie-603)")).toMatchObject({ rest: "Tonight" });
  });

  it("is nothing for an address that names no title, or text that only looks like one", () => {
    for (const text of [
      "hello",
      "https://kino4tv.com/tv",
      "https://kino4tv.com/tv?title=x",
      "https://kino4tv.com/tv?title=../../etc",
      "https://kino4tv.com/tv?title=movie-603x",
      "kino4tv.com/tv?title=movie-603",
      "javascript:alert(1)//?title=movie-603",
      "ftp://kino4tv.com/?title=movie-603",
    ])
      expect(titleIn(text), text).toBeNull();
  });

  it("takes the first address that names a title", () => {
    expect(titleIn("https://example.com/a https://kino4tv.com/tv?title=movie-1 https://kino4tv.com/tv?title=movie-2")).toMatchObject({ id: "filmpire-movie-1", rest: "https://example.com/a https://kino4tv.com/tv?title=movie-2" });
  });
});

describe("sending a title", () => {
  it("writes its name and its address on this site, which the chat keeps as it is", () => {
    const text = titleMessage({ id: "filmpire-movie-603", title: "The Matrix", year: 1999, url: "/fixtures/a.mp4" }, "https://kino4tv.com")!;
    expect(text).toBe("The Matrix (1999) https://kino4tv.com/tv?title=movie-603");
    const kept = checkChatText(text);
    expect(kept).toEqual({ ok: true, text }); // (the server keeps it as it is: the address still names the title)
    expect(titleIn(text)).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "The Matrix (1999)" });
  });

  it("names a show by the link it plays, and has nothing for a link pasted on the phone", () => {
    expect(titleMessage({ id: "saved-1", title: "A Show", url: "https://films.example/watch/1399?s=1&e=2", kind: "series" }, "https://kino4tv.com")).toBe("A Show https://kino4tv.com/tv?title=tv-1399");
    expect(titleMessage({ id: "pasted", title: "Something", url: "https://example.com/film.mp4" }, "https://kino4tv.com")).toBeNull();
  });

  it("offers what was watched and saved, the newest first, each title once, and nothing without an address on the site", () => {
    const progress = [
      { key: "p-show", at: 50, title: "A Show", url: "https://films.example/watch/1399?s=2&e=3", season: 2, image: "https://image.example/s.jpg" },
      { key: "p-film", at: 30, title: "The Matrix", url: "https://films.example/watch/603", year: 1999 },
      { key: "p-pasted", at: 90, title: "Pasted", url: "https://example.com/film.mp4" },
    ];
    const saved = [
      { id: "filmpire-movie-603", at: 70, title: "The Matrix", url: "https://films.example/watch/603", year: 1999 }, // (watched and saved: once, by the newer)
      { id: "filmpire-tv-1399", at: 10, title: "A Show", url: "https://films.example/watch/1399" }, // (a show watched is the same title saved)
      { id: "filmpire-movie-7", at: 40, title: "Seven", url: "/x" },
    ];
    expect(sendableTitles(progress, saved)).toEqual([
      { address: "movie-603", title: "The Matrix", year: 1999 },
      { address: "tv-1399", title: "A Show", image: "https://image.example/s.jpg" },
      { address: "movie-7", title: "Seven" },
    ]);
    expect(sendableTitles(progress, saved, 2).map((title) => title.address)).toEqual(["movie-603", "tv-1399"]);
    expect(messageOf({ address: "tv-1399", title: "A Show" }, "https://kino.24-7.ro")).toBe("A Show https://kino.24-7.ro/tv?title=tv-1399");
  });

  it("does not say the name twice: words that only name the title are left to the card", () => {
    const title = { title: "The Matrix", year: 1999 };
    expect(titleLabel(title)).toBe("The Matrix (1999)");
    for (const rest of ["", "The Matrix (1999)", "the matrix", "THE MATRIX (1999)"]) expect(onlyNames(rest, title), rest).toBe(true);
    for (const rest of ["Watch this", "The Matrix tonight?"]) expect(onlyNames(rest, title), rest).toBe(false);
  });
});
