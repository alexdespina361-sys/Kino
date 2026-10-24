import type { Rect } from "../types";
import { nameOf } from "./dom";
import { SHELF_WIDE, SLAB_THICK, type Piece, type Slab } from "./lines";

/**
 * What a page says and what can be pressed on it, found in the page itself and not by the names of its parts: every line of text that is drawn, and every button, link, switch and
 * field. A page reader that listed the parts it knew (the heading of a row, the caption of a card) kept missing the ones it did not (the words on a category's card, a setting's
 * label); this reads what is there. And what a page draws as boxes (a card, a panel, a row), whose tops are places to stand. It only reads.
 */

export interface Reach {
  /** Where the page is drawn, with some to spare: what is drawn outside it is not read. */
  screen: Rect;
  /** What scrolls on the page (the rows, a grid of cards, a long page), for what is on it to be told from what stays where it is. */
  scroller: HTMLElement | null;
  /** What is not the page's: the cat's own layer, and its panel. */
  skip: (element: Element) => boolean;
  /**
   * The words of the cards are not read (their names are kept as words the cat would rather not settle in front of, not as places it keeps out of): the rows of the
   * library, where the cat stands on the tops of the cards and the rows are as close as the names under one row to the top of the next.
   */
  quietCards: boolean;
  /**
   * Pictures that say something (a code to scan, a person's face) are read as boxes to keep out of, when they are at least this big (pixels) both ways; the pictures of cards are
   * posters, which the cat is in front of. 0 reads none.
   */
  picture?: number;
  /** At most this many pieces: a page that has more than a screen can hold is not read past it. */
  limit: number;
}

/** What has no words of its own that are read, or is not drawn as words. */
const NOT_WORDS = new Set(["script", "style", "svg", "canvas", "video", "audio", "img", "iframe", "noscript", "template", "option", "input", "textarea", "select", "head"]);
const PICTURES = new Set(["svg", "canvas", "img"]);
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "summary"]);
const CONTROL_ROLES = new Set(["button", "switch", "checkbox", "radio", "tab", "slider", "menuitem", "option", "link", "textbox", "combobox", "spinbutton"]);

type Visible = { checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean };
/** Whether an element is drawn at all (not `visibility: hidden`, not see-through), where the browser can say; a browser that cannot says yes. */
const drawn = (element: Element): boolean => {
  const ask = (element as Element & Visible).checkVisibility;
  return typeof ask !== "function" || ask.call(element, { checkOpacity: true, checkVisibilityCSS: true });
};

const isControl = (element: Element): boolean => {
  const tag = element.localName;
  if (CONTROL_TAGS.has(tag)) return !(tag === "input" && (element as HTMLInputElement).type === "hidden");
  if (tag === "a") return element.hasAttribute("href");
  const role = element.getAttribute("role");
  return role !== null && CONTROL_ROLES.has(role);
};

const meets = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const clipTo = (rect: Rect, box: Rect): Rect | null => {
  const x = Math.max(rect.x, box.x);
  const y = Math.max(rect.y, box.y);
  const w = Math.min(rect.x + rect.w, box.x + box.w) - x;
  const h = Math.min(rect.y + rect.h, box.y + box.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};

/**
 * The part of the page an element shows of what it holds: the box itself when it scrolls or hides what does not fit (a list with a height of its own, a name cut short with
 * dots), else what the box that holds it shows. Only a box that has more than it shows is asked: reading the sizes costs nothing, and its style does.
 */
const showing = (element: Element, within: Rect | null): Rect | null | "none" => {
  if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) {
    const style = getComputedStyle(element);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const box = element.getBoundingClientRect();
      const mine: Rect = { x: box.left, y: box.top, w: box.width, h: box.height };
      if (!within) return mine;
      return clipTo(mine, within) ?? "none";
    }
  }
  return within;
};

