import { describe, expect, it } from "vitest";
import { appendTo, KEYBOARD_KEYS, KEYBOARD_SHAPE, matchLocal, mergeItems, typedCharacter } from "./librarySearch";

const item = (id: string, title: string) => ({ id, title, url: `/${id}` });
const rows = [
  { id: "r1", title: "One", source: "S", items: [item("a", "The Night Of The Hunter"), item("b", "Nosferatu")] },
  { id: "r2", title: "Two", source: "S", items: [item("a", "The Night Of The Hunter"), item("c", "Night Train")] },
];

describe("matchLocal", () => {
  it("finds titles containing the text, ignoring case, each title once, in row order", () => {
    expect(matchLocal(rows, "NIGHT").map((found) => found.id)).toEqual(["a", "c"]);
    expect(matchLocal(rows, "nos").map((found) => found.id)).toEqual(["b"]);
  });
  it("finds nothing for nothing", () => {
    expect(matchLocal(rows, "")).toEqual([]);
    expect(matchLocal(rows, "   ")).toEqual([]);
    expect(matchLocal(rows, "zzz")).toEqual([]);
  });
});

describe("mergeItems", () => {
  it("puts what the server found after what was on screen, without repeating a title", () => {
    expect(mergeItems([item("a", "A"), item("b", "B")], [item("b", "B"), item("c", "C"), item("c", "C")]).map((found) => found.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the keyboard", () => {
  it("has every letter and digit once, in rows of six with a last row of two wide keys", () => {
    expect(new Set(KEYBOARD_KEYS).size).toBe(36);
    expect(KEYBOARD_SHAPE).toEqual([6, 6, 6, 6, 6, 6, 2]);
  });

  it("types letters, digits and spaces from a physical keyboard, and nothing else", () => {
    expect(typedCharacter({ key: "A" })).toBe("a");
    expect(typedCharacter({ key: "7" })).toBe("7");
    expect(typedCharacter({ key: " " })).toBe(" ");
    expect(typedCharacter({ key: "Enter" })).toBeNull();
    expect(typedCharacter({ key: "ArrowLeft" })).toBeNull();
    expect(typedCharacter({ key: "!" })).toBeNull();
    expect(typedCharacter({ key: "c", ctrlKey: true })).toBeNull();
  });

  it("keeps the text tidy: no leading or double spaces, and a limit", () => {
    expect(appendTo("", " ")).toBe("");
    expect(appendTo("ab", " ")).toBe("ab ");
    expect(appendTo("ab ", " ")).toBe("ab ");
    expect(appendTo("ab ", "c")).toBe("ab c");
    expect(appendTo("x".repeat(60), "y")).toBe("x".repeat(60));
  });
});
