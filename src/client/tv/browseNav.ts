import type { Direction } from "./dpad";

export type Zone = "rail" | "top" | "hero" | "rows" | "grid" | "keys" | "chips" | "results" | "foot" | "detail" | "close" | "seasons" | "episodes" | "related";

export interface Pos {
  zone: Zone;
  row: number;
  col: number;
}

export type Shape = Partial<Record<Zone, number[]>>;

export type Target = Pos | { zone: "rail" | "content"; row: -1; col: -1 } | null;

const RAIL: Target = { zone: "rail", row: -1, col: -1 };
const CONTENT: Target = { zone: "content", row: -1, col: -1 };

export function stepFrom(shape: Shape, at: Pos, direction: Direction): Target {
  const lengths = shape[at.zone] ?? [];
  const bar = shape.rail?.length === 1 && (shape.rail[0] ?? 0) > 1;
  const menu: Target = bar ? null : RAIL;
  const toBar: Target = bar ? RAIL : null;

  if (at.zone === "rail") {
    if (bar) {
      if (direction === "left") return at.col > 0 ? { zone: "rail", row: 0, col: at.col - 1 } : null;
      if (direction === "right") return at.col < (lengths[0] ?? 0) - 1 ? { zone: "rail", row: 0, col: at.col + 1 } : null;
      return direction === "up" ? CONTENT : null;
    }
    if (direction === "right") return CONTENT;
    if (direction === "down") return at.row < lengths.length - 1 ? { zone: "rail", row: at.row + 1, col: 0 } : null;
    if (direction === "up") return at.row > 0 ? { zone: "rail", row: at.row - 1, col: 0 } : null;
    return null;
  }

  const BUTTONS: Pos = { zone: "detail", row: 0, col: 0 };
  const CLOSE: Pos = { zone: "close", row: 0, col: 0 };
  const firstEpisode: Pos | null = shape.episodes?.length ? { zone: "episodes", row: 0, col: 0 } : null;
  const firstRelated: Pos | null = shape.related?.length ? { zone: "related", row: 0, col: 0 } : null;
  const aboveRelated: Pos = shape.episodes?.length ? { zone: "episodes", row: shape.episodes.length - 1, col: 0 } : shape.seasons?.length ? { zone: "seasons", row: 0, col: 0 } : BUTTONS;
  if (at.zone === "close") {
    if (direction === "down") return BUTTONS;
    return direction === "left" ? { ...BUTTONS, col: Math.max(0, (shape.detail?.[0] ?? 1) - 1) } : null;
  }
  if (at.zone === "detail") {
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : null;
    if (direction === "right") return at.col < (lengths[0] ?? 0) - 1 ? { ...at, col: at.col + 1 } : shape.close?.length ? CLOSE : null;
    if (direction === "up") return shape.close?.length ? CLOSE : null;
    return shape.seasons?.length ? { zone: "seasons", row: 0, col: 0 } : (firstEpisode ?? firstRelated);
  }
  if (at.zone === "seasons") {
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : null;
    if (direction === "right") return at.col < (lengths[0] ?? 0) - 1 ? { ...at, col: at.col + 1 } : null;
    return direction === "up" ? BUTTONS : (firstEpisode ?? firstRelated);
  }
  if (at.zone === "episodes") {
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : null;
    if (direction === "right") return at.col < (lengths[at.row] ?? 1) - 1 ? { ...at, col: at.col + 1 } : null;
    if (direction === "up") return at.row > 0 ? { ...at, row: at.row - 1 } : shape.seasons?.length ? { zone: "seasons", row: 0, col: 0 } : BUTTONS;
    return at.row < lengths.length - 1 ? { ...at, row: at.row + 1, col: Math.min(at.col, (lengths[at.row + 1] ?? 1) - 1) } : firstRelated;
  }
  if (at.zone === "related") {
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : null;
    if (direction === "right") return at.col < (lengths[at.row] ?? 0) - 1 ? { ...at, col: at.col + 1 } : null;
    const row = at.row + (direction === "up" ? -1 : 1);
    if (row < 0) return aboveRelated;
    return row < lengths.length ? { zone: "related", row, col: Math.min(at.col, (lengths[row] ?? 1) - 1) } : null;
  }

  if (at.zone === "foot") {
    if (direction === "up") {
      const rows = shape.grid ?? [];
      if (rows.length > 0) return { zone: "grid", row: rows.length - 1, col: 0 };
      return shape.chips?.length ? { zone: "chips", row: 0, col: 0 } : shape.top?.length ? { zone: "top", row: 0, col: 0 } : null;
    }
    if (direction === "down") return toBar;
    return direction === "left" ? menu : null;
  }

  if (at.zone === "top") {
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : null;
    if (direction === "right") return at.col < (lengths[0] ?? 0) - 1 ? { ...at, col: at.col + 1 } : null;
    return direction === "down" ? (shape.hero?.length ? { zone: "hero", row: 0, col: 0 } : shape.rows?.length && shape.chips?.length ? { zone: "chips", row: 0, col: 0 } : CONTENT) : null;
  }

  if (at.zone === "hero") {
    const buttons = lengths[0] ?? 0;
    if (direction === "left") return at.col > 0 ? { ...at, col: at.col - 1 } : menu;
    if (direction === "right") return at.col < buttons - 1 ? { ...at, col: at.col + 1 } : null;
    if (direction === "up") return shape.top?.length ? { zone: "top", row: 0, col: 0 } : null;
    return CONTENT;
  }

  const length = lengths[at.row] ?? 0;
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
      if (at.zone === "chips" && shape.keys?.length) return { zone: "keys", row: 0, col: (shape.keys[0] ?? 1) - 1 };
      return menu;
    case "right":
      if (at.col < length - 1) return { ...at, col: at.col + 1 };
      if (at.zone === "keys") {
        if (at.row === 0 && shape.chips?.length) return { zone: "chips", row: 0, col: 0 };
        if (shape.results?.length) return { zone: "results", row: Math.min(at.row, shape.results.length - 1), col: 0 };
      }
      return null;
    case "up":
      if (at.row > 0) return into(at.row - 1);
      if (at.zone === "rows" && shape.hero?.length) return { zone: "hero", row: 0, col: 0 };
      if (at.zone === "rows" && shape.chips?.length) return { zone: "chips", row: 0, col: 0 };
      if ((at.zone === "results" || at.zone === "grid") && shape.chips?.length) return { zone: "chips", row: shape.chips.length - 1, col: Math.min(at.col, (shape.chips[shape.chips.length - 1] ?? 1) - 1) };
      return shape.top?.length ? { zone: "top", row: 0, col: 0 } : null;
    case "down":
      if (at.zone === "chips") {
        if (at.row < lengths.length - 1) return into(at.row + 1);
        if (shape.rows?.length) return CONTENT;
        const below = shape.results?.length ? "results" : shape.grid?.length ? "grid" : shape.foot?.length ? "foot" : null;
        return below ? { zone: below, row: 0, col: Math.min(at.col, (shape[below]?.[0] ?? 1) - 1) } : toBar;
      }
      if (at.row < lengths.length - 1) return into(at.row + 1);
      if (at.zone === "grid" && shape.foot?.length) return { zone: "foot", row: 0, col: 0 };
      return toBar;
  }
}

export function gridRows(count: number, columns: number): number[] {
  const rows: number[] = [];
  for (let left = count; left > 0; left -= columns) rows.push(Math.min(columns, left));
  return rows;
}

export interface GridSection {
  title: string;
  count: number;
}

export function sectionRows(sections: readonly GridSection[], columns: number): number[] {
  return sections.flatMap((section) => gridRows(section.count, columns));
}

export function sectionPlaces(sections: readonly GridSection[], columns: number): Array<{ row: number; col: number; heading?: string }> {
  const places: Array<{ row: number; col: number; heading?: string }> = [];
  let first = 0;
  for (const { title, count } of sections) {
    for (let at = 0; at < count; at++) places.push({ row: first + Math.floor(at / columns), col: at % columns, ...(at === 0 ? { heading: title } : {}) });
    first += gridRows(count, columns).length;
  }
  return places;
}
