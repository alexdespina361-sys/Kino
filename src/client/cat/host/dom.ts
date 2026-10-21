import type { Rect } from "../types";

/** Small readings of the page, shared by the parts of the host. They only read: nothing here changes the page. */

export const rectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, w: box.width, h: box.height };
};

/** Whether the element takes up room on the page (not `display: none`, not left out of the tree). */
export const takesRoom = (element: Element | null | undefined): element is HTMLElement => Boolean(element) && (element as HTMLElement).getClientRects().length > 0;

/** The part of the page's text that is really there: a heading is as wide as its row, but the words are only as wide as the words. */
export function textRect(element: Element): Rect | null {
  const range = document.createRange();
  range.selectNodeContents(element);
  const box = range.getBoundingClientRect();
  range.detach?.();
  return box.width > 0 && box.height > 0 ? { x: box.left, y: box.top, w: box.width, h: box.height } : null;
}

export const inflate = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by });

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const contains = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

/** The same two rectangles: to tell a page that has not changed (so the cat is not handed a new world for nothing). */
export const sameRect = (a: Rect, b: Rect): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

/** A name for an element that stays its name for as long as the element lives (the shelf the cat stands on is told apart by it from one look at the page to the next). */
const names = new WeakMap<Element, string>();
let counter = 0;
export function nameOf(element: Element, kind: string): string {
  let name = names.get(element);
  if (!name) {
    name = `${kind}${++counter}`;
    names.set(element, name);
  }
  return name;
}
