import { describe, expect, it, vi } from "vitest";
import { reloadForScript, scriptIsMissing } from "./scriptRescue";

const kept = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
};

describe("scriptIsMissing", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://kino.example/assets/Tv-D4EAXG6x.js",
    "error loading dynamically imported module: https://kino.example/assets/Tv-D4EAXG6x.js",
    "Importing a module script failed.",
    "Loading chunk 12 failed.",
  ])("knows the browser's words: %s", (message) => {
    expect(scriptIsMissing(new TypeError(message))).toBe(true);
  });

  it("does not take any other error for it", () => {
    for (const error of [new Error("Cannot read properties of undefined (reading 'map')"), new RangeError("Maximum call stack size exceeded"), "a string", undefined, null, 42]) {
      expect(scriptIsMissing(error), String(error)).toBe(false);
    }
  });
});

describe("reloadForScript", () => {
  it("starts the page again, once in a minute", () => {
    const reload = vi.fn();
    const storage = kept();
    expect(reloadForScript(reload, 1_000_000, storage)).toBe(true);
    expect(reloadForScript(reload, 1_000_000 + 59_999, storage)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForScript(reload, 1_000_000 + 60_000, storage)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not start a page again when the browser keeps nothing to tell a second time from a first", () => {
    const reload = vi.fn();
    const refuses = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(reloadForScript(reload, 1_000_000, refuses)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
