import { describe, expect, it } from "vitest";
import { itemsOf, TitleIndex } from "../../shared";
import { allExact, appendTo, editBox, KEYBOARD_KEYS, KEYBOARD_SHAPE, keepMatching, matchLocal, mergeAnswers, onlySection, selectedText, selectionOf, typedCharacter } from "./librarySearch";

const item = (id: string, title: string, kind?: "movie" | "series", section?: "cartoon" | "anime") => ({ id, title, url: `/${id}`, ...(kind ? { kind } : {}), ...(section ? { section } : {}) });
const rows = [
  { id: "r1", title: "One", source: "S", items: [item("a", "The Night Of The Hunter"), item("b", "Nosferatu")] },
  { id: "r2", title: "Two", source: "S", items: [item("a", "The Night Of The Hunter"), item("c", "Night Train")] },
];
const index = new TitleIndex(itemsOf(rows));
const ids = (list: readonly { id: string }[]) => list.map((found) => found.id);

describe("matchLocal", () => {
  it("finds titles with the words typed, ignoring case, each title once, the closest first", () => {
    expect(ids(matchLocal(index, rows, "NIGHT").items)).toEqual(["c", "a"]);
    expect(ids(matchLocal(index, rows, "nos").items)).toEqual(["b"]);
  });
  it("forgives a slip of a letter, and finds a title whose name is typed without its spaces", () => {
    expect(ids(matchLocal(index, rows, "nosferatoo").items)).toEqual(["b"]);
    expect(ids(matchLocal(index, rows, "nighttrain").items)).toEqual(["c"]);
    const slip = matchLocal(index, rows, "night trian");
    expect(ids(slip.items.slice(0, slip.exact))).toEqual(["c"]);
  });
  it("puts the titles that have only some of the words after those that have them all", () => {
    const answers = matchLocal(index, rows, "night trian");
    expect(answers.exact).toBe(1);
    expect(ids(answers.items)).toEqual(["c", "a"]);
  });
  it("finds nothing for nothing", () => {
    expect(matchLocal(index, rows, "")).toEqual({ items: [], exact: 0 });
    expect(matchLocal(index, rows, "   ")).toEqual({ items: [], exact: 0 });
    expect(matchLocal(index, rows, "zzz")).toEqual({ items: [], exact: 0 });
  });
  it("looks for a single letter among the titles of the rows, and for more in everything that was met", () => {
    const met = new TitleIndex([...itemsOf(rows), item("q", "Quiet Place")]);
    expect(ids(matchLocal(met, rows, "q").items)).toEqual([]);
    expect(ids(matchLocal(met, rows, "qu").items)).toEqual(["q"]);
    expect(ids(matchLocal(met, rows, "n").items).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("keepMatching", () => {
  const shown = allExact([item("x", "Stranger Things"), item("y", "Strangers on a Train"), item("z", "The Strain")]);
  it("keeps what is shown as far as it still matches the words typed since, so a list does not empty with every letter", () => {
    expect(ids(keepMatching(shown, "stranger things").items)[0]).toBe("x");
    expect(ids(keepMatching(shown, "strangers on").items)[0]).toBe("y");
    expect(keepMatching(shown, "zzz")).toEqual({ items: [], exact: 0 });
  });
});

describe("mergeAnswers", () => {
  it("merges the screen's titles and the server's the same way, and puts the likeliest first whichever found it", () => {
    const screen = allExact([item("w", "Welcome to the Boondocks"), item("n", "Boonie Bears")]);
    const server = allExact([item("w", "Welcome to the Boondocks"), item("b", "Boon"), item("d", "The Boondocks"), item("x", "Baboon")]);
    const merged = mergeAnswers(screen, server, "boon");
    expect(ids(merged.items)).toEqual(["b", "n", "d", "w", "x"]);
    expect(merged.exact).toBe(5);
  });

  it("keeps the closest others apart, after the exact ones, and a title that is exact for one is not among them", () => {
    const screen = { items: [item("a", "Dune"), item("c1", "Dust"), item("c2", "Dunk")], exact: 1 };
    const server = { items: [item("a2", "Dune Part Two"), item("c1", "Dust")], exact: 1 };
    const merged = mergeAnswers(screen, server, "dune");
    expect(merged.exact).toBe(2);
    expect(ids(merged.items)).toEqual(["a", "a2", "c1", "c2"]);
    const swapped = mergeAnswers({ items: [item("a", "Dune")], exact: 1 }, { items: [item("a", "Dune"), item("c1", "Dust")], exact: 0 }, "dune");
    expect(swapped.exact).toBe(1);
    expect(ids(swapped.items)).toEqual(["a", "c1"]);
  });

  it("shows no more than thirty of the closest others", () => {
    const close = Array.from({ length: 50 }, (_, at) => item(`c${at}`, `Dust ${at}`));
    expect(mergeAnswers({ items: close, exact: 0 }, { items: [], exact: 0 }, "dune").items).toHaveLength(30);
  });

  it("filters out items with empty image strings and deduplicates matching titles", () => {
    const screen = allExact([
      { ...item("a1", "Dragon Ball", "series"), image: "" },
      { ...item("a2", "Dragon Ball", "series"), image: "https://img/valid.jpg" },
    ]);
    const server = allExact([
      { ...item("b1", "Dragon Ball", "series"), image: "https://img/server.jpg" },
      { ...item("b2", "Dragon Ball Z", "series"), image: "https://img/dbz.jpg" },
    ]);
    const merged = mergeAnswers(screen, server, "dragon");
    expect(merged.items.every((i) => i.image !== "")).toBe(true);
    expect(merged.items.filter((i) => i.title === "Dragon Ball")).toHaveLength(1);
    expect(merged.items.filter((i) => i.title === "Dragon Ball Z")).toHaveLength(1);
  });
});

describe("onlySection", () => {
  const answers = { items: [item("a", "A", "movie"), item("b", "B", "series"), item("c", "C", "movie"), item("d", "D", "series")], exact: 2 };
  it("keeps the films or the shows, and how many of the first are exact", () => {
    expect(onlySection(answers, "all")).toBe(answers);
    const films = onlySection(answers, "movie");
    expect(ids(films.items)).toEqual(["a", "c"]);
    expect(films.exact).toBe(1);
    const shows = onlySection(answers, "series");
    expect(ids(shows.items)).toEqual(["b", "d"]);
    expect(shows.exact).toBe(1);
  });

  it("puts a cartoon or an anime in its own section only, however its kind reads (a film or a show)", () => {
    const mixed = {
      items: [item("m", "M", "movie"), item("c1", "C1", "series", "cartoon"), item("a1", "A1", "movie", "anime"), item("s", "S", "series"), item("c2", "C2", "movie", "cartoon"), item("a2", "A2", "series", "anime")],
      exact: 3,
    };
    expect(ids(onlySection(mixed, "movie").items)).toEqual(["m"]);
    expect(ids(onlySection(mixed, "series").items)).toEqual(["s"]);
    const cartoons = onlySection(mixed, "cartoon");
    expect(ids(cartoons.items)).toEqual(["c1", "c2"]);
    expect(cartoons.exact).toBe(1);
    const anime = onlySection(mixed, "anime");
    expect(ids(anime.items)).toEqual(["a1", "a2"]);
    expect(anime.exact).toBe(1);
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
    expect(typedCharacter({ key: "c", ctrlKey: true })).toBeNull();
    expect(typedCharacter({ key: "c", altKey: true })).toBeNull();
    expect(typedCharacter({ key: "c", metaKey: true })).toBeNull();
    for (const [key, typed] of [["é", "é"], ["É", "é"], ["ş", "ş"], ["Ș", "ș"], ["ñ", "ñ"], ["&", "&"], ["'", "'"], ["!", "!"], ["-", "-"], ["😀", "😀"]] as const) {
      expect(typedCharacter({ key })).toBe(typed);
    }
    for (const key of ["Dead", "Process", "Unidentified", "Tab", "\t", "\n", "​"]) expect(typedCharacter({ key })).toBeNull();
    const altGraph = (key: string) => ({ key, ctrlKey: true, altKey: true, getModifierState: (name: string) => name === "AltGraph" });
    expect(typedCharacter(altGraph("ș"))).toBe("ș");
    expect(typedCharacter(altGraph("@"))).toBe("@");
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
    expect(editBox(box("a b", 2), { kind: "type", char: " " })).toEqual(box("a b", 2));
    expect(editBox(box("a b", 1), { kind: "type", char: " " })).toEqual(box("a b", 1));
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

  it("puts in at the caret what was copied somewhere else, as if it were typed: one line, tidy, and no longer than the box", () => {
    expect(editBox(box("the ", 4), { kind: "paste", text: "Night Of\n" })).toEqual(box("the Night Of", 12));
    expect(editBox(box("ab", 1), { kind: "paste", text: "\t x \r\n  y" })).toEqual(box("a x yb", 5));
    expect(editBox(box(""), { kind: "paste", text: "  Amelie \u{1F3AC}" })).toEqual(box("Amelie \u{1F3AC}"));
    expect(editBox(box("abc"), { kind: "paste", text: "defgh" }, 5)).toEqual(box("abcde"));
    expect(editBox(box("abc", 1), { kind: "paste", text: "" })).toEqual(box("abc", 1));
  });

  it("empties the box", () => {
    expect(editBox(box("night", 2), { kind: "clear" })).toEqual(box("", 0));
  });

  describe("a selection", () => {
    const picked = (text: string, anchor: number, caret: number) => ({ text, caret, anchor });

    it("is what lies between where it began and the caret, either way round, and nothing when they are the same place", () => {
      expect(selectionOf(picked("the night", 4, 9))).toEqual({ start: 4, end: 9 });
      expect(selectionOf(picked("the night", 9, 4))).toEqual({ start: 4, end: 9 });
      expect(selectionOf(picked("the night", 4, 4))).toBeNull();
      expect(selectionOf(box("the night"))).toBeNull();
      expect(selectedText(picked("the night", 4, 9))).toBe("night");
      expect(selectedText(box("the night"))).toBe("");
    });

    it("is made by dragging (from one place to another), a word (double click), all of it (Ctrl+A, triple click), or Shift with the keys that move the caret", () => {
      expect(editBox(box("the night of"), { kind: "select", from: 4, to: 7 })).toEqual(picked("the night of", 4, 7));
      expect(editBox(box("the night of"), { kind: "select", from: 4, to: 4 })).toEqual(box("the night of", 4));
      expect(editBox(box("the night of"), { kind: "selectWord", at: 6 })).toEqual(picked("the night of", 4, 9));
      expect(editBox(box("the night of"), { kind: "selectWord", at: 4 })).toEqual(picked("the night of", 4, 9));
      expect(editBox(box("the night of"), { kind: "selectAll" })).toEqual(picked("the night of", 0, 12));
      expect(editBox(box(""), { kind: "selectAll" })).toEqual(box("", 0));
      const once = editBox(box("night", 5), { kind: "move", to: "left", extend: true });
      expect(once).toEqual(picked("night", 5, 4));
      expect(editBox(once, { kind: "move", to: "left", extend: true })).toEqual(picked("night", 5, 3));
      expect(editBox(once, { kind: "move", to: "right", extend: true })).toEqual(box("night", 5));
      expect(editBox(box("night", 2), { kind: "move", to: "start", extend: true })).toEqual(picked("night", 2, 0));
      expect(editBox(box("night", 2), { kind: "move", to: 4, extend: true })).toEqual(picked("night", 2, 4));
    });

    it("is replaced by what is typed or pasted, and taken out by Backspace or Delete, the text kept tidy", () => {
      expect(editBox(picked("the night of", 4, 9), { kind: "type", char: "d" })).toEqual(box("the d of", 5));
      expect(editBox(picked("the night of", 4, 9), { kind: "paste", text: "day" })).toEqual(box("the day of", 7));
      expect(editBox(picked("the night of", 4, 9), { kind: "backspace" })).toEqual(box("the of", 4));
      expect(editBox(picked("the night of", 9, 4), { kind: "delete" })).toEqual(box("the of", 4));
      expect(editBox(picked("night", 0, 5), { kind: "backspace" })).toEqual(box("", 0));
      expect(editBox(picked("x".repeat(60), 0, 60), { kind: "type", char: "y" })).toEqual(box("y"));
    });

    it("is let go by an arrow without Shift, which goes to that end of it, and by a click", () => {
      expect(editBox(picked("the night", 4, 9), { kind: "move", to: "left" })).toEqual(box("the night", 4));
      expect(editBox(picked("the night", 9, 4), { kind: "move", to: "right" })).toEqual(box("the night", 9));
      expect(editBox(picked("the night", 4, 9), { kind: "move", to: 1 })).toEqual(box("the night", 1));
      expect(editBox(picked("the night", 4, 9), { kind: "clear" })).toEqual(box("", 0));
    });
  });

  it("steps over an emoji as one character, with the caret, Backspace and Delete alike", () => {
    const text = "a\u{1F3AC}b";
    expect(editBox(box(text, 3), { kind: "move", to: "left" })).toEqual(box(text, 1));
    expect(editBox(box(text, 1), { kind: "move", to: "right" })).toEqual(box(text, 3));
    expect(editBox(box(text, 3), { kind: "backspace" })).toEqual(box("ab", 1));
    expect(editBox(box(text, 1), { kind: "delete" })).toEqual(box("ab", 1));
    expect(editBox(box(text, 1), { kind: "backspace" })).toEqual(box(text.slice(1), 0));
    expect(editBox(box(text, 3), { kind: "delete" })).toEqual(box("a\u{1F3AC}", 3));
  });

  it("never leaves the caret in the middle of an emoji, wherever it is told to go", () => {
    const text = "a\u{1F3AC}b";
    expect(editBox(box(text), { kind: "move", to: 2 })).toEqual(box(text, 1));
    expect(editBox(box(text, 2), { kind: "type", char: "x" })).toEqual(box("ax\u{1F3AC}b", 2));
    expect(editBox(box(text, 2), { kind: "backspace" })).toEqual(box("\u{1F3AC}b", 0));
  });
});
