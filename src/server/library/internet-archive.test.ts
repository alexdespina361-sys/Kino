import { describe, expect, it, vi } from "vitest";
import { LibraryRowSchema } from "../../shared";
import { internetArchive, plainDescription } from "./internet-archive";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const search = (...docs: unknown[]) => json({ response: { numFound: docs.length, start: 0, docs } });

const rows = [
  { collection: "feature_films", title: "Feature films" },
  { collection: "classic_tv", title: "Classic TV" },
];

describe("internetArchive", () => {
  it("makes a row per collection, with titles that play like pasted links", async () => {
    const get = vi.fn(async () => search({ identifier: "big_movie", title: "Big Movie", year: 1938 }, { identifier: "short", title: ["A Short", "alt"], year: "1920" }));
    const result = await internetArchive({ rows, fetch: get as never }).load();

    expect(result.map((row) => [row.id, row.title, row.source])).toEqual([
      ["archive-feature_films", "Feature films", "Internet Archive"],
      ["archive-classic_tv", "Classic TV", "Internet Archive"],
    ]);
    expect(result[0]!.items).toEqual([
      { id: "big_movie", title: "Big Movie", year: 1938, image: "https://archive.org/services/img/big_movie", url: "https://archive.org/details/big_movie" },
      { id: "short", title: "A Short", year: 1920, image: "https://archive.org/services/img/short", url: "https://archive.org/details/short" },
    ]);
    for (const row of result) expect(LibraryRowSchema.safeParse(row).success).toBe(true);
  });

  it("asks for the collection's films, most watched first, without the adult-tagged or so-titled", async () => {
    const get = vi.fn(async (_url: URL | string) => search());
    await internetArchive({ rows: [rows[0]!], perRow: 10, fetch: get as never }).load();
    const url = new URL(String(get.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://archive.org/advancedsearch.php");
    expect(url.searchParams.get("q")).toMatch(/^collection:feature_films AND mediatype:movies AND NOT subject:\(.*erotica.*\) AND NOT title:\(.*sex.*\)$/);
    expect(url.searchParams.getAll("sort[]")).toEqual(["downloads desc"]);
    expect(url.searchParams.get("rows")).toBe("10");
    expect(url.searchParams.get("output")).toBe("json");
  });

  it("makes the best of odd entries: no title, no or silly year, ids that need escaping, rubbish", async () => {
    const get = async () => search({ identifier: "plain", year: 0 }, { identifier: "a b/c", title: "  Spaced  ", year: "unknown" }, { nonsense: true }, null, "text");
    const [row] = await internetArchive({ rows: [rows[0]!], fetch: get as never }).load();
    expect(row!.items).toEqual([
      { id: "plain", title: "plain", image: "https://archive.org/services/img/plain", url: "https://archive.org/details/plain" },
      { id: "a b/c", title: "Spaced", image: "https://archive.org/services/img/a%20b%2Fc", url: "https://archive.org/details/a%20b%2Fc" },
    ]);
  });

  it("gives the rows that came when another did not", async () => {
    let call = 0;
    const get = async () => (call++ === 0 ? json({}, 500) : search({ identifier: "x", title: "X" }));
    const result = await internetArchive({ rows, fetch: get as never }).load();
    expect(result.map((row) => row.title)).toEqual(["Classic TV"]);
  });

  it("fails, so the cache keeps what it had, when nothing came", async () => {
    await expect(internetArchive({ rows, fetch: (async () => json({}, 503)) as never }).load()).rejects.toThrow(/HTTP 503/);
    await expect(internetArchive({ rows, fetch: (async () => json({ unexpected: true })) as never }).load()).rejects.toThrow();
    await expect(
      internetArchive({
        rows,
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as never,
      }).load(),
    ).rejects.toThrow("fetch failed");
  });

  it("carries a plain-text description for the TV's banner, and skips what says nothing", async () => {
    const get = async () =>
      search(
        { identifier: "a", title: "A", description: "<p>A <b>great</b> film &amp; more,<br>in two parts. Both worth it.</p>" },
        { identifier: "b", title: "B", description: ["Short."] },
        { identifier: "c", title: "C" },
      );
    const [row] = await internetArchive({ rows: [rows[0]!], fetch: get as never }).load();
    expect(row!.items.map((item) => item.description)).toEqual(["A great film & more, in two parts. Both worth it.", undefined, undefined]);
    expect(LibraryRowSchema.safeParse(row).success).toBe(true);
  });
});

describe("plainDescription", () => {
  it("joins a list, decodes entities, and cuts long text at a word", () => {
    expect(plainDescription(["First part of it.", "Second part of it."])).toBe("First part of it. Second part of it.");
    expect(plainDescription("Caf&eacute; &#39;noir&#39; &#x2014; a long story told twice")).toBe("Café 'noir' — a long story told twice");
    const long = plainDescription("word ".repeat(200), 50)!;
    expect(long.length).toBeLessThanOrEqual(51);
    expect(long.endsWith("word…")).toBe(true);
  });
  it("is nothing for nothing", () => {
    expect(plainDescription(undefined)).toBeUndefined();
    expect(plainDescription("  <br> ")).toBeUndefined();
  });
});

describe("internetArchive search", () => {
  it("searches archive with query and returns parsed items", async () => {
    const get = vi.fn(async (_url: URL | string) => search({ identifier: "night_movie", title: "A Night Movie", year: 1950 }));
    const source = internetArchive({ fetch: get as never });
    const items = await source.search!("night");
    expect(items).toEqual([
      { id: "night_movie", title: "A Night Movie", year: 1950, image: "https://archive.org/services/img/night_movie", url: "https://archive.org/details/night_movie" },
    ]);
    const url = new URL(String(get.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toContain("(night) AND mediatype:movies");
  });
});
