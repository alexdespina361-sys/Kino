import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAbout, cardsOf, forgetTitles, knownTitle, RETRY_MS } from "./titleCache";

const item = { id: "filmpire-movie-603", title: "The Matrix", year: 1999, url: "/fixtures/a.mp4" };

describe("what a chat knows of the titles it names", () => {
  let answers: Array<() => Response>;
  beforeEach(() => {
    forgetTitles();
    answers = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (answers.shift() ?? (() => new Response("", { status: 500 })))()),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks once for a title however many lines name it, and keeps the answer", async () => {
    answers.push(() => Response.json({ item }));
    expect(knownTitle(item.id).status).toBe("loading");
    await Promise.all([askAbout(item.id), askAbout(item.id), askAbout(item.id)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(knownTitle(item.id)).toEqual({ status: "ready", item });
    await askAbout(item.id);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a title nobody knows as nothing for good, and asks about one it could not ask about again only after a minute", async () => {
    answers.push(() => Response.json({ item: null }));
    await askAbout("filmpire-movie-1");
    expect(knownTitle("filmpire-movie-1").status).toBe("none");
    await askAbout("filmpire-movie-1");
    expect(fetch).toHaveBeenCalledTimes(1);

    answers.push(() => new Response("", { status: 429 }));
    await askAbout("filmpire-movie-2");
    const failedAt = Date.now();
    expect(knownTitle("filmpire-movie-2", failedAt).status).toBe("failed");
    await askAbout("filmpire-movie-2");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(knownTitle("filmpire-movie-2", failedAt + RETRY_MS + 1).status).toBe("loading");
  });

  it("shows the newest titles of a chat as cards, a few at most", () => {
    expect([...cardsOf(["a", null, "b", "a", "c"], 2)]).toEqual(["c", "a"]);
    expect([...cardsOf([null, null])]).toEqual([]);
    expect(cardsOf(Array.from({ length: 40 }, (_, n) => `t${n}`)).size).toBe(12);
  });
});
