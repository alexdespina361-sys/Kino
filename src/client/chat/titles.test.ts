import { describe, expect, it } from "vitest";
import { checkChatText } from "../../shared";
import { chosenExtras, messageOf, movedTime, onlyNames, sendableTitles, titleIn, titleLabel, titleMessage, typedTime } from "./titles";

describe("a title in a chat message", () => {
  it("is found by the title its address names, whichever of the site's addresses it is", () => {
    expect(titleIn("https://kino4tv.com/tv?title=movie-603")).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "", extras: {} });
    expect(titleIn("look https://kino.24-7.ro/?title=tv-1399 tonight?")).toEqual({ id: "filmpire-tv-1399", link: "https://kino.24-7.ro/?title=tv-1399", rest: "look tonight?", extras: {} });
    expect(titleIn("http://localhost:8885/tv?x=1&title=movie-7#a")?.id).toBe("filmpire-movie-7");
  });

  it("leaves the end of a sentence out of the address", () => {
    expect(titleIn("Watch this: https://kino4tv.com/tv?title=movie-603!")).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "Watch this:", extras: {} });
    expect(titleIn("(https://kino4tv.com/tv?title=movie-603).")).toMatchObject({ id: "filmpire-movie-603", rest: "" });
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
    expect(kept).toEqual({ ok: true, text });
    expect(titleIn(text)).toEqual({ id: "filmpire-movie-603", link: "https://kino4tv.com/tv?title=movie-603", rest: "The Matrix (1999)", extras: {} });
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
      { id: "filmpire-movie-603", at: 70, title: "The Matrix", url: "https://films.example/watch/603", year: 1999 },
      { id: "filmpire-tv-1399", at: 10, title: "A Show", url: "https://films.example/watch/1399" },
      { id: "filmpire-movie-7", at: 40, title: "Seven", url: "/x" },
    ];
    expect(sendableTitles(progress, saved)).toEqual([
      { address: "movie-603", title: "The Matrix", url: "https://films.example/watch/603", year: 1999 },
      { address: "tv-1399", title: "A Show", url: "https://films.example/watch/1399?s=2&e=3", image: "https://image.example/s.jpg" },
      { address: "movie-7", title: "Seven", url: "/x" },
    ]);
    expect(sendableTitles(progress, saved, 2).map((title) => title.address)).toEqual(["movie-603", "tv-1399"]);
    expect(messageOf({ address: "tv-1399", title: "A Show" }, "https://kino.24-7.ro")).toBe("A Show https://kino.24-7.ro/tv?title=tv-1399");
  });

  it("sends an episode, a time and a rating in the address, the words as they were: kept as they are, and read back", () => {
    const text = messageOf({ address: "tv-1399", title: "A Show", year: 2011 }, "https://kino4tv.com", { season: 2, episode: 5, at: 754, score: 8 });
    expect(text).toBe("A Show (2011) https://kino4tv.com/tv?title=tv-1399&s=2&e=5&t=754&r=8");
    expect(checkChatText(text)).toEqual({ ok: true, text });
    expect(titleIn(text)).toEqual({ id: "filmpire-tv-1399", link: "https://kino4tv.com/tv?title=tv-1399&s=2&e=5&t=754&r=8", rest: "A Show (2011)", extras: { season: 2, episode: 5, at: 754, score: 8 } });
    expect(onlyNames(titleIn(text)!.rest, { title: "A Show", year: 2011 })).toBe(true);
    expect(titleIn("https://kino4tv.com/tv?title=movie-603&t=95&r=10!")?.extras).toEqual({ at: 95, score: 10 });
    expect(titleIn("https://kino4tv.com/tv?title=movie-603&t=-1&r=99&s=1&e=1")?.extras).toEqual({});
  });

  it("sends only what the send step chose: an episode of a show, a time in a film or an episode, a rating given", () => {
    const episode = { season: 2, episode: 5 };
    expect(chosenExtras({ show: false, episode: null, at: 0, score: undefined })).toEqual({});
    expect(chosenExtras({ show: true, episode, at: 754.6, score: 8 })).toEqual({ season: 2, episode: 5, at: 754, score: 8 });
    expect(chosenExtras({ show: true, episode: null, at: 754, score: undefined })).toEqual({});
    expect(chosenExtras({ show: false, episode, at: 90, score: undefined })).toEqual({ at: 90 });
    expect(chosenExtras({ show: false, episode: null, at: 90_000, score: 3 })).toEqual({ score: 3 });
  });

  it("reads a time typed by hand, and moves one by minutes between the beginning and the end", () => {
    expect(typedTime("1:02:10")).toBe(3730);
    expect(typedTime("12:34")).toBe(754);
    expect(typedTime(" 45 ")).toBe(2700);
    expect(typedTime("0")).toBe(0);
    expect(typedTime("0:00")).toBe(0);
    for (const odd of ["", "abc", "1:60", "1:02:60", "1:2", "-5", "1.5", "12:34:56:7", "99999"]) expect(typedTime(odd), odd).toBeUndefined();
    expect(typedTime("2:00:00", 3600)).toBeUndefined();
    expect(typedTime("24:00:00")).toBe(86_400);
    expect(typedTime("24:00:01")).toBeUndefined();
    expect(movedTime(0, -10, 3600)).toBe(0);
    expect(movedTime(300, 10, 3600)).toBe(900);
    expect(movedTime(3500, 10, 3600)).toBe(3600);
  });

  it("does not say the name twice: words that only name the title are left to the card", () => {
    const title = { title: "The Matrix", year: 1999 };
    expect(titleLabel(title)).toBe("The Matrix (1999)");
    for (const rest of ["", "The Matrix (1999)", "the matrix", "THE MATRIX (1999)"]) expect(onlyNames(rest, title), rest).toBe(true);
    for (const rest of ["Watch this", "The Matrix tonight?"]) expect(onlyNames(rest, title), rest).toBe(false);
  });
});
