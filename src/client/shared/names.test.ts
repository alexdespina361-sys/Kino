import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalName } from "../../shared";
import { resetNames, shownIn, wantName as want } from "./names";

const film = { id: "filmpire-movie-27205", url: "https://filmpire.sc/watch/27205", title: "Inception", description: "A thief." };
const anime = { id: "filmpire-tv-114410", url: "https://filmpire.sc/watch/114410?s=1&e=1", title: "Chainsaw Man", description: "Denji." };

afterEach(() => {
  resetNames();
  vi.useRealTimers();
});

describe("the name a title is shown with", () => {
  it("is its own in English, and for what is not the movie database's", () => {
    resetNames(async () => ({ "movie-27205": { title: "Începutul" } }));
    expect(shownIn(film, "en")).toEqual({ title: "Inception", description: "A thief." });
    expect(shownIn({ id: "animeheaven-x", url: "https://animeheaven.me/x", title: "X" }, "ro")).toEqual({ title: "X", description: undefined });
  });

  it("is its own until the answer comes; a title with no name in the language keeps its English one, and its English description", async () => {
    vi.useFakeTimers();
    const asked: string[][] = [];
    const answers: Record<string, LocalName> = { "movie-27205": { title: "Începutul", description: "Un hoț." }, "tv-114410": {} };
    resetNames(async (_lang, ids) => {
      asked.push([...ids]);
      return Object.fromEntries(ids.filter((id) => answers[id]).map((id) => [id, answers[id]!]));
    });
    expect(shownIn(film, "ro").title).toBe("Inception");
    want("ro", "movie-27205");
    want("ro", "tv-114410");
    want("ro", "movie-27205");
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toEqual([["movie-27205", "tv-114410"]]);
    expect(shownIn(film, "ro")).toEqual({ title: "Începutul", description: "Un hoț." });
    expect(shownIn(anime, "ro")).toEqual({ title: "Chainsaw Man", description: "Denji." });
    want("ro", "movie-27205");
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toHaveLength(1);
    expect(shownIn(film, "it").title).toBe("Inception");
  });

  it("asks forty titles a question, and again later for one left out of the answer", async () => {
    vi.useFakeTimers();
    const asked: string[][] = [];
    let reachable = false;
    resetNames(async (_lang, ids) => {
      asked.push([...ids]);
      return reachable ? Object.fromEntries(ids.map((id) => [id, { title: `N ${id}` }])) : {};
    });
    for (let at = 1; at <= 45; at++) want("ro", `movie-${at}`);
    await vi.advanceTimersByTimeAsync(100);
    expect(asked.map((ids) => ids.length)).toEqual([40, 5]);
    reachable = true;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(shownIn({ id: "filmpire-movie-7", title: "Seven" }, "ro").title).toBe("N movie-7");
  });
});
