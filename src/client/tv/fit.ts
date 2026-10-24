import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isCompact } from "./compact";

/**
 * What the player's controls give up, in this order, until they fit on one line: the room between the buttons, then the long labels
 * (each button's icon says the same, and the label stays in its tooltip), the episode names under Previous and Next in the middle
 * of them, and last the size of everything. A screen no wider than a phone gets past all of them, and its controls wrap. Each is a
 * word of the row's `data-fit`, which tv.css answers; the buttons that give up a label carry its word as `data-fold`, and are marked
 * `data-folded` while the row has said so.
 */
export const FIT_STEPS = ["tight", "party", "tracks", "names", "skips", "episodes", "small", "wrap"] as const;

/** What a row was last fitted to, and how much that took. */
interface Fitted {
  key: string;
  count: number;
}

/** Whether the row's groups of buttons, side by side as they are, take no more than the room the row has. */
function fits(row: HTMLElement): boolean {
  const groups = Array.from(row.children) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  // The widths of the boxes, not of what is drawn: the button the remote is on is a little larger than its box, and that is no reason to give anything up.
  const used = groups.reduce((sum, group) => sum + group.offsetWidth, 0) + gap * Math.max(0, groups.length - 1);
  return used <= row.clientWidth + 1;
}

/** The row with its first `count` steps given up. */
function giveUp(row: HTMLElement, count: number): void {
  const steps: readonly string[] = FIT_STEPS.slice(0, count);
  const fit = steps.join(" ");
  if (row.dataset.fit !== fit) row.dataset.fit = fit;
  for (const button of row.querySelectorAll<HTMLElement>("[data-fold]")) button.toggleAttribute("data-folded", steps.includes(button.dataset.fold!));
}

/** Gives up as little as it takes. A row that is as it was fitted (the room, the buttons, their words) is left as it is, apart from a button that is new since. */
function fit(row: HTMLElement, last: Fitted): void {
  // A phone held upright (compact.ts) lays its controls out in rows of its own, each button as big as a thumb needs (polish/tv-phone.css): nothing is given up.
  if (isCompact()) {
    last.key = "";
    return giveUp(row, 0);
  }
  const key = `${row.clientWidth}|${row.childElementCount}|${row.textContent}`;
  if (key === last.key) return giveUp(row, last.count);
  let count = 0;
  giveUp(row, count);
  while (count < FIT_STEPS.length && !fits(row)) giveUp(row, ++count);
  last.key = key;
  last.count = count;
}

/**
 * Keeps the controls on one line, on any screen and in any language: whenever the buttons, their words or the room change, it gives
 * up the fewest of the FIT_STEPS that make them fit. It is measured, not guessed, so a font that is wider than the one this was
 * written with costs a label, not a second row.
 */
export function useOneLine(row: RefObject<HTMLElement | null>): void {
  const last = useRef<Fitted>({ key: "", count: 0 });
  // After every render: a label, a button or a language may have changed.
  useLayoutEffect(() => {
    if (row.current) fit(row.current, last.current);
  });
  // The room changes with the window (and with full screen), which no render says.
  useEffect(() => {
    const onResize = () => row.current && fit(row.current, last.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [row]);
}
