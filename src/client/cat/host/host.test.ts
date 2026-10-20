import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { fits, MOODS, pick, type Candidate, type Mood } from "./assistant";
import { Governor } from "./governor";
import { DWELL_MS, Hand, REPEAT_MS } from "./hand";

describe("the hand on the cat", () => {
  it("does not stroke a cat the pointer only passes over, and strokes one it rests on", () => {
    const hand = new Hand();
    expect(hand.step(0, true)).toBeNull();
    expect(hand.step(DWELL_MS - 20, true)).toBeNull();
    expect(hand.step(DWELL_MS + 5, true)).toBe("pet");
    expect(hand.stroking).toBe(true);
    // ...tells the cat again, now and then, for as long as it stays (the cat lets go a little after the last word)...
    expect(hand.step(DWELL_MS + 5 + REPEAT_MS / 2, true)).toBeNull();
    expect(hand.step(DWELL_MS + 5 + REPEAT_MS, true)).toBe("pet");
    // ...and lets go once, when the pointer leaves
    expect(hand.step(5000, false)).toBe("end");
    expect(hand.step(5016, false)).toBeNull();
    expect(hand.stroking).toBe(false);
  });

  it("starts the wait again for a pointer that went away before it was done", () => {
    const hand = new Hand();
    hand.step(0, true);
    expect(hand.step(200, false)).toBeNull();
    expect(hand.step(300, true)).toBeNull();
    expect(hand.step(300 + DWELL_MS - 10, true)).toBeNull();
    expect(hand.step(300 + DWELL_MS + 10, true)).toBe("pet");
  });

  it("strokes at once for a press, and lets go when the finger leaves", () => {
    const hand = new Hand();
    expect(hand.press(100)).toBe("pet");
    expect(hand.stroking).toBe(true);
    expect(hand.step(116, false)).toBe("end");
  });
});

describe("the governor", () => {
  const run = (governor: Governor, frames: number, cost: number, gap = 16.7): void => {
    for (let i = 0; i < frames; i++) governor.note(cost, gap);
  };

  it("leaves a cat that is cheap alone", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 3000, 0.6);
    expect(governor.quality).toBe("full");
  });

  it("does nothing in the first moments, and nothing for a few slow frames", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 25, 20);
    expect(governor.quality).toBe("full");
    run(governor, 40, 0.5);
    run(governor, 30, 9);
    expect(governor.quality).toBe("full");
  });

  it("goes down a step after a couple of seconds of being over budget, and then another if it is still far over at the lower picture", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 200, 3);
    expect(governor.quality).toBe("low");
    run(governor, 400, 3); // (3 ms is over 2 but within what the lower picture is allowed: 3.2)
    expect(governor.quality).toBe("low");
    run(governor, 300, 8);
    expect(governor.quality).toBe("off");
    run(governor, 5000, 0.1);
    expect(governor.quality).toBe("off"); // (gone is gone, until the page is loaded again)
  });

  it("gives the better picture back only after a long run of good frames", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 200, 3);
    expect(governor.quality).toBe("low");
    run(governor, 300, 0.4);
    expect(governor.quality).toBe("low");
    run(governor, 1200, 0.4);
    expect(governor.quality).toBe("full");
  });

  it("does not count a frame the screen waited for (the tab was in the background)", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 400, 50, 1500);
    expect(governor.quality).toBe("full");
  });
});

const pool: Candidate[] = [
  { id: "m1", title: "Laugh Riot", rows: ["Comedy"], index: 0, image: "a.jpg" },
  { id: "m2", title: "Night Terror", rows: ["Horror"], index: 1, image: "b.jpg" },
  { id: "m3", title: "Hearts Aflame", rows: ["Romance", "Trending now"], index: 2, image: "c.jpg" },
  { id: "m4", title: "Star Voyage", rows: ["Sci-Fi & Fantasy"], index: 3, image: "d.jpg" },
  { id: "m5", title: "Casa Mare", rows: ["Comedii"], index: 4 },
  { id: "m6", title: "Fiabe", rows: ["Per tutta la famiglia", "Animazione"], index: 0, image: "f.jpg" },
];

