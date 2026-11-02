import { describe, expect, it } from "vitest";
import { remember } from "./boundedMap";

describe("remember", () => {
  it("never holds more than the bound, and lets the oldest go first", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 10; i++) remember(map, `k${i}`, i, 4);
    expect([...map.keys()]).toEqual(["k6", "k7", "k8", "k9"]);
  });

  it("an entry that is set again is the newest, not a second one", () => {
    const map = new Map<string, number>();
    for (const key of ["a", "b", "c"]) remember(map, key, 1, 3);
    remember(map, "a", 2, 3);
    expect([...map]).toEqual([["b", 1], ["c", 1], ["a", 2]]);
    remember(map, "d", 1, 3);
    expect([...map.keys()]).toEqual(["c", "a", "d"]);
  });

  it("brings a map that is over the bound down to it", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    remember(map, "e", 5, 2);
    expect([...map.keys()]).toEqual(["d", "e"]);
  });
});
