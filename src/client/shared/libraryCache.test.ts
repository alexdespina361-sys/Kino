import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Library } from "../../shared/library";
import { getCachedLibrary, LIBRARY_CACHE_KEY, setCachedLibrary } from "./libraryCache";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const sampleLibrary: Library = {
  updatedAt: 1700000000000,
  rows: [
    {
      id: "row-1",
      title: "Popular Movies",
      source: "filmpire",
      kind: "movie",
      items: [
        {
          id: "m-1",
          title: "Sample Movie",
          year: 2024,
          image: "https://example.com/poster.jpg",
          description: "A test movie",
          kind: "movie",
          url: "https://filmpire.sc/watch/1",
        },
      ],
    },
  ],
};

describe("libraryCache", () => {
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mem,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("returns null when storage is empty", () => {
    expect(getCachedLibrary()).toBeNull();
  });

  it("saves and retrieves cached library", () => {
    setCachedLibrary(sampleLibrary);
    const retrieved = getCachedLibrary();
    expect(retrieved).toEqual(sampleLibrary);
  });

  it("ignores expired cache entries", () => {
    const expiredRecord = {
      time: Date.now() - 50 * 60 * 1000, // 50 mins ago (> 45 min TTL)
      data: sampleLibrary,
    };
    mem.setItem(LIBRARY_CACHE_KEY, JSON.stringify(expiredRecord));
    expect(getCachedLibrary()).toBeNull();
  });

  it("ignores invalid JSON in storage", () => {
    mem.setItem(LIBRARY_CACHE_KEY, "invalid-json{{{");
    expect(getCachedLibrary()).toBeNull();
  });
});
