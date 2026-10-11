import { describe, expect, it, vi } from "vitest";
import type { LibraryRow } from "../../shared";
import { createLibrary, STRIKE_GAP_MS, type LibrarySource } from "./library";

const row = (title: string, count = 2): LibraryRow => ({
  id: title.toLowerCase(),
  title,
  source: "Test",
  items: Array.from({ length: count }, (_, index) => ({ id: `${title}-${index}`, title: `${title} ${index}`, url: `https://x.example/${title}/${index}` })),
});

/** A source whose answers the test decides, one call at a time. */
function fakeSource(id: string, answers: (() => Promise<LibraryRow[]>)[]): LibrarySource & { calls: number } {
  const source = {
    id,
    name: id,
    calls: 0,
    load: () => {
      const answer = answers[Math.min(source.calls, answers.length - 1)]!;
      source.calls++;
      return answer();
    },
  };
  return source;
}
const gives = (...rows: LibraryRow[]) => () => Promise.resolve(rows);
const fails = (message = "down") => () => Promise.reject(new Error(message));

function setup(sources: LibrarySource[], options: { ttlMs?: number; retryMs?: number; noVideoMs?: number } = {}) {
  let time = 1_000_000;
  const log = { warn: vi.fn() };
  const library = createLibrary({ sources, ttlMs: 1000, retryMs: 100, ...options, now: () => time, log });
  return { library, log, advance: (ms: number) => (time += ms), now: () => time };
}

describe("createLibrary", () => {
  it("lists the rows of every source in order, and when they were collected", async () => {
    const { library, now } = setup([fakeSource("a", [gives(row("One"))]), fakeSource("b", [gives(row("Two"), row("Three"))])]);
    const result = await library.get();
    expect(result.rows.map((r) => r.title)).toEqual(["One", "Two", "Three"]);
    expect(result.updatedAt).toBe(now());
  });

  it("asks a source once while its list is fresh", async () => {
    const source = fakeSource("a", [gives(row("One"))]);
    const { library, advance } = setup([source]);
    await library.get();
    advance(999);
    await library.get();
    expect(source.calls).toBe(1);
  });

  it("serves the old list at once when it has gone stale, and collects a new one meanwhile", async () => {
    let finish!: (rows: LibraryRow[]) => void;
    const slow = () => new Promise<LibraryRow[]>((resolve) => (finish = resolve));
    const source = fakeSource("a", [gives(row("Old")), slow]);
    const { library, advance } = setup([source]);
    await library.get();
    advance(1000);
    expect((await library.get()).rows[0]?.title).toBe("Old"); // did not wait for the slow one
    expect(source.calls).toBe(2);
    finish([row("New")]);
    await vi.waitFor(async () => expect((await library.get()).rows[0]?.title).toBe("New"));
  });

  it("makes requests that arrive together share one question", async () => {
    const source = fakeSource("a", [gives(row("One"))]);
    const { library } = setup([source]);
    await Promise.all([library.get(), library.get(), library.get()]);
    expect(source.calls).toBe(1);
  });

  it("keeps the last list when a source goes down, says so, and tries again after a while", async () => {
    const source = fakeSource("a", [gives(row("Kept")), fails(), gives(row("Back"))]);
    const { library, log, advance } = setup([source]);
    await library.get();
    advance(1000);
    await library.get(); // starts the failing refresh
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ source: "a" }), "library source failed"));
    expect((await library.get()).rows[0]?.title).toBe("Kept");
    expect(source.calls).toBe(2); // not asked again straight away

    advance(100);
    await library.get();
    await vi.waitFor(async () => expect((await library.get()).rows[0]?.title).toBe("Back"));
  });

  it("is empty, and does not hammer a source that has never answered", async () => {
    const source = fakeSource("a", [fails()]);
    const { library, advance } = setup([source]);
    expect(await library.get()).toEqual({ rows: [], updatedAt: 0 });
    await library.get();
    expect(source.calls).toBe(1);
    advance(100);
    await library.get();
    expect(source.calls).toBe(2);
  });

  it("lets one source be down without hiding the others", async () => {
    const { library } = setup([fakeSource("down", [fails()]), fakeSource("up", [gives(row("Fine"))])]);
    expect((await library.get()).rows.map((r) => r.title)).toEqual(["Fine"]);
  });

  it("leaves out rows with no titles", async () => {
    const { library } = setup([fakeSource("a", [gives(row("Empty", 0), row("Full", 1))])]);
    expect((await library.get()).rows.map((r) => r.title)).toEqual(["Full"]);
  });

  it("is simply empty with no sources", async () => {
    expect(await setup([]).library.get()).toEqual({ rows: [], updatedAt: 0 });
  });
});

