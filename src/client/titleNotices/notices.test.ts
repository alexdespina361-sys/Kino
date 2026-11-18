import { describe, expect, it } from "vitest";
import { TitleNoticesSchema, type TitleNotice } from "../../shared";
import { entryOfNotice, noticeLine } from "./notices";

const notice = (more: Partial<TitleNotice>): TitleNotice => ({ id: "tv-7", at: 1, what: "episode", title: "The Show", url: "https://filmpire.sc/watch/7?s=1&e=1", read: false, ...more });

describe("a notice of something new of a title", () => {
  it("says what is new: an episode, several, a season, a film (with the film the profile watched)", () => {
    expect(noticeLine(notice({ season: 2, episode: 4 }))).toBe("New episode: season 2, episode 4");
    expect(noticeLine(notice({ season: 2, episode: 6, count: 3 }))).toBe("3 new episodes, up to season 2, episode 6");
    expect(noticeLine(notice({ what: "season", season: 3, episode: 1 }))).toBe("Season 3 is out");
    expect(noticeLine(notice({}))).toBe("A new episode is out");
    expect(noticeLine(notice({ count: 4 }))).toBe("4 new episodes are out");
    expect(noticeLine(notice({ id: "movie-9", what: "film" }))).toBe("A new film is out");
    expect(noticeLine(notice({ id: "movie-9", what: "film", like: "Part One" }))).toBe("A new film, after Part One");
  });

  it("is a tile that opens the title's page: a show for an episode, a film for a film", () => {
    expect(entryOfNotice(notice({ season: 2, episode: 4, image: "p.jpg", year: 2024 }))).toEqual({ id: "new:tv-7", title: "The Show", url: "https://filmpire.sc/watch/7?s=1&e=1", note: "New episode: season 2, episode 4", kind: "series", image: "p.jpg", year: 2024 });
    expect(entryOfNotice(notice({ id: "movie-9", what: "film", url: "https://filmpire.sc/watch/9" }))).toMatchObject({ id: "new:movie-9", kind: "movie" });
  });

  it("of a kind this screen has never heard of is left out, and the rest of the answer is kept", () => {
    const answer = TitleNoticesSchema.parse({ items: [notice({}), { ...notice({ id: "tv-8" }), what: "spinoff" }, { id: "not one" }, null] });
    expect(answer.items.map((item) => item.id)).toEqual(["tv-7"]);
  });
});
