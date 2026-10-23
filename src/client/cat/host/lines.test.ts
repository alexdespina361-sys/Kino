import { describe, expect, it } from "vitest";
import { computeLedges } from "../engine/ledges";
import type { Rect, World } from "../types";
import { lies, LINE_GAP, mergeLines, MOST_PLACES, placesInFront, placesOnTop, SHELF_WIDE, SLAB_THICK, zoneOf, type Line, type Piece, type Slab } from "./lines";

/** A 1280x720 screen: its body is 74 pixels long and the TV's em is 12.8 pixels. */
const L = 74;
const EM = 12.8;
const screen: Rect = { x: 0, y: 0, w: 1280, h: 720 };

let counter = 0;
const piece = (x: number, y: number, w: number, h: number, over: Partial<Piece> = {}): Piece => ({ rect: { x, y, w, h }, rides: false, words: true, name: `p${++counter}`, order: counter, ...over });

describe("the words of a page put into lines", () => {
  it("makes one line of the pieces that are side by side at one height and near each other, and not of those that are far apart or on another line", () => {
    const pieces = [piece(100, 300, 60, 20), piece(168, 300, 80, 20), piece(256, 301, 40, 19), piece(600, 300, 90, 20), piece(100, 330, 120, 20)];
    const lines = mergeLines(pieces, LINE_GAP * L);
    const boxes = lines.map((line) => line.rect).sort((a, b) => a.y - b.y || a.x - b.x);
    expect(boxes).toEqual([
      { x: 100, y: 300, w: 196, h: 20 },
      { x: 600, y: 300, w: 90, h: 20 },
      { x: 100, y: 330, w: 120, h: 20 },
    ]);
  });

  it("keeps the words of the scroller apart from the words that stay where they are, and words apart from a box", () => {
    const lines = mergeLines([piece(100, 300, 60, 20, { rides: true }), piece(168, 300, 60, 20), piece(236, 300, 60, 20, { words: false })], LINE_GAP * L);
    expect(lines).toHaveLength(3);
  });

  it("makes no line of two boxes that are side by side: each button is its own, and the space above the lower of two is not theirs", () => {
    const buttons = mergeLines([piece(100, 300, 120, 40, { words: false }), piece(228, 296, 120, 60, { words: false })], LINE_GAP * L);
    expect(buttons.map((line) => line.rect).sort((a, b) => a.x - b.x)).toEqual([
      { x: 100, y: 300, w: 120, h: 40 },
      { x: 228, y: 296, w: 120, h: 60 },
    ]);
  });

  it("is named by the first of its pieces in the page's order, whatever order they are found in", () => {
    const first = piece(100, 300, 60, 20, { name: "first", order: 1 });
    const second = piece(168, 300, 60, 20, { name: "second", order: 2 });
    expect(mergeLines([second, first], LINE_GAP * L)[0]!.name).toBe("first");
    expect(mergeLines([first, second], LINE_GAP * L)[0]!.name).toBe("first");
  });

  it("is the same lines whatever order the pieces come in", () => {
    const pieces = [piece(100, 300, 60, 20), piece(168, 300, 80, 20), piece(600, 300, 90, 20), piece(100, 330, 120, 20), piece(256, 330, 50, 20)];
    const key = (lines: Line[]) => lines.map((line) => `${line.rect.x},${line.rect.y},${line.rect.w},${line.rect.h}`).sort();
    expect(key(mergeLines([...pieces].reverse(), LINE_GAP * L))).toEqual(key(mergeLines(pieces, LINE_GAP * L)));
  });
});

describe("what the cat keeps out of for a line", () => {
  const line = (rect: Rect, words = true): Line => ({ rect, rides: false, words, name: "x", order: 0 });

  it("is the ink of the words, a little wider than they are: not the leading above and below them", () => {
    const zone = zoneOf(line({ x: 100, y: 300, w: 200, h: 20 }), EM);
    expect(zone.x).toBeLessThan(100);
    expect(zone.x + zone.w).toBeGreaterThan(300);
    expect(zone.y).toBeGreaterThan(300);
    expect(zone.y + zone.h).toBeLessThan(320);
    expect(zone.h).toBeGreaterThan(14);
  });

  it("is the whole of a button, and a little more", () => {
    const zone = zoneOf(line({ x: 100, y: 300, w: 200, h: 40 }, false), EM);
    expect(zone).toEqual({ x: 100 - 0.15 * EM, y: 300 - 0.15 * EM, w: 200 + 0.3 * EM, h: 40 + 0.3 * EM });
  });

  it("knows a zone that lies in another", () => {
    const outer: Rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(lies({ x: 10, y: 10, w: 20, h: 20 }, outer)).toBe(true);
    expect(lies({ x: 90, y: 10, w: 20, h: 20 }, outer)).toBe(false);
    expect(lies(outer, outer)).toBe(true);
  });
});