describe("createLibrary similar", () => {
  const item = (id: string) => ({ id, title: id, url: `https://x.example/${id}` });
  /** A source that knows titles like any link, and counts how often it was asked. */
  const knowing = (id: string, answer: () => Promise<ReturnType<typeof item>[]>): LibrarySource & { asked: string[] } => {
    const asked: string[] = [];
    return {
      id,
      name: id,
      load: gives(row("R")),
      asked,
      similar: (link: string) => {
        asked.push(link);
        return answer();
      },
    };
  };

  it("asks the sources in turn and takes the first answer that has titles", async () => {
    const silent = knowing("a", () => Promise.resolve([]));
    const wise = knowing("b", () => Promise.resolve([item("one"), item("two")]));
    const later = knowing("c", () => Promise.resolve([item("three")]));
    const { library } = setup([silent, wise, later]);
    expect((await library.similar("https://x.example/watch/1")).map((found) => found.id)).toEqual(["one", "two"]);
    expect(silent.asked).toHaveLength(1);
    expect(later.asked).toHaveLength(0);
  });

  it("remembers an answer until the library would go stale", async () => {
    const source = knowing("a", () => Promise.resolve([item("one")]));
    const { library, advance } = setup([source]);
    await library.similar("https://x.example/watch/1");
    await library.similar("https://x.example/watch/1");
    expect(source.asked).toHaveLength(1);
    advance(1000);
    await library.similar("https://x.example/watch/1");
    expect(source.asked).toHaveLength(2);
  });

  it("is empty when a source fails or none knows how", async () => {
    const broken = knowing("a", () => Promise.reject(new Error("down")));
    expect(await setup([broken]).library.similar("https://x.example/watch/1")).toEqual([]);
    expect(await setup([fakeSource("plain", [gives(row("R"))])]).library.similar("https://x.example/watch/1")).toEqual([]);
  });
});

describe("createLibrary episodes", () => {
  const detail = (episode: number) => ({ season: 1, episode, title: `Episode ${episode}` });
  const knowing = (id: string, answer: () => Promise<ReturnType<typeof detail>[]>): LibrarySource & { asked: string[] } => {
    const asked: string[] = [];
    return {
      id,
      name: id,
      load: gives(row("R")),
      asked,
      episodes: (link: string, season: number) => {
        asked.push(`${season}|${link}`);
        return answer();
      },
    };
  };

  it("asks the sources in turn and takes the first answer that has episodes", async () => {
    const silent = knowing("a", () => Promise.resolve([]));
    const wise = knowing("b", () => Promise.resolve([detail(1), detail(2)]));
    const later = knowing("c", () => Promise.resolve([detail(3)]));
    const { library } = setup([silent, wise, later]);
    expect((await library.episodes("https://x.example/watch/1?s=1&e=1", 1)).map((found) => found.episode)).toEqual([1, 2]);
    expect(later.asked).toHaveLength(0);
  });

  it("remembers each season of a show apart, until the library would go stale", async () => {
    const source = knowing("a", () => Promise.resolve([detail(1)]));
    const { library, advance } = setup([source]);
    await library.episodes("https://x.example/watch/1?s=1&e=1", 1);
    await library.episodes("https://x.example/watch/1?s=1&e=1", 1);
    expect(source.asked).toHaveLength(1);
    await library.episodes("https://x.example/watch/1?s=2&e=1", 2);
    expect(source.asked).toHaveLength(2);
    advance(1000);
    await library.episodes("https://x.example/watch/1?s=1&e=1", 1);
    expect(source.asked).toHaveLength(3);
  });

  it("is empty when a source fails or none knows how", async () => {
    const broken = knowing("a", () => Promise.reject(new Error("down")));
    expect(await setup([broken]).library.episodes("https://x.example/watch/1", 1)).toEqual([]);
    expect(await setup([fakeSource("plain", [gives(row("R"))])]).library.episodes("https://x.example/watch/1", 1)).toEqual([]);
  });
});

