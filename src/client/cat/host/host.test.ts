import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shapeHits } from "../engine/shape";
import { createRng } from "../rng";
import type { Rect } from "../types";
import { fits, MOODS, pick, reasonFor, type Candidate, type Mood } from "./assistant";
import { Governor, Revival } from "./governor";
import { DWELL_MS, Hand, handFits, REPEAT_MS } from "./hand";
import { perchesFor, widestGap } from "./perch";

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

  it("has no box to be put on a cat that hauls itself up over a lip, or goes up the face of a card to one, and has one on a cat that does anything else", () => {
    expect(handFits("climb")).toBe(false);
    expect(handFits("scale")).toBe(false);
    for (const clip of ["stand", "walk", "run", "sit", "loaf", "curl", "jump", "peek", "groom"] as const) expect(handFits(clip), clip).toBe(true);
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
    run(governor, 500, 0.4);
    expect(governor.quality).toBe("full");
  });

  it("gives it back to a cat that is comfortably inside its budget, not only to one that is nearly free; not to one that is only just inside", () => {
    const comfortable = new Governor({ budget: 2 });
    run(comfortable, 200, 3);
    expect(comfortable.quality).toBe("low");
    run(comfortable, 900, 1.3); // (0.65 of the budget)
    expect(comfortable.quality).toBe("full");
    const close = new Governor({ budget: 2 });
    run(close, 200, 3);
    run(close, 3000, 1.7); // (0.85 of it)
    expect(close.quality).toBe("low");
  });

  it("does not count a frame the screen waited for (the tab was in the background)", () => {
    const governor = new Governor({ budget: 2 });
    run(governor, 400, 50, 1500);
    expect(governor.quality).toBe("full");
  });
});

