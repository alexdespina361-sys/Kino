import { FOOT_SLACK } from "../engine/shape";
import type { Rect, Surface } from "../types";

/**
 * What the page says in words, and what can be pressed, as the cat keeps clear of it. The page reader finds the pieces (a line of a heading, a caption under a card, the
 * label of a switch, a button: each a rectangle as it is drawn); here they are put together into the lines and the boxes that the cat's ledges are cut by, and the places in
 * front of the words are found where a page has no free shelf of its own (a grid of cards whose names are under them). Pure numbers, no page: a hundred pages can be tried in a test.
 */

export interface Piece {
  /** Where it is drawn. */
  rect: Rect;
  /** It is on the page's scroller, and goes where the scroller goes (see `carry.ts`). */
  rides: boolean;
  /** Words (a line of text), which has an ink to it and a top to stand on, or something to keep out of as a whole (a button, a card's corner). */
  words: boolean;
  /** A name that stays the piece's for as long as what it is a piece of lives, and where it comes in the page's order: the line made of it has them. */
  name: string;
  order: number;
}

export interface Line {
  rect: Rect;
  rides: boolean;
  words: boolean;
  name: string;
  order: number;
}

/** How far apart two pieces of one line may be (body lengths) and still be one: the gap between two captions, the space between a word and the next. */
export const LINE_GAP = 0.6;

const sameHeight = (a: Rect, b: Rect): boolean => {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return bottom - top >= 0.5 * Math.min(a.h, b.h);
};

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * The pieces of a page put into lines: the words that are side by side, at one height, and no further apart than `gap` (pixels), are one line (the words of a sentence, the names
 * under a row of cards). Words that ride the scroller are never one line with ones that do not. A box (a button, a picture) is a line of its own: two buttons side by side are not
 * one, and what is between them, and above the lower of them, is not theirs. A line is named by its first piece.
 */
export function mergeLines(pieces: readonly Piece[], gap: number): Line[] {
  const sorted = [...pieces].sort((a, b) => a.rect.x - b.rect.x);
  const lines: Line[] = [];
  for (const piece of sorted) {
    let joined = false;
    for (const line of lines) {
      if (!piece.words || line.rides !== piece.rides || !line.words || !sameHeight(line.rect, piece.rect)) continue;
      // (the pieces are taken from the left, so a piece is to the right of the line or over a part of it)
      if (piece.rect.x - (line.rect.x + line.rect.w) > gap) continue;
      line.rect = union(line.rect, piece.rect);
      if (piece.order < line.order) {
        line.order = piece.order;
        line.name = piece.name;
      }
      joined = true;
      break;
    }
    if (!joined) lines.push({ rect: { ...piece.rect }, rides: piece.rides, words: piece.words, name: piece.name, order: piece.order });
  }
  return lines;
}

/** The part of a line's box that the ink of its letters takes: the leading above and below it is not part of what is read. */
const INK_TOP = 0.08;
const INK_BOTTOM = 0.1;

/** What the cat keeps out of for a line: the words themselves (not their leading), a little wider than they are; a box is as it is, a little larger. */
export function zoneOf(line: Line, em: number): Rect {
  const r = line.rect;
  if (!line.words) return { x: r.x - 0.15 * em, y: r.y - 0.15 * em, w: r.w + 0.3 * em, h: r.h + 0.3 * em };
  const top = INK_TOP * r.h;
  const bottom = INK_BOTTOM * r.h;
  return { x: r.x - 0.1 * em, y: r.y + top, w: r.w + 0.2 * em, h: Math.max(1, r.h - top - bottom) };
}

/** Whether `inner` lies inside `outer` (to within a pixel). */
export const lies = (inner: Rect, outer: Rect): boolean => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

/** The least a run of words is wide, in body lengths, to be a place to stand in front of: a word or two is no shelf for a cat. */
export const SHELF_WIDE = 1.6;
/** A line whose top has words this near above it (body lengths) is not a place: the cat would be in front of them. */
const CROWDED = 0.5;
/** Lines of words whose tops are this near (pixels) are along one line, and are one place when no further apart than `RUN_GAP` body lengths (a gap a cat has no room in is none). */
const SAME_TOP = 3;
const RUN_GAP = 2;
/** At most this many of such places for a page. */
export const MOST_PLACES = 36;

/**
 * The places in front of the words of a page, for a page that has no shelf of its own where words are the only thing in the way: the line along the top of every line of words that
 * has nothing above it (the first line of a block of words: the names of a row of cards, the first line of a paragraph), the lines at one height being one place. The cat stands with
 * its feet just above the words, and in front of whatever is above them (the picture of a card: a poster is a place to be in front of; what it must keep clear of is what is read).
 * The ledges the page's words and buttons cut from them are the engine's (a place that has none left is none).
 *
 * A line on the page's scroller is a shelf of it (which the scroller carries), and one that is not is fixed to the screen.
 */