describe("createLibrary seasons", () => {
  const knowing = (id: string, answer: () => Promise<number[]>): LibrarySource & { asked: string[] } => {
    const asked: string[] = [];
    return {
      id,
      name: id,
      load: gives(row("R")),
      asked,
      seasons: (link: string) => {
        asked.push(link);
        return answer();
      },
    };
  };

  it("asks the sources in turn and takes the first answer that has seasons", async () => {
    const silent = knowing("a", () => Promise.resolve([]));
    const wise = knowing("b", () => Promise.resolve([1, 2, 3]));
    const later = knowing("c", () => Promise.resolve([9]));
    const { library } = setup([silent, wise, later]);
    expect(await library.seasons("https://x.example/watch/1?s=1&e=1")).toEqual([1, 2, 3]);
    expect(later.asked).toHaveLength(0);
  });

  it("remembers an answer, an empty one too, until the library would go stale", async () => {
    const show = knowing("a", () => Promise.resolve([1, 2]));
    const { library, advance } = setup([show]);
    await library.seasons("https://x.example/watch/1?s=1&e=1");
    await library.seasons("https://x.example/watch/1?s=1&e=1");
    expect(show.asked).toHaveLength(1);

    const film = knowing("b", () => Promise.resolve([]));
    const { library: other } = setup([film]);
    await other.seasons("https://x.example/watch/2");
    await other.seasons("https://x.example/watch/2");
    expect(film.asked).toHaveLength(1);

    advance(1000);
    await library.seasons("https://x.example/watch/1?s=1&e=1");
    expect(show.asked).toHaveLength(2);
  });

  it("does not remember a place that could not be reached: the next question asks it again", async () => {
    let down = true;
    const source = knowing("a", () => (down ? Promise.reject(new Error("offline")) : Promise.resolve([1])));
    const { library } = setup([source]);
    expect(await library.seasons("https://x.example/watch/1?s=1&e=1")).toEqual([]);
    down = false;
    expect(await library.seasons("https://x.example/watch/1?s=1&e=1")).toEqual([1]);
    expect(source.asked).toHaveLength(2);
  });

  it("is empty when none knows how", async () => {
    expect(await setup([fakeSource("plain", [gives(row("R"))])]).library.seasons("https://x.example/watch/1")).toEqual([]);
  });
});

