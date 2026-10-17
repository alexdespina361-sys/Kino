import { describe, expect, it } from "vitest";
import type { LibraryItem } from "./library";
import { guessesFor, itemsOf, normalizeQuery, rankByQuery, searchItems, spelledOut, TitleIndex, withoutNoise } from "./search";

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

describe("rankByQuery", () => {
  const pool = (...names: string[]): LibraryItem[] => names.map((title, index) => ({ id: `p${index}`, title, url: `/${index}` }));
  const order = (names: string[], query: string) => rankByQuery(pool(...names), query).map((item) => item.title);

  it("puts the title that is what was typed first, then titles that begin with it, then a word that does, then the rest", () => {
    expect(order(["Welcome to the Boondocks", "Baboon", "Boonie Bears", "The Boondocks", "Boon", "Zorro"], "boon")).toEqual([
      "Boon",
      "Boonie Bears",
      "The Boondocks",
      "Welcome to the Boondocks",
      "Baboon",
      "Zorro",
    ]);
  });
  it("keeps the order the places gave within each of those", () => {
    expect(order(["Boonies", "Boondocks", "Boone", "Boon Two"], "boon")).toEqual(["Boonies", "Boondocks", "Boone", "Boon Two"]);
  });
  it("does not count a leading The, A or An, nor punctuation, accents or spaces", () => {
    expect(order(["The Boondocks Special", "Boondocks"], "the boondocks")).toEqual(["Boondocks", "The Boondocks Special"]);
    expect(order(["Spider-Man: No Way Home", "Spider-Man"], "spiderman")).toEqual(["Spider-Man", "Spider-Man: No Way Home"]);
    expect(order(["Amélie Again", "Amélie"], "AMELIE")).toEqual(["Amélie", "Amélie Again"]);
    expect(order(["Marvel's Daredevil", "Daredevil"], "marvels")).toEqual(["Marvel's Daredevil", "Daredevil"]);
  });
  it("finds the words typed in any order at the start of the title's words, and a short name for what it stands for", () => {
    expect(order(["Things We Lost in the Fire", "Stranger Things Again", "Stranger Things"], "things stranger")).toEqual([
      "Stranger Things Again",
      "Stranger Things",
      "Things We Lost in the Fire",
    ]);
    expect(order(["The Lord of the Rings: The Two Towers", "Lord of the Rings"], "lotr")).toEqual(["Lord of the Rings", "The Lord of the Rings: The Two Towers"]);
  });
  it("lets a year in the words say which title, not what its name is", () => {
    const dunes: LibraryItem[] = [
      { id: "a", title: "Dune: Part Two", year: 2021, url: "/a" },
      { id: "b", title: "Dune", year: 2021, url: "/b" },
    ];
    expect(rankByQuery(dunes, "dune 2021").map((item) => item.id)).toEqual(["b", "a"]);
  });
  it("leaves the answers alone when nothing was typed, and does not change the list it was given", () => {
    const given = pool("B", "A");
    expect(rankByQuery(given, "  ").map((item) => item.title)).toEqual(["B", "A"]);
    rankByQuery(given, "a");
    expect(given.map((item) => item.title)).toEqual(["B", "A"]);
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

describe("withoutNoise", () => {
  it("leaves out the words that say what is wanted and are no part of a title", () => {
    expect(withoutNoise("Watch Dune full movie online")).toBe("dune");
    expect(withoutNoise("stranger things season 2")).toBe("stranger things 2");
  });
  it("is the words as they are when none of them is noise, or all of them are", () => {
    expect(withoutNoise("Game of Thrones")).toBe("game of thrones");
    expect(withoutNoise("movie")).toBe("movie");
    expect(withoutNoise("full movie")).toBe("full movie");
    expect(withoutNoise("Free HD Films")).toBe("free hd films");
    expect(withoutNoise("")).toBe("");
  });
});

describe("TitleIndex", () => {
  const index = () => new TitleIndex(items);
  const names = (found: LibraryItem[]) => found.map((item) => item.title);

  it("is what searchItems looks in, a title once", () => {
    const own = index();
    expect(own.size).toBe(items.length);
    own.add(items);
    expect(own.size).toBe(items.length);
    expect(names(own.find("strager things"))).toEqual(find("strager things"));
    expect(names(own.find("dune", "strict"))).toEqual(["Dune", "Dune: Part Two"]);
  });

  it("takes more titles as they are met, and finds them at once", () => {
    const own = index();
    expect(own.find("casablanca")).toEqual([]);
    own.add([{ id: "new", title: "Casablanca", url: "/new" }]);
    expect(names(own.find("casablanca"))).toEqual(["Casablanca"]);
    expect(names(own.find("casablnca"))).toEqual(["Casablanca"]);
    expect(own.size).toBe(items.length + 1);
  });

  it("forgives a letter more in the relaxed tier: a word of four letters one off, and two off in a word of six", () => {
    const own = index();
    expect(own.find("dunr")).toEqual([]);
    expect(names(own.find("dunr", "relaxed"))).toEqual(["Dune", "Dune: Part Two"]);
    expect(own.find("ovotar")).toEqual([]); // (two letters off Avatar)
    expect(names(own.find("ovotar", "relaxed"))).toEqual(["Avatar", "Avatar: The Way of Water"]);
    expect(own.find("zzz", "relaxed")).toEqual([]);
  });

  it("wants only half of the words in the loose tier, and not the noise words", () => {
    const own = index();
    expect(own.find("dune zzzz")).toEqual([]);
    expect(names(own.find("dune zzzz", "loose"))).toEqual(["Dune", "Dune: Part Two"]);
    expect(names(own.find("dune part zzzz", "loose"))).toEqual(["Dune: Part Two"]); // (two of the three)
    expect(own.find("watch full movie", "loose")).toEqual([]); // (nothing but noise)
    expect(own.find("zzzz qqqq", "loose")).toEqual([]);
    expect(own.find("   ", "loose")).toEqual([]);
  });

  it("counts the words a title has, not the spellings of one word that were asked for", () => {
    const own = new TitleIndex([
      { id: "a", title: "The Dark Knight", url: "/a" },
      { id: "b", title: "Knight Rider", url: "/b" },
      { id: "c", title: "Dark Waters", url: "/c" },
    ]);
    // ("knight" is asked in each of its swapped spellings too, and all of them find "knight": that is still one word of the three.)
    expect(names(own.find("dark knight returns", "loose"))).toEqual(["The Dark Knight"]);
  });

  it("does not take a word that is in a great many titles for a word they have in common with what was typed", () => {
    const own = index();
    expect(own.find("the zzzzz", "loose")).toEqual([]); // (not every title with "The")
    expect(own.find("the of and a", "loose")).toEqual([]);
    expect(names(own.find("the zzzzz night", "loose")).sort()).toEqual(["Night Train", "The Night of the Hunter"]); // (the word that is left is what they have)
  });

  it("searches the tiers in turn until there are enough, and says how many have all the words", () => {
    const own = index();
    const found = own.search("strager things");
    expect(names(found.items)).toEqual(["Stranger Things", "Things We Lost in the Fire"]);
    expect(found.exact).toBe(1); // (the other has only one of the two words)

    expect(own.search("dunr")).toMatchObject({ exact: 2 }); // (the relaxed tier has all the words of a title too)
    expect(own.search("zzzz")).toEqual({ items: [], exact: 0 });
    expect(own.search("")).toEqual({ items: [], exact: 0 });
  });

  it("does not look further when there are enough titles that have all the words", () => {
    const many = Array.from({ length: 9 }, (_, at) => ({ id: `n${at}`, title: `Night ${at}`, url: `/n${at}` }));
    const own = new TitleIndex([...many, { id: "other", title: "Day or Night Moves", url: "/o" }]);
    expect(own.search("night moves", 6).exact).toBe(1);
    expect(own.search("night", 6)).toMatchObject({ exact: 10 });
  });

  it("forgets the oldest titles when it holds more than it was given room for, and keeps the rest findable", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray", "yankee"];
    const own = new TitleIndex([], 10);
    own.add(words.map((word, at) => ({ id: word, title: `Film ${word}`, url: `/${at}` })));
    expect(own.size).toBeLessThanOrEqual(10);
    expect(own.find("alpha")).toEqual([]);
    expect(names(own.find("yankee"))).toEqual(["Film yankee"]);
    own.add([{ id: "alpha", title: "Film alpha", url: "/again" }]); // (one that was forgotten is taken again)
    expect(names(own.find("alpha"))).toEqual(["Film alpha"]);
  });
});