export function placesInFront(lines: readonly Line[], L: number, viewport: Rect): Surface[] {
  const words = lines.filter((line) => line.words);
  // (words just above, over most of the width: the first line of a block is the one with a clear top)
  const firsts = words.filter((line) => {
    const zone = line.rect;
    return !words.some((other) => {
      if (other === line) return false;
      const above = other.rect;
      if (above.y + above.h > zone.y + 0.5 * zone.h || zone.y - (above.y + above.h) > CROWDED * L) return false;
      const wide = Math.min(above.x + above.w, zone.x + zone.w) - Math.max(above.x, zone.x);
      return wide > 0.6 * Math.min(above.w, zone.w);
    });
  });
  firsts.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const runs: Array<{ line: Line; x0: number; x1: number; top: number; height: number }> = [];
  for (const line of firsts) {
    const run = runs.find((one) => one.line.rides === line.rides && Math.abs(one.top - line.rect.y) <= SAME_TOP && line.rect.x - one.x1 <= RUN_GAP * L);
    if (run) run.x1 = Math.max(run.x1, line.rect.x + line.rect.w);
    else runs.push({ line, x0: line.rect.x, x1: line.rect.x + line.rect.w, top: line.rect.y, height: line.rect.h });
  }
  const used = new Set<string>();
  const out: Array<Surface & { span: number }> = [];
  for (const run of runs) {
    if (run.x1 - run.x0 < SHELF_WIDE * L) continue;
    const y = run.top + INK_TOP * run.height - FOOT_SLACK - 0.5;
    if (y < viewport.y || y > viewport.y + viewport.h) continue;
    const base = `${run.line.rides ? "words" : "page"}:${run.line.name}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`;
    used.add(id);
    out.push({ id, kind: run.line.rides ? "shelfTop" : "heroLedge", y, x0: run.x0 - 0.2 * L, x1: run.x1 + 0.2 * L, weight: run.line.rides ? 0.6 : 0.5, span: run.x1 - run.x0 });
  }
  // (the widest first, when there are more than a page needs)
  out.sort((a, b) => b.span - a.span);
  return out.slice(0, MOST_PLACES).map(({ span: _span, ...surface }) => surface);
}

/* ------------------------------ the tops of the boxes a page draws ------------------------------ */

/** A box a page draws: a card, a panel, a row of a list, a button (it has a colour of its own, or an edge). */
export interface Slab {
  rect: Rect;
  /** It is on the page's scroller, and goes where the scroller goes (see `carry.ts`). */
  rides: boolean;
  /** A name that stays the box's for as long as it lives, and where it comes in the page's order. */
  name: string;
  order: number;
}

/** The least a box is tall to be a thing to stand on (body lengths): the hairline of a divider is not. */
export const SLAB_THICK = 0.3;
/** Tops this near (pixels) are one level. */
const SAME_LEVEL = 3;

/**
 * The places on top of the boxes a page draws, for a page that has no shelves of its own (the settings, a page of buttons, a title's page): the line along the top edge of every
 * box that is wide enough to stand on, and tall enough not to be a line. A box whose top is level with a wider one's that it lies in is the same place (a card and its first row).
 * The engine cuts them by the words and buttons above them as it does every place (a card with its heading right over it has a place only where the heading is not).
 */
export function placesOnTop(slabs: readonly Slab[], L: number, viewport: Rect): Surface[] {
  const wide = slabs
    .filter((slab) => slab.rect.w >= SHELF_WIDE * L && slab.rect.h >= SLAB_THICK * L && slab.rect.y >= viewport.y && slab.rect.y <= viewport.y + viewport.h)
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h || a.order - b.order);
  const kept: Slab[] = [];
  for (const slab of wide) {
    const inside = kept.some((other) => other.rides === slab.rides && Math.abs(other.rect.y - slab.rect.y) <= SAME_LEVEL && slab.rect.x >= other.rect.x - 1 && slab.rect.x + slab.rect.w <= other.rect.x + other.rect.w + 1);
    if (!inside) kept.push(slab);
  }
  const used = new Set<string>();
  const out: Array<Surface & { span: number }> = [];
  for (const slab of kept) {
    const base = `box:${slab.name}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`;
    used.add(id);
    out.push({ id, kind: slab.rides ? "shelfTop" : "heroLedge", y: slab.rect.y, x0: slab.rect.x, x1: slab.rect.x + slab.rect.w, weight: 0.7, span: slab.rect.w });
  }
  out.sort((a, b) => b.span - a.span || (a.id < b.id ? -1 : 1));
  return out.slice(0, MOST_PLACES).map(({ span: _span, ...surface }) => surface);
}