describe("createLibrary search", () => {
  const item = (id: string, title: string) => ({ id, title, url: `https://x.example/${id}` });
  const listed = (...titles: string[]): LibraryRow => ({ id: "r", title: "R", source: "Test", items: titles.map((title, at) => item(`listed-${at}`, title)) });
  /** A source that lists some titles and answers a search from a table of what each question gets, remembering the questions. */
  const searching = (rows: LibraryRow[], answers: Record<string, ReturnType<typeof item>[]> = {}): LibrarySource & { asked: string[] } => {
    const asked: string[] = [];
    return {
      id: "s",
      name: "s",
      load: gives(...rows),
      asked,
      search: (query: string) => {
        asked.push(query);
        return Promise.resolve(answers[query] ?? []);
      },
    };
  };
  const titlesOf = (items: { title: string }[]) => items.map((found) => found.title);

  it("finds what is listed, with a slip of a letter or a word not finished, before what the places answer, each title once", async () => {
    const source = searching([listed("Stranger Things", "Dune")], { dune: [item("remote-1", "Dune: Part Two"), item("listed-1", "Dune")] });
    const { library } = setup([source]);
    await library.get();
    expect(titlesOf(await library.search("strager things"))).toEqual(["Stranger Things"]);
    expect(titlesOf(await library.search("strang"))).toEqual(["Stranger Things"]);
    expect(titlesOf(await library.search("dune"))).toEqual(["Dune", "Dune: Part Two"]);
  });

  it("asks a place in the words as typed, with a short name that begins them spelled out", async () => {
    const source = searching([], { "lord of the rings": [item("1", "The Lord of the Rings"), item("2", "The Two Towers"), item("3", "The Return of the King")] });
    const { library } = setup([source]);
    expect(titlesOf(await library.search("  lotr "))).toEqual(["The Lord of the Rings", "The Two Towers", "The Return of the King"]);
    expect(source.asked).toEqual(["lord of the rings"]); // enough was found: not asked again in other words
  });

  it("asks a place that found little the words without each of them, and with a long one cut short, and keeps only the titles that match what was typed", async () => {
    const source = searching([], {
      things: [item("1", "Things We Lost in the Fire"), item("2", "Stranger Things")],
      "things stra": [item("2", "Stranger Things"), item("3", "Stranger Things: Tales from 85"), item("4", "Strawberry Things")],
    });
    const { library } = setup([source]);
    expect(titlesOf(await library.search("strager things"))).toEqual(["Stranger Things", "Stranger Things: Tales from 85"]);
    expect(source.asked).toEqual(["strager things", "things", "strager", "things stra", "strager thin", "things strag"]);
  });

  it("finds a title with a slip in a short word too, by asking without that word", async () => {
    const source = searching([], { "better call": [item("1", "Better Call Saul"), item("2", "Better Call Saul: Extras")] });
    const { library } = setup([source]);
    expect(titlesOf(await library.search("better call sual"))).toEqual(["Better Call Saul", "Better Call Saul: Extras"]);
  });

  it("keeps what a place answers to the words as typed even when the title does not show them (a title is also known by other names)", async () => {
    const source = searching([], { parasite: [item("1", "Gisaengchung")] });
    const { library } = setup([source]);
    expect(titlesOf(await library.search("parasite"))).toEqual(["Gisaengchung"]);
  });

  it("asks nothing for nothing to look for", async () => {
    const source = searching([listed("Dune")]);
    const { library } = setup([source]);
    await library.get();
    expect(await library.search("   ")).toEqual([]);
    expect(await library.search("?!")).toEqual([]);
    expect(source.asked).toEqual([]);
  });

  it("looks for no more than the first hundred letters of what is typed", async () => {
    const source = searching([]);
    const { library } = setup([source]);
    await library.search(`dune ${"x".repeat(5000)}`);
    expect(source.asked[0]).toHaveLength(100);
    expect(source.asked.every((words) => words.length <= 100)).toBe(true);
  });

  it("goes on without a place that fails, and without one that cannot search", async () => {
    const broken: LibrarySource = { id: "b", name: "b", load: gives(listed("Dune")), search: () => Promise.reject(new Error("down")) };
    const plain = fakeSource("p", [gives(row("R"))]);
    const { library } = setup([broken, plain]);
    await library.get();
    expect(titlesOf(await library.search("dune"))).toEqual(["Dune"]);
    expect(await library.search("nothing like it")).toEqual([]);
  });
});