/** Every line of words and every control of what `root` holds, in the order the page has them, where they are drawn now. */
export function readPieces(root: Element, reach: Reach): Piece[] {
  const out: Piece[] = [];
  const range = document.createRange();
  const { screen, scroller } = reach;
  const bigW = 0.7 * screen.w;
  const bigH = 0.5 * screen.h;
  let order = 0;

  const rides = (node: Node): boolean => scroller !== null && scroller.contains(node);

  const words = (node: Text, clip: Rect | null): void => {
    const parent = node.parentElement;
    if (!parent || !drawn(parent)) return;
    range.selectNodeContents(node);
    const lines = range.getClientRects();
    const onScroller = rides(node);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // (a space between two words, or a letter's width: not a line)
      if (line.width < 3 || line.height < 5) continue;
      let rect: Rect | null = { x: line.left, y: line.top, w: line.width, h: line.height };
      if (!meets(rect, screen)) continue;
      if (clip) rect = clipTo(rect, clip);
      if (!rect || rect.h < 5) continue;
      out.push({ rect, rides: onScroller, words: true, name: `${nameOf(parent, "w")}.${i}`, order: order++ });
    }
  };

  /** A box that is kept out of whole: a button, a field, a picture that says something. `big` is the least it has to be to count (a button of the page, not a page-sized backdrop). */
  const box = (element: Element, clip: Rect | null, kind: string): void => {
    if (!drawn(element)) return;
    const found = element.getBoundingClientRect();
    if (found.width < 3 || found.height < 3 || found.width > bigW || found.height > bigH) return;
    let rect: Rect | null = { x: found.left, y: found.top, w: found.width, h: found.height };
    if (!meets(rect, screen)) return;
    if (clip) rect = clipTo(rect, clip);
    if (!rect) return;
    out.push({ rect, rides: rides(element), words: false, name: nameOf(element, kind), order: order++ });
  };

  const walk = (parent: Node, inTile: boolean, clip: Rect | null): void => {
    for (let node = parent.firstChild; node && out.length < reach.limit; node = node.nextSibling) {
      if (node.nodeType === 3) {
        if (/\S/.test(node.nodeValue ?? "")) words(node as Text, clip);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (reach.skip(element)) continue;
      const tag = element.localName;
      const tile = element.classList.contains("tv-tile");
      if (tile && reach.quietCards) continue;
      // (what a card shows and does not say to a reader of the page, the letter that stands for a title without a picture, the rank behind a poster, is art: a place to be in front of)
      if (inTile && element.getAttribute("aria-hidden") === "true") continue;
      // (a page has hundreds of cards and a screen shows a few: the ones that are off it are passed over whole)
      if (tile || element.classList.contains("tv-row")) {
        const found = element.getBoundingClientRect();
        if (found.width === 0 || !meets({ x: found.left, y: found.top, w: found.width, h: found.height }, screen)) continue;
      }
      if (!tile && NOT_WORDS.has(tag)) {
        // (a field's words are its own; the box is what is read of it)
        if (!inTile && isControl(element)) box(element, clip, "c");
        // (a picture that is not a poster: what is drawn in it is what the page has to say, a code to scan, a face)
        else if (!inTile && reach.picture && PICTURES.has(tag)) {
          const found = element.getBoundingClientRect();
          if (Math.min(found.width, found.height) >= reach.picture) box(element, clip, "m");
        }
        continue;
      }
      // (a card is a place to be on, and what is pressed of it is the card: its words are read, and it is not a button the cat keeps out of)
      if (!tile && !inTile && isControl(element)) box(element, clip, "c");
      const inner = showing(element, clip);
      if (inner === "none") continue;
      walk(element, inTile || tile, inner);
    }
  };
  walk(root, false, null);
  return out;
}

/* ------------------------------ the boxes a page draws ------------------------------ */

export interface SlabReach {
  /** Where the page is drawn, with some to spare, and the screen itself. */
  screen: Rect;
  view: Rect;
  scroller: HTMLElement | null;
  /** The cat's own layer and card: what is in them is not the page's. */
  own: Element | null;
  /** The cat's body length (pixels): what a box has to be to be worth standing on is a measure of it. */
  L: number;
  limit: number;
}

/** How much of a colour is seen (0 to 1), as a browser says a style's colour. */
const seen = (colour: string): number => {
  if (colour === "transparent") return 0;
  const slash = colour.lastIndexOf("/");
  if (slash >= 0) {
    const alpha = parseFloat(colour.slice(slash + 1));
    return Number.isFinite(alpha) ? (colour.slice(slash + 1).includes("%") ? alpha / 100 : alpha) : 1;
  }
  if (colour.startsWith("rgba(")) {
    const alpha = parseFloat(colour.slice(colour.lastIndexOf(",") + 1));
    return Number.isFinite(alpha) ? alpha : 1;
  }
  return 1;
};

/** Whether a box draws something of its own: a colour (a card, a panel, a button), a picture or a gradient, or an edge. */
const painted = (style: CSSStyleDeclaration): boolean => {
  if (seen(style.backgroundColor) >= 0.04) return true;
  if (style.backgroundImage !== "none") return true;
  const edge = style.borderTopStyle;
  return parseFloat(style.borderTopWidth) > 0 && edge !== "none" && edge !== "hidden" && seen(style.borderTopColor) >= 0.1;
};

/**
 * Every box the page draws that is wide and tall enough to stand on, as drawn: what has a colour of its own, a picture or an edge, and whose top is in sight (not hidden under
 * another box or cut off by the list it is in: the top edge is asked what it is, at its middle). The page's own backdrop, which is as big as the page, is none.
 */
export function readSlabs(root: Element, reach: SlabReach): Slab[] {
  const out: Slab[] = [];
  const minW = SHELF_WIDE * reach.L;
  const minH = SLAB_THICK * reach.L;
  let order = 0;
  for (const element of root.querySelectorAll("*")) {
    if (out.length >= reach.limit) break;
    order++;
    if (!(element instanceof HTMLElement) || NOT_WORDS.has(element.localName)) continue;
    if (element.offsetWidth < minW || element.offsetHeight < minH) continue;
    if (reach.own?.contains(element)) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || !painted(style) || !drawn(element)) continue;
    const found = element.getBoundingClientRect();
    if (found.width >= 0.8 * reach.view.w && found.height >= 0.8 * reach.view.h) continue;
    const rect: Rect = { x: found.left, y: found.top, w: found.width, h: found.height };
    if (rect.y < reach.view.y || rect.y > reach.view.y + reach.view.h || !meets(rect, reach.screen)) continue;
    // (its top edge is in sight: what is there, at its middle, is the box or something in it, and not another box over it, or nothing of it because a list cuts it off)
    const there = document.elementFromPoint(rect.x + rect.w / 2, Math.min(reach.view.y + reach.view.h - 1, rect.y + 2));
    if (!there || !element.contains(there)) continue;
    out.push({ rect, rides: reach.scroller !== null && reach.scroller.contains(element), name: nameOf(element, "b"), order });
  }
  return out;
}
