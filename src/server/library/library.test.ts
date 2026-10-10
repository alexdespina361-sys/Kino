import { describe, expect, it, vi } from "vitest";
import type { LibraryRow } from "../../shared";
import { createLibrary, type LibrarySource } from "./library";

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

function setup(sources: LibrarySource[], options: { ttlMs?: number; retryMs?: number } = {}) {
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