describe("createLibrary titles with no video", () => {
  const urls = (rows: LibraryRow[]) => rows.flatMap((one) => one.items.map((found) => found.url));
  const first = "https://x.example/One/0";
  const second = "https://x.example/One/1";
  /** Long enough to jump the gap between two tries without the list or the strikes going stale. */
  const patient = { ttlMs: 100 * STRIKE_GAP_MS, noVideoMs: 10 * STRIKE_GAP_MS };

  it("leaves a title out of the rows once a place has no video of it, and a row with nothing left in it", async () => {
    const { library } = setup([fakeSource("a", [gives(row("One"), row("Two", 1))])]);
    library.played(first, "none");
    expect(urls((await library.get()).rows)).toEqual([second, "https://x.example/Two/0"]);
    library.played("https://x.example/Two/0", "none");
    expect((await library.get()).rows.map((one) => one.title)).toEqual(["One"]);
  });

  it("waits for a second failure when the video was only out of reach, and forgives a title once it plays", async () => {
    const { library, advance } = setup([fakeSource("a", [gives(row("One"))])], patient);
    library.played(first, "failed");
    expect(urls((await library.get()).rows)).toContain(first);
    advance(STRIKE_GAP_MS);
    library.played(first, "failed");
    expect(urls((await library.get()).rows)).not.toContain(first);
    library.played(first, "found");
    expect(urls((await library.get()).rows)).toContain(first);

    library.played(second, "failed"); // wherever it stands in its row
    advance(STRIKE_GAP_MS);
    library.played(second, "failed");
    expect(urls((await library.get()).rows)).toEqual([first]);
  });

  it("counts tries that fail together as one bad moment, not as two strikes", async () => {
    const { library, advance } = setup([fakeSource("a", [gives(row("One"))])], patient);
    library.played(first, "failed");
    advance(STRIKE_GAP_MS - 1);
    library.played(first, "failed"); // another phone of the party, or the same one trying again at once
    expect(urls((await library.get()).rows)).toContain(first);
    advance(1);
    library.played(first, "failed"); // a separate try, measured from the first
    expect(urls((await library.get()).rows)).not.toContain(first);
  });

  it("still finds a title that was only out of reach when it is asked for by name, but not one that has no video", async () => {
    const found = { id: "r", title: "Remote Title", url: "https://x.example/remote" };
    const source: LibrarySource = { id: "s", name: "s", load: gives(row("One")), search: () => Promise.resolve([found]) };
    const { library, advance } = setup([source], patient);
    library.played(found.url, "failed");
    advance(STRIKE_GAP_MS);
    library.played(found.url, "failed");
    expect((await library.search("remote title")).map((one) => one.id)).toEqual(["r"]);
    library.played(found.url, "none");
    expect(await library.search("remote title")).toEqual([]);
  });

  it("does not let a try that failed to be reached soften a title that has no video", async () => {
    const { library, advance } = setup([fakeSource("a", [gives(row("One"))])], patient);
    library.played(first, "none");
    advance(STRIKE_GAP_MS);
    library.played(first, "failed");
    expect(urls((await library.get()).rows)).not.toContain(first);
  });

  it("brings a title back after a while, with its strikes forgotten", async () => {
    const { library, advance } = setup([fakeSource("a", [gives(row("One"))])], { ttlMs: 100_000, noVideoMs: 5000 });
    library.played(first, "none");
    advance(4999);
    expect(urls((await library.get()).rows)).not.toContain(first);
    advance(1);
    expect(urls((await library.get()).rows)).toContain(first);
    library.played(first, "failed");
    expect(urls((await library.get()).rows)).toContain(first); // one strike again, not the two it would be if the old ones counted
  });

  it("leaves it out of what is found and out of titles like another one", async () => {
    const remote = { id: "remote", title: "Remote Title", url: "https://x.example/remote" };
    const source: LibrarySource = {
      id: "s",
      name: "s",
      load: gives(row("One")),
      search: () => Promise.resolve([remote]),
      similar: () => Promise.resolve([remote, { id: "other", title: "Other", url: "https://x.example/other" }]),
    };
    const { library } = setup([source]);
    expect((await library.search("remote title")).map((found) => found.id)).toEqual(["remote"]);
    library.played(remote.url, "none");
    expect(await library.search("remote title")).toEqual([]);
    expect((await library.similar(first)).map((found) => found.id)).toEqual(["other"]);
  });

  it("does not mind a link that is no title, or one that is far too long", async () => {
    const { library } = setup([fakeSource("a", [gives(row("One"))])]);
    library.played("https://elsewhere.example/page", "none");
    library.played(`https://elsewhere.example/${"x".repeat(3000)}`, "none");
    expect(urls((await library.get()).rows)).toEqual([first, second]);
  });
});
