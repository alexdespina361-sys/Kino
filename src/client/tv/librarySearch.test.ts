import { describe, expect, it } from "vitest";
import { appendTo, editBox, KEYBOARD_KEYS, KEYBOARD_SHAPE, keepMatching, matchLocal, mergeAnswers, mergeItems, typedCharacter } from "./librarySearch";

const item = (id: string, title: string) => ({ id, title, url: `/${id}` });
const rows = [
  { id: "r1", title: "One", source: "S", items: [item("a", "The Night Of The Hunter"), item("b", "Nosferatu")] },
  { id: "r2", title: "Two", source: "S", items: [item("a", "The Night Of The Hunter"), item("c", "Night Train")] },
];

describe("matchLocal", () => {
  it("finds titles with the words typed, ignoring case, each title once, the closest first", () => {
    expect(matchLocal(rows, "NIGHT").map((found) => found.id)).toEqual(["c", "a"]);
    expect(matchLocal(rows, "nos").map((found) => found.id)).toEqual(["b"]);
  });
  it("forgives a slip of a letter, and finds a title whose name is typed without its spaces", () => {
    expect(matchLocal(rows, "nosferatoo").map((found) => found.id)).toEqual(["b"]);
    expect(matchLocal(rows, "night trian").map((found) => found.id)).toEqual(["c"]);
    expect(matchLocal(rows, "nighttrain").map((found) => found.id)).toEqual(["c"]);
  });
  it("finds nothing for nothing", () => {
    expect(matchLocal(rows, "")).toEqual([]);
    expect(matchLocal(rows, "   ")).toEqual([]);
    expect(matchLocal(rows, "zzz")).toEqual([]);
  });
});

describe("keepMatching", () => {
  const shown = [item("x", "Stranger Things"), item("y", "Strangers on a Train"), item("z", "The Strain")];
  it("keeps what is shown as far as it still matches the words typed since, so a list does not empty with every letter", () => {
    expect(keepMatching(shown, "stranger things").map((found) => found.id)[0]).toBe("x");
    expect(keepMatching(shown, "strangers on").map((found) => found.id)[0]).toBe("y");
    expect(keepMatching(shown, "zzz")).toEqual([]);
  });
});

describe("mergeItems", () => {
  it("puts what the server found after what was on screen, without repeating a title", () => {
    expect(mergeItems([item("a", "A"), item("b", "B")], [item("b", "B"), item("c", "C"), item("c", "C")]).map((found) => found.id)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeAnswers", () => {
  it("merges the screen's titles and the server's the same way, and puts the likeliest first whichever found it", () => {
    const screen = [item("w", "Welcome to the Boondocks"), item("n", "Boonie Bears")];
    const server = [item("w", "Welcome to the Boondocks"), item("b", "Boon"), item("d", "The Boondocks"), item("x", "Baboon")];
    expect(mergeAnswers(screen, server, "boon").map((found) => found.id)).toEqual(["b", "n", "d", "w", "x"]);
  });
});

describe("the keyboard", () => {
  it("has every letter and digit once, in rows of six, and under them the caret's two keys, Space, Delete and Clear", () => {
    expect(new Set(KEYBOARD_KEYS).size).toBe(36);
    expect(KEYBOARD_SHAPE).toEqual([6, 6, 6, 6, 6, 6, 5]);
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

describe("editBox", () => {
  const box = (text: string, caret = text.length) => ({ text, caret });

  it("types where the caret is, not only at the end, and the caret goes on after what was typed", () => {
    expect(editBox(box("nght", 1), { kind: "type", char: "i" })).toEqual(box("night", 2));
    expect(editBox(box("nigh"), { kind: "type", char: "t" })).toEqual(box("night"));
    expect(editBox(box(""), { kind: "type", char: "a" })).toEqual(box("a"));
  });

  it("keeps the text tidy wherever the caret is: no leading space, no double space, a limit", () => {
    expect(editBox(box("", 0), { kind: "type", char: " " })).toEqual(box("", 0));
    expect(editBox(box("a b", 2), { kind: "type", char: " " })).toEqual(box("a b", 2)); // (right after a space)
    expect(editBox(box("a b", 1), { kind: "type", char: " " })).toEqual(box("a b", 1)); // (right before one)
    expect(editBox(box("ab", 1), { kind: "type", char: " " })).toEqual(box("a b", 2));
    expect(editBox(box("x".repeat(60), 3), { kind: "type", char: "y" })).toEqual(box("x".repeat(60), 3));
  });

  it("takes out the character before the caret (Backspace) or after it (Delete), and does nothing at the edges", () => {
    expect(editBox(box("nigght", 4), { kind: "backspace" })).toEqual(box("night", 3));
    expect(editBox(box("nigght", 3), { kind: "delete" })).toEqual(box("night", 3));
    expect(editBox(box("night", 0), { kind: "backspace" })).toEqual(box("night", 0));
    expect(editBox(box("night"), { kind: "delete" })).toEqual(box("night"));
  });

  it("closes the gap a taken-out letter leaves between two spaces, and the caret stays among the letters", () => {
    expect(editBox(box("a b c", 3), { kind: "backspace" })).toEqual(box("a c", 2));
    expect(editBox(box("a b c", 2), { kind: "delete" })).toEqual(box("a c", 2));
    expect(editBox(box("a b", 1), { kind: "backspace" })).toEqual(box("b", 0));
  });

  it("moves the caret one place, to either end or to a place, and never off the text", () => {
    expect(editBox(box("night", 3), { kind: "move", to: "left" })).toEqual(box("night", 2));
    expect(editBox(box("night", 3), { kind: "move", to: "right" })).toEqual(box("night", 4));
    expect(editBox(box("night", 0), { kind: "move", to: "left" })).toEqual(box("night", 0));
    expect(editBox(box("night"), { kind: "move", to: "right" })).toEqual(box("night"));
    expect(editBox(box("night", 2), { kind: "move", to: "start" })).toEqual(box("night", 0));
    expect(editBox(box("night", 2), { kind: "move", to: "end" })).toEqual(box("night"));
    expect(editBox(box("night", 2), { kind: "move", to: 99 })).toEqual(box("night"));
    expect(editBox(box("night", 2), { kind: "move", to: 4 })).toEqual(box("night", 4));
  });

  it("empties the box", () => {
    expect(editBox(box("night", 2), { kind: "clear" })).toEqual(box("", 0));
  });
});