describe("a card that takes the detailed cat's picture away", () => {
  it("is given the cat again at once, the first time and every time that is not too soon or too often", () => {
    const revival = new Revival();
    expect(revival.ask(5_000)).toBe("now");
    expect(revival.ask(7_000)).toBe("now"); // (a page that was in the background twice: it was a while)
    expect(revival.ask(20_000)).toBe("now");
  });

  it("is asked to wait when the last try was a moment ago, and the wait does not use up a try", () => {
    const revival = new Revival();
    expect(revival.ask(10_000)).toBe("now");
    // (every frame that finds the picture gone asks, sixty times a second)
    for (let at = 10_016; at < 11_000; at += 16) expect(revival.ask(at)).toBe("wait");
    expect(revival.ask(11_000)).toBe("now");
    expect(revival.ask(12_000)).toBe("now");
    expect(revival.ask(13_000)).toBe("never"); // (three tries in the minute: the waits above were not counted as more)
  });

  it("is given up on when it does it again and again, whether the new picture came or the try failed", () => {
    const revival = new Revival();
    expect(revival.ask(0)).toBe("now");
    expect(revival.ask(2_000)).toBe("now");
    expect(revival.ask(4_000)).toBe("now");
    expect(revival.ask(6_000)).toBe("never");
    expect(revival.ask(6_016)).toBe("never"); // (the answer does not change by asking again)
    expect(revival.ask(59_000)).toBe("never");
  });

  it("is given the cat again once the minute has passed, one try at a time as the old ones fall out of it", () => {
    const revival = new Revival();
    for (const at of [0, 2_000, 4_000]) expect(revival.ask(at)).toBe("now");
    expect(revival.ask(59_999)).toBe("never");
    expect(revival.ask(60_000)).toBe("now"); // (the try at 0 is a minute old)
    expect(revival.ask(61_000)).toBe("never"); // (the tries at 2 000, 4 000 and 60 000 are in the minute)
    expect(revival.ask(62_000)).toBe("now"); // (the try at 2 000 is a minute old)
    expect(revival.ask(62_500)).toBe("never");
    expect(revival.ask(64_000)).toBe("now"); // (the try at 4 000 is a minute old)
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

  it("likes a title the library chose for the viewer, and gives the reason in the library's own words", () => {
    const among: Candidate[] = [
      { id: "mine", title: "Mine", rows: ["Comedy"], index: 5, image: "x.jpg", because: "Because you watched Up" },
      ...Array.from({ length: 29 }, (_, i): Candidate => ({ id: `other${i}`, title: `Other ${i}`, rows: ["Comedy"], index: 5, image: "y.jpg" })),
    ];
    let mine = 0;
    for (let seed = 1; seed <= 600; seed++) if (pick(among, "funny" as Mood, new Set(), createRng(seed))?.id === "mine") mine++;
    expect(mine).toBeGreaterThan(600 / 30 + 15); // (a fair draw among thirty gives it twenty; two and a half times the weight gives about forty-eight)
    // for "anything" the row about the viewer is the reason; for a mood it is the shelf of that kind
    expect(reasonFor(among[0]!, "any")).toBe("Because you watched Up");
    expect(reasonFor(among[0]!, "funny")).toBe("Comedy");
    expect(reasonFor(among[1]!, "any")).toBe("Comedy");
    // a title that is only on a row about the viewer has no shelf of a kind, and is found for "anything" and for nothing else
    const only: Candidate = { id: "only", title: "Only", rows: [], index: 0, because: "Because you loved Up" };
    expect(reasonFor(only, "any")).toBe("Because you loved Up");
    expect(pick([only], "any", new Set(), createRng(1))?.id).toBe("only");
    expect(pick([only], "funny", new Set(), createRng(1))).toBeNull();
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

describe("the cat's place in a film", () => {
  // the controls' row of a 1280x720 screen: a group of buttons at each end of it
  const left: Rect = { x: 40, y: 640, w: 165, h: 52 };
  const right: Rect = { x: 705, y: 645, w: 505, h: 42 };
  const L = 100;

  it("rests between the two groups of the controls' row, where no button is, whatever way it lies and faces", () => {
    const perches = perchesFor([left, right], 1280, 720, L);
    expect(perches.map((one) => one.id)).toEqual(["perch-gap"]);
    const perch = perches[0]!;
    expect(perch.kind).toBe("playerPerch");
    expect(perch.y).toBeGreaterThan(690);
    expect(perch.x1 - perch.x0).toBeGreaterThan(0.3 * L);
    // every posture it takes in a film, at either end of its place, facing either way: tail, nose and all, it touches neither group
    for (const clip of ["loaf", "curl", "sit", "knead", "stretch"] as const) {
      for (const x of [perch.x0, perch.x1]) {
        for (const facing of [1, -1] as const) {
          for (const group of [left, right]) expect(shapeHits(clip, facing, x, perch.y, L, group), `${clip} at ${Math.round(x)} facing ${facing}`).toBe(false);
        }
      }
    }
  });

  it("is in a corner of the picture where the row has no such place: not drawn yet, too narrow, or wrapped", () => {
    const corners = (groups: Rect[]) => perchesFor(groups, 1280, 720, L).map((one) => one.id);
    expect(corners([])).toEqual(["perch-right", "perch-left"]);
    expect(corners([left])).toEqual(["perch-right", "perch-left"]);
    // (a gap that the cat would not fit in, with its tail)
    expect(corners([left, { ...right, x: left.x + left.w + 160 }])).toEqual(["perch-right", "perch-left"]);
    // (a row that has wrapped: its second group is on a line of its own)
    expect(corners([left, { ...right, y: 700 }])).toEqual(["perch-right", "perch-left"]);
    // (and a corner is on the right side of the right one)
    const [one, two] = perchesFor([], 1280, 720, L);
    expect(one!.x0).toBeGreaterThan(640);
    expect(two!.x1).toBeLessThan(640);
  });

  it("sits on the line where the bars begin when it is told where that is: over no button of theirs, which a corner at the foot of the screen would be", () => {
    // (a phone held upright: 390x844, the bars' lowest block, the film's bar and then the row of buttons under it, begins at 778 and a body is 52 long)
    const small = 52;
    const [right, leftOne] = perchesFor([], 390, 844, small, 778);
    expect(right!.id).toBe("perch-right");
    expect(leftOne!.id).toBe("perch-left");
    expect(right!.y).toBeCloseTo(778 - 0.08 * small, 5);
    expect(leftOne!.y).toBe(right!.y);
    // (above the foot, which is where it was before it was told, and where the bars' buttons are)
    expect(right!.y).toBeLessThan(perchesFor([], 390, 844, small)[0]!.y);
    // the corners themselves are where they were
    expect(right!.x0).toBe(perchesFor([], 390, 844, small)[0]!.x0);
    expect(leftOne!.x1).toBe(perchesFor([], 390, 844, small)[1]!.x1);
  });

  it("keeps a corner in the lower half of the screen and above the foot, whatever the bars say", () => {
    const foot = perchesFor([], 1280, 720, L)[0]!.y;
    // (bars that begin high up the screen, or a number that is nonsense)
    expect(perchesFor([], 1280, 720, L, 100)[0]!.y).toBe(0.5 * 720);
    expect(perchesFor([], 1280, 720, L, 5000)[0]!.y).toBe(foot);
    expect(perchesFor([], 1280, 720, L, Number.NaN)[0]!.y).toBe(foot);
    expect(perchesFor([], 1280, 720, L, Number.POSITIVE_INFINITY)[0]!.y).toBe(foot);
  });

  it("is where the row has a place for it all the same, whatever the bars say", () => {
    const [only, ...others] = perchesFor([left, right], 1280, 720, L, 600);
    expect(others).toEqual([]);
    expect(only).toEqual(perchesFor([left, right], 1280, 720, L)[0]);
  });

  it("takes the widest of the gaps", () => {
    const a: Rect = { x: 0, y: 0, w: 100, h: 40 };
    const b: Rect = { x: 160, y: 0, w: 100, h: 40 };
    const c: Rect = { x: 560, y: 0, w: 100, h: 40 };
    expect(widestGap([c, a, b])).toEqual([260, 560]);
    expect(widestGap([a])).toBeNull();
    expect(widestGap([])).toBeNull();
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
