import { describe, expect, it } from "vitest";
import type { LibraryItem } from "./library";
import { guessesFor, itemsOf, normalizeQuery, searchItems, spelledOut } from "./search";

const titles = [
  "Stranger Things",
  "Things We Lost in the Fire",
  "Game of Thrones",
  "Avatar",
  "Avatar: The Way of Water",
  "Spider-Man: No Way Home",
  "Marvel's Daredevil",
  "Amélie",
  "Dune",
  "Dune: Part Two",
  "The Lord of the Rings: The Fellowship of the Ring",
  "Harry Potter and the Chamber of Secrets",
  "Night Train",
  "The Night of the Hunter",
  "Nosferatu",
  "Iron Man",
];
const years: Record<string, number> = { Dune: 2021, "Dune: Part Two": 2024 };
const items: LibraryItem[] = titles.map((title, index) => ({ id: `t${index}`, title, url: `/${index}`, ...(years[title] ? { year: years[title] } : {}) }));
const find = (query: string) => searchItems(items, query).map((item) => item.title);

describe("normalizeQuery", () => {
  it("folds case, accents, apostrophes and punctuation, and spells out a short name that begins the search", () => {
    expect(normalizeQuery("  Amélie  ")).toBe("amelie");
    expect(normalizeQuery("Marvel’s  Daredevil!")).toBe("marvels daredevil");
    expect(normalizeQuery("Spider-Man: No Way Home")).toBe("spider man no way home");
    expect(normalizeQuery("LOTR two towers")).toBe("lord of the rings two towers");
    expect(normalizeQuery("what is got")).toBe("what is got"); // a short name is a short name only first
  });
  it("is empty for nothing worth looking for", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery(" ?! ")).toBe("");
  });
  it("does not take a word that merely looks like an object's property for a short name", () => {
    expect(normalizeQuery("constructor")).toBe("constructor");
    expect(spelledOut("toString")).toBe("toString");
  });
});

describe("spelledOut", () => {
  it("keeps what was typed, but for the short name and the spaces around it", () => {
    expect(spelledOut("  Hp  Chamber of Secrets ")).toBe("harry potter Chamber of Secrets");
    expect(spelledOut("  Amélie ")).toBe("Amélie");
  });
});