/** The captions of a grid of cards, as a 1280x720 screen draws them: each card 193 wide at a pitch of 212, a picture 107 tall, then its name (one line) and its year. */
const captions = (lines: number, over: { x0?: number; y0?: number; cards?: number } = {}): Line[] => {
  const out: Piece[] = [];
  const names = [150, 165, 120, 168, 134];
  for (let row = 0; row < lines; row++) {
    for (let col = 0; col < (over.cards ?? 5); col++) {
      const x = (over.x0 ?? 90) + 212 * col;
      const y = (over.y0 ?? 187) + 177 * row + 107 + 4;
      out.push(piece(x, y, names[col % names.length]!, 21, { rides: true }));
      out.push(piece(x, y + 25, 40, 21, { rides: true }));
    }
  }
  return mergeLines(out, LINE_GAP * L);
};

describe("the places in front of the words of a grid of cards", () => {
  it("is one line along the foot of the pictures of each line of cards, in front of the pictures and above the names, and none for the years under the names", () => {
    const lines = captions(3);
    const places = placesInFront(lines, L, screen);
    expect(places).toHaveLength(3);
    for (const [row, place] of places.sort((a, b) => a.y - b.y).entries()) {
      const nameTop = 187 + 177 * row + 107 + 4;
      // (feet above the first line of the name, clear of it, and not further than a hand's breadth)
      expect(place.y).toBeLessThan(nameTop);
      expect(place.y).toBeGreaterThan(nameTop - 8);
      expect(place.kind).toBe("shelfTop");
      // (all of the line of cards, to the end of the last name: a gap between two names is one the cat walks over)
      expect(place.x0).toBeLessThan(90);
      expect(place.x1).toBeGreaterThan(90 + 212 * 4 + 130);
    }
    expect(new Set(places.map((place) => place.id)).size).toBe(places.length);
  });

  it("is a place for the cat to stand: a ledge of its own, where the line above has its names too (which the cat would cover from the top of the cards)", () => {
    const lines = captions(2);
    const places = placesInFront(lines, L, screen);
    // (every line of words is a zone, as the page reader makes them)
    const keepOut = lines.map((line) => zoneOf(line, EM));
    const world = (surfaces: World["surfaces"]): World => ({ viewport: screen, bodyLength: L, surfaces, keepOut, targets: [], mode: "browse", player: "none", controlsUp: false, quiet: false, reducedMotion: false });
    // the line along the tops of the second line of cards is cut to nothing by the names of the first line (the cat's head is in them)...
    const tops = { id: "top", kind: "shelfTop" as const, y: 187 + 177, x0: 90, x1: 1130, weight: 1 };
    expect(computeLedges(world([tops]))).toEqual([]);
    // ...and the places in front of the words are long ledges along the lines of cards
    const ledges = computeLedges(world(places));
    expect(ledges.length).toBeGreaterThanOrEqual(2);
    for (const ledge of ledges) expect(ledge.x1 - ledge.x0).toBeGreaterThan(4 * L);
  });

  it("is a place with the words below the cat's feet and none above its head: it covers none of them", () => {
    const lines = captions(3);
    const places = placesInFront(lines, L, screen);
    const keepOut = lines.map((line) => zoneOf(line, EM));
    const world: World = { viewport: screen, bodyLength: L, surfaces: places, keepOut, targets: [], mode: "browse", player: "none", controlsUp: false, quiet: false, reducedMotion: false };
    for (const ledge of computeLedges(world)) {
      // (the ends of the ledge, and the middle of it: the cat's feet at its line, its body above)
      for (const x of [ledge.x0, (ledge.x0 + ledge.x1) / 2, ledge.x1]) {
        const body: Rect = { x: x - 0.6 * L, y: ledge.y - 0.85 * L, w: 0.9 * L, h: 0.85 * L };
        expect(keepOut.filter((zone) => zone.x < body.x + body.w && zone.x + zone.w > body.x && zone.y < body.y + body.h && zone.y + zone.h > body.y)).toEqual([]);
      }
    }
  });

  it("is none for the second line of a paragraph, for a few words, or for a line above the screen", () => {
    const paragraph = mergeLines([piece(100, 300, 500, 21), piece(100, 324, 480, 21), piece(100, 348, 300, 21)], LINE_GAP * L);
    expect(placesInFront(paragraph, L, screen)).toHaveLength(1);
    expect(placesInFront(paragraph, L, screen)[0]!.y).toBeLessThan(300);
    const few = mergeLines([piece(100, 300, SHELF_WIDE * L - 10, 21)], LINE_GAP * L);
    expect(placesInFront(few, L, screen)).toEqual([]);
    const above = mergeLines([piece(100, -40, 500, 21)], LINE_GAP * L);
    expect(placesInFront(above, L, screen)).toEqual([]);
  });

  it("goes with the scroller when the words do, and stays where it is when they stay", () => {
    const riding = mergeLines([piece(100, 300, 500, 21, { rides: true })], LINE_GAP * L);
    const fixed = mergeLines([piece(100, 300, 500, 21)], LINE_GAP * L);
    expect(placesInFront(riding, L, screen)[0]!.kind).toBe("shelfTop");
    expect(placesInFront(fixed, L, screen)[0]!.kind).toBe("heroLedge");
  });

  it("is named for the words and not for where they are on the screen, so a grid that is scrolled keeps its places", () => {
    const lines = captions(2);
    const scrolled = lines.map((line) => ({ ...line, rect: { ...line.rect, y: line.rect.y - 40 } }));
    const ids = (some: Line[]) => placesInFront(some, L, screen).map((place) => place.id).sort();
    expect(ids(lines)).toHaveLength(2);
    expect(ids(scrolled)).toEqual(ids(lines));
  });

  it("is no more places than a page needs, the widest first", () => {
    // (three columns of short lines, far enough apart to be three places in a row, and fifteen rows of them)
    const many = mergeLines(
      Array.from({ length: 45 }, (_, i) => piece(100 + (i % 3) * 400, 10 + Math.floor(i / 3) * 46, 200 + (i % 3) * 20, 8)),
      LINE_GAP * L,
    );
    const places = placesInFront(many, L, screen);
    expect(places).toHaveLength(MOST_PLACES);
    // (the third column's lines are the widest, and the second's: all thirty of them are kept, and six of the first's)
    expect(places.filter((place) => place.x1 - place.x0 > 200 + 0.4 * L + 5)).toHaveLength(30);
  });
});

