import { useEffect, type RefObject } from "react";
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
 * Which box the D-pad should move to from `boxes[from]`: the nearest one lying that way, where being in line counts for
 * more than being close (so Down from a button lands on the one below it, not on a nearer one off to the side).
 * -1 when there is nothing in that direction. Pure, so it can be tested without a screen.
 */
export function pickNeighbour(boxes: Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return -1;
  const start = centre(origin);
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, index) => {
    if (index === from) return;
    const at = centre(box);
    const along = direction === "left" ? start.x - at.x : direction === "right" ? at.x - start.x : direction === "up" ? start.y - at.y : at.y - start.y;
    if (along < 1) return; // not that way
    const across = direction === "left" || direction === "right" ? Math.abs(at.y - start.y) : Math.abs(at.x - start.x);
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
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
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at === -1) {
    items[0]!.focus();
    return true;
  }
  const next = pickNeighbour(items.map((item) => item.getBoundingClientRect()), at, direction);
  if (next === -1) return false;
  items[next]!.focus();
  return true;
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