describe("searchItems", () => {
  it("finds a title typed with a slip of a letter, in any of its words", () => {
    expect(find("strager things")).toEqual(["Stranger Things"]);
    expect(find("stranger thigs")).toEqual(["Stranger Things"]);
    expect(find("avatr")).toEqual(["Avatar", "Avatar: The Way of Water"]);
  });
  it("does not forgive a slip in a short word, nor take a word that is nothing like one", () => {
    expect(find("irn man")).toEqual([]);
    expect(find("zzz")).toEqual([]);
    expect(find("strager thing xyz")).toEqual([]);
  });
  it("forgives two neighbouring letters swapped in a word of three, when another word of the query is longer", () => {
    expect(find("teh night of the hunter")).toEqual(["The Night of the Hunter"]);
    expect(find("teh night")).toEqual(["The Night of the Hunter"]);
    expect(find("iron mna")).toEqual(["Iron Man"]);
    expect(find("mna")).toEqual([]); // alone, three letters are too little to go on
    expect(find("teh")).toEqual([]);
  });
  it("takes a number for what it is: a year is not forgiven", () => {
    expect(find("dune 2012")).toEqual([]); // (not Dune of 2021)
    expect(find("dune 2021")).toEqual(["Dune"]);
  });
  it("needs every word, and finds the title with the words in any order", () => {
    expect(find("things stranger")).toEqual(["Stranger Things"]);
    expect(find("things")).toEqual(["Stranger Things", "Things We Lost in the Fire"]);
  });
  it("takes the word being typed for the start of one", () => {
    expect(find("strang thi")).toEqual(["Stranger Things"]);
    expect(find("nos")).toEqual(["Nosferatu"]);
    expect(find("game of thr")).toEqual(["Game of Thrones"]);
  });
  it("finds a title typed without its spaces or hyphens, and with or without its accents and apostrophes", () => {
    expect(find("spiderman")).toEqual(["Spider-Man: No Way Home"]);
    expect(find("spider man")).toEqual(["Spider-Man: No Way Home"]);
    expect(find("ironman")).toEqual(["Iron Man"]);
    expect(find("amelie")).toEqual(["Amélie"]);
    expect(find("marvels daredevil")).toEqual(["Marvel's Daredevil"]);
    expect(find("MARVEL'S")).toEqual(["Marvel's Daredevil"]);
  });
  it("finds a title by a short name, and by its year", () => {
    expect(find("lotr")).toEqual(["The Lord of the Rings: The Fellowship of the Ring"]);
    expect(find("hp chamber")).toEqual(["Harry Potter and the Chamber of Secrets"]);
    expect(find("dune 2021")).toEqual(["Dune"]);
    expect(find("dune 2024")).toEqual(["Dune: Part Two"]);
  });
  it("puts the best match first: the title that is the words, then longer ones, then those that came first", () => {
    expect(find("dune")).toEqual(["Dune", "Dune: Part Two"]);
    expect(find("night")).toEqual(["Night Train", "The Night of the Hunter"]);
    expect(searchItems([{ id: "b", title: "Echo", url: "/b" }, { id: "a", title: "Echo", url: "/a" }], "echo").map((item) => item.id)).toEqual(["b", "a"]);
  });
  it("puts a title that has the words as they are before one that needed forgiving", () => {
    const pool: LibraryItem[] = [
      { id: "far", title: "Strange Things", url: "/far" },
      { id: "near", title: "Stranger Things", url: "/near" },
    ];
    expect(searchItems(pool, "stranger things").map((item) => item.id)).toEqual(["near", "far"]);
  });
  it("is empty for nothing to look for and nothing to look in, and counts a title once", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
    expect(searchItems([], "dune")).toEqual([]);
    expect(searchItems([...items, ...items], "dune")).toHaveLength(2);
  });
});

describe("itemsOf", () => {
  it("lists the titles of the rows in order, each once", () => {
    const a = { id: "a", title: "A", url: "/a" };
    const b = { id: "b", title: "B", url: "/b" };
    expect(
      itemsOf([
        { id: "r1", title: "One", source: "S", items: [a, b] },
        { id: "r2", title: "Two", source: "S", items: [b, { id: "c", title: "C", url: "/c" }] },
      ]).map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("guessesFor", () => {
  it("asks the query without each of its words, and with each of the two longest cut to its first letters", () => {
    expect(guessesFor("strager things")).toEqual(["things", "strager", "things stra", "strager thin", "things strag"]);
    expect(guessesFor("wizrd of oz")).toEqual(["of oz", "of oz wizr"]);
    expect(guessesFor("the lord of the rings")).toEqual(["lord of rings", "the of the rings", "the lord of the", "the lord of the ring"]);
    expect(guessesFor("better call sual")).toEqual(["call sual", "better sual", "better call", "call sual bett"]);
  });
  it("asks the first letters of a word that is all there is, and all but its last two when it is very long", () => {
    expect(guessesFor("avatr")).toEqual(["avat"]);
    expect(guessesFor("gladiater")).toEqual(["glad", "gladiat"]);
  });
  it("asks nothing for words that are too short to be a slip, or for nothing", () => {
    expect(guessesFor("dune")).toEqual([]);
    expect(guessesFor("up")).toEqual([]);
    expect(guessesFor("")).toEqual([]);
  });
  it("asks no more than a handful of questions", () => {
    expect(guessesFor("the quick brown fox jumps over lazy dogs")).toHaveLength(6);
  });
  it("takes a short name as what it stands for", () => {
    expect(guessesFor("hp")).toEqual(["potter", "harry", "harry pott", "potter harr"]);
  });
});