describe("find me something", () => {
  it("knows which shelves hold which mood, by the names the library gives them in the three languages of the website", () => {
    const shelves: Array<[Mood, string[]]> = [
      ["funny", ["Comedy Movies", "Comedy Series", "Filme de comedie", "Film commedia", "Best Comedy Movies", "Hidden Gem Comedy Series"]],
      ["scary", ["Horror Movies", "Thriller Movies", "Mystery Movies", "Filme de groază", "Filme de mister", "Filme thriller", "Film horror", "Film gialli", "Sci-fi & horror", "Classic Horror Movies"]],
      ["exciting", ["Action Movies", "Adventure Movies", "Crime Movies", "Best War Movies", "Action & Adventure Series", "Filme de acțiune", "Filme polițiste", "Cele mai bune filme de război", "Film d'azione", "Film crime", "I migliori film di guerra"]],
      ["romantic", ["Romance Movies", "Classic Romance Movies", "Filme romantice", "Film romantici"]],
      ["family", ["Family Movies", "Animated Movies", "Kids & Family Shows", "Cartoons & animation", "Filme pentru familie", "Filme de animație", "Desene animate și animație", "Film per famiglie", "Film d'animazione", "Cartoni e animazione", "Serie per bambini e famiglie"]],
      ["scifi", ["Sci-Fi Movies", "Fantasy Movies", "Sci-Fi & Fantasy Series", "Filme SF", "Filme fantasy", "Film di fantascienza", "Fantascienza e horror"]],
      ["classic", ["Classic Action Movies", "Cult Classics", "Movies of the 1980s", "Best Movies of the 1930s", "Silent films", "Televiziune clasică", "Filme clasice de groază", "Filme cult", "Filme din anii 1980", "Classici dell'horror", "Film degli anni Ottanta", "TV classica", "Film cult"]],
      ["new", ["Trending Movies", "Popular Series", "Filme în tendințe", "Filme populare", "Film di tendenza", "Film popolari"]],
    ];
    for (const [mood, names] of shelves) for (const name of names) expect(fits(mood, name), `${mood}: ${name}`).toBe(true);
    // ...and not the others
    expect(fits("funny", "Horror Movies")).toBe(false);
    expect(fits("romantic", "Comedy Movies")).toBe(false);
    expect(fits("family", "Action Movies")).toBe(false);
    expect(fits("scary", "Oscar Winners")).toBe(false);
    expect(fits("romantic", "Armor and Glamour")).toBe(false);
    expect(fits("classic", "Series of the 2000s")).toBe(false);
    expect(fits("new", "Top Rated Movies")).toBe(false);
    for (const mood of MOODS) expect(fits(mood, "Anything at all"), mood).toBe(mood === "any");
  });

  it("picks a title from a shelf that fits, and from no other", () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(pick(pool, "scary", new Set(), createRng(seed))?.id).toBe("m2");
      expect(["m1", "m5"]).toContain(pick(pool, "funny", new Set(), createRng(seed))?.id);
      expect(pick(pool, "romantic", new Set(), createRng(seed))?.id).toBe("m3");
    }
  });

  it("is the same pick for the same seed, and a picks it never repeats while there is another", () => {
    expect(pick(pool, "any", new Set(), createRng(7))?.id).toBe(pick(pool, "any", new Set(), createRng(7))?.id);
    const shown = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const next = pick(pool, "any", shown, createRng(100 + i));
      expect(next).not.toBeNull();
      expect(shown.has(next!.id)).toBe(false);
      shown.add(next!.id);
    }
    expect(pick(pool, "any", shown, createRng(1))).toBeNull();
  });

  it("finds nothing for a mood the page has no shelf for, or once everything fitting has been shown", () => {
    expect(pick(pool.filter((one) => one.id !== "m2"), "scary", new Set(), createRng(1))).toBeNull();
    expect(pick(pool, "funny", new Set(["m1", "m5"]), createRng(1))).toBeNull();
    expect(pick([], "any", new Set(), createRng(1))).toBeNull();
  });

  it("likes the front of a shelf and a poster with a picture", () => {
    const wide: Candidate[] = [
      { id: "front", title: "Front", rows: ["Comedy"], index: 0, image: "x.jpg" },
      ...Array.from({ length: 30 }, (_, i): Candidate => ({ id: `back${i}`, title: `Back ${i}`, rows: ["Comedy"], index: 25 + i })),
    ];
    let front = 0;
    for (let seed = 1; seed <= 400; seed++) if (pick(wide, "funny" as Mood, new Set(), createRng(seed))?.id === "front") front++;
    expect(front).toBeGreaterThan(400 / 31 + 40); // (far more often than a fair draw among thirty-one would give it)
  });
});

describe("the cat's stylesheet", () => {
  const css = readFileSync(new URL("./cat.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const TOO_NEW: [RegExp, string][] = [
    [/@layer\b/, "@layer"],
    [/@container\b/, "@container"],
    [/@property\b/, "@property"],
    [/color-mix\(/, "color-mix()"],
    [/\b(?:oklch|oklab|lch|lab)\(/, "oklch() and the like"],
    [/light-dark\(/, "light-dark()"],
    [/\d(?:dvh|svh|lvh|dvw|svw|lvw)\b/, "dvh/svh/lvh"],
    [/\bsubgrid\b/, "subgrid"],
    [/:has\(/, ":has()"],
    [/:where\(/, ":where()"],
    [/:is\(/, ":is()"],
    [/\btext-wrap\s*:/, "text-wrap"],
    [/\bcontainer-type\s*:/, "container-type"],
    [/\baspect-ratio\s*:/, "aspect-ratio"],
  ];

  it("keeps to what the oldest TV browsers understand", () => {
    expect(TOO_NEW.filter(([pattern]) => pattern.test(css)).map(([, label]) => label)).toEqual([]);
  });

  it("names its animations kino-cat-..., since keyframes are global", () => {
    const names = [...css.matchAll(/@keyframes\s+([^\s{]+)/g)].map((match) => match[1] ?? "");
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((one) => !one.startsWith("kino-cat-"))).toEqual([]);
  });

  it("does not turn on a page's own scroll or hide a page's own focus ring", () => {
    expect(css).not.toMatch(/overflow\s*:\s*(auto|scroll)/);
    expect(css).not.toMatch(/:focus\s*\{[^}]*outline\s*:\s*none[^}]*\}\s*$/m);
  });
});
