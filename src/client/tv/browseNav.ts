import type { Direction } from "./dpad";

/**
 * Where the arrow keys lead on the library screen. The screen is a few blocks ("zones") of buttons laid out in rows: the menu
 * on the left, the Back button on top, and in the middle either rows of titles, a grid, or the search keyboard with its results.
 * Pure, so the walking can be tested without a screen.
 */
export type Zone = "rail" | "top" | "rows" | "grid" | "keys" | "results";

export interface Pos {
  zone: Zone;
  row: number;
  col: number;
}

/** How many buttons each row of a zone has. A zone that is not on screen is left out. */
export type Shape = Partial<Record<Zone, number[]>>;

/** `row: -1` asks the screen to pick: the menu entry for the page that is open, or the title the remote was last on. */
export type Target = Pos | { zone: "rail" | "content"; row: -1; col: -1 } | null;

const RAIL: Target = { zone: "rail", row: -1, col: -1 };
const CONTENT: Target = { zone: "content", row: -1, col: -1 };

export function stepFrom(shape: Shape, at: Pos, direction: Direction): Target {
  const lengths = shape[at.zone] ?? [];

  if (at.zone === "rail") {
    if (direction === "right") return CONTENT;
    if (direction === "down") return at.row < lengths.length - 1 ? { zone: "rail", row: at.row + 1, col: 0 } : null;
    if (direction === "up") return at.row > 0 ? { zone: "rail", row: at.row - 1, col: 0 } : null;
    return null;
  }

  if (at.zone === "top") return direction === "down" ? CONTENT : null;

  const length = lengths[at.row] ?? 0;
  // The keyboard's last row has two wide keys under six narrow ones, so a step there keeps to what is above or below it.
  const into = (row: number): Pos => {
    const next = lengths[row] ?? 1;
    const col = at.zone === "keys" ? Math.floor(((at.col + 0.5) * next) / Math.max(1, length)) : at.col;
    return { zone: at.zone, row, col: Math.max(0, Math.min(next - 1, col)) };
  };

  switch (direction) {
    case "left":
      if (at.col > 0) return { ...at, col: at.col - 1 };
      if (at.zone === "results" && shape.keys?.length) {
        const row = Math.min(at.row, shape.keys.length - 1);
        return { zone: "keys", row, col: (shape.keys[row] ?? 1) - 1 };
      }
      return RAIL;
    case "right":
      if (at.col < length - 1) return { ...at, col: at.col + 1 };
      if (at.zone === "keys" && shape.results?.length) return { zone: "results", row: Math.min(at.row, shape.results.length - 1), col: 0 };
      return null;
    case "up":
      if (at.row > 0) return into(at.row - 1);
      return shape.top?.length ? { zone: "top", row: 0, col: 0 } : null;
    case "down":
      return at.row < lengths.length - 1 ? into(at.row + 1) : null;
  }
}

/** Row lengths for `count` things laid out `columns` to a row. */
export function gridRows(count: number, columns: number): number[] {
  const rows: number[] = [];
  for (let left = count; left > 0; left -= columns) rows.push(Math.min(columns, left));
  return rows;
}
