import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseLook, currentLook, DEFAULT_LOOK, LOOK_KEY, lookFromSearch, setLook, startLook, withoutLookAsk } from "./look";

describe("lookFromSearch", () => {
  it("reads the look an address asks for", () => {
    expect(lookFromSearch("?ui=polish")).toBe("polish");
    expect(lookFromSearch("?ui=classic")).toBe("classic");
    expect(lookFromSearch("?a=1&ui=polish&b=2")).toBe("polish");
    expect(lookFromSearch("?ui=reset")).toBe("reset");
  });

  it("asks for nothing when there is nothing, or nothing it knows", () => {
    expect(lookFromSearch("")).toBeUndefined();
    expect(lookFromSearch("?party=123456")).toBeUndefined();
    expect(lookFromSearch("?ui=")).toBeUndefined();
    expect(lookFromSearch("?ui=Polish")).toBeUndefined();
    expect(lookFromSearch("?ui=neon")).toBeUndefined();
  });
});

describe("chooseLook", () => {
  it("lets the address win over what was chosen before, and that win over the default", () => {
    expect(chooseLook("?ui=classic", "polish")).toBe("classic");
    expect(chooseLook("?ui=polish", undefined)).toBe("polish");
    expect(chooseLook("", "polish")).toBe("polish");
    expect(chooseLook("", undefined)).toBe(DEFAULT_LOOK);
  });

  it("goes back to the default for 'reset', and ignores a stored value it does not know", () => {
    expect(chooseLook("?ui=reset", "polish")).toBe(DEFAULT_LOOK);
    expect(chooseLook("", "neon")).toBe(DEFAULT_LOOK);
  });
});

describe("withoutLookAsk", () => {
  it("takes the ?ui= out of an address and keeps the rest", () => {
    expect(withoutLookAsk("https://kino.test/tv?ui=polish")).toBe("/tv");
    expect(withoutLookAsk("https://kino.test/?party=123456&ui=classic#top")).toBe("/?party=123456#top");
  });

  it("has nothing to say about an address that asked for no look", () => {
    expect(withoutLookAsk("https://kino.test/tv?party=1")).toBeUndefined();
  });
});

/** A page's storage and its <html> element. */
function page() {
  const storage = new Map<string, string>();
  const dataset: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal("document", { documentElement: { dataset } });
  return { storage, dataset };
}

describe("startLook and setLook", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("writes the look on <html>, and remembers what the address asked for", () => {
    const { storage, dataset } = page();
    expect(startLook("?ui=polish")).toBe("polish");
    expect(dataset.ui).toBe("polish");
    expect(storage.get(LOOK_KEY)).toBe("polish");
    // the next visit, with a plain address, wears it too
    expect(startLook("")).toBe("polish");
    expect(dataset.ui).toBe("polish");
  });

  it("wears the default on a first visit, and 'reset' forgets the choice", () => {
    const { storage, dataset } = page();
    expect(startLook("")).toBe(DEFAULT_LOOK);
    expect(dataset.ui).toBe(DEFAULT_LOOK);
    startLook("?ui=polish");
    startLook("?ui=reset");
    expect(storage.has(LOOK_KEY)).toBe(false);
    expect(dataset.ui).toBe(DEFAULT_LOOK);
  });

  it("changes the look at once, and leaves nothing in storage for the default one", () => {
    const { storage, dataset } = page();
    startLook("");
    setLook("polish");
    expect(currentLook()).toBe("polish");
    expect(dataset.ui).toBe("polish");
    expect(storage.get(LOOK_KEY)).toBe("polish");
    setLook("classic");
    expect(currentLook()).toBe("classic");
    expect(dataset.ui).toBe("classic");
    expect(storage.has(LOOK_KEY)).toBe(false);
  });

  it("takes the ask out of the address when the look is changed by hand, so a reload does not undo it", () => {
    page();
    const replaceState = vi.fn();
    vi.stubGlobal("location", { href: "https://kino.test/tv?ui=classic&party=1" });
    vi.stubGlobal("history", { state: { sheet: 1 }, replaceState });
    setLook("polish");
    expect(replaceState).toHaveBeenCalledWith({ sheet: 1 }, "", "/tv?party=1");
  });

  it("works where there is no storage and no page (a test, a browser that refuses storage)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: () => {
        throw new Error("no storage");
      },
      removeItem: () => {
        throw new Error("no storage");
      },
    });
    expect(startLook("?ui=polish")).toBe("polish");
    expect(() => setLook("classic")).not.toThrow();
  });
});