let slabs = 0;
const slab = (x: number, y: number, w: number, h: number, over: Partial<Slab> = {}): Slab => ({ rect: { x, y, w, h }, rides: false, name: `s${++slabs}`, order: slabs, ...over });

describe("the places on top of the boxes a page draws", () => {
  it("is the line along the top of every box wide enough to stand on, from one end of it to the other", () => {
    const places = placesOnTop([slab(100, 200, 600, 120), slab(100, 340, 600, 120)], L, screen);
    expect(places.map((place) => [place.x0, place.x1, place.y]).sort((a, b) => a[2]! - b[2]!)).toEqual([
      [100, 700, 200],
      [100, 700, 340],
    ]);
  });

  it("is none for a box too narrow for a cat, or too thin to be anything but a line, or whose top is off the screen", () => {
    const narrow = slab(100, 200, SHELF_WIDE * L - 2, 120);
    const thin = slab(100, 300, 600, SLAB_THICK * L - 1);
    const above = slab(100, -60, 600, 120);
    const below = slab(100, screen.h + 20, 600, 120);
    expect(placesOnTop([narrow, thin, above, below], L, screen)).toEqual([]);
  });

  it("is one place for a card and for the first row in it, where their tops are level and the row lies in the card", () => {
    const card = slab(100, 200, 600, 300, { name: "card" });
    const row = slab(110, 201, 580, 60, { name: "row" });
    const next = slab(110, 270, 580, 60, { name: "next" });
    const places = placesOnTop([row, next, card], L, screen);
    expect(places.map((place) => [place.id, place.y]).sort()).toEqual([
      ["box:card", 200],
      ["box:next", 270],
    ]);
  });

  it("goes with the scroller when the box does, and stays where it is when it stays", () => {
    const places = placesOnTop([slab(100, 200, 600, 120, { rides: true, name: "on" }), slab(100, 400, 600, 120, { name: "off" })], L, screen);
    expect(places.find((place) => place.id === "box:on")!.kind).toBe("shelfTop");
    expect(places.find((place) => place.id === "box:off")!.kind).toBe("heroLedge");
  });

  it("is named for the box and not for where it is on the screen, and a name two boxes have is told apart, in the same way every time", () => {
    const twins = [slab(100, 200, 600, 120, { name: "row", order: 1 }), slab(100, 340, 600, 120, { name: "row", order: 2 })];
    const first = placesOnTop(twins, L, screen).map((place) => place.id);
    expect(new Set(first).size).toBe(2);
    expect(placesOnTop([...twins].reverse(), L, screen).map((place) => place.id)).toEqual(first);
    const scrolled = twins.map((one) => ({ ...one, rect: { ...one.rect, y: one.rect.y - 40 } }));
    expect(placesOnTop(scrolled, L, screen).map((place) => place.id)).toEqual(first);
  });

  it("is no more places than a page needs, the widest first", () => {
    const many = Array.from({ length: 60 }, (_, i) => slab(10, 5 + i * 11, 300 + i * 10, 40));
    const places = placesOnTop(many, L, screen);
    expect(places).toHaveLength(MOST_PLACES);
    // (the sixty boxes are of ever greater width: the last ones are kept)
    expect(Math.min(...places.map((place) => place.x1 - place.x0))).toBeGreaterThanOrEqual(300 + 24 * 10);
  });
});
