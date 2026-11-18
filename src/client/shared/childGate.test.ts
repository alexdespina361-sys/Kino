import { describe, expect, it } from "vitest";
import type { LibraryItem, LibraryRow } from "../../shared";
import { onlyForChildren } from "../tv/librarySearch";
import { childTitlesOfRows, ownTitles } from "./childGate";

const item = (id: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({ id, title: `Title ${id}`, url: `https://x.example/watch/${id.replace(/\D/g, "")}`, ...extra });
const row = (id: string, items: LibraryItem[], section?: "cartoon" | "anime"): LibraryRow => ({ id, title: id, source: "Test", items, ...(section ? { section } : {}) });

describe("what the rows say of their titles, for a child's profile", () => {
  it("names each title by its address, and a title one row shows as a cartoon for children is one, whatever another row says", () => {
    const kid = item("filmpire-movie-10", { kids: true });
    const known = childTitlesOfRows([
      row("popular", [kid, item("filmpire-movie-11")]),
      row("cartoons", [kid, item("filmpire-movie-12", { kids: true }), item("filmpire-tv-13")], "cartoon"),
      row("anime", [item("filmpire-tv-14", { kids: true })], "anime"),
    ]);
    expect(Object.fromEntries(known)).toEqual({ "movie-10": true, "movie-11": false, "movie-12": true, "tv-13": false, "tv-14": false });
  });

  it("lists a profile's own titles for the gate: its cards, its saved titles and its ratings, with what a rating knows of its kind", () => {
    const titles = ownTitles(
      [{ key: "filmpire-movie-1", at: 1, title: "A", url: "https://x.example/watch/1", position: 1, duration: 10 }],
      [{ key: "k", at: 1, id: "filmpire-tv-2", title: "B", url: "https://x.example/watch/2" }],
      [{ key: "rate:x", at: 1, title: "C", url: "https://x.example/watch/3", score: 7, ratedAt: 1, kind: "series" }],
    );
    expect(titles).toEqual([
      { id: "filmpire-movie-1", url: "https://x.example/watch/1" },
      { id: "filmpire-tv-2", url: "https://x.example/watch/2" },
      { id: "rate:x", url: "https://x.example/watch/3", kind: "series" },
    ]);
  });
});

describe("onlyForChildren", () => {
  it("keeps of what a search found the cartoons for children, the exact ones still first", () => {
    const found = {
      items: [item("a", { section: "cartoon", kids: true }), item("b", { section: "cartoon" }), item("c"), item("d", { section: "anime", kids: true }), item("e", { section: "cartoon", kids: true })],
      exact: 3,
    };
    expect(onlyForChildren(found)).toEqual({ items: [found.items[0], found.items[4]], exact: 1 });
    expect(onlyForChildren({ items: [], exact: 0 })).toEqual({ items: [], exact: 0 });
  });
});
