import { describe, expect, it } from "vitest";
import { itemsOf, TitleIndex } from "../../shared";
import { allExact, appendTo, editBox, KEYBOARD_KEYS, KEYBOARD_SHAPE, keepMatching, matchLocal, mergeAnswers, onlySection, typedCharacter } from "./librarySearch";

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
    // a title the server calls close that the screen has as exact is exact
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
    // Server's verified item should win or duplicate title is resolved once
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

  // (a narrow screen's own keyboard can type an emoji: two UTF-16 units, one character; cut in half it is a text the address cannot hold)
  it("steps over an emoji as one character, with the caret, Backspace and Delete alike", () => {
    const text = "a\u{1F3AC}b"; // a, a clapper board, b: length 4
    expect(editBox(box(text, 3), { kind: "move", to: "left" })).toEqual(box(text, 1));
    expect(editBox(box(text, 1), { kind: "move", to: "right" })).toEqual(box(text, 3));
    expect(editBox(box(text, 3), { kind: "backspace" })).toEqual(box("ab", 1));
    expect(editBox(box(text, 1), { kind: "delete" })).toEqual(box("ab", 1));
    expect(editBox(box(text, 1), { kind: "backspace" })).toEqual(box(text.slice(1), 0));
    expect(editBox(box(text, 3), { kind: "delete" })).toEqual(box("a\u{1F3AC}", 3));
  });

  it("never leaves the caret in the middle of an emoji, wherever it is told to go", () => {
    const text = "a\u{1F3AC}b";
    expect(editBox(box(text), { kind: "move", to: 2 })).toEqual(box(text, 1)); // (back to where the emoji starts)
    expect(editBox(box(text, 2), { kind: "type", char: "x" })).toEqual(box("ax\u{1F3AC}b", 2)); // (a caret that was left in the middle is mended before it types)
    expect(editBox(box(text, 2), { kind: "backspace" })).toEqual(box("\u{1F3AC}b", 0));
  });
});
