import { useEffect, useRef, type RefObject } from "react";
import { actionForKey } from "./keys";

export type Direction = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/**
 * Which box the D-pad should move to from `boxes[from]`. A box straight ahead (sharing some of the way across with the start) wins
 * over any amount of closeness off to the side, and of those the nearest wins, so Down from a picture lands on the button under it
 * and not on a wide one further down. With nothing straight ahead, the nearest one lying that way, in line counting for more than
 * being close. A box has to lie wholly that way: a wide row is not beside the buttons it holds.
 * -1 when there is nothing in that direction. Pure, so it can be tested without a screen.
 */
export function pickNeighbour(boxes: Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return -1;
  const start = centre(origin);
  const sideways = direction === "left" || direction === "right";
  const extent = sideways ? origin.right - origin.left : origin.bottom - origin.top; // how big the start is, the way the press goes
  const candidates = boxes
    .map((box, index) => {
      const at = centre(box);
      const along = direction === "left" ? start.x - at.x : direction === "right" ? at.x - start.x : direction === "up" ? start.y - at.y : at.y - start.y;
      const gap = direction === "left" ? origin.left - box.right : direction === "right" ? box.left - origin.right : direction === "up" ? origin.top - box.bottom : box.top - origin.bottom;
      const across = sideways ? Math.abs(at.y - start.y) : Math.abs(at.x - start.x);
      const ahead = sideways ? box.top < origin.bottom && box.bottom > origin.top : box.left < origin.right && box.right > origin.left;
      return { index, along, gap, across, ahead };
    })
    .filter(({ index, along, gap }) => index !== from && along >= 1 && gap >= -extent / 10); // lying wholly that way, give or take a button that has grown under the focus
  if (candidates.length === 0) return -1;
  const ahead = candidates.filter((candidate) => candidate.ahead);
  if (ahead.length > 0) {
    const nearest = Math.min(...ahead.map(({ gap }) => gap));
    return ahead.filter(({ gap }) => gap < nearest + extent / 2).reduce((a, b) => (b.across < a.across ? b : a)).index;
  }
  return candidates.reduce((a, b) => (b.along + b.across * 3 < a.along + a.across * 3 ? b : a)).index;
}

/**
 * For a bar of buttons that may wrap into rows (the player's controls): Left and Right walk along the row the button is in and
 * stop at its ends; Up and Down step to the nearest row that way and land on the button closest to where the focus was.
 * -1 when there is nothing that way. Pure, like `pickNeighbour`.
 */
export function pickInRows(boxes: Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return -1;
  const start = centre(origin);
  const slack = (origin.bottom - origin.top) / 2; // two buttons are in one row when their middles are less than half a button apart
  const inRow = (box: Box) => Math.abs(centre(box).y - start.y) < slack;
  const sideways = direction === "left" || direction === "right";
  const candidates = boxes
    .map((box, index) => ({ index, at: centre(box), row: inRow(box) }))
    .filter(({ index, at, row }) => {
      if (index === from) return false;
      if (sideways) return row && (direction === "right" ? at.x - start.x : start.x - at.x) >= 1;
      return !row && (direction === "down" ? at.y - start.y : start.y - at.y) > 0;
    });
  if (candidates.length === 0) return -1;
  if (sideways) return candidates.reduce((a, b) => (Math.abs(b.at.x - start.x) < Math.abs(a.at.x - start.x) ? b : a)).index;
  const away = (at: { y: number }) => Math.abs(at.y - start.y);
  const nearest = Math.min(...candidates.map(({ at }) => away(at)));
  const row = candidates.filter(({ at }) => away(at) < nearest + slack); // the buttons of the nearest row
  return row.reduce((a, b) => (Math.abs(b.at.x - start.x) < Math.abs(a.at.x - start.x) ? b : a)).index;
}

const NAV = "[data-nav]:not(:disabled)";

/** Everything in `root` the D-pad can land on, in page order. */
export function navItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(NAV)].filter((item) => item.getClientRects().length > 0);
}

/**
 * Move the focus one step. With nothing focused yet, the first press only lands on the first thing (so a stray OK or arrow
 * never presses anything). Returns whether it did anything.
 */
export function moveFocus(root: ParentNode, direction: Direction): boolean {
  const items = navItems(root);
  if (items.length === 0) return false;
  const current = document.activeElement as HTMLElement;
  if (!items.includes(current)) {
    items[0]!.focus();
    return true;
  }
  // On a screen of columns (`data-nav-column`), Up and Down stay in the column the focus is in; Left and Right cross over.
  // Columns that have been stacked on a narrow screen are one column, so what overlaps this one across is still in reach.
  const column = current.closest("[data-nav-column]");
  const here = column?.getBoundingClientRect();
  const inReach = (item: HTMLElement) => {
    const other = item.closest("[data-nav-column]");
    if (other === column) return true;
    const box = other?.getBoundingClientRect();
    return !!box && !!here && box.left < here.right && here.left < box.right;
  };
  const pool = column && (direction === "up" || direction === "down") ? items.filter(inReach) : items;
  const next = pickNeighbour(pool.map((item) => item.getBoundingClientRect()), pool.indexOf(current), direction);
  if (next === -1) return false;
  pool[next]!.focus();
  return true;
}

/** Back on a screen of its own: Escape, the remote's Back, and Backspace outside a text field. Without a handler, Back is left alone. */
export function useBack(onBack: (() => void) | undefined): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  const active = onBack !== undefined;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || actionForKey(event) !== "back") return;
      event.preventDefault();
      latest.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/**
 * A screen the remote can walk around: the arrow keys move between its `[data-nav]` things, and OK on a screen where nothing
 * has the focus yet only lands on the first one, instead of pressing it. OK on a focused one is a normal press.
 */
export function useDpad(root: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !root.current) return;
      const action = actionForKey(event);
      if (action === "up" || action === "down" || action === "left" || action === "right") {
        if (moveFocus(root.current, action)) event.preventDefault();
      } else if (action === "select") {
        const items = navItems(root.current);
        if (items.length > 0 && !items.includes(document.activeElement as HTMLElement)) {
          items[0]!.focus();
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root, enabled]);
}
