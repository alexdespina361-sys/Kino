import type { Rect } from "../types";
import { nameOf } from "./dom";
import type { Piece } from "./lines";

/**
 * What a page says and what can be pressed on it, found in the page itself and not by the names of its parts: every line of text that is drawn, and every button, link, switch and
 * field. A page reader that listed the parts it knew (the heading of a row, the caption of a card) kept missing the ones it did not (the words on a category's card, a setting's
 * label); this reads what is there. It only reads.
 */

export interface Reach {
  /** Where the page is drawn, with some to spare: what is drawn outside it is not read. */
  screen: Rect;
  /** What scrolls on the page (the rows, a grid of cards), and the part of it in sight: words of it outside that are not drawn. */
  scroller: HTMLElement | null;
  scrollBox: Rect | null;
  /** What is not the page's: the cat's own layer, and its panel. */
  skip: (element: Element) => boolean;
  /**
   * The words of the cards are not read (their names are kept as words the cat would rather not settle in front of, not as places it keeps out of): the rows of the
   * library, where the cat stands on the tops of the cards and the rows are as close as the names under one row to the top of the next.
   */
  quietCards: boolean;
  /** At most this many pieces: a page that has more than a screen can hold is not read past it. */
  limit: number;
}

/** What has no words of its own that are read, or is not drawn as words. */
const NOT_WORDS = new Set(["script", "style", "svg", "canvas", "video", "audio", "img", "iframe", "noscript", "template", "option", "input", "textarea", "select", "head"]);
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

/** Every line of words and every control of what `root` holds, in the order the page has them, where they are drawn now. */
export function readPieces(root: Element, reach: Reach): Piece[] {
  const out: Piece[] = [];
  const range = document.createRange();
  const { screen, scroller, scrollBox } = reach;
  const bigW = 0.7 * screen.w;
  const bigH = 0.5 * screen.h;
  let order = 0;

  const rides = (node: Node): boolean => scroller !== null && scroller.contains(node);

  const words = (node: Text): void => {
    const parent = node.parentElement;
    if (!parent || !drawn(parent)) return;
    range.selectNodeContents(node);
    const lines = range.getClientRects();
    const onScroller = scroller !== null && rides(node);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // (a space between two words, or a letter's width: not a line)
      if (line.width < 3 || line.height < 5) continue;
      let rect: Rect | null = { x: line.left, y: line.top, w: line.width, h: line.height };
      if (!meets(rect, screen)) continue;
      if (onScroller && scrollBox) rect = clipTo(rect, scrollBox);
      if (!rect || rect.h < 5) continue;
      out.push({ rect, rides: onScroller, words: true, name: `${nameOf(parent, "w")}.${i}`, order: order++ });
    }
  };

  const control = (element: Element): void => {
    if (!drawn(element)) return;
    const box = element.getBoundingClientRect();
    if (box.width < 3 || box.height < 3 || box.width > bigW || box.height > bigH) return;
    let rect: Rect | null = { x: box.left, y: box.top, w: box.width, h: box.height };
    if (!meets(rect, screen)) return;
    const onScroller = rides(element);
    if (onScroller && scrollBox) rect = clipTo(rect, scrollBox);
    if (!rect) return;
    out.push({ rect, rides: onScroller, words: false, name: nameOf(element, "c"), order: order++ });
  };

  const walk = (parent: Node, inTile: boolean): void => {
    for (let node = parent.firstChild; node && out.length < reach.limit; node = node.nextSibling) {
      if (node.nodeType === 3) {
        if (/\S/.test(node.nodeValue ?? "")) words(node as Text);
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
        const box = element.getBoundingClientRect();
        if (box.width === 0 || !meets({ x: box.left, y: box.top, w: box.width, h: box.height }, screen)) continue;
      }
      if (!tile && NOT_WORDS.has(tag)) {
        // (a field's words are its own; the box is what is read of it)
        if (!inTile && isControl(element)) control(element);
        continue;
      }
      // (a card is a place to be on, and what is pressed of it is the card: its words are read, and it is not a button the cat keeps out of)
      if (!tile && !inTile && isControl(element)) control(element);
      walk(element, inTile || tile);
    }
  };
  walk(root, false);
  return out;
}
